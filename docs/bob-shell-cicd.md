# Bob Shell in CI/CD: bounded advisory review

## Current status

The repository now ships a manual exact-candidate controller in
`.github/workflows/bob-shell-review.yml`, a bounded runner in
`scripts/bob-shell-review.mjs`, a versioned prompt, a report contract, validation,
and repository-owned tests. Those source controls are implemented and testable
without a Bob credential.

**Authenticated Bob Shell execution has not been completed for the current
candidate.** No generated report is committed. Until an authorized run creates sanitized,
candidate-bound evidence, the narrower execution claim is `not_completed`.
Accordingly, the public claim “Bob Shell reviewed this candidate” is `not_asserted`.
These labels describe different things: an unfinished execution versus a claim the
available evidence cannot support.

## Intended role

Bob Shell is an optional advisory reviewer after deterministic tests have completed.
It receives the complete tracked source of one exact candidate and a fixed same-run
record stating which deterministic commands passed. It may inspect that source to
identify risks, missing coverage, or inconsistencies. It does not receive a selected
diff, pull-request scope, test logs, or sanitized test summaries. It must not:

- edit the checkout;
- execute project or deployment commands;
- connect to MCP servers or business systems;
- receive watsonx Orchestrate, Instana, GitHub write, or production credentials;
- override a deterministic failure or missing check;
- approve, merge, tag, publish, import, promote, or deploy;
- replace human code review or the human release decision.

