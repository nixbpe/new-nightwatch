# Technical Spec: การเปลี่ยน API จากการรีวิว UX (ORG-08, ORG-13, INV-09, PRJ-06, AUTH-02b, AUTH-03b)

## สถานะและขอบเขตอำนาจ

สถานะ `Draft`, ยังไม่อนุมัติ. ยังไม่มี security review และยังไม่อนุญาตให้ implement ข้อใดในเอกสารนี้. เอกสารนี้ไม่เปลี่ยนโค้ดแอป ไม่แก้ E-005 หรือ epic อื่น.

Baseline คือ commit `478290d`. ทุก `file:line` อ้าง baseline นี้ อ่านซ้ำได้ด้วย `git show 478290d:<path>`. ตำแหน่งใน `better-auth@1.7.7` อ้างไฟล์ใน `node_modules` หลัง `bun install --frozen-lockfile`.

รหัส ORG-08, ORG-13, INV-09, PRJ-06, AUTH-02b, AUTH-03b มาจากรายงานรีวิว UX ของหน้า web ซึ่งไม่อยู่ใน repo. ข้อความ "ปัญหา" ในรายงานเป็นข้อสันนิษฐานจากการอ่านโค้ด ส่วน "ปัจจุบัน" ของแต่ละข้อด้านล่างตรวจซ้ำจากโค้ดที่ baseline แล้ว. สิ่งที่ไม่ได้ตรวจเขียนว่า "ยังไม่ตรวจ".

ขนาดงาน S, M, L ในเอกสารนี้ผู้เขียนกำหนดเอง เป็นวันทำงานของหนึ่งคนรวม implementation และ test ของข้อนั้น ยังไม่รวมเวลา review และ CI: S ไม่เกิน 1.5 วัน, M มากกว่า 1.5 ถึง 3 วัน, L มากกว่า 3 วัน. ยังไม่ได้วัดจากงานจริง.

## แหล่งอ้างอิง

- [Architecture](../architecture.md): REQ-01 (ไม่เรียกเครือข่ายใน transaction), REQ-02, REQ-04, DB-04, DB-06 (ตาราง login และ membership ไม่มี organization RLS), DB-07, DB-10, DB-11, JOB-07, OPS-01.
- [Quality scripts](../../scripts/quality/README.md): หัวข้อ Integration tests (real database) และ OpenAPI client drift (`bun run --cwd apps/web codegen`, `bun run codegen:check`).
- [E-005](../epics/E-005-cve-monitoring-from-inventory.md): `Q-19` (บรรทัด 172, 219), `R-07` (บรรทัด 240), `Q-12` (บรรทัด 376).
- [E-002](../epics/E-002-organization-member-governance.md) บรรทัด 27 และ 28: F-006 (คำเชิญ) และ F-007 (audit log, บันทึกเฉพาะกิจกรรมที่สำเร็จ). ไม่พบเอกสาร Feature ฉบับเต็มของ F-006 และ F-007 ใน `docs/`.

## ข้อกำหนดร่วมของทุกข้อ

- Contract อยู่ใน `packages/api-contract` (zod) ตาม REQ-02. หลังแก้ต้องรัน `bun run --cwd apps/web codegen` และ `bun run codegen:check`. ห้ามแก้ `openapi-types.gen.ts` ด้วยมือ.
- ใช้ expand/contract: เพิ่มฟิลด์หรือคอลัมน์ที่ nullable ก่อน ส่ง UI แล้วค่อยลบของเก่า เพื่อให้ revert UI ไม่ชนฟิลด์ที่หาย. Migration ใหม่ถัดไปคือ `0041` (ล่าสุดคือ `0040_inventory_import_preview.sql`). Migration แก้ไขไฟล์ที่ apply แล้วไม่ได้ (DB-11).
- ทุก endpoint ที่แตะข้อมูลระดับ tenant ต้องมี integration test กับฐานข้อมูลจริงที่ขอบเขต 403 (ไม่ใช่สมาชิก, role ไม่พอ), 404 (ข้าม tenant, ข้ามผู้ใช้) และ RLS ตาม quality README.
- Audit log ของโปรเจกต์บันทึกเฉพาะกิจกรรมที่สำเร็จ (E-002:28). การปฏิเสธบันทึกผ่าน `auditDenials` (`apps/api/src/audit/denials.ts:1-23`) เป็น log ที่ไม่มีข้อมูลเป้าหมาย.

---

## 1. ORG-08: สรุปการเปลี่ยนแปลงในแถว audit log

### ปัจจุบัน (ตรวจจากโค้ด)

- `auditEventSummarySchema` มี `id`, `occurredAt`, `category`, `action`, `actor`, `target` ไม่มี `changes` (`packages/api-contract/src/audit-log.ts:327-335`). `auditEventDetailSchema` เพิ่ม `changes` (`audit-log.ts:363-367`).
- List ดึงคอลัมน์จาก `AUDIT_EVENT_COLUMNS` ซึ่งไม่มี `e.changes` (`packages/db/src/audit-events.ts:40-50`). Detail ดึง `e.changes` (`apps/api/src/audit/read-service.ts:364`, ประกอบที่ `:381-387`).
- สิทธิ์อ่าน: list และ detail ใช้ `GATE_CTES` เดียวกัน คือ `owner`, `admin`, `auditor` (`read-service.ts:76`, `:292`, `:362`). `viewer` ได้ 403 `PERMISSION_DENIED` จาก `assertAllowed` (`read-service.ts:81-94`). Export จำกัด `owner` และ `admin` (`read-service.ts:77`, `:443-471`) และไฟล์ export มี `changes` เต็ม (`apps/worker/src/audit/file.ts:138`, `:153`).
- Tenant: ทุก query อยู่ใน `withTenantContextRaw` และมีเงื่อนไข `e.tenant_id = $1` (`read-service.ts:243`, `:369`).
- ข้อมูล `changes` เก็บเป็น jsonb `not null default '[]'` (`packages/db/migrations/0020_organization_audit_log.sql:48`) ไม่มี CHECK บนรูปร่างของ JSON (ตรวจเฉพาะ `0020`, ยังไม่ตรวจ migration ถัดมา). ผู้เขียน event เป็นผู้ redact (`apps/api/src/audit/record.ts:81`).
- ค่าที่เก็บเป็นข้อความจริง: ค่า header ที่ไม่ใช่ secret (`apps/api/src/monitors/audit.ts:252-255`), ข้อความ assertion (`audit.ts:328-348`), ชื่อโปรเจกต์ก่อนและหลังเปลี่ยน (`apps/api/src/projects/service.ts:311-316`). ค่า query param ถูกปิดเป็น `masked` (`audit.ts:307-308`), URL ถูก mask (`audit.ts:143-148`), `description` ของโปรเจกต์เก็บเป็น `changed` ไม่เก็บข้อความ (`projects/service.ts:317-322`).
- `apps/api/src/monitors/config-changes.ts` เป็นรูปร่าง `MonitorConfigChange` ของ API มอนิเตอร์ ไม่ใช่ `AuditChange` จึงไม่ใช่แหล่งของ audit.
- ป้ายหมวด (`event.category`) มีใน response อยู่แล้ว ไม่ต้องแก้ API.

### Contract ที่เสนอ (ตัวเลือก B)

เพิ่มฟิลด์ optional ใน `auditEventSummarySchema`:

| ฟิลด์ | ชนิด | ขอบเขต |
| --- | --- | --- |
| `changeSummary` | object, optional | ไม่ส่งเมื่อ event ไม่มีการเปลี่ยนค่าที่อยู่ใน allow-list และไม่มีฟิลด์อื่น |
| `changeSummary.shown` | array ของ `auditChangeSchema` | ไม่เกิน 3 รายการ, `field` อยู่ใน allow-list `role`, `monitorAlertsEnabled`, `settingsChangedEnabled` เท่านั้น, `before` และ `after` เป็น kind `value` เท่านั้น |
| `changeSummary.otherCount` | int | 0 ถึง 100, จำนวน change ของฟิลด์นอก allow-list |

