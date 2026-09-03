import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPublicSafeBobReview,
  buildBobReviewReport,
  MAX_BOB_DIAGNOSTIC_EVENTS,
  parseBobJsonResult,
  renderBobReviewMarkdown,
  validateBobReviewReport,
} from "./bob-review-report.mjs";
import { validateBobReviewSchema } from "./bob-review-schema.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567";
const controllerSha = "89abcdef0123456789abcdef0123456789abcdef";

function payload(overrides = {}) {
  return {
    summary: "The candidate is coherent and remains subject to human review.",
    checks: [{ name: "Release boundaries", status: "pass", evidence: "docs/release-scope.md states the boundary." }],
    findings: [],
    notAsserted: [{
      claim: "watsonx Orchestrate Draft execution",
      reason: "No tenant evidence was supplied.",
      evidenceNeeded: "A sanitized exact-candidate Draft run record.",
    }],
    recommendation: "ready_for_human_review",
    ...overrides,
  };
}

function resultEnvelope(overrides = {}) {
  return {
    type: "result",
    timestamp: "2026-09-02T12:00:00.000Z",
    status: "success",
    stats: { tool_calls: 4 },
    last_message: JSON.stringify(payload()),
    ...overrides,
  };
}

function diagnosticEvent(overrides = {}) {
  return {
    type: "error",
    timestamp: "2026-09-02T11:59:59.000Z",
    severity: "error",
    message: "Transient Bob Shell diagnostic that must not enter persisted evidence.",
    ...overrides,
  };
}

function report(overrides = {}) {
  return buildBobReviewReport({
    candidateSha: sha,
    controllerSha,
    reviewedAt: "2026-09-02T12:00:00.000Z",
    maxCost: 0.5,
    maxTurns: 12,
    toolCalls: 4,
    diagnosticEventCount: 0,
    gateEvidence: {
      sourceJob: "deterministic-gates",
      workflowRunId: "12345",
      workflowRunAttempt: "1",
    },
    deterministicGates: [{
      name: "Repository verification",
      command: "npm run verify",
      status: "pass",
      evidence: "Exit code 0 in the isolated exact-candidate gate workspace.",
    }],
    payload: payload(),
    ...overrides,
  });
}

test("parses the documented Bob Shell JSON result envelope", () => {
  const parsed = parseBobJsonResult(JSON.stringify(resultEnvelope()));
  assert.deepEqual(parsed.payload, payload());
  assert.equal(parsed.diagnosticEventCount, 0);
});

test("accepts bounded Bob 2.0.2 diagnostic JSONL without retaining messages", () => {
  const firstMessage = "First transient provider diagnostic that must remain suppressed.";
  const secondMessage = "Second transient provider diagnostic that must remain suppressed.";
  const parsed = parseBobJsonResult([
    JSON.stringify(diagnosticEvent({ message: firstMessage })),
    JSON.stringify(diagnosticEvent({ message: secondMessage })),
    JSON.stringify(resultEnvelope()),
  ].join("\n"));

  assert.equal(parsed.diagnosticEventCount, 2);
  assert.deepEqual(parsed.envelope, resultEnvelope());
  assert.deepEqual(parsed.payload, payload());
  assert.deepEqual(Object.keys(parsed).sort(), ["diagnosticEventCount", "envelope", "payload"]);
  assert.doesNotMatch(JSON.stringify(parsed), new RegExp(`${firstMessage}|${secondMessage}`, "u"));

  const persisted = report({ diagnosticEventCount: parsed.diagnosticEventCount });
  const markdown = renderBobReviewMarkdown(persisted);
  assert.equal(persisted.review.diagnosticEventCount, 2);
  assert.match(markdown, /diagnostic events \(messages suppressed\): `2`/u);
  assert.doesNotMatch(`${JSON.stringify(persisted)}\n${markdown}`, new RegExp(`${firstMessage}|${secondMessage}`, "u"));
});

test("enforces the Bob diagnostic event limit", () => {
  const atLimit = [
    ...Array.from({ length: MAX_BOB_DIAGNOSTIC_EVENTS }, () => JSON.stringify(diagnosticEvent())),
    JSON.stringify(resultEnvelope()),
  ].join("\n");
  assert.equal(parseBobJsonResult(atLimit).diagnosticEventCount, MAX_BOB_DIAGNOSTIC_EVENTS);

  const aboveLimit = [
    ...Array.from({ length: MAX_BOB_DIAGNOSTIC_EVENTS + 1 }, () => JSON.stringify(diagnosticEvent())),
    JSON.stringify(resultEnvelope()),
  ].join("\n");
  assert.throws(() => parseBobJsonResult(aboveLimit), /diagnostic limit/u);
});

