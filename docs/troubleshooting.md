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

## An ADK environment is `(active)`, but WXO commands fail

The active marker identifies a locally selected environment alias; it is not a
tenant health or authentication result. ADK access tokens are short-lived. From
`agents/store_support_agent`, reactivate through the masked prompt and then make a
read-only API call:

```text
uv run orchestrate env activate "<LOCAL_ALIAS>"
uv run orchestrate models list
uv run orchestrate agents list -v
```

Do not put the API key in `--api-key`, shell history, logs, or a repository `.env`
file. If the alias points at the wrong tenant, review the private local ADK config
outside the repository and add a new reviewed alias instead of editing cached
credentials by hand.

## WXO rejects the endpoint before starting

Use the API/service-instance URL from WXO **Settings > API details**:

```text
https://api.<region>.dl.watson-orchestrate.ibm.com/instances/<instance-id>
```

The tenant browser address, especially one containing `/#/`, is a UI URL and is
not interchangeable. The current portal adapter intentionally supports only its
reviewed MCSP V2 endpoint pattern.

## WXO reports that the agent is missing

Do not enter `store_support_agent`, its display name, an environment alias, or an
instance ID when the guided launcher asks for the WXO agent ID. The YAML/CLI name
and tenant-assigned runtime ID are different values. After a confirmed Draft
import, inspect `uv run orchestrate agents list -v` or generate the Draft web-chat
configuration and use its returned `agentId` locally:

```text
uv run orchestrate channels webchat embed --agent-name store_support_agent --env draft
```

Do not commit the generated tenant-specific output.

## WXO chat works, but `get_order_status` is unavailable

Chat routing and cloud-tool networking are separate paths. The WXO-hosted Python
tool cannot reach `localhost` or the guided launcher's loopback Support API. Deploy
the API separately at an authenticated, tenant-reachable public HTTPS origin, then
set that origin and its token in the Draft `acme_support_api` connection through
WXO's protected connection UI. This repository does not create a public ingress or
tunnel.

## Instana was selected, but no trace appears

The guided integration supports only the fixed Blue SaaS OTLP/HTTP endpoint. Check
that the tenant is in the Blue ingest region and that the masked credential was an
Instana **Agent Key**, not an API token. Then generate Support API traffic and
search the authorized tenant for service `acme-support-api`, environment
`guided-lab`, and the exact `ACME-GUIDED-...` correlation ID printed for that
session.

A healthy API, a configured exporter, or no local export error does not prove
tenant receipt or indexing. Claim receipt only after the matching trace is visible
in the tenant. No system collector or Instana host agent is installed by this
workflow.

## Cleanup refuses a target

The reset/uninstall helper fails closed when its root identity, path containment,
or target type is unexpected. Inspect the path manually; do not bypass the guard or
replace it with a broad recursive-delete command.