- ค่าเริ่มต้นของ response ไม่เปลี่ยนสำหรับ event ที่ไม่มีการเปลี่ยนแปลง. Client ที่ไม่รู้จักฟิลด์ใหม่ยังทำงานเหมือนเดิม.
- สร้างฟิลด์ที่ฝั่ง server จาก `changes` ใน `read-service.ts` โดยตัดตาม allow-list ก่อนส่ง ไม่ส่ง `before` หรือ `after` ของฟิลด์อื่นออกจาก server. ต้องประมวลผลแบบป้องกัน: รูปร่างที่ไม่รู้จักหรือ `changes` ว่างได้ผลเป็น "ไม่มีสรุป" ห้ามทำให้ list ตอบ 500.
- การอนุญาต: ไม่เปลี่ยน. ผู้อ่านคือ `owner`, `admin`, `auditor` ตามเดิม. ไม่มี endpoint ใหม่.
- Audit event ใหม่: ไม่มี (เป็นการอ่าน).
- ภาระข้อมูล: ถ้าเพิ่ม `e.changes` เข้า query ของ list ต้องส่ง jsonb ของ 50 แถวต่อหน้าจากฐานข้อมูลมายัง API ยังไม่ได้วัดขนาด. ถ้า change ของ `monitor.update` ใหญ่ ให้ตัดใน SQL แทน (เลือกตอน implement, ต้องวัด).

### ข้อมูล retention และความเป็นส่วนตัว

- ใช้หน้าต่าง retention เดิม (365 วัน, `read-service.ts:67-72`) ไม่เก็บสำเนาใหม่.
- สรุปเปิดเผยเฉพาะ role และ toggle ของการแจ้งเตือน ไม่มีชื่อบุคคล อีเมล หรือค่าของมอนิเตอร์. ผู้อ่านกลุ่มเดียวกันเห็นค่าเดียวกันอยู่แล้วใน detail ความเสี่ยงที่เพิ่มจาก list คือการเห็นเป็นกลุ่ม 50 แถวต่อคำขอ ซึ่งตัวเลือก B ตัดโดยไม่ส่งค่า header, assertion และชื่อ.

### Migration

ไม่ต้องมี. ไม่ต้องเพิ่ม index (ลำดับของ list ไม่เปลี่ยน).

### Failure modes และ test ที่ต้องมี

- `viewer` ได้ 403 `PERMISSION_DENIED` ที่ list ที่มีสรุป, ผู้ที่ไม่ใช่สมาชิกได้ 403 `MEMBERSHIP_DENIED`, ผู้ใช้ที่ยังไม่ยืนยันอีเมลได้ 403 `EMAIL_NOT_VERIFIED`.
- Event ของ organization B ไม่ปรากฏใน list ของ organization A (ขยาย `apps/api/src/audit/read.db.test.ts`).
- Event `monitor.update` ที่มีค่า header, ข้อความ assertion และชื่อโปรเจกต์: JSON ของ list ต้องไม่มีสตริงเหล่านั้น.
- Event ที่ไม่มี change ไม่มี `changeSummary`; `changes` ที่เป็นรูปร่างผิด (ใส่ตรงในตารางด้วย owner role ในเทส) ไม่ทำให้ list ล้ม.
- `otherCount` ไม่เกิน 100 และ `shown` ไม่เกิน 3.
- อัปเดต `apps/api/src/audit/contract-parity.test.ts` และรัน `codegen:check`.

### ผู้ตัดสินต้องเลือก

| ตัวเลือก | เนื้อหา | ขนาด |
| --- | --- | --- |
| A | ไม่เปลี่ยน API. แถวแสดงหมวดเป็น pill (ข้อมูลมีแล้ว) และป้ายการกระทำ | S |
| B (แนะนำ) | สรุปจาก allow-list `role`, `monitorAlertsEnabled`, `settingsChangedEnabled` และจำนวนการเปลี่ยนอื่น | M |
| C | ส่ง `before` และ `after` ของทุกฟิลด์ที่เป็น kind `value` ให้ list | M |

เหตุผลที่แนะนำ B: ตรงกับตัวอย่าง "ผู้ชม → ผู้ดูแล" ในรายงาน และไม่ส่งค่าข้อความอิสระ (header, assertion, ชื่อ) ออกเป็นชุด. C เปิดข้อความที่ลูกค้าพิมพ์ในปริมาณมากต่อคำขอ.

ผู้ตัดสิน: ฟิลด์ใน allow-list เป็นของ Product Owner role (ยังไม่ระบุ); การเปิดค่าแบบ C ต้องให้เจ้าของด้าน security (ยังไม่ระบุ) ตัดสิน.

ขนาดงาน: B = M, A = S, C = M.

---

## 2. ORG-13: สถานะการส่งอีเมลคำเชิญที่ไม่สำเร็จและการส่งซ้ำ

### ปัจจุบัน (ตรวจจากโค้ด)

- สร้างคำเชิญ: insert แถวพร้อม `sent_at = created_at` ใน transaction (`apps/api/src/organization-notifications/invitations.ts:94-100`) แล้ว route ส่งอีเมลหลัง commit (`routes.ts:371-387`). ส่งไม่สำเร็จ: log `warn` แล้วตอบ 201 พร้อม `emailDispatch: "failed"` ไม่เก็บอะไรลงฐานข้อมูล.
- ส่งซ้ำ: `rotateInvitationId` เปลี่ยน `id` (bearer token ของลิงก์), ตั้ง `sent_at` และ `expires_at = +48 ชั่วโมง` ใน transaction เดียวกัน (`invitations.ts:239-261`) และเขียน audit event `organization.invitation.resend` ก่อนส่งอีเมล (`invitations.ts:384-396`). ลิงก์เก่าตายเมื่อ commit. ถ้าส่งอีเมลไม่สำเร็จ ผู้รับไม่มีลิงก์ที่ใช้ได้เลย (เก่าตาย ใหม่ไม่ถึง) (`routes.ts:316-353`).
- Cooldown: `RESEND_COOLDOWN_SECONDS = 300` (`invitations.ts:12`). ส่งซ้ำก่อนครบได้ 429 `INVITATION_RESEND_COOLDOWN` (`invitations.ts:327-334`). `resendAvailableAt = sent_at + 300 วินาที` ใน list (`invitations.ts:480-481`). ดังนั้นการส่งที่ล้มเหลวก็เริ่ม cooldown 5 นาที และปุ่ม "ส่งซ้ำ" ที่วางในข้อความเตือนจะได้ 429. Web ปิดปุ่มระหว่าง cooldown (`apps/web/src/pages/organization-members/InvitationResendAction.tsx:179-197`).
- Contract: `invitationCreateResponseSchema` และ `invitationResendResponseSchema` มี `emailDispatch: "accepted" | "failed"` (`packages/api-contract/src/auth.ts:22-26`, `:119-125`). `pendingInvitationSchema` ไม่มีสถานะการส่ง (`auth.ts:94-103`).
- ผู้ส่งอีเมลคำเชิญมี 3 ทาง: route สร้าง, route ส่งซ้ำ, และ CLI ของ operator (`apps/api/src/operator/provision-organization.ts:168-175`, `:301-320`). เส้นทางของ Better Auth `/organization/invite-member` ถูกปิด (`apps/api/src/auth/index.ts:40-55`).
- สิทธิ์: สร้าง ส่งซ้ำ ยกเลิก ให้เฉพาะ `owner` และ `admin`, ปฏิเสธ `viewer` และ `auditor` ก่อนค้นหาคำเชิญ (`invitations.ts:128-161`). `admin` จัดการคำเชิญ role `owner` ไม่ได้ (`invitations.ts:320-326`). List ตรวจ role ด้วย regex `owner|admin` (`invitations.ts:450`).
- Tenant: ตาราง `invitation` ไม่มี RLS (เป็นตาราง login ตาม DB-06) การแยก tenant ใช้เงื่อนไข `organization_id` ใน query ทุกตัว. Runtime role มี `select, insert, update, delete` ทั้งตาราง (`packages/db/migrations/0001_auth_foundation.sql:140-142`) คอลัมน์ใหม่จึงไม่ต้องเพิ่ม grant. ไม่พบ policy ที่ระบุชื่อ `invitation` ใน migrations (ค้นด้วย grep).
- ไม่พบ rate limiter ที่ผูกกับ `registerOrganizationInvitationRoutes` (`apps/api/src/app.ts:486`). Limiter ระดับ global ยังไม่ตรวจ.

### Contract ที่เสนอ (ตัวเลือก B)

คอลัมน์ใหม่บน `invitation` (nullable):

| คอลัมน์ | ชนิด | ความหมาย |
| --- | --- | --- |
| `email_dispatch` | text, CHECK `in ('accepted','failed')` หรือ null | ผลการส่งครั้งล่าสุด; null คือไม่ทราบ (แถวเก่า หรือ process ตายก่อนบันทึกผล) |
| `email_dispatch_at` | timestamptz | เวลาบันทึกผล; CHECK `(email_dispatch is null) = (email_dispatch_at is null)` |

