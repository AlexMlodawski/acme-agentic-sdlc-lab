import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  containsAbsoluteUserPath,
  containsHighConfidenceSecret,
  containsOpaqueProviderCredential,
} from "./content-policy.mjs";
import { inspectJpeg, inspectPng } from "./documentation-scan.mjs";

const root = process.cwd();
const maximumFileBytes = 10 * 1024 * 1024;
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

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    env: gitEnvironment,
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error("Release scan requires an initialized Git repository.");
  }
  return result.stdout;
}

try {
const topLevel = runGit(["rev-parse", "--show-toplevel"]).toString("utf8").trim();
if (topLevel === "" || /[\r\n]/u.test(topLevel)) {
  throw new Error("Release scan repository root is invalid.");
}
const normalizeRoot = (value) => {
  const resolved = path.resolve(realpathSync(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};
if (normalizeRoot(topLevel) !== normalizeRoot(root)) {
  throw new Error("Release scan must run at the repository root.");
}

function startsWithBytes(buffer, expected) {
  return buffer.length >= expected.length
    && expected.every((byte, index) => buffer[index] === byte);
}

function inspectBinaryContent(buffer) {
  const isPng = startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const isJpeg = startsWithBytes(buffer, [0xff, 0xd8, 0xff]);
  let invalidUtf8 = false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    invalidUtf8 = true;
  }
  const allowedControls = new Set([9, 10, 12, 13]);
  let controlBytes = 0;
  for (const byte of buffer) {
    if (byte < 32 && !allowedControls.has(byte)) controlBytes += 1;
  }
  const binary = isPng
    || isJpeg
    || buffer.includes(0)
    || invalidUtf8
    || (buffer.length > 0 && controlBytes / buffer.length > 0.02);
  if (!binary) return { binary: false, valid: true, sensitive: false };
  if (isPng) return { binary: true, ...inspectPng(buffer) };
  if (isJpeg) return { binary: true, ...inspectJpeg(buffer) };
  return { binary: true, valid: false, sensitive: false };
}

const serializedPaths = runGit(["ls-files", "--stage", "-z"]).toString("utf8");
if (serializedPaths.includes("\uFFFD")) {
  throw new Error("Tracked paths must be valid UTF-8.");
}
const trackedEntries = serializedPaths.split("\0").filter(Boolean).map((entry) => {
  const separator = entry.indexOf("\t");
  const metadata = separator < 0 ? [] : entry.slice(0, separator).split(" ");
  return {
    mode: metadata[0] ?? "",
    path: separator < 0 ? "" : entry.slice(separator + 1),
  };
});
if (trackedEntries.length === 0) {
  throw new Error("Release scan requires at least one tracked file.");
}

const findings = {
  secret: 0,
  absolutePath: 0,
  privateReference: 0,
  pathSecret: 0,
  pathAbsolutePath: 0,
  pathPrivateReference: 0,
  forbiddenFile: 0,
  unscannedFile: 0,
};

for (const { mode, path: trackedPath } of trackedEntries) {
  const normalized = trackedPath.replaceAll("\\", "/");
  if (containsHighConfidenceSecret(normalized)) findings.pathSecret += 1;
  if (containsAbsoluteUserPath(normalized)) findings.pathAbsolutePath += 1;
  if (forbiddenPrivateReference.test(normalized)) findings.pathPrivateReference += 1;
  const segments = normalized.split("/");
  const basename = segments.at(-1) ?? "";
  const normalizedBasename = basename.toLowerCase();
  const extension = path.extname(basename).toLowerCase();
  const isAllowedEnvironmentExample = normalizedBasename === ".env.example"
    || normalizedBasename.endsWith(".env.example");
  const unsafeOrSpecialPath = path.isAbsolute(trackedPath)
    || !new Set(["100644", "100755"]).has(mode)
    || segments.some((segment) => segment === "" || segment === "..");
  const forbiddenByPolicy = segments.some((segment) => forbiddenSegments.has(segment.toLowerCase()))
    || (/^\.env(?:\.|$)/u.test(normalizedBasename) && !isAllowedEnvironmentExample)
    || forbiddenCredentialFile.test(basename)
    || forbiddenCredentialExtension.has(extension)
    || forbiddenCredentialExtension.has(normalizedBasename)
    || forbiddenGeneratedFile.has(normalizedBasename);
  if (unsafeOrSpecialPath || forbiddenByPolicy) {
    findings.forbiddenFile += 1;
  }
  if (unsafeOrSpecialPath) {
    continue;
  }

  const absolute = path.resolve(root, trackedPath);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) {
    findings.forbiddenFile += 1;
    continue;
  }
  let metadata;
  try {
    metadata = await lstat(absolute);
  } catch {
    findings.unscannedFile += 1;
    continue;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximumFileBytes) {
    findings.unscannedFile += 1;
    continue;
  }

  let buffer;
  try {
    buffer = await readFile(absolute);
  } catch {
    findings.unscannedFile += 1;
    continue;
  }
  const binary = inspectBinaryContent(buffer);
  if (binary.binary) {
    if (!binary.valid) findings.unscannedFile += 1;
    if (binary.sensitive) findings.secret += 1;
    continue;
  }
  const content = buffer.toString("latin1");
  if (
    containsHighConfidenceSecret(content)
    || containsOpaqueProviderCredential(content)
  ) findings.secret += 1;
  if (containsAbsoluteUserPath(content)) findings.absolutePath += 1;
  if (forbiddenPrivateReference.test(content)) findings.privateReference += 1;
}

console.log(`TRACKED_FILES_SCANNED=${trackedEntries.length}`);
console.log(`PATH_SECRET_FINDINGS=${findings.pathSecret}`);
console.log(`PATH_ABSOLUTE_USER_PATH_FINDINGS=${findings.pathAbsolutePath}`);
console.log(`PATH_PRIVATE_REFERENCE_FINDINGS=${findings.pathPrivateReference}`);
console.log(`SECRET_SCAN=${findings.secret === 0 && findings.pathSecret === 0 ? "PASS" : "FAIL"}`);
console.log(`ABSOLUTE_USER_PATH_SCAN=${findings.absolutePath === 0 && findings.pathAbsolutePath === 0 ? "PASS" : "FAIL"}`);
console.log(`PRIVATE_INFRA_REFERENCE_SCAN=${findings.privateReference === 0 && findings.pathPrivateReference === 0 ? "PASS" : "FAIL"}`);
console.log(`FORBIDDEN_FILE_SCAN=${findings.forbiddenFile === 0 ? "PASS" : "FAIL"}`);
console.log(`UNSCANNED_FILE_SCAN=${findings.unscannedFile === 0 ? "PASS" : "FAIL"}`);
if (Object.values(findings).some((count) => count !== 0)) process.exitCode = 1;
} catch {
  console.log("RELEASE_SCAN_ERROR=FAIL");
  process.exitCode = 2;
}
