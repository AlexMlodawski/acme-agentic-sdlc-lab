import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertBobWorkflowExecutionContext,
  isolatedExecutionEnvironment,
  parseBobVersionOutput,
  parseBobReviewArguments,
} from "./bob-shell-review.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const promptPath = path.join(projectRoot, "examples", "prompts", "04-bob-shell-cicd-review.md");
const guidePath = path.join(projectRoot, "docs", "bob-shell-cicd.md");
const expectedPriorityPaths = [
  "contracts/support-api.yaml",
  "services/support-api/src/config.ts",
  "agents/store_support_agent/agents/store_support_agent.template.yaml",
  "agents/store_support_agent/tools/get_order_status.py",
  "apps/portal/src/app/api/agent/route.ts",
  "apps/portal/src/lib/agent/providerFactory.ts",
  "apps/portal/src/lib/agent/OrchestrateAgentProvider.ts",
  "apps/portal/src/lib/agent/StubAgentProvider.ts",
  "scripts/guided-launcher.mjs",
  "services/support-api/tests/integration/app.test.ts",
  "agents/store_support_agent/tests/test_agent_package.py",
  "agents/store_support_agent/tests/test_get_order_status.py",
  "apps/portal/src/__tests__/agentRoute.test.ts",
  "tests/e2e/local-flow.spec.ts",
  "AGENTS.md",
  ".github/workflows/bob-shell-review.yml",
  "scripts/bob-shell-review.mjs",
  "README.md",
  "docs/ibm-integrations.md",
  "docs/bob-shell-cicd.md",
  "AI_USAGE.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
];

test("requires an exact lowercase candidate SHA and bounded settings", () => {
  assert.throws(() => parseBobReviewArguments([]), /candidate/u);
  assert.throws(() => parseBobReviewArguments(["--candidate", sha.toUpperCase(), "--gate-evidence", "gates.json"]), /lowercase/u);
  assert.throws(() => parseBobReviewArguments(["--candidate", sha, "--gate-evidence", "gates.json", "--max-cost", "6"]), /no more than 5/u);
  assert.throws(() => parseBobReviewArguments(["--candidate", sha, "--gate-evidence", "gates.json", "--max-turns", "31"]), /1 through 30/u);
});

test("uses the bounded production cost and turn defaults", () => {
  const options = parseBobReviewArguments([
    "--candidate", sha,
    "--gate-evidence", "gate-evidence/gates.json",
    "--accept-license",
  ]);
  assert.equal(options.maxCost, 0.5);
  assert.equal(options.maxTurns, 30);
});

test("review prompt uses a tracked bounded priority map and preserves synthesis guidance", () => {
  const prompt = readFileSync(promptPath, "utf8");
  const section = prompt.match(/## Inspection budget and priority map([\s\S]+?)\n## Output contract/u)?.[1];
  assert.ok(section, "priority-map section is missing");

  const priorityPaths = [...section.matchAll(/^\s+- `([^`]+)` —/gmu)].map((match) => match[1]);
  assert.deepEqual(priorityPaths, expectedPriorityPaths);
  assert.ok(priorityPaths.length <= 23);
  assert.equal(new Set(priorityPaths).size, priorityPaths.length);

  const tracked = new Set(execFileSync("git", ["ls-files", "-z"], {
    cwd: projectRoot,
    encoding: "utf8",
  }).split("\0").filter(Boolean).map((value) => value.replaceAll("\\", "/")));
  for (const relativePath of priorityPaths) {
    assert.equal(statSync(path.join(projectRoot, ...relativePath.split("/"))).isFile(), true);
    assert.equal(tracked.has(relativePath), true, `${relativePath} must be tracked`);
  }

  assert.match(section, /Do not begin with a repository-wide listing or recursive survey/u);
  assert.match(section, /controller-supplied\s+`Tracked file manifest`/u);
  assert.match(section, /If it is absent, skip it without a tool call/u);
  assert.match(section, /Use targeted expansion only when/u);
  assert.match(section, /best-effort planning guidance, not a controller-enforced\s+invariant/u);
  assert.match(section, /reserve the final six/u);
});

test("review guide documents independent caps and fail-closed exhaustion", () => {
  const guide = readFileSync(guidePath, "utf8");
  assert.match(guide, /--max-cost 0\.5 --max-turns 30/u);
  assert.match(guide, /These\s+are independent caps/u);
  assert.match(guide, /best-effort guidance to reserve the\s+final six turns/u);
  assert.match(guide, /If\s+either the cost or turn ceiling is exhausted[\s\S]+execution remains `not_completed`/u);
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
