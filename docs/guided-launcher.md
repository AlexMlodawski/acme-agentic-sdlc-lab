# Guided launcher

`npm run guided` is the interactive entry point for a workshop or a recorded
case-study walkthrough. It collects the minimum runtime choices, shows a
secret-free summary, asks what should be started, requests the selected previews
from the operating system's default browser, and keeps the terminal menu open until
the operator chooses `0` or stops the terminal.

The launcher is foreground-owned. It does not install dependencies, import an
agent, deploy anything, promote WXO to Live, run Bob Shell, or publish a release.

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
   - **Local mock** (`stub`) is deterministic and zero-secret.
   - **WXO account-backed** (`orchestrate`) is an explicit server-side request path. It
     asks for the official WXO endpoint, agent ID, and API key. The key is typed
     in a masked prompt.
4. `Ostatni krok — co uruchomić?` asks the operator to choose one of:
   - portal and Support API;
   - repository documents and previews only;
   - portal/API plus every document and preview;
   - cancel.

The WXO endpoint is validated before a process is started. It must be an HTTPS
`api.<region>.dl.watson-orchestrate.ibm.com/instances/<instance>` URL without
credentials, query parameters, or fragments. The launcher never asks for, or
uses, a Live/import/deployment command.

The endpoint format does not identify whether the selected agent is Draft or Live.
The operator must verify that status in the authorized WXO tenant before using the
profile. The launcher reports only account-backed adapter routing and never upgrades
that observation into a Draft, Live, import, deployment, tool, or retrieval claim.

## Browser previews

The `all` choice opens:

- the Acme portal (`http://127.0.0.1:<portal-port>`);
- Support API health (`http://127.0.0.1:<api-port>/health`);
- this guide;
- the local quickstart;
- the case study;
- the workshop guide;
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

- The default mock profile inherits no application credentials and keeps the
  existing `npm run dev` zero-secret behavior unchanged.
- In WXO account-backed mode, the API key is held only in the launcher process and the
  server-side portal child environment. It is never written to `.env`, Git,
  browser storage, a URL, the preview list, or the terminal summary.
- Child output is filtered for the configured key and common key-assignment
  patterns before it is shown in the terminal.
- The Support API remains loopback-only with authentication disabled for the
  local demo. Telemetry is disabled by this launcher.
- A WXO request can leave the machine only when the operator selected WXO,
  supplied a valid endpoint/key, started the application, and used the assistant
  in the portal. No request is made merely by opening the previews.
- The launcher refuses runtime `.env` files under the root, portal, or API
  directories. Keep account credentials in a protected runtime or tenant secret
  store for any separately authorized test.

Instana remains a separate read-only, protected-runtime path documented in
[`docs/ibm-integrations.md`](ibm-integrations.md). Bob Shell remains the manually
dispatched, protected GitHub workflow documented in
[`docs/bob-shell-cicd.md`](bob-shell-cicd.md); the guided launcher deliberately
does not request or execute a Bob Shell key locally.

## Troubleshooting

### A service does not become ready

The launcher waits up to 45 seconds for `/health` and `/api/health`. Read the
`[local]`, `[api]`, or `[portal]` lines in the terminal, then use option `5` to
retry after correcting a port conflict or a local dependency installation.

### WXO rejects the request

The launcher reports the bounded public error from the portal. Check the selected
endpoint, agent ID, environment status, and key in the tenant's protected configuration. A failed
or unavailable WXO request is not converted into a mock response.

### Browser tabs did not open

The URLs remain in the terminal. Use option `2` or `3` again, or copy one URL to
the browser manually. The application itself is still usable if the portal health
check succeeded.

## What this proves

The launcher proves a repeatable operator flow and local process wiring. A mock
assistant response proves only the fictional local behavior. A successful WXO
response labeled `source=orchestrate` proves adapter routing for that run; it does
not by itself prove Draft or Live status, WXO tool invocation, knowledge retrieval,
import, promotion, Instana receipt, Bob Shell review, or release approval.
