# F-007 delivery history

Historical planning sections extracted from `spec.md` at `19f780a`. Dates, task IDs, proposed acceptance rows and verification instructions below belong to that delivery record. They do not authorize new work or claim a fresh verification run.

Current contracts, acceptance trace and revisions remain in [Technical Spec](spec.md).

The original overview recorded this PR sequence:

- ลำดับ PR: 01 → 02 → 03 → (04 และ 05 ขนานกันได้, P1 ของ platform-engineer ตาม 05) → 06

## คำตอบของประเด็นจาก handoff

"ยืนยัน" หมายถึงอ่านจาก source เมื่อ 2026-10-02 ไม่ได้รัน DB, HTTP, Worker หรือ migration ข้อที่ไม่ระบุคือการตัดสินใจของ Spec นี้ที่รอผู้ใช้อนุมัติ

1. **`OD-13` field ที่ค้นหา:** ค้นแบบไม่สนตัวพิมพ์เล็กใหญ่ (substring) ใน 4 แหล่ง รวมกันแบบ OR แล้ว AND กับตัวกรองอื่น ดู "การค้นหา" ใน API
   - label ไทยและ action code ของการกระทำ
   - ชื่อที่แสดงของผู้ดำเนินการ
   - ชื่อของเป้าหมาย (ชื่อมอนิเตอร์ปัจจุบัน, ชื่อที่แสดงของสมาชิก)
   - รหัสเหตุการณ์และ `publicId` ของคำเชิญ เมื่อคำค้นเป็น UUID ทั้งค่า (ตรงทั้งค่า)
   - ไม่ค้นอีเมล ค่า before/after หรือค่าใน `changes` การ join `user.email` จะให้ `auditor` ยืนยันได้ว่าอีเมลใดเป็นของผู้ดำเนินการ ซึ่งขัด `OD-02`
2. **`OD-14` สลับ Organization ที่ role ไม่พอ:** ไป `/workspace` (replace) ซึ่งเป็นปลายทางเดียวที่ shell ใช้อยู่ (ยืนยัน: root redirect ไป `/workspace` ที่ `apps/web/src/lib/auth/loaders.ts:53-55`, หน้า 404 ลิงก์ไป `/workspace` ที่ `apps/web/src/router.tsx:84`, members recovery ไป `/workspace` เมื่อไม่มี Organization ที่อ่านได้ที่ `apps/web/src/pages/OrganizationMembersPage.tsx:95-124`) ตอนนี้ `OrgSwitcher` rewrite เฉพาะ `members|monitors` (`apps/web/src/components/shell/OrgSwitcher.tsx:119-136`) NODE-F007-04 เพิ่ม `audit-log` และ `audit-log/:eventId` ดู Web
3. **version ของ `F-004`:** ผู้ใช้เลือกออก `F-004-AC-3` (2026-10-03) Spec นี้อ้าง `F-004` `AC-02` ตาม `F-004-AC-3` เหตุผลที่เสนอ:
   - ข้อความของ `AC-02` ที่ frozen ใน `F-004-AC-2` ถูกแก้แล้ว (`docs/features/F-004-organization-member-management/feature.md:91`, `:124`) skill `technical-spec` ห้ามเปลี่ยน criterion แบบเงียบ และให้ bump version พร้อมบันทึกใน Revisions ของ spec และขออนุมัติใหม่
   - ผลต่องาน `F-004` ไม่มี: endpoint และหน้ารายชื่อสมาชิกไม่เปลี่ยน ข้อยกเว้นมีผลเฉพาะหน้าบันทึกกิจกรรมของ `F-007`
   - งานที่ตามมา: Product Owner แก้ `acceptanceVersion` ใน `F-004` `feature.md` และ Technical Lead เพิ่มแถว Revisions ใน `F-004` `spec.md` (header ของ `spec.md` และ `specs/01`–`05` อ้าง `F-004-AC-2`) แถว Revisions ใน `F-004` `spec.md` ยังไม่ได้เพิ่ม (ไม่อยู่ในงานที่มอบหมาย 2026-10-03)
   - เรื่องเดียวกันที่พบ: `F-005` ยัง `draft` (`F-005-AC-1`) จึงไม่ต้อง bump `F-006` frozen ที่ `F-006-AC-1` ข้อความ AC ไม่เปลี่ยน แต่ Design decision "Audit: คง denial-only audit ตาม `F-004`" ใน `F-006` `spec.md` เป็น contract ที่อนุมัติแล้ว ต้องเพิ่มแถว Revisions ใน `F-006` `spec.md` ว่าถูกแทนด้วย `F-007` `OD-08` (Spec นี้ไม่แก้ไฟล์นั้น)
4. **ที่เก็บ event:** ตาราง `audit_events` partition รายเดือน RLS ต่อ tenant runtime role ได้แค่ `select, insert` ดู Data
5. **การเขียนแบบ in-transaction:** helper `recordAuditEvent(client, event)` เรียกใน callback ของ `withTenantContextRaw` เดียวกับ mutation ก่อน return ถ้า insert ล้ม transaction rollback ทั้งก้อน ลบ `auditMonitorMutation` และ hook `onMonitorAlertsChanged` ดู "การเขียน event" ใน API
6. **ส่งออก:** ไฟล์เก็บใน `audit_exports.content` (`bytea`) สูงสุด 50,000 event และ 25 MiB ดาวน์โหลดได้ 24 ชั่วโมงหลังสร้างเสร็จผ่าน API ที่ตรวจสิทธิ์ทุกครั้ง (ไม่มี pre-signed link เพราะ `AC-23` ต้องตรวจ role ปัจจุบันตอนดาวน์โหลด) คำขอที่กำลังสร้างจำกัดด้วย partial unique index ดู Data, Jobs และ API


## Proposed acceptance rows (Technical Lead)

Technical Lead เพิ่มแถวเหล่านี้ใน Acceptance matrix ของ `feature.md` ตอนผู้ใช้อนุมัติ Spec งานนี้ห้ามแก้ `feature.md` จึงยังอยู่ที่นี่

