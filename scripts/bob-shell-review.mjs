import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertPublicSafeBobReview,
  buildBobReviewReport,
  EXPECTED_BOB_COMMIT,
  EXPECTED_BOB_VERSION,
  parseBobJsonResult,
  READ_ONLY_DISABLED_TOOL_GROUPS,
  renderBobReviewMarkdown,
  sha256Text,
} from "./bob-review-report.mjs";
import {
  assertSafeBobReviewWorkspace,
  snapshotBobReviewWorkspace,
} from "./bob-review-workspace.mjs";
import { readBobGateEvidence } from "./bob-gate-evidence.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const promptPath = path.join(projectRoot, "examples", "prompts", "04-bob-shell-cicd-review.md");
const outputDirectory = path.join(projectRoot, "artifacts", "bob-review");
const reportJsonPath = path.join(outputDirectory, "report.json");
const reportMarkdownPath = path.join(outputDirectory, "report.md");
const completionPath = path.join(outputDirectory, "evidence-complete.json");
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DECIMAL_ID_PATTERN = /^[1-9][0-9]{0,30}$/u;

export function usage() {
  return [
    "Usage: npm run review:bob -- --candidate <sha> [options]",
    "",
    "Options:",
    "  --candidate <sha>              Exact lowercase 40-character candidate SHA",
    "  --candidate-repository <path>  Repository containing the candidate (default: current repository)",
    "  --gate-evidence <path>         Validated evidence from the separate deterministic-gates job",
    "  --max-cost <number>            Bobcoin ceiling above 0 and at most 5 (default: 0.5)",
    "  --max-turns <number>           Turn ceiling from 1 through 30 (default: 30)",
    "  --team-id <id>                 Team ID required by a general API key",
    "  --accept-license               Confirm the operator already reviewed and accepts the IBM license",
    "  --help                         Show this help",
  ].join("\n");
}

export function parseBobReviewArguments(argv) {
  const options = {
    candidate: undefined,
    candidateRepository: projectRoot,
    gateEvidence: undefined,
    maxCost: 0.5,
    maxTurns: 30,
    teamId: undefined,
    acceptLicense: false,
  };
  const valued = new Set([
    "--candidate", "--candidate-repository", "--gate-evidence", "--max-cost", "--max-turns", "--team-id",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { ...options, help: true };
    if (argument === "--accept-license") {
      options.acceptLicense = true;
      continue;
    }
    if (!valued.has(argument)) throw new Error(`Unknown option: ${argument ?? ""}\n${usage()}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}.\n${usage()}`);
    }
    index += 1;
    if (argument === "--candidate") options.candidate = value;
    if (argument === "--candidate-repository") options.candidateRepository = value;
    if (argument === "--gate-evidence") options.gateEvidence = value;
    if (argument === "--max-cost") options.maxCost = Number(value);
    if (argument === "--max-turns") options.maxTurns = Number(value);
    if (argument === "--team-id") options.teamId = value;
  }
  if (!SHA_PATTERN.test(options.candidate ?? "")) {
    throw new Error("--candidate must be an exact lowercase 40-character commit SHA.");
  }
  if (typeof options.candidateRepository !== "string" || options.candidateRepository.trim() === ""
    || options.candidateRepository.includes("\0")) {
    throw new Error("--candidate-repository must be a non-empty path.");
  }
  if (typeof options.gateEvidence !== "string" || options.gateEvidence.trim() === ""
    || options.gateEvidence.includes("\0")) {
    throw new Error("--gate-evidence must identify the separate deterministic-gates evidence file.");
  }
  if (!Number.isFinite(options.maxCost) || options.maxCost <= 0 || options.maxCost > 5) {
    throw new Error("--max-cost must be greater than 0 and no more than 5.");
  }
  if (!Number.isInteger(options.maxTurns) || options.maxTurns < 1 || options.maxTurns > 30) {
    throw new Error("--max-turns must be an integer from 1 through 30.");
  }
  if (options.teamId !== undefined && !/^[A-Za-z0-9._:-]{1,200}$/u.test(options.teamId)) {
    throw new Error("--team-id contains unsupported characters.");
  }
  if (!options.acceptLicense) {
    throw new Error("--accept-license is required after the operator reviews the IBM Bob license.");
  }
  return options;
}

