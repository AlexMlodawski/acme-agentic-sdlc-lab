# Guided launcher

`npm run guided` is the interactive entry point for a workshop or a recorded
case-study walkthrough. It collects the minimum runtime choices, shows a
secret-free summary, asks what should be started, requests the selected previews
from the operating system's default browser, and keeps the terminal menu open until
the operator chooses `0` or stops the terminal.

The launcher is foreground-owned. It does not install dependencies, import an
agent, deploy anything, promote WXO to Live, run Bob Shell, publish a release, or
install an Instana agent/collector. Its optional Instana path is direct
application-to-SaaS OTLP/HTTP export from the Support API process.

## Prepare once

From the repository root:

```text
npm run doctor
npm run install:project
npx --no-install playwright install chromium
```

The browser download is needed only for Playwright acceptance. The guided launcher
uses the operating system's default browser and does not require Playwright.

## Start the flow

```text
npm run guided
```

Run it from PowerShell, `cmd`, or another interactive terminal. The command is
intentionally not a background service and refuses redirected/non-interactive
input so that a key cannot be accidentally supplied by a pipeline.

The prompts are:

1. `Port portalu` — defaults to `3000`.
2. `Port Support API` — defaults to `4000`; the ports must differ.
3. `Wybierz profil asystenta`:
   - **Local mock** (`stub`) is deterministic and uses no assistant credential. It
     remains zero-secret only when optional Instana telemetry is also disabled.
   - **WXO account-backed** (`orchestrate`) is an explicit server-side request path. It
     asks for the official WXO endpoint, agent ID, and API key. The key is typed
     in a masked prompt.
4. `Włączyć eksport śladów Support API do Instana blue SaaS?` is independent of
   the assistant profile:
   - **No** keeps telemetry disabled;
   - **Yes** shows the fixed Blue OTLP/HTTP endpoint, asks for a safe synthetic
     logical host and a masked Instana Agent Key, and generates a unique
     `ACME-GUIDED-...` correlation ID.
5. `Ostatni krok — co uruchomić?` asks the operator to choose one of:
   - portal and Support API;
   - repository documents and previews only;
   - portal/API plus every document and preview;
   - cancel.

The WXO endpoint is validated before a process is started. It must be an HTTPS
`api.<region>.dl.watson-orchestrate.ibm.com/instances/<instance>` URL without
credentials, query parameters, or fragments. The launcher never asks for, or
uses, a Live/import/deployment command.

Copy that API URL from WXO **Settings > API details**. A tenant browser URL that
contains `/#/` is only a UI address and will be rejected. An ADK environment alias
is likewise only a locally saved label and is not an endpoint or an authentication
result. Activate and test the environment separately with the ADK 2.15 commands in
[`docs/ibm-integrations.md`](ibm-integrations.md) before starting the launcher.

The endpoint format does not identify whether the selected agent is Draft or Live.
The operator must verify that status in the authorized WXO tenant before using the
profile. The launcher reports only account-backed adapter routing and never upgrades
that observation into a Draft, Live, import, deployment, tool, or retrieval claim.

The requested WXO agent ID is not the YAML `name`, display name, or local ADK
environment alias. For this package the YAML/CLI name is `store_support_agent`;
obtain the tenant-assigned runtime `agentId` after the Draft import, for example
from verbose agent details or the ADK-generated Draft web-chat configuration. Do
not infer one value from the other.

## Optional direct Instana export

The Instana choice uses only this fixed endpoint:

```text
https://otlp-http-blue-saas.instana.io:443
```

It is appropriate only for an Instana Blue SaaS tenant. The browser tenant URL is
not the ingest endpoint; confirm the region from the tenant's generated installer
or **More > About Instana**. The prompt requires an **Agent Key**, not an API token.
No key is accepted through a command-line flag, URL, configuration file, or
unmasked prompt.

When enabled, the launcher passes the key only to the Support API child process and
sets service `acme-support-api` and environment `guided-lab`. Telemetry can be used
with either the local mock or WXO assistant profile. It covers application request
traces only and neither installs nor depends on a system-wide collector.

Keep the printed correlation ID. A successfully started API proves only that the
exporter was configured. A bounded `otel_trace_export` diagnostic for a generated
request can prove the observed export attempt and transport result, but not tenant
receipt. To prove receipt, find the same correlation ID under the
`acme-support-api` service in the authorized Instana tenant. Tenant indexing is a
separate acceptance gate.

## Browser previews

The `all` choice opens:

- the Acme portal (`http://127.0.0.1:<portal-port>`);
- Support API health (`http://127.0.0.1:<api-port>/health`);
- this guide;
- the local quickstart;
- the case study;
- the workshop guide;
- the Bob IDE plan prompt;
- the Bob IDE local build prompt;
- the WXO Draft import prompt;
- the WXO portal-connect prompt;
- the evidence-first release-review prompt;
- the Bob Shell CI/CD control model;
- the fictional portal screenshot.

