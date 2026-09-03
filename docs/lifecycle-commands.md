# Lifecycle commands

## Toolchain

The release toolchain pins Node.js 24.19.0, npm 11.17.0, Python 3.12.10, and
`uv` 0.12.0. Chromium is required only for browser acceptance and documentation
screenshots.

Installing Node, Python, `uv`, npm dependencies, Python dependencies, or Chromium
may require network access. Application runtime in the local/mock profile is
intended to remain on loopback after those prerequisites are present.

## Root commands

| Command | Purpose | Writes locally | Expected network behavior |
| --- | --- | --- | --- |
| `npm run doctor` | Read-only exact-version, Git, and optional-browser checks | None intended | None |
| `npm run install:project` | Install locked npm and Python project dependencies | `node_modules`, agent `.venv`, package caches | May contact configured public package indexes |
| `npm run dev` | Start local API and portal development processes | Framework caches may be created | No external business call is intended |
| `npm run up` | Alias for the foreground, local/mock `dev` launcher | Framework caches may be created | No external business call is intended |
| `npm run guided` | Interactive foreground launcher for mock or explicitly selected account-backed WXO, optional direct Instana Blue OTLP/HTTP, and browser previews | Framework caches may be created | Mock stays local unless Instana is selected; WXO chat and/or Instana export occurs only after explicit selection and generated traffic; Draft/Live status and Instana receipt are not inferred |
| `Ctrl+C` | Stop both launcher-owned child processes | None intended | None |
| `npm run preflight` | Check toolchain, current tree, and complete reachable history | No intentional write | None |
| `npm run lint` | Run workspace lint commands | Tool caches may be created | None intended after install |
| `npm run typecheck` | Run workspace TypeScript checks | TypeScript/framework metadata may be created | None intended |
| `npm run test:portal` | Run portal Vitest suite | Test cache/output may be created | Uses controlled local doubles |
| `npm run test:api` | Run Support API Vitest suite | Test output may be created | Includes local in-process and loopback fixtures |
| `npm run test:openapi` | Lint the OpenAPI document | No intentional source write | None intended |
| `npm run test:release-scan` | Test the release scanner itself | Temporary test data | None intended |
| `npm run test:history-scan` | Test historical-secret and metadata-privacy detection | OS temporary test repositories | None intended |
| `npm run test:bob-review` | Test the Bob report, exact-SHA gate record, workspace guard, wrapper inputs, and manual-workflow contract without authentication | Contained OS temporary Git fixtures | None |
| `npm test` | Run portal, API, OpenAPI, scanners, release tooling, and Bob-controller contract tests | Test and contained temporary output | None intended after install |
| `npm run secret:scan` | Scan currently tracked files for selected release hazards | No intentional write | None intended |
| `npm run history:scan` | Scan all commits reachable from local refs plus commit-email metadata | No intentional write | None intended |
| `npm run build` | Build every workspace that defines `build` | Portal `.next` and API `dist` | None intended after install |
| `npm run verify:web` | Scan, lint, typecheck, test, and build web/API workspaces | Build and test output | None intended after install |
| `npm run verify:agent` | Synchronize locked Python dependencies, validate agent sources, run pytest | Agent `.venv`, uv cache, test cache | May contact configured Python indexes |
| `npm run verify` | Run `verify:web` followed by `verify:agent` | Combined outputs above | May download Python packages |
| `npm run e2e:local` | Start isolated loopback development servers and run the Chromium journeys | `playwright-report`, `test-results`, framework caches | No external business call is intended |
| `npm run e2e:built` | Build and test isolated production-start profiles | Build, Playwright, and test output | No external business call is intended |
| `npm run audit:python` | Audit the complete locked Python graph with pinned `pip-audit` | A contained temporary evidence directory, then cleanup | May download the pinned audit tool and query its vulnerability service |
| `npm run sbom` | Generate a combined npm/Python CycloneDX 1.6 document from lockfiles | Ignored `sbom.cdx.json` | None |
| `npm run licenses:inventory` | Inventory the locked npm graph, enriched from installed manifests, plus installed Python license metadata without changing dependencies | Ignored `license-inventory.json` | None; Python collection is offline and no-sync |
| `npm run verify:archive` | Archive the exact clean HEAD and verify an extracted copy | Contained temporary archive state, then cleanup | Dependency install/audit steps may use package and vulnerability services |
| `npm run release:audit -- --mode Full --candidate <label>` | Run hard gates and produce candidate-bound redacted evidence | Ignored `release-evidence/<label>` | Dependency and vulnerability steps may use external services |
| `npm run review:bob -- --candidate <sha> --gate-evidence <file> --accept-license` | Linux-only low-level controller entrypoint after validating a same-run gate record; the supported public path is the manual GitHub workflow | Ignored `artifacts/bob-review` plus disposable OS-temp checkout/profile; refuses to overwrite existing evidence | Contacts IBM Bob; requires a protected credential and isolated runner |
| `npm run review:bob:validate` | Revalidate the generated Bob JSON/Markdown pair and completion hashes | None intended | None |
| `npm run reset` | Remove only allowlisted generated state while preserving release evidence | Deletes allowlisted generated paths | None |
| `npm run uninstall:project` | Reset plus removal of project-local npm/Python dependencies while preserving release evidence | Deletes allowlisted generated/dependency paths | None |
| `npm run purge:evidence` | Explicitly delete all retained local release-audit evidence | Deletes the complete ignored `release-evidence` tree | None |
| `npm run screenshot:docs` | Capture the current local UI for documentation | Replaces `docs/assets/acme-agentic-support.png` | Requires an already running local portal |

