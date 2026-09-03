# Bob IDE stage 2 — import the reviewed resources to Draft

I authorize create/update operations for exactly these resources in the active
remote WXO environment identified and reviewed in the preceding stage:

- Draft connection identity `acme_support_api`;
- Draft Python tool `get_order_status`;
- Draft knowledge base `acme_return_policy`; and
- Draft native agent `store_support_agent`.

No other tenant or resource is in scope. Do not deploy or promote anything to
Live. Do not remove resources. Do not accept, display, read from a file, or type
any credential. The facilitator must configure the Draft connection credentials
separately in the WXO UI.

Before writing, re-run the read-only lists and state the exact active environment
and collision status. Require an existing Draft `acme_support_api` connection
with credentials entered; if it is absent or not configured, stop with a precise
facilitator action. If an existing Acme resource differs materially, use the ADK
`--safe` prompt and stop for my confirmation instead of overwriting it silently.

From `agents/store_support_agent`, use the reviewed materialized file and this
order:

1. `uv run orchestrate tools import -k python -f tools/get_order_status.py -r tools/requirements.txt --app-id acme_support_api --safe`
2. `uv run orchestrate knowledge-bases import -f knowledge_bases/acme_return_policy.yaml --safe`
3. `uv run orchestrate agents import -f .generated/store_support_agent.yaml --safe`

Then verify with read-only list commands. The Draft chat check requires exactly one
foreground ADK 2.15 interactive session attached to a real TTY. The facilitator,
not a non-interactive Bob command runner, must start:

```text
uv run orchestrate chat ask --agent-name store_support_agent
```

At the chat prompt, enter each question only after the preceding answer completes,
then exit explicitly:

1. `What is the current status of order ACME-1042?`
2. `What is the standard return window?`
3. `Create a support case for order ACME-1042.`
4. Enter `q` and press Enter.

Do not supply a message argument, pipe or redirect stdin, use a here-string, run the
chat in CI, or invoke it through an output-capture/subprocess wrapper without
interactive stdin. With ADK 2.15, a non-interactive EOF can be read repeatedly and
leave the chat loop running. If a real TTY is unavailable, do not retry through a
capture tool; stop and report the Draft chat check as `not_completed`.

The third answer must refuse automatic submission and direct the user to the
portal form. Return a sanitized result table that distinguishes agent response,
tool outcome, knowledge answer, and case-creation boundary. If any part is not
directly observed, mark it `not_completed` or `not_asserted`; never infer a pass.
