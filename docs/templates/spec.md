# F-000 Technical Spec

Save as `docs/features/F-000-<slug>/spec.md`. Owner: Technical Lead. This spec is the source of truth for implementation and review. Omit any Contracts subsection the change does not touch. Link to the Feature's ACs instead of restating them.

| Field                | Value                                                           |
| -------------------- | --------------------------------------------------------------- |
| Feature              | F-000, `acceptanceVersion` F-000-AC-1 (`feature.md`)            |
| Epic                 | E-000 / None                                                    |
| Status               | Draft / Approved                                                |
| Approved by user     | Not yet / date (freezes acceptance)                             |
| Start authorization  | None / date and issue (approval alone does not start work)      |
| `COMMIT_MODE`        | none / owned-slice                                              |
| `STOP_AT`            | review-ready / merge-ready                                      |

## Contracts

- API: operations, inputs, outputs and errors.
- Data: tables or columns, RLS policies and grants, migrations.
- Jobs: queues, payload scope, retry and idempotency.
- Web: routes, query keys and cache scope, states from the Feature's UI flow, accessibility.
- Authorization and security: who may do what, data never disclosed, log redaction, fresh-auth boundary.
- Concurrency: races, lock order and the accepted outcome.

## Design decisions

- Architecture drivers touched, the choice made and why.
- Risks and how they are handled.
- Assumptions.
- Non-goals.

## Tasks

Order and ownership:

| Task   | Depends on | Integration owner of shared files |
| ------ | ---------- | --------------------------------- |
| NODE-1 | None       | software-engineer                 |

One block per Task:

### NODE-1 Title

- **OWNER:** software-engineer
- **READY:** condition that makes this Task startable
- **OUTCOME:** the behavior that exists when done
- **SOURCE:** this spec's contract sections and the ACs below
- **INVARIANTS:**
- **FILES:**
- **NON-GOALS:**
- **CONTRACTS:** what sibling Tasks depend on
- **VERIFY:** focused checks permitted while siblings write
- **PROOF:** evidence required at handoff
- **COVERS:** AC-01

## Integrated verification

- ACs covered only by integrated verification, with the scenario for each.
- Gates run once after all writers stop (see `scripts/quality/README.md`).

## Open decisions

| Decision | Owner |
| -------- | ----- |
| …        | …     |

## Revisions

A change to an approved contract or AC is recorded here and approved again by the user.

| Date | Change | Approved by user | `acceptanceVersion` |
| ---- | ------ | ---------------- | ------------------- |
| …    | …      | …                | …                   |