| AC | Category | Observable behavior | Verification |
| -- | -------- | ------------------- | ------------ |
| AC-25 | Concurrency | ทุก race ในตาราง Concurrency ให้ผลตามคอลัมน์ "ผลที่ยอมรับ" ผู้ใช้หนึ่งคนมีคำขอที่กำลังสร้างไม่เกิน 1 คำขอต่อ Organization แม้ส่งพร้อมกัน ผลของ Worker ที่ lease หมดไม่ทับผลของ Worker ใหม่ คำขอที่ค้างเกิน 60 นาทีไม่กันการส่งออกครั้งใหม่ | Real DB/HTTP test ที่ถือ transaction ค้างแล้วปล่อย: export×export, export×demotion ทั้งสองลำดับ, Worker สองตัว claim พร้อมกัน, lease หมดแล้วผู้ถือเดิม complete, process ตายระหว่างสร้างไฟล์, claim ครั้งที่ 4 เป็น `failed`, แถว `queued` อายุ 61 นาทีโดยไม่มี Worker แล้ว list และ POST (ได้ `failed` และ notification หนึ่งรายการ), claim ที่นาทีที่ 50 คืน `exhausted`, Worker complete หลัง deadline ได้ 0 แถวและแถวคง `failed`, complete × stale transition ทั้งสองลำดับ, ทุกทางที่เป็น `failed` มี `AUDIT_EXPORT_FAILED` หนึ่งรายการ (ยกเว้นตาม P-07) |
| AC-26 | Security | Event, response, ไฟล์ส่งออก, notification และ log ไม่มีค่าลับ, ค่า query parameter, เนื้อ body, IP, user agent หรืออีเมล; `q` ไม่อยู่ใน log หรือ event; cell CSV ที่ขึ้นต้นด้วย `=`, `+`, `-`, `@` ถูก escape; runtime role update/delete `audit_events` ไม่ได้; runtime role อ่าน event หรือคำขอส่งออกของ Organization อื่นหรือผู้ใช้อื่นไม่ได้แม้ query ไม่ใส่เงื่อนไข; ตัวเลือกผู้ดำเนินการมีเฉพาะผู้ที่มี event | ตั้งค่าลับและ query ที่รู้ค่าแล้ว grep event, response, ไฟล์และ captured log; DB test ด้วย runtime role ที่ตั้ง context ของ A แล้ว select/update/delete ของ B; ชื่อมอนิเตอร์ `=HYPERLINK(...)` ในไฟล์ CSV; actors ของ Organization ที่มีสมาชิกที่ไม่เคยทำ action |
| AC-27 | Verification | Migration `0020` apply บน DB ที่มีข้อมูล `F-004`–`F-006` แล้ว partition ถูกสร้าง 3 เดือนล่วงหน้า, `db:partitions` สร้างและ drop partition ของ `audit_events`, purge ลบเฉพาะแถวที่พ้น cutoff และทุก mutation ในตาราง "การเขียน event" เขียน action และ `changes` ตามตาราง verification เดิมของ `F-004`, `F-005` (ส่วน `AC-61` ตามข้อความใหม่) และ `F-006` ผ่านซ้ำ | Migration test บน DB ที่ seed ก่อน migrate; partition test ที่เลื่อนเวลา; purge test ด้วย event อายุ 365 วัน ± 1 นาที; table-driven test ต่อ request type; รัน suite เดิมของ members, invitations, monitors และ notification settings |


## Tasks

| Task | Depends on | Integration owner of shared files |
| ---- | ---------- | --------------------------------- |
| NODE-F007-01 Event store และ in-transaction write ของสมาชิก คำเชิญ ตั้งค่าการแจ้งเตือน | Spec approved, start authorization, P-03 ตัดสิน | software-engineer |
| NODE-F007-02 Monitor redaction และ in-transaction write | NODE-F007-01 merged | software-engineer |
| NODE-F007-03 Read API (list, detail, actors, search) | NODE-F007-02 merged, P-04 ตัดสิน, `OD-11` ตัดสิน | software-engineer |
| NODE-F007-04 Web รายการ รายละเอียด nav และการสลับ Organization | NODE-F007-03 merged, `OD-12` ตัดสิน | software-engineer |
| NODE-F007-05 Export backend และ Worker | NODE-F007-03 merged | software-engineer |
| P1 Worker role `audit-exporter` ใน deploy config | NODE-F007-05 อยู่ใน review | platform-engineer |
| NODE-F007-06 Web ส่งออกและดาวน์โหลด | NODE-F007-04 และ NODE-F007-05 merged | software-engineer |

- ลำดับ: 01 → 02 → 03 → 04 และ 05 (ขนานกันได้หลัง 03 เพราะไฟล์ไม่ซ้อน) → 06; P1 เริ่มเมื่อ 05 มี entry point ของ role
- 01 มาก่อนเพราะ migration และ `recordAuditEvent` เป็น contract ของทุก node และพิสูจน์ `AC-21` ด้วย path ที่ไม่มี redaction ซับซ้อน
- 02 แยกจาก 01 เพราะ redaction ของมอนิเตอร์เป็นส่วนเสี่ยงด้าน secret และต้อง review security แยก
- shared files ที่มีผู้แก้ทีละ node ตามลำดับ: `packages/api-contract/src/audit-log.ts`, `packages/api-contract/src/index.ts`, `apps/web/src/lib/api/openapi-types.gen.ts` (codegen เท่านั้น), `apps/api/src/app.ts` (`logSafeOrganizationPath`, route registration), `packages/db/src/schema.ts`
- `packages/api-contract/src/notification.ts`, `packages/db/src/notification.ts`, `apps/worker/src/materialize.ts` และ `apps/web/src/pages/NotificationsPage.tsx` แก้เฉพาะใน 05
- 04 และ 05 ขนานกันได้: 04 ไม่แก้ API, contract หรือ generated client ส่วน 05 แก้ `apps/web` เฉพาะ `NotificationsPage.tsx` และ generated client ถ้าทั้งคู่เปิด PR พร้อมกัน 05 merge ก่อน แล้ว 04 rebase (ไม่ต้อง regenerate เพราะ 04 ไม่เปลี่ยน API)
- P1 แก้เฉพาะ deploy config (`compose.worker.yaml` และ manifest ของ environment ถ้ามี) ไม่แก้ `apps/worker/src`

