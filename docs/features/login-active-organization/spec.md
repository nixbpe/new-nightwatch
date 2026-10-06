# Login active organization Technical Spec

Server resolve valid organization ผ่าน verified bootstrap ก่อน tenant app usable โดยคง valid last-active และเลือก membership สำรองแบบ deterministic

| Field | Value |
| --- | --- |
| Feature | issue #82, [Acceptance matrix](feature.md#acceptance-matrix), `acceptanceVersion` issue-82-AC-1 |
| Status | Approved |
| Approved by user | 2026-10-06, อนุมัติข้อเสนอและ spec ใน conversation |
| Start authorization | 2026-10-06, ผู้ใช้สั่งเริ่ม implement issue #82 |
| `COMMIT_MODE` | owned-slice |
| `STOP_AT` | merge-ready |

## Source และขอบเขต

Source: [issue #82](https://github.com/nixbpe/new-nightwatch/issues/82), Draft เดิม P1–P8 และ user approval ของ recommended decisions ทั้งสี่ข้อ การอนุมัติครอบคลุมการบันทึก Acceptance matrix ตามข้อเสนอเดิม ไม่เพิ่ม product requirements

References: [Architecture](../../architecture.md), [Authentication behavior](../../ref/authentication.md), [App shell](../../ref/shell-structure.md), [Design system](../../design-system.md), [Quality gates](../../../scripts/quality/README.md)

Non-goals: เปลี่ยน membership/admission policy, สร้าง organization/membership อัตโนมัติ, เปลี่ยน session lifetime/trust-device, widen notification scope, replay dispatch, owner-role backfill, แก้ Worker/monitor delivery, merge หรือ deploy

## Gap และ root cause

Login/context ไม่มี server initialization เมื่อ last-active เป็น null ขณะที่ TenantProvider/workspace loader แสดง membership แรกเป็น fallback Notifications ใช้ server-confirmed selection และอ่าน account-only เมื่อ selection null บัญชีองค์กรเดียวไม่มี switch action ที่ trigger PATCH

Owning sources: `apps/api/src/me/service.ts`, `apps/api/src/me/routes.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/notifications/service.ts`, `apps/api/src/organization-notifications/members.ts`, `apps/web/src/lib/auth/loaders.ts`, `apps/web/src/lib/tenant/TenantProvider.tsx`, `apps/web/src/pages/AcceptInvitationPage.tsx`

## Contracts

### Resolution และ lifecycle (proposal)

หัวข้อนี้คงชื่อเดิมเพื่อรักษาลิงก์ ข้อเสนอได้รับอนุมัติแล้ว

1. ใช้ `auth.getSession` ผ่าน boundary เดิมและ `requireVerifiedSession` ตรวจ final session/email verification ห้ามรับ user id จาก browser
2. เลือกเฉพาะ session user's membership ที่มี organization จริงและ role ที่ `normalizeOrganizationRole` รองรับ
3. คง `user.last_active_tenant_id` เมื่อยัง valid; null/stale เลือก `member.created_at ASC, organization.id ASC` ไม่เลือกตามชื่อ role priority หรือ URL
4. ตรวจ membership และ persist user last-active กับ `session.active_organization_id` ทุก session ของ user ใน transaction เดียวกัน Selection เป็น account-global ไม่สร้างสิทธิ์เพิ่ม
5. ไม่มี valid membership: authenticated admission/account-only, last-active/mirrors null, ใช้ account settings/logout และ invitation continuation ได้ ห้าม tenant operation หรือสร้าง org ปลอม
6. Boundary ที่อนุมัติคือ verified bootstrap ก่อน tenant app usable ไม่จำเป็นต้อง persist ก่อน raw auth success response ไม่เพิ่ม final-auth hook ที่ไม่จำเป็น
7. ใช้ boundary เดียวกันหลัง final login, trusted-device/TOTP/recovery completion และกับ existing null/stale sessions โดยไม่ logout/backfill Session refresh/rotation ไม่ reset valid selection
8. หลัง revoke/self-leave invalidate context แล้ว re-bootstrap เลือก membership ที่เหลือหรือ admission; membership checks ยังคงทุก operation
9. Invitation acceptance คง explicit switch ไปองค์กรที่รับเชิญตาม flow เดิม ไม่ auto-accept และไม่ใช้ pending invitation เป็น membership ตรวจ native acceptance mirror drift ก่อน tenant use

### API และ compatibility (proposal)

- คง `GET /api/me/context` read-only และ `PATCH /api/me/active-org` explicit membership-checked switch
- เพิ่ม `POST /api/me/resolve-active-org` ไม่มี selection input ใช้ verified session คืน shared `MeContextResponse` ตรวจ response ตาม WEB-01/WEB-02 และ regenerate client
- POST เป็น idempotent initialization ส่ง credentials และผ่าน origin/CSRF protection ตาม application conventions; application errors ใช้ REQ-03/REQ-05 และ generic 5xx เมื่อ resolve ล้มเหลว
- Zero membership คืน organizations ว่างและ last-active null แยกจาก failure
- แม้ user selection valid ต้อง sync mirror drift โดยไม่ switch; cached session field ไม่เป็น authorization authority
- Native Better Auth endpoints คง AUTH-04; ไม่เปลี่ยน library/session/error policy
- Resolver และ context response ใช้ consistent transaction snapshot ไม่ใช้ parallel independent reads เป็น atomicity proof

### MFA intermediate session safety

Pinned Better Auth 1.6.23 สร้าง credential session ก่อน two-factor after hook; challenge ค้างถูกลบ session/cookie Trusted-device branch มี ordering ต่างกัน NODE-1 ต้องยืนยัน pinned ordering และ completion paths จาก source และ real regressions

ห้าม unconditional `databaseHooks.session.create` เปลี่ยน account-global selection หรือ session เครื่องอื่นก่อน MFA สำเร็จ Password-only/pending/failed/expired attempt ต้องไม่เปลี่ยน account selection Verified bootstrap หลัง final session เป็น approved minimum barrier และ resolver failure ต้องปิด tenant use

### Concurrency และ lock protocol

- Concurrent initializers converge โดยไม่ overwrite valid selection
- Explicit switch ที่ commit ก่อน initializer final validation ชนะ initializer ต้อง reread account selection ภายใต้ lock
- Concurrent explicit switches serialize ที่ account row ผล commit ตามหลัง authoritative ไม่รับประกัน cross-device last-click-wins
- New session insert แข่ง switch ต้อง converge selection ล่าสุดก่อน tenant use ห้ามพึ่ง update-all-sessions ที่พลาด insert ภายหลัง
- Revoke/leave ชนะ resolver ห้าม assign removed org; selection ชนะก่อน revoke การถอนต้องล้าง mirrors ก่อน tenant use ถัดไป
- Response snapshot อาจเก่าหลังอีก switch commit ต้อง preserve publication claims/scope-change refresh ห้ามข้อมูล org เก่าเข้า view ใหม่

Lock order: organization row → `notification-membership:<organizationId>` advisory lock → membership row → user row → session mirrors ตาม owning services ห้ามถือ user lock แล้วขอ organization lock

Pre-discover user-bound candidate แล้ว lock ตาม order; reread account state ถ้าเปลี่ยน candidate ไป org อื่น rollback แล้ว bounded retry ห้ามขอ org ที่สองหลัง user lock Zero-candidate path ไม่ขอ org lockหลัง user lock ต้อง revalidate discovery/account state ให้ concurrency outcomes ถูกต้อง Exhausted retry คืน safe failure ไม่เปิด tenant app

### Security / notification non-widening

Auth tables ใช้ DB-06/DB-07 ผ่าน runtime non-owner NOBYPASSRLS Membership และ per-operation role ตรวจทุก use Notification scope คง account + server-resolved active org; null คง account-only ไม่ enumerate ทุก membership และไม่เชื่อ URL/body/UI fallback

Preserve completed dispatch/recipient/expiration predicates, DB-01/DB-04/DB-10, `INBOX_SCOPE_CHANGED` และ mutation scope checks ไม่ย้าย resolver ไป Worker ไม่ replay notifications Revoke/leave ล้าง selection ใน transaction เดิม ไม่คืนสิทธิ์ removed org

ห้าม log credentials/session/invitation/recovery tokens หรือ protected org details ใน denial/error

### Web state และ cache

- Verified session → server resolution → context publication → tenant prefetch/render; parent/child loaders ที่ขนาน await barrier เดียวกันต่อ identity
- TenantProvider/workspace ไม่ใช้ first-membership fallback เป็น usable activeOrg; activeOrg/serverActiveOrgId/header/notification badge/popover/inbox อ่าน server-confirmed context เดียวกัน
- Unresolved แสดง skeleton; failure แสดง error/retry ไม่แสดง empty tenant inbox; zero membership ใช้ admission/account-only state พร้อม logout/invitation continuationและ account settings
- ใช้ existing states/design components ก่อนเพิ่ม UI; preserve keyboard/focus และทั้ง themes ตาม design system ไม่มี shell redesign
- Preserve WEB-03/WEB-04, identity cache และ publication claims; cancel/remove old tenant queries เมื่อ scope เปลี่ยน ห้าม static cached context ข้าม required fresh bootstrap
- Preserve AUTH-05 return-to และ invitation continuation Bookmark ตรวจ membership และแสดง URL org ใน breadcrumb ไม่ implicit switch ตาม URL
- One-membership cold login initialize ได้โดยไม่ต้องมี switch action

## Proposed criteria (ยังไม่อนุมัติ)

หัวข้อนี้คงชื่อเดิมเพื่อรักษาลิงก์ P1–P8 ได้รับอนุมัติและ map แบบหนึ่งต่อหนึ่งไป AC-01–AC-08 ใน [Feature](feature.md#acceptance-matrix) แล้ว Feature เป็น acceptance source of truth

| Draft ID | Approved ID | Owning Task |
| --- | --- | --- |
| P1 | AC-01 | NODE-1, NODE-2, NODE-3 |
| P2 | AC-02 | NODE-1, NODE-2, NODE-3 |
| P3 | AC-03 | NODE-1, NODE-2, NODE-3 |
| P4 | AC-04 | NODE-1, NODE-3 |
| P5 | AC-05 | NODE-1, NODE-2, NODE-3 |
| P6 | AC-06 | NODE-1, NODE-2, NODE-3 |
| P7 | AC-07 | NODE-2, NODE-3 |
| P8 | AC-08 | NODE-1, NODE-2, NODE-3 |

## Impact assessment

ใช้ schema/nullable columns เดิม ไม่คาดว่ามี migration จุดเสี่ยงคือ MFA ordering, transaction lock graph, snapshot/mirror races และ browser publication/cache ไม่เพิ่ม latency/availability targets ที่ผู้ใช้ไม่ได้กำหนด

## Design decisions

ผู้ใช้อนุมัติ 2026-10-06: authenticated admission/account-only เมื่อไม่มี membership; verified bootstrap ก่อน tenant usable; deterministic fallback และ account-global semantics; invitation acceptance คง explicit switch ไป invited org

Nullable fields ยังจำเป็นสำหรับ admission/revocation Client-only fallback ไม่ใช่ authority และ null notification scope ไม่ถูก widen

## Tasks

งาน multi-seam ใช้ serial exclusive owners บน working branch เดิม ไม่มี concurrent writers Product Owner เป็นเจ้าของ `feature.md` Technical Lead เป็นเจ้าของ `spec.md` เท่านั้น Integration owner มี sole push/PR authority จาก implement-issue และต้องผ่าน parent acceptance/local gates ก่อน

| Task | Depends on | Integration owner of shared files |
| --- | --- | --- |
| NODE-1 | Acceptance frozen, user approval | software-engineer: API/auth/me/server tests/contracts |
| NODE-2 | NODE-1 contract/proof accepted | software-engineer: web/client/generated output/E2E |
| NODE-3 | Writers stopped, independent review | software-engineer: scoped integration, sole push/PR owner |

### NODE-1 Server resolver และ lifecycle integration

- **OWNER:** software-engineer
- **READY:** Parent confirms frozen acceptance and start; inspect MFA/lock graph before edits
- **OUTCOME:** Membership-checked resolver converge user/session mirrors before tenant use
- **SOURCE:** Contracts และ Feature AC-01–AC-06, AC-08
- **INVARIANTS:** verified final session, org-first lock order, runtime role, GET read-only, notification non-widening
- **FILES:** `apps/api/src/me/`, necessary `apps/api/src/auth/` integration/tests, `packages/api-contract/src/auth.ts`, server DB/auth/notification/membership regression tests; no Worker change
- **NON-GOALS:** Source exclusions; web client generated output owned NODE-2
- **CONTRACTS:** POST, shared response, resolver/explicit-switch lock graph; native acceptance checked before bootstrap
- **VERIFY:** Focused API lint/typecheck/unit, isolated real DB/RLS/auth/MFA/races and notification negative suites; no ambient data-writing DB
- **PROOF:** Pinned hook ordering, observable before/after regression, deterministic fallback/valid retention/no-member/drift, switch/new-session/revoke/leave races, MFA no-mutation, runtime RLS negative results; commands/SHA/gaps
- **COVERS:** AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-08

### NODE-2 Server-confirmed tenant bootstrap และ shell

- **OWNER:** software-engineer
- **READY:** NODE-1 stopped and parent accepts contract/proof
- **OUTCOME:** Tenant gate and header/inbox server-confirmed scope with cache isolation
- **SOURCE:** Web state และ cache, API, Feature AC-01–AC-03, AC-05–AC-08
- **INVARIANTS:** WEB-01–WEB-04, AUTH-05, CMP-01, publication claims
- **FILES:** `apps/web/src/lib/tenant/`, `lib/auth/`, `lib/api/me.ts`, generated API types, shell/admission/invitation consumers, web tests and `e2e/tests/` scoped scenarios
- **NON-GOALS:** Shell redesign, bookmark implicit switch, server edits without transfer
- **CONTRACTS:** Shared identity-bound bootstrap and loading/error/admission states
- **VERIFY:** Focused web lint/typecheck/unit/codegen and authenticated E2E on task-owned isolated environment
- **PROOF:** Single-member cold login/existing session reload, header/inbox match, no tenant use on failure/admission, invitation/account continuation, scope/identity stale response protection, keyboard/theme evidence
- **COVERS:** AC-01, AC-02, AC-03, AC-05, AC-06, AC-07, AC-08

### NODE-3 Integrated verification

- **OWNER:** software-engineer; Technical Lead decides findings/binding/acceptance
- **READY:** Writers stopped, final independent code review and parent disposition
- **OUTCOME:** Exact-head gates and one unmerged PR after local pass; PR CI observed pass before merge-ready
- **SOURCE:** Feature acceptance, Quality gates, implement-issue and PR template
- **INVARIANTS:** No skipped required DB/RLS/security, review source repairs independently, no release/merge
- **FILES:** Scoped integration fixes/transferred ownership only; no edit spec/feature without parent
- **NON-GOALS:** Unrelated gate repairs/shared infrastructure/dependent work
- **CONTRACTS:** Parent accepts independent final/delta review and publication candidate
- **VERIFY:** All focused/integration/smoke checks plus full gates below and required PR CI
- **PROOF:** Exact SHA, per-AC command outcomes/log references, scanner coverage, review findings dispositions, PR/CI state and unmerged confirmation
- **COVERS:** AC-01–AC-08

## Integrated verification

Required local gates: `bun run validate`, `COVERAGE_GATE=1 bun run test:coverage`, `bun run build`, `bun run security`, `bun run codegen:check`, applicable `bun run test:integration` and authenticated E2E per [Quality gates](../../../scripts/quality/README.md)

DB proof: real PostgreSQL runtime non-owner NOBYPASSRLS and separate owner URL; run-unique fixtures/owned cleanup, barrier-controlled races (no sleeps as ordering proof), assert user selection/session mirrors and post-race permission. Do not use ambient DB or create shared resources without authority; inspect documented isolated environment and escalate missing access

Browser matrix: cold single-member null, valid/stale last-active, no-member/pending invitation, MFA TOTP/recovery/trusted device, existing null session reload, two sessions switch during inbox operation, revoke/self-leave with/without remaining membership, failure/retry, bookmarked route

Current execution results: not verified; design/approval is not runtime proof. Detailed handoffs/logs use managed artifacts; final PR records exact-head per-AC evidence

## Open decisions

Product decisions: None. Implementation readiness waits for parent acceptance freeze and mandatory hook/lock inspection; runtime environment/access unknown until inspected. Report missing environment as blocker, never waive required checks

## Revisions

| Date | Change | Approved by user | `acceptanceVersion` |
| --- | --- | --- | --- |
| ไม่ระบุ | Initial Draft proposal from source `292ce19` | Not yet | ไม่มี |
| 2026-10-06 | Approve P1–P8, four recommended decisions, verified-bootstrap contract and start issue #82; record AC mapping and serial ownership | 2026-10-06 conversation | issue-82-AC-1 |
