import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBobGateEvidence,
  validateBobGateEvidence,
} from "./bob-gate-evidence.mjs";

const expected = {
  candidateSha: "0123456789abcdef0123456789abcdef01234567",
  controllerSha: "89abcdef0123456789abcdef0123456789abcdef",
  workflowRunId: "12345",
  workflowRunAttempt: "1",
};

test("builds exact-run deterministic gate evidence", () => {
  const evidence = buildBobGateEvidence(expected);
  assert.equal(validateBobGateEvidence(evidence, expected), evidence);
  assert.equal(evidence.gates.length, 6);
  assert.ok(evidence.gates.every((gate) => gate.status === "pass"));
});

test("rejects reused or incomplete gate evidence", () => {
  const evidence = buildBobGateEvidence(expected);
  assert.throws(() => validateBobGateEvidence(evidence, { ...expected, workflowRunId: "999" }), /workflowRunId/u);
  assert.throws(() => validateBobGateEvidence({ ...evidence, gates: evidence.gates.slice(1) }, expected), /complete/u);
});

test("rejects a relabeled failed gate", () => {
  const evidence = buildBobGateEvidence(expected);
  const gates = evidence.gates.map((gate) => ({ ...gate }));
  gates[2].status = "fail";
  assert.throws(() => validateBobGateEvidence({ ...evidence, gates }, expected), /item 2/u);
});
