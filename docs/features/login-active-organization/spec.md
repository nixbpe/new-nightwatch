# Login active organization Technical Spec

หลัง authenticated login ให้ server resolve valid organization ก่อนใช้ tenant app โดยคง valid last-active และเลือก membership สำรองแบบ deterministic

| Field | Value |
| --- | --- |
| Feature | ยังไม่มี Feature ที่อนุมัติ, ไม่มี `acceptanceVersion` หรือ approved AC |
| Status | Draft proposal |
| Approved by user | Not yet |
| Start authorization | None |
| `COMMIT_MODE` | none |
| `STOP_AT` | Draft proposal เท่านั้น, ยังไม่ใช่ implementation `review-ready` |

## Source และขอบเขต

Requirement ที่ผู้ใช้ยืนยัน: “ถ้า login เข้ามาแล้ว ต้อง assign organization id ให้ก่อน”

เอกสารนี้เป็นข้อเสนอ design ตามคำขอเฉพาะ แม้ input gate ของ technical-spec ยังขาด Feature/Acceptance matrix จึงไม่ freeze acceptance และไม่อนุญาตเริ่ม implementation ตัวเลข P1–P8 ด้านล่างเป็น proposed criteria สำหรับพิจารณาเท่านั้น ไม่ใช่ approved AC

ฐานตรวจ source: `main` HEAD `292ce19` อ่าน auth, admission, session, tenant UI และ notification scope ไม่ตรวจ DB หรือรัน runtime tests ในงานนี้

References: [Architecture](../../architecture.md), [Authentication behavior](../../ref/authentication.md), [App shell](../../ref/shell-structure.md), [Design system](../../design-system.md), [Quality gates](../../../scripts/quality/README.md)

Non-goals: เปลี่ยน membership/admission policy, สร้าง organization อัตโนมัติ, เปลี่ยน session lifetime หรือ trust-device policy, widen notification scope, replay dispatch, backfill DB ด้วย owner role, แก้ worker/monitor หรือ release

## Gap และ root cause

| จุด | Evidence | Gap / impact |
| --- | --- | --- |
| Login session | `apps/api/src/auth/index.ts:200` `databaseHooks` มีเฉพาะ account-create reset-password marker | ไม่มี application initialization สำหรับ last-active เมื่อสร้าง authenticated session |
| Context read | `apps/api/src/me/service.ts` `getMeContext`, `toContext`, `MEMBERSHIPS_SELECT` | อ่าน membership กับ last-active แยก query, คืน null เมื่อ last-active ไม่มี/ไม่ valid, ไม่ persist fallback |
| Explicit selection | `apps/api/src/me/service.ts` `setActiveOrganization` | PATCH เท่านั้นที่เขียน user และ session mirrors ทั้งบัญชีใน transaction |
| Tenant view | `apps/web/src/lib/tenant/TenantProvider.tsx` `activeOrg`, `serverActiveOrgId` | UI เลือก membership แรกเมื่อ server null แต่ inbox ใช้ server-confirmed id จึงแสดง scope ต่างกัน |
| Loaders | `apps/web/src/lib/auth/loaders.ts` `workspaceLoader`, `notificationsLoader`, `prefetchMeContext` | workspace prefetch ใช้ fallback แต่ notifications ใช้ null, cache `staleTime: "static"` ไม่ใช่ initialization barrier |
| One membership | `apps/web/src/components/shell/OrgSwitcher.tsx` `canSwitch` | มี 1 membership แสดงชื่อองค์กรแต่ไม่มี switch button จึงไม่มี PATCH จากการเลือกปกติ |
| Notification scope | `apps/api/src/notifications/service.ts` `resolveActiveScopeOnClient`, `withResolvedScope`, `accountRows`, `tenantRows` | ใช้ user last-active, ตรวจ membership และ lock; null อ่าน account scope เท่านั้น, session mirror ไม่ใช่ authority |
| Admission | `apps/api/src/auth/invitations.ts` `assertInvitationAdmitsSignup`, `apps/api/src/auth/index.ts` organization options | signup ผ่าน live invitation ไม่ได้แปลว่ามี accepted membership แล้ว; user สร้างองค์กรเองไม่ได้ |
| Provisioning | `apps/api/src/operator/provision-organization.ts` `provisionOrganization` | operator สร้าง org และ pending owner invitation, ไม่ได้ assign org ให้ทุก login |
| Invitation acceptance | Better Auth `1.6.23` `dist/plugins/organization/routes/crud-invites.mjs` `acceptInvitation`; `apps/web/src/pages/AcceptInvitationPage.tsx` `accept` | plugin สร้าง member และ set active เฉพาะ session, browser ตามด้วย application PATCH เพื่อ sync account-global; native caller อาจยังมี mirror drift |
| Revocation / self-leave | `apps/api/src/organization-notifications/members.ts` `revokeOrganizationMember`, `leaveOrganization` | ล้าง last-active และ session mirrors ของ org ที่ถูกถอนใน transaction, ไม่เลือก org สำรอง |