- ไม่เก็บข้อความ error ของ SMTP (อาจมีที่อยู่ผู้รับหรือข้อมูลเซิร์ฟเวอร์).
- `rotateInvitationId` ตั้งสองคอลัมน์เป็น null ใน `update` เดียวกับ `sent_at` เพื่อไม่ให้สถานะ `failed` ของการส่งก่อนหน้าค้างเมื่อมีการส่งใหม่ (ครอบคลุมทางส่งซ้ำของ route และของ operator). การสร้างใหม่เริ่มเป็น null โดยค่าเริ่มต้น.
- เขียนผลหลังส่ง ใน transaction สั้นแยกต่างหาก (REQ-01 ห้ามเรียกเครือข่ายใน transaction): `update invitation set email_dispatch = $outcome, email_dispatch_at = clock_timestamp() where id = $sentBearerId and organization_id = $org and status = 'pending'`. เงื่อนไข `id = $sentBearerId` สำคัญ: การส่งซ้ำเปลี่ยน `id` ดังนั้นผลของการส่งเก่าที่มาช้าจะ update 0 แถวและไม่ทับสถานะของการส่งใหม่ (รูปแบบเดียวกับ JOB-07).
- ผลลัพธ์ของ route สร้างและส่งซ้ำไม่เปลี่ยน (`emailDispatch` เดิมยังอยู่).
- List: เพิ่ม `emailDispatch: z.enum(["accepted","failed"]).nullable()` ใน `pendingInvitationSchema`. เป็นฟิลด์เพิ่ม ค่าอื่นของ response ไม่เปลี่ยน. ผู้ใช้อื่นของ contract นอก web ไม่พบ (ค้นใน `apps` และ `packages`).
- CLI ของ operator: ไม่บันทึกผลส่ง เพราะก่อนเจ้าของคนแรกตอบรับ ยังไม่มีสมาชิกคนใดเปิดรายการคำเชิญได้. คงเพียงการ reset เป็น null ที่ `rotateInvitationId`.
- Audit event ใหม่: ไม่มี. F-007 บันทึกเฉพาะกิจกรรมที่สำเร็จ (E-002:28) และการส่งล้มเหลวมี log `warn` อยู่แล้ว (`routes.ts:348-351`, `:382-386`).
- Cooldown หลังส่งไม่สำเร็จ: ดูตัวเลือกด้านล่าง.

### ข้อมูล retention และความเป็นส่วนตัว

คอลัมน์เก็บสถานะและเวลาเท่านั้น ไม่เก็บอีเมลเพิ่มจากที่แถวมีอยู่. แถว `invitation` ไม่พบกระบวนการลบตามเวลา (ยังไม่ตรวจเต็ม) จึงไม่เพิ่มหรือลดอายุข้อมูลเดิม. ผู้เห็นสถานะคือ `owner` และ `admin` กลุ่มเดียวกับที่เห็นอีเมลผู้รับในรายการอยู่แล้ว.

### Migration (expand/contract)

Expand: `0041` เพิ่มสองคอลัมน์พร้อม CHECK ในไฟล์เดียว (DB-12). ไม่มี contract phase เพราะเป็นการเพิ่มล้วน; revert UI ปล่อยคอลัมน์ไว้โดยไม่มีผู้ใช้. Backfill ไม่ทำ (แถวเก่าเป็น null = ไม่ทราบ ซึ่ง UI ไม่แสดงสถานะ).

### Failure modes และ test ที่ต้องมี

- `viewer` และ `auditor` ได้ 403 `PERMISSION_DENIED` ที่ list ซึ่งมีฟิลด์ใหม่; ผู้ที่ไม่ใช่สมาชิกได้ 403 `MEMBERSHIP_DENIED`.
- `admin` ของ org A ส่งซ้ำด้วย `publicId` ของ org B ได้ 404 `INVITATION_NOT_FOUND` และ list ของ A ไม่มีแถวของ B.
- `admin` ส่งซ้ำคำเชิญ role `owner` ได้ 403 (พฤติกรรมเดิม ต้องไม่ถอย).
- ส่งล้มเหลวแล้ว list แสดง `failed`; ส่งสำเร็จครั้งถัดไปล้างเป็น `accepted`.
- Process ตายก่อนบันทึกผล: สถานะเป็น null และ list ไม่ล้ม.
- การเขียนผลของการส่งเก่าหลังการส่งซ้ำ update 0 แถว (ทดสอบลำดับ: ส่ง A, ส่งซ้ำ B, เขียนผล A).
- แถวเก่าก่อน `0041` อ่านได้เป็น null; migration มี test ตามแบบ `invitation-migration.db.test.ts`.
- กติกา cooldown ตามตัวเลือกที่เลือก, `codegen:check`.
- ขยายไฟล์ `invitation-resend.db.test.ts`, `invitation-list.db.test.ts`, `routes.db.test.ts`.

### ผู้ตัดสินต้องเลือก

สถานะ:

| ตัวเลือก | เนื้อหา | ขนาด |
| --- | --- | --- |
| A | ไม่เก็บสถานะ คงข้อความเตือนครั้งเดียว (ปัจจุบัน) | 0 |
| B (แนะนำ) | เก็บสถานะส่งล่าสุดบนแถวคำเชิญตามข้างบน | M |
| C | outbox และ retry ด้วย job | L |

C ยังไม่ตรวจว่าตาราง `notification_email_jobs` (`0035_notification_email_jobs.sql`) ใช้ซ้ำได้หรือไม่ ตารางนั้นผูกกับ intent ของการแจ้งเตือน.

Cooldown หลังส่งไม่สำเร็จ:

| ตัวเลือก | เนื้อหา |
| --- | --- |
| C1 | คง 300 วินาที; แถวแสดง "ส่งอีเมลไม่สำเร็จ" และเวลาที่ส่งซ้ำได้ |
| C2 (แนะนำ) | เมื่อ `email_dispatch = 'failed'` ใช้ cooldown สั้นลง (ข้อเสนอ 30 วินาที, ตัวเลขยังไม่ตัดสิน) |
| C3 | ไม่มี cooldown เมื่อ `failed` |

C3 เปิดให้ผู้จัดการยิง SMTP ได้ไม่จำกัดเพราะไม่มี limiter (ดูข้างบน). C2 จำกัดความถี่โดยไม่ต้องรอ 5 นาทีหลังความล้มเหลว.

ผู้ตัดสิน: กติกาที่ผู้ใช้เห็น (B, C1 ถึง C3) คือ Product Owner role (ยังไม่ระบุ); ขอบเขตความถี่ที่ยอมรับได้คือเจ้าของด้าน security ของ organization/auth (ยังไม่ระบุ).

ขนาดงาน: B + C2 = M.

---

## 3. INV-09: ดาวน์โหลดแถวที่ข้ามและไม่ผ่านจาก preview

### ปัจจุบัน (ตรวจจากโค้ด)

