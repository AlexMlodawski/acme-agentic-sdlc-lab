import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/bob-shell-review.yml", import.meta.url);

test("Bob Shell workflow is manual, read-only, exact-SHA, and action-pinned", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule):/mu);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/u);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(workflow, /runs-on: \[self-hosted, linux, bob-shell, ephemeral\]/u);
  assert.match(workflow, /environment: bob-review/u);
  assert.match(workflow, /deterministic-gates:[\s\S]+runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /advisory-review:[\s\S]+needs: deterministic-gates/u);
  assert.doesNotMatch(workflow, /actions\/download-artifact@/u);
  assert.match(workflow, /GATE_JOB_RESULT: \$\{\{ needs\.deterministic-gates\.result \}\}/u);
  assert.match(workflow, /if \[\[ "\$GATE_JOB_RESULT" != "success" \]\]/u);
  assert.match(workflow, /working-directory: controller\s+run: npm ci --ignore-scripts/u);
  assert.match(workflow, /--gate-evidence "\$GITHUB_WORKSPACE\/gate-evidence\/gates\.json"/u);
  assert.match(workflow, /persist-credentials: false/gu);
  assert.match(workflow, /BOB_API_KEY: \$\{\{ secrets\.BOB_API_KEY \}\}/u);
  const actionUses = [...workflow.matchAll(/^\s+uses:\s+([^\s#]+)/gmu)].map((match) => match[1]);
  assert.ok(actionUses.length >= 4);
  for (const use of actionUses) assert.match(use, /@[0-9a-f]{40}$/u);
});

test("Bob credential is scoped to the one review step", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.equal((workflow.match(/BOB_API_KEY:/gu) ?? []).length, 1);
  assert.equal((workflow.match(/BOB_TEAM_ID:/gu) ?? []).length, 1);
  assert.match(workflow, /BOB_TEAM_ID: \$\{\{ secrets\.BOB_TEAM_ID \}\}/u);
  assert.doesNotMatch(workflow, /^\s+team_id:/mu);
  assert.match(workflow, /if: \$\{\{ steps\.bob_review\.outcome == 'success'.*source_guard\.outcome == 'success' \}\}/u);
});
