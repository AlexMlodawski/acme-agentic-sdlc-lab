# External services and network boundaries

## Default local/mock profile

After dependencies and Chromium are installed, the intended local/mock application
path uses loopback only:

- portal: `http://127.0.0.1:3000`;
- Support API: `http://127.0.0.1:4000`;
- assistant: in-process deterministic `stub` provider;
- telemetry: disabled.

The default local launcher does not load `.env` files and does not forward
application credentials to its child services. The separate `npm run guided` flow
can pass a masked, interactively supplied WXO API key only to the portal server
child and, when explicitly selected, a separately masked Instana Agent Key only to
the Support API child. Installation commands remain separate and may contact
package publishers.

## Service inventory

| Service | When contacted | Direction and operation | Credentials | v0.1.0 claim |
| --- | --- | --- | --- | --- |
| npm registry | `npm ci --ignore-scripts` or other package operations | Dependency download | Environment/user npm configuration may apply | Installation dependency, not an application runtime service |
| Python package index | `uv sync` when artifacts are not cached | Dependency download | Environment/user package-index configuration may apply | Installation dependency |
| Playwright browser distribution | `npx --no-install playwright install chromium` | Chromium download | Normally none | Test prerequisite; package version remains lockfile-controlled |
| Python vulnerability service | `npm run audit:python` | Query by locked package names/versions | Normally none | Release check; no project payload or credential is intended |
| GitHub | Clone/fetch and hosted CI | Repository hosting and automation | User or runner-owned | Visibility, settings, and workflow execution are external state |
| watsonx Orchestrate MCSP IAM | Only with complete WXO configuration | Server-side API-key token exchange; resulting access token remains in process/cache scope | Masked `WXO_API_KEY` prompt | Source-level adapter; execution `not_asserted` |
| watsonx Orchestrate agent endpoint | Only with `AGENT_MODE=orchestrate` and complete configuration (for example, `npm run guided`) | Server-side chat request | Short-lived bearer token | Tenant execution `not_asserted`; the launcher does not infer Draft or Live status |
| Public Support API endpoint | Required only for WXO cloud execution of `get_order_status` | Tenant-to-public-HTTPS read-only `GET /orders/{orderId}` | Protected API token | Source-level tool; public deployment and external execution `not_asserted` |
| Local OTLP test receiver | Only in the controlled telemetry wire test | Loopback application trace export | Synthetic test values only | Proves serialization/header behavior, not Instana delivery |
| IBM Instana blue SaaS OTLP/HTTP | Only when explicitly selected in `npm run guided` | Direct Support API trace export to the fixed Blue endpoint; no system collector | Masked Instana Agent Key and non-secret logical host | Exporter wiring is tested; tenant receipt/correlation `not_asserted` |
| IBM Bob | Only in a separate licensed installation or protected manual review runner | IDE development assistance or advisory Shell review | User-owned / protected CI secret | Prompts and controller source exist; authenticated status requires a validated artifact for the exact candidate |
| Forgejo | Never in v0.1.0 | No implementation | None | Out of scope |

## watsonx Orchestrate boundary

The portal adapter accepts only the expected official WXO API hostname pattern and
an `/instances/{instance-id}` endpoint. It obtains a token from the fixed MCSP V2
IAM origin, rejects redirects, bounds response size and time, and keeps the API key
server-side.

The accepted value is the API/service-instance URL from WXO **Settings > API
details**, not the tenant's browser URL containing `/#/`. An ADK environment alias
is only a local configuration label; an `(active)` alias neither supplies this URL
to the guided launcher nor proves that a prior token remains valid. ADK 2.15 keeps
local configuration and cached credentials outside this repository under the
operator profile.

The YAML/CLI name `store_support_agent` and its display name are not the
tenant-assigned runtime agent ID. The portal request requires that ID. It must be
read from the authorized post-import tenant details and supplied locally; no tenant
ID, instance ID, private alias, or generated embed configuration belongs in source.

The Draft package separately declares the `acme_support_api` key-value connection.
Outside loopback, its `base_url` must use HTTPS. Its optional API token belongs in
the operator's protected connection store, not in the agent YAML or repository.

The tool executes from WXO cloud infrastructure. A workstation's `localhost` or
the guided launcher's loopback Support API is therefore not a valid cloud-tool
target. External acceptance requires a separately authorized, authenticated,
tenant-reachable public HTTPS deployment. The repository provides no public
ingress, tunnel, DNS, certificate, or deployment automation.

These controls describe source behavior. They do not establish that a tenant
accepted the package, that a model was available, or that an observed response used
the declared tool or knowledge base.

## Instana boundary

The dedicated Instana configuration accepts only
`https://otlp-http-blue-saas.instana.io:443` and builds `x-instana-key` and
`x-instana-host` headers in memory. Telemetry is opt-in and is limited to Support
API application request traces. This is direct OTLP/HTTP export: the application
does not install, configure, or depend on a host agent, OpenTelemetry Collector, or
Windows service.

The guided launcher accepts only a masked Instana Agent Key, never an Instana API
token, and passes it only to the API child process. A synthetic logical host and
unique per-session correlation ID avoid copying workstation or tenant identity
into evidence. Tenants outside the Blue SaaS ingest region are outside this fixed
adapter boundary.

Local OTLP wire tests can establish serialized exporter behavior against a local
receiver. A healthy guided process or exporter diagnostic can establish local
configuration and an attempted export. Neither establishes delivery, indexing,
retention, access control, or search results in an Instana tenant. Only finding the
matching `acme-support-api` trace and guided correlation ID in the authorized tenant
supports a receipt claim.

## Prohibited material

Do not place any of the following in source, evidence, screenshots, issues, or
release assets:

- API keys, bearer tokens, cookies, or auth headers;
- tenant IDs or private tenant URLs unless explicitly sanitized and required;
- browser profiles, recorded authenticated state, or tenant exports;
- production customer data;
- unrestricted logs or trace payloads;
- IBM Bob binaries, vendor caches, or other redistributed third-party binaries.

Any external write, import, deployment, promotion, or Live change requires a new,
explicit human authorization naming the target and operation. None is authorized by
this document.
