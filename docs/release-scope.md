# Release scope: v0.1.0

## Release statement

Version `v0.1.0` is scoped as a validated local/mock foundation for demonstrating
evidence-aware, human-governed software delivery. It is not a production platform,
an autonomous release system, or proof that any optional IBM service was exercised.

The release candidate must be identified by an exact Git commit and evaluated from
that exact source. A branch name, working-directory state, screenshot, or sample
report is not sufficient candidate identity.

## In scope

- A fictional Acme customer-support portal running on loopback.
- A deterministic Support API with synthetic order fixtures and no database.
- The local `stub` assistant provider, treated as the v0.1.0 mock implementation.
- Order lookup, contextual status and return-policy guidance, and deterministic
  support-case acknowledgement.
- The public OpenAPI contract and the required `priority` request field.
- Unit, integration, contract, and local browser test sources.
- A zero-secret local launcher and bounded repository verification commands.
- Candidate-bound redacted evidence, combined locked-dependency SBOM generation,
  and clean-archive verification.
- Source-level adapters for watsonx Orchestrate Draft and Instana OTLP/HTTP.
- Source-level guidance for a human-controlled IBM Bob development session and an
  optional, manual exact-SHA Bob Shell advisory-review controller.
- The evidence vocabulary `pass`, `fail`, `not_completed`, and `not_asserted`.
- Apache-2.0 licensing, community-project positioning, and IBM trademark disclaimers.

## Optional source-level material

The following material may ship because it is useful for review and extension, but
it does not expand the validated release claim:

| Capability | What v0.1.0 includes | Permitted claim |
| --- | --- | --- |
| watsonx Orchestrate | Draft agent definition, token/provider adapter, read-only order tool, tests with controlled doubles | Source-level integration seam; tenant execution is `not_asserted` |
| Instana | Restricted OTLP/HTTP configuration and local wire-level test sources | Export adapter exists; tenant receipt and trace correlation are `not_asserted` |
| IBM Bob | Plan/approval prompts plus a manual two-job Bob Shell exact-SHA controller, service-ordered same-run pass record, full tracked-source review, strict non-overwriting report contract, tracked-worktree mutation guard, and tests | Controller source is implemented; Bob IDE commit attribution and authenticated Bob Shell execution require separate evidence |
| GitHub | Least-privilege CI, CodeQL, dependency-review, update, and release-audit definitions | Source-level automation only; execution and repository settings require separate observation |

## Out of scope

- A Forgejo issue-to-release pipeline.
- Replay UI, replay data capture, or a replay runtime profile.
- Automatic or required IBM Bob execution, and unsupported attribution of this
  release to a Bob session.
- Automated import, deployment, or promotion into watsonx Orchestrate.
- watsonx Orchestrate Live changes or production tenant use.
- Verified execution against any external WXO or Instana tenant.
- A production ingress, TLS termination, identity provider, database, queue, or
  durable support-case system.
- Production customer data, credentials, tenant exports, browser profiles, or
  proprietary vendor binaries.
- Automated merge, automatic release approval, or replacement of the human gate.
- A claim of complete accessibility conformance, penetration testing, load testing,
  legal ownership review, or production readiness.

## Release decision boundary

The repository may provide checks and evidence, but a human maintainer owns the
release decision. An optional integration remains `not_asserted` unless direct,
sanitized evidence from the exact candidate supports the narrower claim. Missing or
unfinished work must be reported as `not_completed`; it must never be converted to
`pass` for presentation purposes.

The `v0.1.0` tag must not be created until version identifiers, documentation,
candidate evidence, notices, and the intended tag target have been reviewed together.
