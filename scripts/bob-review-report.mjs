import { createHash } from "node:crypto";

import {
  containsAbsoluteUserPath,
  containsHighConfidenceSecret,
  containsOpaqueProviderCredential,
} from "./content-policy.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const FINDING_ID_PATTERN = /^[A-Z][A-Z0-9-]{1,30}$/u;
const STATUSES = new Set(["pass", "fail", "not_completed", "not_asserted"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const RECOMMENDATIONS = new Set([
  "ready_for_human_review",
  "changes_required",
  "not_ready",
]);

export const EXPECTED_BOB_VERSION = "2.0.2";
export const EXPECTED_BOB_COMMIT = "a31a75e3";
export const READ_ONLY_DISABLED_TOOL_GROUPS = Object.freeze([
  "edit",
  "execute",
  "mcp",
  "skill",
  "todo",
  "subagent",
  "mode",
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, required, optional = []) {
  if (!isRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function isUsefulText(value, maximum = 4_000) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maximum
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function issue(issues, condition, message) {
  if (!condition) issues.push(message);
}

function validateCheck(check, prefix, issues, { commandRequired = false } = {}) {
  const required = commandRequired
    ? ["name", "command", "status", "evidence"]
    : ["name", "status", "evidence"];
  issue(issues, hasExactKeys(check, required), `${prefix} has missing or unsupported fields.`);
  if (!isRecord(check)) return;
  issue(issues, isUsefulText(check.name, 200), `${prefix}.name must be useful text.`);
  if (commandRequired) {
    issue(issues, isUsefulText(check.command, 500), `${prefix}.command must be useful text.`);
  }
  issue(issues, STATUSES.has(check.status), `${prefix}.status is invalid.`);
  issue(issues, isUsefulText(check.evidence), `${prefix}.evidence must be useful text.`);
}

function validateFinding(finding, prefix, issues) {
  const keys = ["id", "severity", "area", "observation", "evidence", "recommendation"];
  issue(issues, hasExactKeys(finding, keys), `${prefix} has missing or unsupported fields.`);
  if (!isRecord(finding)) return;
  issue(issues, FINDING_ID_PATTERN.test(finding.id ?? ""), `${prefix}.id is invalid.`);
  issue(issues, SEVERITIES.has(finding.severity), `${prefix}.severity is invalid.`);
  for (const field of ["area", "observation", "evidence", "recommendation"]) {
    issue(issues, isUsefulText(finding[field]), `${prefix}.${field} must be useful text.`);
  }
}

function validateNotAsserted(item, prefix, issues) {
  const keys = ["claim", "reason", "evidenceNeeded"];
  issue(issues, hasExactKeys(item, keys), `${prefix} has missing or unsupported fields.`);
  if (!isRecord(item)) return;
  for (const field of keys) {
    issue(issues, isUsefulText(item[field]), `${prefix}.${field} must be useful text.`);
  }
}

function failIfIssues(label, issues) {
  if (issues.length > 0) throw new Error(`${label} validation failed:\n- ${issues.join("\n- ")}`);
}

export function validateBobPayload(payload) {
  const issues = [];
  const keys = ["summary", "checks", "findings", "notAsserted", "recommendation"];
  issue(issues, hasExactKeys(payload, keys), "payload has missing or unsupported fields.");
  if (!isRecord(payload)) failIfIssues("Bob payload", issues);

  issue(issues, isUsefulText(payload.summary, 8_000), "summary must be useful text.");
  issue(issues, Array.isArray(payload.checks) && payload.checks.length >= 1 && payload.checks.length <= 100,
    "checks must contain 1 through 100 items.");
  if (Array.isArray(payload.checks)) {
    payload.checks.forEach((check, index) => validateCheck(check, `checks[${index}]`, issues));
  }
  issue(issues, Array.isArray(payload.findings) && payload.findings.length <= 100,
    "findings must contain no more than 100 items.");
  if (Array.isArray(payload.findings)) {
    payload.findings.forEach((finding, index) => validateFinding(finding, `findings[${index}]`, issues));
    const ids = payload.findings.map((finding) => finding?.id);
    issue(issues, new Set(ids).size === ids.length, "finding IDs must be unique.");
  }
  issue(issues, Array.isArray(payload.notAsserted) && payload.notAsserted.length <= 100,
    "notAsserted must contain no more than 100 items.");
  if (Array.isArray(payload.notAsserted)) {
    payload.notAsserted.forEach((item, index) => validateNotAsserted(item, `notAsserted[${index}]`, issues));
  }
  issue(issues, RECOMMENDATIONS.has(payload.recommendation), "recommendation is invalid.");
  if (payload.recommendation === "ready_for_human_review") {
    issue(issues, !payload.checks?.some((check) => check.status === "fail"),
      "ready_for_human_review cannot include a failed reviewer check.");
    issue(issues, !payload.findings?.some((finding) => ["high", "critical"].includes(finding.severity)),
      "ready_for_human_review cannot include a high or critical finding.");
  }
  failIfIssues("Bob payload", issues);
  return payload;
}

export function parseBobJsonResult(stdout) {
  if (!isUsefulText(stdout, 2_000_000)) {
    throw new Error("Bob Shell returned no bounded machine-readable output.");
  }
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error("Bob Shell --format json output must be one JSON object.");
  }
  if (!hasExactKeys(envelope, ["type", "timestamp", "status", "stats", "last_message"])) {
    throw new Error("Bob Shell result envelope has missing or unsupported fields.");
  }
  if (envelope.type !== "result" || envelope.status !== "success") {
    throw new Error("Bob Shell did not return one successful result envelope.");
  }
  if (!isRecord(envelope.stats) || !Number.isSafeInteger(envelope.stats.tool_calls)
    || envelope.stats.tool_calls < 1) {
    throw new Error("Bob Shell result must record at least one tool call.");
  }
  if (typeof envelope.last_message !== "string") {
    throw new Error("Bob Shell result is missing last_message.");
  }
  let payload;
  try {
    payload = JSON.parse(envelope.last_message);
  } catch {
    throw new Error("Bob Shell last_message must be one raw JSON object without prose or fences.");
  }
  return { envelope, payload: validateBobPayload(payload) };
}

export function buildBobReviewReport({
  candidateSha,
  controllerSha,
  reviewedAt,
  maxCost,
  maxTurns,
  toolCalls,
  gateEvidence,
  deterministicGates,
  payload,
}) {
  validateBobPayload(payload);
  const report = {
    schemaVersion: "1.0",
    candidate: { sha: candidateSha },
    controller: { sha: controllerSha },
    review: {
      reviewer: "Bob Shell",
      reviewedAt,
      status: "pass",
      bobVersion: EXPECTED_BOB_VERSION,
      sourceMutationGuard: "pass",
      workspacePolicyGuard: "pass",
      maxCost,
      maxTurns,
      toolCalls,
      disabledToolGroups: [...READ_ONLY_DISABLED_TOOL_GROUPS],
    },
    gateEvidence,
    deterministicGates,
    summary: payload.summary,
    checks: payload.checks,
    findings: payload.findings,
    notAsserted: payload.notAsserted,
    recommendation: payload.recommendation,
  };
  return validateBobReviewReport(report);
}

export function validateBobReviewReport(report) {
  const issues = [];
  const rootKeys = [
    "schemaVersion", "candidate", "controller", "review", "gateEvidence", "deterministicGates",
    "summary", "checks", "findings", "notAsserted", "recommendation",
  ];
  issue(issues, hasExactKeys(report, rootKeys), "report has missing or unsupported fields.");
  if (!isRecord(report)) failIfIssues("Bob review report", issues);
  issue(issues, report.schemaVersion === "1.0", "schemaVersion must be 1.0.");
  for (const field of ["candidate", "controller"]) {
    issue(issues, hasExactKeys(report[field], ["sha"]), `${field} must contain only sha.`);
    issue(issues, SHA_PATTERN.test(report[field]?.sha ?? ""), `${field}.sha must be an exact lowercase commit SHA.`);
  }
  const gateEvidenceKeys = ["sourceJob", "workflowRunId", "workflowRunAttempt"];
  issue(issues, hasExactKeys(report.gateEvidence, gateEvidenceKeys),
    "gateEvidence has missing or unsupported fields.");
  if (isRecord(report.gateEvidence)) {
    issue(issues, report.gateEvidence.sourceJob === "deterministic-gates",
      "gateEvidence.sourceJob is invalid.");
    issue(issues, /^[1-9][0-9]{0,30}$/u.test(report.gateEvidence.workflowRunId ?? ""),
      "gateEvidence.workflowRunId is invalid.");
    issue(issues, /^[1-9][0-9]{0,30}$/u.test(report.gateEvidence.workflowRunAttempt ?? ""),
      "gateEvidence.workflowRunAttempt is invalid.");
  }
  const reviewKeys = [
    "reviewer", "reviewedAt", "status", "bobVersion", "sourceMutationGuard",
    "workspacePolicyGuard", "maxCost", "maxTurns", "toolCalls", "disabledToolGroups",
  ];
  issue(issues, hasExactKeys(report.review, reviewKeys), "review has missing or unsupported fields.");
  if (isRecord(report.review)) {
    issue(issues, report.review.reviewer === "Bob Shell", "review.reviewer must be Bob Shell.");
    issue(issues, ISO_UTC_PATTERN.test(report.review.reviewedAt ?? "")
      && !Number.isNaN(Date.parse(report.review.reviewedAt)), "review.reviewedAt must be an ISO UTC timestamp.");
    issue(issues, report.review.status === "pass", "persisted reviews must have pass status.");
    issue(issues, report.review.bobVersion === EXPECTED_BOB_VERSION,
      `review.bobVersion must be ${EXPECTED_BOB_VERSION}.`);
    issue(issues, report.review.sourceMutationGuard === "pass", "sourceMutationGuard must pass.");
    issue(issues, report.review.workspacePolicyGuard === "pass", "workspacePolicyGuard must pass.");
    issue(issues, Number.isFinite(report.review.maxCost) && report.review.maxCost > 0
      && report.review.maxCost <= 5, "review.maxCost must be greater than 0 and no more than 5.");
    issue(issues, Number.isInteger(report.review.maxTurns) && report.review.maxTurns >= 1
      && report.review.maxTurns <= 30, "review.maxTurns must be an integer from 1 through 30.");
    issue(issues, Number.isSafeInteger(report.review.toolCalls) && report.review.toolCalls >= 1,
      "review.toolCalls must record at least one aggregate tool call.");
    issue(issues, Array.isArray(report.review.disabledToolGroups)
      && report.review.disabledToolGroups.join(",") === READ_ONLY_DISABLED_TOOL_GROUPS.join(","),
    "disabledToolGroups must match the reviewed read-only profile.");
  }
  issue(issues, Array.isArray(report.deterministicGates)
    && report.deterministicGates.length >= 1 && report.deterministicGates.length <= 20,
  "deterministicGates must contain 1 through 20 items.");
  if (Array.isArray(report.deterministicGates)) {
    report.deterministicGates.forEach((check, index) => {
      validateCheck(check, `deterministicGates[${index}]`, issues, { commandRequired: true });
      issue(issues, check.status === "pass", `deterministicGates[${index}] must pass before Bob review.`);
    });
  }
  issue(issues, isUsefulText(report.summary, 8_000), "summary must be useful text.");
  issue(issues, Array.isArray(report.checks) && report.checks.length >= 1 && report.checks.length <= 100,
    "checks must contain 1 through 100 items.");
  if (Array.isArray(report.checks)) {
    report.checks.forEach((check, index) => validateCheck(check, `checks[${index}]`, issues));
  }
  issue(issues, Array.isArray(report.findings) && report.findings.length <= 100,
    "findings must contain no more than 100 items.");
  if (Array.isArray(report.findings)) {
    report.findings.forEach((finding, index) => validateFinding(finding, `findings[${index}]`, issues));
    const ids = report.findings.map((finding) => finding?.id);
    issue(issues, new Set(ids).size === ids.length, "finding IDs must be unique.");
  }
  issue(issues, Array.isArray(report.notAsserted) && report.notAsserted.length <= 100,
    "notAsserted must contain no more than 100 items.");
  if (Array.isArray(report.notAsserted)) {
    report.notAsserted.forEach((item, index) => validateNotAsserted(item, `notAsserted[${index}]`, issues));
  }
  issue(issues, RECOMMENDATIONS.has(report.recommendation), "recommendation is invalid.");
  if (report.recommendation === "ready_for_human_review") {
    issue(issues, !report.checks?.some((check) => check.status === "fail"),
      "ready_for_human_review cannot include a failed reviewer check.");
    issue(issues, !report.findings?.some((finding) => ["high", "critical"].includes(finding.severity)),
      "ready_for_human_review cannot include a high or critical finding.");
  }
  failIfIssues("Bob review report", issues);
  return report;
}

export function assertPublicSafeBobReview(value, { secretValues = [] } = {}) {
  const text = JSON.stringify(value);
  if (containsHighConfidenceSecret(text) || containsOpaqueProviderCredential(text)
    || containsAbsoluteUserPath(text)) {
    throw new Error("Bob review contains a credential-like value or absolute user path.");
  }
  const absolutePaths = [
    /(?:^|[\s"'`([{])(?:[A-Za-z]:[\\/]|\\\\)/u,
    /(?:^|[\s"'`([{])\/(?:opt|tmp|var|etc|usr|srv|run|mnt|workspace|workspaces|__w|builds)(?:\/[A-Za-z0-9._-]+)*/u,
  ];
  if (absolutePaths.some((pattern) => pattern.test(text))) {
    throw new Error("Bob review contains an absolute filesystem path.");
  }
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._~-]{16,}\b/iu,
    /\b(?:https?|ftp):\/\/[^\s"']+/iu,
    /\bdata:[a-z0-9/+.-]+[;,]/iu,
    /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})\b/u,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
    /\b[A-Za-z0-9.-]+\.(?:corp|internal|lan|local)(?::\d+)?(?:\/|\b)/iu,
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("Bob review contains a credential, active URL, email address, private network value, or internal hostname.");
  }
  for (const secret of secretValues) {
    if (typeof secret === "string" && secret.length >= 8 && text.includes(secret)) {
      throw new Error("Bob review contains a supplied secret value.");
    }
  }
  return value;
}

function plain(value) {
  return String(value)
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .trim()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_\[\]{}()#!|])/gu, "\\$1");
}

export function renderBobReviewMarkdown(report) {
  validateBobReviewReport(report);
  const lines = [
    "# Bob Shell advisory review",
    "",
    `- Candidate SHA: \`${report.candidate.sha}\``,
    `- Trusted controller SHA: \`${report.controller.sha}\``,
    `- Reviewed at: \`${report.review.reviewedAt}\``,
    `- Bob Shell version: \`${report.review.bobVersion}\``,
    `- Aggregate tool calls: \`${report.review.toolCalls}\``,
    `- Deterministic gate run: \`${report.gateEvidence.workflowRunId}\` attempt \`${report.gateEvidence.workflowRunAttempt}\``,
    `- Source mutation guard: \`${report.review.sourceMutationGuard}\``,
    `- Recommendation: \`${report.recommendation}\``,
    "",
    "> This is advisory Bob Shell output. Deterministic gates and a human release decision remain authoritative.",
    "",
    "## Summary",
    "",
    plain(report.summary),
    "",
    "## Deterministic gates",
    "",
    "| Gate | Status | Evidence |",
    "| --- | --- | --- |",
    ...report.deterministicGates.map((gate) => `| ${plain(gate.name)} | ${gate.status} | ${plain(gate.evidence)} |`),
    "",
    "## Reviewer checks",
    "",
    "| Check | Status | Evidence |",
    "| --- | --- | --- |",
    ...report.checks.map((check) => `| ${plain(check.name)} | ${check.status} | ${plain(check.evidence)} |`),
    "",
    "## Findings",
    "",
  ];
  if (report.findings.length === 0) lines.push("No findings were reported.", "");
  for (const finding of report.findings) {
    lines.push(
      `### ${plain(finding.id)} — ${plain(finding.severity)}`,
      "",
      `- Area: ${plain(finding.area)}`,
      `- Observation: ${plain(finding.observation)}`,
      `- Evidence: ${plain(finding.evidence)}`,
      `- Recommendation: ${plain(finding.recommendation)}`,
      "",
    );
  }
  lines.push("## Not asserted", "");
  if (report.notAsserted.length === 0) lines.push("No additional unverified claims were reported.", "");
  for (const item of report.notAsserted) {
    lines.push(
      `- **${plain(item.claim)}:** ${plain(item.reason)} Evidence needed: ${plain(item.evidenceNeeded)}`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