คำสั่ง VERIFY ของ DB/integration ทุก node รันใน dev-env wrapper ของ `scripts/quality/README.md` หัวข้อ "Integration tests (real database)" (หลัง `bun run db:up`, `bun run db:migrate` และ `bun run db:partitions`) โดยแทนคำสั่งใน `Bun.spawn` ด้วยคำสั่งของ package (รูปแบบนี้ยังไม่ได้รันยืนยัน):
- `apps/api`: `bun run --cwd apps/api test:integration -- <files>` (project `integration` รับ path ของ `*.db.test.ts`)
- `packages/db`: `bun run --cwd packages/db test:integration` script ระบุไฟล์ตายตัว (`packages/db/package.json:16`) test ใหม่ต้องเพิ่มลง script นี้
- `apps/worker`: `bun run --cwd apps/worker test:integration` script ระบุไฟล์ตายตัว (`apps/worker/package.json:13`) test ใหม่ต้องเพิ่มลง script นี้
- unit ของ web: `bun run --cwd apps/web test -- <files>`

### NODE-F007-01 Event store และ in-transaction write (สมาชิก คำเชิญ ตั้งค่าการแจ้งเตือน)

- **OWNER:** software-engineer
- **READY:** Spec approved, start authorization ของ `F-007`, P-03 ตัดสินแล้ว
- **OUTCOME:** migration `0020` (`audit_events`, partition, retention, `audit_recording_started_at`) อยู่; `recordAuditEvent` อยู่; 7 request type ของสมาชิก คำเชิญ และ settings เขียน event ใน transaction; hook `onMonitorAlertsChanged` ถูกลบ; `scripts/partitions.mjs` ครอบ `audit_events`
- **SOURCE:** Data, การเขียน event, Authorization และ security, Concurrency ใน Spec นี้; `AC-03`, `AC-04`, `AC-09`, `AC-14`, `AC-21`, `AC-24`, `AC-26`, `AC-27`
- **INVARIANTS:** lock order และ response/error ของ `F-004`/`F-006` ไม่เปลี่ยน; denial ไม่เขียน event และพฤติกรรมของ `auditDenials` คงเดิม (ย้ายที่อยู่เท่านั้น); no-op ไม่เขียน event; ไม่เก็บอีเมล, ชื่อ หรือ `invitation.id`; runtime role ได้ `select, insert` บน `audit_events` เท่านั้น; ไม่มี DEFAULT partition
- **FILES:** `packages/db/migrations/0020_organization_audit_log.sql` (new), `packages/db/src/schema.ts`, `packages/db/src/audit.ts` (new, partition wrapper), `packages/db/src/index.ts` (export `ensureAuditEventPartitions`), `apps/api/src/audit/record.ts` (new), `apps/api/src/audit/test-support.ts` (new, partition ของเดือนที่ระบุด้วย owner URL), `apps/api/src/audit/denials.ts` (new: ย้าย `auditDenials` จาก `organization-notifications/routes.ts:96-113` ซึ่งไม่ได้ export มาไว้ที่นี่ เพื่อให้ `apps/api/src/audit/routes.ts` ของ 03 และ 05 ใช้ร่วม), `apps/api/src/organization-notifications/members.ts` (รวม no-op ของ role เดิม), `invitations.ts`, `service.ts`, `routes.ts` (ส่ง `requestId`, import `auditDenials` ใหม่, ลบ `auditMonitorMutation` ของ settings), `packages/db/package.json` (เพิ่ม test ใหม่ใน `test:integration` ถ้ามี test ใน `packages/db/tests`), `scripts/partitions.mjs`, `scripts/quality/README.md` (หัวข้อ partitions), focused tests
- **NON-GOALS:** มอนิเตอร์, read API, web, export, Worker
- **CONTRACTS:** schema ของ `audit_events`, `recordAuditEvent`, `ensure_audit_event_partitions`, `purge_expired_audit_events` และ test helper ของ partition ที่ node อื่นใช้ต่อ
- **VERIFY:** ตามคำสั่ง VERIFY ข้างบน: `apps/api` กับไฟล์ test ของ audit record, members, invitations, notification settings และ migration/partition; `packages/db` ถ้าเพิ่ม test ที่นั่น; `bun run db:partitions` บน DB local
- **PROOF:** migration apply บน DB ที่มีข้อมูลเดิม (`AC-27`); partition 3 เดือนล่วงหน้า, `db:partitions` สร้างซ้ำได้และ drop partition ที่พ้น 366 วัน; purge ลบแถวอายุ 365 วันบวก 1 นาทีและเก็บแถว 365 วันลบ 1 นาที โดย seed ใน partition ที่ test helper สร้าง (`AC-24`); retention owner ลบแถวที่ยังไม่พ้น cutoff ไม่ได้; RLS: runtime role ใน context A อ่าน/update/delete event ของ B ไม่ได้ และ update/delete ของ A ไม่ได้ (`AC-04`, `AC-26`); role.update, revoke, leave, invitation create/resend/cancel, settings ทั้งสองแบบเขียน action, `actor_role` และ `changes` ตามตาราง (`AC-03`, `AC-14`); no-op settings, role update ที่ raw role เท่ากับ role ที่ขอ (ไม่มี event, `updated_at` ไม่เปลี่ยน, response เหมือนเดิม), role แบบ composite `"viewer,auditor"` ที่ขอเป็น `viewer` (update และมี event หนึ่งรายการ ตาม C3) และ denied ทุก request type ไม่เขียน event; trigger ใน test ทำให้ insert ล้ม แล้วทุก request type ได้ error และข้อมูลไม่เปลี่ยน (`AC-21`); event ของคำเชิญมี `public_id` และไม่มีอีเมลหรือ id ลับ; `audit_recording_started_at` ของ Organization เดิมและใหม่ (`AC-09`); verification เดิมของ `F-004` และ `F-006` ผ่าน
- **COVERS:** AC-03, AC-04, AC-09, AC-14, AC-21, AC-24, AC-26, AC-27

