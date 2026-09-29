# F-000 Feature title

Save as `docs/features/F-000-<slug>/feature.md`. Owner: Product Owner; the UI flow is written with the UX Designer.

| Field                  | Value          |
| ---------------------- | -------------- |
| Epic                   | E-000 / None   |
| Direction              | DIR-001 (when Epic is None) |
| Scope approved by user | Not yet / date |
| acceptanceVersion      | F-000-AC-1     |
| Acceptance status      | draft / frozen |

## Problem and scope

- Who has the problem and what they need to do.
- In scope:
- Non-goals:

## Outcome

Only when Epic is None: what changes for the user when this Feature is done, and how it will be observed.

## UI flow

1. Step the user takes, and what the screen shows next.
2. …

| Screen      | Loading    | Empty      | Error                | Denied     | Success    |
| ----------- | ---------- | ---------- | -------------------- | ---------- | ---------- |
| Screen name | What shows | What shows | Message and recovery | What shows | What shows |

Optional wireframe:

```text
+----------------------------+
| Title              [Action]|
| list or form               |
+----------------------------+
```

## Stories

- F-000-S01 One end-to-end user behavior. Covers AC-01, AC-02.
- F-000-S02 …

## Acceptance matrix

AC IDs run across the whole Feature. Include only the categories the change touches.

| AC    | Category | Observable behavior             | Verification        |
| ----- | -------- | ------------------------------- | ------------------- |
| AC-01 | Scope    | …                               | Scenario or command |
| AC-02 | State    | Matches the UI flow state table | …                   |

## Open decisions

| Decision | Owner |
| -------- | ----- |
| …        | …     |
