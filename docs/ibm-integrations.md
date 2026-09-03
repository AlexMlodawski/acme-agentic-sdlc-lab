# IBM workshop integrations

The local profile should pass before the primary account-backed workshop path is
enabled. Reproducing that path remains an explicit operator choice because it needs
the participant's IBM accounts and credentials. Nothing in this guide authorizes
production or watsonx Orchestrate Live changes; this is not a one-command hosted
deployment profile.

## IBM Bob and Bob IDE

Use your own licensed installation. A useful development choreography is:

1. give Bob one business requirement and the relevant repository instructions;
2. ask it to inspect and produce a plan without modifying files;
3. review the plan and explicitly approve implementation;
4. require focused tests and a reviewable commit;
5. record the exact candidate SHA and review results.

This repository does not redistribute Bob binaries, auth state, or private
configuration.

See the complete [case-study path](case-study.md).

## Bob Shell advisory review

The manual `.github/workflows/bob-shell-review.yml` flow runs deterministic gates on
a fresh GitHub-hosted worker, then uses GitHub's service-controlled successful
dependency to start a separate protected ephemeral runner. That fresh review job
creates the fixed same-run pass record locally; no gate artifact is transferred.
Bob receives the complete tracked exact-SHA source and that record for a read-only
review, not a diff, PR scope, logs, or test summaries. The Bob recommendation is
advisory and cannot override tests or human approval.

The controller is implemented, while authenticated status is determined per exact
candidate from its validated workflow artifact. Before enabling it, read [Bob Shell in CI/CD](bob-shell-cicd.md),
configure the protected environment and runner, install the reviewed Bob Shell
version separately, and store `BOB_API_KEY` only as a protected Environment secret.
When a general API key requires a team identifier, store `BOB_TEAM_ID` as a second
protected Environment secret. Neither value is a manual workflow-dispatch input;
both are exposed only to the Bob execution step.

## watsonx Orchestrate ADK 2.15 and Draft

The package in `agents/store_support_agent` pins
`ibm-watsonx-orchestrate==2.15.0`. Keep that virtual environment active for all
commands below; a different global `orchestrate` executable can have different
flags or schemas. IBM's IDE/Bob tutorial is also explicitly tested with ADK 2.15.

Four values that look similar have different meanings:

- an **environment alias** is only a local ADK label, such as `<LOCAL_ALIAS>`;
- the **browser URL** opens the WXO user interface and can contain `/#/`; it is
  not accepted by this repository or by `orchestrate env add`;
- the **API URL** is the service-instance URL copied from WXO **Settings > API
  details**, in the form
  `https://api.<region>.dl.watson-orchestrate.ibm.com/instances/<instance-id>`;
- the **WXO API key** is exchanged for a short-lived access token. A remembered
  alias or an `(active)` marker does not prove that the cached token is current.

On Windows, the ADK normally keeps the alias/configuration in
`%USERPROFILE%\.config\orchestrate\config.yaml` and its token cache in
`%USERPROFILE%\.cache\orchestrate\credentials.yaml`. Both paths are private
operator state: do not copy them into this repository, screenshots, evidence, or
workshop handouts. The guided launcher does not read either file.

### Confirm or add the remote environment

From `agents/store_support_agent`:

```text
uv sync --locked --python 3.12
uv run orchestrate --version
uv run orchestrate env list
```

If the correct service-instance URL is not already registered, add a deliberately
non-private local alias. This repository's portal adapter implements the MCSP V2
authentication path, so its account-backed profile requires a matching MCSP
tenant:

```text
uv run orchestrate env add -n "<LOCAL_ALIAS>" -u "<WXO_API_URL_FROM_API_DETAILS>" --type mcsp
uv run orchestrate env activate "<LOCAL_ALIAS>"
```

Enter the WXO API key only at the CLI's masked prompt. Do not put it in a command
argument or shell history. Prove current API access rather than relying on the
alias:

```text
uv run orchestrate models list
uv run orchestrate agents list -v
```

Successful list commands prove that the CLI reached the selected environment for
that session. They do not prove that this package was imported, that an agent is
Draft or Live, or that a tool was invoked.

### Review and import the package to Draft

First materialize the template using an exact model identifier returned by
`models list`, as described in [Lifecycle commands](lifecycle-commands.md). The
tool expects a Draft key-value connection named `acme_support_api`; create its
definition before importing the tool:

```text
uv run orchestrate connections list
uv run orchestrate connections add -a acme_support_api
uv run orchestrate connections configure -a acme_support_api --env draft -t team -k key_value
```

If the application already exists, review it instead of adding a duplicate. In
WXO **Manage > Connections**, select `acme_support_api`, choose Draft, and enter:

- `base_url`: the public HTTPS Support API origin;
- `api_token`: its credential, if configured.

Use the tenant's protected credential UI for the token. Although the ADK supports
`connections set-credentials`, supplying a secret as a command argument would put
it in process arguments and potentially shell history, so this runbook does not do
that.

After human confirmation of the active tenant and the public API boundary, import
dependencies before the agent:

```text
uv run orchestrate tools import -k python -f tools/get_order_status.py -r tools/requirements.txt --app-id acme_support_api --safe
uv run orchestrate knowledge-bases import -f knowledge_bases/acme_return_policy.yaml --safe
uv run orchestrate agents import -f .generated/store_support_agent.yaml --safe
uv run orchestrate agents list -v
```