export function assertBobWorkflowExecutionContext(environment = process.env, platform = process.platform) {
  if (platform !== "linux") {
    throw new Error("The publishable Bob Shell controller requires the protected Linux GitHub Actions job.");
  }
  if (environment.GITHUB_ACTIONS !== "true"
    || environment.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || environment.GITHUB_JOB !== "advisory-review"
    || !DECIMAL_ID_PATTERN.test(environment.GITHUB_RUN_ID ?? "")
    || !DECIMAL_ID_PATTERN.test(environment.GITHUB_RUN_ATTEMPT ?? "")
    || !SHA_PATTERN.test(environment.GITHUB_SHA ?? "")) {
    throw new Error("Publishable Bob Shell evidence can be created only by the checked-in advisory-review workflow job.");
  }
  return Object.freeze({
    controllerSha: environment.GITHUB_SHA,
    workflowRunId: environment.GITHUB_RUN_ID,
    workflowRunAttempt: environment.GITHUB_RUN_ATTEMPT,
  });
}

function selectedHostEnvironment(environment = process.env) {
  const allowed = new Set([
    "COMSPEC", "LANG", "LANGUAGE", "LC_ALL", "PATH", "PATHEXT", "PROGRAMDATA",
    "PROGRAMFILES", "PROGRAMFILES(X86)", "SHELL", "SYSTEMDRIVE", "SYSTEMROOT",
    "TERM", "WINDIR",
  ]);
  const result = {};
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value === "string" && allowed.has(name.toUpperCase())) result[name] = value;
  }
  return result;
}

export function isolatedExecutionEnvironment({ home, temporaryDirectory }) {
  return {
    ...selectedHostEnvironment(),
    AGENT_MODE: "stub",
    CI: "true",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    HOME: home,
    USERPROFILE: home,
    NEXT_TELEMETRY_DISABLED: "1",
    NPM_CONFIG_CACHE: path.join(home, ".npm-cache"),
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    OTEL_ENABLED: "0",
    PLAYWRIGHT_BROWSERS_PATH: path.join(home, "playwright-browsers"),
    TEMP: temporaryDirectory,
    TMP: temporaryDirectory,
    TMPDIR: temporaryDirectory,
    UV_CACHE_DIR: path.join(home, ".uv-cache"),
  };
}

function run(command, args, { cwd, env, input, timeout = 30 * 60 * 1_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    input,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    timeout,
    windowsHide: true,
  });
  return {
    status: result.error ? 127 : result.status,
    stdout: result.stdout ?? "",
    stderr: result.error?.message ?? result.stderr ?? "",
    signal: result.signal,
  };
}

function safeFailureText(value, secrets = []) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 8) text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(/\b[A-Za-z]:[\\/][^\r\n]*/gu, "[PRIVATE_PATH]")
    .replace(/\/(?:Users|home|root|tmp|private|workspace|workspaces|__w|mnt|builds)\/[^\r\n]*/gu, "[PRIVATE_PATH]")
    .trim()
    .slice(0, 2_000);
}

function git(args, cwd, environment) {
  return run("git", args, { cwd, env: environment, timeout: 2 * 60 * 1_000 });
}

function gitOutput(args, cwd, environment) {
  const result = git(args, cwd, environment);
  if (result.status !== 0) throw new Error("Unable to establish exact Git candidate identity.");
  return result.stdout.trim();
}

async function cloneExactCandidate(source, destination, candidate, environment) {
  const clone = git(["clone", "--no-local", "--no-checkout", source, destination], projectRoot, environment);
  if (clone.status !== 0) throw new Error("Unable to create an isolated candidate clone.");
  const removeOrigin = git(["remote", "remove", "origin"], destination, environment);
  if (removeOrigin.status !== 0) throw new Error("Unable to remove the isolated clone origin.");
  const checkout = git(["checkout", "--detach", candidate], destination, environment);
  if (checkout.status !== 0) throw new Error("Unable to check out the exact candidate in isolation.");
  if (gitOutput(["rev-parse", "HEAD"], destination, environment) !== candidate) {
    throw new Error("Isolated checkout does not match the approved candidate SHA.");
  }
  if (gitOutput(["rev-parse", "--is-shallow-repository"], destination, environment) !== "false") {
    throw new Error("Shallow repositories are outside the Bob review contract.");
  }
}

