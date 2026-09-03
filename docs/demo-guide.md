# Ten-minute WXO case-study demo

The story is:

> Bob IDE prepares a reviewed agent from existing engineering assets, a human
> authorizes the WXO Draft import, the portal consumes the agent, CI/CD produces
> bounded evidence, Bob Shell advises, and a human still owns release.

Ten minutes is enough to present a rehearsed path, not to install tools or safely
configure a tenant from scratch. Use the complete [workshop guide](workshop.md) for
the hands-on session.

## Prepare before screen sharing

- Check out and record one exact clean commit.
- Have an authorized Bob IDE installation open on the repository.
- Prevalidate WXO ADK `2.15.0`, the active non-production environment, and a real
  model ID from that tenant.
- Import the reviewed `get_order_status`, `acme_return_policy`, and
  `store_support_agent` resources to Draft under an explicit human authorization.
- Configure the Draft `acme_support_api` connection to a reachable, authenticated
  public HTTPS deployment of the fictional Support API.
- Keep the WXO API key and optional Instana Agent Key out of slides, screenshots,
  shell history, and repository files.
- If Instana will be shown, have read-only tenant access and a rehearsed query for the
  synthetic guided-session correlation ID.
- If Bob Shell will be claimed as executed, have a validated sanitized report tied to
  the exact candidate SHA. Otherwise present only the shipped controller and mark the
  review claim `not_asserted`; reserve `not_completed` for a run that started but did
  not finish.
- Keep the Local mock profile ready as a clearly labeled fallback.

Start `npm run guided` only when the audience can see the secret-free portions of the
terminal. Enter keys in the masked prompts outside the captured frame or while screen
sharing is paused. Choose **WXO account-backed** and **Portal + API and all
documents/previews**. The launcher remains active until option `0` or terminal
closure.

## Minute-by-minute path

### 0:00-0:45 — State the boundary

Show the exact candidate SHA and the flow at the top of the workshop guide.

Say: “This is a Draft case study with fictional data. Bob can prepare and review;
tests provide evidence; neither tool may approve a release or promote the agent to
Live.”

### 0:45-2:15 — Show the Bob IDE choreography

Open the four supplied prompts in order:

1. [`01-bob-plan-only.md`](../examples/prompts/01-bob-plan-only.md) — inspect and plan;
2. [`02-go.md`](../examples/prompts/02-go.md) — select a real tenant model, materialize
   the YAML, and validate locally without a tenant write;
3. [`02a-wxo-draft-import.md`](../examples/prompts/02a-wxo-draft-import.md) — only after
   the human names the exact environment and Draft resources; and
4. [`02b-wxo-portal-connect.md`](../examples/prompts/02b-wxo-portal-connect.md) — connect
   the existing portal through the masked guided launcher.

Show the ready backend assets: agent template, read-only order tool, return-policy
knowledge source, and portal provider. Emphasize that Bob is not inventing a backend;
it is assembling and checking the prepared contract.

Show that the plan-only stage left `git status --short` unchanged. If the live Bob run
is not being repeated, identify the display as evidence from the exact rehearsed
candidate rather than pretending it is happening now.

### 2:15-3:15 — Show the human Draft gate

Show sanitized read-only WXO resource output for the intended environment and the
three reviewed import commands. Do not display a key, private URL, or unrestricted
tenant export.

State the approved identities: `acme_support_api`, `get_order_status`,
`acme_return_policy`, and `store_support_agent`. Point out that `--safe` stops on a
collision and that no deploy or Live promotion command exists in this path.

### 3:15-4:15 — Launch the integrated preview

Show the guided launcher's secret-free summary and ready checks. Explain:

- the browser talks to the local portal;
- the portal holds the WXO adapter and key server-side;
- the Draft agent calls the separately prepared public HTTPS Support API; and
- the local Support API remains useful for the portal's deterministic order and case
  paths, but is not automatically the public endpoint used by WXO.

Open the portal from the guided session. Never reveal values from the masked prompts.

### 4:15-6:30 — Run the account-backed customer journey

1. Search for `ACME-1042`.
2. Open **Order assistant**.
3. Ask: `What is the status of this order, and what is the standard return window?`
4. Show the visible `watsonx Orchestrate` source badge.
5. Ask one follow-up question to demonstrate conversation continuity.

Say precisely: “The badge proves that this portal response used the WXO provider
route. It does not, by itself, prove which internal tool or knowledge source the agent
used.”

If separate sanitized WXO runtime evidence exists, show the tool and knowledge
observations independently. Otherwise leave those two claims `not_asserted`, even
when the answer text looks correct.

### 6:30-7:30 — Show the human action boundary

Ask the assistant to create a support case. It should direct the user to the existing
form and must not submit anything.

Then, as the human user, review the order context, choose `priority`, enter a
fictional description, and submit the form. Show the synthetic receipt stating that
no real external ticket was created.

### 7:30-8:15 — Show optional Instana evidence

If Instana was enabled, show the generated correlation ID and a read-only tenant
result for the matching `acme-support-api` trace. Keep unrelated telemetry and tenant
details out of frame.

State the distinction: the bounded exporter diagnostic supports only its exporter
claim; the matching tenant trace supports receipt/search visibility. If the trace is
not directly visible, call receipt `not_asserted` and move on.

If Instana was not enabled, say so. The application-only flow uses direct OTLP/HTTP;
a machine-wide collector is not a prerequisite.

### 8:15-9:10 — Show deterministic and candidate-bound evidence

Open the exact-candidate results for:

```text
npm run preflight
npm run verify
npm run e2e:local
npm run e2e:built
npm run release:audit -- --mode Full --candidate <public-safe-candidate-label>
```

Contrast `pass`, `fail`, `not_completed`, and `not_asserted`. A green local browser
run does not prove WXO or Instana behavior; each external observation keeps its own
status.

### 9:10-9:45 — Show Bob Shell as an advisory CI/CD reviewer

Open [the Bob Shell control model](bob-shell-cicd.md). If an authorized run exists,
show only the validated sanitized report and its matching candidate SHA. Explain that
the credential runs only on a protected ephemeral Linux runner after deterministic
gates succeed.

If no authorized run exists, show `npm run test:bob-review` results and state that the
controller is tested but the authenticated Bob Shell review claim is `not_asserted`.
If an authorized run started but did not finish, record `not_completed`. Never
substitute a synthetic report.

### 9:45-10:00 — End with the human decision

Close with: “The evidence supports only the checks we actually completed. Bob's
recommendation is advice. A named human still decides whether this exact candidate is
acceptable and separately authorizes any publication or deployment.”

After the audience view ends, choose option `0`, stop any temporary public endpoint,
and follow the workshop cleanup record.

## Claims you may make when directly observed

- Bob IDE produced a plan before any implementation or tenant write.
- A tenant-supported model was materialized into a locally validated agent definition.
- The named resources were imported into the authorized WXO Draft environment.
- The portal routed a completed response through its WXO provider.
- The assistant preserved user-controlled support-case submission.
- Deterministic checks completed for the exact candidate shown.
- Instana displayed a matching application trace, when the tenant result is visible.
- Bob Shell reviewed the exact candidate, only when a validated authenticated report
  exists.

## Claims you should not make

- that this is an official IBM reference architecture;
- that a source badge proves an internal WXO tool call or knowledge retrieval;
- that expected answer text establishes internal provenance;
- that an exporter success message proves Instana indexed the trace;
- that Draft means Live or production-ready;
- that a Bob Shell recommendation is a release approval; or
- that a rehearsed or recorded artifact is a live observation happening now.
