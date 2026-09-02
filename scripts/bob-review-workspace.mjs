import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";

const EXACT_SHA = /^[0-9a-f]{40}$/u;
const REGULAR_GIT_MODES = new Set(["100644", "100755"]);
const FORBIDDEN_CONTROL_NAMES = new Set([".agents", ".bob", ".bobignore", ".claude"]);
const ROOT_PUBLIC_INSTRUCTIONS = "AGENTS.md";
const MAX_TRACKED_FILES = 20_000;
const MAX_TRACKED_BYTES = 1024 * 1024 * 1024;
const SNAPSHOT_DOMAIN = "acme-bob-review-workspace-v1\0";

function isolatedGitEnvironment(environment = process.env) {
  const inheritedNames = new Set([
    "COMSPEC",
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "PATH",
    "PATHEXT",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TERM",
    "TMP",
    "TMPDIR",
    "WINDIR",
  ]);
  const inherited = {};
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value === "string" && inheritedNames.has(name.toUpperCase())) {
      inherited[name] = value;
    }
  }
  return {
    ...inherited,
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
}

function runGit(workspace, args, { allowFailure = false } = {}) {
  const result = spawnSync(
    "git",
    ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args],
    {
      cwd: workspace,
      encoding: null,
      env: isolatedGitEnvironment(),
      maxBuffer: 64 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    },
  );
  if (result.error || !Buffer.isBuffer(result.stdout) || !Buffer.isBuffer(result.stderr)) {
    throw new Error("Unable to inspect the candidate Git repository.");
  }
  if (!allowFailure && result.status !== 0) {
    throw new Error("Unable to inspect the candidate Git repository.");
  }
  return result;
}

function decodeGitOutput(buffer, label) {
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
  return decoded;
}

function normalizeFilesystemPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function absoluteFromGitPath(root, gitPath) {
  if (
    gitPath === ""
    || gitPath.includes("\\")
    || gitPath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("The candidate index contains an unsafe path.");
  }
  const absolute = path.resolve(root, ...gitPath.split("/"));
  if (absolute === root || !isContained(root, absolute)) {
    throw new Error("The candidate index contains a path outside the workspace.");
  }
  return absolute;
}

function assertPermittedControlPath(gitPath) {
  const segments = gitPath.split("/");
  for (const segment of segments) {
    const normalized = segment.toLowerCase();
    if (FORBIDDEN_CONTROL_NAMES.has(normalized)
      || normalized === ".bobrules"
      || normalized.startsWith(".bobrules-")) {
      throw new Error("The candidate contains a prohibited Bob control path.");
    }
    if (normalized === "agents.md" && gitPath !== ROOT_PUBLIC_INSTRUCTIONS) {
      throw new Error("Only the tracked root AGENTS.md instruction file is permitted.");
    }
  }
}

function trackedManifest(workspace) {
  const output = runGit(workspace, ["ls-files", "--stage", "-z"]).stdout;
  const decoded = decodeGitOutput(output, "The candidate index");
  const entries = [];
  const paths = new Set();

  for (const record of decoded.split("\0")) {
    if (record === "") continue;
    const separator = record.indexOf("\t");
    const metadata = separator < 0 ? "" : record.slice(0, separator);
    const match = /^([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-3])$/u.exec(metadata);
    const gitPath = separator < 0 ? "" : record.slice(separator + 1);
    if (!match || match[3] !== "0" || paths.has(gitPath)) {
      throw new Error("The candidate index is malformed or unresolved.");
    }
    if (match[1] === "160000") {
      throw new Error("Git submodules are outside the Bob review boundary.");
    }
    if (match[1] === "120000") {
      throw new Error("Symbolic links are outside the Bob review boundary.");
    }
    if (!REGULAR_GIT_MODES.has(match[1])) {
      throw new Error("The candidate contains an unsupported Git entry type.");
    }
    absoluteFromGitPath(workspace, gitPath);
    assertPermittedControlPath(gitPath);
    paths.add(gitPath);
    entries.push({ gitPath, mode: match[1] });
  }

  if (entries.length === 0 || entries.length > MAX_TRACKED_FILES) {
    throw new Error("The candidate tracked-file count is outside the review boundary.");
  }
  entries.sort((left, right) => Buffer.from(left.gitPath).compare(Buffer.from(right.gitPath)));
  return { entries, paths };
}

function assertOrdinaryIndexVisibility(workspace, expectedPaths) {
  const output = runGit(workspace, ["ls-files", "-v", "-z"]).stdout;
  const decoded = decodeGitOutput(output, "The candidate index flags");
  const observed = new Set();
  for (const record of decoded.split("\0")) {
    if (record === "") continue;
    if (!record.startsWith("H ")) {
      throw new Error("Assume-unchanged and skip-worktree entries are outside the Bob review boundary.");
    }
    const gitPath = record.slice(2);
    if (!expectedPaths.has(gitPath) || observed.has(gitPath)) {
      throw new Error("The candidate index flags are inconsistent with its manifest.");
    }
    observed.add(gitPath);
  }
  if (observed.size !== expectedPaths.size) {
    throw new Error("The candidate index flags are inconsistent with its manifest.");
  }
}