ข้อเท็จจริงจากผู้ใช้ (ไม่ได้ query ซ้ำในงานนี้): user `53c58f1a-8b00-4088-b8c9-64295fd12b84` เป็น owner ของ org `a205829e-62b1-4c64-9eac-1a516c529fab` แต่ `last_active_tenant_id` และ `session.active_organization_id` เป็น NULL; `MONITOR_DOWN` ของ monitor `4eff4525-9a5d-49dc-a610-4ca8a789f0b5` มี unread inbox และ dispatch `completed` แล้ว

Root cause ของอาการนี้: ไม่มี server initialization เมื่อ login/context เป็น null ขณะที่ browser fallback แสดง org แรก Notification delivery ที่ผู้ใช้ให้ตรวจแล้วไม่ใช่หลักฐานว่า active scope ถูกเลือก ปัญหาที่เห็นอยู่ใน selection/read boundary จึงไม่เสนอ resend หรือให้ null อ่านทุก tenant

## Contracts

### Resolution และ lifecycle (proposal)

1. ใช้ `auth.getSession` ผ่าน boundary เดิมและ `requireVerifiedSession` ยืนยัน final authenticated session กับ email verification ก่อน resolution ห้ามรับ user id จาก browser
2. Server resolver ใช้ membership ของ session user ที่มี organization จริงและ role ที่ `normalizeOrganizationRole` รองรับเท่านั้น
3. คง `user.last_active_tenant_id` เมื่อยัง valid ไม่ให้ login ใหม่หรือ session refresh reset ไป org แรก
4. ถ้า null/stale เลือกตาม `member.created_at ASC, organization.id ASC` เช่น ordering เดิมของ `MEMBERSHIPS_SELECT` ไม่ใช้ชื่อ org, role priority หรือ URL เป็น selection authority
5. ใน transaction เดียวกันตรวจ membership อีกครั้งแล้ว persist user last-active และ `session.active_organization_id` ของทุก session ของ user รวม session ใหม่ ให้เป็น account-global selection เดียวกัน ไม่สร้าง membership
6. ไม่มี valid membership: คง null และไม่อนุญาต tenant app, เสนอ admission state ที่มี invitation continuation และทางกลับ/logout แยกจาก loading/failure การคง authenticated account access หรือปฏิเสธ login เป็น open product decision
7. Resolve หลัง final login รวม trusted-device login, TOTP และ recovery-code completion; session refresh/rotation คง selection เดิม ไม่ก่อ implicit switch
8. Existing null/stale sessions ไม่บังคับ logout หรือ bulk backfill: resolve บน authenticated bootstrap ก่อน tenant use และหลัง context invalidation จาก revoke/self-leave ใช้ resolver เดียวกับ login
9. Invitation continuation เข้า acceptance flow ได้แม้ยังไม่มี membership หลัง accept สำเร็จ bootstrap อีกครั้ง; ไม่ auto-accept invitation และไม่ใช้ pending invitation เป็น membership Explicit selection ที่ acceptance flow ทำอยู่ต้องแยกจาก fallback initialization

Smallest viable implementation proposal: resolver หนึ่งชุดบน server, final-auth integration, bootstrap สำหรับ existing sessions และ server-confirmed shell gate โดยใช้ schema/columns เดิม ไม่มี schema migration ที่คาดว่าจำเป็น

