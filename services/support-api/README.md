# Acme Support API

The Support API is a deterministic Fastify service with fictional data, no
database, and no outbound business calls. It provides health/readiness,
read-only order lookup, and deterministic support-case acknowledgments.

The default listener is `http://127.0.0.1:4000`. Bearer protection is optional
for loopback development and fail-closed when `SUPPORT_API_REQUIRE_AUTH=1`.
OpenTelemetry is disabled by default and can export OTLP/HTTP traces when the
operator explicitly configures it.

```bash
npm run dev -w services/support-api
npm run test:api
npm run test:openapi
```

The public contract is `contracts/support-api.yaml`. Requests use the exact
field `priority`; unknown fields are rejected with a safe `400` response.
