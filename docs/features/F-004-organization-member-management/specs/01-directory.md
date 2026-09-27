# NODE-F004-01 — Directory

| Field | Value |
| --- | --- |
| Feature | `F-004`, `acceptanceVersion: F-004-AC-2` |
| Story | `F-004-S01` |
| Status | Approved, 2026-09-27; split confirmed by commit/issue instruction |
| Depends on | None |
| Parallel with | None before merge; this node establishes shared contracts |
| Merge gate | First |
| Implementation authorization | None; start authorization is still required |

Common contracts and design decisions are authoritative in `../spec.md`.

- **OWNER:** `software-engineer`
- **READY:** user-approved Spec, existing auth/session, DB and UI shell; no node dependency
- **OUTCOME:** server-authorized paginated member list and navigable member page; only owner/admin see the list, while viewer/auditor receive a denied state without member data; foundational scope/cache/loader contract works end to end
- **SOURCE:** `F-004-AC-2` AC-01–AC-04, AC-16–AC-17; architecture DB-06, WEB-01–04
- **INVARIANTS:** scoped join never exposes B in A; each response contains at most 50 rows and `total` comes from the same statement snapshot as the page; permission is checked before target data; existing and missing Organization denial are indistinguishable; scope switch never renders stale Organization/page data; request path and logs contain no PII
- **FILES:** `packages/api-contract/src/auth.ts`, `packages/api-contract/src/index.ts` or one new member contract module in the same package, `apps/api/src/organization-notifications/routes.ts`, `apps/api/src/organization-notifications/members.ts`, `apps/api/src/app.ts`, focused API route/DB tests, generated `apps/web/src/lib/api/openapi-types.gen.ts`, new `apps/web/src/lib/api/members.ts`, `apps/web/src/lib/auth/loaders.ts`, `apps/web/src/router.tsx`, `apps/web/src/components/shell/nav-config.ts`, `apps/web/src/lib/tenant/TenantProvider.tsx`, new `apps/web/src/pages/OrganizationMembersPage.tsx` and focused web tests. Directory UI contains no actions from nodes 02–05 and no nonfunctional controls.
- **NON-GOALS:** invitation, role mutation UI, revoke UI, leave mutation, migration, new audit report
- **CONTRACTS:** paginated list endpoint/output/errors, exact `total`, `limit`/`offset` bounds, page URL, tenant key and permission route from `../spec.md`; later nodes consume these types and do not create a second cache convention
- **VERIFY:** focused API list HTTP and real DB cases for A-only/B-only/A+B, 49/50/51/101 members, invalid limits/offsets, offset beyond the last page, owner/admin/viewer/auditor/non-member, existing/nonexistent Organization and switch/revoke interleaving; focused web page/loader/shell cases for pending, success, failure, retry, denied, displayed total, first/next/previous page, disabled boundaries, identity mismatch and delayed A read after A→B; browser keyboard/narrow/200% zoom smoke for directory and pagination; inspect response/log/audit and runtime grants/RLS boundary
- **PROOF:** per-role/page status, code, body and fixture DB rows for each tenant; page row count and exact total; response/log redaction; lost membership cannot read again; DOM state, scope and focus before/after page and tenant switches; browser observations marked passed, failed or not run
- **COVERS:** AC-01, AC-02 (list authorization), AC-03, AC-04 (list), AC-16 (directory), AC-17 (directory)

## Handoff

Publish the list/query schemas, tenant query key, loader behavior and member-page composition boundary. Nodes 02 and 03 may start only after this node is merged and the handoff is accepted.