- Response ของ preview มี `rows` ครบทุกแถวที่ข้ามหรือไม่ผ่านอยู่แล้ว: `line`, `system`, `vendor`, `product`, `version`, `outcome`, `reason` (`packages/api-contract/src/inventory-import.ts:41-51`, `:74-83`) ไม่มีเพดานจำนวนใน schema. เพดานอยู่ที่ไฟล์: 5000 แถวและ 2 MB (`packages/api-contract/src/inventory.ts:35-36`). แต่ละแถวที่ข้ามหรือไม่ผ่านเพิ่มหนึ่งรายการ (`apps/api/src/inventory/import-plan.ts:99-113`).
- Web ถือข้อมูลนี้ในหน่วยความจำแล้ว และแบ่งหน้าฝั่ง client หน้าละ 50 (`apps/web/src/pages/inventory/ImportPage.tsx:162-171`). ที่มาคือ `GET .../import-previews/current` (`apps/api/src/inventory/routes.ts:227-250`) ซึ่งใช้ action `inventory.write` (`apps/api/src/inventory/import.ts:266-285`).
- สิทธิ์: `inventory.write` อนุญาต `orgAdmin` และ `projectAdmin` ปฏิเสธ `projectMember` (`apps/api/src/projects/access.ts:78-82`). ผู้ใช้ต้องเป็นผู้สร้าง preview ด้วย: query กรอง `tenant_id`, `project_id`, `created_by`, `expires_at > clock_timestamp()` (`import.ts:278-279`) และ `asUser` ตั้ง `app.user_id` (`import.ts:104-106`).
- ฐานข้อมูล: `inventory_previews` เป็นตารางรายผู้ใช้ มี restrictive guard บน tenant และ user, `FORCE ROW LEVEL SECURITY`, policy ผูก `tenant_id` กับ `created_by`, grant เฉพาะ `select, insert, delete` (`packages/db/migrations/0040_inventory_import_preview.sql:25-73`). อายุไม่เกิน 30 นาทีบังคับด้วย CHECK (`0040:38-40`). Worker role `inventory-maintenance` ลบแถวที่หมดอายุแม้ไม่มีใครเปิดหน้า ผ่านฟังก์ชัน `purge_expired_inventory_previews` (`0040:75-122`; ระบุใน `docs/architecture.md` หัวข้อ System parts). นี่คือกลไกของ R-07.
- Export ที่มีอยู่ `GET .../systems/{systemId}/rejected-rows/export` ใช้ action `inventory.read` และส่งออกแถวที่เก็บไว้ใน System ไม่ใช่แถวใน preview (`routes.ts:561-593`, `apps/api/src/inventory/service.ts:181`). Export ของ inventory ไม่บันทึก audit event (ไม่พบ `recordAuditEvent` ใน `export.ts` และ `service.ts`). เซลล์ใน XLSX เป็น string cell ทั้งหมดเพื่อไม่ให้ค่าที่ขึ้นต้นด้วย `=`, `+`, `-`, `@` ถูกประเมินเป็นสูตร (`export.ts:63-67`). ไฟล์ audit CSV ใช้ `csvCell` ใส่ `'` นำหน้า (`apps/worker/src/audit/file.ts:42-49`).
- `apps/web/package.json` ไม่มี dependency สำหรับ Excel หรือ CSV. มีการใช้ `Blob` กับ `createObjectURL` ใน `apps/web/src/lib/api/client.ts` และ `apps/web/src/pages/settings/MfaCard.tsx` (ยังไม่ตรวจรายละเอียด).
- ข้อกำหนดของ E-005: `Q-19` ให้เก็บแถวที่ parse แล้วไม่เกิน 30 นาที เฉพาะผู้ import เห็น ลบเมื่อยืนยัน ยกเลิก หรือหมดอายุ (E-005:172, :219). `R-07` ให้ลบเมื่อหมดอายุแม้ไม่มีใครเปิดหน้า (E-005:240).

ข้อสรุป: ข้อความในรายงานว่า "ต้องเพิ่ม endpoint ใหม่" ไม่จริงทั้งหมด. ไฟล์ที่สร้างในเบราว์เซอร์จาก `preview.rows` ไม่ต้องมี endpoint ไม่มีการเก็บใหม่ และไม่เปิดข้อมูลเกินที่ `GET current` ให้อยู่แล้ว. ข้อจำกัด: `InventoryImportRow` ไม่มีคอลัมน์ Owner ไฟล์จึงนำกลับไป import แก้แล้วไม่ได้ตรง ๆ.

### Contract ที่เสนอ

ตัวเลือก A (แนะนำ): ไม่มีการเปลี่ยน API. Web สร้างไฟล์จาก `preview.rows`:

- คอลัมน์: `line`, `system`, `vendor`, `product`, `version`, `outcome`, ข้อความเหตุผลจาก `inventoryImportReasonMessage` (ฟังก์ชันใน contract ที่ browser-safe, `inventory-import.ts:141-157`).
- ทุกเซลล์ต้องกันสูตร: ค่าขึ้นต้นด้วย `=`, `+`, `-`, `@`, tab, CR ใส่ `'` นำหน้า แบบ `csvCell` (`apps/worker/src/audit/file.ts:42-49`) เพราะ `product` และ `vendor` มาจากไฟล์ลูกค้า.
- ไม่มี request ใหม่ ไม่เขียนลงฐานข้อมูล ไม่มี audit event.

ตัวเลือก B: endpoint ฝั่ง server ที่ให้ไฟล์ที่มี Owner และนำกลับไป import ได้:

`GET /api/organizations/{organizationId}/projects/{projectId}/inventory/import-previews/{previewId}/rejected-rows/export` (ใช้ `previews` ที่ `routes.ts:53`).

| หัวข้อ | ข้อกำหนด |
| --- | --- |
| Action | `inventory.write` ผ่าน `withProjectAccess` เหมือน `getImportPreview` |
| ขอบเขตผู้ใช้ | `asUser` และเงื่อนไข `created_by`, `tenant_id`, `project_id`, `id = $previewId`, `expires_at > clock_timestamp()` |
| ไม่พบ, ของผู้ใช้อื่น, หมดอายุ, ข้าม tenant | 404 `INVENTORY_PREVIEW_NOT_FOUND` (รหัสเดิมที่ `import.ts:79-85`) |
| Response | XLSX แบบ string cell เหมือน `export.ts`, `Cache-Control: no-store`, ไม่เก็บไฟล์, ไม่เขียนตาราง |
| Parameter | `previewId` เป็น `z.uuid()` เหมือน `previewParams` |
| Rate limit | คีย์แยกจาก `limitImports` (`import.ts:49-71`) ผ่าน limiter เดิม; ไม่มี limiter ตอบ 503 `RATE_LIMIT_UNAVAILABLE` ตามแบบเดิม |
| Audit event | ไม่เขียน ให้ตรงกับ export เดิม (ผู้ตัดสินยืนยัน) |

ตัวเลือก C: query parameter กรองบน `GET current` (`outcome`, `reasonCode`): ไม่แนะนำ เพราะ response มีข้อมูลครบอยู่แล้ว และการกรองทำฝั่ง web ได้.

### ข้อมูล retention และความเป็นส่วนตัว

- A และ B ไม่เพิ่มการเก็บฝั่ง server. อายุของแถวยังเป็นไม่เกิน 30 นาทีและถูกลบตาม R-07.
- ไฟล์ที่ผู้ใช้ดาวน์โหลดเป็นสำเนาบนเครื่องผู้ใช้ที่อยู่เกิน 30 นาที ทั้งใน A และ B. Q-19 และ R-07 พูดถึงการเก็บฝั่ง server ไม่ได้พูดถึงสำเนาที่ผู้ใช้ดาวน์โหลด. ผู้ตัดสินต้องยืนยันว่าสำเนานี้อยู่นอกขอบเขตของ Q-19. ข้อมูลในไฟล์คือข้อมูลชุดเดียวกับที่ผู้ import เห็นบนหน้าจออยู่แล้ว.
- ถ้าผู้ตัดสินเห็นว่า Q-19 ต้องครอบคลุมสำเนาที่ดาวน์โหลด หรือเปลี่ยนความหมายของ "เฉพาะผู้ import" ต้องออก E-005 revision ใหม่ (r12) และอนุมัติใหม่ก่อน implement. เอกสารนี้ไม่แก้ E-005.

### Migration

ไม่ต้องมีทั้ง A และ B.

### Failure modes และ test ที่ต้องมี

ตัวเลือก A (test ฝั่ง web ตรวจพฤติกรรม ไม่ตรวจข้อความไทย):

- ไฟล์มีทุกแถวของ `preview.rows` และจำนวนแถวตรง.
- เซลล์ที่ขึ้นต้นด้วย `=`, `+`, `-`, `@` ถูกกันสูตร.
- ปุ่มไม่แสดงเมื่อ `rows` ว่าง.

ตัวเลือก B (integration test ฐานข้อมูลจริง, เพิ่มใน `apps/api/src/inventory/import.db.test.ts`):

- ผู้ดูแลอีกคนของโปรเจกต์เดียวกันที่ไม่ใช่ผู้ import ได้ 404 สำหรับ `previewId` ของผู้ import (RLS และ `created_by`).
- `owner` หรือ `admin` ของ org ที่ไม่ใช่ผู้ import ได้ 404.
- `projectMember` (ไม่ใช่ผู้ดูแล) ได้ 403 `PERMISSION_DENIED`; ผู้ที่ไม่ใช่สมาชิก org ได้ 403 `MEMBERSHIP_DENIED`; โปรเจกต์ที่มองไม่เห็นได้ 404.
- `previewId` ของ org B ใต้ path ของ org A ได้ 404.
- Preview ที่หมดอายุ และที่ถูกลบด้วย `purge_expired_inventory_previews` ได้ 404.
- ระหว่างและหลังเรียก: จำนวนแถว `inventory_previews` และ `audit_events` ไม่เปลี่ยน; header มี `no-store`.
- ค่า `product` ที่ขึ้นต้นด้วย `=` ถูกเขียนเป็น string cell.
- เกิน rate limit ตอบ 429; ไม่มี limiter ตอบ 503.
- `codegen:check` (response แบบ binary เหมือน export เดิม).