### API และ compatibility (proposal)

- คง `GET /api/me/context` เป็น read-only และ `PATCH /api/me/active-org` เป็น explicit membership-checked switch
- เสนอ `POST /api/me/resolve-active-org` ไม่มี selection input, ใช้ verified session, คืน `MeContextResponse` เดิม รวม organizations และ last-active ที่ resolve แล้ว ใช้ REQ-03/REQ-05 กับ 401/403 boundary เดิม และ generic 5xx เมื่อ resolve ล้มเหลว
- POST เป็น idempotent initialization ไม่ใช่ explicit switch; authenticated bootstrap ต้องรอผลก่อน prefetch/render tenant content ส่ง credentials และใช้ origin/CSRF protection ตาม application conventions ต้องตรวจ boundary ก่อน implementation
- ผล zero membership แยกจาก error ด้วย organizations ว่างและ last-active null ตาม schema เดิม หาก product เลือก deny login ต้องแก้สัญญานี้ก่อนอนุมัติ
- Session mirror drift แม้ user last-active valid ต้อง sync โดยไม่เปลี่ยน selection ไม่เชื่อ cached session field สำหรับ authorization
- Native Better Auth endpoints คง error format AUTH-04 ต้องกำหนด final-auth hook ที่ตรวจ session จริงและคืน error ปลอดภัยเมื่อ resolver ล้มเหลว ไม่อ้างว่า hook หลาย transaction ทำให้ auth กับ selection atomic โดยอัตโนมัติ
- OpenAPI operation ใหม่ต้องมี shared schema, runtime validation, generated web client และ `codegen:check` ตาม WEB-01/WEB-02

### MFA intermediate session safety

Better Auth `1.6.23` ที่ติดตั้งใน `node_modules/.bun/better-auth@1.6.23+0c3f829e47e22b42/node_modules/better-auth/dist/plugins/two-factor/index.mjs:190` สร้าง credential session ก่อน after hook; เมื่อ challenge ค้าง plugin ลบ session/cookie และ `setNewSession(null)` Trusted-device branch คืนก่อนการลบ session

ห้ามใช้ `databaseHooks.session.create` แบบ unconditional เพื่อเขียน account-global last-active หรือ session ของเครื่องอื่น เพราะ hook อาจเห็น intermediate credential session ก่อน MFA เสร็จ การ resolve ในช่วงนี้ทำให้ password-only attempt เปลี่ยน selection ของ session ที่ authenticated อยู่แล้วได้

Task design spike ต้องยืนยัน hook ordering ของ pinned version และ completion paths ก่อนเลือก final integration point ถ้า after hook ไม่รับประกันว่า MFA สำเร็จ ให้ใช้ verified bootstrap boundary หลัง final session เป็น minimum barrier และคืน product decision ว่า raw auth success จำเป็นต้อง persist ก่อน response หรือยอมให้ tenant app bootstrap เป็น boundary ไม่ตัดสิน timing นี้แทนผู้ใช้ ห้ามเปิด tenant app เมื่อ resolver fail

### Concurrency และ lock protocol

Selection เป็น account-global ตามโค้ดเดิม ไม่เปลี่ยนเป็น per-session ในงานนี้ ข้อเสนอ accepted outcomes:

- สอง login/resolve พร้อมกันเลือกผลเดียวเมื่อ membership snapshot เท่ากัน การ initialize ซ้ำไม่ overwrite valid selection
- Explicit switch ที่ commit ก่อน initializer final validation ต้องชนะ initializer; initializer reread user state ภายใต้ lock แล้วใช้ valid selection ล่าสุด
- Switch หลาย session ไปคนละ org serialize ที่ account row; commit ที่ตามหลังเป็น authoritative selection ทุก mirrors ต้องตรงกันหลัง operation จบ ไม่มีข้อตกลง last-click-wins ข้ามเครื่อง
- New session insert แข่งกับ account-global switch: session ใหม่ต้อง sync selection ล่าสุดก่อน tenant use ห้ามพึ่ง update-all-sessions ที่อาจพลาด row ซึ่ง insert ภายหลัง
- Revoke/self-leave แข่งกับ resolver/switch: หาก revoke ชนะ ห้าม assign removed org; หาก selection ชนะก่อน revoke การถอนต้องล้าง mirrors ก่อน tenant operation ถัดไป Revalidate membership ทุก tenant use เสมอ
- Response/cache อาจล้าหลัง switch ที่ commit หลัง response snapshot ต้องใช้ existing publication claims, scope-change handling และ refresh ไม่รับข้อมูล org เก่าเข้า view ใหม่

