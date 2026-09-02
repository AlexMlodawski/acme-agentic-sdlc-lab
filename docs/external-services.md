# External services and network boundaries

## Default local/mock profile

After dependencies and Chromium are installed, the intended local/mock application
path uses loopback only:

- portal: `http://127.0.0.1:3000`;
- Support API: `http://127.0.0.1:4000`;
- assistant: in-process deterministic `stub` provider;
- telemetry: disabled.

The local launcher does not load `.env` files and does not forward application
credentials to its child services. Installation commands remain separate and may
contact package publishers.

## Service inventory

| Service | When contacted | Direction and operation | Credentials | v0.1.0 claim |
| --- | --- | --- | --- | --- |
| npm registry | `npm ci --ignore-scripts` or other package operations | Dependency download | Environment/user npm configuration may apply | Installation dependency, not an application runtime service |
| Python package index | `uv sync` when artifacts are not cached | Dependency download | Environment/user package-index configuration may apply | Installation dependency |
| Playwright browser distribution | `npx --no-install playwright install chromium` | Chromium download | Normally none | Test prerequisite; package version remains lockfile-controlled |
| Python vulnerability service | `npm run audit:python` | Query by locked package names/versions | Normally none | Release check; no project payload or credential is intended |
| GitHub | Clone/fetch and hosted CI | Repository hosting and automation | User or runner-owned | Visibility, settings, and workflow execution are external state |
| watsonx Orchestrate MCSP IAM | Only with complete WXO configuration | Server-side API-key token exchange | `WXO_API_KEY` | Source-level adapter; execution `not_asserted` |
| watsonx Orchestrate agent endpoint | Only with `AGENT_MODE=orchestrate` and complete configuration | Server-side chat request | Short-lived bearer token | Draft tenant execution `not_asserted` |
| Operator Support API endpoint | Optional external Draft tool configuration | Read-only `GET /orders/{orderId}` | Optional bearer token | Source-level tool; external execution `not_asserted` |
| Generic OTLP collector | Only with telemetry enabled | Application trace export | Configuration-dependent | Local adapter behavior only |
| IBM Instana blue SaaS OTLP/HTTP | Only with complete Instana configuration | Application trace export | Server-side Instana key and logical host | Tenant receipt/correlation `not_asserted` |
| IBM Bob | Only in a separate licensed installation or protected manual review runner | IDE development assistance or advisory Shell review | User-owned / protected CI secret | Prompts and controller source exist; authenticated execution is `not_completed` |
| Forgejo | Never in v0.1.0 | No implementation | None | Out of scope |

## watsonx Orchestrate boundary

The portal adapter accepts only the expected official WXO API hostname pattern and
an `/instances/{instance-id}` endpoint. It obtains a token from the fixed MCSP V2
IAM origin, rejects redirects, bounds response size and time, and keeps the API key
server-side.

The Draft package separately declares the `acme_support_api` key-value connection.
Outside loopback, its `base_url` must use HTTPS. Its optional API token belongs in
the operator's protected connection store, not in the agent YAML or repository.

These controls describe source behavior. They do not establish that a tenant
accepted the package, that a model was available, or that an observed response used
the declared tool or knowledge base.

## Instana boundary

The dedicated Instana configuration accepts the blue SaaS OTLP/HTTP host and builds
`x-instana-key` and `x-instana-host` headers in memory. Telemetry is opt-in and is
limited to application request traces by the current implementation.

Local OTLP wire tests can establish serialized exporter behavior against a local
collector. They cannot establish delivery, indexing, retention, access control, or
search results in an Instana tenant.

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