### NODE-F007-02 Monitor redaction และ in-transaction write

- **OWNER:** software-engineer
- **READY:** NODE-F007-01 merged
- **OUTCOME:** create, edit, pause, resume, delete ของมอนิเตอร์เขียน event เดียวใน transaction ตามตาราง "การเขียน event" พร้อม `changes` ที่ redact; `auditMonitorMutation`, `auditSecrets` และ log "monitor mutation" ถูกลบ
- **SOURCE:** การเขียน event และ Redaction ของมอนิเตอร์ใน Spec นี้; `AC-03`, `AC-14`, `AC-21`, `AC-26`, `AC-27`; `F-005` `AC-61` (ข้อความใหม่)
- **INVARIANTS:** lock order ของมอนิเตอร์ (`service.ts:148-151`) ไม่เปลี่ยน; diff คำนวณจาก `previous` ใต้ `FOR UPDATE`; function redaction ไม่รับค่าลับ; replay และ no-op ไม่เขียน event; `auditMonitorDenials` คงเดิม; การ encrypt ค่าลับยังอยู่ใน transaction เดิม
- **FILES:** `apps/api/src/monitors/audit.ts`, `apps/api/src/monitors/service.ts`, `apps/api/src/monitors/routes.ts`, test เดิมที่ assert log "monitor mutation", focused tests
- **NON-GOALS:** เปลี่ยน contract ของ monitor API, `monitor_events`, Test route
- **CONTRACTS:** `monitorAuditChanges(previous, next, { written, stored, deleted })` (ชื่อช่องเท่านั้น) และตาราง "รูป `changes` ต่อ action ของมอนิเตอร์" ที่ NODE-F007-03/04/05 แสดงผล
- **VERIFY:** unit test ของ `monitorAuditChanges` ทุก field (`bun run --cwd apps/api test -- src/monitors/audit.test.ts`); `apps/api` integration กับไฟล์ test ของ monitor write และ secrets ตามคำสั่ง VERIFY ข้างบน
- **PROOF:** แต่ละแถวของตารางมอนิเตอร์ได้ action เดียว (รวม edit ที่เปลี่ยน config และค่าลับพร้อมกัน, edit เฉพาะค่าลับใหม่, edit ที่แทนที่ค่าลับ); ตั้งและแทนที่ค่าลับที่รู้ค่า, query parameter ที่รู้ค่า และ body ที่รู้ค่าแล้วค้นใน `audit_events` ไม่พบ (`AC-14`, `AC-26`); URL ที่มี query เก็บเป็น `•••`; header ไม่ลับเก็บค่าก่อน/หลัง; trigger ทำให้ insert ล้มแล้ว monitor และ schedule ไม่เปลี่ยน (`AC-21`); replay ของ create และ pause ซ้ำไม่เขียน event; suite เดิมของ `F-005` ผ่าน
- **COVERS:** AC-03, AC-14, AC-21, AC-26, AC-27

### NODE-F007-03 Read API

- **OWNER:** software-engineer
- **READY:** NODE-F007-02 merged, P-04 และ `OD-11` ตัดสิน
- **OUTCOME:** list, detail และ actors endpoint ตาม API contract พร้อม filter, search, `asOf`, `retainedFrom` และ label ใน contract
- **SOURCE:** API (list, detail, actors, การค้นหา, ชื่อที่แสดง), Authorization และ security; `AC-02`, `AC-04`, `AC-05`, `AC-09`, `AC-10`, `AC-12`, `AC-13`, `AC-24`, `AC-26`
- **INVARIANTS:** authorization และ read อยู่ใน statement เดียว; สิทธิ์อ่านใช้ role ที่ normalize แล้วด้วย `normalizeOrganizationRole` ไม่ใช้ regex ต่อ token แบบ `members.ts:105-117` ค่า `"viewer,auditor"` ที่เก็บอยู่จึงไม่นับเป็น `auditor`; ไม่คืนอีเมล; ไม่ค้นอีเมลหรือ `changes`; cutoff ใช้ทุก read; actors มาจาก event เท่านั้น; ไม่เขียน event
- **FILES:** `packages/api-contract/src/audit-log.ts` (new), `packages/api-contract/src/index.ts`, `apps/api/src/audit/read-service.ts` (new), `apps/api/src/audit/routes.ts` (new), `apps/api/src/app.ts`, `apps/web/src/lib/api/openapi-types.gen.ts` (codegen เท่านั้น), focused tests
- **NON-GOALS:** web, export
- **CONTRACTS:** response schema และ generated client ที่ NODE-F007-04 ใช้ต่อ
- **VERIFY:** `apps/api` integration กับไฟล์ test ใน `src/audit/` ของ read API ตามคำสั่ง VERIFY ข้างบน; `bun run codegen:check` test ที่ seed partition ของเดือนที่ผ่านมาด้วย `createAuditPartitionFor` ต้องใช้ DB แยก (isolated) แบบ `store.db.test.ts` เพราะสร้างและ drop partition บน parent ที่ suite อื่นใช้ร่วม
- **PROOF:** ทุก role × A-only/B-only/A+B และ Organization ที่ไม่มีอยู่ เทียบ status/code/message (`AC-04`, `AC-05`); สมาชิกที่ `member.role` เก็บเป็น `"viewer,auditor"` ได้ผลเดียวกับ role ที่ normalize แล้วทั้ง list, detail และ actors (ไม่ได้สิทธิ์อ่านแบบ `auditor`); 51 event: ลำดับ, total, หน้าสองมีหนึ่งแถว, `offset >= total`, `asOf` กันแถวใหม่ (`AC-02`); AND ของตัวกรอง, `q` ตรง label/code/ชื่อผู้ดำเนินการ/ชื่อเป้าหมาย/UUID และไม่ตรงอีเมล, `%`/`_` ใน `q` (`AC-10`); รายละเอียดทุกหมวดและเป้าหมายที่ลบแล้ว (`AC-12`); 404 สี่กรณีเหมือนกัน (`AC-13`); `target` ของ event `organization.audit-log.export` ทั้งใน list และ detail เป็น `{ type: 'audit_export', exportId, format }` โดย `format` อ่านจาก `target_attributes.format` (`AuditTarget` ชุดเดียวกันทั้งสอง endpoint) เพื่อให้ NODE-F007-04 แสดง "ไฟล์ส่งออก CSV/JSON" (`a-1`, `N-5`); seed ตาม P-02 ใน partition ที่ test helper ของ 01 สร้าง (`AC-24`); `retainedFrom` และ `recordingStartedAt` (`AC-09`); actors ไม่มีสมาชิกที่ไม่เคยทำ action (`AC-26`); log path เป็น route template และไม่มี `q`
- **COVERS:** AC-02, AC-04, AC-05, AC-09, AC-10, AC-12, AC-13, AC-24, AC-26

