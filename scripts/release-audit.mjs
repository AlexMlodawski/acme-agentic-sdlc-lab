import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants as fsConstants,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATUS_VALUES = new Set(["pass", "fail", "not_completed", "not_asserted"]);
const CANDIDATE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;

const BASE_PLAN = Object.freeze([
  commandStep("doctor", "Pinned toolchain preflight", "npm", ["run", "doctor"]),
  commandStep("git-fsck", "Git object integrity", "git", ["fsck", "--full", "--no-reflogs"], 5 * 60_000),
  commandStep("current-tree-scan", "Current tree release scan", "npm", ["run", "secret:scan"]),
  commandStep("history-scan", "Full history release scan", "npm", ["run", "history:scan"]),
  commandStep("documentation-scan", "Documentation and asset scan", "npm", ["run", "documentation:scan"]),
  commandStep("lint", "Workspace lint", "npm", ["run", "lint"]),
  commandStep("typecheck", "Workspace typecheck", "npm", ["run", "typecheck"]),
  commandStep("tests", "Deterministic test suites", "npm", ["test"]),
  commandStep("build", "Production builds", "npm", ["run", "build"]),
  commandStep(
    "npm-audit",
    "Complete npm dependency vulnerability audit",
    "npm",
    ["audit", "--audit-level=high"],
  ),
  commandStep("python-audit", "Locked Python dependency vulnerability audit", "npm", ["run", "audit:python"]),
  {
    ...commandStep("sbom", "CycloneDX SBOM generation", "npm", ["run", "sbom"]),
    artifact: {
      source: "sbom.cdx.json",
      destination: "sbom.cdx.json",
      removeSourceAfterCapture: true,
    },
  },
]);

const FULL_PLAN = Object.freeze([
  commandStep("verify-agent", "Offline Draft agent verification", "npm", ["run", "verify:agent"]),
  {
    ...commandStep(
      "license-inventory",
      "Third-party license metadata inventory",
      "npm",
      ["run", "licenses:inventory"],
    ),
    artifact: {
      source: "license-inventory.json",
      destination: "license-inventory.json",
      removeSourceAfterCapture: true,
    },
  },
  commandStep("e2e-local", "Local zero-secret browser journey", "npm", ["run", "e2e:local"]),
  commandStep("e2e-built", "Production-build browser journeys", "npm", ["run", "e2e:built"]),
  {
    ...commandStep(
      "verify-archive",
      "Clean archive verification",
      "npm",
      ["run", "verify:archive"],
      45 * 60_000,
    ),
    artifact: {
      source: "clean-archive-verify.json",
      destination: "clean-archive-verify.json",
      removeSourceAfterCapture: true,
    },
  },
]);

function commandStep(id, label, runner, args, timeoutMs = 20 * 60_000) {
  return Object.freeze({ id, label, runner, args: Object.freeze([...args]), timeoutMs, hardGate: true });
}

export function createCommandPlan(mode) {
  const normalizedMode = normalizeMode(mode);
  return [
    ...BASE_PLAN,
    ...(normalizedMode === "Full" ? FULL_PLAN : []),
  ].map((step) => ({
    ...step,
    args: [...step.args],
    ...(step.artifact === undefined ? {} : { artifact: { ...step.artifact } }),
  }));
}

export function normalizeMode(mode) {
  if (typeof mode !== "string") throw new TypeError("Mode must be Quick or Full.");
  const normalized = mode.toLowerCase();
  if (normalized === "quick") return "Quick";
  if (normalized === "full") return "Full";
  throw new TypeError("Mode must be Quick or Full.");
}

export function validateCandidate(candidate) {
  if (
    typeof candidate !== "string"
    || !CANDIDATE_PATTERN.test(candidate)
    || candidate === "."
    || candidate === ".."
  ) {
    throw new TypeError(
      "Candidate must be 1-128 characters using only letters, digits, dot, underscore, or hyphen.",
    );
  }
  if (highConfidenceSecretPatterns().some((pattern) => pattern.test(candidate))) {
    throw new TypeError("Candidate must not resemble a credential.");
  }
  return candidate;
}

