# Component inventory

## Runtime and delivery components

| Component | Location | Entrypoint | Responsibility | State in v0.1.0 |
| --- | --- | --- | --- | --- |
| Root orchestrators | `package.json`, `scripts/dev-local.mjs`, `scripts/guided-launcher.mjs` | `npm run dev`, `npm run guided` | Starts the local portal/API with an allowlisted environment; guided flow can explicitly select account-backed WXO and request browser previews | In scope |
| Customer portal | `apps/portal` | `src/app/page.tsx` | Renders order lookup, assistant, return guidance, and support-case form | In scope |
| Portal health route | `apps/portal/src/app/api/health/route.ts` | `GET /api/health` | Returns a small readiness response for the portal process | In scope |
| Portal order boundary | `apps/portal/src/app/api/orders/[orderId]/route.ts` | `GET /api/orders/{orderId}` | Validates input and proxies order lookup to the Support API | In scope |
| Portal assistant boundary | `apps/portal/src/app/api/agent/route.ts` | `POST /api/agent` | Validates messages, adds current-order context, and selects an assistant provider | Local path in scope; WXO execution `not_asserted` |
| Portal support-case boundary | `apps/portal/src/app/api/support-cases/route.ts` | `POST /api/support-cases` | Enforces same-origin JSON input and proxies a case request | In scope |
| Local assistant provider | `apps/portal/src/lib/agent/StubAgentProvider.ts` | `sendMessage()` | Deterministic status lookup and fictional return-policy guidance | In scope as mock |
| WXO provider adapter | `apps/portal/src/lib/agent/OrchestrateAgentProvider.ts` | `sendMessage()` | Calls the configured WXO agent after server-side token exchange | Source-level only |
| MCSP token adapter | `apps/portal/src/lib/agent/McspV2TokenProvider.ts` | `getToken()` | Exchanges a WXO API key for a bounded, cached access token | Source-level only |
| Support API | `services/support-api` | `src/server.ts` | Serves health, readiness, fictional orders, and support-case acknowledgements | In scope |
| Order fixtures | `services/support-api/src/orders.ts` | `findOrder()` | Holds three immutable fictional order records | In scope |
| Support-case service | `services/support-api/src/support-cases.ts` | `create()` | Returns a deterministic acknowledgement; it does not persist data | In scope with limitation |
| Telemetry adapter | `services/support-api/src/telemetry.ts` | `initializeTelemetry()` | Optionally exports application HTTP spans through OTLP/HTTP | Source-level; external receipt `not_asserted` |
| Runtime configuration | `services/support-api/src/config.ts` | `loadConfig()` | Validates bind, auth, CORS, OTLP, and Instana settings | In scope |
| Public API contract | `contracts/support-api.yaml` | OpenAPI 3.0 document | Describes local and external API profiles | In scope |
| Draft agent definition | `agents/store_support_agent/agents` | `store_support_agent.template.yaml` | Defines a reviewable native Draft agent | Source-level only |
| Draft order tool | `agents/store_support_agent/tools/get_order_status.py` | `get_order_status()` | Performs a bounded read-only order lookup | Source-level; tenant invocation `not_asserted` |
| Draft knowledge base | `agents/store_support_agent/knowledge_bases` | `acme_return_policy.yaml` | References the fictional return-policy document | Source-level; tenant retrieval `not_asserted` |

## Verification and repository components

| Component | Location | Purpose | Important boundary |
| --- | --- | --- | --- |
| Portal tests | `apps/portal/src/__tests__` | Component, route, provider, and client checks | Controlled local doubles do not prove external WXO behavior |
| API tests | `services/support-api/tests` | Unit, integration, logging, contract, and OTLP wire checks | Local collector fixtures do not prove Instana ingestion |
| Agent tests | `agents/store_support_agent/tests` | Validate package structure, tool behavior, and offline cases | Do not import or run an agent in a tenant |
| Browser acceptance | `tests/e2e` | Runs the primary journey plus malformed and missing-order behavior | Root built command creates fresh production artifacts; neither profile covers live integrations |
| Current-tree scanner | `scripts/public-release-scan.mjs` | Scans tracked files for selected content/path/mode hazards | Does not inspect external repository settings |
| History scanner | `scripts/history-release-scan.mjs` | Scans every blob/path reachable from local refs and direct commit-email metadata | Cannot inspect refs that were not fetched or decide whether personal metadata exposure is acceptable |
| Documentation/asset scanner | `scripts/documentation-scan.mjs` | Checks tracked Markdown targets, path case, and selected binary metadata | Does not validate changing external destinations or all binary formats |
| SBOM generator | `scripts/generate-sbom.mjs` | Combines npm and Python locks into deterministic CycloneDX 1.6 | Does not replace a human license/notice review |
| License metadata inventory | `scripts/generate-license-inventory.mjs` | Deduplicates the locked npm graph, enriches it from installed manifests, adds installed Python distributions, and flags ambiguous or absent metadata | Generation can pass while legal review remains `not_asserted` |
| Release audit | `scripts/release-audit.mjs`, `.ps1` | Runs Quick/Full hard gates and writes redacted evidence for an exact candidate | Does not approve, sign, tag, publish, deploy, import, or promote |
| Bob Shell advisory controller | `scripts/bob-shell-review.mjs`, `scripts/bob-review-*.mjs` | After service-controlled gate success, creates and validates a fixed same-run pass record, creates a pristine exact-candidate checkout, gives Bob the complete tracked source for bounded read-only review, and validates non-overwriting sanitized output | Manual and optional; source presence does not prove authenticated execution or release readiness |
| Bob review report contract | `contracts/bob-review.schema.json` | Defines the public-safe exact-SHA advisory report shape | A valid report is advisory and cannot override deterministic gates |
| Cleanup helper | `scripts/cleanup-local.mjs` | Resets allowlisted generated state or removes project-local dependency state | Requires explicit confirmation and preserves global/shared caches |
| CI definitions | `.github/workflows` | Define verification, browser, CodeQL, dependency-review, and release-audit jobs with bounded permissions | Source presence does not prove a host-side workflow ran or a security feature is enabled |
| Evidence examples | `examples/evidence` | Demonstrate the four-state evidence vocabulary | Always synthetic samples |
| Bob prompt examples | `examples/prompts` | Demonstrate plan, approval, and strict machine-readable review choreography | IDE prompts remain human-operated; the Shell prompt is consumed only by the manual controller |
| Design assets | `design`, `docs/assets`, portal CSS | Provide owned visual presentation and tokens | Visual presence is not accessibility certification |
| Governance documents | Root Markdown files and `docs` | Define contribution, security, evidence, and claim boundaries | Policy text requires enforcement and observed evidence |

## Repository shape

The tracked tree is the source of truth; use `git ls-files` against the exact
candidate when a count is needed. Generated dependencies, caches, build outputs,
Playwright reports, local environments, release evidence, and Bob review artifacts
are not source components.

## Explicitly absent components

- Forgejo server, runner, workflow, or issue-ingestion controller.
- Docker Compose or Kubernetes deployment.
- Terraform configuration.
- Database or durable case store.
- Replay recorder, fixture player, or replay UI.
- Automated WXO tenant importer or Live promotion command.
- An always-on or automatically triggered IBM Bob runner. The shipped Bob Shell
  workflow is manual and requires a separately administered ephemeral runner.
- Automatic merge or human-approval enforcement service.
