# Business requirement and plan-only instruction

Improve the delayed-order journey so the contextual assistant may recommend a
support case after explaining the order status, but must never create or submit
the case automatically. The customer must review the prefilled order context,
choose the priority, and explicitly submit.

Acceptance criteria:

- preserve the current customer portal design and keyboard accessibility;
- reuse the existing server-side provider and Support API boundaries;
- keep all credentials out of browser code;
- preserve the `priority` request contract;
- include focused unit and browser acceptance coverage;
- do not weaken error, retry, reset, or evidence-honesty behavior.

Inspect the repository and produce a concrete implementation and verification
plan. Do not modify files, run mutating commands, or create a commit. Stop after
the plan for human review.
