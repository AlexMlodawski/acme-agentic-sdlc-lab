# Optional watsonx Orchestrate Draft package

This directory contains the source for a fictional Acme Store Support Agent:

- a native-agent template;
- a read-only Python order-status tool;
- a small return-policy knowledge base;
- offline behavior cases and tests;
- scripts that validate and materialize the package without contacting a tenant.

It contains no credentials, tenant identifiers, exported tenant state, IBM
software binaries, or automatic tenant-deployment command. Installing the
declared dependencies downloads them from their respective publishers under
their own terms.

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
materialization. Model availability differs between tenants. Select a model in
your own environment and create a reviewed definition before any import:

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

This community repository intentionally does not automate tenant writes. If
you choose to import the generated definition, use the current official IBM
watsonx Orchestrate ADK documentation, verify the active tenant and workspace,
and select Draft. Do not treat local validation as proof that a tenant accepted
the package or that a live agent invoked a particular tool or knowledge source.

The connection named `acme_support_api` expects:

- `base_url`: HTTPS outside loopback;
- optional `api_token`: supplied by the operator's protected credential store.

The tool follows no redirects, validates the response schema, bounds network
timeouts, and returns safe failure categories instead of raw exceptions.

With the local Support API already running on loopback, its real HTTP boundary
can be exercised from PowerShell without a tenant connection:

```powershell
.\scripts\test-local-tool.ps1 -BaseUrl "http://127.0.0.1:4000"
```
