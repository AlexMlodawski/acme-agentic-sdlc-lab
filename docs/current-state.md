# Current state

## Source snapshot

This document describes the checked-in `v0.1.0` case-study source as of
2026-09-02. It intentionally does not embed its own commit hash: use
`git rev-parse HEAD` and `git status --short` to identify the exact candidate being
evaluated. Repository visibility, branch protection, environments, secrets, runners,
workflow runs, tags, and releases are host state and cannot be proven by source files.

## Implemented foundation

- Next.js customer portal and deterministic local assistant.
- Fastify Support API with fictional orders and non-persistent support-case
  acknowledgements.
- Server-only watsonx Orchestrate provider and MCSP token adapters.
- Versioned watsonx Orchestrate ADK agent, read-only order tool, knowledge source,
  offline materializer, validator, fixtures, and Python tests.
- Optional OTLP/HTTP telemetry path with restricted Instana configuration.
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
| ADK package | Implemented and locally testable | Tenant import and Draft behavior `not_asserted` |
| WXO portal adapter | Implemented and tested with controlled doubles | Authenticated tenant response, tool use, and retrieval `not_asserted` |
| Instana adapter | Implemented and locally wire-tested | Tenant receipt, indexing, and correlation `not_asserted` |
| Bob IDE workflow | Prompts and human gates documented | Plan-first workflow is documented; private session details are not part of the repository |
| Bob Shell controller | Implemented and locally contract-tested | Authenticated exact-candidate review `not_completed` |
| GitHub workflows | Definitions are versioned with bounded permissions and pinned actions | Hosted runs and repository settings require direct observation |
| Public release | Prepared source and process | Tag, release artifact, publication, and human GO not established by this file |

## Operating profiles

| Profile | Implementation state | Release-claim state |
| --- | --- | --- |
| Local/mock | Loopback launcher forces `AGENT_MODE=stub` and disables telemetry | In scope |
| WXO Draft | Source package and server adapter | Prepared for separately authorized import and validation; execution `not_asserted` |
| Instana | Restricted source adapter | Receipt/correlation `not_asserted` |
| Bob Shell review | Manual two-job workflow and controller | Optional; authenticated run `not_completed` |
| Replay | No runtime profile or UI | Out of scope |
| Production/Live | No end-to-end deployment profile | Out of scope |

## Work remaining before a public announcement can claim completed external use

1. Commit the intended candidate and rerun all deterministic gates against that
   exact SHA.
2. Review the candidate-specific ownership, notices, assets, dependencies, and
   public wording.
3. If claiming WXO Draft use, perform an explicitly authorized Draft import/test and
   retain sanitized exact-candidate evidence; do not describe it as Live deployment.
4. If claiming Bob Shell CI/CD execution, configure the protected `bob-review`
   environment and disposable runner, then complete the manual workflow and review
   its sanitized report.
5. Record a human GO/NO-GO for the exact candidate before tagging or publishing.

The source is best described as an evidence-first IBM Bob and watsonx Orchestrate ADK
case study with an implemented Bob Shell CI/CD review path. It is not a production
service, an IBM product, or proof that any optional external system accepted or ran
the current candidate.
