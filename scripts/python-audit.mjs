import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;

function executableExtensions(platform, pathExt) {
  if (platform !== "win32") return [""];
  const configured = String(pathExt || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean)
    .map((extension) => extension.toLowerCase());
  return [".exe", ".com", ".cmd", ".bat", ...configured]
    .filter((extension, index, values) => values.indexOf(extension) === index);
}

export function executableCandidates(
  name,
  { environment = process.env, platform = process.platform } = {},
) {
  if (typeof name !== "string" || !/^[A-Za-z0-9_.-]+$/u.test(name)) {
    throw new TypeError("Executable name is invalid.");
  }
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const pathValue = environment.PATH ?? environment.Path ?? "";
  const directories = pathValue
    .split(pathApi.delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/gu, ""))
    .filter(Boolean);
  const hasExtension = pathApi.extname(name) !== "";
  const extensions = hasExtension ? [""] : executableExtensions(platform, environment.PATHEXT);
  return directories.flatMap((directory) =>
    extensions.map((extension) => pathApi.resolve(directory, `${name}${extension}`))
  );
}

export function findExecutable(
  name,
  options = {},
) {
  const platform = options.platform ?? process.platform;
  for (const candidate of executableCandidates(name, options)) {
    try {
      accessSync(
        candidate,
        platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
      );
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Keep searching the caller's PATH without exposing candidate paths.
    }
  }
  return null;
}

function quoteForCmd(value) {
  if (/^[A-Za-z0-9_./:=@+\\-]+$/u.test(value)) return value;
  return `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`;
}

export function executeExecutable(
  executable,
  args,
  {
    cwd,
    environment = process.env,
    platform = process.platform,
    timeoutMs = 20 * 60_000,
  } = {},
) {
  let command = executable;
  let commandArgs = [...args];
  const viaCommandProcessor = platform === "win32" && /\.(?:bat|cmd)$/iu.test(executable);
  if (viaCommandProcessor) {
    const comspec = environment.ComSpec ?? environment.COMSPEC;
    if (typeof comspec !== "string" || !path.win32.isAbsolute(comspec)) {
      return {
        exitCode: null,
        stdout: "",
        stderr: "",
        error: new Error("ComSpec is unavailable."),
      };
    }
    command = comspec;
    commandArgs = [
      "/d",
      "/s",
      "/v:off",
      "/c",
      `call ${[executable, ...args].map(quoteForCmd).join(" ")}`,
    ];
  }
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: auditEnvironment(environment),
    maxBuffer: MAX_CAPTURE_BYTES,
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
    windowsVerbatimArguments: viaCommandProcessor,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

export function auditEnvironment(environment) {
  const inheritedNames = new Set([
    "APPDATA",
    "CI",
    "COMSPEC",
    "HOME",
    "LANG",
    "LC_ALL",
    "LOCALAPPDATA",
    "NODE_EXTRA_CA_CERTS",
    "PATH",
    "PATHEXT",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "UV_CACHE_DIR",
    "WINDIR",
    "XDG_CACHE_HOME",
  ]);
  const safe = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && inheritedNames.has(name.toUpperCase())) safe[name] = value;
  }
  return {
    ...safe,
    DO_NOT_TRACK: "1",
    NO_COLOR: "1",
    PIP_CONFIG_FILE: os.devNull,
    UV_KEYRING_PROVIDER: "disabled",
    UV_NO_CONFIG: "1",
    UV_NO_ENV_FILE: "1",
    UV_NO_PROGRESS: "1",
  };
}

function normalizeFilesystemPath(value, platform = process.platform) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const resolved = pathApi.resolve(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function assertContainedPath(parent, child, platform = process.platform) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const normalizedParent = normalizeFilesystemPath(parent, platform);
  const normalizedChild = normalizeFilesystemPath(child, platform);
  if (!normalizedChild.startsWith(`${normalizedParent}${pathApi.sep}`)) {
    throw new Error("Temporary audit path escaped its containment root.");
  }
}

async function ensureRealDirectory(directory) {
  try {
    await mkdir(directory);
  } catch (error) {
    if (!(error instanceof Error) || error.code !== "EEXIST") throw error;
  }
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Audit work root must be a real directory.");
  }
  return realpath(directory);
}

