import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";

import {
  containsAbsoluteUserPath,
  containsHighConfidenceSecret,
  containsOpaqueProviderCredential,
} from "./content-policy.mjs";

const scanner = fileURLToPath(new URL("./history-release-scan.mjs", import.meta.url));
const documentationScanner = fileURLToPath(new URL("./documentation-scan.mjs", import.meta.url));
const contentPolicy = fileURLToPath(new URL("./content-policy.mjs", import.meta.url));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    ...options,
  });
  assert.equal(result.error, undefined);
  return result;
}

async function createRepository(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "acme-history-scan-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  await copyFile(scanner, path.join(directory, "scan.mjs"));
  await copyFile(documentationScanner, path.join(directory, "documentation-scan.mjs"));
  await copyFile(contentPolicy, path.join(directory, "content-policy.mjs"));
  assert.equal(run("git", ["init", "-q"], { cwd: directory }).status, 0);
  assert.equal(run("git", ["config", "user.name", "Acme Test"], { cwd: directory }).status, 0);
  assert.equal(run("git", ["config", "user.email", "test@example.invalid"], { cwd: directory }).status, 0);
  return directory;
}

function commitAll(directory, message) {
  assert.equal(run("git", ["add", "--all"], { cwd: directory }).status, 0);
  assert.equal(run("git", ["commit", "-q", "-m", message], { cwd: directory }).status, 0);
}

function scan(directory, options = {}) {
  return run(process.execPath, [path.join(directory, "scan.mjs")], {
    cwd: directory,
    ...options,
  });
}

function assertMachineOnlyOutput(result) {
  for (const line of result.stdout.trim().split(/\r?\n/u)) {
    assert.match(line, /^[A-Z0-9_]+=(?:[0-9]+|PASS|FAIL)$/u);
  }
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function deflatedZip(filename, content) {
  const name = Buffer.from(filename, "utf8");
  const source = Buffer.from(content, "utf8");
  const compressed = deflateRawSync(source);
  const checksum = crc32(source);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(source.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(source.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
}

test("passes a repository whose reachable history is release-safe", async (t) => {
  const directory = await createRepository(t);
  await writeFile(path.join(directory, "README.md"), "Synthetic Acme fixture.\n");
  commitAll(directory, "safe baseline");

  const result = scan(directory);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_COMMITS_SCANNED=1/u);
  assert.match(result.stdout, /HISTORY_COMPLETE_SCAN=PASS/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=PASS/u);
  assert.equal(result.stderr, "");
  assertMachineOnlyOutput(result);
});

test("ignores ambient Git routing variables and requires the actual repository root", async (t) => {
  const directory = await createRepository(t);
  await writeFile(path.join(directory, "README.md"), "Synthetic safe baseline.\n");
  commitAll(directory, "safe baseline");
  const result = scan(directory, {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: path.join(directory, "missing-global-config"),
      GIT_DIR: path.join(directory, "missing-git-dir"),
      GIT_NAMESPACE: "synthetic-namespace",
      GIT_OBJECT_DIRECTORY: path.join(directory, "missing-objects"),
      GIT_WORK_TREE: path.join(directory, "missing-work-tree"),
    },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=PASS/u);
  assertMachineOnlyOutput(result);

  const subdirectory = path.join(directory, "subdirectory");
  await mkdir(subdirectory);
  const wrongRoot = run(process.execPath, [path.join(directory, "scan.mjs")], {
    cwd: subdirectory,
  });
  assert.equal(wrongRoot.status, 2, wrongRoot.stdout + wrongRoot.stderr);
  assert.match(wrongRoot.stdout, /HISTORY_SCAN_ERROR=FAIL/u);
  assertMachineOnlyOutput(wrongRoot);
});

test("finds a synthetic secret retained only in an old commit without disclosing it", async (t) => {
  const directory = await createRepository(t);
  const historicalSecret = "ghp_" + "A".repeat(30);
  const historicalName = "removed-payload";
  await writeFile(path.join(directory, historicalName), `${historicalSecret}\n`);
  commitAll(directory, "add historical fixture");
  await rm(path.join(directory, historicalName));
  await writeFile(path.join(directory, "README.md"), "Current tree is safe.\n");
  commitAll(directory, "remove historical fixture");

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_COMMITS_SCANNED=2/u);
  assert.match(result.stdout, /HISTORY_SECRET_BLOBS=1/u);
  assert.match(result.stdout, /HISTORY_SECRET_SCAN=FAIL/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=FAIL/u);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(historicalSecret, "u"));
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(historicalName, "u"));
  assertMachineOnlyOutput(result);
});

