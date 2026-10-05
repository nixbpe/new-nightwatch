# F-000 Feature title

Save as `docs/features/F-000-<slug>/feature.md`. Owner: Product Owner; write the UI flow with the UX Designer. This file owns scope, user flows and ACs. Keep technical contracts in `spec.md`.

| Field                  | Value                       |
| ---------------------- | --------------------------- |
| Epic                   | E-000 / None                |
| Direction              | DIR-001 (when Epic is None) |
| Scope approved by user | Not yet / date              |
| acceptanceVersion      | F-000-AC-1                  |
| Acceptance status      | draft / frozen              |
| outcome_status         | Not measured                |

## Problem and scope

In one or two sentences, state who has the problem and what this Feature changes for them.

- In scope:
- Non-goals:

## Outcome

When Epic is None, state the user outcome and how it will be observed. Otherwise link to the Epic's Outcome.

## UI flow

Write the main path as steps. Put changed states and recovery in the table; link to unchanged behavior at its source.

1. Step the user takes, and what the screen shows next.
2. …

| Screen      | State   | Behavior and recovery |
| ----------- | ------- | --------------------- |
| Screen name | Loading | What shows            |
| Screen name | Error   | Message and recovery  |

Include Empty, Denied and Success when the change touches them. Record each state's copy, focus and keyboard behavior here once.

Optional wireframe:

```text
+----------------------------+
| Title              [Action]|
| list or form               |
+----------------------------+
```

## Stories

- F-000-S01 One-line end-to-end user behavior. Link to its UI flow; covers AC-01, AC-02.
- F-000-S02 …

## Acceptance matrix

AC IDs run across the whole Feature. Include only touched categories. State the pass condition; link to UI flow details instead of repeating them. Verification names the scenario or command; keep actual results in the verification record.

| AC    | Category | Observable behavior                    | Verification        |
| ----- | -------- | -------------------------------------- | ------------------- |
| AC-01 | Scope    | …                                      | Scenario or command |
| AC-02 | State    | Error preserves input; link to UI flow | …                   |

## Open decisions

Keep only unresolved product decisions here. Specs link to these decisions and own technical decisions. Write `None` when all are resolved.

| Decision / missing input | Owner | Blocks AC    |
| ------------------------ | ----- | ------------ |
| …                        | …     | AC-01 / None |