function highConfidenceSecretPatterns() {
  return [
    /\bghp_[A-Za-z0-9]{20,}\b/giu,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/giu,
    /\bsk-[A-Za-z0-9_-]{20,}\b/gu,
    /\bglpat-[A-Za-z0-9_-]{20,}\b/gu,
    /\bnpm_[A-Za-z0-9]{20,}\b/gu,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu,
    /\bAIza[0-9A-Za-z_-]{30,}\b/gu,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu,
  ];
}

export function redactText(value, homeDirectory = os.homedir()) {
  let text = String(value ?? "");
  text = text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "");
  text = text.replace(
    /-----BEGIN (?:(?:ENCRYPTED|RSA|EC|DSA|OPENSSH) PRIVATE KEY|PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----[\s\S]*?-----END (?:(?:ENCRYPTED|RSA|EC|DSA|OPENSSH) PRIVATE KEY|PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/gu,
    "[REDACTED_SECRET]",
  );
  for (const pattern of highConfidenceSecretPatterns()) {
    text = text.replace(pattern, "[REDACTED_SECRET]");
  }
  text = text.replace(/\b(Bearer|Basic)\s+[^\s,;]+/giu, "$1 [REDACTED_SECRET]");
  text = text.replace(
    /\b((?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|agent[_-]?key|instana[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|private[_-]?key|authorization|cookie))["']?\s*[:=]\s*["']?([^\s,;"'}\]]+)/giu,
    "$1=[REDACTED_SECRET]",
  );
  text = text.replace(
    /(--(?:api-key|access-token|refresh-token|token|password|secret|private-key|authorization|cookie))(?:=|\s+)\S+/giu,
    "$1 [REDACTED_SECRET]",
  );
  text = text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu, "$1[REDACTED_SECRET]@");

  const normalizedHome = typeof homeDirectory === "string" ? homeDirectory.trim() : "";
  if (normalizedHome !== "") {
    const baseHomeVariants = new Set([
      normalizedHome,
      normalizedHome.replaceAll("\\", "/"),
      normalizedHome.replaceAll("/", "\\"),
    ]);
    const homeVariants = new Set(baseHomeVariants);
    for (const variant of baseHomeVariants) {
      homeVariants.add(variant.replaceAll("\\", "\\\\"));
      homeVariants.add(variant.replaceAll("/", "\\/"));
      homeVariants.add(encodeURI(variant));
    }
    for (const variant of [...homeVariants].sort((left, right) => right.length - left.length)) {
      text = text.replace(new RegExp(escapeRegExp(variant), "giu"), "[REDACTED_USER_PATH]");
    }
  }
  text = text.replace(
    /\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\r\n"'`,;=\]]+?(?=[\\/]+)/giu,
    "[REDACTED_USER_PATH]",
  );
  text = text.replace(
    /\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\s\r\n"'`,;=\]]+/giu,
    "[REDACTED_USER_PATH]",
  );
  text = text.replace(
    /\b[A-Za-z]:(?:%5c|%2f)(?:Users|Documents(?:%20|\+)and(?:%20|\+)Settings)(?:%5c|%2f)(?:(?!(?:%5c|%2f))[A-Za-z0-9._%+ -])+/giu,
    "[REDACTED_USER_PATH]",
  );
  text = text.replace(
    /(?:\\*\/)mnt(?:\\*\/)[a-z](?:\\*\/)Users(?:\\*\/)[^\\/\s\r\n"'`,;=\]]+/giu,
    "[REDACTED_USER_PATH]",
  );
  text = text.replace(
    /(?<!\\)\\{2,}[A-Za-z0-9][A-Za-z0-9.-]*\\+[A-Za-z0-9$][A-Za-z0-9$._()-]*(?:\\+[A-Za-z0-9$._()-]+)*/gu,
    "[REDACTED_USER_PATH]",
  );
  text = text.replace(
    /(?<![:/])\/{2,}[A-Za-z0-9][A-Za-z0-9.-]*\/[A-Za-z0-9$][A-Za-z0-9$._()-]*(?:\/[A-Za-z0-9$._()-]+)*/gu,
    "[REDACTED_USER_PATH]",
  );
  text = text.replace(
    /(?:\\*\/)(?:Users|home)(?:\\*\/)[^\\/\s\r\n"'`,;=\]]+/gu,
    "[REDACTED_USER_PATH]",
  );
  text = text.replace(/(?:\\*\/)root(?=(?:\\*\/)|$)/gu, "[REDACTED_USER_PATH]");
  return text.replace(/[^\P{C}\t\r\n]/gu, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function safeEnvironment(environment = process.env) {
  const inheritedNames = new Set([
    "APPDATA",
    "CI",
    "COLORTERM",
    "COMSPEC",
    "FORCE_COLOR",
    "HOME",
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LOCALAPPDATA",
    "NODE_EXTRA_CA_CERTS",
    "NO_COLOR",
    "PATH",
    "PATHEXT",
    "PLAYWRIGHT_BROWSERS_PATH",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "SYSTEMROOT",
    "TEMP",
    "TERM",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "UV_CACHE_DIR",
    "WINDIR",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
  ]);
  const safe = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && inheritedNames.has(name.toUpperCase())) safe[name] = value;
  }
  return {
    ...safe,
    AGENT_MODE: "stub",
    DO_NOT_TRACK: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
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

function isNpmCliPath(value, platform = process.platform) {
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  if (typeof value !== "string" || !platformPath.isAbsolute(value)) return false;
  return /(?:^|[\\/])npm-cli\.js$/iu.test(value);
}

export function resolveNpmInvocation(
  args,
  { environment = process.env, platform = process.platform, nodeExecutable = process.execPath } = {},
) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new TypeError("npm arguments must be strings.");
  }
  if (isNpmCliPath(environment.npm_execpath, platform)) {
    return { command: nodeExecutable, args: [environment.npm_execpath, ...args] };
  }
  if (platform === "win32") {
    const comspec = environment.ComSpec ?? environment.COMSPEC;
    if (typeof comspec !== "string" || !path.win32.isAbsolute(comspec)) {
      throw new Error("A safe Windows npm invocation requires ComSpec or npm_execpath.");
    }
    const commandLine = ["npm", ...args].map(quoteCmdArgument).join(" ");
    return { command: comspec, args: ["/d", "/s", "/c", commandLine] };
  }
  return { command: "npm", args: [...args] };
}

function quoteCmdArgument(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/u.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function commandDisplay(step) {
  const prefix = step.runner === "npm" ? "npm" : "git";
  return [prefix, ...step.args].join(" ");
}

function runProcess(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: safeEnvironment(options.environment),
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    shell: false,
    timeout: options.timeoutMs,
    windowsHide: true,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
    signal: result.signal,
  };
}

export function executeCommandStep(step, { root, environment = process.env } = {}) {
  try {
    const invocation = step.runner === "npm"
      ? resolveNpmInvocation(step.args, { environment })
      : { command: "git", args: step.args };
    return runProcess(invocation.command, invocation.args, {
      cwd: root,
      environment,
      timeoutMs: step.timeoutMs,
    });
  } catch (error) {
    return {
      exitCode: null,
      stdout: "",
      stderr: "",
      error: error instanceof Error ? error : new Error(String(error)),
      signal: null,
    };
  }
}

function runGit(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: safeEnvironment(process.env),
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to capture Git source state for: git ${args.join(" ")}`);
  }
  return (result.stdout ?? "").replace(/\r?\n$/u, "");
}

async function captureSource(root, allowDirty, now) {
  const repositoryRoot = await realpath(runGit(root, ["rev-parse", "--show-toplevel"]));
  const expectedRoot = await realpath(root);
  if (normalizeFilesystemPath(repositoryRoot) !== normalizeFilesystemPath(expectedRoot)) {
    throw new Error("Release audit must run from the repository containing this script.");
  }

  const sha = runGit(root, ["rev-parse", "HEAD"]).trim().toLowerCase();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(sha)) {
    throw new Error("Git returned an invalid commit identifier.");
  }
  const branchValue = runGit(root, ["branch", "--show-current"]).trim();
  const porcelain = runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const statusLines = porcelain === "" ? [] : porcelain.split(/\r?\n/u);
  return {
    sha,
    branch: branchValue === "" ? null : redactText(branchValue),
    detached: branchValue === "",
    dirty: statusLines.length > 0,
    allow_dirty: allowDirty,
    status_porcelain: statusLines.map((line) => redactText(line)),
    status_digest_sha256: createHash("sha256").update(porcelain, "utf8").digest("hex"),
    captured_at: now().toISOString(),
  };
}

function normalizeFilesystemPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function stepLogName(index, id) {
  return `steps/${String(index + 1).padStart(2, "0")}-${id}.log`;
}

function renderLog(step, result) {
  const sections = [
    `step=${step.id}`,
    `status=${result.status}`,
    `hard_gate=${String(step.hardGate)}`,
    `command=${commandDisplay(step)}`,
    `started_at=${result.startedAt ?? "not_asserted"}`,
    `completed_at=${result.completedAt ?? "not_asserted"}`,
    `duration_ms=${result.durationMs ?? "not_asserted"}`,
    `exit_code=${result.exitCode ?? "not_asserted"}`,
  ];
  if (result.note) sections.push(`note=${result.note}`);
  sections.push("", "stdout:", result.stdout || "", "", "stderr:", result.stderr || "", "");
  return redactText(sections.join("\n"));
}

async function captureArtifact(step, root, artifactDirectory, expectedSourceSha) {
  if (step.artifact === undefined) return undefined;
  const source = path.resolve(root, step.artifact.source);
  const expectedPrefix = `${path.resolve(root)}${path.sep}`;
  if (!source.startsWith(expectedPrefix)) throw new Error("Artifact source escapes the repository.");
  const metadata = await lstat(source);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Expected artifact is not a regular file.");
  }
  const destination = path.join(artifactDirectory, step.artifact.destination);
  if (path.extname(destination).toLowerCase() === ".json") {
    if (metadata.size > 32 * 1024 * 1024) throw new Error("JSON artifact exceeds 32 MiB.");
    const parsed = JSON.parse(await readFile(source, "utf8"));
    if (
      step.id === "verify-archive"
      && (
        parsed?.verification_status !== "pass"
        || parsed?.source_sha !== expectedSourceSha
      )
    ) {
      throw new Error("Clean-archive evidence is not bound to the audited source commit.");
    }
    await writeFile(
      destination,
      `${JSON.stringify(redactJson(parsed), null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  } else {
    await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
  }
  if (step.artifact.removeSourceAfterCapture === true) await unlink(source);
  return `artifacts/${step.artifact.destination}`;
}

function redactJson(value) {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactJson(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [redactText(key), redactJson(item)]),
    );
  }
  return value;
}