### NODE-F007-04 Web รายการ รายละเอียด nav และการสลับ Organization

- **OWNER:** software-engineer
- **READY:** NODE-F007-03 merged (`OD-12` ปิดใน `feature.md`: icon `history`)
- **OUTCOME:** หน้ารายการและรายละเอียดตาม UI flow ขั้นตอน 1–6, 15 (viewer/ถอน) และ 16 ของ `F-007-AC-2` และ state table แถวรายการกับรายละเอียด รวมเป้าหมายของ event การส่งออก (`a-1`) และ section "ขอบเขตการส่งออก" (`a-2`); nav leaf icon `history` (`OD-12`); `OrgSwitcher` ครอบ audit-log
- **SOURCE:** Web ใน Spec นี้; `feature.md` UI flow; `AC-01`–`AC-14`, `AC-17`, `AC-18`, `AC-20`
- **INVARIANTS:** ไม่แสดงข้อมูลของ Organization เดิมหลังสลับ; จำนวนที่ไม่ทราบไม่เป็น `0`; ไม่มีปุ่ม `ส่งออก` ใน node นี้; `viewer` ไม่เห็น leaf
- **FILES:** `apps/web/src/router.tsx`, `apps/web/src/lib/auth/loaders.ts`, `apps/web/src/lib/preferences.ts` (`formatAuditTimestamp`), `apps/web/src/components/shell/nav-config.ts`, `apps/web/src/components/shell/icons.tsx`, `apps/web/src/components/shell/OrgSwitcher.tsx`, `apps/web/src/lib/api/audit-log.ts` (new), `apps/web/src/pages/audit-log/` (new), focused tests
- **NON-GOALS:** export dialog, section ไฟล์ส่งออก, download, API change
- **CONTRACTS:** page frame, query keys และ toolbar slot ที่ NODE-F007-06 ใช้ต่อ
- **VERIFY:** `bun run --cwd apps/web test -- <files>` ของหน้ารายการ รายละเอียด nav, `OrgSwitcher` และ `formatAuditTimestamp`
- **PROOF:** leaf และ ⌘K ทุก role (`AC-01`); ตาราง, หน้า, เวลาแบบ `YYYY-MM-DD HH:mm:ss` ปี ค.ศ. พร้อมวินาทีใน `timeZone` ของ preference และชื่อ zone (ทดสอบ `Asia/Bangkok` กับ zone ที่ offset ต่าง) (`AC-02`); state table ทุกช่องของรายการและรายละเอียด (`AC-08`, `AC-09`); query string เขียน/อ่าน/ล้าง และเปิดลิงก์ซ้ำ (`AC-10`); ค่ากำหนดเองที่ผิดไม่ส่ง request (`AC-11`); รายละเอียดและ "ถูกลบแล้ว", ชื่อลิงก์เป้าหมาย "เปิดมอนิเตอร์ <ชื่อ>", เป้าหมายสมาชิกของ `auditor` เป็นข้อความ, event การส่งออกแสดงเป้าหมาย "ไฟล์ส่งออก CSV/JSON" ไม่มีลิงก์ (`a-1`) และ section "ขอบเขตการส่งออก" ที่มี "มีการค้นหาข้อความ: ใช่/ไม่" โดยไม่มีคำค้น (`a-2`), DOM ไม่มีอีเมล (`AC-12`, `AC-13`); การแสดง `changes` ทุกชนิด `AuditValue` (`AC-14`); ลดเป็น viewer/ถอนแล้วหน้าล้างแถวและ focus การ์ด (`AC-06`); สลับระหว่างโหลดและหลังโหลด, ไป `/workspace` เมื่อ role ไม่พอ (`AC-07`); keyboard, caption, `th scope`, `aria-pressed`, `role="status"`, focus หลังเปลี่ยนหน้าและกลับจากรายละเอียด (`AC-17`, `AC-18`); light/dark
- **COVERS:** AC-01, AC-02, AC-03, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12, AC-13, AC-14, AC-17, AC-18, AC-20

### NODE-F007-05 Export backend และ Worker

