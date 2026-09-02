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
treat an AI recommendation as a test result. Bob evidence is never automatically
overwritten.

## Deliberately absent lifecycle operations

There is intentionally no repository command for:

- a detached/background `up` or process-discovery `down`; the safe public launcher
  remains foreground-owned and stops with `Ctrl+C`;
- replay-mode startup;
- WXO/Instana live acceptance;
- release signing, tagging, publication, deployment, tenant import, or promotion;
- removal of global runtimes, package caches, or the shared Playwright browser cache.

Until those operations exist and are observed, they remain `not_completed` or
`not_asserted`; documentation must not infer them from a successful build.