function buildPrompt(basePrompt, { candidateSha, controllerSha, deterministicGates, trackedFiles }) {
  if (trackedFiles.length > 5_000) throw new Error("Candidate contains more than 5,000 tracked files.");
  const manifest = JSON.stringify(trackedFiles);
  if (manifest.length > 250_000) throw new Error("Candidate tracked-file manifest exceeds 250,000 characters.");
  return [
    basePrompt.trim(),
    "",
    "## Controller-supplied immutable context",
    "",
    `Candidate SHA: ${candidateSha}`,
    `Trusted controller SHA: ${controllerSha}`,
    `Deterministic gates: ${JSON.stringify(deterministicGates)}`,
    `Tracked file manifest: ${manifest}`,
    "",
    "Inspect relevant tracked files with read-only tools before returning the required JSON object.",
  ].join("\n");
}

export function parseBobVersionOutput(stdout, stderr = "") {
  const normalizedStdout = String(stdout ?? "").replace(/\r\n?/gu, "\n").trim();
  const normalizedStderr = String(stderr ?? "").trim();
  const expected = `${EXPECTED_BOB_VERSION}\ncommit: ${EXPECTED_BOB_COMMIT}`;
  if (normalizedStderr !== "" || normalizedStdout !== expected) {
    throw new Error(`Bob Shell version must be exactly ${EXPECTED_BOB_VERSION} (${EXPECTED_BOB_COMMIT}).`);
  }
  return Object.freeze({ version: EXPECTED_BOB_VERSION, commit: EXPECTED_BOB_COMMIT });
}

function verifyBobVersion(environment) {
  const result = run("bob", ["--version"], { cwd: projectRoot, env: environment, timeout: 30_000 });
  if (result.status !== 0) {
    throw new Error(`Bob Shell ${EXPECTED_BOB_VERSION} is unavailable on this runner.`);
  }
  parseBobVersionOutput(result.stdout, result.stderr);
}

function runBob(workspace, prompt, options, environment) {
  const apiKey = process.env.BOB_API_KEY;
  if (typeof apiKey !== "string" || apiKey.trim().length < 8) {
    throw new Error("BOB_API_KEY is unavailable; authenticated Bob Shell review was not completed.");
  }
  const args = [
    "run",
    "--mode", "ask",
    "--format", "json",
    "--max-cost", String(options.maxCost),
    "--max-turns", String(options.maxTurns),
    "--disable-mcp",
    "--disable-subagents",
    "--disable-tool-groups", READ_ONLY_DISABLED_TOOL_GROUPS.join(","),
    "--workspace", workspace,
    "--log-level", "error",
    "--trust",
  ];
  args.push("--accept-license");
  if (options.teamId) args.push("--team-id", options.teamId);
  const result = run("bob", args, {
    cwd: workspace,
    env: { ...environment, BOB_API_KEY: apiKey },
    input: prompt,
    timeout: 20 * 60 * 1_000,
  });
  if (result.status !== 0) {
    throw new Error("Bob Shell review was not completed; provider output was suppressed.");
  }
  return { ...parseBobJsonResult(result.stdout), apiKey };
}

async function assertOutputAvailable() {
  try {
    await access(outputDirectory, fsConstants.F_OK);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw new Error("Unable to establish the Bob review output boundary.");
  }
  throw new Error("Bob review output already exists; completed evidence is never overwritten.");
}

async function removeTemporaryRoot(directory) {
  if (!directory) return;
  const canonicalTemp = await realpath(os.tmpdir());
  const canonicalParent = await realpath(path.dirname(directory));
  if (canonicalParent !== canonicalTemp || !path.basename(directory).startsWith("acme-bob-review-")) {
    throw new Error("Refusing to remove an unexpected temporary review directory.");
  }
  await rm(directory, { recursive: true, force: true });
}

async function writeCompletedEvidence(report, secretValues) {
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory, { mode: 0o700 });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderBobReviewMarkdown(report);
  assertPublicSafeBobReview(report, { secretValues });
  const completion = `${JSON.stringify({
    schemaVersion: "1.0",
    candidateSha: report.candidate.sha,
    controllerSha: report.controller.sha,
    reportStatus: "pass",
    reportSha256: sha256Text(json),
    markdownSha256: sha256Text(markdown),
  }, null, 2)}\n`;
  await writeFile(`${reportJsonPath}.tmp`, json, { encoding: "utf8", mode: 0o600 });
  await writeFile(`${reportMarkdownPath}.tmp`, markdown, { encoding: "utf8", mode: 0o600 });
  await rename(`${reportJsonPath}.tmp`, reportJsonPath);
  await rename(`${reportMarkdownPath}.tmp`, reportMarkdownPath);
  await writeFile(`${completionPath}.tmp`, completion, { encoding: "utf8", mode: 0o600 });
  await rename(`${completionPath}.tmp`, completionPath);
}