- **OWNER:** software-engineer
- **READY:** NODE-F007-03 merged (P-01, P-06, P-07 และ P-08 ตัดสินแล้ว 2026-10-03)
- **OUTCOME:** export request, exports list และ download endpoint; Worker role `audit-exporter` สร้าง CSV/JSON, แจ้งผู้ขอ, purge event และไฟล์; notification ชนิดใหม่ใน contract, API inbox และ materialize
- **SOURCE:** API (export, exports, download), Jobs, Data (`audit_exports`, notification), Concurrency; `AC-05`, `AC-15`, `AC-16`, `AC-22`–`AC-26`
- **INVARIANTS:** คำขอและ event อยู่ใน transaction เดียว; role ตรวจก่อนเปิดเผยจำนวน; ไม่เกิน 1 คำขอที่กำลังสร้างต่อผู้ใช้ต่อ Organization; Worker ตั้ง context จาก claim เท่านั้น; complete และ fail เป็น update แบบมีเงื่อนไขของ `claim_token` และ complete มีเงื่อนไข deadline; กฎ 60 นาทีอยู่ใน `audit_export_deadline()` เท่านั้น; `retainedFrom` ของไฟล์คำนวณครั้งเดียวตอนเริ่มสร้างและใช้ค่าเดียวกันทุก batch ขอบบนคือ `snapshot_at` (`25e8038`); ทุกทางที่เป็น `failed` รวม sweep ของ P-08 สร้าง notification ใน transaction เดียวกัน (ผู้รับตาม P-07); claim และ sweep ใช้ WHERE ของตัวเอง ไม่อิง policy และไม่แตะแถว `ready`/`failed`; claim owner ไม่มี grant บน `audit_exports`; ไม่มี network หรือการสร้างไฟล์ใน transaction; notification ถึงผู้ขอคนเดียว; download ตรวจ role ทุกครั้งและไม่เขียน event; ไม่ใช้ Redis
- **FILES:** `packages/db/migrations/0021_audit_exports.sql` (new), `packages/db/src/schema.ts`, `packages/db/src/tenant-context.ts` (`withTenantUserContextRaw`), `apps/api/src/audit/export-service.ts` (new), `apps/api/src/audit/routes.ts`, `apps/api/src/app.ts` (`logSafeOrganizationPath` ของ exports), `packages/api-contract/src/audit-log.ts`, `packages/api-contract/src/notification.ts`, `packages/db/src/notification.ts`, `apps/api/src/notifications/service.ts` (map ชนิดใหม่), `apps/worker/src/index.ts`, `apps/worker/src/audit/` (new), `packages/shared/src/audit-export.ts` (new, สำเนาที่ Worker ใช้ตามคำตัดสิน PKG-01 ของผู้ใช้), `packages/db/src/audit-events.ts` (new, predicate ร่วมของ list และ export), `packages/eslint-config/index.js` และ test (allowlist ของ worker), `apps/worker/eslint.config.js` (`kind: "worker"`), `apps/api/src/monitors/test-support.ts` (`text`, `json: null`), `apps/worker/src/materialize.ts`, `apps/worker/src/dispatch.ts` (เพิ่มขั้น stale sweep ในรอบของ `scheduler` ตาม P-08 (ค)), `apps/worker/package.json` (เพิ่ม test ใหม่ใน `test:integration`), `packages/db/package.json` (ถ้าเพิ่ม test ใน `packages/db/tests`), `apps/web/src/pages/NotificationsPage.tsx` (`itemTitle`, `itemContext` หมวด "องค์กร / บันทึกกิจกรรม", `ItemIcon` และลิงก์ `เปิดบันทึกกิจกรรม` ไป `.../audit-log#my-exports` ของชนิดใหม่ (`M-10`): switch ไม่มี default จึงต้องแก้พร้อม contract ไม่เช่นนั้น item ใหม่ได้ข้อความของ MFA ที่ `:67-70`), `apps/web/src/lib/api/openapi-types.gen.ts` (codegen เท่านั้น), focused tests
- **NON-GOALS:** web UI, deploy config, S3, BullMQ queue, เปลี่ยนการ claim/enqueue/retry ของ notification dispatch เดิมใน `dispatch.ts`
- **CONTRACTS:** export API, `AuditExportRecord`, notification ชนิดใหม่ที่ NODE-F007-06 ใช้; ชื่อ role `audit-exporter` และ readiness log ที่ P1 ใช้
- **VERIFY:** ตามคำสั่ง VERIFY ข้างบน: `apps/api` กับไฟล์ test ของ export และ notifications, `apps/worker` (`test:integration` ที่เพิ่มไฟล์แล้ว), `packages/db` ถ้าเพิ่ม test; `bun run codegen:check` test ที่ seed event ในเดือนที่ผ่านมาด้วย `createAuditPartitionFor` (เช่น cutoff ของไฟล์ตาม P-02) ต้องใช้ DB แยกแบบ `store.db.test.ts`
- **PROOF:** migration `0021` apply บน DB ที่มี `0020` และข้อมูลเดิม; RLS ของ `audit_exports` และ `audit_export_jobs` (runtime role ใน context ของผู้ใช้อื่นหรือ Organization อื่นอ่าน/update ไม่ได้); `claim_audit_export()` คืนแถว `queued` และแถว `running` ที่ lease หมดได้จริงและ update สำเร็จ (ไม่ติด policy ของแถวใหม่) แต่ไม่คืนแถวที่ lease ยังไม่หมด; claim owner select `audit_exports` ไม่ได้ (permission denied); insert ledger ที่ `tenant_id` หรือ `requested_by` ไม่ตรงกับแถวแม่ถูก FK ปฏิเสธ; claim ไม่คืนแถว `ready`/`failed` ที่พ้น deadline; ผู้ขอที่มีแถว `ready` เก่าที่พ้น deadline และแถว `queued` ใหม่ ยังถูก claim แถวใหม่ได้; sweep ของ `scheduler` (P-08 (ค)) ทำงานโดยไม่มี role `audit-exporter`, ไม่แตะแถว `ready`/`failed`, error ของ sweep ไม่หยุด dispatch เดิมในรอบ, และเปลี่ยนแถวที่พ้น deadline เป็น `failed` พร้อม notification หนึ่งรายการใน transaction เดียว; ลบแถวแม่แล้วแถว ledger หายตาม cascade; purge ล้างแถวที่หมดอายุใหม่ได้แม้มีแถวที่ล้างแล้วมากกว่า `p_limit` และไม่ update แถวที่ล้างแล้วซ้ำ; `auditor`/`viewer` เรียก `GET .../exports` ขณะมีแถวของตนที่พ้น deadline ได้ `403` และ `state` ไม่เปลี่ยน ไม่มี notification intent ใหม่; retention owner ล้าง `content` ได้เฉพาะแถวที่พ้น `file_expires_at` และลบได้เฉพาะแถวอายุเกิน 7 วัน; insert intent และ inbox item ของ `AUDIT_EXPORT_READY` และ `AUDIT_EXPORT_FAILED` ที่ scope `tenant` สำเร็จทั้งสองตาราง และ scope `account` ถูก check ปฏิเสธ; `auditor` และ `viewer` ได้ `403 PERMISSION_DENIED` ที่ไม่มีจำนวนใน body ทั้งเมื่อ filter มี 0 event และเมื่อมีมากกว่า 50,000 event (B-01); owner/admin ขอ CSV และ JSON ได้ ไฟล์ตรงกับ detail API ทุก field, ISO UTC, `timeZone`, note, preamble และ BOM (`AC-15`); 0 รายการ `422` และเกิน 50,000 `422` ไม่สร้างคำขอหรือ event; คำขอที่สองระหว่างคำแรก `409` และใน Organization อื่นสำเร็จ (`AC-16`); auditor/viewer/non-member ตรงได้ `403` ไม่มีคำขอหรือ event (`AC-05`); event ของ export มี `exportScope` ไม่มี `q` และ list/detail/download ไม่เขียน event (`AC-22`); ดาวน์โหลดทุกกรณีของ `AC-23` รวม `410` หลัง 24 ชั่วโมงและ `409` ระหว่างสร้าง; race ทุกแถวของ `AC-25`; notification ready/failed ถึงผู้ขอคนเดียวพร้อมลิงก์ (inbox API และ `NotificationsPage` แสดง label, หมวด "องค์กร / บันทึกกิจกรรม", icon และลิงก์ `เปิดบันทึกกิจกรรม` ไป `#my-exports` (`M-10`)); POST ที่ใช้ `filters` ของแถว `expired` (ขอใหม่) สำเร็จด้วย `201` และ `from` ที่เก่ากว่า `retainedFrom` ถูก clamp (`M-9`); ไฟล์เกิน 25 MiB เป็น `failed`; event อายุตาม P-02 ไม่อยู่ในไฟล์ (`AC-24`); ค่าลับที่รู้ค่าไม่อยู่ในไฟล์, cell `=HYPERLINK(...)` ถูก escape, Worker log ไม่มีชื่อหรือ filter (`AC-26`); shutdown ระหว่างสร้างไฟล์แล้ว claim ใหม่สำเร็จ
- **COVERS:** AC-05, AC-15, AC-16, AC-22, AC-23, AC-24, AC-25, AC-26

