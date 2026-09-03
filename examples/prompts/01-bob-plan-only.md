# Bob IDE stage 1 — plan the Draft agent

We are preparing the fictional Acme Store Support Agent for a watsonx
Orchestrate Draft workshop. The backend, portal adapter, read-only Python tool,
knowledge source, agent template, fixtures, and tests already exist. Do not
redesign or replace them.

Inspect these exact sources:

- `agents/store_support_agent/agents/store_support_agent.template.yaml`;
- `agents/store_support_agent/tools/get_order_status.py`;
- `agents/store_support_agent/tools/requirements.txt`;
- `agents/store_support_agent/knowledge_bases/acme_return_policy.yaml`;
- `agents/store_support_agent/knowledge/return-policy.txt`;
- `agents/store_support_agent/scripts/materialize_agent.py`;
- `apps/portal/src/lib/agent/OrchestrateAgentProvider.ts`; and
- `docs/ibm-integrations.md`.

Produce a concrete plan for this sequence:

1. verify the pinned ADK and the selected remote environment without exposing
   its credential;
2. read the exact available model IDs from that tenant;
3. materialize a tenant-specific agent file under the ignored `.generated/`
   directory;
4. run offline validation;
5. inspect existing Draft resources for name collisions;
6. after a separate human authorization, import or safely update only
   `get_order_status`, `acme_return_policy`, and `store_support_agent` in Draft;
7. verify the Draft agent and connect the existing portal through
   `npm run guided`.

Non-negotiable boundaries:

- make no file change and run no mutating command in this stage;
- never ask for an API key in Bob chat and never print, store, or paste one;
- never use a browser URL where the WXO service instance API URL is required;
- never deploy or promote an agent to Live;
- never invent a model ID, endpoint, resource ID, or successful result;
- treat agent routing, tool invocation, knowledge retrieval, and external trace
  receipt as separate claims; and
- stop after the plan for human review.

End with a short readiness table containing `ready`, `missing`, or
`needs-human-authorization` for ADK, remote environment, model, Draft
connection, tool, knowledge base, agent, portal, and Instana.
