# Limitations

## Product behavior

- The application is an educational demonstration, not a production service.
- Every Acme person, order, address, policy, identifier, and screenshot is fictional.
- Order data is static source-code fixture data, not live carrier data.
- The Support API has no database.
- Support-case creation returns a deterministic acknowledgement and does not create
  a durable ticket or notify a support team.
- Dates, carrier details, response times, prices, and contact details are demo copy,
  not a service commitment.
- The local assistant is deterministic code, not a remote model.
- Return guidance is educational fictional content and does not approve a refund or
  other resolution.

## Release engineering

- A source checkout cannot establish whether the repository host has a release tag;
  inspect the exact host and candidate before making a publication claim.
- The release audit verifies and normalizes evidence but deliberately does not sign,
  tag, publish, deploy, import, promote, or make the human release decision.
- There is no detached/background production lifecycle; the combined local launcher
  is foreground-owned, and production profiles exist only inside the bounded browser
  harness.
- Reset and uninstall cover a fixed project-local allowlist. They do not remove global
  runtimes, package caches, or the shared Playwright browser cache.
- Generated SBOM/evidence output is ignored locally and may be attached by the
  release-audit workflow; source presence alone does not prove that hosted run.
- The combined SBOM describes locked Node/Python components but is not a human-reviewed
  third-party notice or legal-compatibility decision.
- The scanners cover the tracked tree, all commits reachable from local refs, paths,
  selected binary metadata, and direct commit-email privacy. They are not general
  malware, license, or binary-behavior analyzers and cannot inspect refs not fetched.
- Repository settings and release attachments are external state and require separate
  inspection.

## Verification and evidence

- Unit and integration tests using doubles establish only controlled source behavior.
- The local Playwright suite contains one primary journey and one bounded malformed
  and missing-order scenario; it is not a complete failure-path, cross-browser,
  visual-regression, or accessibility suite.
- Contrast and semantic UI tests do not establish complete WCAG conformance.
- No load, endurance, chaos, penetration, or production acceptance test is asserted.
- Sample evidence files are synthetic and intentionally use placeholder SHAs.
- A correlation ID links bounded observations; it is not itself a distributed trace.
- A successful command applies only to the code and environment actually evaluated.
- Missing evidence is `not_completed` or `not_asserted`, not an inferred success.

## Optional IBM integrations

- IBM Bob is not distributed by the repository. The manual workflow is the supported
  public path and can invoke a separately installed and licensed Bob Shell runtime
  on its Linux review runner; the low-level controller command is intentionally
  Linux-only. Authenticated execution for the current candidate is `not_completed`.
- The maintainer reports Bob-assisted development of this case study, but no exact
  release commit is independently attributed to Bob without separate session-bound
  provenance.
- Bob controller, report, workspace-policy, and workflow-contract tests do not
  substitute for a protected authenticated run.
- WXO model availability, APIs, ADK behavior, tenant policy, and licensing may change.
- Local validation does not establish that WXO accepted an agent definition.
- `source=orchestrate` establishes adapter routing only, not internal tool invocation
  or knowledge retrieval.
- The repository does not automate WXO import, deployment, or Live promotion.
- Local OTLP tests do not establish Instana tenant receipt, indexing, retention, or
  trace-search behavior.
- Instana access for investigation is expected to remain read-only.
- IBM names describe optional interoperability; the project is independent and is
  not sponsored, endorsed, maintained, or certified by IBM.

## Excluded platform capabilities

- No Forgejo pipeline or runner.
- No replay capture or playback mode.
- No production deployment manifests, ingress, TLS, secret manager, identity
  provider, database, backup, disaster recovery, or operational SLO.
- No automatic merge, automatic approval, or autonomous release authority.

## Security and privacy

- The lab must not process production customer data.
- The repository cannot guarantee that an operator will not place sensitive text in
  an assistant message or support-case description.
- Server-side credentials reduce browser exposure but do not replace key rotation,
  tenant IAM, network controls, audit logging, or incident response.
- Dependency locking reduces drift but does not eliminate supply-chain compromise.
- Source review cannot establish legal ownership of every contribution or asset;
  maintainers must perform that review before publication.

## Compatibility

- The declared local toolchain is Node.js 24, npm 11, Python 3.12.10, `uv`, and
  Chromium for browser acceptance.
- Other Node, npm, Python, browser, operating-system, proxy, or tenant combinations
  are not implied to work unless separately observed.
- Optional vendor documentation and APIs may change after this release; use current
  official documentation before any account-backed operation.