async function createAuditWorkDirectory(root) {
  const evidenceRoot = await ensureRealDirectory(path.join(root, "release-evidence"));
  const workRoot = await ensureRealDirectory(path.join(evidenceRoot, ".python-audit-work"));
  assertContainedPath(evidenceRoot, workRoot);
  const temporary = await mkdtemp(path.join(workRoot, "run-"));
  const realTemporary = await realpath(temporary);
  assertContainedPath(workRoot, realTemporary);
  return { workRoot, temporary: realTemporary };
}

async function removeAuditWorkDirectory(workRoot, temporary) {
  const realWorkRoot = await realpath(workRoot);
  const realTemporary = await realpath(temporary);
  assertContainedPath(realWorkRoot, realTemporary);
  const metadata = await lstat(realTemporary);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Audit temporary path is not a real directory.");
  }
  await rm(realTemporary, { recursive: true, force: false, maxRetries: 2, retryDelay: 50 });
}

export function buildPythonAuditPlan({
  uv,
  projectDirectory,
  temporaryDirectory,
  pythonVersion,
}) {
  const requirements = path.join(temporaryDirectory, "locked-requirements.txt");
  const result = path.join(temporaryDirectory, "pip-audit-result.json");
  assertContainedPath(temporaryDirectory, requirements);
  assertContainedPath(temporaryDirectory, result);
  return {
    requirements,
    result,
    export: {
      executable: uv,
      args: [
        "export",
        "--project",
        projectDirectory,
        "--locked",
        "--all-groups",
        "--no-group",
        "audit",
        "--all-extras",
        "--no-emit-project",
        "--no-annotate",
        "--no-header",
        "--format",
        "requirements.txt",
        "--output-file",
        requirements,
        "--offline",
        "--no-progress",
        "--color",
        "never",
      ],
    },
    audit: {
      executable: uv,
      args: [
        "run",
        "--isolated",
        "--project",
        projectDirectory,
        "--locked",
        "--only-group",
        "audit",
        "--no-env-file",
        "--no-progress",
        "--color",
        "never",
        "--keyring-provider",
        "disabled",
        "--default-index",
        "https://pypi.org/simple",
        "--no-python-downloads",
        "--python",
        pythonVersion,
        "pip-audit",
        "--requirement",
        requirements,
        "--format",
        "json",
        "--output",
        result,
        "--progress-spinner",
        "off",
        "--disable-pip",
        "--no-deps",
      ],
    },
  };
}

export function parsePipAuditResult(value) {
  const document = typeof value === "string" ? JSON.parse(value) : value;
  const dependencies = Array.isArray(document)
    ? document
    : document && typeof document === "object" && Array.isArray(document.dependencies)
      ? document.dependencies
      : null;
  if (dependencies === null) throw new TypeError("pip-audit result has no dependency list.");
  let vulnerabilities = 0;
  let skipped = 0;
  for (const dependency of dependencies) {
    if (dependency === null || typeof dependency !== "object") {
      throw new TypeError("pip-audit dependency entry is invalid.");
    }
    if (Array.isArray(dependency.vulns)) vulnerabilities += dependency.vulns.length;
    if (typeof dependency.skip_reason === "string" && dependency.skip_reason !== "") skipped += 1;
  }
  return { dependencies: dependencies.length, vulnerabilities, skipped };
}

async function regularNonemptyFile(file, parent) {
  assertContainedPath(parent, file);
  const metadata = await lstat(file);
  return metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0;
}

function initialResult() {
  return {
    uvStatus: "not_asserted",
    exportStatus: "not_asserted",
    auditStatus: "not_asserted",
    dependencyCount: null,
    vulnerabilityCount: null,
    skippedCount: null,
    reason: "not_started",
    exitCode: 2,
  };
}

