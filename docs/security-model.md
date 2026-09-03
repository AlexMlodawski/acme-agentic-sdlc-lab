# Security model

## Security objective

The v0.1.0 security objective is narrow: keep the default fictional local/mock
profile deterministic, loopback-only, and free of application credentials while
providing bounded source-level adapters for optional external services.

This model is not a penetration-test result, production security assessment, or
assertion about repository-host settings and external tenants.

## Protected assets

- Source and release-candidate integrity.
- Server-side Support API, WXO, and Instana credentials.
- Human release authority.
- Accuracy of the `priority` API contract.
- Integrity and provenance of release evidence.
- Fictional-only data boundary.
- Availability of the local portal and API within bounded resource use.

## Implemented controls

### Local process isolation

- The root launcher binds the portal and API to loopback.
- It passes an allowlisted process environment and explicitly disables API auth and
  telemetry only for the credential-free local profile.
- It forces the deterministic stub provider.
- The guided launcher keeps the same loopback/API boundary, validates ports and
  WXO identifiers, masks key input, filters child output, and terminates its
  launcher-owned process tree when the session ends.

### Server-side credential boundaries

- Portal integrations are implemented in server-only modules.
- WXO and Support API tokens are read from server environment variables.
- No credential uses a `NEXT_PUBLIC_` name.
- The only browser-exposed configured value is a bounded demonstration correlation
  identifier, which must not contain a secret.

### Input and protocol controls

- Browser POST routes require JSON and reject mismatched origins when an Origin
  header is present.
- Portal and API payloads use bounded schema validation.
- Unknown support-case fields are rejected; the supported field is `priority`, not
  `priorityLevel`.
- Order identifiers, thread identifiers, correlation identifiers, ports, and
  integration identifiers are constrained.
- Credential-bearing HTTP clients reject or do not follow redirects.
- Remote Support API HTTP is rejected; plain HTTP is limited to exact loopback hosts.
- WXO endpoints are constrained to the expected HTTPS hostname and instance path.
- External response bodies and timeouts are bounded.

### API exposure controls

- The Support API defaults to loopback.
- A non-loopback bind requires explicit bearer protection and a non-empty token.
- Token comparison uses fixed-size digests and timing-safe comparison.
- CORS uses an explicit configured origin list.
- Health and readiness endpoints intentionally remain public.

### Logging and telemetry minimization

- Expected validation errors are normalized before logging.
- Logs use bounded correlation, route, status, and recognized fictional order IDs.
- Dedicated exporter diagnostics omit endpoint URLs, headers, payloads, and secrets.
- OpenTelemetry host-resource discovery is disabled.
- The current SDK configuration exports application HTTP traces, not application
  logs, host metrics, or filesystem spans.

### Repository and supply-chain controls

- npm and Python lockfiles are tracked.
- Direct dependency versions and CI actions are pinned in source.
- CI declares read-only repository contents permission.
- The tracked-tree release scanner checks selected high-confidence secret formats,
  user paths, forbidden private references, hazardous filenames, file modes, links,
  and oversized files.
- The history scanner covers all blobs and paths reachable from fetched local refs
  and reports direct commit-email metadata only as a count.
- The combined CycloneDX generator reads the npm and Python lockfiles offline and
  retains only allowlisted public distribution URLs.
- The candidate audit strips credential-like environment names, redacts retained
  output, refuses a dirty tree by default, rechecks source state, validates the
  clean-archive SHA, and never overwrites existing evidence. A checksum-bound
  `evidence-complete.json` marker is written last; without it the bundle is partial.
- Reset/uninstall uses a fixed contained target list and refuses linked roots/targets.
- Generated environments, build outputs, test reports, `.env` files, and generated
  SBOM output are ignored by Git.

## Evidence controls

Release evidence may contain exact candidate identity, timestamps, synthetic IDs,
status codes, bounded durations, owned screenshots, and sanitized diagnostics. It
must not contain credentials, unrestricted environment dumps, private tenant URLs,
auth state, production data, raw model reasoning, or unsupported inferences.

The four result states are semantically distinct. A tool returning exit code zero
supports only the claim that tool was designed to check; it does not establish
external service behavior or overall release readiness.

## Residual risk and unverified controls

- History coverage depends on the completeness of fetched local refs and excludes
  unreachable/dangling objects and ignored/untracked local files by design.
- Dependency lockfiles do not eliminate malicious-publisher or compromised-package
  risk.
- The Bob Shell deterministic-gates job executes candidate-controlled installation
  and test code. A Git clone is not a sandbox, so that job is separated from the
  credentialed review job and both require disposable runner boundaries.
- The deterministic job only runs the fixed commands. GitHub's service-controlled
  successful dependency starts the fresh advisory job, which creates `gates.json`
  locally; no gate artifact or candidate test summary crosses into that job.
- Bob sees the complete tracked exact-candidate source. The byte mutation snapshot
  covers tracked worktree content, not `.git`; separate Git identity/status guards
  protect the repository-state boundary.
- The combined lockfile SBOM does not form a reviewed license/notice bundle.
- Browser E2E covers one primary and one bounded failure journey in development and
  production-build profiles; it does not exercise every failure or external integration.
- Prompt injection and model behavior cannot be eliminated by source instructions.
- A response labeled `orchestrate` does not prove internal tool or retrieval use.
- External TLS, tenant IAM, audit logging, retention, and service availability are
  operator-controlled and `not_asserted`.
- GitHub branch protection, required reviews, CodeQL, secret scanning, push
  protection, and vulnerability-reporting configuration require direct repository
  setting observations.
- Hosted workflow runs, protected-environment rules, authenticated Bob review,
  artifact signing, and provenance attestation require separate observation; source
  definitions alone do not prove those controls are active.

## Release security boundary

Security review must bind findings to the exact release candidate. A clean current
tree cannot establish that old Git objects, release attachments, repository settings,
or a differently built archive are clean. Any credential finding requires revocation
and history/remediation analysis; simply deleting the visible string is insufficient.