### ผู้ตัดสินต้องเลือก

| ตัวเลือก | เนื้อหา | ขนาด |
| --- | --- | --- |
| A (แนะนำ) | สร้างไฟล์ในเบราว์เซอร์จาก `preview.rows` ไม่มี API ใหม่ | S |
| B | endpoint ใหม่ของผู้ import พร้อมคอลัมน์ Owner | M |
| C | filter ผ่าน query parameter | M (ไม่แนะนำ) |

เลือก B เฉพาะเมื่อไฟล์ต้องนำกลับไป import ได้ (ต้องมี Owner). ข้อกำหนดนี้ยังไม่มีใน E-005 ที่ตรวจ.

ผู้ตัดสิน: security owner ของ E-005 (E-005:376 บันทึกบทบาทนี้ให้ "ผู้ใช้" ไม่มีชื่อบุคคลในเอกสาร จึงยังไม่ระบุชื่อ) สำหรับเรื่อง Q-19 และ R-07. เจ้าของ E-005 (ยังไม่ระบุชื่อ) ยืนยันว่าปุ่มดาวน์โหลดไม่เปลี่ยน AC ของ F-022 (ยังไม่ตรวจข้อความ F-022 ฉบับเต็ม).

ขนาดงาน: A = S, B = M.

---

## 4. PRJ-06: ชื่อโปรเจกต์ในแจ้งเตือนมอนิเตอร์

### ปัจจุบัน (ตรวจจากโค้ด)

- Contract: `monitorSubjectSchema` มี `projectId`, `monitorId`, `monitorName`, `monitorHostname` ไม่มีชื่อโปรเจกต์ (`packages/api-contract/src/notification.ts:51-58`). `VULNERABILITY_NEW` มี `projectName` (`notification.ts:104-115`).
- เขียน: Worker อ่านมอนิเตอร์ด้วย `select name, url, project_id ... from monitors` (`apps/worker/src/monitor/record-result.ts:140-145`), สร้าง context (`record-result.ts:184-193`) แล้ว `writeMonitorNotification` (`apps/worker/src/monitor/notifications.ts:33-38`) เรียก `insertMonitorNotificationIntent` (`packages/db/src/notification.ts:268-322`). การเขียนอยู่ใน transaction เดียวกับผลตรวจ.
- เก็บ: คอลัมน์ `subject_project_name` มีอยู่แล้วทั้ง `notification_intents` และ `notification_inbox_items` (`packages/db/migrations/0034_vulnerability_notifications.sql:10`, `:16`) แต่ CHECK `notification_intents_vulnerability_subject` และ `notification_inbox_items_vulnerability_subject` บังคับ `subject_project_name is null` เมื่อ event ไม่ใช่ `VULNERABILITY_NEW` (`0034:54-58`, `:97-101`). แถวมอนิเตอร์ที่มีชื่อโปรเจกต์จึงถูกปฏิเสธ ต้องแทนที่ constraint ทั้งสอง. `0027_notification_monitor_hostname.sql` เป็นแบบอย่างของการเพิ่มฟิลด์ event-time ที่ nullable.
- คัดลอกไป inbox: `apps/worker/src/materialize.ts:117-128` คัดลอก `intent.subject_project_name` อยู่แล้ว.
- อ่าน: การแปลงเป็น response ของ monitor อยู่ที่ `apps/api/src/notifications/service.ts:125-135` และของ `VULNERABILITY_NEW` ที่ `:96-114`.
- การเข้าถึง: ผู้อ่านเห็นรายการมอนิเตอร์ได้เมื่อเห็นโปรเจกต์ (owner/admin ของ org หรือสมาชิกโปรเจกต์) ผ่าน `monitorProjectAccess` (`service.ts:298`, ใช้ที่ `:369`, `:479`, `:514`, `:580`). รายการของโปรเจกต์ที่ถูกลบหรือที่ผู้อ่านไม่มีสิทธิ์จึงไม่ถูกส่ง.
- ทาง cache: `projectQueryKeys.list` (`apps/web/src/lib/api/projects.ts:41-42`) ถูกโหลดโดย `useCurrentProject` ใน shell (`apps/web/src/components/shell/useCurrentProject.ts:55-59`). `listProjects` คืนโปรเจกต์ที่ผู้อ่านเห็น (owner/admin เห็นทั้งหมด คนอื่นเห็นเฉพาะที่เป็นสมาชิก) (`apps/api/src/projects/service.ts:194-220`) ไม่เกิน 50 โปรเจกต์ (`packages/api-contract/src/project.ts:9`). ชื่อโปรเจกต์ยาวไม่เกิน 80 (`project.ts:11`). ยังไม่ตรวจว่าหน้า `/notifications` อยู่ใน shell ที่โหลดรายการนี้เสมอ.
- หน้า: `itemTitle` และ `itemContext` ใน `apps/web/src/pages/NotificationsPage.tsx:66-90`, `:96-105`.

### Contract ที่เสนอ

ตัวเลือก A (แนะนำ ก่อน): web อย่างเดียว. ค้นชื่อโปรเจกต์จาก `projectId` ในรายการโปรเจกต์ที่ cache ด้วย `useQuery` คีย์เดิม (ไม่เพิ่มการเรียก) แสดงในบรรทัด context. ถ้าไม่พบ `projectId` ในรายการ ไม่แสดงชื่อ. ชื่อที่แสดงเป็นชื่อปัจจุบันไม่ใช่ชื่อ ณ เวลาเกิดเหตุ. ไม่มีการเปลี่ยน API หรือ migration. ไม่เปิดข้อมูลใหม่: รายการที่ผู้อ่านได้รับมีเฉพาะโปรเจกต์ที่ผู้อ่านเห็นอยู่แล้วในรายการ.

ตัวเลือก B: `projectName` ณ เวลาเกิดเหตุ.

- `monitorSubjectSchema` เพิ่ม `projectName: z.string().min(1).max(200).nullable()` (nullable เพราะแถวเก่าไม่มี). Client เก่าไม่พังเพราะเป็นฟิลด์เพิ่ม.
- Worker อ่าน `projects.name` ในคำสั่งอ่านมอนิเตอร์ที่ `record-result.ts:140-145` (join ด้วย `tenant_id` และ `id`), ส่งผ่าน `MonitorEvent` ไปยัง `MonitorNotificationInput.projectName` และ insert ที่ `packages/db/src/notification.ts:295-318` ตัดที่ 200 ตัวอักษรแบบ `:554`. ยังไม่ตรวจว่า RLS ของ `projects` ให้ Worker อ่านชื่อในบริบทนั้นได้.
- `materialize.ts` ไม่ต้องแก้.
- `notifications/service.ts` ใส่ `projectName: row.subjectProjectName` ใน subject ของมอนิเตอร์.
- Migration แทนที่ CHECK ทั้งสองให้ `subject_project_name` เป็น null หรือยาว 1 ถึง 200 สำหรับ `MONITOR_%` และคงกฎ null สำหรับ event ประเภทอื่นที่ไม่ใช่ `VULNERABILITY_NEW`.
- การเข้าถึงไม่เปลี่ยน (`monitorProjectAccess` เดิม).
- Audit event ใหม่: ไม่มี.

### ข้อมูล retention และความเป็นส่วนตัว

B เก็บชื่อโปรเจกต์ (ข้อมูล tenant ที่ผู้อ่านรายการเห็นอยู่แล้ว) ในแถวแจ้งเตือนซึ่งมีอายุตามนโยบายเดิมของแจ้งเตือน (ยังไม่ตรวจค่าอายุ; `expires_at` ถูกใช้ที่ `service.ts:514`). ชื่อโปรเจกต์ที่เปลี่ยนทีหลังไม่ถูกแก้ย้อนหลังในแถวเก่า ตั้งใจให้เป็นชื่อ ณ เวลาเกิดเหตุ. A ไม่เก็บอะไรเพิ่ม.

### Migration (ตัวเลือก B)

