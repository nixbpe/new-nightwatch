# F-000 Technical Spec

Save as `docs/features/F-000-<slug>/spec.md`. Owner: Technical Lead. This spec owns technical contracts and Tasks for implementation and review. The Feature owns scope, UI behavior and ACs.

Summarize the technical change in one sentence. For long specs, add links to Contracts, blocking Open decisions, delivery and verification records.

| Field               | Value                                                      |
| ------------------- | ---------------------------------------------------------- |
| Feature             | F-000, `acceptanceVersion` F-000-AC-1 (`feature.md`)       |
| Status              | Draft / Approved                                           |
| Approved by user    | Not yet / date (freezes acceptance)                        |
| Start authorization | None / date and issue (approval alone does not start work) |
| `COMMIT_MODE`       | none / owned-slice                                         |
| `STOP_AT`           | review-ready / merge-ready                                 |

Set `Status` to Approved only with a date in `Approved by user`.

## Contracts

Omit untouched subsections. Specify technical details here; link to Feature scope, UI states and ACs. Keep repository conventions in their owning references.

- API: operations, inputs, outputs and errors.
- Data: tables or columns, RLS policies and grants, migrations.
- Jobs: queues, payload scope, retry and idempotency.
- Web: routes, query keys and cache scope, states from the Feature's UI flow, accessibility.
- Authorization and security: who may do what, data never disclosed, log redaction, fresh-auth boundary.
- Concurrency: races, lock order and the accepted outcome.

## Design decisions

- Choices and reasons; rejected alternatives only when they explain a tradeoff.
- Touched architecture drivers, risks and mitigations, and assumptions.
- Link to Feature non-goals; add only technical exclusions.

## Tasks

Map every AC to a Task's `COVERS` or integrated verification. Keep dependencies and shared-file ownership in the table; keep Task details in its block.

Order and ownership:

| Task   | Depends on | Integration owner of shared files |
| ------ | ---------- | --------------------------------- |
| NODE-1 | None       | software-engineer                 |

One block per Task. Keep every field; use links for shared constraints and `None` when no Task-specific constraint applies.

### NODE-1 Title

- **OWNER:** software-engineer
- **READY:** condition that makes this Task startable
- **OUTCOME:** one-line behavior delivered by this Task
- **SOURCE:** links to contract headings and Feature AC IDs
- **INVARIANTS:** Task-specific constraints or links to shared invariants
- **FILES:** owned paths; shared-file ownership follows the table
- **NON-GOALS:** link to shared exclusions; add only Task-specific exclusions
- **CONTRACTS:** links to contracts sibling Tasks depend on, or None
- **VERIFY:** focused commands permitted while siblings write
- **PROOF:** required results and artifacts at handoff, traced to COVERS
- **COVERS:** AC-01

After delivery, link the delivered PR or commit and label execution settings as historical. Move completed plans to `history.md` when they need preserving. Keep approved contracts and revisions here.

## Integrated verification

- AC IDs covered only at integration, with the scenario for each.
- Link to applicable gates in `scripts/quality/README.md`; run them after all writers stop.
- Record actual results and gaps separately, linked to the verified commit or candidate. Delivery does not prove acceptance, runtime verification or a measured outcome.

## Open decisions

Keep unresolved technical decisions here; link to open product decisions in the Feature. Write `None` when all are resolved.

| Decision / missing input | Owner | Blocks Task / AC      |
| ------------------------ | ----- | --------------------- |
| …                        | …     | NODE-1 / AC-01 / None |

## Revisions

Record changes to an approved contract or AC and obtain user approval before implementation. Link to the changed contract or Feature AC. Update `acceptanceVersion` when ACs change; keep discussion in the linked source.

| Date | Change | Approved by user | `acceptanceVersion` |
| ---- | ------ | ---------------- | ------------------- |
| …    | …      | …                | …                   |
