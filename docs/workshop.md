# Bob IDE to watsonx Orchestrate Draft workshop

This workshop presents one governed implementation path for the fictional Acme
Store Support Agent:

> Bob IDE plans and prepares the agent, a human authorizes the tenant write,
> watsonx Orchestrate runs it in Draft, the existing portal consumes it, tests
> produce evidence, Bob Shell adds advisory review, and a human makes the final
> decision.

Participants do not build a backend from scratch. The repository already contains
the Support API, portal adapter, read-only Python tool, knowledge source, agent
template, fixtures, tests, and evidence tooling. The participant uses Bob IDE to
inspect those assets, select a real model from the authorized tenant, materialize a
reviewable definition, and then import only the reviewed resources to WXO Draft.

The main path is account-backed and requires facilitator preparation. The
loopback-only mock profile remains a deterministic, zero-secret fallback. Neither
path authorizes WXO Live, production deployment, automatic release, or publication.

## Guide map

- [Workshop at a glance](#workshop-at-a-glance)
- [What the facilitator prepares](#what-the-facilitator-prepares)
- [Evidence vocabulary](#evidence-vocabulary)
- [Workshop stages](#workshop-stages)
- [Fallback matrix](#facilitator-fallback-matrix)
- [Completion record](#completion-record)
- [Claims after the workshop](#claims-after-the-workshop)

## Workshop at a glance

```text
Bob IDE plan -> local build -> human Draft gate -> WXO Draft import
             -> guided portal -> acceptance -> optional Instana
             -> deterministic checks -> evidence -> Bob Shell advice
             -> human decision -> cleanup
```

| Stage | Suggested time | Human checkpoint |
| --- | ---: | --- |
| 0. Candidate and boundary | 10 min | Exact starting SHA and Draft-only scope recorded |
| 1. Bob IDE plan | 15 min | Plan reviewed; worktree unchanged |
| 2. Bob IDE local build | 20 min | Model, materialized YAML, and offline checks reviewed |
| 3. Draft authorization and import | 25 min | Exact environment and four allowed resources approved |
| 4. Guided portal connection | 15 min | WXO profile starts without exposing credentials |
| 5. Account-backed acceptance | 20 min | User-visible behavior and evidence limits recorded |
| 6. Optional Instana observation | 15 min | Tenant receipt observed or left unasserted |
| 7. Deterministic verification | 30 min | Focused and full checks recorded honestly |
| 8. Candidate-bound evidence | 15 min | Evidence matches the exact candidate SHA |
| 9. Bob Shell advisory review | Optional 30-45 min | Exact-candidate report exists, or the claim is `not_asserted`; an unfinished run is `not_completed` |
| 10. Human decision and cleanup | 10 min | Disposition and cleanup record completed |

Allow about 175 minutes without Bob Shell. Dependency downloads, tenant setup, and
public endpoint setup belong in facilitator preparation, not in workshop time. The
[ten-minute demo guide](demo-guide.md) is a rehearsed presenter version of the same
story.

## Learning outcomes

By the end, participants should be able to:

1. use Bob IDE with a plan-only stop and an explicit continuation;
2. distinguish local materialization from a WXO tenant import;
3. identify the exact human authorization boundary before a Draft write;
4. connect the existing portal to a reviewed WXO agent without browser-side secrets;
5. explain why routing, tool invocation, knowledge retrieval, and trace receipt need
   separate evidence;
6. keep support-case submission under direct user control;
7. run deterministic checks and bind release evidence to one Git commit;
8. treat Bob Shell as an advisory reviewer rather than a release authority; and
9. leave every missing external observation as `not_completed` or `not_asserted`.

## Roles

- **Facilitator:** prepares the tenant, public Support API, protected credentials,
  licensed tools, fallbacks, timing, and cleanup plan.
- **Participant:** reviews Bob's plan, checks the generated definition, confirms
  observed behavior, and records evidence.
- **Bob IDE assistant:** inspects the prepared sources, plans, and performs only the
  locally or tenant-scoped work a human has explicitly authorized.
- **WXO operator:** verifies the active remote environment and owns every Draft write.
- **Advisory reviewer:** assesses an exact committed candidate without repairing,
  merging, tagging, publishing, importing, deploying, or promoting it.
- **Human release owner:** makes the final decision after reviewing all completed and
  missing evidence.

One person may hold several human roles, but the builder, reviewer, and decision
viewpoints should remain visibly separate.

## What the facilitator prepares

### 1. Freeze and sanitize the workshop source

Select one exact commit and record its full SHA:

```text
git rev-parse HEAD
git status --short
```

Provide that commit through the approved repository or a verified source archive.
Confirm that the worktree is clean and that participants receive no API keys, auth
state, private tenant URLs, browser profiles, customer data, or unrestricted logs.
Use only the fictional Acme records shipped with the repository.

If participants will commit changes, agree on public-safe Git attribution before the
session.

### 2. Prepare the local toolchain

The repository pins or verifies:

- Node.js `24.19.0` and npm `11.17.0`;
- Python `3.12.10` and `uv` `0.12.0`;
- watsonx Orchestrate ADK `2.15.0` through the Python project; and
- Chromium through the locked Playwright dependency.

On every participant image, run from the repository root:

```text
npm run doctor
npm run install:project
npx --no-install playwright install chromium
npm run preflight
```

Ensure ports `3000`, `3100`, `4000`, and `4100` are available, or preconfigure
distinct supported Playwright ports. Installation may require Internet access.

### 3. Prepare Bob IDE

The repository does not redistribute Bob, its license, credentials, or authentication
state. Before advertising a live Bob exercise, verify that:

- the intended Bob IDE installation is licensed and authorized for the audience;
- the repository opens in its own isolated workspace;
- the root `AGENTS.md` instructions are visible to Bob;
- no credential will be pasted into Bob chat, source, screenshots, or evidence; and
- the plan-only stop and later human continuation have been rehearsed.

The copy-paste prompts are intentionally split so that a single prompt cannot silently
cross from inspection into a tenant write.

### 4. Prepare the WXO Draft environment

Use a dedicated trial or non-production environment. The facilitator must know the
environment name, service instance API URL, and current API key, but participants do
not need copies of the key.

Before the workshop:

1. verify the pinned CLI with `uv run orchestrate --version` from
   `agents/store_support_agent`;
2. list environments with `uv run orchestrate env list`;
3. activate the intended remote environment interactively with
   `uv run orchestrate env activate <environment-name>`;
4. list real tenant model IDs with `uv run orchestrate models list --raw`; and
5. rehearse Draft resource listing and the three starter questions.

An active environment alias is not proof that its authentication is still valid.
Remote sessions can expire, so be ready to reactivate in the interactive terminal.
Enter the API key only at the CLI or guided launcher's masked prompt. Never pass it in
Bob chat, a command-line argument, a file, Git, or captured evidence.

The workshop imports only these identities:

| Resource | Identity | Boundary |
| --- | --- | --- |
| Draft connection | `acme_support_api` | Created/configured by the facilitator before participant import |
| Python tool | `get_order_status` | Read-only order lookup |
| Knowledge base | `acme_return_policy` | Fictional return-policy content |
| Native agent | `store_support_agent` | Draft only; never promoted to Live |

If a resource with one of these names already exists, inspect it before the session.
Do not plan a silent overwrite. Either use a dedicated clean environment or rehearse
the ADK `--safe` confirmation with the exact reviewed resource.

### 5. Provide a public HTTPS Support API for the WXO tool

WXO cannot invoke a service that exists only at `127.0.0.1`. Before the participant
imports the tool, the facilitator must expose the fictional Support API through a
reviewed, temporary or dedicated HTTPS endpoint that the WXO tenant can reach.

The repository does not create production ingress. If the API binds beyond loopback,
it fails closed unless `SUPPORT_API_REQUIRE_AUTH=1` and a server-side
`SUPPORT_API_TOKEN` is present. Put it behind a reviewed TLS boundary, limit it to
fictional data, set an expiry, and document how it will be stopped.

Configure the Draft connection `acme_support_api` through the WXO credential UI:

- `base_url`: the public HTTPS base URL; and
- `api_token`: the protected bearer value, when the endpoint requires it.

The token belongs in protected tenant configuration, not in the agent YAML or a Bob
prompt. Test reachability from outside the facilitator's local network and rehearse a
successful `ACME-1042` lookup before the workshop. The local Support API started by
`npm run guided` is still loopback-only; it is not automatically the public endpoint
used by the WXO tool.

### 6. Prepare optional Instana access

The guided launcher can export application traces directly to Instana blue SaaS over
OTLP/HTTP. A machine-wide Instana agent or OpenTelemetry Collector is not required for
this application-only exercise.

If this stage will be shown, prepare:

- an Instana Agent Key from the authorized tenant, not a general read API token;
- a public-safe logical host label;
- read-only UI access for the trace search; and
- a retention and screenshot policy that excludes keys, private URLs, and unrelated
  telemetry.

The launcher fixes the destination to the supported blue SaaS OTLP/HTTP endpoint and
passes the key only to the server-side Support API child. It generates a synthetic
correlation ID for the session.

### 7. Prepare Bob Shell separately

Bob Shell is not run by `npm run guided`. The optional CI stage requires:

- Bob Shell `2.0.2` on a fresh operating-system-isolated Linux runner;
- a protected GitHub Environment and an ephemeral self-hosted runner;
- `BOB_API_KEY`, and `BOB_TEAM_ID` only when the issued key requires it, stored as
  protected Environment secrets;
- the exact committed candidate SHA; and
- a rehearsed teardown that destroys the runner and its disk.

Read [Bob Shell in CI/CD](bob-shell-cicd.md) before the session. If this environment is
not already ready, present the controller contract and mark the review claim
`not_asserted`; use `not_completed` only when an authorized run started but did not
finish. Do not improvise a credentialed run on a participant machine.

### 8. Rehearse the complete path and fallback

From a clean participant-like checkout, run:

```text
npm run verify
npm run e2e:local
npm run e2e:built
```

Then rehearse the Bob prompts, Draft import in the dedicated environment, guided WXO
portal journey, optional Instana query, and cleanup. Keep a known-good local/mock
demonstration and sanitized screenshots ready. A workshop should remain useful if
Bob, WXO, Instana, or the public endpoint is unavailable during the session.

## Evidence vocabulary

Use these states exactly:

| State | Meaning |
| --- | --- |
| `pass` | The stated check completed and its evidence supports that exact claim. |
| `fail` | The check completed and found a blocker. |
| `not_completed` | Execution did not reach or finish the check. |
| `not_asserted` | Available evidence cannot support the claim. |

Keep these claims separate:

| Observation | What it can support | What it cannot support by itself |
| --- | --- | --- |
| Bob returned a plan and `git status` stayed clean | Plan-only behavior for that session | Correct implementation or tenant import |
| Local materialization and tests passed | Source/YAML validity under checked-in checks | WXO acceptance or runtime behavior |
| WXO list output shows a Draft resource | Resource presence in that environment | Successful tool call or knowledge retrieval |
| Portal badge says `watsonx Orchestrate` | Portal routed through the WXO provider for that response | Internal tool invocation, knowledge provenance, or Draft/Live status |
| Answer contains order or policy facts | User-visible answer semantics | Which internal source produced those facts |
| Exporter diagnostic reports success | A bounded export attempt/result | Instana indexing or search visibility |
| Instana tenant search returns the matching trace | Receipt visible in that tenant for the correlation | Production readiness or complete observability |
| Bob Shell report validates | Advisory review completed for its exact SHA | Human release approval |

A correlation ID is not a trace, an adapter is not a tenant run, and a recommendation
is not a release decision.

## Workshop stages

## Stage 0: Record the candidate and decision boundary

1. Read [release scope](release-scope.md) and the root `AGENTS.md`.
2. Record:

   ```text
   git rev-parse HEAD
   git status --short
   ```

3. Confirm the intended remote WXO environment is non-production and all writes stop
   at Draft.
4. Identify who may authorize the Draft import and who owns the final decision.
5. Introduce the four evidence states above.

**Checkpoint:** everyone can explain that the workshop prepares and tests a Draft
agent; it does not publish a production service or promote anything to Live.

## Stage 1: Ask Bob IDE for a plan

Open the repository in Bob IDE and paste the complete
[`01-bob-plan-only.md`](../examples/prompts/01-bob-plan-only.md) prompt.

Bob should inspect the existing agent template, tool, knowledge source,
materialization script, portal adapter, and integration guide. It should propose the
exact sequence from environment verification through Draft import and portal
connection. It must not edit a file or run a mutating command.

Compare the worktree before and after:

```text
git status --short
```

Review the plan for these boundaries:

- the tenant model is discovered, never invented;
- credentials are entered only in interactive masked prompts;
- `acme_support_api` is configured separately by the facilitator;
- only the four named Draft resources are in scope;
- import, deployment, and Live promotion are different operations;
- tool, knowledge, routing, and trace claims remain separate; and
- Bob stops before the first tenant write.

**Checkpoint:** a human accepts or revises the plan, and the worktree is unchanged. A
file mutation in this stage is `fail`.

## Stage 2: Let Bob build and validate the local agent definition

After the plan is accepted, paste the exact continuation in
[`02-go.md`](../examples/prompts/02-go.md). This approval covers local and read-only
remote inspection only.

Bob should:

1. verify ADK `2.15.0`;
2. identify the active remote environment without exposing its credential;
3. pause for interactive reactivation if authentication expired;
4. read exact supported model IDs from that tenant;
5. choose the tenant's marked default when suitable;
6. materialize
   `agents/store_support_agent/.generated/store_support_agent.yaml`;
7. run `npm run verify:agent`; and
8. use read-only lists to classify each intended Draft identity as absent,
   matching-looking, or a potential collision.

The `.generated` directory is ignored and exists for reviewable tenant-specific
materialization. It is not proof of import. Inspect the rendered agent, three starter
prompts, read-only tool permission, knowledge reference, and exact model ID.

**Checkpoint:** record the selected model and local validation result. Bob must stop
before a tool, knowledge base, agent, or connection is changed in WXO.

## Stage 3: Apply the human Draft gate and import

Before continuing, the WXO operator states the exact active environment and approves
create/update operations for only:

- Draft connection identity `acme_support_api`;
- Draft tool `get_order_status`;
- Draft knowledge base `acme_return_policy`; and
- Draft agent `store_support_agent`.

The connection itself must already exist with protected credentials entered. If it is
missing, points at an unavailable endpoint, or has no credentials, stop and let the
facilitator correct it in WXO. Do not give Bob the credential.

Paste
[`02a-wxo-draft-import.md`](../examples/prompts/02a-wxo-draft-import.md). The reviewed
command order from `agents/store_support_agent` is:

```text
uv run orchestrate tools import -k python -f tools/get_order_status.py -r tools/requirements.txt --app-id acme_support_api --safe
uv run orchestrate knowledge-bases import -f knowledge_bases/acme_return_policy.yaml --safe
uv run orchestrate agents import -f .generated/store_support_agent.yaml --safe
```

Bob must rerun read-only lists before writing, honor any `--safe` confirmation, and
stop instead of silently overwriting a materially different resource. It must never
remove a resource, deploy the agent, or promote it to Live.

After import, use read-only list output and exactly one foreground ADK 2.15 Draft
chat session. The facilitator must start it in a real interactive terminal with
stdin attached:

```text
uv run orchestrate chat ask --agent-name store_support_agent
```

In that same session, wait for each answer before entering the next line:

1. `What is the current status of order ACME-1042?`
2. `What is the standard return window?`
3. `Create a support case for order ACME-1042.`
4. Enter `q` and press Enter to exit.

Do not give the question as a command argument, pipe or redirect stdin, use a
here-string, run this chat in CI, or let Bob invoke it through a command-capture or
subprocess wrapper without interactive stdin. ADK 2.15 can repeatedly read EOF in
that non-interactive shape and leave the chat loop running. If the facilitator has
no real TTY, stop and record Draft chat as `not_completed`; do not simulate or
capture an automated replacement.

The third answer must preserve the boundary: the assistant may direct the user to the
portal form but must not submit a case.

Record results separately:

| Claim | Required observation |
| --- | --- |
| Draft resource presence | Read-only WXO list output in the intended environment |
| Agent response | Completed Draft chat answer |
| Tool outcome | Direct sanitized tool/runtime evidence, not answer text alone |
| Knowledge outcome | Direct sanitized retrieval evidence, not answer text alone |
| Case boundary | No automatic case plus guidance to the user-controlled form |

If direct provenance is unavailable, the answer can pass a semantics check while the
tool or knowledge claim remains `not_asserted`.

## Stage 4: Connect the existing portal with the guided launcher

Use read-only WXO output to obtain the exact Draft agent ID and the service instance
API URL. An agent name is not its ID, and the browser application URL is not the
service instance API URL.

Paste
[`02b-wxo-portal-connect.md`](../examples/prompts/02b-wxo-portal-connect.md), then run
from an interactive terminal at the repository root:

```text
npm run guided
```

Choose:

1. the portal and Support API ports;
2. **WXO account-backed**;
3. the exact service instance API URL;
4. the exact Draft agent ID;
5. the WXO key in the masked prompt;
6. whether to enable optional Instana traces;
7. the secret-free summary; and
8. **Portal + API and all documents/previews**.

If Instana is selected, enter its Agent Key only in the separate masked prompt. The
launcher keeps WXO configuration in the portal child and Instana configuration in the
Support API child. Neither key belongs in the browser, `.env`, Git, preview URLs, or
terminal summary.

`npm run guided` starts local processes and opens previews. It does not install or
import an agent, infer Draft/Live status, run Bob Shell, or publish anything. Keep the
terminal open; the session menu remains active until option `0` or terminal closure.

**Checkpoint:** portal and API health are ready, the source summary contains no
secret, and the browser tabs open. A failed WXO request must remain a visible failure;
it must not silently fall back to the mock provider.

## Stage 5: Run account-backed acceptance

In the portal:

1. search for `ACME-1042`;
2. open **Order assistant**;
3. ask `What is the status of this order, and what is the standard return window?`;
4. confirm the response badge says `watsonx Orchestrate`;
5. ask a follow-up and confirm that the conversation continues;
6. ask the assistant to create a support case and confirm it does not submit one;
7. review the visible order context, select `priority`, enter a fictional description
   of at least ten characters, and explicitly submit the form; and
8. confirm the receipt states that no real external ticket was created.

Also check the bounded failures `not-an-order` and `ACME-4040`. They should not expose
credentials, internal stack traces, or unrestricted provider output.

Record the observations without overclaiming:

| Acceptance item | Expected status |
| --- | --- |
| Portal routed through WXO for the response | `pass` only when the labeled response completed |
| Delayed-order and return-window answer is useful | `pass` based on visible semantics |
| Internal WXO tool invocation | `pass` only with separate direct evidence; otherwise `not_asserted` |
| Internal WXO knowledge retrieval | `pass` only with separate direct evidence; otherwise `not_asserted` |
| Assistant submitted no case | `pass` when no submission occurred |
| Human-controlled fictional submission | `pass` when the user submitted the form and saw the synthetic receipt |

The source badge supports routing only. It does not prove that WXO used a particular
tool or knowledge base, nor does it identify Draft versus Live by itself.

## Stage 6: Optionally verify an Instana trace

Skip this stage when it was not pre-authorized. Record it as `not_completed`; do not
turn Instana into a requirement for the main WXO journey.

When Instana was enabled in the guided launcher:

1. record the synthetic session correlation ID printed in the secret-free summary;
2. perform a health request, order lookup, and user-controlled fictional case
   submission;
3. observe the bounded exporter diagnostic without retaining headers or payloads;
4. use the authorized Instana tenant in read-only mode;
5. find the `acme-support-api` application/call with the same correlation attribute;
   and
6. capture only the sanitized service, route, time, status, and correlation evidence
   needed for the workshop record.

An exporter configuration message is not tenant receipt. An export result can support
the corresponding bounded exporter claim. Only the matching trace observed in the
intended tenant supports receipt/search visibility. If no trace appears, preserve the
diagnostic and record receipt as `not_asserted` or the completed search as `fail`,
depending on what was actually checked.

## Stage 7: Run deterministic verification

Run focused tests first for any changed area. At minimum, preserve coverage for:

1. delayed-order guidance and non-delayed behavior;
2. no assistant-triggered support-case submission;
3. explicit form submission and the exact `priority` contract;
4. source-label rendering and safe provider errors;
5. agent package validation and starter prompts; and
6. WXO/Instana secret separation in the guided launcher.

Then run:

```text
npm run preflight
npm run verify
npm run e2e:local
npm run e2e:built
```

Record each exact command, exit code, summary, and limitation. The local browser runs
are deterministic authority for the checked-in customer journey. They do not prove
WXO or Instana behavior. Conversely, an unavailable tenant does not erase a completed
local test result; the claims remain separate.

After human diff review, create a commit if the candidate will proceed to release
audit or Bob Shell review. Record the full SHA and confirm the worktree is clean.

## Stage 8: Create candidate-bound evidence

Optionally paste the review prompt in
[`03-release-review.md`](../examples/prompts/03-release-review.md). It may inspect and
summarize the candidate but may not write to an external system or upgrade missing
evidence into a pass.

For a clean committed candidate, use a unique public-safe label:

```text
git rev-parse HEAD
git status --short
npm run release:audit -- --mode Full --candidate workshop-rc-01
```

Treat the bundle as complete only when `evidence-complete.json` exists, reports a
passing completion state, matches the candidate and source SHA, and is bound to its
checksum manifest. The audit refuses to overwrite existing evidence and stops before
approval, merge, tag, publication, deployment, import, or promotion.

Do not retain API keys, tokens, auth headers, private tenant URLs or IDs, customer
data, raw prompts containing private data, unrestricted logs, browser profiles, or
model chain-of-thought.

## Stage 9: Add Bob Shell advisory review

Use the manual `.github/workflows/bob-shell-review.yml` controller described in
[Bob Shell in CI/CD](bob-shell-cicd.md). The dispatch input is the exact lowercase
40-character candidate SHA, never a credential.

The credential-free gate job runs the repository's fixed deterministic commands on a
fresh GitHub-hosted worker. Only after GitHub records that job as successful may a
fresh protected job start on the isolated ephemeral runner. That review job creates
its own same-run gate record, gives Bob the complete tracked exact-SHA source, disables
mutation-capable tool groups, applies cost/time/turn limits, and validates the
sanitized machine-readable report plus before/after mutation guards.

Retain a report only when the controller and mutation guards pass. Keep execution and
recommendation separate: Bob may complete and recommend remediation. A failed Bob
invocation does not prove the product is broken, and a passing recommendation does not
approve release.

If the protected runner or current authentication is unavailable, run:

```text
npm run test:bob-review
```

Walk through the controller contract and record the authenticated Bob Shell review
claim as `not_asserted`; if an authorized run started but did not finish, record
`not_completed`. Never substitute a synthetic report or a local chat transcript.

## Stage 10: Make the human decision and clean up

Review [the release checklist](../.github/RELEASE_CHECKLIST.md) against the exact
candidate:

- candidate SHA and clean state;
- reviewed diff and acceptance criteria;
- focused, full, local, and built-browser results;
- WXO Draft observations and any unasserted provenance;
- Instana receipt or its absence;
- release-audit bundle;
- Bob Shell execution, recommendation, and findings; and
- privacy, licensing, security, accessibility, and public-claim boundaries.

Record one disposition:

- technically acceptable for the bounded workshop candidate;
- remediation required before reconsideration; or
- insufficient evidence to decide.

This is not automatically a public-release authorization. A named human owner must
issue a separate `GO` for the exact candidate and intended publication or deployment.

Then:

1. choose option `0` in the guided terminal;
2. stop any temporary HTTPS endpoint or tunnel and verify it is unreachable;
3. stop/destroy the ephemeral Bob runner;
4. remove or retain temporary Draft resources only according to the pre-approved
   tenant cleanup plan;
5. revoke or rotate temporary credentials according to organizational policy; and
6. keep only sanitized, candidate-bound evidence.

To remove generated local build/test state while preserving dependencies and release
evidence:

```text
npm run reset
```

To also remove project-local npm and Python dependencies:

```text
npm run uninstall:project
```

Do not run `npm run purge:evidence` as routine cleanup. It deletes retained local
release evidence and requires a separate retention decision.

## Facilitator fallback matrix

| Problem | Safe response | Evidence state |
| --- | --- | --- |
| Bob IDE unavailable or unauthenticated | Review the supplied prompts and perform local materialization manually | Bob execution `not_completed` |
| WXO authentication expired | Pause while the operator reactivates the reviewed environment interactively | Import/chat remains `not_completed` until retry finishes |
| Tenant model differs | Select only an ID returned by that tenant and rematerialize | Old materialization is not used |
| Draft name collision differs materially | Stop at the `--safe` prompt; review or use a clean environment | Import `not_completed` |
| Public Support API unreachable from WXO | Keep the portal/mock fallback; repair only the pre-approved endpoint | Tool behavior `not_asserted` |
| WXO tenant unavailable | Run `npm run guided` with Local mock and continue deterministic evidence | Account-backed behavior `not_asserted` |
| Instana trace not found | Preserve exporter and tenant-search results separately | Receipt `not_asserted` or completed search `fail` |
| Chromium install fails | Run non-browser checks and use exact-SHA prior evidence only when it matches | Browser run `not_completed` |
| A deterministic check fails | Preserve the result and create a remediation plan | Check `fail` |
| Bob Shell runner unavailable | Test the controller contract; do not fabricate a report | Review claim `not_asserted`; use `not_completed` only for a started run |
| Full audit exceeds the session | Do not infer completion from partial output | Audit `not_completed` |

## Completion record

Finish with a sanitized table:

| Item | Value |
| --- | --- |
| Starting SHA | Full 40-character SHA |
| Candidate SHA | Full 40-character SHA or `not_completed` |
| Bob IDE plan-only stage | `pass`, `fail`, or `not_completed` |
| Local materialization/model validation | Model identifier and status, or `not_completed` |
| Human Draft authorization | Exact approved scope and decision |
| WXO Draft resources | Sanitized presence/import status |
| Portal WXO routing | `pass`, `fail`, or `not_completed` |
| WXO tool invocation | Direct evidence status or `not_asserted` |
| WXO knowledge retrieval | Direct evidence status or `not_asserted` |
| Human-controlled case boundary | Status |
| Instana export | Bounded exporter status or `not_completed` |
| Instana tenant receipt | Matching trace status or `not_asserted` |
| Focused and full verification | Commands and statuses |
| Browser acceptance | Local and built statuses |
| Release audit | Candidate label and status |
| Bob Shell advisory review | Report identity/status, otherwise `not_asserted`; a started unfinished run is `not_completed` |
| Human disposition | Decision and remaining limitations |
| Cleanup | Local, public endpoint, Draft, and runner status |

## Claims after the workshop

It is reasonable to say, when the corresponding evidence was actually observed, that
participants used Bob IDE to plan and materialize a reviewed WXO agent, imported
bounded resources into Draft under human authorization, connected an existing portal,
ran deterministic tests, and used Bob Shell as an advisory CI/CD reviewer.

Do not claim that:

- this is an official IBM reference architecture;
- a portal source badge proves an internal tool call or knowledge retrieval;
- an answer containing expected facts proves their internal provenance;
- an exporter success message proves Instana indexed a trace;
- Draft means Live or production-ready;
- Bob Shell replaces deterministic gates or human approval; or
- workshop completion establishes production readiness, legal clearance, complete
  accessibility conformance, or security certification.

The result is a transparent case study: prepared engineering assets, Bob-assisted
agent setup, explicit human gates, observable account-backed behavior, deterministic
verification, bounded advisory review, and a final human-owned decision.
