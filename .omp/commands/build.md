---
description: Implement one assigned slice or run no-edit evidence against a bound candidate; use auto only for an approved full plan.
---

Use skill:`incremental-implementation` and skill:`test-driven-development` for implementation work.

## Modes

- `/build` — implement the next pending task, then stop.
- `/build NODE-<id>` — execute the Technical Lead assignment supplied after the command.
- `/build auto` — execute an approved plan without stopping between tasks.

Treat only bare `auto` or `all` as autonomous mode. Any `NODE-<id>` is assignment mode, never autonomous planning.

## Technical Lead assignment

Read `OUTCOME`, `SOURCE`, `FILES`, `NON-GOALS`, `VERIFY`, `PROOF`, `COMMIT_MODE`, sibling ownership and any `BINDING` before acting.

### Implementation assignment

1. Stay within owned files and accepted criteria.
2. Reproduce changed behavior with a failing regression when appropriate.
3. Implement the smallest complete fix.
4. Run exactly the focused checks permitted by `VERIFY`; defer shared/full gates while siblings write.
5. Commit only under `COMMIT_MODE: owned-slice`: after focused checks pass, stage only owned in-scope files and commit one behavior with its regression proof. Otherwise do not commit; never push, open a PR, force-push or rewrite history.
6. Return changed paths, observed behavior, each command with its result as passed, failed or not run, any commit SHA and confirmation that mutation stopped. Never claim more verification than was run.

### Bound evidence assignment

A supplied `BINDING` with source mutation forbidden is validation mode:

1. Change no source, tests, generated files or configuration.
2. Run exactly the assigned application gates against that binding.
3. Stop on any required source change and return a finding; do not repair in place.
4. Report command, scope, result and binding as author-produced evidence, not independent technical acceptance.
5. Do not commit.

## Default: one task

Pick the next pending task and use the implementation assignment. If no accepted task exists, stop rather than inventing scope.

## Autonomous plan

1. Require `SOURCE` to name one user-approved Technical Spec at `docs/features/<Feature>/spec.md`. Stop when `SOURCE` is absent, unresolved or ambiguous—never select among matching specs.
2. Require a clean baseline outside `tasks/plan.md`, `tasks/todo.md` and the approved spec. Never absorb unrelated work.
3. Derive `tasks/plan.md` from the spec when absent; do not invoke an undefined planning skill.
4. Present the plan once and require unambiguous approval.
5. Execute in dependency order, one behavioral slice at a time. Commit only under `COMMIT_MODE: owned-slice`, as in an implementation assignment; plan approval is not commit approval.
6. Stop for ambiguous requirements, failed gates without a bounded fix, or irreversible/high-risk work requiring explicit sign-off.
7. Summarize completed tasks, evidence, commits, skipped checks and blockers.

On failure, use skill:`debugging-and-error-recovery`.