function statusFromExecution(execution) {
  if (execution.error || execution.exitCode === null) return "not_completed";
  return execution.exitCode === 0 ? "pass" : "fail";
}

export function deriveOverallStatus(steps) {
  for (const step of steps) {
    if (!STATUS_VALUES.has(step.status)) throw new TypeError(`Invalid status: ${step.status}`);
  }
  const hard = steps.filter((step) => step.hard_gate);
  if (hard.some((step) => step.status === "fail")) return "fail";
  if (hard.some((step) => step.status === "not_completed")) return "not_completed";
  if (steps.some((step) => step.status === "not_asserted")) return "not_asserted";
  return "pass";
}

function reportStep(step, index, result, artifact) {
  return {
    id: step.id,
    label: step.label,
    command: commandDisplay(step),
    status: result.status,
    hard_gate: step.hardGate,
    started_at: result.startedAt,
    completed_at: result.completedAt,
    duration_ms: result.durationMs,
    exit_code: result.exitCode,
    log: stepLogName(index, step.id),
    ...(artifact === undefined ? {} : { artifact }),
    ...(result.note === undefined ? {} : { note: redactText(result.note) }),
  };
}

async function writeLog(outputDirectory, relativeName, content) {
  const destination = path.join(outputDirectory, ...relativeName.split("/"));
  await writeFile(destination, content, { encoding: "utf8", flag: "wx" });
}

