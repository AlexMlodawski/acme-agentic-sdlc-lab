import { spawn, spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";
import { pathToFileURL } from "node:url";

import {
  containsAbsoluteUserPath,
  containsHighConfidenceSecret,
  containsOpaqueProviderCredential,
} from "./content-policy.mjs";
import { inspectJpeg, inspectPng } from "./documentation-scan.mjs";

const root = process.cwd();
const overlapBytes = 8 * 1024;
const maximumInspectedBinaryBytes = 10 * 1024 * 1024;
const prefixBytes = 64 * 1024;
const textControlBytes = new Set([9, 10, 12, 13]);

const forbiddenSegments = new Set([
  ".bob", ".forgejo", ".git", ".next", ".run", ".tools", ".venv",
  ".wxo-local-config", "coverage", "dist", "node_modules", "playwright-report",
  "playwright-report-built", "release-evidence", "showcase", "test-results",
  "test-results-built",
]);
const forbiddenCredentialFile = /(?:^|[-_.])(?:auth-cache|credentials?|token-cache)(?:[-_.]|$)/iu;
const forbiddenCredentialExtension = new Set([
  ".jks", ".key", ".keystore", ".netrc", ".npmrc", ".p12", ".pem", ".pfx",
]);
const forbiddenGeneratedFile = new Set([
  "clean-archive-verify.json",
  "evidence-complete.json",
  "license-inventory.json",
  "sbom.cdx.json",
]);
const forbiddenPrivateReference = new RegExp([
  "localhost:" + "3005",
  "bob-ecosystem-" + "showcase",
  "webinar/" + "presentation-live",
  "Stage " + "11",
  "STAGE" + "11",
].join("|"), "iu");
const publicMetadataDomains = new Set([
  "acme.example",
  "example.invalid",
  "github.com",
  "noreply.github.com",
  "users.noreply.github.com",
]);

function isolatedGitEnvironment(environment = process.env) {
  const allowed = new Set([
    "COMSPEC", "LANG", "LANGUAGE", "LC_ALL", "PATH", "PATHEXT", "SYSTEMDRIVE",
    "SYSTEMROOT", "TEMP", "TERM", "TMP", "TMPDIR", "WINDIR",
  ]);
  const result = {};
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value === "string" && allowed.has(name.toUpperCase())) result[name] = value;
  }
  return {
    ...result,
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
}

const gitEnvironment = isolatedGitEnvironment();

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: null,
    shell: false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
    env: gitEnvironment,
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error("git operation failed");
  }
  return result.stdout;
}