Lock order ที่ต้อง preserve: organization row → `notification-membership:<organizationId>` advisory lock → membership row → user row → session mirrors ตาม owning services ห้ามเพิ่ม user-first lock แล้วขอ organization lock เพราะ notification/revoke ใช้ org-first และอาจ deadlock

Resolver ต้อง pre-discover candidate ด้วย user-bound membership, lock candidate ตามลำดับนี้ แล้ว reread/lock account selection หาก selection เปลี่ยนไป org อื่นให้ rollback และ resolve ใหม่โดย bounded retry ห้ามขอ lock org ที่สองหลังถือ user lock Scope null path ที่ไม่มี candidate ต้องไม่ขอ organization lockหลังถือ user lock การ resolve final result กับ context response ต้องได้ consistent snapshot ไม่ reuse `Promise.all` read เป็น proof ของ atomicity

### Security / notification non-widening

- Auth tables ใช้ DB-06/DB-07, runtime role non-owner `NOBYPASSRLS`; การเลือก org ไม่ให้ permission เพิ่ม Membership และ per-operation role ถูกตรวจทุก use
- Notification scope ยังเป็น account + server-resolved active organization เท่านั้น Null เป็น account-only จนมี valid assignment ไม่ enumerate notifications ของทุก membership และไม่เชื่อ URL/body/UI fallback
- คง completed dispatch, recipient, membership, expiration predicates และ DB-01/DB-04/DB-10 context/RLS ใน `notifications/service.ts` ห้ามย้าย resolver ไป worker หรือให้ worker invent org สำหรับ account jobs
- คง `INBOX_SCOPE_CHANGED` และ mutation scope checks เพื่อไม่ mark-read org ผิดเมื่ออีก session switch Query key และ request hints ต้องตรงกับ server-confirmed scope
- Revoke/self-leave ยังคงล้าง active selection ใน transaction เดิม จากนั้น bootstrap เลือก membership ที่เหลือหรือ admission state ไม่มีการคืนสิทธิ์ org ที่ถูกถอน
- ห้าม log credentials, session tokens, invitation tokens, recovery codes หรือ protected org details ใน error/audit denial

### Web state และ cache

- Loaders กำหนด verified-session → server resolution → context publication → tenant prefetch ก่อน tenant app usable โดย parent/child loaders ที่รันขนานต้อง await barrier เดียวกันต่อ identity
- TenantProvider และ workspace loader ไม่ใช้ first-membership fallback เป็น usable activeOrg อีกต่อไป activeOrg กับ `serverActiveOrgId` มาจาก server result เดียวกัน
- Unresolved/loading แสดง skeleton; resolver error แสดง failure และ retry; zero membership แสดง admission state ที่ต้องอนุมัติ ห้ามแสดง empty inbox ว่าไม่มี tenant notifications เมื่อ resolution fail (CMP-01)
- Switcher, account menu, breadcrumb และ notification badge อ่าน context เดียวกัน One-membership case ไม่ต้องใช้ switch button เพื่อ initialize
- Preserve WEB-03/WEB-04, cancel/remove old tenant queries และ publication claims เมื่อ identity/scope เปลี่ยน ไม่ใช้ `staleTime: "static"` ข้าม bootstrap ที่ต้อง fresh
- Return-to ใช้ AUTH-05 และ invitation continuation เดิม Bookmark ต่าง org ยังต้องตรวจ membership และแสดง URL org ใน breadcrumb ตาม shell reference ไม่ implicit switch ตาม URL
- ถ้ามี admission UI ใหม่ต้องผ่าน UX flow approval, keyboard/focus, loading/error/permission states และทั้ง themes ตาม design system ไม่มี mockup ที่ดูเหมือนข้อมูลจริง

## Proposed criteria (ยังไม่อนุมัติ)