- Expand: `0041` เพิ่มความสามารถให้แถวมอนิเตอร์มีชื่อโปรเจกต์ โดย drop แล้ว add CHECK ทั้งสองตัว (`notification_intents_vulnerability_subject`, `notification_inbox_items_vulnerability_subject`) ใน migration เดียว. ไม่ต้องเพิ่มคอลัมน์.
- ยังไม่ตรวจขนาดตาราง `notification_inbox_items`. ถ้าใหญ่ ให้ใช้ `not valid` แล้ว `validate constraint` แยก migration เพื่อลดการล็อกตอน scan.
- ข้อควรระวังลำดับ deploy: Worker ใหม่เขียนชื่อได้ก็ต่อเมื่อ migration ผ่านแล้ว. ต้องออก migration ก่อน Worker (expand ก่อน).
- Contract phase: ไม่มี. แถวเก่าเป็น null แล้ว UI ถอยไปใช้ชื่อจาก cache (A).

### Failure modes และ test ที่ต้องมี

ตัวเลือก A (vitest ฝั่ง web, ตรวจ test id ไม่ตรวจข้อความ):

- ชื่อโปรเจกต์แสดงเมื่อ `projectId` อยู่ในรายการ.
- ไม่แสดงและไม่ error เมื่อรายการยังไม่โหลด โหลดผิดพลาด หรือไม่มี `projectId`.
- เปลี่ยน organization แล้วไม่ใช้ cache ของ organization เดิม (WEB-03).

ตัวเลือก B (integration ฐานข้อมูลจริง; ขยาย `apps/api/src/notifications/monitor-items.db.test.ts`):

- Insert intent มอนิเตอร์พร้อม `projectName` แล้ว materialize ลง inbox ได้ค่าเดียวกัน; แถวเก่าเป็น null.
- API ส่ง `subject.projectName` ให้ผู้อ่านที่เห็นโปรเจกต์ และผู้อ่านของ org อื่นไม่ได้รายการ.
- ผู้อ่านที่ถูกถอนออกจากโปรเจกต์ไม่ได้รายการ (กลุ่ม `monitor items follow Project access`, `:247`) และ 403 ของผู้ที่ไม่ใช่สมาชิก.
- ฐานข้อมูลปฏิเสธชื่อโปรเจกต์ใน event ประเภทที่ไม่อนุญาต และชื่อที่ยาวเกิน 200.
- `codegen:check`.

### ผู้ตัดสินต้องเลือก

| ตัวเลือก | เนื้อหา | ขนาด |
| --- | --- | --- |
| A (แนะนำ) | ใช้ชื่อปัจจุบันจาก cache รายการโปรเจกต์ ไม่มี API ใหม่ | S |
| B | `projectName` ณ เวลาเกิดเหตุ พร้อม migration และแก้ Worker | M |
| C | A ก่อน แล้ว B เมื่อมีความต้องการชื่อ ณ เวลาเกิดเหตุ | S แล้ว M |

เหตุผลที่แนะนำ A: ความต่างของ B จาก A เกิดเฉพาะเมื่อโปรเจกต์ถูกเปลี่ยนชื่อหลังเกิดเหตุ (โปรเจกต์ที่ถูกลบไม่มีรายการเหลือให้เห็น ตาม `monitorProjectAccess`). B แตะ migration กับ Worker ที่เขียนข้อมูลในทุกผลตรวจ.

ผู้ตัดสิน: Product Owner role (ยังไม่ระบุ) ว่าต้องการชื่อ ณ เวลาเกิดเหตุหรือไม่.

ขนาดงาน: A = S, B = M.

---

## 5. AUTH-02b: แยกสถานะคำเชิญที่หมดอายุ ถูกเพิกถอน ถูกรับแล้ว และไม่มีอยู่

### ปัจจุบัน (ตรวจจากโค้ด)

- Preview เป็น route สาธารณะ ไม่ต้องมี session: `GET /api/onboarding/invitations/{invitationId}` (`apps/api/src/onboarding/routes.ts:14-32`, `:62-66`). Parameter เป็น `z.string().min(1)` ไม่มีความยาวสูงสุด (`routes.ts:20`). การลงทะเบียน route รับเฉพาะ `database` และ `auth` ไม่มี limiter (`apps/api/src/app.ts:463`). Limiter ระดับ global ยังไม่ตรวจ.
- เงื่อนไข lookup คือ `i.status = 'pending' and i.expires_at > now()` (`apps/api/src/auth/invitations.ts:29`). ไม่ตรงเงื่อนไขทั้งหมดตอบ 404 `INVITATION_NOT_FOUND` ข้อความ "ไม่พบคำเชิญ หรือคำเชิญหมดอายุแล้ว" (`apps/api/src/onboarding/service.ts:15-26`).
- Response ที่สำเร็จคืน `email`, `organizationName`, `role`, `expiresAt` ให้ผู้ถือ id (`packages/api-contract/src/auth.ts:158-166`).
- Accept ต้องมี session ที่ยืนยันอีเมล (`routes.ts:68-77`, `requireVerifiedSession` ที่ `apps/api/src/me/service.ts:64-76`) แล้วตอบ 404 เหมือนกันทั้ง: ไม่มีแถว, ไม่ pending, หมดอายุ, อีเมลไม่ตรงกับ session (`service.ts:50-77`). 409 `USER_ALREADY_MEMBER` และ `ORGANIZATION_MEMBERSHIP_LIMIT_REACHED` แยกอยู่แล้ว.
- สมัครสมาชิก: ทุกความล้มเหลวคืน 403 `INVITATION_REQUIRED` ข้อความเดียว (`auth/invitations.ts:40-55`, comment "One message for every failure").
- `id` ของคำเชิญสร้างด้วย `crypto.randomUUID()` (`apps/api/src/organization-notifications/invitations.ts:91`, `:378`).
- สถานะที่แยกกันไม่ได้อย่างน่าเชื่อถือ: การส่งซ้ำเขียนทับ `id` ในแถวเดิม (`invitations.ts:245`) ลิงก์เก่าจึงเป็น "ไม่รู้จัก" จริง. การสร้างคำเชิญใหม่ให้อีเมลเดิมเปลี่ยนแถว pending ที่หมดอายุเป็น `canceled` (`invitations.ts:85-90`) ดังนั้น `canceled` ปนกันระหว่างผู้ดูแลเพิกถอนกับหมดอายุแล้วถูกแทนที่.
- Log: path ถูกปิดด้วย `:invitationId` และไม่ log `err` ของ path ใต้ `/api/onboarding/invitations/` (`app.ts:313-315`, `:579-581`).
- Web: `AcceptInvitationPage.tsx:44-66` แสดงข้อความ 404 พร้อมอายุ 48 ชั่วโมง และมี branch ของ 410 หรือรหัส `INVITATION_EXPIRED` (บรรทัด 53) ที่ API ไม่เคยส่ง; 404 และ 410 ถือเป็นข้อผิดพลาดสิ้นสุด (บรรทัด 63-66).

### Contract ที่เสนอ (ตัวเลือก B)

คืน 410 `INVITATION_EXPIRED` เฉพาะแถวที่ `status = 'pending' and expires_at <= now()`:

- บน `GET /api/onboarding/invitations/{invitationId}`: body เป็น error envelope มาตรฐานเท่านั้น (REQ-03) ไม่มี `email`, `organizationName`, `role`, `expiresAt`. เพิ่ม schema ของ error ใน `packages/api-contract` (แบบเดียวกับ `auditErrorSchema`) และ response 410 ใน route.
- บน `POST .../accept`: 410 เฉพาะเมื่ออีเมลของแถวตรงกับอีเมลของ session. อีเมลไม่ตรงยังเป็น 404 เพื่อไม่ให้ผู้ที่ล็อกอินด้วยบัญชีอื่นรู้ว่า id นี้เคยมีอยู่.
- ทุกสถานะอื่น (ไม่รู้จัก, ถูกรับแล้ว, `canceled`, id ถูกแทนที่จากการส่งซ้ำ) คง 404 ข้อความเดิม.
- สมัครสมาชิกคง 403 `INVITATION_REQUIRED` ข้อความและ status เดียวกันทุกกรณี ไม่เปลี่ยน.
- ความยาว parameter: เสนอ `.max(64)` ให้ตรงกับ regex `{1,64}` ที่ `apps/api/src/auth/index.ts:79`. ยังไม่ตรวจว่ามี id รูปแบบเก่ายาวกว่า 64 อยู่หรือไม่ (`generateId` ที่ `auth/index.ts` ตั้งเป็น UUID).
- Limiter: เสนอ limiter ต่อ IP บน preview ตาม REQ-04 (Redis sliding window, timeout สั้น, test กรณี limiter ล้ม) เพราะ B ทำให้ route สาธารณะบอกได้ว่า id เคยเป็นคำเชิญ pending. ความเสี่ยงต่ำเพราะ id มี 122 บิตสุ่ม เดาไม่ได้ในทางปฏิบัติ (เป็นข้อสรุปจากการอ่านโค้ด ไม่ได้ทดลองวัด) จึงให้ผู้ตัดสินด้าน security ชี้ว่าจำเป็นหรือไม่.
- Audit event ใหม่: ไม่มี (เป็นการอ่าน). การเก็บ log: คงการปิด path และ `err` เดิม.