`npm run screenshot:docs` is a documentation-maintenance command, not a read-only
verification command.

## Workspace commands

| Workspace | Development | Build | Built start | Focused tests |
| --- | --- | --- | --- | --- |
| Portal | `npm run dev -w apps/portal` | `npm run build -w apps/portal` | `npm run start -w apps/portal` | `npm run test:portal` |
| Support API | `npm run dev -w services/support-api` | `npm run build -w services/support-api` | `npm run start -w services/support-api` | `npm run test:api` |
| E2E | Not applicable | Not defined | Test-owned orchestration through `npm run test:built -w tests/e2e` | `npm run e2e:local` or root `npm run e2e:built` |

The root repository does not provide a long-running combined production start
command. The default Playwright configuration starts workspace development servers.
The separate built configuration starts a previously built API `dist` entrypoint and
Next `.next` application on isolated loopback ports, refuses to reuse existing
servers, and fails early when required build markers are absent.

## Draft agent commands

From `agents/store_support_agent`, the documented offline-source workflow is:

```text
uv sync --locked --python 3.12
uv run python scripts/validate_local.py
uv run pytest -q
uv run python scripts/materialize_agent.py --model-id <reviewed-model-id> --output .generated/store_support_agent.yaml
```

Dependency synchronization may use the network. Validation and materialization are
designed not to contact a WXO tenant. Materialization creates a reviewable local
file; it does not authorize or perform import.

The project and lockfile pin ADK 2.15.0. Always use `uv run orchestrate` from this
directory so a different global ADK cannot silently change the command contract.

### Optional authorized WXO Draft lifecycle

The following is the reviewed manual order for a matching MCSP WXO tenant. It is
not run by `npm run guided`. Replace every angle-bracketed value locally; never
place a key, tenant identifier, private alias, or tenant URL in source or evidence.

First distinguish local ADK selection from current remote access:

```text
uv run orchestrate --version
uv run orchestrate env list
uv run orchestrate env add -n "<LOCAL_ALIAS>" -u "<WXO_API_URL_FROM_API_DETAILS>" --type mcsp
uv run orchestrate env activate "<LOCAL_ALIAS>"
uv run orchestrate models list
uv run orchestrate agents list -v
```

Skip `env add` when the reviewed API URL is already registered. `env list` and an
`(active)` marker show only the locally selected alias. `env activate` asks for the
WXO API key and refreshes the short-lived token; successful model/agent listings
are the current connectivity checks. Use the API URL from WXO **Settings > API
details**, not the browser address containing `/#/`.

The local ADK configuration is normally
`%USERPROFILE%\.config\orchestrate\config.yaml`; its token cache is normally
`%USERPROFILE%\.cache\orchestrate\credentials.yaml`. Do not read either into logs
or copy either into the repository. Use the masked activation prompt, not
`--api-key <value>` on a command line.

