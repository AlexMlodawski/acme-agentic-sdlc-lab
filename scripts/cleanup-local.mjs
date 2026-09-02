import { spawnSync } from "node:child_process";
import { lstat, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  "clean-archive-verify.json",
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

const EVIDENCE_TARGETS = Object.freeze(["release-evidence"]);

function safeGitEnvironment(environment = process.env) {
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

function runGit(root, args, environment) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: null,
    env: safeGitEnvironment(environment),
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error("Cleanup requires an initialized Git repository.");
  }
  return result.stdout;
}

function normalized(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function assertContained(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (
    normalized(resolvedCandidate) === normalized(resolvedRoot)
    || !normalized(resolvedCandidate).startsWith(`${normalized(resolvedRoot)}${path.sep}`)
  ) {
    throw new Error("Cleanup target must be strictly contained by the repository.");
  }
  return resolvedCandidate;
}

export function parseCleanupArguments(args) {
  let mode;
  let confirm = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--confirm") {
      confirm = true;
    } else if (argument === "--mode") {
      const value = args[index + 1];
      if (!new Set(["reset", "uninstall", "evidence"]).has(value)) {
        throw new TypeError("--mode must be reset, uninstall, or evidence.");
      }
      mode = value;
      index += 1;
    } else {
      throw new TypeError(`Unknown cleanup argument: ${argument}`);
    }
  }
  if (mode === undefined) throw new TypeError("--mode is required.");
  if (!confirm) throw new TypeError("Cleanup requires the explicit --confirm flag.");
  return { mode, confirm };
}

async function verifyRepositoryRoot(root, environment) {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (manifest?.name !== "acme-agentic-sdlc-lab") {
    throw new Error("Cleanup must run from the Acme Agentic SDLC Lab repository.");
  }
  const actualRoot = await realpath(root);
  if (normalized(actualRoot) !== normalized(root)) {
    throw new Error("Repository root must not be reached through a link.");
  }
  const serializedTopLevel = runGit(root, ["rev-parse", "--show-toplevel"], environment);
  const topLevel = serializedTopLevel.toString("utf8").trim();
  if (topLevel === "" || topLevel.includes("\uFFFD") || /[\r\n]/u.test(topLevel)) {
    throw new Error("Git repository root is invalid.");
  }
  if (normalized(await realpath(topLevel)) !== normalized(actualRoot)) {
    throw new Error("Cleanup must run at the actual Git repository root.");
  }
}

function assertTargetsUntracked(root, targets, environment) {
  const serialized = runGit(root, ["ls-files", "-z", "--", ...targets], environment);
  if (serialized.length !== 0) {
    throw new Error("Cleanup target contains tracked source; refusing all removals.");
  }
}

async function removeKnownTarget(root, relativeTarget) {
  const target = assertContained(root, path.join(root, ...relativeTarget.split("/")));
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") return false;
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    throw new Error(`Refusing linked cleanup target: ${relativeTarget}`);
  }
  const actualTarget = await realpath(target);
  assertContained(root, actualTarget);
  if (!metadata.isDirectory() && !metadata.isFile()) {
    throw new Error(`Refusing special cleanup target: ${relativeTarget}`);
  }
  await rm(target, { recursive: metadata.isDirectory(), force: false, maxRetries: 2 });
  return true;
}

export async function cleanupLocal({
  root = SCRIPT_ROOT,
  mode,
  confirm = false,
  environment = process.env,
} = {}) {
  if (!confirm) throw new TypeError("Cleanup requires explicit confirmation.");
  if (!new Set(["reset", "uninstall", "evidence"]).has(mode)) {
    throw new TypeError("Cleanup mode must be reset, uninstall, or evidence.");
  }
  const absoluteRoot = path.resolve(root);
  await verifyRepositoryRoot(absoluteRoot, environment);
  const targets = mode === "reset"
    ? RESET_TARGETS
    : mode === "uninstall"
      ? UNINSTALL_TARGETS
      : EVIDENCE_TARGETS;
  assertTargetsUntracked(absoluteRoot, targets, environment);
  const removed = [];
  for (const target of targets) {
    if (await removeKnownTarget(absoluteRoot, target)) removed.push(target);
  }
  return { mode, removed };
}

async function main() {
  try {
    const options = parseCleanupArguments(process.argv.slice(2));
    const result = await cleanupLocal(options);
    console.log(`CLEANUP_MODE=${result.mode}`);
    console.log(`CLEANUP_TARGETS_REMOVED=${result.removed.length}`);
    console.log("CLEANUP=PASS");
  } catch (error) {
    console.error("CLEANUP=FAIL");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) await main();