### P1 Worker role `audit-exporter` ใน deploy config

- **OWNER:** platform-engineer
- **READY:** NODE-F007-05 อยู่ใน review และมี entry point ของ role
- **OUTCOME:** environment ที่ deploy Worker รัน role `audit-exporter` อย่างน้อยหนึ่ง replica และ `bun run db:partitions` รันหลัง `db:migrate` ครอบ `audit_events`
- **SOURCE:** Jobs, Data (partition) ใน Spec นี้; `AC-27`
- **INVARIANTS:** role ที่มีอยู่ (`consumer`, `scheduler`, `monitor-scheduler`, `monitor-checker`) และ deploy config ของ role เหล่านั้นไม่เปลี่ยน (`scheduler` ได้ขั้น stale sweep เพิ่มจากโค้ดของ NODE-F007-05 ตาม P-08 (ค) โดยใช้ config เดิม); ไม่มี secret หรือ env ใหม่ role ใช้ `DATABASE_URL` และต้องได้ `REDIS_URL` เพราะ process บังคับทุก role (`apps/worker/src/index.ts:59`); container non-root (SYS-02)
- **FILES:** `compose.worker.yaml`, `apps/worker/Dockerfile` (comment), deploy manifest ของ environment ถ้ามีใน repository, `e2e/playwright.config.ts` ถ้า e2e ต้องเพิ่ม role
- **NON-GOALS:** CI job ใหม่, Redis config, release หรือ deploy จริง
- **CONTRACTS:** ไม่มี
- **VERIFY:** หลัง `bun run db:up` ตั้ง env ตามหัวไฟล์ `compose.worker.yaml:1-12` (`set -a; . ./.env.compose.local; set +a` ซึ่งมี `NW_DB_PASSWORD` และ `export NW_SLOT`, `NW_DB_PORT`, `NW_MAIL_SMTP_PORT`, `NW_MAIL_UI_PORT`, `NW_REDIS_PORT` จาก `bun scripts/db.mjs env`) แล้วรัน `docker compose -f compose.yaml -f compose.worker.yaml config` และ `docker compose -f compose.yaml -f compose.worker.yaml up -d --build audit-exporter` แล้วเห็น readiness log ของ role
- **PROOF:** config ที่ render แล้วมี service หรือ role `audit-exporter`; Worker local claim คำขอที่ seed ไว้และสร้างไฟล์สำเร็จ
- **COVERS:** AC-27 (ส่วน deploy)

### NODE-F007-06 Web ส่งออกและดาวน์โหลด