| Proposal | Scenario / expected outcome | Verification ที่เสนอ |
| --- | --- | --- |
| P1 | Login มี valid remembered membership แล้วคง id; null/stale เลือก deterministic fallback และ persist user + sessions ก่อน tenant usable | Auth/me DB tests, cold login E2E |
| P2 | ไม่มี valid membership ไม่ assign org ปลอม, pending invitation ยังไป acceptance ได้ | Admission/signup/acceptance tests, product decision |
| P3 | Existing null session และ mirror drift converge โดยไม่ logout; GET context read-only | Me integration tests และ reload E2E |
| P4 | MFA pending/failed/expired ไม่เปลี่ยน selection ของบัญชีหรือ session อื่น; TOTP/recovery/trusted-device สำเร็จ resolve ได้ | Real Better Auth DB integration tests |
| P5 | Concurrent login/switch/new-session/revoke/leave ไม่มี deadlock, stale overwrite หรือ removed-org authorization | Barrier-controlled DB races, final user/session state assertions |
| P6 | Badge/popover/inbox scope ตรง header; null/account-only ไม่ widen; foreign recipient/tenant deny ภายใต้ runtime RLS | Notification service/routes DB tests และ negative role/RLS tests |
| P7 | Unresolved/error/admission ไม่ prefetch/render tenant, stale response ไม่ republish หลัง identity/scope change | TenantProvider/loaders tests, switch/multi-tab E2E |
| P8 | Session duration, fresh-auth, cookie, return-to และ invitation restrictions คงเดิม | Existing auth regression suites, security/codegen gates |

## Impact assessment

| Area | Impact | Change ที่เสนอ / risk |
| --- | --- | --- |
| Auth/Better Auth integration | สูง | Final-session ordering, MFA intermediate state, session rotation; spike และ DB proof ก่อน integration |
| Me service/routes | สูง | Transactional resolver และ POST; shared explicit switch lock protocol, context snapshot |
| Membership lifecycle | กลาง | Preserve revoke/leave cleanup, bootstrap re-resolution, no admission bypass |
| Invitations/provisioning | กลาง | Acceptance mirror drift และ zero-member continuation; ไม่แก้ operator provisioning |
| Notifications | กลาง | Scope ควรเปลี่ยนจาก null เป็น valid org หลัง bootstrap; ไม่เปลี่ยน delivery/ledger หรือ widen query |
| Web shell/loaders | สูง | ลบ usable fallback, async bootstrap barrier, cache cancellation/publication |
| Contract/client | กลาง | เพิ่ม operation, reuse response schema, regenerate client |
| Database/RLS/schema | ไม่มี schema change ที่คาดไว้, transaction impact สูง | ใช้ nullable columns เดิม, runtime RLS regression และ lock races ต้องพิสูจน์ |
| Worker/Redis/resources | ไม่มี planned change | ไม่ enqueue ใหม่, ไม่ backfill/replay หรือเพิ่ม infrastructure |
| Performance/operations | ยังไม่วัด | เพิ่ม membership/lock work ต่อ final login/bootstrap, idempotent path ไม่เขียน user ซ้ำเมื่อไม่จำเป็น; ไม่มี latency target ที่อนุมัติ |
| Tests/documentation | สูง | Auth/me/UI expectations ที่เดิมยอม null และ first fallback ต้องปรับเมื่อ criteria approved |

## Design decisions

ข้อเสนอคง account-global last-active เป็น authority เพื่อ scope header/inbox ตรงกัน และ reuse deterministic membership ordering เดิม Nullable fields ยังจำเป็นสำหรับ admission/revocation ไม่เสนอ NOT NULL migration

Client-only PATCH fallback ไม่พอ: single-member switcher ไม่ trigger, native callers กับ MFA lifecycle ยังขาด boundary Blind session-create hook เสี่ยงเปลี่ยน account state ก่อน MFA เลือกทุก membership เพื่อให้เห็น notification เป็นการ widen scope และขัด isolation

ไม่มี runtime verification, latency estimate หรือ deployment approval ใน Draft นี้

## Tasks

ทุก task เป็น proposed plan, blocked จนมี Feature/Acceptance matrix, spec approval และ separate start authorization COVERS ใช้ P-label ชั่วคราว ต้อง map approved AC ภายหลัง