Document and image previews use a temporary loopback HTTP server bound only to
`127.0.0.1`; the server exposes an allowlist of the checked-in files and stops
with the guided session. A browser may show Markdown as plain text; that is still
the exact checked-in file and is useful during a workshop. The terminal prints
every URL so an operator can reopen one manually.

## Session menu

After the first launch, the terminal remains available:

| Option | Action |
| --- | --- |
| `1` | Open the portal and API health preview |
| `2` | Open all repository documents and the screenshot |
| `3` | Open the portal, API health, and all repository previews |
| `4` | Show the current configuration with secrets hidden |
| `5` | Stop and restart the selected profile, then request the application previews |
| `0` | Stop launcher-owned processes and close the session |

`Ctrl+C` is also handled as a graceful cancellation. Choosing `0` is preferred
because it gives the launcher time to stop both child services. Closing the
terminal ends the foreground process as well, but the operator should still
check that no child process remains if the terminal host does not propagate
signals.

## Secret and network boundary

- The mock assistant profile inherits no assistant credential. With optional
  Instana disabled, it keeps the existing `npm run dev` zero-secret behavior
  unchanged; with Instana enabled, only the Support API receives that Agent Key.
- In WXO account-backed mode, the API key is held only in the launcher process and the
  server-side portal child environment. It is never written to `.env`, Git,
  browser storage, a URL, the preview list, or the terminal summary.
- With Instana enabled, its Agent Key is held only in the launcher process and the
  Support API child environment. It is never passed to the portal child.
- Child output is filtered for both configured keys and common key/header assignment
  patterns before it is shown in the terminal. Key variables are cleared when the
  launcher-owned processes stop.
- The Support API remains loopback-only with authentication disabled for the local
  demo. Telemetry stays disabled unless the operator explicitly selects Instana.
- A WXO request can leave the machine only when the operator selected WXO,
  supplied a valid endpoint/key, started the application, and used the assistant
  in the portal. No request is made merely by opening the previews.
- An Instana request can leave the machine only when the operator selected Instana,
  supplied an Agent Key, started the Support API, and generated instrumented
  traffic. Opening documentation alone sends no trace.
- The launcher refuses runtime `.env` files under the root, portal, or API
  directories. Keep account credentials in a protected runtime or tenant secret
  store for any separately authorized test.

WXO Draft preparation, the Instana acceptance boundary, and the public HTTPS
prerequisite for the cloud tool are documented in
[`docs/ibm-integrations.md`](ibm-integrations.md). Bob Shell remains the manually
dispatched protected GitHub workflow documented in
[`docs/bob-shell-cicd.md`](bob-shell-cicd.md); the guided launcher deliberately
does not request or execute a Bob Shell key locally.

## Troubleshooting

### A service does not become ready

The launcher waits up to 45 seconds for `/health` and `/api/health`. Read the
`[local]`, `[api]`, or `[portal]` lines in the terminal, then use option `5` to
retry after correcting a port conflict or a local dependency installation.

### WXO rejects the request

The launcher reports the bounded public error from the portal. Check the selected
API endpoint rather than browser URL, the tenant-assigned agent ID rather than
agent name, the independently verified Draft status, and the API key. A saved or
active ADK alias does not prove its cached token is still current. A failed or
unavailable WXO request is not converted into a mock response.

### WXO answers, but the order tool is unavailable

The imported Python tool runs in the WXO cloud and cannot reach the guided
launcher's loopback `http://127.0.0.1:<api-port>`. Deploy the Support API separately
behind an authenticated, tenant-reachable public HTTPS origin and configure that
origin in the Draft `acme_support_api` connection. Successful portal-to-WXO chat
routing is not proof that this second network path works.

### Instana is enabled, but no trace is visible

Confirm that the tenant is in the Blue SaaS ingest region and that the supplied
credential is an Instana Agent Key rather than an API token. Generate an API
request, then search for the exact printed correlation ID under service
`acme-support-api`. Local exporter startup and tenant receipt are separate checks;
do not claim receipt from local logs alone.

### Browser tabs did not open

The URLs remain in the terminal. Use option `2` or `3` again, or copy one URL to
the browser manually. The application itself is still usable if the portal health
check succeeded.

## What this proves

The launcher proves a repeatable operator flow and local process wiring. A mock
assistant response proves only the fictional local behavior. A successful WXO
response labeled `source=orchestrate` proves adapter routing for that run; it does
not by itself prove Draft or Live status, WXO tool invocation, knowledge retrieval,
import, promotion, Instana receipt, Bob Shell review, or release approval. With
Instana selected, a matching tenant trace with the session correlation ID is the
additional evidence required for a receipt claim.
