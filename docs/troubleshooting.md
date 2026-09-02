# Troubleshooting

## The doctor reports a version mismatch

Use the exact Node and Python versions in `.node-version` and `.python-version`,
npm from the root `packageManager` field, and the `uv` version pinned by CI. The
doctor does not install or modify these tools.

## `uv` is not found

Install the documented pinned `uv` release using its official installation
instructions, ensure it is on `PATH`, and rerun `npm run doctor`. Do not copy an
unknown executable into the repository.

## Chromium is missing

After `npm run install:project`, install the browser matching the locked Playwright
package:

```text
npx --no-install playwright install chromium
```

Linux hosts may also need the operating-system packages documented by Playwright.
That host-level operation is outside the project uninstall boundary.

## Port 3000, 3100, 4000, or 4100 is already used

Stop the process that owns the port, or set distinct `PLAYWRIGHT_PORTAL_PORT` and
`PLAYWRIGHT_API_PORT` values for browser tests. The harness refuses invalid or
identical ports and never reuses an existing server.

## Built browser acceptance says artifacts are missing

Run `npm run e2e:built`. That root command builds both workspaces before using the
production-start profiles. Calling the workspace `test:built` script directly is
only appropriate when current build artifacts already exist.

## A release audit refuses to start because Git is dirty

Review and commit or deliberately remove the changes, then rerun from the exact
candidate. `--allow-dirty` exists for diagnostics, but evidence from a dirty tree
must not be used to approve a release.

## A candidate evidence directory already exists

Candidate names are immutable within one working tree. Choose a new candidate name
or deliberately archive the existing evidence outside the repository. The audit
will not overwrite prior output.

## Local mode unexpectedly tries to use WXO or telemetry

Use `npm run up`, which starts an allowlisted zero-secret environment with
`AGENT_MODE=stub` and telemetry disabled. Do not source a private `.env` file into
the process. Optional account-backed modes require separate review and are outside
the v0.1.0 release claim.

## Cleanup refuses a target

The reset/uninstall helper fails closed when its root identity, path containment,
or target type is unexpected. Inspect the path manually; do not bypass the guard or
replace it with a broad recursive-delete command.