| Task | Depends on | Integration owner of shared files |
| --- | --- | --- |
| PLAN-1 | Product decisions และ approved Feature | Technical Lead |
| PLAN-2 | PLAN-1, approved contracts | software-engineer: auth/me services และ server lock protocol |
| PLAN-3 | PLAN-2 API contract | software-engineer: web context/loaders/client |
| PLAN-4 | PLAN-2 และ PLAN-3 หยุดเขียน | Technical Lead: integrated verification coordination |

### PLAN-1 Final-auth boundary spike และ product contract

- **OWNER:** Technical Lead (design), software-engineer (spike หลัง start authorization)
- **READY:** Feature/acceptance input และ product timing/zero-member decisions อนุมัติ
- **OUTCOME:** เลือก final-auth integration ที่ไม่เห็น intermediate MFA session และยืนยัน lock graph
- **SOURCE:** Resolution, MFA intermediate session safety, Open decisions
- **INVARIANTS:** AUTH-01, DB-06, ไม่มี mutation ก่อน final authentication
- **FILES:** `apps/api/src/auth/index.ts`, `auth-origin-intents.ts`, pinned Better Auth source เป็น read evidence
- **NON-GOALS:** เปลี่ยน library/session policy, ลง implementation ก่อน approval
- **CONTRACTS:** final-session boundary และ lock protocol
- **VERIFY:** inspect pinned hooks/adapter transactions และออกแบบ targeted DB regression
- **PROOF:** hook ordering/transaction evidence, accepted product decisions, approved AC mapping
- **COVERS:** P2, P4, P5, P8

### PLAN-2 Server resolver และ lifecycle integration

- **OWNER:** software-engineer
- **READY:** PLAN-1 ผ่าน, approved spec และ start authorization
- **OUTCOME:** final login/bootstrap converge user/session mirrors พร้อม existing-session recovery
- **SOURCE:** API, Resolution, Concurrency, Security / notification non-widening
- **INVARIANTS:** org-first lock order, checked membership, runtime role, GET read-only
- **FILES:** `apps/api/src/auth/`, `apps/api/src/me/`, `packages/api-contract/src/auth.ts`; lifecycle/notification services เปลี่ยนเฉพาะ integration ที่จำเป็น
- **NON-GOALS:** schema migration, worker/replay/provisioning changes
- **CONTRACTS:** POST response/error และ resolver outcomes สำหรับ PLAN-3
- **VERIFY:** API unit/auth/me DB suites และ targeted notification/membership races บน isolated runtime/owner URLs
- **PROOF:** user/session convergence, pending-MFA no mutation, switch/revoke/leave concurrency และ RLS negative results
- **COVERS:** P1, P2, P3, P4, P5, P6, P8

### PLAN-3 Server-confirmed tenant bootstrap และ shell

- **OWNER:** software-engineer; UX Designer พิจารณา admission flow เมื่อได้รับอนุญาต
- **READY:** API contract และ product admission UI อนุมัติ
- **OUTCOME:** Tenant app ไม่ usable ก่อน resolution; header/inbox scope ตรงกัน
- **SOURCE:** Web state และ cache, API
- **INVARIANTS:** WEB-01–WEB-04, AUTH-05, CMP-01, preserve publication claims
- **FILES:** `apps/web/src/lib/tenant/TenantProvider.tsx`, `lib/auth/loaders.ts`, `lib/api/me.ts`, generated API types, shell/admission consumers ตาม approved flow
- **NON-GOALS:** redesign shell หรือเปลี่ยน bookmark semantics
- **CONTRACTS:** bootstrap loading/error/admission และ scope publication
- **VERIFY:** Web unit tests สำหรับ loaders/TenantProvider/switcher และ browser scenarios
- **PROOF:** one-member cold login, restored null session, no tenant prefetch on failure, no stale data across switch/identity, keyboard/theme states
- **COVERS:** P1, P2, P3, P6, P7, P8

### PLAN-4 Integrated verification

