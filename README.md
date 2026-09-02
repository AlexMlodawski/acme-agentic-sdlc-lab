# Acme Agentic SDLC Lab

An evidence-first, human-governed reference lab for deciding whether an
AI-assisted customer-support change is ready to release.

The `v0.1.0` scope is deliberately narrow: a deterministic local portal and API,
real browser acceptance, optional IBM-oriented source adapters, and a candidate-bound
release audit. It is a learning lab, not a production service or an autonomous
release platform.

> AI output is a candidate contribution. Tests produce evidence. A human owns the
> release decision.

![Mock-mode Acme portal with contextual assistant](docs/assets/acme-agentic-support.png)

The screenshot shows fictional data in local **mock** mode.

## What is validated

- A Next.js portal and Fastify Support API run on loopback with synthetic Acme data.
- A deterministic contextual assistant explains fictional order status and policy.
- Support-case creation returns a correlated, non-persistent sample acknowledgement.
- Unit, integration, OpenAPI, Python, and Playwright suites exercise the local path.
- Browser acceptance covers both development and fresh production-build profiles,
  including invalid and missing-order behavior.
- Current-tree and full reachable-history scanners report only safe counts/statuses.
- An offline generator combines locked npm and Python components into CycloneDX 1.6.
- A Full release audit binds redacted evidence to one exact Git commit and fails on
  any incomplete or failed hard gate.

## What is not claimed

The repository has source-level seams and guidance for watsonx Orchestrate Draft,
Instana, and IBM Bob. The `v0.1.0` release claim does **not** include observed tenant
execution, Instana trace receipt, Bob authorship, a Forgejo pipeline, replay mode,
WXO Live promotion, deployment, or automatic approval. Those states remain
`not_asserted` unless a separately authorized, candidate-bound run proves them.

See [release scope](docs/release-scope.md) and [limitations](docs/limitations.md).

## Local quickstart

The full verified toolchain is:

- Git;
- Node.js `24.19.0` and npm `11.17.0`;
- Python `3.12.10` and `uv` `0.12.0`;
- Chromium installed through the locked Playwright package for browser tests.

Check the host, install project-local dependencies, and start the foreground
services:

```text
npm run doctor
npm run install:project
npm run up
```

Open `http://127.0.0.1:3000`, search for `ACME-1042`, open **Order assistant**,
and ask:

```text
What is the status of this order, and what is the standard return window?
```

Stop both child services with `Ctrl+C` in the launching terminal. This profile
forces `AGENT_MODE=stub`, disables telemetry, uses loopback endpoints, and does not
load an `.env` file. Dependency installation can use configured public package
indexes; the running demo makes no intended external business request.

For only the web/API subset, Node and npm are sufficient:

```text
npm ci --ignore-scripts
npm run dev
```

## Verification

After project installation, install the Playwright-managed browser once:

```text
npx --no-install playwright install chromium
```

Then run:

```text
npm run preflight
npm run verify
npm run e2e:local
npm run e2e:built
```

`e2e:local` starts isolated development servers. `e2e:built` first creates fresh
production artifacts and then starts isolated production profiles. Neither command
contacts an IBM tenant.

## One-command candidate audit

Commit the intended candidate and make sure the worktree is clean. Then run:

```text
pwsh ./scripts/release-audit.ps1 -Mode Full -Candidate v0.1.0-rc.1
```

The equivalent cross-platform Node entrypoint is:

```text
npm run release:audit -- --mode Full --candidate v0.1.0-rc.1
```

The audit records exact SHA/branch state, toolchain checks, Git integrity, current
and historical privacy scans, lint/typecheck/tests/build, complete npm and Python
vulnerability audits, a combined SBOM, a reviewable dependency-license metadata
inventory, both browser profiles, and clean-archive verification. Redacted logs and
`report.json` are written to the ignored directory
`release-evidence/v0.1.0-rc.1` without overwriting existing candidate evidence.
Treat the bundle as complete only when `evidence-complete.json` exists, matches the
candidate and source SHA, and binds the report to `checksums.sha256`; it is written
last, after final source-state verification.

The evidence vocabulary is exact:

- `pass` — the stated check completed and its evidence exists;
- `fail` — the check completed and found a blocker;
- `not_completed` — execution did not reach or finish the check;
- `not_asserted` — available evidence cannot support the claim.

