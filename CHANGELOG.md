# Changelog

All notable changes to this project are documented in this file. The format is
based on Keep a Changelog, and the project intends to use Semantic Versioning.

## [Unreleased]

### Added

- Candidate-bound Quick and Full release audits with redacted, normalized evidence.
- Full-history release scanning, an offline combined Node/Python CycloneDX SBOM,
  and a reviewable dependency-license metadata inventory.
- Production-build browser acceptance and a safe missing-order failure journey.
- CodeQL, dependency review, and scheduled dependency-update definitions.
- Release scope, runtime, data-flow, threat-model, and lifecycle guidance.
- An end-to-end IBM Bob and watsonx Orchestrate ADK case-study narrative plus a
  facilitator-ready workshop.
- A staged Bob IDE workshop flow with ready-to-paste plan, local materialization,
  WXO Draft import, portal-connect, and evidence-review prompts.
- Optional direct Instana Blue SaaS OTLP/HTTP export in the guided launcher with a
  masked Agent Key prompt and per-session synthetic correlation ID.
- A visible assistant-source badge and three bounded Draft starter scenarios for
  order status, return policy, and the human-controlled case-creation boundary.
- A manual two-job Bob Shell advisory-review workflow with service-controlled gate
  ordering, a locally created same-run pass record, complete exact-SHA tracked-source
  review, isolated checkout, restricted tools, tracked-worktree mutation detection,
  non-overwriting sanitized evidence, strict report validation, and controller tests.

### Changed

- Aligned project and workspace versions for the planned `v0.1.0` release.
- Clarified that support cases, carrier data, policies, and customer details are
  fictional and non-persistent.
- Made the optional correlation header match runtime behavior.
- Updated the locked Python test dependency to a non-vulnerable release.
- Repositioned the public README around the Bob IDE to ADK to CI/CD learning path,
  while preserving explicit external-evidence and human-approval boundaries.
- Extended current-tree and full-history release scans to detect IBM Bob API-key
  signatures without retaining or printing matched values.
- Documented ADK 2.15 Draft chat as a foreground TTY session with an explicit `q`
  exit so workshop automation cannot loop on non-interactive EOF.
- Made Bob Shell 2.0.2 machine-output handling fail closed while accepting its
  observed bounded diagnostic JSONL prefix; persisted evidence records only the
  diagnostic count and never the diagnostic messages.

### Removed

- A duplicate OpenAPI validation script and a test-only legacy client alias.