### ข้อมูล retention และความเป็นส่วนตัว

ไม่เก็บข้อมูลใหม่. ข้อมูลที่เปิดเพิ่มคือข้อเท็จจริงเดียวว่า id นี้เคยเป็นคำเชิญที่ pending และหมดอายุแล้ว ไม่มีชื่อ org อีเมล หรือ role. ผู้รับข้อมูลคือผู้ถือ id เท่านั้น. เนื่องจากแถว `canceled` ที่เกิดจากการแทนที่ปนกับการเพิกถอน สถานะ "หมดอายุ" ไม่คงอยู่ตลอดไป: หลังมีคำเชิญใหม่ให้อีเมลเดิม ลิงก์เก่ากลับเป็น 404.

### Migration

ไม่ต้องมี.

### Failure modes และ test ที่ต้องมี

- id ไม่รู้จัก ตอบ 404; pending ที่หมดอายุ ตอบ 410; `accepted` ตอบ 404; `canceled` ตอบ 404; id เก่าหลังส่งซ้ำ ตอบ 404.
- Body ของ 410 ไม่มีคีย์ `invitation` และไม่มีอีเมล ชื่อ org หรือ role (assert ชุดคีย์ ไม่ assert ข้อความ).
- Accept: หมดอายุและอีเมลตรง ตอบ 410; หมดอายุแต่อีเมลของ session ต่าง ตอบ 404 เหมือน id ไม่รู้จัก; ผู้ที่ยังไม่ยืนยันอีเมลได้ 403 `EMAIL_NOT_VERIFIED`; ไม่มี session ได้ 401.
- สมัครสมาชิกด้วย id ที่หมดอายุได้ 403 `INVITATION_REQUIRED` เหมือน id ไม่รู้จัก (ข้อความและ status เหมือนกัน).
- Parameter ยาวเกิน 64 ตอบ 400 ในรูปแบบ error เดิม.
- Log ไม่มี `invitationId` (ขยาย `apps/api/src/audit/path-logging.test.ts` หรือ test ที่เทียบเท่า).
- ถ้ามี limiter: เกิน 429; limiter ล้มตอบตามที่ REQ-04 กำหนด.
- ความต่างของเวลาตอบระหว่าง 404 และ 410: ยังไม่ตรวจ.
- `codegen:check`, และ test ฝั่ง web ว่า branch 410 แสดงข้อความหมดอายุ (`AcceptInvitationPage.test.tsx`).

### ผู้ตัดสินต้องเลือก

| ตัวเลือก | เนื้อหา | ขนาด |
| --- | --- | --- |
| A | คง 404 เดียว (ข้อความหน้าจอบอกอายุ 48 ชั่วโมงแล้ว) | 0 |
| B (แนะนำ) | 410 `INVITATION_EXPIRED` เฉพาะ pending ที่หมดอายุ ไม่มีฟิลด์ใน body | M |
| C | แยกครบ 4 สถานะ | ไม่แนะนำ |
| D | แยกเฉพาะใน accept ที่อีเมลตรง ปล่อย preview เป็น 404 | S |

เหตุผลที่ไม่เลือก C: แยก "ถูกเพิกถอน" กับ "หมดอายุแล้วถูกแทนที่" ไม่ได้อย่างถูกต้อง และเปิดการกระทำของผู้ดูแลและสถานะ `accepted` ให้ทุกคนที่ถือลิงก์. D แก้ไม่ถึงกรณีหลัก เพราะลิงก์หมดอายุส่วนใหญ่ถูกเปิดที่ preview ก่อนล็อกอิน.

ผู้ตัดสิน: เจ้าของด้าน security ของ auth (ยังไม่ระบุ) ร่วมกับ Product Owner role (ยังไม่ระบุ) ตาม gate D11 ในรายงาน.

ขนาดงาน: B = M (รวม limiter), A = 0, D = S.

---

## 6. AUTH-03b: `autoSignInAfterVerification`

### ปัจจุบัน (ตรวจจากโค้ด)

- ตั้งค่า: `emailAndPassword.requireEmailVerification: true` (`apps/api/src/auth/index.ts:223`), `emailVerification` มี `sendOnSignUp` และ `sendVerificationEmail` เท่านั้น (`auth/index.ts:235-241`) ไม่มี `autoSignInAfterVerification` และไม่ตั้ง `expiresIn` (ใช้ค่าเริ่มต้นของ library 3600 วินาที ตรงกับ `VERIFICATION_LINK_LIFETIME` ที่ `apps/api/src/auth/emails.ts:8`).
- ลิงก์ในอีเมลชี้ไป web `${APP_URL}/onboarding?emailVerificationToken=...` (`emails.ts:138`) ข้อความบอก "แล้วเริ่มใช้งานบัญชีได้ทันที" (`emails.ts:144`).
- Web: `OnboardingPage` เรียก `authClient.verifyEmail` แล้ว `refetchSession` (`apps/web/src/pages/OnboardingPage.tsx:61-67`). ถ้าไม่มี session ไป `/login` พร้อม `state: { notice: "email-verified" }` (`OnboardingPage.tsx:105-111`); ถ้ามี session ไปต่อที่ accept-invitation หรือหน้าแอป. Web รองรับทั้งสองผลอยู่แล้ว. หลังตั้งรหัสผ่านใหม่ไป `/login` พร้อม `notice: "password-reset"` (`apps/web/src/pages/ResetPasswordPage.tsx:57`).
- พฤติกรรมของ library (`better-auth@1.7.7`, `dist/api/routes/email-verification.mjs`): ผู้ใช้ที่ยืนยันแล้วคืนก่อนถึงจุดสร้าง session (บรรทัด 287-293) จึงการเปิดลิงก์ซ้ำไม่ได้ session. เมื่อเปิด option จะ `createSession` และตั้ง cookie หากไม่มี session ปัจจุบันของอีเมลเดียวกัน (บรรทัด 297-316).
- Hook ของ two-factor ตรงเฉพาะ `/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number` (`better-auth` `dist/plugins/two-factor/index.mjs:245-247`) ดังนั้น session ที่สร้างตอน verify ไม่ผ่านขั้น 2FA. ยังไม่ตรวจว่าผู้ใช้ที่ยังไม่ยืนยันอีเมลเปิด 2FA ได้หรือไม่. API ของแอปปฏิเสธผู้ที่ยังไม่ยืนยันอีเมลที่ `requireVerifiedSession` (`apps/api/src/me/service.ts:64-76`).
- ไม่ตรวจ: ว่า reset password ของ library สร้าง session หรือไม่ (นอกขอบเขตข้อนี้).

### Contract ที่เสนอ

ตัวเลือก A (แนะนำ): ไม่เปิด option. แก้ข้อความอีเมลที่ `emails.ts:144` ให้ตรงกับ flow จริง (ยืนยันแล้วเข้าสู่ระบบ) และคง notice ที่ web มีแล้ว. ไม่มีการเปลี่ยน API contract.

ตัวเลือก B: เพิ่ม `emailVerification.autoSignInAfterVerification: true` ที่ `apps/api/src/auth/index.ts:235-241`.

- ไม่มี endpoint หรือฟิลด์ใหม่ ผลคือ `GET/POST verify-email` ตั้ง cookie session ในเบราว์เซอร์ที่เปิดลิงก์.
- Cookie ใช้แอตทริบิวต์เดิมตาม AUTH-02 (host-only, `HttpOnly`, `SameSite=Lax`, `Secure` ใน production).
- ประเด็น security ที่ต้อง review ก่อนเลือก B:
  1. ลิงก์ในอีเมลเท่ากับการเข้าสู่ระบบโดยไม่ต้องใช้รหัสผ่านภายใน 1 ชั่วโมง. ผู้ที่ถือลิงก์ที่ส่งต่อได้ session ของบัญชีนั้น.
  2. Session นี้ข้าม 2FA (ดูข้างบน). ต้องยืนยันก่อนว่าไม่มีบัญชีที่เปิด 2FA แล้วแต่ยังไม่ยืนยันอีเมล.
  3. Session ไปอยู่ในเบราว์เซอร์ที่เปิดลิงก์ ซึ่งอาจไม่ใช่เบราว์เซอร์ที่สมัคร.
  4. ต้องอัปเดต test e2e ที่คาดว่าไป `/login` (ยังไม่ตรวจรายการ test).