test("rejects prose, malformed JSONL, unsupported diagnostics, and a non-final result", () => {
  const result = JSON.stringify(resultEnvelope());
  assert.throws(() => parseBobJsonResult(`provider prose\n${result}`), /line 1/u);
  assert.throws(() => parseBobJsonResult(`${JSON.stringify(diagnosticEvent())}\n\n${result}`), /line 2/u);
  assert.throws(() => parseBobJsonResult([
    JSON.stringify(diagnosticEvent({ extra: true })),
    result,
  ].join("\n")), /missing or unsupported fields/u);
  assert.throws(() => parseBobJsonResult([
    JSON.stringify(diagnosticEvent({ severity: "warning" })),
    result,
  ].join("\n")), /unsupported type or severity/u);
  assert.throws(() => parseBobJsonResult([
    result,
    JSON.stringify(diagnosticEvent()),
  ].join("\n")), /diagnostic event 1/u);
  assert.throws(() => parseBobJsonResult([
    JSON.stringify(diagnosticEvent()),
    result,
    result,
  ].join("\n")), /diagnostic event 2/u);
});

test("rejects prose-wrapped model payloads and zero-tool reviews", () => {
  const base = resultEnvelope({
    stats: { tool_calls: 1 },
    last_message: `Here is the report: ${JSON.stringify(payload())}`,
  });
  assert.throws(() => parseBobJsonResult(JSON.stringify(base)), /last_message/u);
  base.last_message = JSON.stringify(payload());
  base.stats.tool_calls = 0;
  assert.throws(() => parseBobJsonResult(JSON.stringify(base)), /tool call/u);
});

test("does not allow a ready recommendation with severe findings", () => {
  assert.throws(() => report({
    payload: payload({
      findings: [{
        id: "SEC-1",
        severity: "high",
        area: "authentication",
        observation: "A material issue remains.",
        evidence: "apps/portal/example.ts:10",
        recommendation: "Resolve before release.",
      }],
    }),
  }), /high or critical/u);
});

test("validates and deterministically renders a report", () => {
  const value = report();
  assert.equal(validateBobReviewSchema(value), value);
  assert.equal(validateBobReviewReport(value), value);
  const markdown = renderBobReviewMarkdown(value);
  assert.match(markdown, /advisory Bob Shell output/u);
  assert.match(markdown, new RegExp(sha, "u"));
  assert.equal(markdown, renderBobReviewMarkdown(value));
  assert.throws(() => validateBobReviewSchema({ ...value, unsupported: true }), /does not conform/u);
});

test("rejects credential-like and private output", () => {
  assert.throws(() => assertPublicSafeBobReview({ summary: "Contact owner@company.com" }), /email address/u);
  assert.throws(() => assertPublicSafeBobReview({ summary: "Bearer abcdefghijklmnopqrstuvwxyz" }), /credential/u);
  assert.throws(() => assertPublicSafeBobReview({ summary: "safe", token: "known-secret-value" }, {
    secretValues: ["known-secret-value"],
  }), /supplied secret/u);
  assert.throws(() => assertPublicSafeBobReview({ summary: "![tracking](https://example.invalid/pixel)" }),
    /active URL/u);
  const slash = String.fromCharCode(47);
  const backslash = String.fromCharCode(92);
  for (const absolutePath of [
    `${slash}${["opt", "actions-runner", "_work", "repo", "repo", "file.ts"].join(slash)}`,
    `${slash}${["tmp", "acme-bob-review-fixture", "file.ts"].join(slash)}`,
    `C:${backslash}${["actions-runner", "_work", "repo", "file.ts"].join(backslash)}`,
    `${backslash.repeat(2)}${["runner-share", "workspace", "file.ts"].join(backslash)}`,
  ]) {
    assert.throws(() => assertPublicSafeBobReview({ summary: absolutePath }), /absolute/u);
  }
  assert.equal(assertPublicSafeBobReview({
    summary: "The /api/agent route calls GET /orders/{orderId} before /health.",
  }).summary, "The /api/agent route calls GET /orders/{orderId} before /health.");
});

test("escapes model-provided Markdown constructs in the rendered report", () => {
  const value = report({
    payload: payload({
      summary: "Review [details](relative/path) and <img src=x>.",
    }),
  });
  const markdown = renderBobReviewMarkdown(value);
  assert.match(markdown, /\\\[details\\\]\\\(relative\/path\\\)/u);
  assert.match(markdown, /&lt;img src=x&gt;/u);
  assert.doesNotMatch(markdown, /\[details\]\(relative\/path\)/u);
});