- **OWNER:** software-engineer
- **READY:** NODE-F007-04 และ NODE-F007-05 merged
- **OUTCOME:** ปุ่ม `ส่งออก`, `ExportDialog`, notice พร้อม `ดูไฟล์ส่งออกของฉัน`, section `ไฟล์ส่งออกของฉัน`, `ขอใหม่` (แถว `failed` และ `expired`), ดาวน์โหลด และ notice สิทธิ์ส่งออก ตาม UI flow ขั้นตอน 7–15 ของ `F-007-AC-2` และ state table แถว Export dialog, ปุ่มส่งออก, ไฟล์ส่งออกของฉัน และดาวน์โหลด
- **SOURCE:** Web (Export, Download, `403` ระหว่างใช้งานส่งออก) ใน Spec นี้; `AC-05`–`AC-08`, `AC-16`, `AC-19`, `AC-23`; UX `B-2`, `M-1`–`M-9`
- **INVARIANTS:** ตัวควบคุมที่ใช้ไม่ได้พร้อมเหตุผลใช้ `aria-disabled` + `aria-describedby` ไม่ใช้ `disabled` (`M-2`); exports query `enabled` เฉพาะ `owner`/`admin` และปุ่มกับ section ไม่ render ให้ `auditor`/`viewer`; `403` ทุกทางของการส่งออกใช้ handler เดียว (`B-2`); `ConfirmDialog` ไม่ถูกแก้; dialog ส่ง `asOf`/`from`/`to` เดียวกับรายการ (`M-4`); live region เดียวของ section (`M-8`); ดาวน์โหลดผ่าน `requestFile` ที่ใช้ generated path; ไม่แสดงข้อมูล export ของ Organization เดิมหลังสลับ
- **FILES:** `apps/web/src/lib/api/client.ts` (`requestFile`), `apps/web/src/lib/api/audit-log.ts`, `apps/web/src/components/ui/action-notice.tsx` (new, `ActionNotice` พร้อม prop `live`), `apps/web/src/pages/audit-log/` (`ExportDialog`, section, notice และ hash `#my-exports`), focused tests NODE-F007-04 ไม่ใช้ `ActionNotice` เพราะ notice ทั้งสองอยู่ใน flow ส่งออก
- **NON-GOALS:** API change, การดูไฟล์ในหน้า, แก้ `ConfirmDialog` หรือ `NotificationsPage` (อยู่ใน 05)
- **CONTRACTS:** ไม่มี
- **VERIFY:** `bun run --cwd apps/web test -- <files>` ของ dialog, section, ปุ่ม และ download
- **PROOF:** dialog: focus เริ่มที่ตัวเลือกแรกใน `fieldset` "รูปแบบไฟล์", ขอบเขตแสดง "ณ โหลดเมื่อ" และ request body มี `asOf`/`from`/`to` เท่ากับ response รายการ (`M-4`), เนื้อหาเลื่อนในตัวโดย title และปุ่มยังเห็นที่ 200% zoom, ระหว่างส่ง `aria-busy` และ `ยกเลิก`/Escape ไม่ทำงาน, กดซ้ำได้ request เดียว (`M-3`); ผล POST `422` สองแบบ (เกินขนาดใช้ `details.total`), `409`, network และ `201` ตามขั้นตอน 8; `201` แล้วปุ่มเป็น `กำลังสร้างไฟล์…` ก่อน refetch (`M-1`) และลิงก์ `ดูไฟล์ส่งออกของฉัน` ย้าย focus ไป h2 (`M-5`); 0 รายการและเกิน 50,000 เป็น `aria-disabled` พร้อม `aria-describedby` (`M-2`); `inProgress` ทำให้ปุ่มและ `ขอใหม่` ทุกแถวเป็น `aria-disabled` กลับเป็น `ส่งออก` เมื่อเสร็จ (`AC-16`); section เป็น `<table>` ที่มี caption, live region เดียวประกาศเฉพาะแถวที่เปลี่ยน, ชื่อปุ่มรายแถว, poll ล้มเหลวคงแถว (`M-8`); เหตุผลตาม `failureCode` ทั้งสามแบบ และ `ปรับตัวกรอง` เขียน query string แล้ว focus ที่ section ตัวกรอง (`M-6`); แถว `expired` มี `ขอใหม่` และ `ขอใหม่` ของแถว `failed`/`expired` ส่ง `filters` absolute เดิม พร้อม error ในแถวด้วย `role="alert"` (`M-9`); ดาวน์โหลดได้ไฟล์ชื่อตาม header, `กำลังดาวน์โหลด…`, `404`/`409` refetch, `410` แถวเป็น "หมดอายุ" พร้อม `ขอใหม่`, network (`M-7`); `403` จาก exports list, poll, POST, `ขอใหม่` และ download ทุกทาง: poll หยุด, dialog ปิด, ปุ่มกับ section หาย, notice ระดับหน้าได้ focus และรายการยังอ่านได้ (`B-2`, `AC-06`, `AC-23`); `auditor` ไม่ส่ง request ไป exports list (`AC-05`); สลับ Organization ไม่เหลือแถวไฟล์ของ A (`AC-07`); state ของ section รวม skeleton ขั้นต่ำ (`AC-08`); focus trap และ `role="alert"`/`role="status"` (`AC-19`); เปิด `.../audit-log#my-exports` แล้ว focus ไป h2 และกรณี `auditor` เปิดที่ด้านบน (`M-10`); `ActionNotice`: ข้อความอยู่ใน `role="status"` ภายใน ลิงก์และปุ่ม "ปิดข้อความ" อยู่นอก live region, notice สิทธิ์ส่งออกรับ focus ได้, tone `pending`; `ขอใหม่` สำเร็จแล้ว focus อยู่ที่ปุ่มเดิมที่เป็น `aria-disabled`, live region ประกาศแถวใหม่ และไม่มี notice ซ้ำ (`N-1`); ปุ่ม `ส่งออก` และ `ขอใหม่` ทุกแถวมี `aria-describedby` เป็น id เดียวกันของข้อความเหตุผลใต้ page header (`N-2`); แถว `EXPORT_TOO_LARGE` มี `ปรับตัวกรอง` เป็น primary และช่วงวันในตัวกรองครอบช่วงของแถว (`N-3`); POST ที่ค้างเกิน 15 วินาทีแสดง error "ส่งคำขอส่งออกไม่สำเร็จ…" และ `ยกเลิก`/Escape ใช้ได้อีกครั้ง (fake timer) (`N-4`)
- **COVERS:** AC-05, AC-06, AC-07, AC-08, AC-16, AC-19, AC-23


## Integrated verification

- หลัง NODE-F007-06 merge: scenario A-only/B-only/A+B ด้วยทุก role ตั้งแต่ทำทุก action ใน Event inventory → รีเฟรชรายการ → กรองและค้นหา → รายละเอียด → ส่งออก CSV และ JSON → notification → ดาวน์โหลด → ลด role จากอีก session → สลับ Organization (`AC-01`–`AC-24`)
- `AC-20`: ตรวจ OpenAPI ว่าไม่มี endpoint แก้/ลบ event หรือดูข้าม Organization และ grant ของ `audit_events`
- `AC-21`: รัน trigger test ของ 01 และ 02 ซ้ำบน head สุดท้าย
- Browser smoke ด้วย keyboard และ screen reader ทั้ง light/dark (`AC-17`–`AC-19`)
- Worker local ด้วย role `audit-exporter` ร่วมกับ role เดิม (P1)
- หลัง writer หยุดทั้งหมด Technical Lead สั่ง final code review หนึ่งครั้ง และ PR CI gates `bun run validate`, `COVERAGE_GATE=1 bun run test:coverage` ตาม `scripts/quality/README.md` ไม่มี release หรือ deploy task
