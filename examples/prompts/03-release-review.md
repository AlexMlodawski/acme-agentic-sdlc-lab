# Evidence-first release review

Review the exact candidate currently checked out. Run the repository's bounded
verification and local browser journey. Preserve only sanitized, observable
evidence. Do not expose chain-of-thought, credentials, local user paths, or raw
environment values. Do not deploy or write to any external system.

Return a release recommendation using only `pass`, `fail`, `not_completed`, and
`not_asserted`. A missing or unfinished check is never a pass. Separate
user-visible assistant semantics from any claim about internal tool invocation
or knowledge-retrieval provenance.
