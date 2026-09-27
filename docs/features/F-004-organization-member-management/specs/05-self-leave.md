# NODE-F004-05 — Self-leave

| Field | Value |
| --- | --- |
| Feature | `F-004`, `acceptanceVersion: F-004-AC-2` |
| Story | `F-004-S05` |
| Status | Approved, 2026-09-27; split confirmed by commit/issue instruction |
| Depends on | `NODE-F004-04` merged and handoff accepted |
| Parallel with | None as a complete PR |
| Merge gate | After node 04 |
| Implementation authorization | None; start authorization is still required |

Common contracts and design decisions are authoritative in `../spec.md`.

- **OWNER:** `software-engineer`
- **READY:** NODE-F004-04 handoff/review passed; revocation transition and shared dialog are available
- **OUTCOME:** every member role can use confirmed self-leave even when the list is denied; selection/context moves only after server confirmation
- **SOURCE:** `F-004-AC-2` AC-02 (self-leave entry), AC-04, AC-13–AC-15, AC-16–AC-17
- **INVARIANTS:** last owner cannot leave; account and B membership remain; next request uses current server scope; stale A notice never appears in B or no-access
- **FILES:** existing `apps/api/src/organization-notifications/members.ts`, `apps/api/src/organization-notifications/routes.ts`, `apps/api/src/me/service.ts`, `apps/web/src/lib/tenant/TenantProvider.tsx`; NODE-F004-01 outputs `apps/web/src/lib/api/members.ts`, `apps/web/src/pages/OrganizationMembersPage.tsx`; NODE-F004-03 output `apps/web/src/pages/organization-members/MemberActionDialog.tsx`; planned-new `apps/web/src/pages/organization-members/SelfLeaveAction.tsx`; focused API DB, web/page and shell tests; existing workspace no-access UI only when required.
- **NON-GOALS:** sign-out, delete account, force another client tab to change current Organization, background task
- **CONTRACTS:** existing DELETE `/members/me` and `/api/me/context`; confirmation actor/Organization/impact, owner invariant and server-confirmed scope or no-access
- **VERIFY:** real DB/HTTP leave for owner/admin/viewer/auditor, one/two owners, concurrent leave×demotion, A+B user leaves A and then receives A denial while context retains B and account remains; web viewer/auditor self-leave without list, cancel/pending/LAST_OWNER/failure, success redirect/no-access, late A response and keyboard/dialog focus at narrow viewport and 200% text in both themes
- **PROOF:** owner count >= 1; persisted user/member/session rows for A/B; next denied response and context payload; accessible UI transition; cancel sends no mutation
- **COVERS:** AC-02 (self-leave entry), AC-04 (leave), AC-13, AC-14, AC-15 (leave), AC-16 (leave), AC-17 (leave)

## Dependency reason

This node reuses node 04 revocation cleanup, context refresh and focus behavior. Keeping it last prevents duplicate tenant-transition logic and gives the final PR one narrow behavior to review: self-removal through the already-proven revocation transition.
