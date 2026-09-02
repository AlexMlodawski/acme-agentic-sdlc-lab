# Agent contribution contract

Work only inside this repository and use fictional Acme data. Never inspect or
copy credentials, browser profiles, tenant exports, or files excluded by Git.

- Keep the default profile loopback-only, deterministic, and zero-secret.
- Treat watsonx Orchestrate as Draft-only and Instana as read-only unless a
  human explicitly authorizes a narrower operation.
- Never push, deploy, import tenant resources, or change external systems unless
  the active human request names the exact target and operation.
- Keep credentials server-side; never add a `NEXT_PUBLIC_` credential.
- Preserve the `priority` Support API contract and reject `priorityLevel`.
- Run focused tests first, then `npm run verify` and `npm run e2e:local` when the
  change affects the customer journey.
- Report observable actions and artifacts, not private chain-of-thought.
- Distinguish `pass`, `fail`, `not_completed`, and `not_asserted` exactly as
  described in `docs/evidence-model.md`.

When a prompt asks for plan-only work, inspect, return a plan, make no file
changes, and stop for human approval.
