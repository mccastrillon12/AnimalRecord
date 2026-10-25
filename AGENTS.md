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