test("finds synthetic IBM Bob credentials retained only in history", async (t) => {
  const directory = await createRepository(t);
  const bobPrefix = ["bob", "prod", "bob-apikey"].join("_") + "_";
  const rawSecret = bobPrefix + "D".repeat(64);
  const assignedSecret = bobPrefix + "E".repeat(64);
  const bobApiKeyName = ["BOB", "API", "KEY"].join("_");
  assert.equal(containsHighConfidenceSecret(rawSecret), true);
  assert.equal(
    containsOpaqueProviderCredential(`${bobApiKeyName}=${assignedSecret}`),
    true,
  );
  assert.equal(
    containsOpaqueProviderCredential(`{ ${bobApiKeyName}: apiKey }`),
    false,
  );
  await writeFile(path.join(directory, "raw-bob-credential.txt"), `${rawSecret}\n`);
  await writeFile(
    path.join(directory, "assigned-bob-credential.txt"),
    `${bobApiKeyName}=${assignedSecret}\n`,
  );
  commitAll(directory, "add synthetic provider fixtures");
  await rm(path.join(directory, "raw-bob-credential.txt"));
  await rm(path.join(directory, "assigned-bob-credential.txt"));
  await writeFile(path.join(directory, "README.md"), "Current tree is safe.\n");
  commitAll(directory, "remove synthetic provider fixtures");

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_SECRET_BLOBS=2/u);
  assert.match(result.stdout, /HISTORY_SECRET_SCAN=FAIL/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=FAIL/u);
  for (const secret of [rawSecret, assignedSecret]) {
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret, "u"));
  }
  assertMachineOnlyOutput(result);
});

test("rejects legacy graft state even when reachable content is otherwise safe", async (t) => {
  const directory = await createRepository(t);
  await writeFile(path.join(directory, "README.md"), "Synthetic safe baseline.\n");
  commitAll(directory, "safe baseline");
  const head = run("git", ["rev-parse", "HEAD"], { cwd: directory }).stdout.trim();
  await writeFile(path.join(directory, ".git", "info", "grafts"), `${head}\n`);

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_GRAFT_FILE=1/u);
  assert.match(result.stdout, /HISTORY_UNMODIFIED_OBJECT_GRAPH=FAIL/u);
  assert.match(result.stdout, /HISTORY_COMPLETE_SCAN=FAIL/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=FAIL/u);
  assertMachineOnlyOutput(result);
});

test("rejects a shallow repository instead of claiming complete history", async (t) => {
  const source = await createRepository(t);
  await writeFile(path.join(source, "README.md"), "Synthetic first commit.\n");
  commitAll(source, "first commit");
  await writeFile(path.join(source, "README.md"), "Synthetic second commit.\n");
  commitAll(source, "second commit");

  const cloneParent = await mkdtemp(path.join(os.tmpdir(), "acme-history-shallow-"));
  t.after(async () => rm(cloneParent, { recursive: true, force: true }));
  const clone = path.join(cloneParent, "clone");
  assert.equal(run("git", [
    "clone",
    "-q",
    "--depth",
    "1",
    pathToFileURL(source).href,
    clone,
  ]).status, 0);

  const result = scan(clone);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_SHALLOW_REPOSITORY=1/u);
  assert.match(result.stdout, /HISTORY_UNMODIFIED_OBJECT_GRAPH=FAIL/u);
  assert.match(result.stdout, /HISTORY_COMPLETE_SCAN=FAIL/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=FAIL/u);
  assertMachineOnlyOutput(result);
});

