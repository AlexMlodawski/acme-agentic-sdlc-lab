# Human-governed agentic SDLC workshop

This workshop uses the Acme customer-support lab to demonstrate a simple rule:

> AI output is a candidate contribution. Tests produce evidence. A human owns the
> release decision.

The supported core path is local, deterministic, loopback-only, and uses fictional
data. It does not require an IBM account or application credential. IBM Bob can be
used for the plan and implementation exercise when the facilitator and participants
have an authorized, licensed installation. watsonx Orchestrate Draft and Instana are
optional extensions; their source adapters may be inspected without claiming that an
external tenant accepted an import, invoked a tool, retrieved knowledge, or received a
trace.

## Guide map

- [Workshop at a glance](#workshop-at-a-glance)
- [Before the workshop](#before-the-workshop)
- [Core workshop agenda](#core-workshop-agenda)
- [Stages 0-7: requirement through evidence](#stage-0-open-with-the-decision-boundary)
- [Stage 8: Bob Shell advisory review](#stage-8-add-a-bob-shell-ci-advisory-review)
- [Stages 9-10: human decision and cleanup](#stage-9-make-the-human-decision)
- [Optional tenant-backed extensions](#optional-tenant-backed-extensions)
- [Fallback matrix](#facilitator-fallback-matrix)
- [Completion record](#completion-record)

## Workshop at a glance

| Path | Purpose | Account requirement | Status represented by this repository |
| --- | --- | --- | --- |
| Core local/mock | Run, change, test, and evaluate the fictional Acme journey | None after dependencies are installed | Implemented and locally testable |
| Bob IDE exercise | Produce a plan, wait for human approval, and implement a bounded change | Authorized, licensed Bob installation | Prompt choreography is supplied; execution must be observed separately |
| Draft artifact review | Inspect and validate the agent, read-only tool, and knowledge source offline | None for source inspection and offline validation | Source package supplied |
| Bob Shell CI advisory review | Add an independent, bounded recommendation for an exact candidate | Authorized Bob Shell runtime, protected credential, and isolated runner | Manual controller is shipped and contract-tested; authenticated execution must be observed separately |
| WXO Draft tenant exercise | Import and test a reviewed Draft resource | Authorized WXO tenant and current compatible tooling | Optional; external execution is `not_asserted` |
| Instana observation | Look for a candidate-correlated application trace | Authorized Instana tenant and read-only access | Optional; external receipt is `not_asserted` |

Suggested duration is 165 minutes for the core path, excluding dependency downloads.
Allow another 30-45 minutes for an authorized Bob Shell review and another 30-45
minutes for any prevalidated tenant-backed extension. A ten-minute presenter-only
version is available in [the demo guide](demo-guide.md).

## Learning outcomes

By the end of the core workshop, participants should be able to:

1. explain the difference between an AI-produced change, deterministic validation,
   an advisory review, and a human release decision;
2. run the portal, Support API, assistant, and support-case journey without secrets;
3. trace browser, portal, provider, API, and evidence trust boundaries;
4. use a plan-only prompt and stop for human review before implementation;
5. implement and verify a support-case recommendation without allowing the assistant
   to submit a case;
6. distinguish `pass`, `fail`, `not_completed`, and `not_asserted`;
7. bind evidence and any recommendation to one exact Git commit; and
8. leave optional external claims unasserted unless direct, sanitized evidence exists.

## Roles

- **Facilitator:** owns scope, timing, environment readiness, safety instructions,
  optional service access, and the final workshop decision record.
- **Participant:** runs the local journey, reviews the plan, implements or reviews the
  candidate, executes checks, and reports observed evidence.
- **AI builder:** proposes a plan and, only after approval, may produce a bounded
  candidate change.
- **Advisory reviewer:** independently assesses the exact candidate. It cannot repair,
  merge, tag, publish, deploy, import, or promote it.
- **Human release owner:** decides whether the exact candidate is acceptable and
  separately authorizes every external action.

One person may perform several human roles, but the builder and reviewer viewpoints
should remain visibly separate.

## Before the workshop

### 1. Freeze the material

Select one exact commit for the workshop and record its full SHA:

```text
git rev-parse HEAD
```

Give participants access to that commit through the approved repository or a verified
source archive. Do not rely only on a mutable branch name. Confirm that the starting
worktree is clean and that no participant receives credentials, private tenant URLs,
browser profiles, customer data, or unrestricted logs.

If participants will commit their exercise, agree on suitable Git attribution before
the session. Do not expose a private email address in an artifact that will be shared.

### 2. Prepare the toolchain

The verified toolchain is:

- Git;
- Node.js `24.19.0` and npm `11.17.0`;
- Python `3.12.10` and `uv` `0.12.0`; and
- Chromium installed through the repository's locked Playwright dependency.

Dependency and browser installation may require Internet access. Once installed, the
core application journey is intended to remain on loopback. Ensure ports `3000`,
`3100`, `4000`, and `4100` are available, or preconfigure distinct supported
Playwright ports.

On every participant image, run:

```text
npm run doctor
npm run install:project
npx --no-install playwright install chromium
npm run preflight
```

Do not skip `doctor` and silently use a different runtime. Use the
[troubleshooting guide](troubleshooting.md) when a prerequisite fails.

### 3. Rehearse the complete local path

From a clean participant-like checkout, the facilitator should run:

```text
npm run verify
npm run e2e:local
npm run e2e:built
```

Then start the product with `npm run up`, complete the manual journey described below,
and stop both child services with `Ctrl+C`. Record failures instead of modifying the
workshop acceptance criteria to fit the room environment.

### 4. Prepare the Bob path, if used

The repository does not redistribute Bob, its credentials, or its authenticated
state. Before promising a live Bob exercise, the facilitator must verify:

- the intended Bob product and version are installed and licensed for that audience;
- participants are authorized to use it;
- authentication is supplied through approved protected storage;
- no key will be pasted into chat, source, screenshots, shell history, or evidence;
- the exercise workspace is isolated from unrelated files and credentials; and
- the exact plan-only stop and human approval gate have been rehearsed.

If Bob is unavailable, participants may still write and review the plan, implement
the same bounded change manually, and complete the local evidence path. Record Bob
execution as `not_completed`; do not attribute the resulting commit to Bob.

### 5. Prepare optional tenant-backed extensions separately

Do not make WXO or Instana access a dependency of the core workshop. If either is
shown, prepare a dedicated non-production environment, fictional Acme data, current
official product instructions, protected credentials, and a tested cleanup plan.

For WXO, name the exact tenant, workspace, and Draft operation in the human
authorization. Review the generated definition before import and stop before Live
promotion. For Instana, keep investigation read-only and plan how correlation data
will be sanitized. A successful local response or exporter diagnostic is not evidence
of tenant-side tool use, retrieval, ingestion, or indexing.

### 6. Prepare room logistics and recovery

Have these items ready:

- the starting SHA and a verified source archive;
- a facilitator checkout that participants do not modify;
- the expected local screenshot and fictional order IDs;
- a copy of the plan-only prompt;
- a known-good local demonstration in case a participant machine fails;
- a timing sheet and checkpoints from this guide;
- enough download time or a prewarmed dependency/browser cache consistent with local
  policy; and
- a reset procedure that never uses a broad recursive delete.

The core workshop must remain useful when Bob, WXO, Instana, or the Internet is
unavailable after setup.

## Evidence vocabulary

Use these states exactly:

| State | Meaning |
| --- | --- |
| `pass` | The stated check completed and its evidence supports that exact claim. |
| `fail` | The check completed and found a blocker. |
| `not_completed` | Execution did not reach or finish the check. |
| `not_asserted` | Available evidence cannot support the claim. |

A source adapter is not a live run. A browser answer is not proof of an internal tool
call. A correlation ID is not a distributed trace. A review recommendation is not
release approval.

## Core workshop agenda

| Stage | Suggested time | Checkpoint |
| --- | ---: | --- |
| 0. Opening and candidate identity | 10 min | Starting SHA and clean state recorded |
| 1. Local customer journey | 20 min | Happy path and safe failure path observed |
| 2. Architecture and trust boundaries | 15 min | Participant can explain where secrets and decisions live |
| 3. Draft artifacts, offline | 15 min | Agent package and read-only boundary understood |
| 4. Bob IDE plan-only exercise | 15 min | A reviewable plan exists; no files changed yet |
| 5. Human plan gate and implementation | 30 min | Bounded candidate diff exists |
| 6. Deterministic verification | 30 min | Focused and full results recorded honestly |
| 7. Evidence and advisory review | 10 min | Evidence is bound to an exact candidate |
| 8. Bob Shell advisory review | Optional 30-45 min | Authenticated report exists, or execution is recorded honestly as incomplete |
| 9. Human decision | 15 min | Human disposition and remaining limitations recorded |
| 10. Cleanup | 5 min | Workshop processes are stopped and bounded cleanup status is recorded |

## Stage 0: Open with the decision boundary

1. Read the release statement in [release scope](release-scope.md).
2. Record the starting commit:

   ```text
   git rev-parse HEAD
   git status --short
   ```

3. Ask participants which claims source inspection, unit tests, browser tests, and an
   external trace can each support.
4. Introduce the four evidence states above.

**Expected result:** everyone can state that this is an educational local foundation,
not a production service or autonomous release platform.

## Stage 1: Run the local customer journey

Start the foreground services:

```text
npm run up
```

Open `http://127.0.0.1:3000` and perform the happy path:

1. Search for `ACME-1042` and observe the delayed order.
2. Open **Order assistant**.
3. Ask: `What is the status of this order, and what is the standard return window?`
4. Observe the order facts and fictional return-policy guidance.
5. Select a support priority, enter a fictional description of at least ten
   characters, and explicitly submit the sample case.
6. Confirm that the receipt says no real external ticket was created.

Then exercise two safe failures:

1. Search for `not-an-order` and observe local format validation.
2. Search for `ACME-4040` and observe a safe not-found response without an internal
   stack trace.

Stop the services with `Ctrl+C`.

**Expected result:** the participant has observed a real portal and API process, a
deterministic assistant, a manually submitted synthetic case, and bounded public
errors. This is local/mock evidence only.

## Stage 2: Trace architecture and trust boundaries

Use [architecture](architecture.md), [runtime flow](runtime-flow.md), and
[data flow](data-flow.md) to follow three paths:

1. browser -> same-origin portal route -> Support API -> fictional order fixture;
2. browser -> portal assistant route -> selected provider -> normalized response; and
3. browser -> portal case route -> Support API -> non-persistent acknowledgement.

Locate the strict `priority` field in `contracts/support-api.yaml`. Discuss why
credentials remain server-side, why local HTTP is loopback-only, why integrated
failures do not silently fall back to a local provider, and why the customer must
remain the actor who submits a support case.

**Checkpoint:** each group should be able to name the browser, server, external
provider, telemetry, and release-decision trust boundaries.

## Stage 3: Inspect the Draft artifacts offline

Review these source artifacts:

- `agents/store_support_agent/agents/store_support_agent.template.yaml`;
- `agents/store_support_agent/tools/get_order_status.py`;
- `agents/store_support_agent/knowledge_bases/acme_return_policy.yaml`; and
- `agents/store_support_agent/knowledge/return-policy.txt`.

Run the repository-owned offline validation through:

```text
npm run verify:agent
```

Discuss the properties that must survive any future tenant exercise:

- the order tool is read-only;
- the API endpoint and optional token are operator-owned configuration;
- HTTPS is required outside exact loopback;
- credentials are not embedded in YAML;
- the package uses fictional content; and
- local validation does not prove tenant import, invocation, or retrieval.

Materialization is optional and requires a model identifier already reviewed for the
intended tenant. It creates a local file for inspection; it does not import anything:

```text
cd agents/store_support_agent
uv run python scripts/materialize_agent.py --model-id <reviewed-model-id> --output .generated/store_support_agent.yaml
```

If no reviewed model identifier exists, do not invent one. Mark materialization
`not_completed` and continue with the checked-in template.

## Stage 4: Run the Bob IDE plan-only exercise

The bounded change is deliberately absent from the starting implementation:

> After explaining that an order is delayed, the contextual assistant may recommend
> creating a support case. It must never create or submit that case automatically.

The customer must review the attached order context, choose `priority`, enter or
review the description, and explicitly submit the existing form.

Create a local workshop branch if the facilitator permits participant edits. Record
the baseline SHA before starting. Then give the AI builder the complete prompt in
[`examples/prompts/01-bob-plan-only.md`](../examples/prompts/01-bob-plan-only.md).

The builder must:

- inspect the repository;
- produce an implementation and verification plan;
- make no file change;
- run no mutating command; and
- stop for human review.

**Hard checkpoint:** verify `git status --short` before and after plan generation. If
the worktree changed, the plan-only stage is `fail`; inspect and restore the intended
starting state safely before continuing.

## Stage 5: Apply the human plan gate and implement

Review the plan against this acceptance checklist:

- a delayed-order response explains status before recommending the case path;
- the recommendation is bounded guidance, not a promise of resolution;
- asking the assistant alone causes no `POST /api/support-cases` request;
- the existing customer-controlled form remains the only submission path;
- order context is visible and reviewable;
- the customer chooses the exact `priority` contract value;
- shipped or delivered orders do not receive a misleading delayed-order
  recommendation;
- credentials and backend URLs remain out of browser code;
- keyboard, loading, retry, reset, and error behavior are preserved; and
- focused unit and browser coverage is planned.

Reject or revise a plan that weakens any boundary. Only after the human accepts the
plan may they send the exact continuation in
[`examples/prompts/02-go.md`](../examples/prompts/02-go.md).

Review the resulting diff. The minimum observable behavior is an assistant response
that recommends the existing manual case path for the delayed scenario. A clickable
CTA is optional only if it remains accessible and still requires explicit customer
submission. Do not accept a hidden API call, auto-filled submission side effect, or
automatic ticket creation.

If Bob performed the change, attribute only the exact observed candidate created in
that session. Tool availability or use of the prompt does not retroactively establish
Bob authorship.

## Stage 6: Run deterministic verification

Run focused tests first. At minimum, require tests that establish:

1. a delayed response contains the bounded support-case recommendation;
2. non-delayed behavior is not misleading;
3. the assistant interaction does not submit a case;
4. explicit form submission still produces the synthetic acknowledgement; and
5. existing reset, safe-error, contract, and credential boundaries remain intact.

Then run the repository gates:

```text
npm run preflight
npm run verify
npm run e2e:local
npm run e2e:built
```

Record the exact command, exit code, useful summary, and limitation for every check.
Do not rerun only the failing fragment and present it as though the complete sequence
passed. A passed local browser test does not establish WXO or Instana behavior.

After human diff review, create a local commit if the full candidate-audit stage will
be used. Record the resulting full SHA and confirm the worktree is clean.

## Stage 7: Create candidate-bound evidence

For a clean committed candidate, run a unique workshop label:

```text
git rev-parse HEAD
git status --short
npm run release:audit -- --mode Full --candidate workshop-rc-01
```

The candidate label must not contain a name, email, credential, or private identifier.
The audit refuses to overwrite an existing evidence directory, so use a deliberate
new label for a genuinely new candidate rather than deleting prior evidence.

Treat the bundle as complete only when `evidence-complete.json` exists, reports a
passing completion state, matches the candidate and source SHA, and binds the report
to its checksum manifest. The audit stops at evidence. It does not approve, merge,
tag, publish, deploy, import, or promote.

If workshop time does not permit the Full audit, use previously generated evidence
only when it is demonstrably bound to the exact same candidate. Otherwise mark this
stage `not_completed`.

## Stage 8: Add a Bob Shell CI advisory review

This repository ships `review:bob`, `review:bob:validate`, and a manual exact-SHA
workflow. Do not show a synthetic report as if it came from Bob. This stage therefore
has two honest modes.

### Mode A: authorized controller available

Use the checked-in controller only from an approved, ephemeral runner. Its contract
requires:

1. manual initiation from a protected controller revision;
2. an exact, human-approved 40-character candidate SHA;
3. a credential-free deterministic job that only runs the fixed command list;
4. GitHub service-controlled `needs` success before a fresh advisory job starts;
5. `gates.json` created locally in that advisory job, with no gate artifact transfer;
6. separate disposable gate and pristine review workspaces;
7. an operating-system-isolated runner for the credentialed review;
8. a protected, step-scoped `BOB_API_KEY` and, when a general key requires it,
   protected `BOB_TEAM_ID`, both exposed only to the final Bob process and never
   entered as manual dispatch inputs;
9. a disposable Bob profile with explicit human license consent;
10. disabled mutation-capable tools, MCP, and subagents;
11. bounded wall time, cost, turns, and in-memory terminal JSON parsing;
12. rejection of `.bob/`, `.bobignore`, `.bobrules`, `.bobrules-*`, nested
    `AGENTS.md`, unsafe filesystem links, hidden project instructions, command hooks,
    tracked secret files, and submodules outside the review contract;
13. separate Git identity/status guards plus a before/after byte snapshot of tracked
    worktree content that excludes `.git`;
14. a strict, public-safe machine-readable report tied to the candidate SHA, with no
    automatic overwrite of existing evidence; and
15. a human-owned final decision.

The advisory reviewer receives the acceptance criteria, the complete tracked source
of the exact candidate, and a fixed same-run pass record listing the deterministic
commands. It does not receive a selected diff, pull-request scope, test logs, or
sanitized test summaries. It inspects but does not repair. It must distinguish
completed checks from unavailable evidence and must not claim WXO tool use, knowledge
retrieval, Instana receipt, or Bob authorship beyond the observed session.

Use the manual GitHub workflow for the public exercise. The low-level
`npm run review:bob` entrypoint is intentionally Linux-only and exists for the
trusted controller path; it is not a cross-platform workshop shortcut.

Retain a report only when controller validation and mutation guards succeed. The
report contains candidate/controller SHAs, one `reviewedAt` timestamp, Bob version,
guards, caps, gate identity/list, sanitized findings and `notAsserted` items, the
recommendation, and completion hashes. It does not retain start/finish pairs, process
exit metadata, or the raw terminal stream, and an existing output is not overwritten.
Keep review execution status separate from recommendation: a review may complete
while recommending remediation, and a failed reviewer invocation says nothing by
itself about product correctness.

### Mode B: controller unavailable

Run `npm run test:bob-review`, walk through the contract above, and inspect the
repository's ordinary CI and release-audit evidence. Record authenticated Bob Shell
review as `not_completed`. Continue to the human gate; never replace the missing
review with fabricated `pass` evidence.

In both modes, a Bob recommendation is advisory. It cannot authorize a merge, tag,
publication, deployment, tenant import, or Live promotion.

## Stage 9: Make the human decision

Use [the release checklist](../.github/RELEASE_CHECKLIST.md) as a discussion aid. For
the workshop candidate, review together:

- exact candidate SHA and clean state;
- the implementation diff and acceptance criteria;
- focused, full, local-browser, and built-browser results;
- complete or incomplete release evidence;
- advisory findings and unresolved `not_completed` items;
- optional integrations that remain `not_asserted`;
- privacy, security, licensing, asset, and public-claim boundaries; and
- what additional evidence would be required before any real release.

Record one of these workshop dispositions in plain language:

- technically acceptable for the bounded local exercise;
- remediation required before reconsideration; or
- insufficient evidence to decide.

This record is not a public-release authorization. A real release requires a named
owner's separate `GO` for the exact candidate after all applicable human and external
gates.

## Stage 10: Stop and clean up safely

Stop foreground services with `Ctrl+C` before cleanup.

To remove generated build and test state while preserving dependencies and release
evidence:

```text
npm run reset
```

To additionally remove project-local npm and Python dependencies:

```text
npm run uninstall:project
```

Do not use `npm run purge:evidence` as routine workshop cleanup. It intentionally
deletes retained local release evidence and should run only after the exact target and
retention decision are reviewed.

## Optional live IBM extension

Only an explicitly authorized facilitator should perform this extension. The core
workshop is already complete without it.

### watsonx Orchestrate Draft

Follow the current official ADK documentation rather than treating repository source
as a deployment command. Before any import:

1. verify the active tenant and workspace;
2. confirm product licensing and model availability;
3. materialize and review the exact agent definition;
4. configure `acme_support_api` through protected tenant credential storage;
5. keep all data fictional;
6. import only into Draft; and
7. stop before deployment or Live promotion unless separately authorized.

A portal response labeled `source=orchestrate` establishes routing through the
adapter only. Tool invocation and knowledge retrieval require their own direct,
sanitized evidence tied to the same candidate and run.

### Instana

Enable telemetry only with reviewed server-side configuration. Keep the investigation
read-only and retain only bounded, sanitized correlation evidence. An exporter
diagnostic can support an export-attempt claim; only a direct tenant observation can
support receipt or trace-search claims.

If any tenant check is unavailable, unfinished, or cannot be sanitized, leave it
`not_completed` or `not_asserted` and return to the local evidence path.

## Facilitator fallback matrix

| Problem | Safe response | Evidence state |
| --- | --- | --- |
| Dependency registry unavailable before installation completes | Use a previously verified room image or demonstrate from the facilitator machine | Participant installation `not_completed` |
| Chromium installation fails | Run non-browser checks and show candidate-bound browser evidence only if it matches the exact SHA | Participant browser run `not_completed` |
| Port already in use | Stop the known owner or use supported distinct Playwright ports; do not kill an unidentified process | Depends on completed retry |
| Bob unavailable or unauthenticated | Use plan review plus manual implementation; do not attribute the change to Bob | Bob execution `not_completed` |
| Bob produces an invalid or mutating result | Reject the result and restore the approved candidate safely | Bob review `fail` |
| WXO tenant unavailable | Continue with local/mock and inspect Draft source only | Tenant behavior `not_asserted` |
| Instana trace not found | Keep exporter and tenant-receipt claims separate | Receipt `not_asserted` or check `fail`, depending on what completed |
| A deterministic check fails | Preserve the bounded evidence and make a remediation plan | Check `fail` |
| Full audit exceeds workshop time | Do not infer completion from partial output | Audit `not_completed` |

## Completion record

Finish each workshop with a short record containing no secrets or private machine
paths:

| Item | Value |
| --- | --- |
| Starting SHA | Full 40-character SHA |
| Candidate SHA | Full 40-character SHA or `not_completed` |
| Bob IDE plan | `pass`, `fail`, or `not_completed` |
| Human plan approval | Recorded decision and scope |
| Focused tests | Commands and statuses |
| Full verification | Commands and statuses |
| Local browser acceptance | Status and bounded evidence |
| Built browser acceptance | Status and bounded evidence |
| Release audit | Candidate label and status |
| Bob Shell advisory review | Status and report identity, or `not_completed` |
| WXO Draft execution | Narrow observed claim or `not_asserted` |
| Instana receipt | Narrow observed claim or `not_asserted` |
| Human workshop disposition | Local exercise decision and remaining work |

Do not include API keys, tokens, cookies, auth headers, tenant exports, private URLs,
production data, raw private prompts, unrestricted logs, or model chain-of-thought.

## Claims after the workshop

It is reasonable to say that participants exercised a deterministic local portal and
API, practiced a human approval gate, ran the checks they actually completed, and
created candidate-bound evidence when the audit finished.

Do not claim that:

- this is an official IBM reference architecture;
- Bob created or reviewed a commit unless that exact session and candidate were
  observed;
- a local response came from WXO;
- response text proves an internal tool call or knowledge retrieval;
- an exporter attempt proves Instana received a trace;
- Draft means Live or production-ready;
- a valid advisory report is human release approval; or
- workshop completion establishes production readiness, legal clearance, complete
  accessibility conformance, or security certification.

The strongest workshop outcome is a transparent chain from requirement, through
plan, human authorization, bounded implementation, deterministic tests, independent
advice, candidate-bound evidence, and a final human decision.
