# Current state

## Baseline snapshot

This snapshot records the repository before v0.1.0 release-preparation changes. It
is an inventory, not a release verdict.

| Property | Observed value |
| --- | --- |
| Snapshot date | 2026-09-02 |
| Baseline commit | `d63358866b0e36e793d0261c22a61c070da39cd2` |
| Host visibility | Private repository |
| Tracked files | 151 |
| Reachable commits across fetched local refs | 19 |
| Git tags | None |
| Git LFS entries | None observed |
| Git submodules | None |

The baseline is not a published `v0.1.0` release. A release branch or matching
working tree does not substitute for an immutable tag and release artifact.

## Implemented foundation

- A Next.js customer portal with same-origin server routes.
- A deterministic Fastify Support API with three fictional order fixtures.
- A local deterministic assistant provider.
- A server-side watsonx Orchestrate provider adapter.
- A Draft agent source package with one read-only order-status tool and one
  fictional return-policy knowledge source.
- Optional OpenTelemetry trace export, including a restricted Instana blue SaaS
  configuration path.
- An OpenAPI 3.0 contract.
- Vitest, pytest, contract, release-scan, and Playwright test sources.
- A read-only GitHub Actions CI workflow.
- Governance, security, evidence, contribution, licensing, and trademark documents.

## Current operating profiles

| Profile | Implementation state | Release-claim state |
| --- | --- | --- |
| Local/mock | Root launcher starts loopback API and portal with `AGENT_MODE=stub` | In v0.1.0 scope; candidate execution must still be evidenced |
| WXO Draft adapter | Provider and Draft package exist in source | `not_asserted` for tenant execution |
| Instana adapter | Restricted OTLP/HTTP configuration exists in source | `not_asserted` for tenant receipt or trace correlation |
| Replay | No runtime profile or UI | Out of scope |
| Forgejo pipeline | No implementation | Out of scope |
| Production/live | No end-to-end deployment profile | Out of scope |

## Material gaps at the baseline

- No tag or immutable v0.1.0 release artifact exists.
- Version identifiers are not yet aligned to the intended v0.1.0 release.
- No single release-audit command produces a candidate-bound evidence bundle.
- The evidence JSON files are synthetic examples, not reports from the baseline.
- The repository scanner evaluates the tracked working tree, not every historical
  Git object and ref.
- Local browser acceptance uses development servers and one primary journey.
- There is no complete install/up/down/reset/uninstall lifecycle.
- Optional WXO, Instana, and Bob paths have no direct external-run evidence in this
  snapshot.
- Repository-host controls such as branch protection, secret scanning, push
  protection, and private vulnerability reporting are external state and are not
  established by source files alone.

## Interpretation

The current source is best described as a local reference foundation with optional
integration seams. It must not be described as a completed autonomous SDLC pipeline,
a verified live IBM integration, or a production customer-support application.

Verification results produced for another commit, archive, machine, or earlier
repository state do not automatically transfer to the v0.1.0 candidate.
