# Optional IBM integrations

The local profile should pass before any account-backed integration is enabled.
Nothing in this guide authorizes production or watsonx Orchestrate Live changes.
These are reviewed source-level integration seams, not a one-command hosted
deployment profile.

## IBM Bob

Use your own licensed installation. A useful development choreography is:

1. give Bob one business requirement and the relevant repository instructions;
2. ask it to inspect and produce a plan without modifying files;
3. review the plan and explicitly approve implementation;
4. require focused tests and a reviewable commit;
5. attribute only that exact commit to the Bob-assisted change.

This repository does not redistribute Bob binaries, auth state, or private
configuration.

## watsonx Orchestrate Draft

The source package is in `agents/store_support_agent`. Validate and materialize
it offline first. Then follow the current official ADK documentation to review
and import it into a dedicated Draft environment.

The portal's integrated provider requires these server-only values:

```text
AGENT_MODE=orchestrate
WXO_API_ENDPOINT=https://api.<region>.dl.watson-orchestrate.ibm.com/instances/<instance-id>
WXO_AGENT_ID=<agent-id>
WXO_API_KEY=<from-protected-secret-storage>
```

Never use `NEXT_PUBLIC_` for any credential. Never commit the values. Do not
silently fall back to the local provider after an integrated failure.

Official starting points:

- <https://developer.watson-orchestrate.ibm.com/agents/build_agent>
- <https://developer.watson-orchestrate.ibm.com/tools/create_tool>
- <https://developer.watson-orchestrate.ibm.com/knowledge_base/build_kb>

## IBM Instana

The Support API exports standard OTLP/HTTP traces only when explicitly enabled.
The checked-in Instana adapter is deliberately restricted to the Instana blue
SaaS OTLP/HTTP host. Obtain the key and logical host identity from your own
tenant and inject all values from protected runtime configuration:

```text
OTEL_ENABLED=1
INSTANA_AGENT_KEY=<from-protected-secret-storage>
INSTANA_OTLP_HTTP_ENDPOINT=https://otlp-http-blue-saas.instana.io:443
INSTANA_OTLP_HOST=<safe-logical-host-name>
OTEL_SERVICE_NAME=acme-support-api
DEPLOYMENT_ENVIRONMENT=<your-demo-environment>
```

Do not commit these values. Treat Instana access used for investigation as
read-only. Other Instana deployment models require an explicit reviewed adapter
change; they are not silently accepted by this implementation.

## Exposing the Support API

The default server binds only to loopback. A non-loopback bind fails closed
unless `SUPPORT_API_REQUIRE_AUTH=1` and a server-side `SUPPORT_API_TOKEN` is
present. Put any internet-facing endpoint behind your own reviewed TLS boundary;
the repository does not provide or claim a production ingress configuration.

An observed portal answer can prove user-visible semantics. It does not prove
the agent's internal tool or retrieval provenance unless separate, direct
evidence establishes that claim.