export async function runPythonAudit({
  root = REPOSITORY_ROOT,
  environment = process.env,
  platform = process.platform,
  resolveExecutable = (name) => findExecutable(name, { environment, platform }),
  execute = executeExecutable,
} = {}) {
  const outcome = initialResult();
  const absoluteRoot = path.resolve(root);
  const uv = resolveExecutable("uv");
  if (uv === null) {
    outcome.uvStatus = "not_completed";
    outcome.exportStatus = "not_completed";
    outcome.auditStatus = "not_completed";
    outcome.reason = "uv_unavailable";
    return outcome;
  }
  outcome.uvStatus = "pass";

  let work;
  let cleanupFailed = false;
  try {
    const projectDirectory = path.join(absoluteRoot, "agents", "store_support_agent");
    const pythonVersion = (await readFile(path.join(absoluteRoot, ".python-version"), "utf8")).trim();
    if (!/^3\.12\.\d+$/u.test(pythonVersion)) throw new Error("Python declaration is invalid.");
    work = await createAuditWorkDirectory(absoluteRoot);
    const plan = buildPythonAuditPlan({
      uv,
      projectDirectory,
      temporaryDirectory: work.temporary,
      pythonVersion,
    });

    const exported = await execute(plan.export.executable, plan.export.args, {
      cwd: absoluteRoot,
      environment,
      platform,
      timeoutMs: 5 * 60_000,
      stage: "export",
    });
    if (exported.error || exported.exitCode !== 0) {
      outcome.exportStatus = exported.error || exported.exitCode === null ? "not_completed" : "fail";
      outcome.auditStatus = "not_completed";
      outcome.reason = "lock_export_failed";
      return outcome;
    }
    if (!(await regularNonemptyFile(plan.requirements, work.temporary))) {
      outcome.exportStatus = "fail";
      outcome.auditStatus = "not_completed";
      outcome.reason = "lock_export_missing";
      return outcome;
    }
    outcome.exportStatus = "pass";

    const audited = await execute(plan.audit.executable, plan.audit.args, {
      cwd: absoluteRoot,
      environment,
      platform,
      timeoutMs: 20 * 60_000,
      stage: "audit",
    });
    if (audited.error || audited.exitCode === null || !new Set([0, 1]).has(audited.exitCode)) {
      outcome.auditStatus = "not_completed";
      outcome.reason = "audit_execution_failed";
      return outcome;
    }
    if (!(await regularNonemptyFile(plan.result, work.temporary))) {
      outcome.auditStatus = "not_completed";
      outcome.reason = "audit_result_missing";
      return outcome;
    }
    const counts = parsePipAuditResult(await readFile(plan.result, "utf8"));
    outcome.dependencyCount = counts.dependencies;
    outcome.vulnerabilityCount = counts.vulnerabilities;
    outcome.skippedCount = counts.skipped;

    if (audited.exitCode === 0 && counts.vulnerabilities === 0 && counts.skipped === 0) {
      outcome.auditStatus = "pass";
      outcome.reason = "completed";
      outcome.exitCode = 0;
    } else if (counts.vulnerabilities > 0 || counts.skipped > 0) {
      outcome.auditStatus = "fail";
      outcome.reason = counts.vulnerabilities > 0 ? "vulnerabilities_found" : "dependencies_skipped";
      outcome.exitCode = 1;
    } else {
      outcome.auditStatus = "not_completed";
      outcome.reason = "audit_exit_inconsistent";
    }
    return outcome;
  } catch {
    outcome.exportStatus = outcome.exportStatus === "pass" ? "pass" : "not_completed";
    outcome.auditStatus = "not_completed";
    outcome.reason = "audit_internal_error";
    outcome.exitCode = 2;
    return outcome;
  } finally {
    if (work !== undefined) {
      try {
        await removeAuditWorkDirectory(work.workRoot, work.temporary);
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) {
      outcome.auditStatus = "not_completed";
      outcome.reason = "cleanup_failed";
      outcome.exitCode = 2;
    }
  }
}

export function formatPublicOutput(outcome) {
  const lines = [
    `PYTHON_UV_STATUS=${outcome.uvStatus}`,
    `PYTHON_LOCK_EXPORT_STATUS=${outcome.exportStatus}`,
    `PYTHON_AUDIT_STATUS=${outcome.auditStatus}`,
  ];
  if (Number.isInteger(outcome.dependencyCount)) {
    lines.push(`PYTHON_AUDITED_DEPENDENCIES=${outcome.dependencyCount}`);
  }
  if (Number.isInteger(outcome.vulnerabilityCount)) {
    lines.push(`PYTHON_VULNERABILITY_FINDINGS=${outcome.vulnerabilityCount}`);
  }
  if (Number.isInteger(outcome.skippedCount)) {
    lines.push(`PYTHON_SKIPPED_DEPENDENCIES=${outcome.skippedCount}`);
  }
  lines.push(`PYTHON_DEPENDENCY_AUDIT=${outcome.exitCode === 0 ? "PASS" : "FAIL"}`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const outcome = await runPythonAudit();
  process.stdout.write(formatPublicOutput(outcome));
  process.exitCode = outcome.exitCode;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) await main();