A zero exit code means the automated hard gates passed; it is not human approval and
does not merge, tag, publish, deploy, import, or promote anything. Use the
[release checklist](.github/RELEASE_CHECKLIST.md) for human and repository-host
gates.

## Operating modes

| Mode | v0.1.0 state | Meaning |
| --- | --- | --- |
| Mock | Implemented and locally testable | Deterministic portal, API, assistant, policy, and fictional fixtures |
| Replay | Not implemented | No capture/playback runtime or UI is shipped |
| Live | Source adapters only; tenant execution `not_asserted` | Bring-your-own-account WXO Draft and optional OTLP/Instana configuration |

Credentials for optional modes must remain server-side and outside Git. Draft is
not Live, and `source=orchestrate` proves adapter routing only; it does not prove an
internal tool call or knowledge retrieval. Start with the
[IBM integration guide](docs/ibm-integrations.md) and [live-mode boundary](docs/live-mode.md).

## Architecture and decision flow

```mermaid
flowchart LR
  Human[Human requirement and scope] --> Change[Reviewable code candidate]
  Change --> Gates[Lint, contracts, tests, builds, scans]
  Gates --> Browser[Local real-browser acceptance]
  Browser --> Evidence[Redacted evidence bound to exact SHA]
  Evidence --> Decision{Human release decision}
  Decision -->|GO after external gates| Release[Tag and publish]
  Decision -->|NO-GO| Fix[Fix or reduce scope]
  Fix --> Change

  Portal[Next.js portal] --> Provider{Assistant provider}
  Provider --> Stub[Deterministic mock]
  Provider -. optional / not asserted .-> WXO[WXO Draft adapter]
  Portal --> API[Fastify Support API]
  API -. optional / not asserted .-> OTel[OTLP / Instana]
```

The release-audit automation stops at evidence. Only a maintainer can take the
external release action.

## Repository map

- `apps/portal` — product UI and server-side assistant adapters;
- `services/support-api` — deterministic API and optional OTLP instrumentation;
- `agents/store_support_agent` — optional Draft agent source package;
- `contracts` — OpenAPI and normalized release-evidence schemas;
- `tests/e2e` — local development and production-build browser journeys;
- `scripts` — bounded launch, scan, SBOM, cleanup, and audit entrypoints;
- `examples` — fictional prompts and explicitly synthetic evidence samples;
- `docs` — architecture, security, operating modes, lifecycle, and limits.

Useful starting points are the [architecture](docs/architecture.md),
[runtime flow](docs/runtime-flow.md), [data flow](docs/data-flow.md),
[security model](docs/security-model.md), [threat model](docs/threat-model.md),
[local demo](docs/demo.md), [lifecycle reference](docs/lifecycle-commands.md), and
[troubleshooting guide](docs/troubleshooting.md).

## Cleanup boundaries

`npm run reset` removes only a fixed allowlist of generated project state.
`npm run uninstall:project` additionally removes project-local npm and Python
dependencies. Both preserve release evidence. `npm run purge:evidence` is the
separate, explicit destructive command for deleting the complete ignored
`release-evidence` tree. All three commands verify the repository root, reject
tracked targets, and enforce path containment. They preserve source, Git history,
global runtimes, package-manager caches, and the shared Playwright browser cache.
Stop running services first.

## Security, privacy, and AI usage

Use fictional data only. Never commit credentials, tenant exports, browser auth
state, production customer content, or private observability payloads. Report a
vulnerability through the process in [SECURITY.md](SECURITY.md).

AI coding tools may assist with bounded engineering work, but they do not own scope,
claims, approval, or external actions. The disclosure and attribution rules are in
[AI_USAGE.md](AI_USAGE.md).

## Community, licensing, and trademarks

This is an independent community project. It is not an IBM product and is not
sponsored, endorsed, supported, or maintained by IBM. IBM, Bob, watsonx, watsonx
Orchestrate, and Instana are trademarks of International Business Machines
Corporation in many jurisdictions. See [TRADEMARKS.md](TRADEMARKS.md).

The source is offered under [Apache License 2.0](LICENSE). Maintainers must still
complete the candidate-specific ownership, asset, dependency-license, and notice
review described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before
publication. Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md).

Citation metadata is available in [CITATION.cff](CITATION.cff). Release changes are
recorded in [CHANGELOG.md](CHANGELOG.md), and future work is in the
[roadmap](docs/roadmap.md).
