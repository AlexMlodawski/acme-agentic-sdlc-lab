# Acme Support Portal

The portal is a Next.js application with a server-side provider boundary. It
talks to the Support API through same-origin route handlers, so backend URLs
and credentials never enter browser code.

The default `AGENT_MODE=stub` profile is deterministic and requires no secret.
`AGENT_MODE=orchestrate` is optional and fails closed unless all required
server-only watsonx Orchestrate values are configured.

Useful commands from the repository root:

```bash
npm run dev
npm run test:portal
npm run build -w apps/portal
```

Stable browser selectors cover order lookup, the contextual assistant, error
and retry behavior, thread reset, and support-case creation. See the local
Playwright journey in `tests/e2e/local-flow.spec.ts`.