IBM documents non-interactive `bob run` sessions for automation, scripting, batch
processing, and CI/CD pipelines that need structured JSON output. IBM also notes
that tool calls are pre-approved in a non-interactive session, which is why explicit
tool restrictions and runner isolation are required here. See
[Starting a non-interactive session](https://bob.ibm.com/docs/shell/getting-started/start-bobshell-non-interactive).

## Trust model

The review consumes two evidence inputs supplied by the trusted controller:

1. a pristine checkout containing the complete tracked source at the exact candidate
   SHA;
2. a fixed, same-workflow-run pass record that identifies the successful
   deterministic job and lists the commands it ran.

GitHub's service-controlled `needs: deterministic-gates` result is the authority for
starting the advisory job. Only after that dependency has succeeded does the fresh
advisory job create `gates.json` locally. The workflow does not upload, download, or
transfer a gate-evidence artifact between jobs. The fixed record contains gate
identity and pass facts, not logs or test-result summaries.

The review output is untrusted advisory content. A successful Bob Shell process
means only that the session completed; it does not prove that the code is correct,
secure, accessible, legally publishable, or ready for production.

| Risk | Required control |
| --- | --- |
| Repository instructions or hooks influence a headless run | Reject candidate-owned `.bob/`, `.bobignore`, `.bobrules`, `.bobrules-*`, `.claude`, `.agents`, nested `AGENTS.md`, links, submodules, hidden index entries, ignored files, and untracked files before the credentialed process starts; require the root `AGENTS.md` blob to match the trusted controller |
| Non-interactive tools act without a prompt | Start in Ask mode and disable edit, execute, MCP, and subagent capabilities |
| Credential exposure | Inject `BOB_API_KEY` and, only when required by a general key, `BOB_TEAM_ID` from protected Environment secrets exclusively in the Bob step; never place either value in dispatch inputs, prompts, source, artifacts, command output, or debug logs |
| External-system mutation | Provide no tenant, deployment, package-registry, GitHub write, or observability credential; use a read-only checkout and job token |
| Prompt injection from untrusted changes | Do not run privileged Bob review on unreviewed forks; inspect changes to Bob configuration and instruction files first |
| Model output is mistaken for a test result | Keep all deterministic jobs authoritative and label Bob output `advisory` |
| Raw output exposes private content or reasoning | Parse the terminal JSON in memory and retain only the schema-allowed sanitized report fields; do not retain or publish raw streams or unrestricted logs |
| Unbounded consumption | Set approved `--max-cost` and `--max-turns` limits |
| Authentication or service failure is hidden | Record the Bob step as `not_completed`; never convert it to `pass` |

IBM's security guidance recommends trusted folders, `.bobignore`, limited
auto-approval, secret protection, restricted MCP access, and human review of output.
IBM also states that `.bobignore` is not a system-level sandbox. Use operating-system
or runner isolation in addition to Bob configuration. See
[Bob Shell security guidelines](https://bob.ibm.com/docs/shell/security/bob-security-guidance),
[trusted folders](https://bob.ibm.com/docs/shell/security/trusted-folders), and
[tool groups](https://bob.ibm.com/docs/shell/core-concepts/tools).

## Requirements before the first run

- A licensed IBM Bob account with an entitlement that permits Bob Shell use.
- Bob Shell `2.0.2` installed on the dedicated runner; the controller fails closed
  for another observed version until its safety contract is reviewed and updated.
- The IBM license reviewed and accepted before non-interactive execution.
- An appropriate Bob API key held as the protected Environment secret
  `BOB_API_KEY`. IBM documents API-key authentication for non-interactive and CI/CD
  environments. If a general key requires a team identifier, store it separately as
  the protected Environment secret `BOB_TEAM_ID`; never collect it as a public manual
  workflow input.
- The candidate checked out by exact SHA with no persisted checkout credentials and
  no write-capable repository token.
- Deterministic verification completed first in the workflow's credential-free job;
  its service-controlled success is available to the dependent advisory job.
- A fresh operating-system-isolated runner labeled `self-hosted`, `linux`,
  `bob-shell`, and `ephemeral`, with no Docker socket, cloud identity, deployment
  credentials, unrelated workspace, or reusable state.
- A protected GitHub Environment named `bob-review`, ideally with a required human
  reviewer; do not dispatch against unreviewed fork content.
- An approved, versioned review prompt with explicit scope and output requirements.
- Approved cost and turn caps.
- A reviewed sanitizer/parser that retains only the allowed public report fields.
- A retention policy for the sanitized report and a prohibition on raw transcript,
  hidden reasoning, environment dumps, and private service URLs.
- A new output location for each review. Existing Bob evidence is not automatically
  overwritten.

Installation and API-key behavior are documented by IBM in
[Installing and setting up Bob Shell](https://bob.ibm.com/docs/shell/getting-started/install-and-setup)
and [IBM Bob API keys](https://bob.ibm.com/docs/ide/account/api-keys).

## One-time setup, step by step

The local workshop and the protected CI review are separate paths. Installing Bob
Shell on a maintainer's workstation is useful for checking the CLI version and
reading the license, but it does not turn that workstation into the publishable
review runner.

### 1. Check the base toolchain

From the repository root, install the locked project dependencies and browser,
then require a passing doctor result:

```text
npm run install:project
npx --no-install playwright install chromium
npm run doctor
```

The declared versions are Node.js `24.19.0`, npm `11.17.0`, Python `3.12.10`, and
`uv` `0.12.0`. Docker Desktop is not required for the local demo or either workflow
job.

### 2. Install the pinned Bob Shell version

On a Windows maintainer workstation, download and inspect IBM's installer before
running it:

```powershell
$installer = Join-Path $env:TEMP "bobshell-installer.ps1"
Invoke-WebRequest -UseBasicParsing -Uri "https://bob.ibm.com/download/bobshell.ps1" -OutFile $installer
Get-FileHash -Algorithm SHA256 -LiteralPath $installer
Get-Content -LiteralPath $installer
& $installer -PackageManager npm -Version 2.0.2
bob --version
```

The final command must report `2.0.2` and build commit `a31a75e3`. The controller
requires that exact two-line identity. Do not authenticate from this repository or
store a Bob credential in a local `.env` file.

On the dedicated Linux runner, use the equivalent pinned install after reviewing
the downloaded script:

```bash
curl -fsSLo /tmp/bobshell.sh https://bob.ibm.com/download/bobshell.sh
less /tmp/bobshell.sh
bash /tmp/bobshell.sh --package-manager npm --version 2.0.2
bob --version
rm /tmp/bobshell.sh
```

Review the installed IBM and non-IBM license files before accepting the license.
The workflow checkbox and `--accept-license` flag are confirmations of a completed
human review; automation must not select them on a person's behalf.

### 3. Register a disposable Linux runner

In **Repository Settings → Actions → Runners**, choose **New self-hosted runner**
and follow the fresh Linux commands shown by GitHub. Registration commands contain
a short-lived token, so run them directly on the isolated host and never copy them
into source, issues, chat, or logs. Add `--ephemeral` and
`--labels bob-shell,ephemeral` to the displayed `config.sh` registration command;
GitHub supplies the `self-hosted` and `linux` labels.

The `ephemeral` label is routing metadata only. The `--ephemeral` registration flag
is the control that makes GitHub automatically deregister the runner after one job.
The host provisioner must also destroy the VM and its disk after the runner exits.
If provisioning fails before a job is accepted, remove the registration with a
fresh removal token before destroying the host. For an automated pool, use GitHub's
just-in-time runner configuration instead of a persistent registration. Never reuse
the workspace or Bob profile.

GitHub documents the registration flow in
[Adding self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)
and the label behavior in
[Using self-hosted runners in a workflow](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/use-in-a-workflow).
The single-job requirement is described in
[Ephemeral runners for autoscaling](https://docs.github.com/en/actions/reference/runners/self-hosted-runners#ephemeral-runners-for-autoscaling).

### 4. Create the protected Environment

In **Repository Settings → Environments**, create `bob-review`, restrict it to the
protected default branch, and add a required reviewer when the repository plan and
visibility support that rule. Prevent self-review where available. GitHub withholds
Environment secrets until configured protection rules pass; self-hosted runners
still require independent operating-system isolation.

On GitHub Free, configure this protected path only after the repository is public.
Environment secrets and branch protection for a private repository require an
eligible paid plan; do not weaken the workflow or move the key to an unprotected
repository secret as a workaround.

Add an unused, newly generated inference key as the Environment secret
`BOB_API_KEY`. Use the GitHub UI or the following prompt-driven command so the
value is not present in shell history:

```text
gh secret set BOB_API_KEY --env bob-review
```

If IBM issued a general key, add `BOB_TEAM_ID` the same way. Never reuse a key that
has appeared in chat, terminal output, a file, or a workflow input; revoke it and
create a replacement first. See GitHub's
[environment management](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
and [secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).

### 5. Make the controller reachable

Review and merge the controller through the repository's protected process so
`.github/workflows/bob-shell-review.yml` exists on the default branch. Separately
commit the intended candidate, record its full lowercase 40-character SHA, and
ensure that SHA is reachable in the same GitHub repository. A dirty or staged-only
working tree is not a candidate and cannot be reviewed by this workflow.

## Manual, operator-controlled rehearsal

Perform the first run through the manual workflow on the dedicated ephemeral runner.
Do not make it a required branch gate until command behavior, output handling,
failure semantics, cost behavior, and runner teardown have been observed and
reviewed.

### 1. Establish candidate identity

Record the exact commit and require a clean checkout:

```text
git rev-parse HEAD
git status --short
```

Stop if the SHA is not the intended candidate or if the checkout is unexpectedly
dirty.

### 2. Run the deterministic checks first

```text
npm run verify
npm run e2e:local
npm run e2e:built
```

For a release candidate, use the repository's Full release audit and verify its
completion marker as separate release evidence. In the public Bob path, the manual
workflow runs its own fixed deterministic command list in the credential-free
`deterministic-gates` job. A Bob review never fills a missing deterministic result.

### 3. Review the input boundary

- confirm that the exact candidate is the intended review target;
- confirm that the review contains only fictional data;
- scan for credentials, private URLs, and local user paths;
- confirm that candidate-owned `.bob/`, `.bobignore`, `.bobrules`, `.bobrules-*`,
  Bob/Claude controls, nested `AGENTS.md`, links, submodules, ignored content, and
  untracked content are absent; the controller enforces this boundary again and
  binds the root `AGENTS.md` to the trusted controller;
- ensure no external-service credential other than the protected Bob key is present
  in the review process;
- decide the maximum cost and turn count before invoking Bob.

### 4. Dispatch the checked-in controller

From the protected default branch, open **Actions → Optional Bob Shell advisory
review → Run workflow**. Supply the exact lowercase 40-character candidate SHA,
reviewed cost and turn caps, and the explicit license confirmation. Do not enter a
team identifier at dispatch. If the selected general API key requires one, configure
`BOB_TEAM_ID` in the protected `bob-review` Environment before the run. The workflow
exposes it only in the same Bob step as `BOB_API_KEY`.

This manual workflow is the supported public path. The low-level entrypoint is
intentionally Linux-only and is not a shortcut around the two-job control boundary.
It consumes `gates.json` created inside the fresh advisory job after GitHub reports
the `needs` dependency as successful; operators must not manufacture that file or
transfer one from another job or run:

```text
npm run review:bob -- --candidate <exact-40-character-sha> --gate-evidence <same-run-gates.json> --max-cost 0.5 --max-turns 12 --accept-license
npm run review:bob:validate
```

The controller runs Bob in Ask mode with JSON output, the complete tracked source in
a pristine exact-candidate workspace, an isolated home/temp profile,
`--disable-mcp`, `--disable-subagents`, and the documented mutation-capable tool
groups disabled. `--trust` applies only after the controller rejects candidate-owned
control files and establishes the isolated boundary; it must not be copied to an
arbitrary checkout command. Separate Git identity/status guards cover repository
state, while the before/after byte snapshot covers tracked worktree content and
deliberately excludes `.git` metadata.

### 5. Sanitize and validate the result

The checked-in parser retains only a strict, public-safe report containing:

- the candidate and trusted-controller SHAs;
- one `reviewedAt` timestamp and Bob Shell version `2.0.2`;
- the source-mutation and workspace-policy guard results;
- approved cost and turn caps plus the disabled-tool boundary;
- the same-run gate identity and fixed list of passing commands;
- sanitized findings, explicit `notAsserted` items, and the advisory recommendation;
- hashes binding the JSON and Markdown reports to the completion marker.

The retained report deliberately omits session start/finish pairs, process-exit
metadata, and the raw terminal stream. Do not publish raw event streams, reasoning
messages, auth data, complete logs, environment variables, home-directory paths, or
private tenant identifiers. Validate the sanitized report against a repository-owned
schema before attaching it as CI evidence. Evidence creation fails rather than
automatically overwriting an existing Bob review output.

### 6. Apply explicit failure semantics

| Observation | Recorded state |
| --- | --- |
| Session completed and a sanitized report is bound to the exact SHA | Bob review completed; findings remain advisory |
| Authentication, network, cost, turn, parser, or service failure | `not_completed` |
| Candidate mismatch or unsafe/unsanitized input | `fail` for the review workflow |
| No authorized Bob Shell run | Execution `not_completed`; claim “Bob Shell reviewed this candidate” `not_asserted` |
| Bob recommends release while a deterministic gate failed | Deterministic failure remains the release blocker |

Workflow success and the Bob recommendation must not be relabeled as an overall
release `pass`.

### 7. Perform human review

A maintainer reviews the deterministic evidence, Bob findings, code diff, security
and privacy impact, dependency state, documentation, and public claims. The
maintainer may accept a finding, reject it with a recorded reason, request another
candidate, or issue a GO only after every required external and human-owned gate is
complete.

IBM's IDE review guidance explicitly positions automated findings as a first pass
before human code review. See [Code reviews in IBM Bob](https://bob.ibm.com/docs/ide/features/code-reviews).

## Implemented CI placement

The optional workflow implements this pipeline shape:

```text
exact candidate checkout
  -> deterministic verification and browser tests
  -> service-controlled needs success
  -> fresh advisory job creates fixed same-run gates.json
  -> isolated, read-only Bob Shell advisory review
  -> schema validation and artifact upload
  -> human review and release decision
```

The workflow is manual and has read-only repository permissions. Its first job only
runs candidate-controlled installation and deterministic commands on a fresh
GitHub-hosted runner with no Bob credential. GitHub starts the dependent job only
after that job succeeds. The fresh advisory job creates the fixed same-run pass
record locally; no gate artifact crosses the runner boundary. It then receives
`BOB_API_KEY`, and the trusted wrapper validates the record, creates a fresh
review-only clone, and passes the key only to its Bob child. This job separation
prevents a process left behind by candidate tests from sharing the Bob review host.
Bob receives the complete tracked exact-candidate source and the fixed pass record,
not a diff, PR scope, logs, or test summaries. The result is uploaded only after
semantic validation and final source guards, with automatic overwrite disabled. An
unavailable advisory service remains `not_completed`; it is never silently reported
as successful.

## Evidence needed before making the review claim

To support the currently `not_asserted` claim that Bob Shell reviewed a candidate,
retain sanitized evidence
showing:

1. the exact repository SHA and clean checkout;
2. the Bob Shell version and bounded command configuration;
3. successful authentication without exposing the credential;
4. disabled write, execute, MCP, and subagent capabilities;
5. the gate identity/list and a sanitized, schema-valid advisory report;
6. completion hashes and successful tracked-worktree mutation guards;
7. human disposition of every release-relevant finding;
8. confirmation that no merge, tag, publication, import, promotion, or deployment
   was performed by the review job.

Only then may public documentation say that Bob Shell reviewed that exact candidate
in CI/CD. The evidence would still not establish that watsonx Orchestrate accepted
or deployed the agent.

## Official IBM references

- [Welcome to Bob Shell](https://bob.ibm.com/docs/shell)
- [Starting a non-interactive session](https://bob.ibm.com/docs/shell/getting-started/start-bobshell-non-interactive)
- [Installing and setting up Bob Shell](https://bob.ibm.com/docs/shell/getting-started/install-and-setup)
- [Tools and tool groups](https://bob.ibm.com/docs/shell/core-concepts/tools)
- [Security guidelines](https://bob.ibm.com/docs/shell/security/bob-security-guidance)
- [Trusted folders](https://bob.ibm.com/docs/shell/security/trusted-folders)
- [Code reviews in IBM Bob](https://bob.ibm.com/docs/ide/features/code-reviews)
