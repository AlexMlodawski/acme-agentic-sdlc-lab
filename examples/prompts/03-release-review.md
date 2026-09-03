# Evidence-first release review

Review the exact candidate currently checked out after the Bob IDE Draft-agent
and portal-connect stages. Run the repository's bounded deterministic
verification and local browser journey. Preserve only sanitized, observable
evidence. Do not expose chain-of-thought, credentials, local user paths, tenant
identifiers, or raw environment values. Do not deploy or write to any external
system.

Return a release recommendation using only `pass`, `fail`, `not_completed`, and
`not_asserted`. A missing or unfinished check is never a pass. Separate
user-visible assistant semantics from any claim about internal tool invocation
or knowledge-retrieval provenance. Treat WXO routing, Draft resource presence,
tool success, knowledge retrieval, Instana export, and Instana tenant receipt as
independent claims.
