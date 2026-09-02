import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPublicSafeBobReview,
  buildBobReviewReport,
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

function report(overrides = {}) {
  return buildBobReviewReport({
    candidateSha: sha,
    controllerSha,
    reviewedAt: "2026-09-02T12:00:00.000Z",
    maxCost: 0.5,
    maxTurns: 12,
    toolCalls: 4,
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
  const envelope = {
    type: "result",
    timestamp: "2026-09-02T12:00:00.000Z",
    status: "success",
    stats: { tool_calls: 4 },
    last_message: JSON.stringify(payload()),
  };
  assert.deepEqual(parseBobJsonResult(JSON.stringify(envelope)).payload, payload());
});

test("rejects prose-wrapped model payloads and zero-tool reviews", () => {
  const base = {
    type: "result",
    timestamp: "2026-09-02T12:00:00.000Z",
    status: "success",
    stats: { tool_calls: 1 },
    last_message: `Here is the report: ${JSON.stringify(payload())}`,
  };
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
  assert.match(markdown, /advisory AI output/u);
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
