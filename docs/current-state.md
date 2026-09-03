# Current state

## Source snapshot

This document describes the checked-in `v0.1.0` case-study source as of
2026-09-03. It intentionally does not embed its own commit hash: use
`git rev-parse HEAD` and `git status --short` to identify the exact candidate being
evaluated. Repository visibility, branch protection, environments, secrets, runners,
workflow runs, tags, and releases are host state and cannot be proven by source files.

## Implemented foundation

- Next.js customer portal and deterministic local assistant.
- Fastify Support API with fictional orders and non-persistent support-case
  acknowledgements.
- Server-only watsonx Orchestrate provider and MCSP token adapters.
- A workshop-ready watsonx Orchestrate ADK template, read-only order tool,
  knowledge source, starter prompts, offline materializer, validator, fixtures, and
  Python tests. Bob IDE can guide the participant through model-specific
  materialization and a separately authorized Draft-only import.
- An existing server-side portal adapter that can be pointed at a selected WXO
  agent after that import; the launcher does not create or promote the agent.
- Optional direct OTLP/HTTP export from the Support API to the restricted Instana
  blue SaaS endpoint through the guided launcher, without a system agent or
  collector installation.
- OpenAPI contract, unit/integration tests, repository scanners, dependency audits,
  CycloneDX generation, license metadata inventory, and browser acceptance for both
  development and production-build profiles.
- Candidate-bound Quick/Full release audit with redacted, checksummed completion
  evidence.
- Manual Bob Shell exact-SHA advisory workflow, split between a GitHub-hosted
  deterministic-gates job and a separate credentialed ephemeral review job.
- The fresh review job creates its fixed same-run pass record only after GitHub's
  service-controlled dependency reports gate success; no gate artifact is transferred.
- Strict Bob report contract, public-output validation, workspace policy, tracked
  worktree mutation snapshot, and repository-owned controller/workflow tests.
- Case-study narrative, facilitator-ready workshop, governance, security, licensing,
  and trademark documentation.

## Evidence state

| Capability | Source state | External/runtime claim |
| --- | --- | --- |
| Local mock product | Implemented | Must be rerun and evidenced for each exact release candidate |
| ADK package and Bob IDE build stage | Ready components, materializer, validation, and workshop choreography implemented | Authenticated tenant import and Draft behavior `not_asserted` |
| WXO portal adapter | Existing server-side adapter and guided runtime configuration implemented; controlled-double tests exist | Authenticated tenant routing, tool use, and retrieval `not_asserted` |
| Instana direct OTLP path | Opt-in guided runtime configuration and local wire tests implemented | Tenant receipt, indexing, and correlation `not_asserted` |
| Bob IDE workflow | Draft-only prompts and human gates documented | A materialized file is not import evidence; private session details are not part of the repository |
| Bob Shell controller | Implemented and locally contract-tested | Authenticated review status is established per exact candidate by a validated protected-run artifact |
| GitHub workflows | Definitions are versioned with bounded permissions and pinned actions | Hosted runs and repository settings require direct observation |
| Public release | Prepared source and process | Tag, release artifact, publication, and human GO not established by this file |

## Operating profiles

| Profile | Implementation state | Release-claim state |
| --- | --- | --- |
| Local/mock | Loopback launcher forces `AGENT_MODE=stub`; telemetry is off by default but may be enabled independently for Instana | In scope and credential-free when the optional Instana path remains disabled |
| Bob IDE to WXO Draft | Ready template/tool/knowledge/backend plus offline materialization and validation | A separately authorized import must stop at Draft; tenant acceptance is `not_asserted` |
| Existing portal to WXO | Account-backed server adapter and guided foreground configuration | The operator selects the agent; environment state, tenant response, tool use, and retrieval are `not_asserted` |
| Instana direct OTLP | Guided launcher can scope a masked Agent Key to the Support API and export application traces directly | No system collector is installed; receipt/correlation remains `not_asserted` |
| Bob Shell review | Later manual two-job workflow and controller | Optional; without an exact-candidate artifact the review claim is `not_asserted` |
| Replay | No runtime profile or UI | Out of scope |
| Production/Live | No end-to-end deployment profile | Out of scope |

## Work remaining before a public announcement can claim completed external use

1. Commit the intended candidate and rerun all deterministic gates against that
   exact SHA.
2. Review the candidate-specific ownership, notices, assets, dependencies, and
   public wording.
3. If claiming WXO Draft use, materialize and review the tenant-compatible definition
   in Bob IDE, perform an explicitly authorized Draft import, and retain sanitized
   exact-candidate import evidence; do not describe it as Live deployment.
4. If claiming portal-to-WXO use, point the existing portal at that selected agent and
   retain separate routing evidence. Do not infer tool invocation or knowledge
   retrieval from response text.
5. If claiming Instana receipt, opt in to the direct OTLP path and separately observe
   the sanitized correlation in the tenant; exporter output alone is insufficient.
6. If claiming Bob Shell CI/CD execution, configure the protected `bob-review`
   environment and disposable runner, then complete the manual workflow and review
   its sanitized report.
7. Record a human GO/NO-GO for the exact candidate before tagging or publishing.

The source is best described as an evidence-first workshop in which IBM Bob IDE
builds a Draft agent from ready components, the existing portal can connect to the
selected WXO agent, Instana can be enabled independently for direct Support API
traces, and Bob Shell provides a later bounded CI/CD review path. It is not a
production service, an IBM product, or proof that any optional external system
accepted or ran the current candidate.