test("finds opaque provider declarations and headers in reachable blobs", async (t) => {
  const directory = await createRepository(t);
  const wxoName = ["WXO", "API", "KEY"].join("_");
  const instanaHeader = ["x", "instana", "key"].join("-");
  const authorizationHeader = ["Author", "ization"].join("");
  const connectionName = ["WXO", "CONNECTION", "ACME", "SUPPORT", "API", "API", "TOKEN"].join("_");
  const apiTokenField = ["api", "token"].join("_");
  const opaqueValues = [
    "declaration", "header", "bearer", "connection", "field", "set", "set-bearer", "bracket", "environ",
  ].map(
    (value) => ["opaque", value, "fixture", "value"].join("-"),
  );
  await writeFile(path.join(directory, "settings.txt"), [
    `const ${wxoName} = "${opaqueValues[0]}";`,
    `${instanaHeader}: ${opaqueValues[1]}`,
    `${authorizationHeader}: Bearer ${opaqueValues[2]}`,
    `${connectionName} = "${opaqueValues[3]}";`,
    `${apiTokenField}: "${opaqueValues[4]}"`,
    `headers.set("${instanaHeader}", "${opaqueValues[5]}");`,
    `headers.set("${authorizationHeader}", "Bearer ${opaqueValues[6]}");`,
    `process.env["${wxoName}"] = "${opaqueValues[7]}";`,
    `os.environ["${connectionName}"] = "${opaqueValues[8]}"`,
    "",
  ].join("\n"));
  commitAll(directory, "provider credential fixture");

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_SECRET_BLOBS=1/u);
  assert.match(result.stdout, /HISTORY_SECRET_SCAN=FAIL/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=FAIL/u);
  for (const opaqueValue of opaqueValues) {
    assert.equal((result.stdout + result.stderr).includes(opaqueValue), false);
  }
  assertMachineOnlyOutput(result);
});

test("finds HTTPS URL userinfo retained only in an old commit", async (t) => {
  const directory = await createRepository(t);
  const password = ["opaque", "history", "url", "value"].join("-");
  const host = ["packages", "example", "com"].join(".");
  const url = ["https", "://synthetic-user:", password, "@", host, "/path"].join("");
  await writeFile(path.join(directory, "removed-url.txt"), `${url}\n`);
  commitAll(directory, "add URL fixture");
  await rm(path.join(directory, "removed-url.txt"));
  await writeFile(path.join(directory, "README.md"), "Current tree safe.\n");
  commitAll(directory, "remove URL fixture");

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_SECRET_BLOBS=1/u);
  assert.match(result.stdout, /HISTORY_SECRET_SCAN=FAIL/u);
  assert.equal((result.stdout + result.stderr).includes(password), false);
  assertMachineOnlyOutput(result);
});

test("fails closed for a deflated ZIP retained only in an old commit", async (t) => {
  const directory = await createRepository(t);
  const syntheticSecret = ["opaque", "archive", "fixture", "value"].join("-");
  await writeFile(
    path.join(directory, "removed-archive.zip"),
    deflatedZip("payload.txt", `SUPPORT_API_TOKEN=${syntheticSecret}\n`),
  );
  commitAll(directory, "add archive fixture");
  await rm(path.join(directory, "removed-archive.zip"));
  await writeFile(path.join(directory, "README.md"), "Current tree safe.\n");
  commitAll(directory, "remove archive fixture");

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_UNSUPPORTED_BINARY_BLOBS=1/u);
  assert.match(result.stdout, /HISTORY_BINARY_CONTENT_SCAN=FAIL/u);
  assert.match(result.stdout, /HISTORY_COMPLETE_SCAN=FAIL/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=FAIL/u);
  assert.equal((result.stdout + result.stderr).includes(syntheticSecret), false);
  assertMachineOnlyOutput(result);
});

test("finds a serialized MCSP apikey in reachable JSON", async (t) => {
  const directory = await createRepository(t);
  const jsonKey = ["api", "key"].join("");
  const opaqueValue = ["opaque", "mcsp", "history", "value"].join("-");
  await writeFile(
    path.join(directory, "request-capture.json"),
    `${JSON.stringify({ [jsonKey]: opaqueValue })}\n`,
  );
  commitAll(directory, "serialized request fixture");

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_SECRET_BLOBS=1/u);
  assert.match(result.stdout, /HISTORY_SECRET_SCAN=FAIL/u);
  assert.equal((result.stdout + result.stderr).includes(opaqueValue), false);
  assertMachineOnlyOutput(result);
});

test("scans reachable path strings for secret and private-infrastructure markers", async (t) => {
  const directory = await createRepository(t);
  const tokenLikeName = "ghp_" + "Q".repeat(30);
  const privateMarker = ["BOB-ECOSYSTEM", "SHOWCASE"].join("-");
  const sensitivePath = `${tokenLikeName}-${privateMarker}.txt`;
  await writeFile(path.join(directory, sensitivePath), "Synthetic safe content.\n");
  commitAll(directory, "sensitive path fixture");

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_PATH_SECRET_FINDINGS=1/u);
  assert.match(result.stdout, /HISTORY_PATH_PRIVATE_REFERENCE_FINDINGS=1/u);
  assert.match(result.stdout, /HISTORY_SECRET_SCAN=FAIL/u);
  assert.match(result.stdout, /HISTORY_PRIVATE_REFERENCE_SCAN=FAIL/u);
  assert.equal((result.stdout + result.stderr).includes(tokenLikeName), false);
  assert.equal((result.stdout + result.stderr).includes(privateMarker), false);
  assertMachineOnlyOutput(result);
});