These imports create or update Draft resources. This runbook intentionally has no
`agents deploy` command and does not authorize Live promotion.

### Run the ADK 2.15 Draft chat safely

Use one foreground interactive session with stdin and stdout attached to a real
terminal:

```text
uv run orchestrate chat ask --agent-name store_support_agent
```

At the chat prompt, wait for each answer before entering the next line:

1. `What is the current status of order ACME-1042?`
2. `What is the standard return window?`
3. `Create a support case for order ACME-1042.`
4. Enter `q` and press Enter to close the session.

Do not append a message to the command, pipe or redirect stdin, use a here-string,
run it in CI, or place it inside a command-capture/subprocess wrapper that has no
interactive stdin. ADK 2.15 can repeatedly read a non-interactive EOF and leave the
chat loop running. If no real TTY is available, leave this check `not_completed`
instead of attempting an automated capture. Record only sanitized observations
after the interactive session; the third answer must preserve the no-case-creation
boundary.

### Agent name versus agent ID

`store_support_agent` is the stable YAML/CLI **agent name**. It is used by
`agents import`, `agents list`, and `chat ask --agent-name`. The tenant-assigned
**agent ID** is a different runtime identifier used by this portal's
`/v1/orchestrate/{agent-id}/chat/completions` request. Do not guess it from the
name or display name. After the Draft import, obtain it from the verbose tenant
details or generate the Draft web-chat configuration:

```text
uv run orchestrate channels webchat embed --agent-name store_support_agent --env draft
```

Use only the returned `agentId` locally; do not copy the complete tenant-specific
embed output into the repository. `npm run guided` asks for the API URL, agent ID,
and WXO API key. The key prompt is masked, and the key is passed only to the portal
server process for that foreground session. The launcher performs chat requests;
it does not read the ADK alias, import resources, or infer Draft/Live state.

Official references:

- <https://developer.watson-orchestrate.ibm.com/adk_extension/tutorial_automate_operations>
- <https://developer.watson-orchestrate.ibm.com/environment/initiate_environment>
- <https://developer.watson-orchestrate.ibm.com/llm/managing_llm>
- <https://developer.watson-orchestrate.ibm.com/connections/managing_connections>
- <https://developer.watson-orchestrate.ibm.com/tools/deploy_tool>
- <https://developer.watson-orchestrate.ibm.com/knowledge_base/deploy_kb>
- <https://developer.watson-orchestrate.ibm.com/agents/import_agent>
- <https://developer.watson-orchestrate.ibm.com/agents/manage_agent>
- <https://developer.watson-orchestrate.ibm.com/webchat/get_started>

## IBM Instana blue SaaS

`npm run guided` can optionally export Support API application traces directly by
OTLP/HTTP to the one reviewed endpoint:

```text
https://otlp-http-blue-saas.instana.io:443
```

This is direct application export. The launcher does not download or install an
Instana host agent, an OpenTelemetry Collector, a Windows service, or any other
system component. Choose the Instana option only after confirming in the tenant's
installer or **More > About Instana** that the tenant uses the Blue SaaS ingest
region. Other regions and self-hosted endpoints fail closed and require a reviewed
code change.

The launcher asks for a synthetic logical host and then for an **Instana Agent
Key**, not an Instana API token. The key entry is masked, is passed only to the
Support API child process, is redacted from child output, and is cleared when the
foreground session stops. The endpoint, service name `acme-support-api`, deployment
environment `guided-lab`, and a unique `ACME-GUIDED-...` correlation ID are supplied
by the launcher. Do not pre-set these values in a repository `.env` file.

There are two separate acceptance statements:

1. a healthy local Support API and exporter diagnostics can show that the exporter
   was configured and attempted OTLP delivery;
2. only a matching trace found in the authorized Instana tenant proves receipt and
   indexing.

To establish the second statement, send a request during the guided session, copy
the printed correlation ID, and search Instana Applications/Analytics for service
`acme-support-api`, environment `guided-lab`, and that correlation value. Record no
key, tenant URL, tenant ID, or unrestricted trace payload in evidence.

Official references:

- <https://www.ibm.com/docs/en/instana-observability?topic=instana-backend>
- <https://www.ibm.com/docs/en/instana-observability?topic=planning-preparing-endpoints-keys>
- <https://www.ibm.com/docs/en/instana-observability?topic=applications-analyzing-traces-calls>

## Exposing the Support API

The default server binds only to loopback. A non-loopback bind fails closed
unless `SUPPORT_API_REQUIRE_AUTH=1` and a server-side `SUPPORT_API_TOKEN` is
present. Put any internet-facing endpoint behind your own reviewed TLS boundary;
the repository does not provide or claim a production ingress configuration.

The WXO Python tool executes in the WXO cloud, not in the participant's browser or
on their workstation. Consequently, `http://127.0.0.1:4000`, `localhost`, and the
loopback-only guided Support API cannot serve as that tool's Draft connection.
Before cloud tool acceptance, an operator must separately deploy the Support API
at a tenant-reachable public HTTPS origin, enable authentication, and place the
origin and credential in the Draft `acme_support_api` connection. A portal chat can
work while the cloud tool still cannot reach its backend; validate the tool result
separately.

An observed portal answer can prove user-visible semantics. It does not prove
the agent's internal tool or retrieval provenance unless separate, direct
evidence establishes that claim.