export async function runBobShellReview(options) {
  const workflowContext = assertBobWorkflowExecutionContext();
  await assertOutputAvailable();
  let temporaryRoot;
  try {
    const candidateRepository = await realpath(path.resolve(options.candidateRepository));
    await access(path.join(candidateRepository, ".git"), fsConstants.R_OK);
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "acme-bob-review-"));
    const reviewWorkspace = path.join(temporaryRoot, "review-candidate");
    const isolatedHome = path.join(temporaryRoot, "isolated-home");
    const isolatedTemp = path.join(temporaryRoot, "isolated-temp");
    await Promise.all([
      mkdir(isolatedHome, { recursive: true, mode: 0o700 }),
      mkdir(isolatedTemp, { recursive: true, mode: 0o700 }),
    ]);
    const environment = isolatedExecutionEnvironment({ home: isolatedHome, temporaryDirectory: isolatedTemp });
    const controllerSha = gitOutput(["rev-parse", "HEAD"], projectRoot, environment);
    if (!SHA_PATTERN.test(controllerSha) || controllerSha !== workflowContext.controllerSha) {
      throw new Error("Trusted controller SHA does not match the active workflow identity.");
    }
    if (gitOutput(["status", "--porcelain=v1", "--untracked-files=all"], projectRoot, environment) !== "") {
      throw new Error("The trusted review controller must be a clean checkout.");
    }
    const expectedRootAgentsBlob = gitOutput(["rev-parse", "HEAD:AGENTS.md"], projectRoot, environment);

    const expectedGateIdentity = {
      candidateSha: options.candidate,
      controllerSha,
      workflowRunId: workflowContext.workflowRunId,
      workflowRunAttempt: workflowContext.workflowRunAttempt,
    };
    const gateEvidence = await readBobGateEvidence(
      path.resolve(options.gateEvidence),
      expectedGateIdentity,
    );
    await cloneExactCandidate(candidateRepository, reviewWorkspace, options.candidate, environment);
    const { trackedFiles } = await assertSafeBobReviewWorkspace(reviewWorkspace, {
      expectedSha: options.candidate,
      expectedRootAgentsBlob,
    });

    const deterministicGates = gateEvidence.gates;
    const before = await snapshotBobReviewWorkspace(reviewWorkspace);
    verifyBobVersion(environment);
    const basePrompt = await readFile(promptPath, "utf8");
    const prompt = buildPrompt(basePrompt, {
      candidateSha: options.candidate,
      controllerSha,
      deterministicGates,
      trackedFiles,
    });
    const {
      envelope,
      payload,
      diagnosticEventCount,
      apiKey,
    } = runBob(reviewWorkspace, prompt, options, environment);
    const after = await snapshotBobReviewWorkspace(reviewWorkspace);
    if (before !== after) throw new Error("Bob Shell changed the isolated review workspace.");
    await assertSafeBobReviewWorkspace(reviewWorkspace, {
      expectedSha: options.candidate,
      expectedRootAgentsBlob,
    });

    const report = buildBobReviewReport({
      candidateSha: options.candidate,
      controllerSha,
      reviewedAt: new Date().toISOString(),
      maxCost: options.maxCost,
      maxTurns: options.maxTurns,
      toolCalls: envelope.stats.tool_calls,
      diagnosticEventCount,
      gateEvidence: {
        sourceJob: gateEvidence.sourceJob,
        workflowRunId: gateEvidence.workflowRunId,
        workflowRunAttempt: gateEvidence.workflowRunAttempt,
      },
      deterministicGates,
      payload,
    });
    const secretValues = [apiKey, options.teamId];
    assertPublicSafeBobReview(report, { secretValues });
    await writeCompletedEvidence(report, secretValues);
    console.log("BOB_REVIEW_EXECUTION=pass");
    console.log(`BOB_REVIEW_CANDIDATE_SHA=${options.candidate}`);
    console.log(`BOB_REVIEW_RECOMMENDATION=${report.recommendation}`);
    return report;
  } finally {
    await removeTemporaryRoot(temporaryRoot);
  }
}

async function main() {
  try {
    const options = parseBobReviewArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    await runBobShellReview(options);
  } catch (error) {
    console.error(`BOB_REVIEW_EXECUTION=not_completed`);
    console.error(safeFailureText(error instanceof Error ? error.message : error, [
      process.env.BOB_API_KEY,
      process.env.BOB_TEAM_ID,
    ]));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