test("does not inspect an ignored untracked file", async (t) => {
  const directory = await createRepository(t);
  await writeFile(path.join(directory, ".gitignore"), ".env\n");
  await writeFile(path.join(directory, "README.md"), "Tracked content is safe.\n");
  commitAll(directory, "safe tracked content");
  const ignoredSyntheticSecret = "ghp_" + "B".repeat(30);
  await writeFile(path.join(directory, ".env"), `${ignoredSyntheticSecret}\n`);

  const result = scan(directory);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_SECRET_BLOBS=0/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=PASS/u);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(ignoredSyntheticSecret, "u"));
  assertMachineOnlyOutput(result);
});

test("blocks a direct personal address in commit metadata without disclosing it", async (t) => {
  const directory = await createRepository(t);
  await writeFile(path.join(directory, "README.md"), "Initial safe content.\n");
  commitAll(directory, "safe baseline");
  const directAddress = ["person", "mail.example.net"].join("@");
  assert.equal(run("git", ["config", "user.email", directAddress], { cwd: directory }).status, 0);
  await writeFile(path.join(directory, "README.md"), "Updated safe content.\n");
  commitAll(directory, "update content");

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_DIRECT_METADATA_EMAILS=1/u);
  assert.match(result.stdout, /HISTORY_METADATA_PRIVACY_SCAN=FAIL/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=FAIL/u);
  assert.equal((result.stdout + result.stderr).includes(directAddress), false);
  assertMachineOnlyOutput(result);
});

test("finds a synthetic secret in commit and annotated-tag messages without disclosing it", async (t) => {
  const directory = await createRepository(t);
  await writeFile(path.join(directory, "README.md"), "Safe tracked content.\n");
  const commitSecret = "ghp_" + "C".repeat(30);
  commitAll(directory, `synthetic commit ${commitSecret}`);
  const tagSecret = "github_pat_" + "D".repeat(30);
  assert.equal(
    run("git", ["tag", "-a", "v0.1.0-synthetic", "-m", tagSecret], { cwd: directory }).status,
    0,
  );

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_METADATA_OBJECTS_SCANNED=2/u);
  assert.match(result.stdout, /HISTORY_METADATA_SECRET_FINDINGS=2/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=FAIL/u);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(commitSecret, "u"));
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(tagSecret, "u"));
  assertMachineOnlyOutput(result);
});

test("traverses an annotated tag reachable only through another tag", async (t) => {
  const directory = await createRepository(t);
  await writeFile(path.join(directory, "README.md"), "Safe tracked content.\n");
  commitAll(directory, "safe baseline");
  const nestedSecret = "ghp_" + "E".repeat(30);
  assert.equal(run("git", ["tag", "-a", "nested", "-m", nestedSecret], { cwd: directory }).status, 0);
  assert.equal(
    run("git", ["tag", "-a", "outer", "nested", "-m", "safe outer tag"], { cwd: directory }).status,
    0,
  );
  assert.equal(run("git", ["tag", "-d", "nested"], { cwd: directory }).status, 0);

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_METADATA_OBJECTS_SCANNED=3/u);
  assert.match(result.stdout, /HISTORY_METADATA_SECRET_FINDINGS=1/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=FAIL/u);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(nestedSecret, "u"));
  assertMachineOnlyOutput(result);
});

test("blocks historical GitLab tokens and generated evidence paths", async (t) => {
  const directory = await createRepository(t);
  const syntheticSecret = "glpat-" + "F".repeat(30);
  await writeFile(path.join(directory, "sbom.cdx.json"), `${syntheticSecret}\n`);
  commitAll(directory, "historical generated evidence fixture");
  await rm(path.join(directory, "sbom.cdx.json"));
  await writeFile(path.join(directory, "README.md"), "Current tree safe.\n");
  commitAll(directory, "remove generated evidence fixture");

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_SECRET_BLOBS=1/u);
  assert.match(result.stdout, /HISTORY_FORBIDDEN_PATHS=1/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=FAIL/u);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(syntheticSecret, "u"));
  assertMachineOnlyOutput(result);
});

