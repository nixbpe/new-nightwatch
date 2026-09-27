# NODE-F004-03 — Role management

| Field | Value |
| --- | --- |
| Feature | `F-004`, `acceptanceVersion: F-004-AC-2` |
| Story | `F-004-S03` |
| Status | Approved, 2026-09-27; split confirmed by commit/issue instruction |
| Depends on | `NODE-F004-01` merged and handoff accepted |
| Parallel with | `NODE-F004-02` source work after node 01 |
| Merge gate | Rebase on merged node 02, then merge |
| Implementation authorization | None; start authorization is still required |

Common contracts and design decisions are authoritative in `../spec.md`.

- **OWNER:** `software-engineer`
- **READY:** NODE-F004-01 handoff/review passed; member page, list contract and composition boundary are available. NODE-F004-02 is not a behavioral prerequisite.
- **OUTCOME:** role actions, owner confirmation and pending/result refresh; existing first-party PATCH remains the sole role mutation
- **SOURCE:** `F-004-AC-2` AC-04, AC-08–AC-10, AC-16–AC-17
- **INVARIANTS:** admin cannot touch owner; current actor and target are checked under lock; exact last-owner count remains >= 1 in every race; no false optimistic role/success and no stale A update in B
- **FILES:** existing `apps/api/src/organization-notifications/members.ts`, `apps/api/src/organization-notifications/routes.ts`, `apps/web/src/lib/api/openapi-types.gen.ts`; NODE-F004-01 outputs `apps/web/src/lib/api/members.ts`, `apps/web/src/pages/OrganizationMembersPage.tsx`; planned-new `apps/web/src/pages/organization-members/MemberRoleActions.tsx`, `apps/web/src/pages/organization-members/MemberActionDialog.tsx`; focused API DB and web tests. API files change only for defects against the frozen contract; generated types change only if the declaration changes. Node 03 owns `MemberActionDialog.tsx` for nodes 04 and 05.
- **NON-GOALS:** new role model, new permission hierarchy, bulk actions, native Better Auth mutation
- **CONTRACTS:** existing PATCH response, current role precedence/composite behavior and `LAST_OWNER`; owner-involved role change requires confirmation, while other role changes do not
- **VERIFY:** focused HTTP/DB owner/admin/viewer/auditor against target/new role, actor demotion and target change while blocked, one/two owners and concurrent demotion×demotion; web confirm/cancel/non-owner direct save, pending/failure/LAST_OWNER/latest persisted role, late A response after switch and dialog keyboard/focus/reflow
- **PROOF:** persisted roles and owner count after interleavings; losing status and no success notice; unauthorized existing/missing targets indistinguishable; redacted logs; focused DOM/accessibility state; cancel sends no request
- **COVERS:** AC-04 (role), AC-08, AC-09, AC-10, AC-16 (role), AC-17 (role)

## Parallel and shared-file policy

Source work may run with node 02 after node 01. Keep role UI in its own component and avoid invitation-owned modules. Node 02 merges first. Node 03 rebases, resolves member-page composition and generated-output conflicts once, reruns its focused verification and then enters review. Node 04 cannot start until this merged dialog and role-action contract is accepted.