function sourceStep(source) {
  const status = source.dirty && !source.allow_dirty ? "fail" : "pass";
  const note = source.dirty
    ? source.allow_dirty
      ? "Dirty working tree was explicitly allowed."
      : "Dirty working tree requires --allow-dirty."
    : "Working tree was clean before evidence output was created.";
  return {
    definition: {
      id: "source-state",
      label: "Exact Git source state",
      runner: "git",
      args: ["rev-parse", "HEAD", "+", "branch", "+", "status", "--porcelain=v1"],
      hardGate: true,
    },
    result: {
      status,
      startedAt: source.captured_at,
      completedAt: source.captured_at,
      durationMs: 0,
      exitCode: status === "pass" ? 0 : 1,
      stdout: [
        `sha=${source.sha}`,
        `branch=${source.branch ?? "DETACHED"}`,
        `dirty=${String(source.dirty)}`,
        `status_digest_sha256=${source.status_digest_sha256}`,
        ...source.status_porcelain,
      ].join("\n"),
      stderr: "",
      note,
    },
  };
}

function skippedResult(status, note) {
  return {
    status,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    exitCode: null,
    stdout: "",
    stderr: "",
    note,
  };
}

function renderAuditSummary(report) {
  const rows = report.steps.map((step) =>
    `| ${step.id} | ${step.status} | ${step.hard_gate ? "yes" : "no"} |`
  );
  return [
    "# Release audit summary",
    "",
    `- Candidate: \`${report.candidate}\``,
    `- Commit: \`${report.source.sha}\``,
    `- Mode: \`${report.mode}\``,
    `- Source clean: \`${String(!report.source.dirty)}\``,
    `- Overall status: \`${report.overall_status}\``,
    `- Hard gates passed: \`${String(report.hard_gate_passed)}\``,
    "",
    "| Check | Status | Hard gate |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "This automated result is evidence for human review, not release approval.",
    "",
  ].join("\n");
}