Select an exact model ID from `models list`, rerun the materialization command
above with that ID, and review the generated YAML. Then define the connection:

```text
uv run orchestrate connections list
uv run orchestrate connections add -a acme_support_api
uv run orchestrate connections configure -a acme_support_api --env draft -t team -k key_value
```

If `acme_support_api` already exists, do not add a duplicate. In WXO **Manage >
Connections**, set its Draft `base_url` to the separately deployed public HTTPS
Support API and enter `api_token` through the protected credential UI. The local
guided API binds to loopback and cannot be reached by a Python tool executing in
the WXO cloud.

With the active tenant and public API boundary confirmed, import dependencies
before the agent:

```text
uv run orchestrate tools import -k python -f tools/get_order_status.py -r tools/requirements.txt --app-id acme_support_api --safe
uv run orchestrate knowledge-bases import -f knowledge_bases/acme_return_policy.yaml --safe
uv run orchestrate agents import -f .generated/store_support_agent.yaml --safe
uv run orchestrate agents list -v
```

Run Draft chat validation as one foreground ADK 2.15 session attached to an
interactive terminal:

```text
uv run orchestrate chat ask --agent-name store_support_agent
```

In that same session, wait for each answer, ask the following three questions in
order, and then exit:

1. `What is the current status of order ACME-1042?`
2. `What is the standard return window?`
3. `Create a support case for order ACME-1042.`
4. Enter `q` and press Enter.

Do not provide the first question as a command argument. Do not pipe, redirect, or
pre-record stdin; do not use a here-string, run the chat under CI, or execute it
through a capture/subprocess wrapper without interactive stdin. In ADK 2.15,
repeated reads of non-interactive EOF can leave the chat loop running. When no real
TTY is available, record the check as `not_completed` rather than automating it.
Sanitize the observations only after the operator has exited with `q`.

The stable agent name is `store_support_agent`. The portal adapter instead needs
the tenant-assigned runtime agent ID. After import, obtain it from authorized
tenant details or generate a Draft-only embed configuration:

```text
uv run orchestrate channels webchat embed --agent-name store_support_agent --env draft
```

Copy only the returned `agentId` into the guided launcher's local prompt. Do not
commit the generated tenant metadata. No `orchestrate agents deploy` command is
included because this lifecycle ends in Draft and does not authorize Live.

## Candidate evaluation sequence

The following sequence evaluates a clean committed candidate; it is not a claim
that a particular candidate completed it:

```text
npm run doctor
npm run install:project
npx --no-install playwright install chromium
npm run preflight
npm run verify
npm run e2e:local
npm run e2e:built
pwsh ./scripts/release-audit.ps1 -Mode Full -Candidate v0.1.0-rc.1
```

The release audit records the exact candidate SHA, sanitized output, combined locked
dependency SBOM, and hard-gate status. It refuses a dirty tree, rechecks source and
archive binding, and writes `evidence-complete.json` last so an interrupted directory
cannot be mistaken for a complete bundle. It does not overwrite evidence for an
existing candidate label.

The optional Bob Shell workflow is not part of the required local verification
sequence. It repeats these deterministic gates in a credential-free GitHub-hosted
job. After GitHub reports that dependency as successful, the fresh ephemeral review
job creates a fixed same-run pass record locally; no gate-evidence artifact crosses
the job boundary. It gives Bob the complete tracked exact-candidate source plus that
record, not a diff, PR scope, logs, or test summaries. See
[Bob Shell in CI/CD](bob-shell-cicd.md); do not manufacture the required gate-evidence
file, invoke the Linux-only low-level command as a public workflow substitute, or
treat a Bob recommendation as a test result. Bob evidence is never automatically
overwritten.

## Deliberately absent lifecycle operations

There is intentionally no repository command for:

- a detached/background `up` or process-discovery `down`; both public launchers
  remain foreground-owned and stop from their launching terminal;
- replay-mode startup;
- automated WXO/Instana tenant acceptance;
- release signing, tagging, publication, deployment, automated tenant import, or
  Live promotion;
- removal of global runtimes, package caches, or the shared Playwright browser cache.

Until those operations exist and are observed, they remain `not_completed` or
`not_asserted`; documentation must not infer them from a successful build.