function repositoryGraphState() {
  const replaceRefs = runGit([
    "for-each-ref",
    "--format=%(refname)",
    "refs/replace/",
  ]).toString("utf8").trim();
  const shallowValue = runGit(["rev-parse", "--is-shallow-repository"])
    .toString("utf8")
    .trim();
  if (!new Set(["true", "false"]).has(shallowValue)) {
    throw new Error("shallow repository state is malformed");
  }
  const graftValue = runGit(["rev-parse", "--git-path", "info/grafts"])
    .toString("utf8")
    .trim();
  if (graftValue === "" || /[\r\n]/u.test(graftValue)) {
    throw new Error("graft path is malformed");
  }
  const graftPath = path.isAbsolute(graftValue) ? graftValue : path.resolve(root, graftValue);
  let graftFile = false;
  try {
    lstatSync(graftPath);
    graftFile = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return {
    graftFile,
    replaceRefs: replaceRefs === "" ? 0 : replaceRefs.split(/\r?\n/u).length,
    shallow: shallowValue === "true",
  };
}

function assertRepositoryRoot() {
  const topLevel = runGit(["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  if (topLevel === "" || /[\r\n]/u.test(topLevel)) {
    throw new Error("repository root is malformed");
  }
  const normalize = (value) => {
    const resolved = path.resolve(realpathSync(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  if (normalize(topLevel) !== normalize(root)) {
    throw new Error("history scan must run at the repository root");
  }
}

function parseReachableObjects(serialized) {
  const text = serialized.toString("utf8");
  if (text.includes("\uFFFD")) throw new Error("object list is not valid UTF-8");

  const objects = new Map();
  for (const line of text.split(/\r?\n/u)) {
    if (line === "") continue;
    const match = /^([0-9a-f]{40,64})(?: (.*))?$/u.exec(line);
    if (!match) throw new Error("unexpected object list entry");
    const [, objectId, objectPath] = match;
    if (!objects.has(objectId)) objects.set(objectId, new Set());
    if (objectPath !== undefined) objects.get(objectId).add(objectPath);
  }
  return objects;
}

function inspectObjectTypes(objectIds) {
  if (objectIds.length === 0) return new Map();
  const stdout = runGit(
    ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    { input: Buffer.from(`${objectIds.join("\n")}\n`, "utf8") },
  ).toString("utf8");
  const result = new Map();
  for (const line of stdout.trim().split(/\r?\n/u)) {
    const match = /^([0-9a-f]{40,64}) ([a-z]+) ([0-9]+)$/u.exec(line);
    if (!match) throw new Error("unexpected object metadata");
    result.set(match[1], { type: match[2], size: Number(match[3]) });
  }
  if (result.size !== objectIds.length) throw new Error("object metadata is incomplete");
  return result;
}

function reachableCommits() {
  const text = runGit(["rev-list", "--all"]).toString("utf8").trim();
  if (text === "") return [];
  const commits = text.split(/\r?\n/u);
  if (commits.some((value) => !/^[0-9a-f]{40,64}$/u.test(value))) {
    throw new Error("unexpected commit list entry");
  }
  return commits;
}

function annotatedTagObjects() {
  const serialized = runGit([
    "for-each-ref",
    "--format=%(objecttype)%00%(objectname)%00",
  ]).toString("utf8");
  if (serialized.includes("\uFFFD")) throw new Error("tag reference metadata is not valid UTF-8");
  const fields = serialized.split("\0").map((value) => value.trim()).filter(Boolean);
  if (fields.length % 2 !== 0) throw new Error("tag reference metadata is malformed");
  const result = new Set();
  const queue = [];
  for (let index = 0; index < fields.length; index += 2) {
    const type = fields[index];
    const objectId = fields[index + 1];
    if (!/^[a-z]+$/u.test(type) || !/^[0-9a-f]{40,64}$/u.test(objectId)) {
      throw new Error("tag reference metadata is malformed");
    }
    if (type === "tag") queue.push(objectId);
  }
  while (queue.length > 0) {
    const objectId = queue.pop();
    if (result.has(objectId)) continue;
    result.add(objectId);
    const tag = runGit(["cat-file", "tag", objectId]).toString("utf8");
    const target = /^object ([0-9a-f]{40,64})$/mu.exec(tag)?.[1];
    if (target === undefined) throw new Error("annotated tag target is malformed");
    const targetType = runGit(["cat-file", "-t", target]).toString("utf8").trim();
    if (targetType === "tag") queue.push(target);
  }
  return [...result].sort();
}

function countDirectMetadataEmails(tagObjectIds) {
  const serialized = runGit(["log", "--all", "--format=%ae%x00%ce%x00"]);
  const text = serialized.toString("utf8");
  if (text.includes("\uFFFD")) throw new Error("commit metadata is not valid UTF-8");
  const direct = new Set();
  const values = text.split("\0");
  for (const objectId of tagObjectIds) {
    const tag = runGit(["cat-file", "tag", objectId]).toString("utf8");
    if (tag.includes("\uFFFD")) throw new Error("tag metadata is not valid UTF-8");
    const tagger = /^tagger .* <([^<>\r\n]+)> \d+ [+-]\d{4}$/mu.exec(tag)?.[1];
    if (tagger !== undefined) values.push(tagger);
  }
  for (const rawValue of values) {
    const email = rawValue.trim().toLowerCase();
    if (email === "") continue;
    const match = /^[^@\s]+@([^@\s]+)$/u.exec(email);
    if (!match) throw new Error("commit email metadata is malformed");
    if (!publicMetadataDomains.has(match[1])) direct.add(email);
  }
  return direct.size;
}

function pathsFromReachableTrees(treeObjectIds) {
  const paths = new Set();
  for (const treeObjectId of treeObjectIds) {
    const serialized = runGit(["ls-tree", "-r", "-z", "--name-only", treeObjectId]).toString("utf8");
    if (serialized.includes("\uFFFD")) throw new Error("tree path is not valid UTF-8");
    for (const candidate of serialized.split("\0")) {
      if (candidate !== "") paths.add(candidate);
    }
  }
  return paths;
}

function currentTrackedBlobIds() {
  const serialized = runGit(["ls-files", "--stage", "-z"]).toString("utf8");
  if (serialized.includes("\uFFFD")) throw new Error("index entries are not valid UTF-8");
  const ids = new Set();
  for (const entry of serialized.split("\0")) {
    if (entry === "") continue;
    const separator = entry.indexOf("\t");
    const metadata = separator < 0 ? "" : entry.slice(0, separator);
    const match = /^100(?:644|755) ([0-9a-f]{40,64}) 0$/u.exec(metadata);
    if (!match) throw new Error("index contains an unsupported entry");
    ids.add(match[1]);
  }
  return ids;
}

function isForbiddenPath(candidate) {
  const normalized = candidate.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const basename = segments.at(-1) ?? "";
  const normalizedBasename = basename.toLowerCase();
  const dot = normalizedBasename.lastIndexOf(".");
  const extension = dot < 0 ? "" : normalizedBasename.slice(dot);
  const environmentExample = normalizedBasename === ".env.example"
    || normalizedBasename.endsWith(".env.example");
  return segments.some((segment) => segment === "" || segment === "..")
    || segments.some((segment) => forbiddenSegments.has(segment.toLowerCase()))
    || (/^\.env(?:\.|$)/u.test(normalizedBasename) && !environmentExample)
    || forbiddenCredentialFile.test(basename)
    || forbiddenCredentialExtension.has(extension)
    || forbiddenCredentialExtension.has(normalizedBasename)
    || forbiddenGeneratedFile.has(normalizedBasename);
}

function scanWindow(text, state) {
  if (
    !state.secret
    && (
      containsHighConfidenceSecret(text)
      || containsOpaqueProviderCredential(text)
    )
  ) {
    state.secret = true;
  }
  if (!state.absolutePath && containsAbsoluteUserPath(text)) state.absolutePath = true;
  if (!state.privateReference && forbiddenPrivateReference.test(text)) {
    state.privateReference = true;
  }
}

function startsWithBytes(buffer, expected) {
  return buffer.length >= expected.length
    && expected.every((byte, index) => buffer[index] === byte);
}

function binaryKind(prefix) {
  if (startsWithBytes(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (startsWithBytes(prefix, [0xff, 0xd8, 0xff])) return "jpeg";
  if (
    startsWithBytes(prefix, [0x50, 0x4b, 0x03, 0x04])
    || startsWithBytes(prefix, [0x50, 0x4b, 0x05, 0x06])
    || startsWithBytes(prefix, [0x50, 0x4b, 0x07, 0x08])
    || startsWithBytes(prefix, [0x1f, 0x8b])
    || startsWithBytes(prefix, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
    || startsWithBytes(prefix, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])
    || prefix.subarray(0, 5).toString("ascii") === "%PDF-"
  ) {
    return "unsupported-container";
  }
  return null;
}

function scanBlobObject(objectId, expectedSize, currentBlob) {
  return new Promise((resolve) => {
    const child = spawn("git", ["cat-file", "blob", objectId], {
      cwd: root,
      env: gitEnvironment,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const state = {
      secret: false,
      absolutePath: false,
      privateReference: false,
      unsupportedBinary: false,
      binaryFormat: false,
    };
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const retained = [];
    let retainedBytes = 0;
    let prefix = Buffer.alloc(0);
    let overlap = Buffer.alloc(0);
    let totalBytes = 0;
    let controlBytes = 0;
    let sawNull = false;
    let invalidUtf8 = false;
    let failed = false;

    child.on("error", () => {
      failed = true;
    });
    child.stdout.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (prefix.length < prefixBytes) {
        prefix = Buffer.concat([
          prefix,
          chunk.subarray(0, Math.min(chunk.length, prefixBytes - prefix.length)),
        ]);
      }
      if (expectedSize <= maximumInspectedBinaryBytes) {
        retained.push(chunk);
        retainedBytes += chunk.length;
      }
      for (const byte of chunk) {
        if (byte === 0) sawNull = true;
        if (byte < 32 && !textControlBytes.has(byte)) controlBytes += 1;
      }
      if (!invalidUtf8) {
        try {
          decoder.decode(chunk, { stream: true });
        } catch {
          invalidUtf8 = true;
        }
      }
      const window = overlap.length === 0 ? chunk : Buffer.concat([overlap, chunk]);
      scanWindow(window.toString("latin1"), state);
      overlap = window.subarray(Math.max(0, window.length - overlapBytes));
    });
    child.on("close", (code) => {
      if (code !== 0 || failed || totalBytes !== expectedSize) {
        resolve(null);
        return;
      }
      if (!invalidUtf8) {
        try {
          decoder.decode();
        } catch {
          invalidUtf8 = true;
        }
      }
      const kind = binaryKind(prefix);
      const looksBinary = kind !== null
        || sawNull
        || invalidUtf8
        || (totalBytes > 0 && controlBytes / totalBytes > 0.02);
      if (!looksBinary) {
        resolve(state);
        return;
      }
      if (
        !currentBlob
        || expectedSize > maximumInspectedBinaryBytes
        || !new Set(["png", "jpeg"]).has(kind)
      ) {
        state.unsupportedBinary = true;
        resolve(state);
        return;
      }
      const buffer = Buffer.concat(retained, retainedBytes);
      const inspection = kind === "png" ? inspectPng(buffer) : inspectJpeg(buffer);
      if (!inspection.valid) state.binaryFormat = true;
      if (inspection.sensitive) state.secret = true;
      resolve(state);
    });
  });
}

function scanObject(objectId, type) {
  return new Promise((resolve) => {
    const child = spawn("git", ["cat-file", type, objectId], {
      cwd: root,
      env: gitEnvironment,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const state = { secret: false, absolutePath: false, privateReference: false };
    let overlap = Buffer.alloc(0);
    let failed = false;

    child.on("error", () => {
      failed = true;
    });
    child.stdout.on("data", (chunk) => {
      const window = overlap.length === 0 ? chunk : Buffer.concat([overlap, chunk]);
      scanWindow(window.toString("latin1"), state);
      overlap = window.subarray(Math.max(0, window.length - overlapBytes));
    });
    child.on("close", (code) => {
      resolve(code === 0 && !failed ? state : null);
    });
  });
}

async function main() {
  runGit(["rev-parse", "--git-dir"]);
  assertRepositoryRoot();
  const graphState = repositoryGraphState();
  const commits = reachableCommits();
  const tagObjects = annotatedTagObjects();
  const directMetadataEmails = countDirectMetadataEmails(tagObjects);
  const objects = parseReachableObjects(runGit(["rev-list", "--objects", "--all"]));
  const metadata = inspectObjectTypes([...objects.keys()]);
  const blobIds = [...metadata.entries()]
    .filter(([, value]) => value.type === "blob")
    .map(([objectId]) => objectId)
    .sort();
  const treeIds = [...metadata.entries()]
    .filter(([, value]) => value.type === "tree")
    .map(([objectId]) => objectId)
    .sort();

  const historicalPaths = pathsFromReachableTrees(treeIds);
  const currentBlobIds = currentTrackedBlobIds();
  const pathFindings = { secret: 0, absolutePath: 0, privateReference: 0 };
  for (const historicalPath of historicalPaths) {
    const state = { secret: false, absolutePath: false, privateReference: false };
    scanWindow(historicalPath, state);
    if (state.secret) pathFindings.secret += 1;
    if (state.absolutePath) pathFindings.absolutePath += 1;
    if (state.privateReference) pathFindings.privateReference += 1;
  }

  let scannedBlobs = 0;
  let unscannedBlobs = 0;
  let secretBlobs = 0;
  let absolutePathBlobs = 0;
  let privateReferenceBlobs = 0;
  let unsupportedBinaryBlobs = 0;
  let binaryFormatBlobs = 0;
  for (const objectId of blobIds) {
    const result = await scanBlobObject(
      objectId,
      metadata.get(objectId).size,
      currentBlobIds.has(objectId),
    );
    if (result === null) {
      unscannedBlobs += 1;
      continue;
    }
    scannedBlobs += 1;
    if (result.secret) secretBlobs += 1;
    if (result.absolutePath) absolutePathBlobs += 1;
    if (result.privateReference) privateReferenceBlobs += 1;
    if (result.unsupportedBinary) unsupportedBinaryBlobs += 1;
    if (result.binaryFormat) binaryFormatBlobs += 1;
  }

  let unscannedMetadataObjects = 0;
  let metadataSecretFindings = 0;
  let metadataAbsolutePathFindings = 0;
  let metadataPrivateReferenceFindings = 0;
  for (const [objectId, type] of [
    ...commits.map((objectId) => [objectId, "commit"]),
    ...tagObjects.map((objectId) => [objectId, "tag"]),
  ]) {
    const result = await scanObject(objectId, type);
    if (result === null) {
      unscannedMetadataObjects += 1;
      continue;
    }
    if (result.secret) metadataSecretFindings += 1;
    if (result.absolutePath) metadataAbsolutePathFindings += 1;
    if (result.privateReference) metadataPrivateReferenceFindings += 1;
  }
  const referenceState = { secret: false, absolutePath: false, privateReference: false };
  scanWindow(runGit(["for-each-ref", "--format=%(refname)"]).toString("latin1"), referenceState);
  if (referenceState.secret) metadataSecretFindings += 1;
  if (referenceState.absolutePath) metadataAbsolutePathFindings += 1;
  if (referenceState.privateReference) metadataPrivateReferenceFindings += 1;

  const forbiddenPaths = [...historicalPaths].filter(isForbiddenPath).length;
  const metadataContentPassed = unscannedMetadataObjects === 0
    && metadataSecretFindings === 0
    && metadataAbsolutePathFindings === 0
    && metadataPrivateReferenceFindings === 0;
  const complete = scannedBlobs === blobIds.length
    && unscannedBlobs === 0
    && unscannedMetadataObjects === 0
    && unsupportedBinaryBlobs === 0
    && binaryFormatBlobs === 0
    && graphState.replaceRefs === 0
    && !graphState.shallow
    && !graphState.graftFile;
  const passed = complete
    && secretBlobs === 0
    && pathFindings.secret === 0
    && absolutePathBlobs === 0
    && pathFindings.absolutePath === 0
    && privateReferenceBlobs === 0
    && pathFindings.privateReference === 0
    && metadataSecretFindings === 0
    && metadataAbsolutePathFindings === 0
    && metadataPrivateReferenceFindings === 0
    && forbiddenPaths === 0
    && directMetadataEmails === 0;

  const report = [
    ["HISTORY_COMMITS_SCANNED", commits.length],
    ["HISTORY_REACHABLE_BLOBS", blobIds.length],
    ["HISTORY_BLOBS_SCANNED", scannedBlobs],
    ["HISTORY_UNSCANNED_BLOBS", unscannedBlobs],
    ["HISTORY_SECRET_BLOBS", secretBlobs],
    ["HISTORY_ABSOLUTE_PATH_BLOBS", absolutePathBlobs],
    ["HISTORY_PRIVATE_REFERENCE_BLOBS", privateReferenceBlobs],
    ["HISTORY_UNSUPPORTED_BINARY_BLOBS", unsupportedBinaryBlobs],
    ["HISTORY_BINARY_FORMAT_BLOBS", binaryFormatBlobs],
    ["HISTORY_PATH_SECRET_FINDINGS", pathFindings.secret],
    ["HISTORY_PATH_ABSOLUTE_PATH_FINDINGS", pathFindings.absolutePath],
    ["HISTORY_PATH_PRIVATE_REFERENCE_FINDINGS", pathFindings.privateReference],
    ["HISTORY_METADATA_OBJECTS_SCANNED", commits.length + tagObjects.length],
    ["HISTORY_UNSCANNED_METADATA_OBJECTS", unscannedMetadataObjects],
    ["HISTORY_METADATA_SECRET_FINDINGS", metadataSecretFindings],
    ["HISTORY_METADATA_ABSOLUTE_PATH_FINDINGS", metadataAbsolutePathFindings],
    ["HISTORY_METADATA_PRIVATE_REFERENCE_FINDINGS", metadataPrivateReferenceFindings],
    ["HISTORY_FORBIDDEN_PATHS", forbiddenPaths],
    ["HISTORY_DIRECT_METADATA_EMAILS", directMetadataEmails],
    ["HISTORY_REPLACE_REFS", graphState.replaceRefs],
    ["HISTORY_SHALLOW_REPOSITORY", graphState.shallow ? 1 : 0],
    ["HISTORY_GRAFT_FILE", graphState.graftFile ? 1 : 0],
    ["HISTORY_UNMODIFIED_OBJECT_GRAPH", (
      graphState.replaceRefs === 0 && !graphState.shallow && !graphState.graftFile
    ) ? "PASS" : "FAIL"],
    ["HISTORY_COMPLETE_SCAN", complete ? "PASS" : "FAIL"],
    ["HISTORY_BINARY_CONTENT_SCAN", (
      unsupportedBinaryBlobs === 0 && binaryFormatBlobs === 0
    ) ? "PASS" : "FAIL"],
    ["HISTORY_SECRET_SCAN", (
      secretBlobs === 0 && metadataSecretFindings === 0 && pathFindings.secret === 0
    ) ? "PASS" : "FAIL"],
    ["HISTORY_ABSOLUTE_PATH_SCAN", (
      absolutePathBlobs === 0
      && metadataAbsolutePathFindings === 0
      && pathFindings.absolutePath === 0
    ) ? "PASS" : "FAIL"],
    ["HISTORY_PRIVATE_REFERENCE_SCAN", (
      privateReferenceBlobs === 0
      && metadataPrivateReferenceFindings === 0
      && pathFindings.privateReference === 0
    ) ? "PASS" : "FAIL"],
    ["HISTORY_METADATA_CONTENT_SCAN", metadataContentPassed ? "PASS" : "FAIL"],
    ["HISTORY_FORBIDDEN_PATH_SCAN", forbiddenPaths === 0 ? "PASS" : "FAIL"],
    ["HISTORY_METADATA_PRIVACY_SCAN", directMetadataEmails === 0 ? "PASS" : "FAIL"],
    ["HISTORY_RELEASE_SCAN", passed ? "PASS" : "FAIL"],
  ];
  for (const [key, value] of report) console.log(`${key}=${value}`);
  if (!passed) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    await main();
  } catch {
    console.log("HISTORY_SCAN_ERROR=FAIL");
    process.exitCode = 2;
  }
}

export { containsHighConfidenceSecret, containsOpaqueProviderCredential };