- Audit event ใหม่: ไม่มี. ยังไม่ตรวจว่ามีการบันทึกเหตุการณ์ sign-in ที่อื่นหรือไม่.

### ข้อมูล retention และความเป็นส่วนตัว

A ไม่เก็บข้อมูลใหม่. B สร้างแถว `session` ใหม่ตามอายุ session เดิมของ Better Auth (ตามค่าเริ่มต้น ไม่มีอายุสูงสุดเพิ่มตาม architecture) ไม่มีฟิลด์ส่วนบุคคลเพิ่ม.

### Migration

ไม่ต้องมีทั้ง A และ B.

### Failure modes และ test ที่ต้องมี

ตัวเลือก A: `emails.test.ts` ตรวจว่าอีเมลยืนยันไม่สัญญาการเข้าใช้งานทันที (ตรวจโครงสร้างหรือค่าคงที่ ไม่ตรวจข้อความไทยทั้งประโยค).

ตัวเลือก B (ขยาย `apps/api/src/auth/auth.db.test.ts`):

- Token ที่ถูกต้องตั้ง `emailVerified` และออก session cookie หนึ่งตัว.
- เปิดลิงก์เดิมซ้ำไม่ออก session ใหม่.
- Token ผิดหรือหมดอายุไม่ออก session.
- บัญชีที่มี `twoFactorEnabled` (ถ้าเข้าถึงได้) ไม่ได้ session เต็ม.
- ผู้ใช้ที่ยังไม่ยืนยันอีเมลยังได้ 403 `EMAIL_NOT_VERIFIED` ที่ API ของแอปก่อนยืนยัน.
- ไหลต่อไป accept-invitation ได้เมื่อมี `invitationId` ใน URL.

### ผู้ตัดสินต้องเลือก

| ตัวเลือก | เนื้อหา | ขนาด |
| --- | --- | --- |
| A (แนะนำ) | ไม่เปิด auto sign-in แก้ข้อความอีเมลให้ตรง flow | S |
| B | เปิด `autoSignInAfterVerification` พร้อม security review | M |

ผู้ตัดสิน: เจ้าของด้าน security ของ auth (ยังไม่ระบุ) ร่วมกับ Product Owner role (ยังไม่ระบุ) ตาม gate D11.

ขนาดงาน: A = S, B = M.

---

## ตารางคำถามที่เปิดอยู่

| ID | คำถาม | ตัวเลือก | ข้อเสนอ | ผู้ตัดสิน | ขวางอะไร |
| --- | --- | --- | --- | --- | --- |
| Q-ORG08 | list แสดงค่าอะไรจากการเปลี่ยนแปลง | A / B / C | B | Product Owner role (ยังไม่ระบุ); ถ้า C ต้องมี security owner (ยังไม่ระบุ) | งาน API ของ ORG-08 |
| Q-ORG13a | เก็บสถานะส่งอีเมลบนแถวหรือไม่ | A / B / C | B | Product Owner role (ยังไม่ระบุ) | migration `0041` ส่วนคำเชิญ |
| Q-ORG13b | cooldown หลังส่งไม่สำเร็จ | C1 / C2 / C3 | C2 (30 วินาที, ตัวเลขยังไม่ตัดสิน) | Product Owner role (ยังไม่ระบุ) และ security owner (ยังไม่ระบุ) | ปุ่ม "ส่งซ้ำ" ที่ใช้ได้ทันที |
| Q-INV09a | สร้างไฟล์ในเบราว์เซอร์หรือที่ server | A / B / C | A | security owner ของ E-005 (E-005:376, ไม่มีชื่อบุคคล จึงยังไม่ระบุชื่อ) | INV-09 ทั้งข้อ |
| Q-INV09b | สำเนาที่ดาวน์โหลดอยู่นอกขอบเขต Q-19 หรือไม่ และ endpoint ใหม่ไม่เปลี่ยน AC ของ F-022 หรือไม่ | ใช่ / ไม่ใช่ (ถ้าไม่ใช่ ต้องออก E-005 r12) | ยังไม่มีข้อเสนอ ต้องให้เจ้าของตอบ | security owner และเจ้าของ E-005 (ยังไม่ระบุชื่อ) | การเริ่ม INV-09 |
| Q-INV09c | ไฟล์ต้องนำกลับไป import ได้ (ต้องมี Owner) หรือไม่ | ต้อง / ไม่ต้อง | ไม่ต้อง (ข้อกำหนดนี้ไม่มีใน E-005 ที่ตรวจ) | Product Owner role (ยังไม่ระบุ) | เลือก A หรือ B |
| Q-PRJ06 | ต้องการชื่อโปรเจกต์ ณ เวลาเกิดเหตุหรือไม่ | A / B / C | A (C ถ้ามีความต้องการภายหลัง) | Product Owner role (ยังไม่ระบุ) | migration `0041` ส่วนแจ้งเตือน |
| Q-AUTH02b | แยก 410 สำหรับหมดอายุหรือไม่ และต้องมี limiter บน preview หรือไม่ | A / B / C / D | B พร้อม limiter | security owner ของ auth (ยังไม่ระบุ) และ Product Owner role (ยังไม่ระบุ) (gate D11) | งาน API ของ AUTH-02b |
| Q-AUTH03b | เปิด auto sign-in หรือแก้ข้อความอีเมล | A / B | A | security owner ของ auth (ยังไม่ระบุ) และ Product Owner role (ยังไม่ระบุ) (gate D11) | การเปลี่ยน config ของ auth |
| Q-AUTH03c | บัญชีที่เปิด 2FA แล้วแต่ยังไม่ยืนยันอีเมลมีจริงหรือไม่ (ถ้าเลือก B) | ตรวจ / ไม่ตรวจ | ตรวจก่อนเลือก B (ยังไม่ตรวจ) | security owner ของ auth (ยังไม่ระบุ) | ตัวเลือก B ของ AUTH-03b |

ลำดับ migration ที่ชนกัน: `0041` ถูกอ้างโดยทั้ง ORG-13 และ PRJ-06 (ตัวเลือก B). ถ้าเลือกทั้งสอง ต้องแยกเป็น `0041` และ `0042` ตามลำดับที่ merge.

## สิ่งที่เอกสารนี้ไม่ได้กำหนด

- การออกแบบหน้าจอ ข้อความไทย และสีของ pill ในทุกข้อ (อยู่ใน design system และรายงานรีวิว).
- รายการ allow-list ของ ORG-08 นอกจาก `role`, `monitorAlertsEnabled`, `settingsChangedEnabled`; การเปิดค่าของฟิลด์อื่นใน list.
- outbox หรือ retry อัตโนมัติของอีเมลคำเชิญ (ตัวเลือก C ของ ORG-13) และตัวเลข cooldown ที่แน่นอน.
- รูปแบบไฟล์ที่นำกลับไป import ได้ของ INV-09 (ตัวเลือก B) นอกจากที่ระบุ และการแก้ E-005 หรือ F-022.
- ประวัติการเปลี่ยนชื่อโปรเจกต์ และการแก้ชื่อในแถวแจ้งเตือนเก่า (PRJ-06).
- การแยกสถานะ `canceled` กับ `accepted` ที่ API (AUTH-02b ตัวเลือก C), การเปลี่ยนข้อความของ signup `INVITATION_REQUIRED`, และตัวเลขของ limiter.
- Auto sign-in หลังตั้งรหัสผ่านใหม่ และ flow รีเซ็ต MFA (AUTH-10b).
- ผล security review, ผลวัดขนาด payload หรือประสิทธิภาพ, และผลรัน test ใด ๆ: เอกสารนี้ไม่ได้รันโค้ดหรือ test.
- รายการ test e2e ที่ต้องแก้, การแตกงานเป็น Task, และลำดับ PR.
- โค้ดที่พบระหว่างอ่านแต่ไม่เกี่ยวกับข้อนี้ (เช่น parameter `invitationId` ที่ไม่มีความยาวสูงสุดใน route อื่น) ไม่ได้ถูกแก้หรือประเมิน.