- **OWNER:** Technical Lead ประสาน verification หลังอนุญาต implementation
- **READY:** Approved AC mapping, writers หยุด และ candidate ระบุครบ
- **OUTCOME:** รายงานผ่าน/ไม่ผ่าน/not run ตาม candidate จริง
- **SOURCE:** Proposed criteria และ Quality gates
- **INVARIANTS:** design ไม่ใช่ implementation proof, DB/RLS/security ไม่ข้าม
- **FILES:** Auth/me/notification/membership DB tests, web tests, `e2e/tests/` ตาม scenario
- **NON-GOALS:** release/deploy/shared resources
- **CONTRACTS:** None
- **VERIFY:** integrated gates ด้านล่าง
- **PROOF:** command results, candidate id, failure/gap records และ actual criteria evidence
- **COVERS:** P1–P8

## Integrated verification

เสนอหลัง implementation: `bun run codegen:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:integration`, coverage ด้วย `COVERAGE_GATE=1`, `bun run security` และ authenticated E2E (`bun run e2e`) ตาม [Quality gates](../../../scripts/quality/README.md) รวม standard root validation/CI ของ candidate ห้ามใช้ ambient DB หรือสร้าง resources โดยไม่มี authorization

DB proof ต้องใช้ real PostgreSQL runtime non-owner NOBYPASSRLS กับ owner URL แยกกัน ทดสอบ concurrency ด้วย synchronization barriers ไม่ใช้ sleep เป็น ordering proof; assert ทั้ง user selection, session mirrors และ permission ผลลัพธ์หลังแต่ละ race

Browser matrix: single membership null, valid last-active หลาย org, invalid/stale last-active, zero membership/pending invitation, MFA TOTP/recovery/trusted-device, existing null session reload, two sessions switch ระหว่าง inbox read/mutation, revoke/self-leave active org มี/ไม่มี membership เหลือ, initialization failure/retry และ direct bookmarked route

Verification ของงาน design นี้: อ่าน source เท่านั้น, runtime/unit/integration/E2E/security/codegen gates **not run** ไม่อ้าง `observed pass` ของ behavior

## Open decisions

| Decision / missing input | Owner | Blocks Task / proposal |
| --- | --- | --- |
| Feature scope และ behavior Acceptance matrix ยังไม่มี; ต้องให้ requirements owner เขียนและ user อนุมัติ ก่อน freeze/map AC | ผู้ใช้ / Product Owner | ทุก implementation task |
| ไม่มี membership: คง authenticated admission/account-only state (proposal) หรือปฏิเสธ login? ถ้าเลือก admission ต้องอนุมัติหน้าจอ/การใช้ personal settings และ invitation continuation | ผู้ใช้ / Product Owner | PLAN-1–PLAN-3 / P2 |
| “assign ให้ก่อน” ต้อง persist ก่อน raw auth success response หรือก่อน tenant app usable ผ่าน verified bootstrap? เสนอ final-auth integration พร้อม bootstrap fallback แต่ต้องพิสูจน์ hook ordering | ผู้ใช้, Technical Lead สำหรับ feasibility | PLAN-1–PLAN-2 / P1, P4 |
| อนุมัติ deterministic fallback ตาม membership created_at แล้ว org id และ account-global semantics เดิมหรือไม่ | ผู้ใช้ | PLAN-2–PLAN-3 / P1, P5 |
| Invitation accept สำหรับบัญชีที่มี active org เดิมควรสลับไป org ที่รับเชิญ (flow เดิม) หรือคง valid last-active? Proposal คง behavior explicit acceptance เดิม, login fallback ไม่ override | ผู้ใช้ / Product Owner | PLAN-2–PLAN-3 / P2, P5 |
| Final-auth hook ordering และ session-creation/switch transaction race ยังต้องพิสูจน์บน Better Auth 1.6.23 ก่อน implementation | Technical Lead / software-engineer เมื่อ authorized | PLAN-1–PLAN-2 / P4, P5 |
| Spec approval และ separate start authorization ยังไม่มี | ผู้ใช้ | ทุก implementation task |

## Revisions

| Date | Change | Approved by user | `acceptanceVersion` |
| --- | --- | --- | --- |
| ไม่ระบุ | Initial Draft proposal จาก requirement ผู้ใช้และ source `292ce19` | Not yet | ไม่มี |
