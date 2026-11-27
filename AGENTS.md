# Repository guidance

Before feature work, read `docs/final-delivery-plan.md` for current tasks and
`docs/application-map.md` for module dependencies, invariants and known risks.
For animal transfers also read `docs/animal-transfer-strategy.md`.
Record completed tasks, validation results, compatibility changes and the next
concrete step in the delivery plan after each implementation block. Keep
implemented behavior separate from approved target behavior and open decisions.
`Animal.nameHistory` stores names, not ownership history.

Before planning or changing the medical-document AI flow, read
`docs/medical-document-strategy.md` first. It is the functional source of truth.
Then read `docs/medical-document-ai.md` for the current technical implementation.

When they differ, the strategy document describes the target behavior and the
technical document describes the current implementation. Update the strategy
first when business rules change.

Keep documentation concise and centralized. Maintain a short current handoff
checkpoint at the top of the delivery plan: verified Git base, implemented versus
pending work, relevant validation, next concrete step, and approval/safety limits.
Read that checkpoint first; consult relevant technical sections and history as needed.
Update the frontend guide only for material contract, behavior, error, integration
or compatibility changes. Update the application map when dependencies change.
Preserve durable decisions, unresolved questions and non-obvious invariants/risks.
Prefer existing documents; a new document needs an independently maintained purpose.
Avoid duplicating checkpoints, copying code or logging routine commands and retries.

Prepare new application collections and required indexes when the backend starts.
Reuse the application's Mongo connection and existing additive startup preparation.
Prepare storage independently of whether an optional feature is enabled.

Prefer coherent functional blocks over commits for each implementation layer.
Use focused checks while developing and consolidate broad regression at block
completion; repeat it only for relevant changes, failures or unresolved concerns.
A commit boundary alone does not require another full run. Do not commit or push
without an explicit request. Infrastructure authorization remains environment-specific.