function trackedDirectorySet(entries) {
  const directories = new Set();
  for (const { gitPath } of entries) {
    const segments = gitPath.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return directories;
}

function sameManifest(left, right) {
  return left.length === right.length && left.every((entry, index) => (
    entry.gitPath === right[index].gitPath && entry.mode === right[index].mode
  ));
}

async function assertCanonicalEntry(root, absolute, metadata) {
  if (metadata.isSymbolicLink()) {
    throw new Error("Symbolic links are outside the Bob review boundary.");
  }
  const canonical = await realpath(absolute);
  if (!isContained(root, canonical)) {
    throw new Error("The candidate contains an entry outside the workspace.");
  }
}

async function inventoryWorkspace(root, trackedEntries) {
  const trackedFiles = new Set(trackedEntries.map(({ gitPath }) => gitPath));
  const trackedDirectories = trackedDirectorySet(trackedEntries);
  const observedFiles = new Set();

  async function visit(directory, relativeDirectory = "") {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const child of children) {
      const gitPath = relativeDirectory === "" ? child.name : `${relativeDirectory}/${child.name}`;
      if (relativeDirectory === "" && child.name === ".git") {
        const gitMetadata = await lstat(path.join(directory, child.name));
        if (gitMetadata.isSymbolicLink() || (!gitMetadata.isDirectory() && !gitMetadata.isFile())) {
          throw new Error("The candidate Git metadata boundary is unsafe.");
        }
        continue;
      }

      const absolute = path.join(directory, child.name);
      const metadata = await lstat(absolute);
      await assertCanonicalEntry(root, absolute, metadata);
      if (metadata.isDirectory()) {
        if (!trackedDirectories.has(gitPath)) {
          throw new Error("The candidate workspace contains an untracked or ignored directory.");
        }
        await visit(absolute, gitPath);
      } else if (metadata.isFile()) {
        if (!trackedFiles.has(gitPath)) {
          throw new Error("The candidate workspace contains an untracked or ignored file.");
        }
        observedFiles.add(gitPath);
      } else {
        throw new Error("The candidate workspace contains an unsupported special entry.");
      }
    }
  }

  await visit(root);
  if (observedFiles.size !== trackedFiles.size) {
    throw new Error("The candidate workspace does not match its tracked-file manifest.");
  }
  for (const gitPath of trackedFiles) {
    if (!observedFiles.has(gitPath)) {
      throw new Error("The candidate workspace does not match its tracked-file manifest.");
    }
  }
}

async function hashRegularFile(hash, root, entry) {
  const absolute = absoluteFromGitPath(root, entry.gitPath);
  const before = await lstat(absolute, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error("The candidate workspace changed during snapshot creation.");
  }
  await assertCanonicalEntry(root, absolute, before);
  if (before.size > BigInt(MAX_TRACKED_BYTES)) {
    throw new Error("A candidate file exceeds the review byte boundary.");
  }
  if (process.platform !== "win32") {
    const executable = (before.mode & 0o111n) !== 0n;
    if (executable !== (entry.mode === "100755")) {
      throw new Error("The candidate executable mode does not match its Git index.");
    }
  }

  const flags = process.platform === "win32"
    ? fsConstants.O_RDONLY
    : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
  const handle = await open(absolute, flags);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error("The candidate workspace changed during snapshot creation.");
    }

    const pathBytes = Buffer.from(entry.gitPath, "utf8");
    hash.update(String(pathBytes.length)).update("\0").update(pathBytes).update("\0");
    hash.update(entry.mode).update("\0");
    hash.update(String(opened.size)).update("\0");

    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    hash.update("\0");

    const after = await handle.stat({ bigint: true });
    if (
      after.dev !== opened.dev
      || after.ino !== opened.ino
      || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs
      || BigInt(position) !== opened.size
    ) {
      throw new Error("The candidate workspace changed during snapshot creation.");
    }
  } finally {
    await handle.close();
  }
}

async function assertExactGitState(workspace, expectedSha) {
  if (typeof expectedSha !== "string" || !EXACT_SHA.test(expectedSha)) {
    throw new Error("The Bob review candidate must be an exact lowercase 40-character SHA.");
  }

  const topLevel = decodeGitOutput(
    runGit(workspace, ["rev-parse", "--show-toplevel"]).stdout,
    "The candidate repository root",
  ).trim();
  if (topLevel === "" || /[\r\n]/u.test(topLevel)) {
    throw new Error("The candidate repository root is invalid.");
  }
  const canonicalTopLevel = await realpath(topLevel);
  if (normalizeFilesystemPath(canonicalTopLevel) !== normalizeFilesystemPath(workspace)) {
    throw new Error("The Bob review workspace must be the candidate repository root.");
  }

  const resolved = decodeGitOutput(
    runGit(workspace, ["rev-parse", "--verify", "--end-of-options", `${expectedSha}^{commit}`]).stdout,
    "The candidate commit identity",
  ).trim();
  const head = decodeGitOutput(
    runGit(workspace, ["rev-parse", "--verify", "HEAD"]).stdout,
    "The candidate HEAD identity",
  ).trim();
  if (resolved !== expectedSha || head !== expectedSha) {
    throw new Error("The candidate workspace does not match the exact approved SHA.");
  }

  const replacementRefs = runGit(
    workspace,
    ["for-each-ref", "--format=%(refname)", "refs/replace"],
  ).stdout;
  if (replacementRefs.length !== 0) {
    throw new Error("Git replacement references are outside the Bob review boundary.");
  }
}

