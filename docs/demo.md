# Local mock demonstration

This is the reproducible v0.1.0 demonstration. It uses a real browser, portal,
and Support API, but the assistant, orders, policy, and case acknowledgement are
deterministic fictional fixtures. It is **mock**, not live or replay evidence.

## Prepare

Install the pinned toolchain listed in the README, then run:

```text
npm run doctor
npm run install:project
npx --no-install playwright install chromium
npm run preflight
```

The browser installation downloads a Playwright-managed Chromium build to the
user cache. It is not removed by this repository's uninstall command because the
cache can be shared by other projects.

## Run the product journey

Start the foreground services:

```text
npm run up
```

Open `http://127.0.0.1:3000` and:

1. Look up fictional order `ACME-1042`.
2. Open **Order assistant** and ask for status and return-window guidance.
3. Create a support case and observe the explicitly synthetic acknowledgement.
4. Stop both child services with `Ctrl+C` in the launching terminal.

No external business service or tenant should be contacted in this profile.

## Guided workshop session

For a single operator flow that asks for ports and profile values, lets the human
choose the final action, requests the application and repository previews from the
default browser, and keeps a terminal menu active until exit, use:

```text
npm run guided
```

The local mock path remains zero-secret. The optional WXO path accepts a
server-side account-backed configuration in a masked prompt and does not infer
Draft/Live status, import, deploy, promote, or run Bob Shell. See
[guided launcher](guided-launcher.md).

## Run browser acceptance

```text
npm run e2e:local
npm run e2e:built
```

Both suites cover the primary journey and the bounded invalid/missing-order path.
The built suite creates fresh production artifacts before starting isolated
loopback processes. Neither suite asserts WXO, Instana, Forgejo, or IBM Bob.

## Create candidate evidence

From a clean committed candidate:

```text
pwsh ./scripts/release-audit.ps1 -Mode Full -Candidate v0.1.0-rc.1
```

The command writes ignored, redacted evidence under
`release-evidence/v0.1.0-rc.1` and returns nonzero when a hard gate fails. It does
not approve, merge, tag, publish, deploy, import, or promote anything.

## Reset or uninstall local project state

After stopping services, remove known generated outputs while retaining installed
dependencies:

```text
npm run reset
```

Or remove known project-local dependencies and generated outputs:

```text
npm run uninstall:project
```

Both commands operate on a fixed allowlist under the verified repository root and
require the explicit confirmation already encoded in their npm scripts. They do
not remove Git source, global runtimes, package-manager caches, or the shared
Playwright browser cache.
