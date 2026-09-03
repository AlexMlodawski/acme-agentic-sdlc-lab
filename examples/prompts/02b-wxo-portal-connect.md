# Bob IDE stage 3 — connect the existing portal

Use read-only ADK output to identify the exact ID of Draft agent
`store_support_agent` and the WXO service instance API URL. Do not confuse the
agent name with its ID or the browser application URL with the API URL.

Ask me to run `npm run guided` in an interactive terminal. Guide me through:

1. selecting **WXO account-backed**;
2. entering the service instance API URL and exact agent ID;
3. entering the WXO API key only in the launcher's masked prompt;
4. optionally enabling Instana Blue SaaS and entering its Agent Key only in the
   separate masked prompt;
5. reviewing the secret-free summary; and
6. choosing portal/API plus all documents and previews.

Once the application is ready, verify in the browser:

1. search for `ACME-1042`;
2. ask `What is the status of this order, and what is the standard return window?`;
3. confirm the visible source badge says `watsonx Orchestrate`;
4. ask a follow-up question and confirm the conversation continues;
5. ask the assistant to create a support case and confirm it does not submit one;
6. submit a fictional case only through the user-controlled form; and
7. if Instana was enabled, record the synthetic correlation ID and inspect the
   tenant read-only for the matching Support API trace.

Keep the guided terminal running until I choose `0`. Never expose either key,
never claim WXO tool/knowledge provenance from the source badge alone, and never
claim Instana receipt from an exporter diagnostic alone.