function assertCleanGitStatus(workspace) {
  const status = runGit(
    workspace,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"],
  ).stdout;
  if (status.length !== 0) throw new Error("The candidate workspace must be clean.");
}

function assertTrustedRootInstructions(workspace, expectedRootAgentsBlob, trackedPaths) {
  if (expectedRootAgentsBlob === undefined) return;
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(expectedRootAgentsBlob)) {
    throw new Error("The trusted root AGENTS.md blob identity is invalid.");
  }
  if (!trackedPaths.has(ROOT_PUBLIC_INSTRUCTIONS)) {
    throw new Error("The candidate must contain the trusted root AGENTS.md file.");
  }
  const actual = decodeGitOutput(
    runGit(workspace, ["rev-parse", "--verify", `HEAD:${ROOT_PUBLIC_INSTRUCTIONS}`]).stdout,
    "The candidate root AGENTS.md blob identity",
  ).trim();
  if (actual !== expectedRootAgentsBlob) {
    throw new Error("The candidate root AGENTS.md does not match the trusted controller.");
  }
}

async function resolveWorkspaceRoot(workspace) {
  if (typeof workspace !== "string" || workspace.trim() === "" || workspace.includes("\0")) {
    throw new Error("A candidate workspace path is required.");
  }
  const requestedRoot = path.resolve(workspace);
  const rootMetadata = await lstat(requestedRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error("The candidate workspace root must be a real directory.");
  }
  const root = await realpath(requestedRoot);
  let gitMetadata;
  try {
    gitMetadata = await lstat(path.join(root, ".git"));
  } catch {
    throw new Error("The candidate workspace must have an explicit Git metadata boundary.");
  }
  if (gitMetadata.isSymbolicLink() || (!gitMetadata.isDirectory() && !gitMetadata.isFile())) {
    throw new Error("The candidate Git metadata boundary is unsafe.");
  }
  return root;
}

async function createSnapshot(root, entries) {
  const hash = createHash("sha256");
  hash.update(SNAPSHOT_DOMAIN);
  let totalBytes = 0n;
  for (const entry of entries) {
    const metadata = await lstat(absoluteFromGitPath(root, entry.gitPath), { bigint: true });
    totalBytes += metadata.size;
    if (totalBytes > BigInt(MAX_TRACKED_BYTES)) {
      throw new Error("The candidate workspace exceeds the review byte boundary.");
    }
    await hashRegularFile(hash, root, entry);
  }
  return { snapshotSha256: hash.digest("hex"), trackedBytes: Number(totalBytes) };
}

export async function assertSafeBobReviewWorkspace(workspace, {
  expectedSha,
  expectedRootAgentsBlob,
} = {}) {
  const root = await resolveWorkspaceRoot(workspace);
  await assertExactGitState(root, expectedSha);
  const manifest = trackedManifest(root);
  assertTrustedRootInstructions(root, expectedRootAgentsBlob, manifest.paths);
  assertOrdinaryIndexVisibility(root, manifest.paths);
  assertCleanGitStatus(root);
  await inventoryWorkspace(root, manifest.entries);
  const snapshot = await createSnapshot(root, manifest.entries);

  await assertExactGitState(root, expectedSha);
  const finalManifest = trackedManifest(root);
  assertTrustedRootInstructions(root, expectedRootAgentsBlob, finalManifest.paths);
  if (!sameManifest(manifest.entries, finalManifest.entries)) {
    throw new Error("The candidate index changed during workspace verification.");
  }
  assertOrdinaryIndexVisibility(root, finalManifest.paths);
  assertCleanGitStatus(root);
  await inventoryWorkspace(root, finalManifest.entries);

  return Object.freeze({
    candidateSha: expectedSha,
    snapshotSha256: snapshot.snapshotSha256,
    trackedFiles: Object.freeze(manifest.entries.map(({ gitPath }) => gitPath)),
    trackedFileCount: manifest.entries.length,
    trackedBytes: snapshot.trackedBytes,
  });
}

export async function snapshotBobReviewWorkspace(workspace) {
  const root = await resolveWorkspaceRoot(workspace);
  const manifest = trackedManifest(root);
  await inventoryWorkspace(root, manifest.entries);
  return (await createSnapshot(root, manifest.entries)).snapshotSha256;
}
