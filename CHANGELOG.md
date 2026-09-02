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
- Release scope, runtime, data-flow, threat-model, lifecycle, and AI-usage guidance.
- An end-to-end IBM Bob and watsonx Orchestrate ADK case-study narrative plus a
  facilitator-ready workshop.
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

### Removed

- A duplicate OpenAPI validation script and a test-only legacy client alias.
