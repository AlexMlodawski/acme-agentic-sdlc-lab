# Evidence model

The lab separates facts from attractive but unsupported inferences.

## Status vocabulary

| State | Meaning |
| --- | --- |
| `pass` | The check completed and evidence supports its exact claim. |
| `fail` | The check completed and found a release blocker. |
| `not_completed` | Execution ended before the check finished. |
| `not_asserted` | The evidence cannot establish the claim. |

## Provenance rules

- A fixture proves only fixture rendering.
- A browser response proves user-visible behavior at that moment.
- `source=orchestrate` proves provider routing, not an internal tool invocation.
- An API correlation ID links bounded observations; it is not a trace by itself.
- A trace search proves only what the returned trace contains.
- A Git SHA identifies source; an archive digest identifies packaged bytes.

## Privacy boundary

Reports may include timestamps, synthetic IDs, statuses, durations, sanitized
errors, screenshots of fictional data, and aggregate cost metadata. They must
not include prompts containing private data, credentials, auth headers, cookies,
raw model reasoning, private tenant URLs, or unrestricted logs.

The Bob advisory report uses a narrower contract: one `reviewedAt` timestamp,
configured cost/turn caps, exact SHAs, guard and gate facts, sanitized findings and
`notAsserted` items, a recommendation, and completion hashes. It does not retain a
start/finish pair, process-exit metadata, or the raw terminal stream.

Two synthetic examples live under `examples/evidence`.
