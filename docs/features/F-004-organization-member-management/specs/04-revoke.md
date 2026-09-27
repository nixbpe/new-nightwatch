# NODE-F004-04 — Revoke

| Field | Value |
| --- | --- |
| Feature | `F-004`, `acceptanceVersion: F-004-AC-2` |
| Story | `F-004-S04` |
| Status | Approved, 2026-09-27; split confirmed by commit/issue instruction |
| Depends on | `NODE-F004-03` merged and handoff accepted |
| Parallel with | None as a complete PR |
| Merge gate | After node 03 |
| Implementation authorization | None; start authorization is still required |

Common contracts and design decisions are authoritative in `../spec.md`.

- **OWNER:** `software-engineer`
- **READY:** NODE-F004-03 handoff/review passed; shared dialog and member page are available
- **OUTCOME:** confirmed revoke, scoped list/context refresh and session revocation transition using the existing first-party DELETE
- **SOURCE:** `F-004-AC-2` AC-04, AC-11, AC-12, AC-15 (revoke), AC-16–AC-17
- **INVARIANTS:** current permission, target and last-owner state are checked under the existing lock; membership delete and active-selection mirrors clear atomically; revoked user receives denial on the next A request and context excludes A while retaining B; pending A never writes B
- **FILES:** `apps/api/src/organization-notifications/members.ts` and `routes.ts` plus focused DB tests only for contract gaps, `apps/api/src/me/service.ts` only for a context defect, revoke component under `apps/web/src/pages/organization-members/`, `apps/web/src/lib/api/members.ts`, `apps/web/src/pages/OrganizationMembersPage.tsx`, `apps/web/src/lib/tenant/TenantProvider.tsx` only for the revocation transition and focused web tests; reuse the node 03 dialog
- **NON-GOALS:** delete user, revoke invitation, cross-tab real-time synchronization
- **CONTRACTS:** existing member DELETE, confirmation target/Organization/impact and `LAST_OWNER`; context semantics from `../spec.md`
- **VERIFY:** focused DB/HTTP role×target, one/two owners, target/actor race and concurrent revoke×revoke; two sessions where one revokes A, then the other receives denial on the next A list/mutation and refreshed context retains B without A; web confirm/cancel, losing/LAST_OWNER, scope redirect/no-access, delayed A response and keyboard/focus after row removal
- **PROOF:** membership/user/session snapshots for the committed transition; owner count >= 1; response/log secrecy; next request and context payload; UI redirect/no-access; cancel sends zero requests
- **COVERS:** AC-04 (revoke), AC-11, AC-12, AC-15 (revoke), AC-16 (revoke), AC-17 (revoke)

## Dependency reason

This node consumes the confirmation/dialog contract from node 03 and establishes the revocation transition reused by self-leave. API investigation may occur earlier, but implementation, review and merge remain blocked on node 03 to avoid two dialog conventions and concurrent edits to the same page and tenant transition.