test("disables Git replacement objects while scanning reachable history", async (t) => {
  const directory = await createRepository(t);
  const historicalSecret = "ghp_" + "R".repeat(30);
  await writeFile(path.join(directory, "historical-payload"), `${historicalSecret}\n`);
  commitAll(directory, "original historical fixture");
  const originalCommit = run("git", ["rev-parse", "HEAD"], { cwd: directory }).stdout.trim();

  await rm(path.join(directory, "historical-payload"));
  await writeFile(path.join(directory, "README.md"), "Synthetic safe replacement.\n");
  assert.equal(run("git", ["add", "--all"], { cwd: directory }).status, 0);
  const safeTree = run("git", ["write-tree"], { cwd: directory }).stdout.trim();
  const safeCommit = run("git", ["commit-tree", safeTree, "-m", "safe replacement"], {
    cwd: directory,
  }).stdout.trim();
  assert.equal(run("git", ["replace", originalCommit, safeCommit], { cwd: directory }).status, 0);

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_SECRET_BLOBS=1/u);
  assert.match(result.stdout, /HISTORY_REPLACE_REFS=1/u);
  assert.match(result.stdout, /HISTORY_UNMODIFIED_OBJECT_GRAPH=FAIL/u);
  assert.match(result.stdout, /HISTORY_SECRET_SCAN=FAIL/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=FAIL/u);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(historicalSecret, "u"));
  assertMachineOnlyOutput(result);
});

test("scans paths and credentials reachable only through a direct tree ref", async (t) => {
  const directory = await createRepository(t);
  await writeFile(path.join(directory, "README.md"), "Synthetic safe baseline.\n");
  commitAll(directory, "safe baseline");

  const instanaName = ["INSTANA", "AGENT", "KEY"].join("_");
  const opaqueValue = ["opaque", "tree", "fixture", "value"].join("-");
  const blob = run("git", ["hash-object", "-w", "--stdin"], {
    cwd: directory,
    input: `${instanaName}=${opaqueValue}\n`,
  }).stdout.trim();
  const tree = run("git", ["mktree"], {
    cwd: directory,
    input: `100644 blob ${blob}\tcredentials.json\n`,
  }).stdout.trim();
  assert.equal(run("git", ["update-ref", "refs/tags/tree-only", tree], { cwd: directory }).status, 0);

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_SECRET_BLOBS=1/u);
  assert.match(result.stdout, /HISTORY_FORBIDDEN_PATHS=1/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=FAIL/u);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(opaqueValue, "u"));
  assertMachineOnlyOutput(result);
});

test("enforces case-folded paths, literal dotfiles, and case-insensitive content markers", async (t) => {
  const directory = await createRepository(t);
  const lowercaseUserPath = ["c:", "users", "fixture-user", "asset.txt"].join("\\");
  const legacyUserPath = ["D:", "Documents and Settings", "fixture-user", "asset.txt"].join("\\");
  const rootUserPath = ["", "root", "fixture-user", "asset.txt"].join("/");
  const uncUserPath = ["", "", "synthetic-host", "private-share", "asset.txt"].join("\\");
  const uppercasePrivateMarker = ["BOB-ECOSYSTEM", "SHOWCASE"].join("-");
  await writeFile(path.join(directory, ".npmrc"), "synthetic placeholder\n");
  await mkdir(path.join(directory, "Showcase"));
  await writeFile(path.join(directory, "Showcase", "README.md"), "Synthetic fixture.\n");
  await writeFile(
    path.join(directory, "README.md"),
    `${lowercaseUserPath}\n${legacyUserPath}\n${rootUserPath}\n${uncUserPath}\n${uppercasePrivateMarker}\n`,
  );
  commitAll(directory, "historical policy fixtures");

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_ABSOLUTE_PATH_SCAN=FAIL/u);
  assert.match(result.stdout, /HISTORY_PRIVATE_REFERENCE_SCAN=FAIL/u);
  assert.match(result.stdout, /HISTORY_FORBIDDEN_PATHS=2/u);
  assert.match(result.stdout, /HISTORY_FORBIDDEN_PATH_SCAN=FAIL/u);
  assertMachineOnlyOutput(result);
});

