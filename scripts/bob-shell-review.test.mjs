import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  assertBobWorkflowExecutionContext,
  isolatedExecutionEnvironment,
  parseBobVersionOutput,
  parseBobReviewArguments,
} from "./bob-shell-review.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567";

test("requires an exact lowercase candidate SHA and bounded settings", () => {
  assert.throws(() => parseBobReviewArguments([]), /candidate/u);
  assert.throws(() => parseBobReviewArguments(["--candidate", sha.toUpperCase(), "--gate-evidence", "gates.json"]), /lowercase/u);
  assert.throws(() => parseBobReviewArguments(["--candidate", sha, "--gate-evidence", "gates.json", "--max-cost", "6"]), /no more than 5/u);
  assert.throws(() => parseBobReviewArguments(["--candidate", sha, "--gate-evidence", "gates.json", "--max-turns", "31"]), /1 through 30/u);
});

test("parses the explicit license confirmation and team context", () => {
  assert.throws(() => parseBobReviewArguments([
    "--candidate", sha,
    "--gate-evidence", "gate-evidence/gates.json",
  ]), /accept-license/u);
  const options = parseBobReviewArguments([
    "--candidate", sha,
    "--gate-evidence", "gate-evidence/gates.json",
    "--max-cost", "1.25",
    "--max-turns", "20",
    "--team-id", "team.demo-1",
    "--accept-license",
  ]);
  assert.equal(options.candidate, sha);
  assert.equal(options.gateEvidence, "gate-evidence/gates.json");
  assert.equal(options.maxCost, 1.25);
  assert.equal(options.maxTurns, 20);
  assert.equal(options.teamId, "team.demo-1");
  assert.equal(options.acceptLicense, true);
});

test("publishable evidence requires the protected Linux workflow context", () => {
  const context = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_JOB: "advisory-review",
    GITHUB_RUN_ID: "12345",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_SHA: sha,
  };
  assert.deepEqual(assertBobWorkflowExecutionContext(context, "linux"), {
    controllerSha: sha,
    workflowRunId: "12345",
    workflowRunAttempt: "2",
  });
  assert.throws(() => assertBobWorkflowExecutionContext(context, "win32"), /Linux GitHub Actions/u);
  assert.throws(() => assertBobWorkflowExecutionContext({ ...context, GITHUB_ACTIONS: "false" }, "linux"),
    /only by the checked-in/u);
  assert.throws(() => assertBobWorkflowExecutionContext({ ...context, GITHUB_RUN_ID: "local" }, "linux"),
    /only by the checked-in/u);
});

test("Bob version evidence requires the exact stable build", () => {
  assert.deepEqual(parseBobVersionOutput("2.0.2\ncommit: a31a75e3\n"), {
    version: "2.0.2",
    commit: "a31a75e3",
  });
  assert.throws(
    () => parseBobVersionOutput("2.0.2-rc.1\ncommit: a31a75e3\n"),
    /exactly 2\.0\.2/u,
  );
  assert.throws(
    () => parseBobVersionOutput("9.9.9 using 2.0.2\ncommit: a31a75e3\n"),
    /exactly 2\.0\.2/u,
  );
  assert.throws(
    () => parseBobVersionOutput("2.0.2\ncommit: deadbeef\n"),
    /a31a75e3/u,
  );
  assert.throws(
    () => parseBobVersionOutput("2.0.2\ncommit: a31a75e3\n", "warning"),
    /exactly 2\.0\.2/u,
  );
});

test("isolated candidate environment does not inherit service or CI secrets", () => {
  const previous = {
    BOB_API_KEY: process.env.BOB_API_KEY,
    BOB_TEAM_ID: process.env.BOB_TEAM_ID,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    WXO_API_KEY: process.env.WXO_API_KEY,
    SUPPORT_API_TOKEN: process.env.SUPPORT_API_TOKEN,
  };
  process.env.BOB_API_KEY = "synthetic-bob-value";
  process.env.BOB_TEAM_ID = "synthetic-team-value";
  process.env.GITHUB_TOKEN = "synthetic-github-value";
  process.env.WXO_API_KEY = "synthetic-wxo-value";
  process.env.SUPPORT_API_TOKEN = "synthetic-support-value";
  try {
    const environment = isolatedExecutionEnvironment({
      home: path.resolve("isolated-home"),
      temporaryDirectory: path.resolve("isolated-temp"),
    });
    for (const name of Object.keys(previous)) assert.equal(environment[name], undefined);
    assert.equal(environment.AGENT_MODE, "stub");
    assert.equal(environment.OTEL_ENABLED, "0");
    assert.equal(environment.NEXT_TELEMETRY_DISABLED, "1");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
