import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_NAME = "clean-archive-verify.json";
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const WINDOWS_ARCHIVE_SOURCE_PATH_BUDGET = 120;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

const RESET_TARGETS = Object.freeze([
  "apps/portal/.next",
  "apps/portal/coverage",
  "apps/portal/next-env.d.ts",
  "apps/portal/tsconfig.tsbuildinfo",
  "services/support-api/coverage",
  "services/support-api/dist",
  "services/support-api/tsconfig.tsbuildinfo",
  "agents/store_support_agent/.generated",
  "agents/store_support_agent/.pytest_cache",
  "agents/store_support_agent/.wxo-local-config",
  "coverage",
  "license-inventory.json",
  "playwright-report",
  "playwright-report-built",
  "sbom.cdx.json",
  "test-results",
  "test-results-built",
]);

const UNINSTALL_TARGETS = Object.freeze([
  ...RESET_TARGETS,
  "agents/store_support_agent/.venv",
  "apps/portal/node_modules",
  "services/support-api/node_modules",
  "tests/e2e/node_modules",
  "node_modules",
]);

function normalized(value, platform = process.platform) {
  const resolved = path.resolve(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function isStrictlyContained(root, candidate, platform = process.platform) {
  const rootValue = normalized(root, platform);
  const candidateValue = normalized(candidate, platform);
  const relative = path.relative(rootValue, candidateValue);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

export function archiveSourcePathWithinBudget(runDirectory, platform = process.platform) {
  if (platform !== "win32") return true;
  return path.win32.join(runDirectory, "source").length <= WINDOWS_ARCHIVE_SOURCE_PATH_BUDGET;
}

function validatePortablePath(candidate) {
  if (
    typeof candidate !== "string"
    || candidate === ""
    || candidate.includes("\\")
    || /[\u0000-\u001F\u007F]/u.test(candidate)
    || path.posix.isAbsolute(candidate)
  ) {
    throw new Error("archive contains a non-portable path");
  }
  const segments = candidate.split("/");
  if (segments.some((segment) => (
    segment === ""
    || segment === "."
    || segment === ".."
    || /[<>:"|?*]/u.test(segment)
    || /[ .]$/u.test(segment)
    || WINDOWS_RESERVED_NAME.test(segment)
  ))) {
    throw new Error("archive contains a non-portable path");
  }
  return candidate;
}

export function parseTreeManifest(serialized) {
  const buffer = Buffer.isBuffer(serialized) ? serialized : Buffer.from(serialized);
  const text = buffer.toString("utf8");
  if (text.includes("\uFFFD")) throw new Error("Git tree is not valid UTF-8");
  const entries = [];
  const caseInsensitivePaths = new Set();
  for (const row of text.split("\0")) {
    if (row === "") continue;
    const separator = row.indexOf("\t");
    const metadata = separator < 0 ? "" : row.slice(0, separator);
    const candidate = separator < 0 ? "" : row.slice(separator + 1);
    const match = /^(100644|100755) blob ([0-9a-f]{40,64}) +([0-9]+)$/u.exec(metadata);
    if (match === null) throw new Error("archive tree contains a non-regular entry");
    const portablePath = validatePortablePath(candidate);
    const folded = portablePath.toLowerCase();
    if (caseInsensitivePaths.has(folded)) {
      throw new Error("archive tree contains a case-insensitive path collision");
    }
    caseInsensitivePaths.add(folded);
    entries.push({
      path: portablePath,
      mode: match[1],
      objectId: match[2],
      size: Number(match[3]),
    });
  }
  if (entries.length === 0) throw new Error("archive tree is empty");
  return entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function safeEnvironment(environment = process.env, gitConfigPath) {
  const allowed = new Set([
    "APPDATA", "CI", "COLORTERM", "COMSPEC", "FORCE_COLOR", "HOME", "LANG",
    "LANGUAGE", "LC_ALL", "LOCALAPPDATA", "NODE_EXTRA_CA_CERTS", "NO_COLOR",
    "PATH", "PATHEXT", "PLAYWRIGHT_BROWSERS_PATH", "SSL_CERT_DIR", "SSL_CERT_FILE",
    "SYSTEMROOT", "TEMP", "TERM", "TMP", "TMPDIR", "USERPROFILE", "UV_CACHE_DIR",
    "WINDIR", "XDG_CACHE_HOME", "XDG_DATA_HOME",
  ]);
  const result = {};
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value === "string" && allowed.has(name.toUpperCase())) result[name] = value;
  }
  const gitIsolation = {
    GIT_CONFIG_GLOBAL: gitConfigPath ?? (process.platform === "win32" ? "NUL" : os.devNull),
    GIT_CONFIG_NOSYSTEM: "1",
  };
  return {
    ...result,
    ...gitIsolation,
    AGENT_MODE: "stub",
    DO_NOT_TRACK: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
    NEXT_TELEMETRY_DISABLED: "1",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_USERCONFIG: os.devNull,
    OTEL_ENABLED: "0",
    PIP_CONFIG_FILE: os.devNull,
    SUPPORT_API_TOKEN: "",
    UV_NO_CONFIG: "1",
  };
}

function isNpmCliPath(value) {
  return typeof value === "string"
    && path.isAbsolute(value)
    && /(?:^|[\\/])npm-cli\.js$/iu.test(value);
}

export function resolveNpmInvocation(
  args,
  { environment = process.env, platform = process.platform, nodeExecutable = process.execPath } = {},
) {
  if (isNpmCliPath(environment.npm_execpath)) {
    return { command: nodeExecutable, args: [environment.npm_execpath, ...args] };
  }
  if (platform === "win32") {
    const comspec = environment.ComSpec ?? environment.COMSPEC;
    if (typeof comspec !== "string" || !path.win32.isAbsolute(comspec)) {
      throw new Error("ComSpec is unavailable for npm on Windows");
    }
    return { command: comspec, args: ["/d", "/s", "/c", "npm.cmd", ...args] };
  }
  return { command: "npm", args };
}

function execute(command, args, {
  cwd,
  environment = process.env,
  gitConfigPath,
  timeoutMs = 20 * 60_000,
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: safeEnvironment(environment, gitConfigPath),
    maxBuffer: MAX_OUTPUT_BYTES,
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
  });
  return { status: result.status, signal: result.signal, error: result.error };
}

function runRequired(id, command, args, options) {
  const result = execute(command, args, options);
  if (result.error || result.status !== 0 || result.signal) {
    const error = new Error(`${id} failed`);
    error.stepId = id;
    throw error;
  }
}

function runGit(id, args, options) {
  runRequired(id, "git", args, options);
}

function runNpm(id, args, options) {
  const invocation = resolveNpmInvocation(args, { environment: options.environment });
  runRequired(id, invocation.command, invocation.args, options);
}

function captureGit(args, {
  cwd,
  environment = process.env,
  encoding = "utf8",
  gitConfigPath,
  input,
} = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding,
    env: safeEnvironment(environment, gitConfigPath),
    input,
    maxBuffer: MAX_OUTPUT_BYTES,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error("Git preflight failed");
  return result.stdout;
}

async function verifiedRepositoryRoot(root, environment) {
  const absolute = path.resolve(root);
  const actual = await realpath(absolute);
  if (normalized(actual) !== normalized(absolute)) throw new Error("repository root is linked");
  const manifest = JSON.parse(await readFile(path.join(actual, "package.json"), "utf8"));
  if (manifest?.name !== "acme-agentic-sdlc-lab") throw new Error("unexpected repository root");
  const topLevel = String(captureGit(["rev-parse", "--show-toplevel"], {
    cwd: actual,
    environment,
  })).trim();
  if (normalized(await realpath(topLevel)) !== normalized(actual)) {
    throw new Error("Git top-level differs from repository root");
  }
  return actual;
}

function captureSourceState(root, environment, gitConfigPath) {
  const replaceRefs = String(captureGit([
    "for-each-ref",
    "--format=%(refname)",
    "refs/replace/",
  ], { cwd: root, environment, gitConfigPath })).trim();
  if (replaceRefs !== "") throw new Error("source repository contains replacement refs");

  const shallow = String(captureGit(["rev-parse", "--is-shallow-repository"], {
    cwd: root,
    environment,
    gitConfigPath,
  })).trim();
  if (shallow !== "false") throw new Error("source repository history is shallow or indeterminate");

  const graftValue = String(captureGit(["rev-parse", "--git-path", "info/grafts"], {
    cwd: root,
    environment,
    gitConfigPath,
  })).trim();
  if (graftValue === "" || /[\r\n]/u.test(graftValue)) throw new Error("source graft path is invalid");
  const graftPath = path.isAbsolute(graftValue) ? graftValue : path.resolve(root, graftValue);
  try {
    lstatSync(graftPath);
    throw new Error("source repository contains a graft file");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const sha = String(captureGit(["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd: root,
    environment,
    gitConfigPath,
  })).trim();
  if (!/^[0-9a-f]{40,64}$/u.test(sha)) throw new Error("invalid source commit");
  const status = captureGit(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: root, environment, gitConfigPath, encoding: null },
  );
  if (!Buffer.isBuffer(status) || status.length !== 0) throw new Error("source tree is not clean");
  const tree = captureGit(["ls-tree", "-rlz", "--full-tree", sha], {
    cwd: root,
    environment,
    gitConfigPath,
    encoding: null,
  });
  return { sha, manifest: parseTreeManifest(tree) };
}

async function prepareWorkDirectory(root, temporaryDirectory) {
  if (typeof temporaryDirectory !== "string" || temporaryDirectory.trim() === "") {
    throw new TypeError("archive temporary root must be a non-empty path");
  }
  const requestedWorkRoot = path.resolve(temporaryDirectory);
  const workMetadata = await lstat(requestedWorkRoot);
  if (!workMetadata.isDirectory() || workMetadata.isSymbolicLink()) {
    throw new Error("archive temporary root is unsafe");
  }
  const actualWorkRoot = await realpath(requestedWorkRoot);
  if (normalized(actualWorkRoot) !== normalized(requestedWorkRoot)) {
    throw new Error("archive temporary root is linked");
  }
  if (normalized(actualWorkRoot) === normalized(path.parse(actualWorkRoot).root)) {
    throw new Error("archive temporary root is too broad");
  }
  if (
    normalized(actualWorkRoot) === normalized(root)
    || isStrictlyContained(root, actualWorkRoot)
  ) {
    throw new Error("archive temporary root must be outside the repository");
  }
  if (process.platform === "win32" && /^(?:\\\\|\/\/)/u.test(actualWorkRoot)) {
    throw new Error("archive temporary root must be local on Windows");
  }
  const projectedRun = path.join(actualWorkRoot, "acme-av-XXXXXX");
  if (!archiveSourcePathWithinBudget(projectedRun)) {
    throw new Error("archive temporary path exceeds the Windows safety budget");
  }
  const runDirectory = await mkdtemp(path.join(actualWorkRoot, "acme-av-"));
  const runMetadata = await lstat(runDirectory);
  if (!runMetadata.isDirectory() || runMetadata.isSymbolicLink()) {
    throw new Error("archive run path is unsafe");
  }
  const actualRun = await realpath(runDirectory);
  if (normalized(actualRun) !== normalized(runDirectory)) {
    throw new Error("archive run path is linked");
  }
  if (!isStrictlyContained(actualWorkRoot, actualRun)) {
    throw new Error("archive run path escapes temporary root");
  }
  if (!archiveSourcePathWithinBudget(actualRun)) {
    throw new Error("archive run path exceeds the Windows safety budget");
  }
  return {
    workRoot: actualWorkRoot,
    runDirectory: actualRun,
    runIdentity: { dev: runMetadata.dev, ino: runMetadata.ino },
  };
}

async function safeRemoveRun(workRoot, runDirectory, expectedIdentity) {
  const workMetadata = await lstat(workRoot);
  if (!workMetadata.isDirectory() || workMetadata.isSymbolicLink()) {
    throw new Error("archive run cleanup root is unsafe");
  }
  const actualWorkRoot = await realpath(workRoot);
  if (normalized(actualWorkRoot) !== normalized(workRoot)) {
    throw new Error("archive run cleanup root changed");
  }
  const metadata = await lstat(runDirectory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("archive run cleanup target is unsafe");
  }
  if (
    expectedIdentity !== undefined
    && (metadata.dev !== expectedIdentity.dev || metadata.ino !== expectedIdentity.ino)
  ) {
    throw new Error("archive run cleanup target changed");
  }
  const actual = await realpath(runDirectory);
  if (normalized(actual) !== normalized(runDirectory)) {
    throw new Error("archive run cleanup target is linked");
  }
  if (!isStrictlyContained(actualWorkRoot, actual)) {
    throw new Error("archive run cleanup escapes temporary root");
  }
  await rm(actual, { recursive: true, force: false, maxRetries: 3 });
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function extractedManifest(root) {
  const entries = [];
  async function visit(directory, relative = "") {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = path.join(directory, name);
      const candidate = relative === "" ? name : `${relative}/${name}`;
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new Error("extracted archive contains a link");
      if (metadata.isDirectory()) await visit(absolute, candidate);
      else if (metadata.isFile()) entries.push({
        path: candidate,
        size: metadata.size,
        executable: process.platform === "win32" ? null : (metadata.mode & 0o111) !== 0,
      });
      else throw new Error("extracted archive contains a special file");
    }
  }
  await visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

export async function verifyExtractedTree(
  sourceDirectory,
  expected,
  repositoryRoot,
  environment = process.env,
  gitConfigPath,
) {
  const actual = await extractedManifest(sourceDirectory);
  const projected = expected.map(({ path: candidate, size, mode }) => ({
    path: candidate,
    size,
    executable: process.platform === "win32" ? null : mode === "100755",
  }));
  if (JSON.stringify(actual) !== JSON.stringify(projected)) {
    const mismatch = Math.max(
      0,
      actual.findIndex((entry, index) => (
        entry.path !== projected[index]?.path || entry.size !== projected[index]?.size
      )),
    );
    throw new Error(
      `extracted archive differs from the committed tree at entry ${mismatch}: `
      + `${JSON.stringify(projected[mismatch])} != ${JSON.stringify(actual[mismatch])}`,
    );
  }
  const absolutePaths = projected.map((entry) => path.resolve(
    sourceDirectory,
    ...entry.path.split("/"),
  ));
  if (absolutePaths.some((candidate) => !isStrictlyContained(sourceDirectory, candidate))) {
    throw new Error("archive hash target escapes extraction root");
  }
  const hashes = String(captureGit(
    ["hash-object", "--no-filters", "--stdin-paths"],
    {
      cwd: repositoryRoot,
      environment,
      gitConfigPath,
      input: `${absolutePaths.join("\n")}\n`,
    },
  )).trim().split(/\r?\n/u);
  if (
    hashes.length !== expected.length
    || hashes.some((hash, index) => hash !== expected[index].objectId)
  ) {
    throw new Error("extracted archive content hash differs from the committed tree");
  }
}

async function assertTargetsAbsent(root, targets) {
  for (const relative of targets) {
    const candidate = path.resolve(root, ...relative.split("/"));
    if (!isStrictlyContained(root, candidate)) throw new Error("cleanup assertion escapes archive root");
    try {
      await lstat(candidate);
      throw new Error("cleanup left generated state");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function assertArchiveGitClean(root, environment, gitConfigPath) {
  const status = captureGit(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: root, environment, gitConfigPath, encoding: null },
  );
  if (!Buffer.isBuffer(status) || status.length !== 0) {
    throw new Error("archive lifecycle changed source files");
  }
}

async function initializeArchiveRepository(
  sourceDirectory,
  environment,
  gitConfigPath,
  templateDirectory,
) {
  runGit("archive-git-init", ["init", "-q", `--template=${templateDirectory}`], {
    cwd: sourceDirectory,
    environment,
    gitConfigPath,
  });
  for (const [name, value] of [
    ["user.name", "Acme Archive Verification"],
    ["user.email", "archive-verifier@acme.example"],
    ["commit.gpgsign", "false"],
    ["core.autocrlf", "false"],
    ["core.hooksPath", templateDirectory],
  ]) {
    runGit("archive-git-config", ["config", "--local", name, value], {
      cwd: sourceDirectory,
      environment,
      gitConfigPath,
    });
  }
  runGit("archive-git-add", ["add", "--all"], {
    cwd: sourceDirectory,
    environment,
    gitConfigPath,
  });
  runGit("archive-git-commit", ["commit", "-q", "-m", "verify exact release archive"], {
    cwd: sourceDirectory,
    environment,
    gitConfigPath,
  });
}

export async function verifyCleanArchive({
  root = REPOSITORY_ROOT,
  environment = process.env,
  cleanupRun = safeRemoveRun,
  temporaryDirectory = os.tmpdir(),
} = {}) {
  if (typeof cleanupRun !== "function") throw new TypeError("cleanupRun must be a function");
  const repositoryRoot = await verifiedRepositoryRoot(root, environment);
  const reportPath = path.join(repositoryRoot, REPORT_NAME);
  try {
    await lstat(reportPath);
    throw new Error("clean archive report already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const before = captureSourceState(repositoryRoot, environment);
  const work = await prepareWorkDirectory(repositoryRoot, temporaryDirectory);
  const gitConfigPath = path.join(work.runDirectory, "empty.gitconfig");
  const gitTemplateDirectory = path.join(work.runDirectory, "empty-git-template");
  const archivePath = path.join(work.runDirectory, "source.tar");
  const sourceDirectory = path.join(work.runDirectory, "source");
  let failure;
  let result;
  try {
    await writeFile(gitConfigPath, "", { encoding: "utf8", flag: "wx" });
    await mkdir(gitTemplateDirectory);
    await mkdir(sourceDirectory);
    runGit(
      "git-archive",
      ["-c", "core.autocrlf=false", "archive", "--format=tar", `--output=${archivePath}`, before.sha],
      { cwd: repositoryRoot, environment, gitConfigPath, timeoutMs: 5 * 60_000 },
    );
    const archiveDigest = await sha256(archivePath);
    runRequired(
      "archive-extract",
      "tar",
      ["-xf", archivePath, "-C", sourceDirectory],
      { cwd: work.runDirectory, environment, gitConfigPath, timeoutMs: 5 * 60_000 },
    );
    await verifyExtractedTree(
      sourceDirectory,
      before.manifest,
      repositoryRoot,
      environment,
      gitConfigPath,
    );
    await initializeArchiveRepository(
      sourceDirectory,
      environment,
      gitConfigPath,
      gitTemplateDirectory,
    );

    runNpm("archive-install", ["ci", "--ignore-scripts"], {
      cwd: sourceDirectory,
      environment,
      gitConfigPath,
      timeoutMs: 15 * 60_000,
    });
    runNpm("archive-verify", ["run", "verify"], {
      cwd: sourceDirectory,
      environment,
      gitConfigPath,
      timeoutMs: 30 * 60_000,
    });
    runNpm("archive-e2e-local", ["run", "e2e:local"], {
      cwd: sourceDirectory,
      environment,
      gitConfigPath,
      timeoutMs: 10 * 60_000,
    });
    runNpm("archive-e2e-built", ["run", "e2e:built"], {
      cwd: sourceDirectory,
      environment,
      gitConfigPath,
      timeoutMs: 15 * 60_000,
    });
    runNpm("archive-reset", ["run", "reset"], {
      cwd: sourceDirectory,
      environment,
      gitConfigPath,
      timeoutMs: 5 * 60_000,
    });
    await assertTargetsAbsent(sourceDirectory, RESET_TARGETS);
    assertArchiveGitClean(sourceDirectory, environment, gitConfigPath);
    runNpm("archive-uninstall", ["run", "uninstall:project"], {
      cwd: sourceDirectory,
      environment,
      gitConfigPath,
      timeoutMs: 5 * 60_000,
    });
    await assertTargetsAbsent(sourceDirectory, UNINSTALL_TARGETS);
    assertArchiveGitClean(sourceDirectory, environment, gitConfigPath);

    const after = captureSourceState(repositoryRoot, environment, gitConfigPath);
    if (after.sha !== before.sha) throw new Error("source commit changed during archive verification");
    result = {
      schema_version: 1,
      verification_status: "pass",
      source_sha: before.sha,
      archive_sha256: archiveDigest,
      tracked_file_count: before.manifest.length,
      profiles_verified: ["local-development", "production-build"],
      lifecycle_verified: ["install", "verify", "reset", "uninstall"],
    };
  } catch (error) {
    failure = error;
  }
  try {
    await cleanupRun(work.workRoot, work.runDirectory, work.runIdentity);
  } catch (cleanupError) {
    failure ??= cleanupError;
  }
  if (failure !== undefined) throw failure;
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return result;
}

async function main() {
  try {
    if (process.argv.length !== 2) throw new Error("verify-clean-archive accepts no arguments");
    const result = await verifyCleanArchive();
    console.log(`CLEAN_ARCHIVE_SOURCE_SHA=${result.source_sha}`);
    console.log(`CLEAN_ARCHIVE_SHA256=${result.archive_sha256}`);
    console.log(`CLEAN_ARCHIVE_TRACKED_FILES=${result.tracked_file_count}`);
    console.log("CLEAN_ARCHIVE_VERIFY=PASS");
  } catch (error) {
    const step = typeof error?.stepId === "string" && /^[a-z0-9-]+$/u.test(error.stepId)
      ? error.stepId
      : "preflight-or-cleanup";
    console.log(`CLEAN_ARCHIVE_FAILED_STEP=${step}`);
    console.log("CLEAN_ARCHIVE_VERIFY=FAIL");
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) await main();