test("applies shared provider, URL-userinfo, and escaped-path policy to history", async (t) => {
  const directory = await createRepository(t);
  const providerName = ["INSTANA", "AGENT", "KEY"].join("_");
  const headerName = ["x", "instana", "key"].join("-");
  const opaqueValue = ["opaque", "historical", "fixture", "value"].join("-");
  const unsafeProviderValues = [
    `${providerName} = "str${opaqueValue}"`,
    `${providerName} = "string-${opaqueValue}"`,
    `${providerName} = "optional-${opaqueValue}"`,
    `${providerName} = "none-${opaqueValue}"`,
    `ENV ${providerName}=${opaqueValue}`,
    `- ${providerName}=${opaqueValue}`,
    `curl -H "${headerName}: ${opaqueValue}" https://acme.example`,
    `os.environ.setdefault("${providerName}", "${opaqueValue}")`,
    `headers.append("${headerName}", "${opaqueValue}")`,
    `headers.add("${headerName}", "${opaqueValue}")`,
  ];
  for (const value of unsafeProviderValues) {
    assert.equal(containsOpaqueProviderCredential(value), true);
  }
  const opaqueUrl = [
    "https", "://", "account", ":", opaqueValue, "@", "service.example.invalid", "/path",
  ].join("");
  assert.equal(containsHighConfidenceSecret(opaqueUrl), true);
  const escapedDrive = ["C:", "\\\\", "Users", "\\\\", "history-user", "\\\\", "file.txt"].join("");
  const escapedUnc = ["\\\\\\\\", "history-host", "\\\\", "private-share", "\\\\", "file.txt"].join("");
  assert.equal(containsAbsoluteUserPath(escapedDrive), true);
  assert.equal(containsAbsoluteUserPath(escapedUnc), true);

  await writeFile(path.join(directory, "unsafe-provider.txt"), `${unsafeProviderValues.join("\n")}\n${opaqueUrl}\n`);
  await writeFile(path.join(directory, "unsafe-paths.txt"), `${escapedDrive}\n${escapedUnc}\n`);
  commitAll(directory, "shared content-policy fixtures");

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_SECRET_BLOBS=1/u);
  assert.match(result.stdout, /HISTORY_ABSOLUTE_PATH_BLOBS=1/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=FAIL/u);
  assert.equal((result.stdout + result.stderr).includes(opaqueValue), false);
  assertMachineOnlyOutput(result);
});

test("keeps exact annotations, multiline continuations, references, placeholders, and synthetic URLs calibrated", async (t) => {
  const directory = await createRepository(t);
  const providerName = ["WXO", "API", "KEY"].join("_");
  const tokenField = ["api", "token"].join("_");
  const headerName = ["x", "instana", "key"].join("-");
  const placeholder = ["<", "load-at-runtime", ">"].join("");
  const safeValues = [
    `${providerName} = str`,
    `${providerName} = string`,
    `${providerName} = Optional[str]`,
    `${providerName} = None`,
    `${tokenField} = (\n  load_runtime_value()\n)`,
    `${providerName} = process.env.${providerName}`,
    `headers.set("${headerName}", config.instanaKey)`,
    `headers.append("${headerName}", environment.instanaKey)`,
    `os.environ.setdefault("${providerName}", os.environ.get("RUNTIME_KEY"))`,
    `ENV ${providerName}=${placeholder}`,
    `- ${providerName}=${"$" + "{RUNTIME_KEY}"}`,
    `curl -H "${headerName}: ${placeholder}" https://acme.example`,
  ];
  for (const value of safeValues) {
    assert.equal(containsOpaqueProviderCredential(value), false, value);
  }
  const fixtureUrl = ["https", "://", "user", ":", "password", "@", "service.example.invalid", "/path"].join("");
  const expressionUrl = ["https", "://", "${RUNTIME_USER}", ":", "${RUNTIME_PASS}", "@", "service.example.invalid", "/path"].join("");
  assert.equal(containsHighConfidenceSecret(fixtureUrl), false);
  assert.equal(containsHighConfidenceSecret(expressionUrl), false);

  await writeFile(path.join(directory, "safe-policy.txt"), `${safeValues.join("\n")}\n${fixtureUrl}\n${expressionUrl}\n`);
  commitAll(directory, "safe content-policy calibration");
  const result = scan(directory);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /HISTORY_SECRET_SCAN=PASS/u);
  assert.match(result.stdout, /HISTORY_ABSOLUTE_PATH_SCAN=PASS/u);
  assert.match(result.stdout, /HISTORY_RELEASE_SCAN=PASS/u);
  assertMachineOnlyOutput(result);
});
