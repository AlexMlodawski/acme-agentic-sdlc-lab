# Live and account-backed modes

## v0.1.0 position

Live tenant execution is outside the v0.1.0 release claim. The repository ships
reviewable source-level seams for watsonx Orchestrate Draft and Instana, plus IBM Bob
workflow guidance. Their presence does not establish successful authentication,
tenant compatibility, import, tool invocation, knowledge retrieval, trace delivery,
or production readiness.

| Capability | Source present | External execution asserted for v0.1.0 |
| --- | --- | --- |
| Local deterministic assistant | Yes | Candidate-local behavior may be evaluated |
| watsonx Orchestrate portal provider | Yes | No; `not_asserted` |
| WXO Draft agent package | Yes | No; `not_asserted` |
| WXO read-only order tool | Yes | No tenant invocation claim |
| Instana OTLP/HTTP exporter path | Yes | No tenant receipt or trace-search claim |
| IBM Bob choreography | Documentation only | No execution or authorship claim |
| Forgejo workflow | No | Out of scope |
| Replay profile | No | Out of scope |
| WXO Live promotion | No | Prohibited by scope |

## Local/mock versus account-backed execution

The root `npm run dev` command deliberately forces `AGENT_MODE=stub` and strips
application credentials from the child environments. This is the supported local
launcher behavior and must not be weakened to make account-backed use convenient.

The presence of `AGENT_MODE=orchestrate`, `WXO_API_ENDPOINT`, `WXO_AGENT_ID`, and
`WXO_API_KEY` in source-level configuration defines an adapter boundary only. The
repository does not currently provide a combined root lifecycle for that profile.

## Human authorization boundary

Nothing in this repository authorizes an external write. A person choosing to test
an optional integration must separately:

1. name the exact tenant, workspace, environment, and intended operation;
2. verify that the account and product license permit the operation;
3. keep credentials in protected runtime or tenant credential storage;
4. review the generated agent and tool definitions before any import;
5. constrain WXO work to Draft;
6. treat Instana investigation as read-only;
7. avoid production data and use only fictional Acme test records;
8. stop before deployment, Live promotion, merge, or release unless each operation
   receives its own explicit authorization.

## Evidence required for a future integrated claim

A future account-backed run should separate these claims:

| Claim | Minimum direct evidence |
| --- | --- |
| Candidate identity | Exact Git SHA and packaged-artifact digest |
| WXO routing | Sanitized portal response carrying the expected provider source and run timestamp |
| Draft status | Direct, sanitized observation of the selected tenant workspace and Draft resource |
| Tool invocation | Tool-specific invocation/result evidence tied to the same run; answer text alone is insufficient |
| Knowledge retrieval | Retrieval-specific evidence tied to the same run; policy wording alone is insufficient |
| Instana export | Sanitized exporter diagnostic for the candidate process |
| Instana receipt | Read-only trace result from the intended tenant tied by bounded correlation metadata |
| IBM Bob authorship | Exact commit created in the observed Bob-assisted session and subsequently reviewed |
| Human approval | Named approval record for the exact candidate after all required checks |

Evidence must omit keys, tokens, auth headers, private URLs, cookies, tenant exports,
raw prompts containing private material, and model chain-of-thought.

## Failure semantics

- Missing credentials or invalid configuration is not a local fallback; the
  integrated request fails closed.
- A local mock response must never be labeled as WXO output.
- A routed WXO response does not prove tool or knowledge provenance.
- An exporter diagnostic does not prove tenant ingestion.
- A Draft resource is not a Live or production resource.
- A failed or unfinished account-backed run is `fail` or `not_completed`, never a
  presentation-only `pass`.
