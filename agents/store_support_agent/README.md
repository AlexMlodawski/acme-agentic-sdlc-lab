# Workshop-ready watsonx Orchestrate Draft package

This directory contains the ready building blocks for the first hands-on Bob IDE
stage of the fictional Acme workshop:

- a native-agent template with bounded starter prompts;
- a read-only Python order-status tool for the supplied Support API;
- a small return-policy knowledge base and its fictional source document;
- offline behavior cases and tests;
- scripts that validate and materialize the package without contacting a tenant.

Participants do not need to implement another backend, tool, or knowledge base.
Their bounded task is to inspect these assets in Bob IDE, select a model available
in their authorized environment, materialize and validate the agent definition,
and, only after a separate human approval, import that reviewed definition into
watsonx Orchestrate Draft.

It contains no credentials, tenant identifiers, exported tenant state, IBM
software binaries, or automatic tenant-deployment command. Installing the
declared dependencies downloads them from their respective publishers under
their own terms.

## Bob IDE workshop sequence

1. Open the repository in an authorized IBM Bob IDE installation and use the
   workshop prompt to inspect the supplied template, tool, knowledge, Support API
   contract, and validation scripts.
2. Keep the first response plan-only. A human confirms the selected model and the
   exact Draft target before any tenant write.
3. Materialize the definition into the ignored `.generated` directory and run the
   offline checks below.
4. Review the generated YAML and validation result.
5. If the Draft import is separately authorized, use the current official Bob/ADK
   flow to import the reviewed definition into Draft only. Do not deploy or promote
   it to Live.
6. Configure the existing portal through `npm run guided` with the selected WXO
   endpoint, agent ID, and masked API key. The launcher connects to an existing
   agent; it does not import one or determine its environment state.

See the [workshop guide](../../docs/workshop.md) and
[guided launcher guide](../../docs/guided-launcher.md). Source validation, Draft
import, portal routing, tool invocation, and knowledge retrieval are separate claims
and require separate evidence.

## Offline validation

Use Python 3.12 and `uv`:

```bash
uv sync --locked --python 3.12
uv run python scripts/validate_local.py
uv run pytest -q
```

On PowerShell, the checked-in wrapper performs the same locked validation:

```powershell
.\scripts\validate-local.ps1
```

The checked-in `agents/store_support_agent.yaml` is an illustrative offline
materialization. Model availability differs between environments. Select a model in
the authorized environment and create a reviewed definition before any import:

```bash
uv run python scripts/materialize_agent.py \
  --model-id "<model-id-confirmed-in-your-tenant>" \
  --output .generated/store_support_agent.yaml
```

The equivalent PowerShell wrapper is:

```powershell
.\scripts\materialize-agent.ps1 `
  -ModelId "<model-id-confirmed-in-your-tenant>" `
  -OutputPath ".generated/store_support_agent.yaml"
```

## Draft-only boundary

This community repository intentionally does not automate tenant writes. If the
operator chooses to run the Bob/ADK import step, they must use the current official
watsonx Orchestrate documentation, verify the active account, workspace, and
environment without recording private identifiers in the repository, and select
Draft. Local validation is not proof that an environment accepted the package, and
an accepted Draft import is not proof that the agent invoked a particular tool or
knowledge source.

The connection named `acme_support_api` expects:

- `base_url`: HTTPS outside loopback;
- optional `api_token`: supplied by the operator's protected credential store.

The tool follows no redirects, validates the response schema, bounds network
timeouts, and returns safe failure categories instead of raw exceptions.

The cloud-hosted Draft agent cannot use a loopback `base_url`. A real tenant tool
exercise needs a separately reviewed, authenticated HTTPS Support API endpoint. The
repository does not provide or claim that hosting boundary.

The guided launcher can independently enable direct Instana blue SaaS OTLP/HTTP
export for the local Support API. It does not install a system agent or collector,
and those Support API traces do not prove WXO agent execution. Export diagnostics
and tenant-visible trace receipt remain separate evidence claims.

With the local Support API already running on loopback, its real HTTP boundary
can be exercised from PowerShell without a tenant connection:

```powershell
.\scripts\test-local-tool.ps1 -BaseUrl "http://127.0.0.1:4000"
```