async function writeEvidenceChecksums(outputDirectory) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Evidence output contains an unexpected link.");
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name !== "checksums.sha256") files.push(absolute);
      else if (!entry.isFile()) throw new Error("Evidence output contains a special file.");
    }
  }
  await visit(outputDirectory);
  const lines = [];
  for (const absolute of files.sort()) {
    const relative = path.relative(outputDirectory, absolute).replaceAll("\\", "/");
    const digest = createHash("sha256").update(await readFile(absolute)).digest("hex");
    lines.push(`${digest}  ${relative}`);
  }
  const content = `${lines.join("\n")}\n`;
  await writeFile(
    path.join(outputDirectory, "checksums.sha256"),
    content,
    { encoding: "utf8", flag: "wx" },
  );
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function writeEvidenceCompletion({ outputDirectory, report, checksumsSha256, now }) {
  const reportSha256 = createHash("sha256")
    .update(await readFile(path.join(outputDirectory, "report.json")))
    .digest("hex");
  const completion = {
    schema_version: "1.0.0",
    completion_status: "pass",
    audit_status: report.overall_status,
    hard_gate_passed: report.hard_gate_passed,
    candidate: report.candidate,
    source_sha: report.source.sha,
    report_sha256: reportSha256,
    checksums_sha256: checksumsSha256,
    completed_at: now().toISOString(),
  };
  await writeFile(
    path.join(outputDirectory, "evidence-complete.json"),
    `${JSON.stringify(completion, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}

function sourceStateMatches(initial, final) {
  return initial.sha === final.sha
    && initial.branch === final.branch
    && initial.detached === final.detached
    && initial.dirty === final.dirty
    && initial.status_digest_sha256 === final.status_digest_sha256;
}

function finalSourceStep(initial, final) {
  const stable = sourceStateMatches(initial, final);
  return {
    definition: {
      id: "source-final-state",
      label: "Final Git source-state binding",
      runner: "git",
      args: ["rev-parse", "HEAD", "+", "branch", "+", "status", "--porcelain=v1"],
      hardGate: true,
    },
    result: {
      status: stable ? "pass" : "fail",
      startedAt: final.captured_at,
      completedAt: final.captured_at,
      durationMs: 0,
      exitCode: stable ? 0 : 1,
      stdout: [
        `initial_sha=${initial.sha}`,
        `final_sha=${final.sha}`,
        `initial_status_digest_sha256=${initial.status_digest_sha256}`,
        `final_status_digest_sha256=${final.status_digest_sha256}`,
      ].join("\n"),
      stderr: "",
      note: stable
        ? "Source SHA, branch, and worktree state remained unchanged through the audit."
        : "Source SHA, branch, or worktree state changed during the audit.",
    },
  };
}

export async function runReleaseAudit({
  root = SCRIPT_ROOT,
  mode,
  candidate,
  allowDirty = false,
  dryRun = false,
  now = () => new Date(),
  execute = executeCommandStep,
  writeCompletion = writeEvidenceCompletion,
  environment = process.env,
} = {}) {
  const normalizedMode = normalizeMode(mode);
  const safeCandidate = validateCandidate(candidate);
  const absoluteRoot = path.resolve(root);
  const createdAt = now().toISOString();
  const source = await captureSource(absoluteRoot, Boolean(allowDirty), now);
  const evidenceRoot = path.join(absoluteRoot, "release-evidence");
  const outputDirectory = path.resolve(evidenceRoot, safeCandidate);
  if (!outputDirectory.startsWith(`${path.resolve(evidenceRoot)}${path.sep}`)) {
    throw new Error("Evidence output escapes release-evidence.");
  }

  try {
    await mkdir(evidenceRoot);
  } catch (error) {
    if (!(error instanceof Error) || error.code !== "EEXIST") throw error;
  }
  const evidenceMetadata = await lstat(evidenceRoot);
  if (!evidenceMetadata.isDirectory() || evidenceMetadata.isSymbolicLink()) {
    throw new Error("release-evidence must be a real directory, not a link.");
  }
  await mkdir(outputDirectory, { recursive: false });
  const realEvidenceRoot = await realpath(evidenceRoot);
  const realOutputDirectory = await realpath(outputDirectory);
  if (
    !normalizeFilesystemPath(realOutputDirectory).startsWith(
      `${normalizeFilesystemPath(realEvidenceRoot)}${path.sep}`,
    )
  ) {
    throw new Error("Evidence output resolves outside release-evidence.");
  }
  const stepDirectory = path.join(outputDirectory, "steps");
  const artifactDirectory = path.join(outputDirectory, "artifacts");
  await mkdir(stepDirectory);
  await mkdir(artifactDirectory);

  const reportedSteps = [];
  const identity = sourceStep(source);
  await writeLog(outputDirectory, stepLogName(0, identity.definition.id), renderLog(identity.definition, identity.result));
  reportedSteps.push(reportStep(identity.definition, 0, identity.result));

  const plan = createCommandPlan(normalizedMode);
  for (const [planIndex, step] of plan.entries()) {
    const reportIndex = planIndex + 1;
    let result;
    let artifact;

    if (source.dirty && !source.allow_dirty) {
      result = skippedResult("not_completed", "Blocked by dirty source state.");
    } else if (dryRun) {
      result = skippedResult("not_asserted", "Dry run: command was planned but not executed.");
    } else {
      const started = now();
      console.log(`[release-audit] start ${step.id}`);
      let execution;
      try {
        execution = await execute(step, {
          root: absoluteRoot,
          environment,
        });
      } catch (error) {
        execution = {
          exitCode: null,
          stdout: "",
          stderr: "",
          error: error instanceof Error ? error : new Error(String(error)),
          signal: null,
        };
      }
      const completed = now();
      result = {
        status: statusFromExecution(execution),
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
        durationMs: Math.max(0, completed.getTime() - started.getTime()),
        exitCode: Number.isInteger(execution.exitCode) ? execution.exitCode : null,
        stdout: execution.stdout ?? "",
        stderr: execution.stderr ?? "",
        ...(execution.error
          ? { note: execution.error.message || "Command did not complete." }
          : execution.signal
            ? { note: `Command ended by signal ${execution.signal}.` }
            : {}),
      };

      if (result.status === "pass" && step.artifact !== undefined) {
        try {
          artifact = await captureArtifact(step, absoluteRoot, artifactDirectory, source.sha);
        } catch (error) {
          result.status = "fail";
          result.exitCode = 1;
          result.note = error instanceof Error ? error.message : String(error);
        }
      }
      console.log(`[release-audit] ${step.id} ${result.status}`);
    }

    const relativeLog = stepLogName(reportIndex, step.id);
    await writeLog(outputDirectory, relativeLog, renderLog(step, result));
    reportedSteps.push(reportStep(step, reportIndex, result, artifact));
  }

  const finalSource = await captureSource(absoluteRoot, Boolean(allowDirty), now);
  const finalIdentity = finalSourceStep(source, finalSource);
  const finalIndex = reportedSteps.length;
  await writeLog(
    outputDirectory,
    stepLogName(finalIndex, finalIdentity.definition.id),
    renderLog(finalIdentity.definition, finalIdentity.result),
  );
  reportedSteps.push(reportStep(
    finalIdentity.definition,
    finalIndex,
    finalIdentity.result,
  ));

  const overallStatus = deriveOverallStatus(reportedSteps);
  const hardGatePassed = reportedSteps
    .filter((step) => step.hard_gate)
    .every((step) => step.status === "pass");
  const report = {
    schema_version: "1.0.0",
    candidate: safeCandidate,
    mode: normalizedMode,
    dry_run: Boolean(dryRun),
    created_at: createdAt,
    completed_at: now().toISOString(),
    output_directory: `release-evidence/${safeCandidate}`,
    source,
    overall_status: overallStatus,
    hard_gate_passed: hardGatePassed,
    steps: reportedSteps,
  };
  await writeFile(
    path.join(outputDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  await writeFile(
    path.join(outputDirectory, "environment.json"),
    `${JSON.stringify({
      platform: process.platform,
      architecture: process.arch,
      node_version: process.versions.node,
      ci: environment.CI === "1" || environment.CI === "true",
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  await writeFile(
    path.join(outputDirectory, "audit-summary.md"),
    renderAuditSummary(report),
    { encoding: "utf8", flag: "wx" },
  );
  const checksumsSha256 = await writeEvidenceChecksums(outputDirectory);
  const authoritativeSource = await captureSource(absoluteRoot, Boolean(allowDirty), now);
  if (!sourceStateMatches(source, authoritativeSource)) {
    throw new Error("Source state changed before evidence finalization.");
  }
  await writeCompletion({ outputDirectory, report, checksumsSha256, now });
  const reportSha256 = createHash("sha256")
    .update(await readFile(path.join(outputDirectory, "report.json")))
    .digest("hex");
  const completion = JSON.parse(
    await readFile(path.join(outputDirectory, "evidence-complete.json"), "utf8"),
  );
  if (
    completion?.completion_status !== "pass"
    || completion?.audit_status !== report.overall_status
    || completion?.candidate !== report.candidate
    || completion?.source_sha !== report.source.sha
    || completion?.hard_gate_passed !== report.hard_gate_passed
    || completion?.report_sha256 !== reportSha256
    || completion?.checksums_sha256 !== checksumsSha256
  ) {
    throw new Error("Evidence completion marker is missing or inconsistent.");
  }

  return {
    report,
    completion,
    outputDirectory,
    exitCode: reportedSteps.some(
      (step) => step.hard_gate && new Set(["fail", "not_completed"]).has(step.status),
    ) ? 1 : 0,
  };
}

export function parseArguments(args) {
  const parsed = { allowDirty: false, dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--allow-dirty") {
      parsed.allowDirty = true;
    } else if (argument === "--dry-run") {
      parsed.dryRun = true;
    } else if (argument === "--mode" || argument === "--candidate") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new TypeError(`${argument} requires a value.`);
      }
      parsed[argument === "--mode" ? "mode" : "candidate"] = value;
      index += 1;
    } else {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
  }
  parsed.mode = normalizeMode(parsed.mode);
  parsed.candidate = validateCandidate(parsed.candidate);
  return parsed;
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await runReleaseAudit(options);
    console.log(`[release-audit] report=${result.report.output_directory}/report.json`);
    console.log(`[release-audit] overall_status=${result.report.overall_status}`);
    process.exitCode = result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[release-audit] not_completed: ${redactText(message)}`);
    process.exitCode = 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) await main();
