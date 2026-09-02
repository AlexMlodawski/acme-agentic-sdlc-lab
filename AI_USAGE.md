# AI usage and human accountability

## Disclosure

AI coding assistants have been used to support preparation of this repository and
its release documentation. AI assistance may include source inspection, drafting,
implementation suggestions, test generation, documentation, and analysis of local
verification output.

This disclosure does not attribute the baseline commit or any release candidate to
a particular product, model, or session. IBM Bob appears in this repository as an
optional development choreography; without session-bound evidence, no current code
or commit is claimed to have been authored by Bob.

## Operating principle

The project follows this boundary:

> AI-assisted, human-owned, tested, and traceable engineering.

AI output is a candidate contribution, not a release decision. A human maintainer is
responsible for requirements, scope, review, security and privacy decisions,
licensing, claims, external authorization, merge, tagging, and publication.

## Permitted assistance

Subject to repository instructions and human scope, an AI assistant may:

- inspect tracked source and explain observed behavior;
- propose a plan and identify risks or missing evidence;
- edit local source, tests, or documentation after implementation is authorized;
- run bounded local checks and summarize sanitized observable output;
- help normalize evidence without inventing missing results;
- suggest a release recommendation for human review.

## Prohibited inference and authority

AI assistance must not be represented as:

- autonomous authority to merge, tag, publish, deploy, import, or promote;
- proof that generated code is correct, secure, accessible, or legally publishable;
- proof that WXO invoked a tool or knowledge source;
- proof that Instana received or indexed a trace;
- proof that IBM Bob authored a commit;
- permission to handle production data or expose credentials;
- endorsement, certification, sponsorship, or maintenance by IBM;
- a substitute for human acceptance.

No external write is authorized merely because an AI assistant recommends it.

## Evidence and attribution

AI-assisted evidence must contain observable facts rather than private reasoning.
Suitable evidence may include:

- exact Git SHA and artifact digest;
- command, bounded timestamp, exit status, and sanitized output;
- test report, owned screenshot, or trace result using fictional data;
- a concise description of files changed and human review performed;
- the explicit states `pass`, `fail`, `not_completed`, and `not_asserted`.

Do not retain or publish chain-of-thought, hidden prompts, unrestricted transcripts,
credentials, auth headers, cookies, private tenant URLs, browser profiles, tenant
exports, raw environment dumps, or production data.

Authorship may be attributed to a named AI tool only when the exact change or commit
was created in an observed session and the attribution can be bounded to that
candidate. General repository history must not be retroactively attributed from a
prompt example or tool availability.

## Human release responsibilities

Before a public release, maintainers remain responsible for:

1. reviewing every candidate change and public claim;
2. confirming the exact SHA and packaged bytes;
3. evaluating tests, security findings, dependency licenses, notices, and assets;
4. confirming that evidence is complete, sanitized, and candidate-specific;
5. marking absent or inconclusive checks honestly;
6. obtaining explicit authorization for any external account-backed operation;
7. making and recording the final release decision.

The repository intentionally does not expose model chain-of-thought. Reviewable code,
diffs, commands, tests, bounded diagnostics, and human decisions are the relevant
engineering artifacts.
