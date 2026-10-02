# F-007 Technical Spec

Owner: Technical Lead Spec นี้เป็น source of truth ของ implementation และ review หลังผู้ใช้อนุมัติ อ้าง AC ใน `feature.md` โดยไม่ restate

ภาพรวม:
- DB: migration `0019` เพิ่มตาราง `audit_events` (partition รายเดือนตาม `occurred_at`, RLS ต่อ tenant, append-only) และ column `organization.audit_recording_started_at` migration `0020` เพิ่ม `audit_exports` (RLS ต่อ tenant และผู้ขอ เก็บไฟล์ใน PostgreSQL), claim ledger `audit_export_jobs` และชนิด notification `AUDIT_EXPORT_READY`, `AUDIT_EXPORT_FAILED`
- API: ทุก mutation ใน Event inventory เขียน event หนึ่งรายการใน transaction เดียวกับ mutation แทน Pino log หลัง commit ของ `apps/api/src/monitors/audit.ts` endpoint ใหม่ 6 ตัวใต้ `/api/organizations/{organizationId}/audit-log`
- Worker: role ใหม่ `audit-exporter` claim คำขอส่งออกจาก DB (`FOR UPDATE SKIP LOCKED` + lease) สร้างไฟล์ แจ้งผู้ขอ และ purge event ที่พ้น 365 วัน งานไม่ใช้ Redis แต่ process ของ Worker ยังต้องมี `REDIS_URL` (ดู Jobs)
- Web: route รายการและรายละเอียด nav leaf `บันทึกกิจกรรม` (`owner`/`admin`/`auditor`) export dialog และ section `ไฟล์ส่งออกของฉัน`
- ลำดับ PR: 01 → 02 → 03 → (04 และ 05 ขนานกันได้, P1 ของ platform-engineer ตาม 05) → 06

| Field                | Value |
| -------------------- | ----- |
| Feature              | `F-007`, `acceptanceVersion` `F-007-AC-2` (`docs/features/F-007-organization-audit-log/feature.md`) |
| Epic                 | `E-002`, `docs/epics/E-002-organization-member-governance.md` |
| Status               | Approved |
| Approved by user     | 2026-10-03 ผ่าน coordinator (AskUserQuestion) freeze `F-007-AC-1` แล้วแทนด้วย `F-007-AC-2` (frozen, 2026-10-03, ดู Revisions) |
| Start authorization  | None |
| `COMMIT_MODE`        | none |
| `STOP_AT`            | review-ready (ผู้ใช้เลือกใหม่ได้ตอนให้ start authorization) |

ศัพท์ที่ใช้ใน Spec นี้:
- event: แถวใน `audit_events` หนึ่งแถวต่อ mutation ที่สำเร็จหนึ่งครั้ง
- cutoff: `now() - interval '365 days'` ของ statement ที่อ่าน event ที่ `occurred_at < cutoff` ไม่ปรากฏในทุก read
- `retainedFrom`: `greatest(cutoff, organization.audit_recording_started_at)` คือค่า "เก็บย้อนหลังถึง" ของ `AC-09`
- `asOf`: เวลาที่ server ใช้เป็นขอบบนของรายการ เพื่อให้การเปลี่ยนหน้าไม่เลื่อนเมื่อมี event ใหม่
- lease: `claimed_until` ของคำขอส่งออกที่ Worker claim ถ้าเลยเวลานี้ Worker ตัวอื่น claim ซ้ำได้

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

## Contracts

### API

ทุก route:
- ใช้ `requireVerifiedSession`, error envelope REQ-03, shared Zod schema ใน `packages/api-contract` (REQ-02) และ regenerate OpenAPI client (WEB-01)
- ค่า `organizationId` ใน URL เป็น scope hint server ตรวจ membership และ role ทุก request
- non-member และ Organization ที่ไม่มีอยู่ได้ `403 MEMBERSHIP_DENIED` body เดียวกัน (`AC-05`)
- `viewer` ได้ `403 PERMISSION_DENIED` ข้อความ "คุณไม่มีสิทธิ์ดูบันทึกกิจกรรม" (ข้อเสนอสำหรับ `OD-11` ดู Open decisions)
- read ตรวจ membership, role และอ่านข้อมูลใน CTE เดียว (statement snapshot เดียว) ตาม `listOrganizationMembers` (`apps/api/src/organization-notifications/members.ts:92-171`) ไม่ lock
- `auditDenials` บันทึก denial ด้วย action คงที่ `organization.audit-log.list`, `.read`, `.actors`, `.export`, `.exports`, `.download` และ code เท่านั้น
- ไม่มี endpoint แก้หรือลบ event (`AC-20`)

ชนิดข้อมูลร่วม (`packages/api-contract/src/audit-log.ts` ใหม่):
- `AuditCategory`: `monitor | notification_settings | member | invitation | audit_log`
- `AuditAction`: 16 code ในตาราง "การเขียน event" ด้านล่าง
- `AUDIT_ACTION_LABELS`, `AUDIT_CATEGORY_LABELS`: label ไทยตามตาราง Event inventory ของ `feature.md` (P-04) อยู่ใน contract เพราะ API ใช้ค้นหาและเขียนไฟล์ส่งออก web ใช้แสดงผล
- `AuditActor`: `{ userId: string, displayName: string | null, roleAtTime: OrganizationRole, membership: 'current' | 'former' }`
- `AuditTarget` (discriminated union ตาม `type`):
  - `{ type: 'monitor', monitorId: uuid, displayName: string | null, deleted: boolean }`
  - `{ type: 'member', userId: string, displayName: string | null, membership: 'current' | 'former' }`
  - `{ type: 'invitation', publicId: uuid, role: OrganizationRole }`
  - `{ type: 'notification_settings' }`
  - `{ type: 'audit_export', exportId: uuid, format: 'csv' | 'json' }`
- `AuditValue`: `{ kind: 'value', value: string | number | boolean | null } | { kind: 'masked' } | { kind: 'secret_set' } | { kind: 'changed' }` web แสดง `masked` เป็น "•••", `secret_set` เป็น "ตั้งค่าแล้ว", `changed` เป็น "เปลี่ยนแล้ว"
- `AuditChange`: `{ field: AuditChangeField, key?: string, before: AuditValue | null, after: AuditValue | null }` (`null` = ไม่มีค่า) `key` คือชื่อ header, ชื่อ query parameter หรือชื่อช่องค่าลับ
- `AuditChangeField`: `role, monitorAlertsEnabled, settingsChangedEnabled, name, url, method, intervalSeconds, timeoutSeconds, header, queryParam, body, authType, apiKeyHeaderName, expectedStatus, assertions, secret`

**ชื่อที่แสดง (`OD-02`, `OD-16`, `OD-10`):** server อ่านชื่อจาก `"user".name` ตอน query ไม่เก็บใน event ไม่คืนอีเมล
- `membership: 'current'` เมื่อ user ยังเป็นสมาชิกของ Organization นี้ ชื่อคืนเสมอ
- `membership: 'former'`: ค่าเริ่มต้นของ Spec นี้คือ `displayName: null` (UI "ไม่ใช่สมาชิกแล้ว") ตามข้อความ "ชื่อที่แสดงของสมาชิกปัจจุบัน" ใน Fields ของ `feature.md` ถ้า `OD-10` ตัดสินให้แสดงชื่อ เปลี่ยนเฉพาะเงื่อนไข join ใน query เดียว contract ไม่เปลี่ยน
- บัญชีที่ไม่มีแถวใน `"user"` แล้ว: `membership: 'former'`, `displayName: null`
- เป้าหมายมอนิเตอร์: ชื่อจากแถว `monitors` ปัจจุบัน ไม่มีแถวแล้ว: `deleted: true`, `displayName: null` (UI "ถูกลบแล้ว" ไม่มีลิงก์)

**`GET /api/organizations/{organizationId}/audit-log/events`**

- Query:
  - `from`, `to`: ISO 8601 datetime (optional) `from > to` ได้ `400 VALIDATION_ERROR`
  - `categories`: รายการ `AuditCategory` คั่นด้วย comma (optional, ไม่ซ้ำ)
  - `actorUserId`: string `1..128` (optional)
  - `q`: string หลัง trim `1..100` ตัวอักษร ห้าม control character (optional)
  - `asOf`: ISO 8601 datetime (optional)
  - `limit` integer `1..50` default `50`, `offset` integer `>=0` default `0`
- `200 { organizationId, asOf, retainedFrom, recordingStartedAt, events: [{ id: uuid, occurredAt, category, action, actor: AuditActor, target: AuditTarget }], page: { limit, offset, total } }`
- ขอบเขตเวลาที่ใช้จริง: `occurred_at >= greatest(from, retainedFrom)` และ `occurred_at <= least(to, asOf)` `from` ที่เก่ากว่า `retainedFrom` ถูก clamp โดยไม่ error (web กันก่อนตาม `AC-11`)
- `asOf` ไม่ส่งมา: server ใช้ `now()` ของ statement แล้วคืนค่าใน response web ส่งค่าเดิมเมื่อเปลี่ยนหน้าหรือกลับจากรายละเอียด และไม่ส่งเมื่อรีเฟรชหรือเปลี่ยนตัวกรอง `asOf` ในอนาคตใช้ `now()` แทน
- ลำดับ `occurred_at desc, id desc` คงที่ข้ามหน้า
- `offset >= page.total` ตอบ `200` พร้อม `events: []` และ `total` จริง (pattern เดียวกับ `F-006`)
- รายการไม่มี `changes` และไม่มีคอลัมน์ผลลัพธ์ (`AC-02`, `AC-20`)

**`GET /api/organizations/{organizationId}/audit-log/events/{eventId}`**

- `200 { organizationId, event: { id, occurredAt, category, action, actor, target, changes: AuditChange[], exportScope?: { format, from, to, categories, actorUserId, searchApplied: boolean } } }` `exportScope` มีเฉพาะ action `organization.audit-log.export`
- `eventId` ที่ไม่ใช่ UUID, ไม่มีอยู่, `occurred_at < cutoff` หรือเป็นของ Organization อื่น ได้ `404 AUDIT_EVENT_NOT_FOUND` body เดียวกัน (`AC-13`) ตรวจ role ก่อน lookup `viewer` จึงได้ `403` เสมอ

**`GET /api/organizations/{organizationId}/audit-log/actors`**

- `200 { actors: [AuditActor ไม่มี roleAtTime] }` ผู้ดำเนินการที่ไม่ซ้ำกันจาก event ที่ `occurred_at >= retainedFrom` ของ Organization นี้ เรียงตามชื่อแล้ว `userId`
- ตัวเลือกมาจาก event เท่านั้น ไม่อ่านจากตาราง `member` ทั้งหมด `auditor` จึงไม่ได้รายชื่อสมาชิกที่ไม่เคยทำ action ซึ่งตรงกับข้อยกเว้นของ `F-004` `AC-02`

**การค้นหา (`q`, `OD-13`):** server สร้าง predicate จาก `q` ดังนี้ ทุกค่า bind (DB-02) และ escape `%`, `_`, `\` ก่อนใช้ใน `ilike`
1. action code ที่ code หรือ `AUDIT_ACTION_LABELS[code]` มี `q` → `action = any($codes)`
2. `actor_user."name" ilike $pattern` เฉพาะผู้ที่ query คืนชื่อได้ตามกฎชื่อที่แสดง
3. `monitors.name ilike $pattern` หรือ `target_user."name" ilike $pattern` ตามกฎเดียวกัน
4. ถ้า `q` เป็น UUID: `audit_events.id = $uuid` หรือ (`target_type = 'invitation'` และ `target_id = $uuid`)

**`POST /api/organizations/{organizationId}/audit-log/exports`**

- Body: `{ format: 'csv' | 'json', timeZone: string (IANA, ตรวจด้วย schema เดียวกับ preferences), filters: { from, to, categories?, actorUserId?, q? }, asOf }`
- `201 { export: AuditExportRecord }` (ดู list ด้านล่าง)
- ขั้นตอน:
  1. `assertMemberBeforeTenantContext`
  2. read statement เดียว (ไม่ lock) ที่มี `authorization_state` CTE แบบ `listOrganizationMembers` (`members.ts:92-171`): `member`, `authorized` (role `owner`/`admin`) และ `total` ที่นับเฉพาะเมื่อ `authorized` (`cross join authorization_state ... where authorized`) ไม่เป็นสมาชิก → `403 MEMBERSHIP_DENIED`, ไม่ `authorized` → `403 PERMISSION_DENIED` โดยไม่มีจำนวนใน body; `total = 0` → `422 AUDIT_EXPORT_EMPTY`; มากกว่า 50,000 → `422 AUDIT_EXPORT_TOO_LARGE` พร้อม `details: { limit: 50000, total }` ทั้งสอง 422 ตอบได้เฉพาะ `owner`/`admin`
  3. transaction ที่ตั้ง `app.tenant_id` และ `app.user_id`: `organization FOR SHARE` → `member` ของ actor `FOR SHARE` → ตรวจ role ซ้ำ (`403 PERMISSION_DENIED`) → stale transition ของผู้เรียก (ดู "อายุสูงสุดของคำขอ" ใน Data) → insert `audit_exports` และ `audit_export_jobs` (`state = 'queued'`) ที่ `snapshot_at = least(asOf, now())` → `recordAuditEvent` action `organization.audit-log.export` → commit
  4. unique violation ของ `audit_export_jobs_one_in_flight` → `409 AUDIT_EXPORT_IN_PROGRESS` transaction rollback จึงไม่มีคำขอหรือ event (`AC-16`)
- ทุก error ก่อน commit ไม่สร้างคำขอหรือ event (`AC-05`, `AC-16`)
- จำนวนอาจเปลี่ยนระหว่างขั้น 2 กับ 3 ได้เฉพาะเมื่อมี event ใหม่ (event ไม่ถูกแก้หรือลบ ยกเว้น purge ที่ cutoff) ยอมรับ

**`GET /api/organizations/{organizationId}/audit-log/exports`**

- เฉพาะ `owner`/`admin` (`auditor` ได้ `403 PERMISSION_DENIED`) คืนคำขอของผู้เรียกใน Organization นี้ที่สร้างภายใน 7 วัน ใหม่สุดก่อน ไม่เกิน 20 แถว
- ขั้นตอนใน transaction เดียวที่ตั้ง `app.tenant_id` และ `app.user_id` (หลัง `assertMemberBeforeTenantContext`): 1) ตรวจ membership (`403 MEMBERSHIP_DENIED`) 2) ตรวจ role `owner`/`admin` (`403 PERMISSION_DENIED`) 3) stale transition ของผู้เรียก (ดู "อายุสูงสุดของคำขอ" ใน Data) 4) อ่านรายการ ถ้าขั้น 1 หรือ 2 ปฏิเสธ ไม่มีการเขียนใด endpoint นี้จึงเขียนได้เฉพาะแถวของผู้เรียกที่พ้น deadline และ idempotent
- `200 { exports: AuditExportRecord[], inProgress: boolean }`
- `AuditExportRecord`: `{ id, format, status: 'generating' | 'ready' | 'failed' | 'expired', filters: { from, to, categories, actorUserId, q }, timeZone, requestedAt, completedAt: datetime | null, expiresAt: datetime | null, rowCount: number | null, failureCode: 'EXPORT_TOO_LARGE' | 'EXPORT_FAILED' | 'REQUESTER_NOT_AUTHORIZED' | null }` (`REQUESTER_NOT_AUTHORIZED` ผู้ขอเห็นได้เมื่อกลับมาเป็น `owner`/`admin` ภายใน 7 วัน)
- `status` จาก `audit_export_jobs.state`: `queued`/`running` → `generating`; `ready` และ `file_expires_at <= now()` → `expired`
- `filters.q` คืนให้ผู้ขอเองเท่านั้น web ใช้กับปุ่ม `ขอใหม่` (ตัวกรองเดิม)
- `ขอใหม่` ของแถว `failed` และ `expired` (`M-9`, `AC-16` ใน `F-007-AC-2`) ใช้ POST export ตัวเดิม ไม่มี endpoint ใหม่ server ไม่อ้างแถวเดิม: ตรวจ role, นับ, ขีดจำกัด 1 คำขอ และ clamp `from` ที่เก่ากว่า `retainedFrom` เหมือนคำขอแรก (ถ้าไม่เหลือ event ได้ `422 AUDIT_EXPORT_EMPTY`)

**`GET /api/organizations/{organizationId}/audit-log/exports/{exportId}/download`**

- `200` body คือไฟล์ header:
  - `Content-Type: text/csv; charset=utf-8` หรือ `application/json; charset=utf-8`
  - `Content-Disposition: attachment; filename="nightwatch-audit-log-<YYYYMMDDTHHMMSSZ>.<csv|json>"` (เวลา `snapshot_at` UTC ไม่มีชื่อ Organization)
  - `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`
- ตรวจทุกครั้งในหนึ่ง statement: membership, role ปัจจุบัน `owner`/`admin`, `requested_by = session user`, `tenant_id`, สถานะ และ `file_expires_at`
- Errors:
  - `403 MEMBERSHIP_DENIED`: non-member หรือถูกถอน
  - `403 PERMISSION_DENIED`: `viewer`/`auditor` รวมผู้ขอที่ถูกลด role (`AC-23`) web ใช้ handler `403` ของการส่งออก (ดู Web)
  - `404 AUDIT_EXPORT_NOT_FOUND`: id ไม่มี, เป็นของผู้ใช้อื่น หรือของ Organization อื่น body เดียวกัน
  - `409 AUDIT_EXPORT_NOT_READY`: ยังสร้างอยู่หรือล้มเหลว
  - `410 AUDIT_EXPORT_EXPIRED`: พ้น 24 ชั่วโมง
- ไม่สร้าง event (`AC-22`)
- OpenAPI ระบุ response เป็น `string` `format: binary` ทั้งสอง content type

**การเขียน event (`AC-03`, `AC-14`, `AC-21`, `AC-22`):**

`apps/api/src/audit/record.ts` (ใหม่) `recordAuditEvent(client: PoolClient, input: { organizationId, actorUserId, actorRole, action, target, changes, exportScope?, requestId })` insert หนึ่งแถว ใช้ `clock_timestamp()` เป็น `occurred_at` และ derive `category` จาก action service ทุกตัวในตารางด้านล่างรับ `requestId` (จาก `c.get("requestId")`) เพิ่มใน input และเรียก helper ใน transaction เดิมหลัง write สุดท้ายก่อน return

กฎ:
- หนึ่ง mutation ที่เปลี่ยนข้อมูล = หนึ่ง event (`AC-21`) mutation ที่ไม่เปลี่ยนข้อมูล (`changed: false` เช่น pause ซ้ำ, create replay, edit ที่ค่าเหมือนเดิม, settings ที่ค่าเหมือนเดิม) ไม่เขียน event
- `actorRole` คือ role ของ actor ที่ service อ่านใน transaction เดียวกัน (normalize ด้วย `normalizeOrganizationRole`) `enterOrganization` ใน `apps/api/src/monitors/service.ts:152-166` เปลี่ยนให้คืน role
- target ของสมาชิกเก็บ `user_id` (คงอยู่หลังลบแถว `member`) target ของคำเชิญเก็บ `public_id` ไม่เก็บ `invitation.id` เพราะเป็น bearer token และหมุนเมื่อ resend
- ไม่มี FK ไปยัง `monitors`, `member` หรือ `invitation` เพื่อให้ event ของเป้าหมายที่ลบแล้วยังอยู่
- denial และ request ที่ล้มเหลวไม่เขียน event `auditDenials` และ `auditMonitorDenials` (Pino) คงเดิม

| Request | Action | `changes` |
| ------- | ------ | --------- |
| `createMonitor` ที่ `changed: true` | `organization.monitor.create` | `[]` |
| `editMonitor`: config เปลี่ยน | `organization.monitor.update` | ทุก field ที่เปลี่ยน + ช่องค่าลับที่ตั้ง แทนที่ หรือลบ |
| `editMonitor`: config เหมือนเดิม มีการแทนที่ค่าลับอย่างน้อยหนึ่งช่อง | `organization.monitor.secret.replace` | ช่องค่าลับทุกช่องที่เขียน |
| `editMonitor`: config เหมือนเดิม เขียนเฉพาะช่องใหม่ | `organization.monitor.secret.set` | ช่องค่าลับทุกช่องที่เขียน |
| `editMonitor`: config เหมือนเดิม มีแต่การลบช่อง | `organization.monitor.update` | ช่องที่ลบ |
| `pauseMonitor` / `resumeMonitor` ที่ `changed: true` | `organization.monitor.pause` / `.resume` | `[]` |
| `deleteMonitor` | `organization.monitor.delete` | `[]` |
| settings: เปลี่ยนเฉพาะ `monitorAlertsEnabled` | `organization.notification-settings.monitor-alerts.update` | `monitorAlertsEnabled` |
| settings: `settingsChangedEnabled` เปลี่ยน (มีหรือไม่มี `monitorAlertsEnabled`) | `organization.notification-settings.update` | ทุก field ที่เปลี่ยน |
| `updateOrganizationMemberRole` ที่ role เปลี่ยน | `organization.member.role.update` | `role` ก่อน (จาก target ที่ lock) / หลัง |
| `updateOrganizationMemberRole` ที่ค่า `member.role` ที่เก็บอยู่ (raw) เท่ากับ role ที่ขอทุกตัวอักษร | ไม่มี event | no-op: ตอนนี้ service update เสมอ (`members.ts:288-304`) NODE-F007-01 เปลี่ยนให้คืนแถวเดิมโดยไม่ update หลังผ่านทุก check response เหมือนเดิม role แบบ composite เช่น `"viewer,auditor"` ที่ขอเป็น `viewer` ไม่ใช่ no-op: update เป็น `viewer` และเขียน `organization.member.role.update` (คำตัดสิน C3 ของ Technical Lead 2026-10-03) |
| `revokeOrganizationMember` | `organization.member.revoke` | `role` ก่อน / `null` |
| `leaveOrganization` | `organization.member.leave` | `role` ก่อน / `null` (actor และ target คือคนเดียวกัน) |
| `createOrganizationInvitation` | `organization.invitation.create` | `role` `null` / role ของคำเชิญ |
| `resendPendingInvitation` | `organization.invitation.resend` | `[]` |
| `cancelPendingInvitation` | `organization.invitation.cancel` | `role` role ของคำเชิญ / `null` |
| `POST .../audit-log/exports` | `organization.audit-log.export` | `[]` และ `exportScope` |

ทุก code ใน Event inventory ยังเกิดได้ `secret.set` และ `secret.replace` เกิดเฉพาะ edit ที่เปลี่ยนแต่ค่าลับ เพราะไม่มี endpoint ค่าลับแยก (ยืนยัน: `apps/api/src/monitors/routes.ts:77-233`) ตอนนี้ edit หนึ่งครั้งเขียน Pino ได้ถึง 3 บรรทัด (`routes.ts:139-152`) Spec นี้รวมเป็น event เดียว (ข้อเสนอ P-03 ให้ Product Owner ยืนยัน)

**Redaction ของมอนิเตอร์ (`AC-14`, `OD-17`, `OD-19`):** pure function `monitorAuditChanges(previous: StoredConfig, next: StoredConfig, plan, slotNames)` ใน `apps/api/src/monitors/audit.ts` คำนวณจาก `previous` ที่อ่านใต้ `FOR UPDATE` (`service.ts:449-458`)
- `name`, `method`, `intervalSeconds`, `timeoutSeconds`, `authType`, `apiKeyHeaderName`, `expectedStatus` (`expectedStatusText`): `value` ก่อน/หลัง
- `url`: ก่อน/หลังคือ `built.ok ? maskUrl(built.url.href) : maskUrl(url)` โดย `built = buildCheckUrl(url, [])` (`apps/api/src/monitors/service.ts:123-134`) `ok: false` เกิดได้กับแถวเก่าเท่านั้น และ `maskUrl` ของข้อความที่ parse ไม่ได้ตัดทุกอย่างหลัง `?` เป็น `•••` (`packages/shared/src/outbound-http/url.ts:65-72`)
- `queryParam` ต่อชื่อ: `key` = ชื่อ, ก่อน/หลัง = `masked` หรือ `null` (ไม่มี parameter) ไม่เก็บค่า
- `header` ที่ไม่ลับ ต่อชื่อ: `value` ก่อน/หลัง
- `body`: entry เดียว `before: null`, `after: { kind: 'changed' }` เมื่อ `bodyType` หรือ `bodyContent` เปลี่ยน ไม่เก็บชนิดหรือค่า
- `assertions`: `value` เป็นข้อความ canonical ของ assertion ที่ normalize แล้วก่อน/หลัง
- `secret` ต่อช่อง: `key` = ชื่อ header ลับหรือชื่อช่อง auth ตั้งใหม่ `null` → `secret_set`, แทนที่ `secret_set` → `changed`, ลบ `secret_set` → `null`
- `StoredConfig` ไม่มีค่า header ลับ (`apps/api/src/monitors/record.ts:97-109`) แต่ยังมีค่า query parameter (`queryParams[].value`) และ `bodyContent` (`record.ts:110-129`) function อ่านสองค่านี้เพื่อเทียบว่าเปลี่ยนหรือไม่เท่านั้น และไม่คัดลอกลง `changes` test ต้องค้นค่าที่รู้ของทั้งสองใน `changes` ไม่พบ function ไม่รับ `plan.writes[].value` (รับเฉพาะชื่อช่อง)

### Data

Migration ใหม่สองไฟล์ (DB-11, DB-12; ล่าสุดคือ `0018_invitation_management.sql`) และ `packages/db/src/schema.ts` ให้ตรงกัน:
- `packages/db/migrations/0019_organization_audit_log.sql` (NODE-F007-01): `audit_events`, partition และ retention function, `organization.audit_recording_started_at`, role `nightwatch_audit_retention_owner`
- `packages/db/migrations/0020_audit_exports.sql` (NODE-F007-05): `audit_exports`, ledger `audit_export_jobs`, `audit_export_deadline()`, `claim_audit_export()`, `purge_audit_exports()`, role `nightwatch_audit_export_claim_owner` และการเปลี่ยน notification แยกไฟล์เพื่อให้ node ที่ทดสอบ DDL เป็นเจ้าของ migration นั้น เพราะแก้ migration ที่ apply แล้วไม่ได้ (DB-11)

ทุก policy ของ runtime (`*_tenant_context`, `*_user_context`, `*_access`) ตั้ง `to nightwatch` ตาม pattern `0016:191-252` role ที่เป็นเจ้าของ function (claim, retention) มี policy ของตัวเองที่เปิดเฉพาะแถวที่ function ต้องใช้ และไม่ต้องมี `app.tenant_id` หรือ `app.user_id` เพราะทำงานข้าม tenant ภายใน function ที่ขอบเขตจำกัด

ทุกแถวใน `audit_events` บันทึกแบบ in-transaction โดยโครงสร้าง (หลัก "Logging, audit and health") เพราะ `recordAuditEvent` เป็นทางเขียนเดียว denial ยังเป็น Pino log แบบ best-effort ตามเดิม

**`audit_events`** (partitioned by range `occurred_at`)

```sql
create table audit_events (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null references organization(id) on delete cascade,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id text not null,
  actor_role text not null check (actor_role in ('owner','admin','viewer','auditor')),
  category text not null check (category in ('monitor','notification_settings','member','invitation','audit_log')),
  action text not null check (action in (/* 16 code */)),
  target_type text not null check (target_type in ('monitor','member','invitation','notification_settings','audit_export')),
  target_id text,
  target_attributes jsonb not null default '{}'::jsonb,
  changes jsonb not null default '[]'::jsonb,
  request_id text,
  primary key (id, occurred_at)
) partition by range (occurred_at);
```

- `on delete cascade` ของ `tenant_id` (accepted, code review C4 ของ NODE-F007-01, 2026-10-03): implementation deviation ที่ commit แล้วใน `a401e91` Spec ที่อนุมัติไม่ได้ระบุ action ของ FK เหตุผล: ทุกตาราง tenant cascade จาก `organization` อยู่แล้ว (`0001_auth_foundation.sql:88`, `:102`, `0002`, `0016`), ผลิตภัณฑ์ปิดการลบ Organization (`BLOCKED_NATIVE_ORGANIZATION_MUTATION_PATHS`), operator path `provision-e2e-fixture.ts:112` และ test ประมาณ 15 ชุดลบ Organization การลบ Organization จึงลบ event ของ Organization นั้นผ่าน referential action ส่วน runtime role ยังแก้หรือลบ event ทีละแถวไม่ได้ (`AC-20`, `AC-26`) ข้อที่ `nightwatch` มี `DELETE` บน `organization` เป็น follow-up ใน Non-goals
- `target_attributes`: ค่าที่ไม่ใช่ข้อมูลส่วนบุคคลที่ต้องใช้แสดงเป้าหมาย: `{ role }` ของคำเชิญ, `{ format, from, to, categories, actorUserId, searchApplied }` ของการส่งออก ไม่เก็บข้อความค้นหา `q` (อาจมีอีเมลหรือชื่อที่ผู้ใช้พิมพ์) เก็บเพียง `searchApplied`
- ไม่มีคอลัมน์ IP, user agent, อีเมล หรือชื่อ (`OD-02`)
- check constraint ของ `category` ต้องตรงกับ action (เช่น `organization.member.*` → `member`)
- Index (สร้างบน parent จึงมีทุก partition): `(tenant_id, occurred_at desc, id desc)`, `(tenant_id, actor_user_id, occurred_at desc)`, `(tenant_id, id)`
- RLS ตาม DB-04 และ pattern ของ `monitor_*` (`0016_uptime_monitors.sql:176-252`): `enable` + `force row level security`, restrictive policy `audit_events_tenant_context to nightwatch` (ต้องมี `app.tenant_id`) และ permissive `audit_events_tenant_access to nightwatch` (`tenant_id = app.tenant_id`)
- Grants: `nightwatch` ได้ `select, insert` เท่านั้น (append-only ตาม precedent `monitor_check_results`, `0016:254-260`) ไม่มี `update`/`delete` (`AC-20`)
- Partition: `ensure_audit_event_partitions(p_months_ahead integer)` (owner `nightwatch_owner`, execute เฉพาะ owner ตาม `ensure_monitor_partitions` `0016:450-514`) สร้าง `audit_events_pYYYYMM` ตั้งแต่เดือนก่อนถึงเดือนปัจจุบัน + N partition ใหม่ `enable`/`force` RLS และ drop partition ที่ขอบบนของช่วงเก่ากว่า `now() - interval '366 days'` migration เรียก `select ensure_audit_event_partitions(3)`
- ไม่มี DEFAULT partition (ดู Design decisions และ Risks)
- Test support: `ensure_audit_event_partitions` สร้างได้เฉพาะเดือนก่อนถึงอนาคต test ที่ seed event อายุ 364–366 วันจึงต้องมี helper ของ test ที่ใช้ `DATABASE_OWNER_URL` สร้าง partition ของเดือนที่ระบุ (`apps/api/src/audit/test-support.ts`) และ drop หลัง test ไม่มี function นี้ใน migration
- Retention: `purge_expired_audit_events(p_limit integer)` SECURITY DEFINER, fixed `search_path`, owner `nightwatch_audit_retention_owner` (NOLOGIN NOBYPASSRLS) ซึ่งมี RLS policy `select`/`delete` เฉพาะแถว `occurred_at < now() - interval '365 days'` ลบไม่เกิน `p_limit` (`1..10000`) แถวต่อครั้ง execute ให้ `nightwatch` (pattern `purge_expired_monitor_data`, `0016:290-443`)

**`organization.audit_recording_started_at`**

```sql
alter table organization
  add column audit_recording_started_at timestamptz not null default now();
```

- Organization ที่มีอยู่ได้เวลาที่ migration รัน Organization ใหม่ได้เวลาสร้าง (default) ใช้คำนวณ `recordingStartedAt` และ `retainedFrom`
- `organization` เป็น login/membership table ตาม DB-06 ไม่มี RLS query อ่านผ่าน membership-bound CTE ไม่มี grant ใหม่ (grant เดิมของ `nightwatch` ครอบ column ใหม่) Better Auth ไม่เขียน column นี้ จึงใช้ default

**`audit_exports`** (`0020`)

แยกเป็นสองตาราง (DB-10): `audit_exports` เก็บคำขอและผล (filters, `q`, ไฟล์) ส่วน `audit_export_jobs` เป็น claim ledger ที่มีเฉพาะ routing data ผูกกับแถวที่ commit แล้ว claim owner เข้าถึงได้เฉพาะ ledger

```sql
create table audit_exports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references organization(id),
  requested_by text not null,
  format text not null check (format in ('csv','json')),
  filters jsonb not null,
  time_zone text not null,
  snapshot_at timestamptz not null,
  failure_code text check (failure_code in ('EXPORT_TOO_LARGE','EXPORT_FAILED','REQUESTER_NOT_AUTHORIZED')),
  row_count integer,
  byte_size integer,
  content bytea,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  file_expires_at timestamptz,
  content_purged_at timestamptz,
  constraint audit_exports_id_scope_key unique (id, tenant_id, requested_by)
);

create table audit_export_jobs (
  export_id uuid primary key,
  tenant_id uuid not null,
  requested_by text not null,
  constraint audit_export_jobs_export_fkey
    foreign key (export_id, tenant_id, requested_by)
    references audit_exports (id, tenant_id, requested_by) on delete cascade,
  state text not null check (state in ('queued','running','ready','failed')),
  attempt_count integer not null default 0,
  claim_token uuid,
  claimed_until timestamptz,
  created_at timestamptz not null
);
create unique index audit_export_jobs_one_in_flight
  on audit_export_jobs (tenant_id, requested_by) where state in ('queued','running');
```

- composite FK ผูก ledger กับแถวแม่ทั้ง id, tenant และผู้ขอ (precedent `monitors_id_tenant_key`, `0016_uptime_monitors.sql:51`) ledger ที่ `tenant_id` หรือ `requested_by` ไม่ตรงกับแถวแม่จึง insert ไม่ได้
- `content_purged_at` บอกว่า purge ล้าง `content` แล้ว ใช้แทน `content is null` เพื่อไม่ต้อง grant select บน `content` ให้ retention owner
- `audit_export_jobs.created_at` เท่ากับ `audit_exports.created_at` (insert ใน transaction เดียวกัน) สถานะของงานมีที่เดียวคือ `state`
- Index เพิ่ม: `audit_export_jobs (state, claimed_until)` สำหรับ claim, `audit_exports (tenant_id, requested_by, created_at desc)` สำหรับ list
- RLS ของ runtime ตาม DB-04 และ DB-10 บนทั้งสองตาราง: `enable` + `force`, ทุก policy `to nightwatch`: restrictive `*_tenant_context` (`app.tenant_id`), restrictive `*_user_context` (`app.user_id` ไม่ว่าง), permissive `*_access` (`tenant_id = app.tenant_id and requested_by = app.user_id`) API และ Worker ตั้งทั้งสองค่าใน transaction (pattern `apps/api/src/notifications/service.ts:209-215`) helper ใหม่ `withTenantUserContextRaw` ใน `packages/db/src/tenant-context.ts`
- Grants `nightwatch`: `audit_exports` ได้ `select, insert, update (failure_code, row_count, byte_size, content, completed_at, file_expires_at)`; `audit_export_jobs` ได้ `select, insert, update (state, claim_token, claimed_until)` ไม่มี `delete` ทั้งสองตาราง
- Claim owner `nightwatch_audit_export_claim_owner` (NOLOGIN NOBYPASSRLS) ตาม pattern `monitor_schedule_claim_*` (`0016:273-288`):
  - `audit_export_jobs_claim_select ... for select to nightwatch_audit_export_claim_owner using (true)` (UPDATE ต้องผ่าน select policy ของแถวใหม่ด้วย จึงจำกัดที่ select ไม่ได้)
  - `audit_export_jobs_claim_update ... for update to nightwatch_audit_export_claim_owner using (state = 'queued' or (state = 'running' and claimed_until < now())) with check (true)`
  - grant `select, update` บน `audit_export_jobs` เท่านั้น ไม่มี grant บน `audit_exports` จึงไม่เห็น filters, `q` หรือไฟล์
- `claim_audit_export()` SECURITY DEFINER, `set search_path = pg_catalog, public`, owner claim owner, execute ให้ `nightwatch` เท่านั้น เลือก 1 แถวด้วย WHERE ของตัวเอง `state = 'queued' or (state = 'running' and claimed_until < now())` (ไม่อิง policy เพื่อไม่ให้ policy ที่กว้างกว่าทำให้ claim หยิบแถว `ready`/`failed`) และ `for update skip locked` ตั้ง `state = 'running'`, `claim_token = gen_random_uuid()`, `claimed_until = now() + interval '10 minutes'`, `attempt_count = attempt_count + 1` คืน `(export_id, tenant_id, requested_by, claim_token, exhausted)` โดย `exhausted = attempt_count > 3 (หลังเพิ่ม) or now() >= audit_export_deadline(created_at) - interval '10 minutes'`
- **อายุสูงสุดของคำขอ** กันผู้ใช้ติด `กำลังสร้างไฟล์…` ถาวรเมื่อ Worker ไม่ทำงาน กฎอยู่ใน function เดียว `audit_export_deadline(created_at timestamptz) returns timestamptz` (`stable` เพราะ operator `timestamptz + interval` เป็น stable, fixed `search_path`, คืน `created_at + interval '60 minutes'`, execute ให้ `nightwatch` และ claim owner) ทุกที่ใช้ function นี้:
  - claim: `exhausted` เมื่อเหลือน้อยกว่า 10 นาทีก่อน deadline (นาทีที่ 50) งานที่ claim ก่อนนาทีที่ 50 มี time limit 5 นาทีครอบทั้งการอ่าน batch และการสร้างไฟล์ (ขั้น 2–3 ใน Jobs) จึงเสร็จหรือถูกยกเลิกก่อน deadline
  - complete เป็น `ready`: update ต้องมี `now() < audit_export_deadline(created_at)` แถวที่พ้น deadline จึงไม่พลิกจาก `failed` เป็น `ready`
  - fail: ไม่มีเงื่อนไข deadline เพราะปลายทางคือ `failed` เหมือน stale transition update ทุกตัวมี `state = 'running' and claim_token = $token` ผู้ที่มาทีหลังได้ 0 แถว
  - stale transition (POST export และ GET exports list ของผู้เรียก ใน transaction เดียว): `update audit_export_jobs set state = 'failed' where tenant_id = $1 and requested_by = $2 and state in ('queued','running') and now() >= audit_export_deadline(created_at) returning export_id` แล้ว update `audit_exports` เป็น `failure_code = 'EXPORT_FAILED'`, `completed_at = now()` และสร้าง notification `AUDIT_EXPORT_FAILED` ต่อ `export_id` ที่ได้
  - ทุกทางที่เปลี่ยนเป็น `failed` สร้าง `AUDIT_EXPORT_FAILED` ใน transaction เดียวกัน origin `audit-export:<exportId>:failed` และ `on conflict (origin) do nothing` จึงได้ notification ไม่เกินหนึ่งรายการต่อคำขอ ผู้รับตามกฎของ P-07 เมื่อผู้ขอไม่ได้เป็น `owner`/`admin` แล้ว
  - role `scheduler` ที่มีอยู่รัน sweep ทุกรอบ (P-08 ทางเลือก (ค) ดู Jobs) แถวที่พ้น deadline จึงเป็น `failed` พร้อม notification แม้ `audit-exporter` ไม่ทำงานและผู้ขอไม่เปิดหน้า
- Retention owner `nightwatch_audit_retention_owner` (role จาก `0019`) บน `audit_exports`:
  - `audit_exports_retention_select ... for select to nightwatch_audit_retention_owner using (true)` ตาม pattern `0016:276-280` (UPDATE ต้องผ่าน select policy ของแถวใหม่ด้วย) ปลอดภัยเพราะ column grant ด้านล่างไม่มี `content`, `filters` หรือข้อมูลอื่นของคำขอ
  - `audit_exports_retention_update ... for update ... using (file_expires_at <= now() and content_purged_at is null) with check (content_purged_at is not null)` แถวที่ล้างแล้วจึงไม่ถูก update ซ้ำ
  - `audit_exports_retention_delete ... for delete ... using (created_at < now() - interval '7 days')`
  - grant `select (id, created_at, file_expires_at, content_purged_at)`, `update (content, content_purged_at)`, `delete` บน `audit_exports` (ไม่มี select บน `content`, `filters` หรือ `q`) ไม่มี grant บน `audit_export_jobs`: แถว ledger ถูกลบตาม composite FK `on delete cascade` ซึ่ง PostgreSQL รันเป็น referential action โดยไม่ใช้ RLS ของผู้ลบ
  - partial index `audit_exports (file_expires_at) where content_purged_at is null and file_expires_at is not null` สำหรับ purge
- `purge_audit_exports(p_limit integer)` SECURITY DEFINER owner retention owner: ตั้ง `content = null, content_purged_at = now()` ไม่เกิน `p_limit` แถวที่ `file_expires_at <= now() and content_purged_at is null` และลบแถวที่ `created_at < now() - interval '7 days'` (พ้น deadline นานแล้ว จึงไม่มีงานที่กำลังทำ)
- `0019` และ `0020` สร้าง cluster-wide role ไฟล์ละหนึ่งตัว ตาม DB-13 (precedent `0008_notification_function_owners.sql`)

**Notification** (`0020`; ของเดิมที่ `0002_notification_foundation.sql`, `0017_monitor_notifications.sql:45-97`)
- drop แล้วสร้างใหม่ 4 constraint: `notification_intents_event_type_check`, `notification_inbox_items_event_type_check` (เพิ่มสองชนิด) และ `notification_intents_scope_check`, `notification_inbox_items_scope_check` (`0017:57-70`, `:84-97`; เพิ่ม `AUDIT_EXPORT_READY`, `AUDIT_EXPORT_FAILED` ใน branch `scope_kind = 'tenant'` ไม่เพิ่มใน branch `account`)
- เพิ่ม column `subject_audit_export_id uuid` ใน `notification_intents` และ `notification_inbox_items` ไม่มี FK (แถว export ถูกลบหลัง 7 วัน inbox item อยู่ 30 วัน)

**`scripts/partitions.mjs`:** เรียก `ensure_audit_event_partitions($PARTITION_MONTHS_AHEAD)` ใน transaction เดียวกับ `ensure_monitor_partitions` CI เรียกอยู่แล้วหลัง `db:migrate` (`.github/workflows/ci.yml:150-151`, `:284-285`) อัปเดต `scripts/quality/README.md` หัวข้อ partitions และ `docs/runbooks/uptime-monitor.md` (หรือ runbook ใหม่ของ audit log)

### Jobs

Worker role ใหม่ `audit-exporter` ใน `apps/worker/src/index.ts` (`WORKER_ROLES`) โค้ดใน `apps/worker/src/audit/` ไม่ใช้ Redis หรือ BullMQ: DB claim คือ queue process ยังบังคับ `REDIS_URL` ทุก role (`apps/worker/src/index.ts:59`) Spec นี้คงไว้ไม่แก้ เพื่อไม่เปลี่ยนการเริ่ม process ของ role เดิม P1 จึงต้องส่ง `REDIS_URL` ให้ role ใหม่ด้วย

- Loop ทุก 5 วินาที เรียก `claim_audit_export()` ได้ไม่เกิน 1 แถว (เก็บไฟล์ในหน่วยความจำทีละไฟล์) ถ้าได้แถว รอบถัดไปเริ่มทันที
- `exhausted = true` (claim ครั้งที่ 4 หรือนาทีที่ 50 ขึ้นไป): fail ด้วย `EXPORT_FAILED` แบบมีเงื่อนไข และสร้าง notification `AUDIT_EXPORT_FAILED` ใน transaction เดียวกัน
- ขั้นตอนต่อคำขอ:
  1. transaction สั้นใน tenant+user context ของ claim: อ่าน `audit_exports` ของคำขอและตรวจ requester ยังเป็น `owner`/`admin` ไม่ใช่: fail ด้วย `REQUESTER_NOT_AUTHORIZED` (P-07: ส่ง `AUDIT_EXPORT_FAILED` ถ้ายังเป็นสมาชิก ไม่ส่งถ้าไม่เป็นสมาชิกแล้ว)
  2. อ่าน event เป็น batch keyset ละ 1,000 แถว (`occurred_at desc, id desc`) แต่ละ batch เป็น read transaction แยก predicate ต่อ batch: `occurred_at >= greatest(filters.from, now() - interval '365 days', organization.audit_recording_started_at)` โดย `now()` คือเวลาของ statement ที่อ่าน batch นั้น, `occurred_at <= least(filters.to, snapshot_at)` และ filters อื่นแบบเดียวกับ list API ชื่อที่แสดงอ่านตอนสร้างไฟล์ตามกฎเดียวกับ API
  3. สร้างไฟล์นอก transaction (REQ-01) time limit 5 นาทีนับจากเริ่มขั้น 2 ครอบทั้งการอ่าน batch และการสร้างไฟล์ (ก่อนอ่านแต่ละ batch ตั้ง `set local statement_timeout` เป็นเวลาที่เหลือของงบ 5 นาที เหลือ 0 หรือน้อยกว่าถือว่าเกิน time limit) เกิน 25 MiB: หยุดและ fail ด้วย `EXPORT_TOO_LARGE` เกิน time limit: retryable (ปล่อยให้ lease หมด)
  4. transaction เดียว: `update audit_export_jobs set state = 'ready' where export_id = $1 and claim_token = $2 and state = 'running' and now() < audit_export_deadline(created_at)` (JOB-07) ได้ 1 แถว: update `audit_exports` (`content`, `row_count`, `byte_size`, `completed_at = now()`, `file_expires_at = now() + interval '24 hours'`) แล้ว insert notification intent `AUDIT_EXPORT_READY` ผู้รับคือ requester คนเดียว และ `create_notification_dispatch` ได้ 0 แถว: rollback และทิ้งผล
- Fail ทุกแบบ: `update audit_export_jobs set state = 'failed' where export_id = $1 and claim_token = $2 and state = 'running'` ได้ 1 แถว: update `audit_exports.failure_code`, `completed_at` และสร้าง `AUDIT_EXPORT_FAILED` ใน transaction เดียวกัน error อื่น (DB ชั่วคราว, timeout, process ตาย) ไม่เขียนอะไร lease หมดแล้ว claim ใหม่ ไม่เกิน 3 ครั้ง
- Notification ของการส่งออกส่งถึงผู้ขอเท่านั้น ไม่ใช้ `insertMonitorNotificationIntent` (snapshot owner/admin ทุกคน, `packages/db/src/notification.ts:256-302`) helper ใหม่ `insertAuditExportNotificationIntent` ใน `packages/db/src/notification.ts` (API ใช้ใน stale transition, Worker ใช้ใน complete และ fail) origin `audit-export:<exportId>:<ready|failed>` (unique ต่อผล จึง idempotent) ไม่ขึ้นกับค่า `settingsChangedEnabled`/`monitorAlertsEnabled`
- Materialize (`apps/worker/src/materialize.ts:65-173`) copy `subject_audit_export_id` ไป inbox item
- งานรายชั่วโมงใน role เดียวกัน: `purge_expired_audit_events(5000)` วนจนได้น้อยกว่า 5000, `purge_audit_exports(500)` และ warning เมื่อ partition ของ `audit_events` ล่วงหน้าน้อยกว่า 2 เดือน (pattern `apps/worker/src/monitor/scheduler.ts:172-202`)
- Shutdown: หยุด claim ทันที งานที่ค้างถูกทิ้ง lease หมดแล้ว claim ใหม่
- Scope ของงาน (JOB-01): claim คืน `tenant_id` และ `requested_by` ที่ commit แล้ว Worker ตั้ง context จาก claim เท่านั้น
- Stale sweep (P-08 ทางเลือก (ค), ผู้ใช้เลือก 2026-10-03): role `scheduler` ที่มีอยู่ (`apps/worker/src/dispatch.ts`, รอบ 60 วินาทีที่ `:19-21`) เพิ่มขั้น sweep ต่อจากขั้นเดิมในรอบ:
  - เรียก `find_stale_audit_exports(50)` SECURITY DEFINER owner claim owner, execute ให้ `nightwatch` เท่านั้น, read-only, WHERE ของตัวเอง `state in ('queued','running') and now() >= audit_export_deadline(created_at)` คืน `(export_id, tenant_id, requested_by)` ไม่แก้ update policy ของ claim owner
  - ต่อแถว: transaction ที่ตั้ง `app.tenant_id` และ `app.user_id` จากแถวนั้น รัน stale transition แบบมีเงื่อนไข `where export_id = $1 and state in ('queued','running') and now() >= audit_export_deadline(created_at)` ได้ 1 แถว: update `audit_exports` (`EXPORT_FAILED`, `completed_at`) และสร้าง `AUDIT_EXPORT_FAILED` (ผู้รับตาม P-07) ใน transaction เดียวกัน ได้ 0 แถว: ข้าม
  - error ของ sweep ไม่หยุดขั้น dispatch เดิมในรอบ และไม่เปลี่ยนการ claim, enqueue หรือ retry ของ notification dispatch

**รูปแบบไฟล์ (`AC-15`):**
- field ต่อ event ตรงกับหน้ารายละเอียด: `occurred_at_utc` (ISO 8601 UTC), `event_id`, `actor_name`, `actor_role_at_time`, `action_label`, `action_code`, `category`, `target` (label แบบเดียวกับ UI), `changes` ไม่มี `userId`, อีเมล, IP, user agent หรือค่าลับ
- CSV: UTF-8 พร้อม BOM, preamble แบบ key/value 4 แถว (`generated_at_utc`, `time_zone` ของผู้ขอ, `filters` เป็นข้อความสรุป, `scope_note` = ข้อความ note ขอบเขตการบันทึกของ `feature.md` ขั้นตอน 3) บรรทัดว่าง แล้ว header และแถวข้อมูล `changes` เป็นข้อความ `field: ก่อน → หลัง` คั่นด้วย `; ` escape ตาม RFC 4180 และเติม `'` หน้า cell ที่ขึ้นต้นด้วย `=`, `+`, `-`, `@`, tab หรือ CR (กัน formula injection เพราะชื่อมอนิเตอร์และชื่อสมาชิกเป็น input ของผู้ใช้)
- JSON: `{ meta: { generatedAt, timeZone, filters, scopeNote }, events: [{ id, occurredAt, actor: { displayName, roleAtTime, membership }, action, actionLabel, category, target, changes: AuditChange[] }] }`

### Web

- Routes ใน `apps/web/src/router.tsx` (children ของ shell route ตาม `/organizations/:organizationId/monitors/:monitorId` ที่ `:159-163`):
  - `/organizations/:organizationId/audit-log` loader `auditLogLoader`
  - `/organizations/:organizationId/audit-log/:eventId` loader `auditLogEventLoader`
  - loader ตาม `monitorsOverviewLoader` (`apps/web/src/lib/auth/loaders.ts:194-225`): prefetch เฉพาะเมื่อ context มี Organization นี้และ role เป็น `owner`/`admin`/`auditor` (WEB-04)
- Nav: leaf `บันทึกกิจกรรม` ใน group `องค์กร` ต่อจาก `ตั้งค่าการแจ้งเตือน` (`apps/web/src/components/shell/nav-config.ts:57-72`), `roles: ["owner","admin","auditor"]` ⌘K ได้จาก `getNavDestinations` อยู่แล้ว icon ใหม่ใน `NAV_ICONS` (`apps/web/src/components/shell/icons.tsx:290-302`) ตาม `OD-12`
- Query keys ใต้ `TENANT_QUERY_PREFIX` (WEB-03):
  - `['tenant','audit-log','events', organizationId, { from, to, categories, actorUserId, q, offset, asOf }]`
  - `['tenant','audit-log','event', organizationId, eventId]`
  - `['tenant','audit-log','actors', organizationId]`
  - `['tenant','audit-log','exports', organizationId]`
- Query string ของรายการ: `range` (`24h`, `7d`, `30d`, `custom` ค่าเริ่มต้น `7d` ไม่เขียนลง URL), `from`/`to` (`YYYY-MM-DD` เฉพาะ `custom` ตีความใน `timeZone` ของ preference: `from` เริ่มวัน `to` สิ้นวัน), `categories`, `actor`, `q`, `page` (เริ่มที่ 1) ใช้ `setSearchParams(next, { replace: true })` ตาม `OnboardingPage.tsx:67-69` ค่าไม่ถูกต้องใน URL ใช้ค่าเริ่มต้นแทนโดยไม่ error
- `range` ที่เป็นช่วงสัมพัทธ์คำนวณใหม่ทุกครั้งที่เปิดลิงก์ (`AC-10` "ผลเดิม" หมายถึงตัวกรองเดิม)
- เปลี่ยนตัวกรอง: `page` กลับเป็น 1, ไม่ส่ง `asOf`, ไม่ใช้ข้อมูลเดิมเป็น placeholder (แสดง skeleton) ส่วนการเปลี่ยนหน้าใช้ `asOf` เดิม
- `page` เกินจำนวนจริง: response `events: []` ขณะ `total > 0` web โหลดหน้าสุดท้ายที่มีแถว
- ช่วงกำหนดเอง (`AC-11`): เทียบวันที่ใน `timeZone` ของ preference กับวันที่ของ `retainedFrom` จาก response ล่าสุด ไม่ใช้นาฬิกาของ browser
- เวลาไม่ใช้ `formatDateTime` เพราะแสดงปีพุทธศักราช ไม่มีวินาทีและไม่มีชื่อ zone (`apps/web/src/lib/preferences.ts:119-140`) เพิ่ม `formatAuditTimestamp(date, preferences)` ใน `preferences.ts` คืน `YYYY-MM-DD HH:mm:ss` ปฏิทิน Gregorian (`calendar: 'gregory'`, `numberingSystem: 'latn'`) แบบ 24 ชั่วโมงใน `preferences.timeZone` ผ่าน `Intl.DateTimeFormat#formatToParts` ตาม wireframe (`2026-10-02 14:01:55`) ชื่อ zone (`preferences.timeZone` เช่น `Asia/Bangkok`) แสดงในหัวคอลัมน์ `เวลา (<zone>)`, status line และบรรทัดเวลาของหน้ารายละเอียด (`AC-02`) แสดงแบบ monospace ส่วน `เก็บย้อนหลังถึง <วันที่>` ใช้เฉพาะส่วนวันที่ของ formatter เดียวกัน
- Status line, note ขอบเขตการบันทึก, state table และ focus ตาม `feature.md` และ `docs/ref/shell-structure.md` ใช้ `PageState` (`apps/web/src/components/shell/PageState.tsx`) design-system CMP-01–CMP-03, LAY-02, LAY-06 (chip 32 px), COL-01, COL-03, A11Y-01
- Denied: `MEMBERSHIP_DENIED`/`PERMISSION_DENIED` จาก list, detail หรือ actors: `removeQueries` ของ `['tenant','audit-log']` ของ Organization นั้น, invalidate `ME_CONTEXT_QUERY_KEY`, แสดงการ์ด denied และ focus หัวข้อการ์ด `PERMISSION_DENIED` จาก export หรือ download: ปิด dialog, invalidate context แล้วซ่อนปุ่มและ section เมื่อ context ใหม่บอกว่าเป็น `auditor`
- สลับ Organization (`AC-07`, `OD-14`): `OrgSwitcher` หลัง server ยืนยัน ถ้า path ตรง `/organizations/<id>/audit-log` หรือ `/organizations/<id>/audit-log/<eventId>`: role ใหม่เป็น `owner`/`admin`/`auditor` → `/organizations/<new>/audit-log` ไม่มี query string, ไม่ใช่ → `/workspace` ทั้งสองแบบ `replace` page component ใช้ `key={organizationId}` และ completion ผ่าน `useOrganizationScope`
- Export (UI flow ขั้นตอน 7–15 ของ `feature.md` `F-007-AC-2`):
  - ปุ่มและ section render เฉพาะเมื่อ role ใน context เป็น `owner`/`admin` และ exports query เป็น `enabled` เฉพาะ role นี้ (`B-2`) `auditor`/`viewer` จึงไม่ส่ง request ไป exports list
  - ทุกตัวควบคุมที่ "ใช้ไม่ได้พร้อมเหตุผล" ใช้ `aria-disabled="true"` + `aria-describedby` ชี้ไปที่ข้อความเหตุผลที่มองเห็นได้ ไม่ใช้ attribute `disabled` (`M-2`): ปุ่ม `ส่งออก` ตอน 0 รายการและตอนมีคำขอกำลังสร้าง, `สร้างไฟล์` ตอนเกิน 50,000, `ขอใหม่` ทุกแถวตอนมีคำขอกำลังสร้าง, `ยกเลิก`/`สร้างไฟล์` ระหว่างส่ง, `ดาวน์โหลด` ระหว่างดาวน์โหลด กด/Enter ของตัวควบคุมเหล่านี้ไม่ทำอะไร
  - `inProgress`: ทันทีที่ได้ `201` (ก่อน refetch) web ใส่ `export` จาก response ลงต้น cache `['tenant','audit-log','exports', organizationId]` และตั้ง `inProgress: true` (`M-1`) แล้วจึง invalidate
  - poll exports list ทุก 5 วินาทีขณะมีแถว `generating` (หลัก "Refresh running work by polling") และ invalidate notifications เมื่อสถานะเปลี่ยน poll ล้มเหลว: คงแถวเดิม แสดง "ข้อมูลอาจไม่เป็นปัจจุบัน" + `ลองใหม่` ที่หัว section (`M-8`)
  - Export dialog (`M-3`): component ใหม่ `ExportDialog` ใน `apps/web/src/pages/audit-log/` ไม่ใช้ `ConfirmDialog` (`apps/web/src/components/ui/confirm-dialog.tsx`) เพราะตัวนั้นให้ focus เริ่มที่ `ยกเลิก`, ใช้ attribute `disabled` ระหว่าง pending และเลื่อนทั้ง dialog ซึ่งขัด `AC-19` และ `M-2`/`M-3` และ component นั้นใช้ร่วมกับ member และ monitor จึงไม่แก้ `ExportDialog` ใช้ scrim, shadow และ focus trap แบบเดียวกัน (LAY-07, CMP-03): focus เริ่มที่ตัวเลือกแรกใน `fieldset` "รูปแบบไฟล์" (ค่าเริ่มต้น CSV), title และแถวปุ่มคงที่ เนื้อหาเลื่อนในตัว, ระหว่างส่ง `สร้างไฟล์` แสดง "กำลังส่งคำขอ…" + `aria-busy` และ `ยกเลิก`/Escape เป็น `aria-disabled` ไม่ทำงานจนได้ผล
  - ขอบเขตใน dialog ใช้ `asOf`, `from` และ `to` ของ response รายการที่แสดงอยู่ (`M-4`): web ส่ง POST ด้วย `from`/`to` แบบ absolute เสมอ (ช่วงสัมพัทธ์แปลงเป็นค่า absolute ตาม `asOf` ของรายการ, `to` = `asOf` เมื่อรายการไม่ได้ระบุ `to`) และ `asOf` เดียวกับรายการ dialog แสดง "ณ โหลดเมื่อ HH:MM:SS (<timeZone>)", ช่วงวันเวลาพร้อม zone, ตัวกรองและจำนวนจาก `page.total` เกิน 50,000 ก่อนส่ง: state เกินขนาด
  - ผลของ POST (ขั้นตอน 8): `422 AUDIT_EXPORT_TOO_LARGE` → state เกินขนาดด้วย `details.total`; `422 AUDIT_EXPORT_EMPTY` → "ไม่มีรายการให้ส่งออกตามตัวกรองนี้"; `409 AUDIT_EXPORT_IN_PROGRESS` → ปิด dialog, refetch exports และปุ่มตามขั้นตอน 9; network/อื่น ๆ → ข้อความ error ใน dialog; `201` → ปิด dialog, focus กลับปุ่ม `ส่งออก`, notice พร้อมลิงก์ `ดูไฟล์ส่งออกของฉัน` ที่ย้าย focus ไป h2 ของ section (`M-5`) code ทั้งสามตรงกับ API contract ของ POST export
  - Section `ไฟล์ส่งออกของฉัน` (`M-8`): `<section id="my-exports">` h2 มี `tabindex="-1"`, `<table>` มี caption คอลัมน์ รูปแบบ, ขอบเขต, ขอเมื่อ, สถานะ, การดำเนินการ ขอบเขตแสดงจาก `filters` ของแถว (ช่วงวันเวลาพร้อม zone, หมวด, ผู้ดำเนินการ, "มีการค้นหาข้อความ" โดยไม่แสดงคำค้น) live region เดียวของ section (`role="status"`) ประกาศเฉพาะแถวที่สถานะเปลี่ยนระหว่าง poll สองรอบ ชื่อปุ่มรายแถวมีรูปแบบและเวลาขอ
  - สถานะของแถว (ขั้นตอน 11): `ready` แสดง "ดาวน์โหลดได้ถึง <expiresAt zone>"; `failed` แสดงเหตุผลหนึ่งบรรทัดตาม `failureCode` (`M-6`): `EXPORT_TOO_LARGE` พร้อมลิงก์ `ปรับตัวกรอง` ที่เขียน `filters` ของแถวลง query string ของรายการ (`range=custom` ด้วยวันที่ของ `from`/`to` ใน `timeZone`, `categories`, `actor`, `q`) แล้ว focus ไปที่ section ตัวกรอง, `REQUESTER_NOT_AUTHORIZED` และ `EXPORT_FAILED`/รหัสอื่น ตามข้อความใน `feature.md`; `expired` แสดง "ไฟล์หมดอายุแล้ว" และปุ่ม `ขอใหม่` (`M-9`)
  - `ขอใหม่` ทั้งแถว `failed` และ `expired` (ขั้นตอน 12): ส่ง POST ด้วย `format`, `timeZone` และ `filters` ของแถว (`from`/`to` absolute ตัวเดิม หมวด ผู้ดำเนินการ คำค้นเดิม) และ `asOf` = เวลาปัจจุบัน ไม่เปิด dialog `to` ของแถวเป็นขอบบนอยู่แล้ว ขอบเขตจึงเท่าเดิมยกเว้น event ที่พ้น cutoff ไปแล้ว ผลสำเร็จเหมือน `201` ของ dialog; error แสดงในแถวด้วย `role="alert"` และปุ่มชี้ไปที่ข้อความด้วย `aria-describedby`
- Download (`M-7`, ขั้นตอน 13): `request()` คืน blob ไม่ได้ (`apps/web/src/lib/api/client.ts:120-200`) เพิ่ม `requestFile(path, params)` ใน `client.ts` ที่ใช้ path type จาก generated client ส่ง credentials อ่าน `Content-Disposition` แล้วใช้ pattern `Blob` → `URL.createObjectURL` → `<a download>` → revoke ของ `MfaCard.tsx:48-61` error ใช้ envelope เดิมผ่าน `ApiError`: `404 AUDIT_EXPORT_NOT_FOUND` และ `409 AUDIT_EXPORT_NOT_READY` → ข้อความในแถวและ refetch; `410 AUDIT_EXPORT_EXPIRED` → แถวเป็น `expired` ทันทีพร้อม `ขอใหม่`; network → ข้อความในแถว ทั้งหมด `role="alert"`
- `403` ระหว่างใช้งานส่งออก (`B-2`, ขั้นตอน 15): `PERMISSION_DENIED` จาก exports list (รวม poll), POST export, `ขอใหม่` หรือ download ใช้ handler เดียว: หยุด poll, ปิด dialog ถ้าเปิด, `removeQueries` ของ exports, invalidate `ME_CONTEXT_QUERY_KEY`, ซ่อนปุ่ม `ส่งออก` และ section แล้วแสดง notice ระดับหน้าเหนือตาราง (`role="status"`, `tabindex="-1"`) พร้อมย้าย focus ไปที่ notice รายการยังอ่านได้ `MEMBERSHIP_DENIED` ใช้ denied card ของหน้า
- Notification inbox (`M-10`): เพิ่ม `AUDIT_EXPORT_READY` และ `AUDIT_EXPORT_FAILED` ใน `itemTitle`, `itemContext` (หมวด `["องค์กร", "บันทึกกิจกรรม"]`), `ItemIcon` (`apps/web/src/pages/NotificationsPage.tsx:50-96`) ลิงก์ `เปิดบันทึกกิจกรรม` ไป `/organizations/<organizationId>/audit-log#my-exports` (pattern `monitorPath` `:112-113`) หน้ารายการที่โหลดด้วย hash `#my-exports` ย้าย focus ไป h2 ของ section เมื่อ section render ถ้าไม่ render (เช่น `auditor`) เปิดหน้าที่ด้านบนตามปกติ
- เป้าหมายในรายละเอียด: มอนิเตอร์ที่ยังอยู่ลิงก์ไป `/organizations/<id>/monitors/<monitorId>` ชื่อลิงก์ "เปิดมอนิเตอร์ <ชื่อ>" (ทุก role อ่านมอนิเตอร์ได้ ตาม `apps/api/src/monitors/permissions.ts:13`) สมาชิกลิงก์ไปหน้าสมาชิกเฉพาะ `owner`/`admin` สำหรับ `auditor` เป็นข้อความ คำเชิญไม่มีลิงก์ event การส่งออกแสดงเป้าหมายเป็นข้อความ "ไฟล์ส่งออก CSV"/"ไฟล์ส่งออก JSON" จาก `target.format` ไม่มีลิงก์ (`a-1`)
- รายละเอียดของ `organization.audit-log.export` (`a-2`): section "ขอบเขตการส่งออก" แทน "การเปลี่ยนแปลง" จาก `exportScope`: รูปแบบ, `from`–`to` พร้อม zone, หมวด, ผู้ดำเนินการ (ชื่อจาก actors query ของ Organization เดียวกัน ไม่พบแสดง "ไม่ใช่สมาชิกแล้ว") และ "มีการค้นหาข้อความ: ใช่/ไม่" จาก `searchApplied` API ไม่มีคำค้นให้แสดง

### Authorization และ security

| Operation | owner | admin | auditor | viewer | non-member / ไม่มี Organization |
| --------- | ----- | ----- | ------- | ------ | ------------------------------- |
| list, detail, actors | `200` | `200` | `200` | `403 PERMISSION_DENIED` | `403 MEMBERSHIP_DENIED` |
| export request, exports list | อนุญาต | อนุญาต | `403 PERMISSION_DENIED` | `403 PERMISSION_DENIED` | `403 MEMBERSHIP_DENIED` |
| download | เฉพาะไฟล์ของตน | เฉพาะไฟล์ของตน | `403 PERMISSION_DENIED` | `403 PERMISSION_DENIED` | `403 MEMBERSHIP_DENIED` |

- ไม่เก็บและไม่คืน IP, user agent, อีเมล หรือค่าลับใน event, response, ไฟล์ หรือ log (`OD-02`, หลัก "Logging, audit and health") `recordAuditEvent` รับ `changes` ที่ redact แล้วเท่านั้น
- Request completion log: `c.req.path` ไม่มี query string อยู่แล้ว (`apps/api/src/app.ts:346-358`) จึงไม่ log `q` เพิ่ม state ใน `logSafeOrganizationPath` (`app.ts:147-228`) ให้ได้ `/api/organizations/:organizationId/audit-log/events`, `.../events/:eventId`, `.../actors`, `.../exports`, `.../exports/:exportId/download` (ตอนนี้ segment ที่ไม่รู้จักเป็น `:segment` จึงไม่รั่วแต่ไม่แยก route)
- Denial log มี `actorUserId`, action คงที่และ code เท่านั้น ไม่มี Organization id, event id, export id หรือ `q`
- Worker log มีเฉพาะ export id, ผล และ failure code ไม่มีชื่อ, filter หรือเนื้อไฟล์
- RLS: `audit_events`, `audit_exports` และ `audit_export_jobs` แยก tenant ใน DB สองตารางหลังแยกผู้ขอด้วย `app.user_id` query ยังผูก `tenant_id` และ `requested_by` เอง (หลัก "Database and isolation") claim owner เห็นเฉพาะ routing data ใน ledger (DB-10)
- Runtime role แก้หรือลบ event ไม่ได้ (grant `select, insert`)
- Fresh-auth: ไม่มี step-up เพิ่ม ใช้ verified session เดิม

### Concurrency

**Lock ที่เพิ่ม:** `recordAuditEvent` insert แถวใหม่ใน transaction ที่ถือ lock ของ mutation อยู่แล้ว ไม่ lock แถวอื่น lock order ของ mutation ทุกตัวไม่เปลี่ยน (`members.ts:209-227`, `invitations.ts:130-168`, `service.ts:128-171` ของ settings, `monitors/service.ts:148-166`)

**Export request:** `organization FOR SHARE` → `member` ของ actor `FOR SHARE` → insert path ที่เปลี่ยน role หรือถอน (`organization FOR UPDATE` ก่อน `member`) จึง serialize ที่แถว organization ไม่เกิด cycle เพราะทุก path lock organization ก่อน `member`

ผู้ได้ lock ก่อนชนะ ตารางอ่านว่า "สองคำขอที่ชนกัน → ผลที่ยอมรับ"

| Race | ผลที่ยอมรับ |
| ---- | ----------- |
| mutation × insert event ล้ม | transaction rollback ข้อมูลไม่เปลี่ยน response เป็น error ไม่มี event (`AC-21`) |
| export request × export request (ผู้ใช้เดียวกัน Organization เดียวกัน) | คำขอแรก `201` อีกคำขอ `409 AUDIT_EXPORT_IN_PROGRESS` มีคำขอและ event หนึ่งรายการ |
| export request ใน A × คำขอที่กำลังสร้างใน B | ทั้งสองสำเร็จ (`OD-20`) |
| export request × ลด role หรือถอนผู้ขอ | การเปลี่ยน role ชนะ → export ได้ `403` ไม่มีคำขอหรือ event; export ชนะ → คำขอถูกสร้าง Worker ตรวจ role ตอนเริ่ม → `failed` + `REQUESTER_NOT_AUTHORIZED` ถ้าลดแล้ว ดาวน์โหลดได้ `403` |
| คำขอพ้น deadline 60 นาที (Worker ไม่ทำงาน) × export request ใหม่ | POST ทำ stale transition (`failed` + `AUDIT_EXPORT_FAILED`) แล้ว insert แถวใหม่ใน transaction เดียว `201` ถ้าผู้ขอเปิด exports list ก่อน list ทำ stale transition และปุ่มกลับเป็น `ส่งออก` |
| Worker claim แถวใกล้ deadline × stale transition ของ API | claim ที่นาทีที่ 50 ขึ้นไปคืน `exhausted` Worker fail แถวทันทีจึงไม่มีงานสร้างไฟล์ที่เริ่มหลังนาทีที่ 50 ถ้าแถว `running` ถึง deadline ก่อน Worker complete: stale transition เปลี่ยนเป็น `failed` แล้ว complete ของ Worker ได้ 0 แถว (`state` ไม่ใช่ `running` และ `now() >= deadline`) ผลคือ `failed` เสมอ ไม่พลิกเป็น `ready` |
| Worker complete × stale transition ที่เวลาใกล้ deadline | ทั้งคู่ update แถว ledger เดียวกัน ผู้ได้ row lock ก่อนชนะ: complete ชนะก่อน deadline → `ready` และ stale transition ไม่เห็นแถว (ไม่ใช่ `queued`/`running`); stale ชนะ → `failed` และ complete ได้ 0 แถว notification ได้หนึ่งชนิดตามผลที่ชนะ |
| Worker × Worker | `skip locked` ให้คนละแถว lease หมด → claim ใหม่พร้อม `claim_token` ใหม่ ผู้ถือ token เก่า update ได้ 0 แถวและทิ้งผล (JOB-07) |
| ดาวน์โหลด × ลด role | ตรวจ role ใน statement ของดาวน์โหลด role ที่ commit ก่อน statement ชนะ |
| ดาวน์โหลด × purge ตอนครบ 24 ชั่วโมง | ก่อน `file_expires_at` ได้ไฟล์ หลังจากนั้น `410` |
| list/detail × purge ที่ cutoff | read กรอง `occurred_at >= cutoff` เอง event ที่ยังไม่ถูกลบแต่พ้น cutoff ไม่ปรากฏ |
| เปลี่ยนหน้า × event ใหม่ | `asOf` กันแถวเลื่อน event ใหม่ปรากฏหลังรีเฟรช (`AC-03`) |
| สลับ Organization × response ที่ค้าง | `TenantProvider` cancel tenant queries และ query key มี `organizationId` response ของ A ไม่แสดงใน B (`AC-07`) |

## Design decisions

| Driver | การตัดสินใจ | เหตุผล |
| ------ | ----------- | ------ |
| Audit (integrity) | ตาราง append-only ใน PostgreSQL เขียนใน transaction ของ mutation ไม่มี outbox หรือ async writer | `OD-04` ต้องการให้ mutation ล้มเมื่อบันทึกไม่สำเร็จ outbox ทำให้ event หายได้หลัง commit |
| Audit (one event) | หนึ่ง mutation = หนึ่ง event ตามตาราง "การเขียน event" | `AC-21` และทำให้รายการไม่ซ้ำสำหรับ edit เดียว |
| Privacy | ไม่เก็บชื่อหรืออีเมลใน event อ่านชื่อจาก `"user"` ตอนแสดง ไม่เก็บ `q` ใน event | `OD-02`, หลัก "Logging, audit and health" |
| Security (tenant isolation) | RLS DB-04 บน `audit_events`, RLS tenant+user บน `audit_exports` และ `audit_export_jobs`, claim ledger แยกที่มีเฉพาะ routing data (DB-10) | `AC-04`, `AC-23` พิสูจน์ได้ใน DB ด้วย runtime role claim owner ไม่เห็น filters, `q` หรือไฟล์ |
| Data growth | partition รายเดือน, purge รายชั่วโมงที่ cutoff, drop partition ที่พ้น 366 วัน | หลัก "Database and isolation" (time-growing tables) และ `OD-05` |
| Availability | ไม่มี DEFAULT partition ใช้ horizon 3 เดือนใน migration, `db:partitions` ทุก deploy และ warning ของ Worker | DEFAULT partition กัน mutation ล้มเมื่อ partition ขาด แต่ทำให้ partition ที่ขาดเงียบ และสร้าง partition ของเดือนนั้นทีหลังไม่ได้จนกว่าจะย้ายแถวออก ทางนี้ล้มแบบมองเห็นได้ (ดู Risks) |
| Storage ของไฟล์ส่งออก | `bytea` ใน `audit_exports` สูงสุด 25 MiB และ 50,000 event อายุ 24 ชั่วโมง | ไม่มี object storage ใน stack (ยืนยัน: ไม่มี S3/MinIO/volume ใน `compose.yaml` และ env) หลัก "PostgreSQL holds all state" `AC-23` ต้องตรวจ role ตอนดาวน์โหลดจึงใช้ pre-signed link ไม่ได้ S3 ต้องเพิ่ม infrastructure, secret และ IAM ซึ่งไม่คุ้มกับไฟล์ขนาดนี้ |
| Background jobs | Worker role `audit-exporter` claim จาก DB ทีละแถว ไม่ใช้ BullMQ | คำขอหนึ่งแถวคืองานหนึ่งชิ้น DB claim ให้ "ทำครั้งเดียว" และ recovery ด้วย lease โดยไม่มีช่องว่าง commit-before-enqueue ไม่ต้องบันทึก enqueue failure poll 5 วินาทีต่างจาก baseline 60 วินาทีของ JOB-02 เพราะผู้ใช้รอไฟล์อยู่หน้าเดิม |
| Abuse control | จำกัดด้วย partial unique index (1 คำขอที่กำลังสร้างต่อผู้ใช้ต่อ Organization) ไม่ใช้ Redis limiter | `OD-20` ต้องรับประกันใน DB REQ-04 limiter อาจไม่บล็อกเมื่อ Redis ล้ม |
| Search | `ilike` บนชื่อที่ join ตอน query ภายในช่วงเวลาและ Organization ไม่มี trigram index | Feature ไม่ระบุ latency target จึงไม่เพิ่ม extension index ตาม pattern ของตัวกรองอื่น |
| Performance | ไม่ตั้งเป้า latency ใหม่ หน้าละไม่เกิน 50 แถว จำนวนรวมนับต่อ request | Feature ไม่ระบุ quality target ถ้าผู้ใช้ต้องการเป้า ต้องระบุก่อนอนุมัติ |
| i18n | label ไทยของ action และหมวดอยู่ใน `packages/api-contract` | API ใช้ค้นหาและเขียนไฟล์ web ใช้แสดง ที่เดียว |
| Maintainability | 6 PR ของ software-engineer + 1 Task ของ platform-engineer | แต่ละ node พิสูจน์ด้วย suite หลักชุดเดียว DB/security แยกจาก UI |

**Risks**

- partition ของเดือนปัจจุบันไม่มี → insert event ล้ม → mutation ทุกตัวใน Event inventory ล้ม (`OD-04`) migration สร้างล่วงหน้า 3 เดือน ถ้าไม่ deploy หรือไม่รัน `db:partitions` เกิน 3 เดือน สมาชิก คำเชิญ มอนิเตอร์ และตั้งค่าการแจ้งเตือนจะเขียนไม่ได้ Worker เตือนเมื่อเหลือน้อยกว่า 2 เดือน ผู้ใช้ยอมรับ risk นี้เมื่อ 2026-10-03
- `ilike` บนชื่อในช่วง 365 วันอาจช้าใน Organization ที่มี event มาก ไม่มีตัวเลขปริมาณ วัดหลัง pilot
- ไฟล์ในหน่วยความจำของ Worker สูงสุด 25 MiB ต่อไฟล์ ทีละไฟล์ต่อ process
- ถ้า role `audit-exporter` ไม่ทำงาน sweep ของ `scheduler` เปลี่ยนคำขอที่พ้น deadline เป็น `failed` ภายในประมาณหนึ่งรอบ (60 วินาที) หลังครบ 60 นาที ถ้า `scheduler` หรือ `consumer` ไม่ทำงานด้วย notification ทุกชนิดของระบบหยุดเช่นเดียวกับปัจจุบัน
- `GET .../audit-log/exports` เขียน DB (stale transition) ซึ่งต่างจาก GET อื่น ขอบเขตจำกัดที่แถวของผู้เรียกที่พ้น deadline
- ไฟล์ส่งออกมีชื่อที่แสดงของสมาชิก เก็บใน DB 24 ชั่วโมง
- เวลาของ event เป็น `clock_timestamp()` ตอน insert แต่ event ปรากฏเมื่อ commit transaction ยาวอาจทำให้ event ที่เวลาเก่ากว่า `asOf` ปรากฏหลังรีเฟรช
- บัญชีที่ถูกลบหรือสมาชิกที่ออกแล้วแสดงเป็น "ไม่ใช่สมาชิกแล้ว" จนกว่า `OD-10` ตัดสิน
- Event ที่เกิดก่อน deploy ไม่มี (`recordingStartedAt` = เวลา migration) note ขอบเขตการบันทึกแสดงวันที่นี้แล้ว

**Assumptions**

- `"user".name` คือชื่อที่แสดงที่หน้าสมาชิกใช้ (`members.ts:120`)
- role แบบ composite ใน `member.role` normalize ด้วย `normalizeOrganizationRole` แบบเดียวกับ service อื่น
- คำขอส่งออกเก็บ `q` ตามที่ผู้ขอพิมพ์ได้ 7 วัน (แถว export) เพื่อสร้างไฟล์และ `ขอใหม่` อ่านได้เฉพาะผู้ขอ
- 50,000 event ต่อไฟล์และ 25 MiB พอสำหรับ pilot ไม่มีข้อมูลปริมาณจริง

**Non-goals:** ตาม Non-goals ของ `feature.md` และ `AC-20` เพิ่มเติม:
- การตอบรับคำเชิญ (สมาชิกเข้าร่วม), operator provisioning (`bun run provision:organization`) และ demo seed ไม่เขียน event เพราะไม่อยู่ใน Event inventory (ดูข้อเสนอ P-05)
- native Better Auth route ที่ยังเปิด เช่น `organization/update` ไม่เขียน event
- ไม่มี S3/object storage, BullMQ queue ใหม่, trigram index หรือ release task
- Follow-up นอก scope (จาก code review ของ NODE-F007-01): runtime role `nightwatch` มี `DELETE` บน `organization` (`0001_auth_foundation.sql:140-142`) ทำให้ runtime ลบ Organization และ event ทั้งหมดของ Organization ผ่าน cascade ได้ ต้อง revoke ใน migration แยก ไม่อยู่ใน node ใดของ `F-007`

## Proposed acceptance rows (Technical Lead)

Technical Lead เพิ่มแถวเหล่านี้ใน Acceptance matrix ของ `feature.md` ตอนผู้ใช้อนุมัติ Spec งานนี้ห้ามแก้ `feature.md` จึงยังอยู่ที่นี่

| AC | Category | Observable behavior | Verification |
| -- | -------- | ------------------- | ------------ |
| AC-25 | Concurrency | ทุก race ในตาราง Concurrency ให้ผลตามคอลัมน์ "ผลที่ยอมรับ" ผู้ใช้หนึ่งคนมีคำขอที่กำลังสร้างไม่เกิน 1 คำขอต่อ Organization แม้ส่งพร้อมกัน ผลของ Worker ที่ lease หมดไม่ทับผลของ Worker ใหม่ คำขอที่ค้างเกิน 60 นาทีไม่กันการส่งออกครั้งใหม่ | Real DB/HTTP test ที่ถือ transaction ค้างแล้วปล่อย: export×export, export×demotion ทั้งสองลำดับ, Worker สองตัว claim พร้อมกัน, lease หมดแล้วผู้ถือเดิม complete, process ตายระหว่างสร้างไฟล์, claim ครั้งที่ 4 เป็น `failed`, แถว `queued` อายุ 61 นาทีโดยไม่มี Worker แล้ว list และ POST (ได้ `failed` และ notification หนึ่งรายการ), claim ที่นาทีที่ 50 คืน `exhausted`, Worker complete หลัง deadline ได้ 0 แถวและแถวคง `failed`, complete × stale transition ทั้งสองลำดับ, ทุกทางที่เป็น `failed` มี `AUDIT_EXPORT_FAILED` หนึ่งรายการ (ยกเว้นตาม P-07) |
| AC-26 | Security | Event, response, ไฟล์ส่งออก, notification และ log ไม่มีค่าลับ, ค่า query parameter, เนื้อ body, IP, user agent หรืออีเมล; `q` ไม่อยู่ใน log หรือ event; cell CSV ที่ขึ้นต้นด้วย `=`, `+`, `-`, `@` ถูก escape; runtime role update/delete `audit_events` ไม่ได้; runtime role อ่าน event หรือคำขอส่งออกของ Organization อื่นหรือผู้ใช้อื่นไม่ได้แม้ query ไม่ใส่เงื่อนไข; ตัวเลือกผู้ดำเนินการมีเฉพาะผู้ที่มี event | ตั้งค่าลับและ query ที่รู้ค่าแล้ว grep event, response, ไฟล์และ captured log; DB test ด้วย runtime role ที่ตั้ง context ของ A แล้ว select/update/delete ของ B; ชื่อมอนิเตอร์ `=HYPERLINK(...)` ในไฟล์ CSV; actors ของ Organization ที่มีสมาชิกที่ไม่เคยทำ action |
| AC-27 | Verification | Migration `0019` apply บน DB ที่มีข้อมูล `F-004`–`F-006` แล้ว partition ถูกสร้าง 3 เดือนล่วงหน้า, `db:partitions` สร้างและ drop partition ของ `audit_events`, purge ลบเฉพาะแถวที่พ้น cutoff และทุก mutation ในตาราง "การเขียน event" เขียน action และ `changes` ตามตาราง verification เดิมของ `F-004`, `F-005` (ส่วน `AC-61` ตามข้อความใหม่) และ `F-006` ผ่านซ้ำ | Migration test บน DB ที่ seed ก่อน migrate; partition test ที่เลื่อนเวลา; purge test ด้วย event อายุ 365 วัน ± 1 นาที; table-driven test ต่อ request type; รัน suite เดิมของ members, invitations, monitors และ notification settings |

## ข้อเสนอให้ Product Owner และคำตัดสิน

ผู้ใช้ตัดสิน P-01, P-06, P-07 และ P-08 เมื่อ 2026-10-03 ผ่าน coordinator (AskUserQuestion) ข้อความใน `feature.md` เป็นของ Product Owner P-02 ถึง P-05 ไม่อยู่ในคำตัดสินที่ส่งมา สถานะยึดตามที่ Product Owner บันทึกใน `feature.md`

| ID | ข้อเสนอ | AC ที่กระทบ | สถานะ |
| -- | ------- | ----------- | ----- |
| P-01 | เพิ่ม state ของขนาดสูงสุด: ผลลัพธ์เกิน 50,000 รายการ ปุ่มยืนยันใน export dialog ใช้ไม่ได้พร้อมเหตุผล และ server ตอบ `422 AUDIT_EXPORT_TOO_LARGE` ไฟล์ที่เกิน 25 MiB ระหว่างสร้างเป็น "ล้มเหลว" พร้อม notification | `AC-16`, state table แถว Export dialog | ตัดสินแล้ว 2026-10-03: ปฏิเสธพร้อมเหตุผลเมื่อเกิน 50,000 รายการ ข้อความตาม `feature.md` |
| P-02 | `AC-24` ขอบเขตการนับวัน: มองเห็นเมื่อ `occurred_at >= now() - 365 × 24 ชั่วโมง` ทดสอบด้วย event อายุ 364 วัน, 365 วันลบ 1 นาที (เห็น), 365 วันบวก 1 นาที และ 366 วัน (ไม่เห็น) | `AC-24` | ค่าที่ AC ให้ Technical Lead กำหนด ใช้ตามนี้ |
| P-03 | ยืนยันการ map หนึ่ง mutation เป็นหนึ่ง event: `secret.set`/`secret.replace` เกิดเฉพาะ edit ที่เปลี่ยนแต่ค่าลับ edit ที่เปลี่ยน config ด้วยเป็น `monitor.update` ที่มีช่องค่าลับใน `changes` settings ที่เปลี่ยนสอง field เป็น `notification-settings.update` event เดียว create มอนิเตอร์ไม่มี `changes` | `AC-14`, `AC-21`, Event inventory | ยืนยันการตีความ ตาม `feature.md` (gate ของ NODE-F007-01) |
| P-04 | ยืนยัน label ไทยของ action 16 รายการและหมวด 5 รายการ (ร่างใน NODE-F007-03) และข้อความ notification สองชนิด | `AC-02`, `AC-12`, `AC-16` | copy ตาม `feature.md` (gate ของ NODE-F007-03) |
| P-05 | การตอบรับคำเชิญ (สมาชิกเข้าร่วม) และ operator provisioning ไม่อยู่ใน Event inventory หมวด "สมาชิก" จึงไม่มีการเข้าร่วม ผู้ใช้อาจตีความว่าไม่มีใครเข้าร่วม (guardrail M-B) | Event inventory, note ขอบเขตการบันทึก | follow-up ไม่กั้น node ใด (requirement ใหม่ ถ้ารับต้อง bump `acceptanceVersion`) |
| P-07 | notification `AUDIT_EXPORT_FAILED` เมื่อผู้ขอไม่ได้เป็น `owner`/`admin` แล้ว ณ เวลาที่คำขอเปลี่ยนเป็น `failed` กฎเดียวใช้กับทุกทาง fail: `REQUESTER_NOT_AUTHORIZED` (Worker พบตอนเริ่ม), exhausted, `EXPORT_TOO_LARGE`, `EXPORT_FAILED` และ stale transition (stale transition ของ API เกิดได้เฉพาะเมื่อผู้เรียกเป็น `owner`/`admin` จึงไม่เข้ากรณีนี้) helper ตรวจ role ของผู้ขอใน transaction เดียวกับการ fail ส่ง `AUDIT_EXPORT_FAILED` ถ้ายังเป็นสมาชิก ไม่ส่งถ้าไม่เป็นสมาชิกแล้ว ลิงก์ไปหน้าที่ `auditor` เปิดได้แต่ไม่เห็น section และ `viewer` ได้ denied | `AC-16`, `AC-06` | ตัดสินแล้ว 2026-10-03: แจ้งถ้ายังเป็นสมาชิก |
| P-08 | notification ล้มเหลวเมื่อ Worker `audit-exporter` ไม่ทำงานและผู้ขอไม่กลับมาที่หน้า: role `scheduler` ที่มีอยู่รัน stale sweep ทุกรอบ (กลไกใน Jobs "Stale sweep") | `AC-16` | ตัดสินแล้ว 2026-10-03: ทางเลือก (ค) |
| P-06 | ไฟล์ดาวน์โหลดได้ 24 ชั่วโมงหลังสร้างเสร็จ แถวใน `ไฟล์ส่งออกของฉัน` แสดง 7 วัน ไม่เกิน 20 แถว | `AC-16`, state table แถวไฟล์ส่งออกของฉัน | ตัดสินแล้ว 2026-10-03: 50,000 event / 25 MiB / 24 ชั่วโมง / 7 วัน |

## AC trace

| AC | Contract | Task | Test |
| -- | -------- | ---- | ---- |
| AC-01 | Web (nav, routes) | NODE-F007-04 | sidebar และ ⌘K ทุก role, leaf ไปรายการของ Organization ที่ active |
| AC-02 | List API, Web | NODE-F007-03, NODE-F007-04 | 03: seed 51 event ลำดับ, total, หน้าสอง, ไม่มีคอลัมน์ผลลัพธ์; 04: ตาราง, ปุ่มหน้า, เวลาและชื่อ zone |
| AC-03 | การเขียน event, List API, Web | NODE-F007-01, NODE-F007-02, NODE-F007-04 | 01/02: ทุก action สำเร็จเขียน event และ denied ไม่เขียน; 04: รีเฟรชแล้วเห็นแถวใหม่ |
| AC-04 | RLS, Read API | NODE-F007-01, NODE-F007-03 | 01: RLS test ด้วย runtime role; 03: HTTP A-only/B-only/A+B |
| AC-05 | Authorization, API | NODE-F007-03, NODE-F007-05, NODE-F007-04, NODE-F007-06 | HTTP ทุก role × Organization ที่มีและไม่มี เทียบ status/code/message; auditor export ตรงไม่มีคำขอหรือ event; UI ซ่อนปุ่มและ section |
| AC-06 | Web, Authorization | NODE-F007-04, NODE-F007-06 | ลด role จากอีก session แล้ว กรอง/เปลี่ยนหน้า/รีเฟรช/รายละเอียด/ส่งออก/ดาวน์โหลด |
| AC-07 | Web (org switch) | NODE-F007-04, NODE-F007-06 | สลับระหว่างโหลดและหลังโหลด, response ค้างของ A, ปลายทางตาม role (`OD-14`) |
| AC-08 | Web | NODE-F007-04, NODE-F007-06 | ทุก state, ไม่มีข้อมูลกับไม่ตรงตัวกรอง, จำนวนที่ไม่ทราบไม่เป็น `0` |
| AC-09 | Data (`audit_recording_started_at`), List API, Web | NODE-F007-01, NODE-F007-03, NODE-F007-04 | Organization ที่เริ่มบันทึกไม่ถึงและเกิน 365 วัน (ตั้ง column ใน test), note ในหน้าและ dialog |
| AC-10 | List API (filters, search), Web | NODE-F007-03, NODE-F007-04 | 03: AND ของทุกตัวกรอง, 4 แหล่งของ `q`, ไม่ค้นอีเมลและ `changes`; 04: query string, เปิดลิงก์ซ้ำ, `ล้างตัวกรอง` |
| AC-11 | Web | NODE-F007-04 | ค่าผิดสองแบบ, network ไม่มี request |
| AC-12 | Detail API, Web | NODE-F007-03, NODE-F007-04 | รายละเอียดทุกหมวด, เป้าหมายที่ลบแล้ว, grep อีเมลและ IP ใน response และ DOM |
| AC-13 | Detail API | NODE-F007-03, NODE-F007-04 | ไม่มี/พ้น cutoff/Organization อื่น/ไม่ใช่ UUID ได้ body เดียวกัน |
| AC-14 | Redaction, การเขียน event | NODE-F007-01, NODE-F007-02, NODE-F007-04, NODE-F007-05 | 01: role และ settings; 02: ค่าลับและ query ที่รู้ค่า, body; 04: การแสดงผล; 05: ไฟล์ |
| AC-15 | Jobs (รูปแบบไฟล์) | NODE-F007-05 | เทียบ CSV/JSON กับ detail API, ISO UTC, `timeZone`, note, ค่าลับที่รู้ค่า |
| AC-16 | Export API, Jobs, Web | NODE-F007-05, NODE-F007-06 | สำเร็จ, job ล้มเหลว, คำขอล้มเหลว, 0 รายการ, คำขอที่สอง (UI และ request ตรง), A กับ B |
| AC-17 | Web | NODE-F007-04 | keyboard, screen reader, caption, `th scope`, `role="status"`, focus หลังเปลี่ยนหน้า |
| AC-18 | Web | NODE-F007-04 | focus h1, คืน focus แถว, แถวไม่อยู่แล้วไป heading, `<dl>` |
| AC-19 | Web | NODE-F007-06 | dialog focus trap, Escape, `role="alert"`, `role="status"` |
| AC-20 | API, Data, Web | ทุก node (NON-GOALS), Integrated | OpenAPI ไม่มี update/delete/cross-org, grant ไม่มี update/delete, ไม่มีตัวกรองผลลัพธ์ |
| AC-21 | การเขียน event | NODE-F007-01, NODE-F007-02 | trigger ใน test ที่ทำให้ insert `audit_events` ล้ม แล้วเรียกทุก request type: ข้อมูลไม่เปลี่ยน, response error, หน้าแสดง error; mutation สำเร็จมี event หนึ่งแถว |
| AC-22 | Export API | NODE-F007-05 | export เขียน event พร้อม `exportScope`; list, detail, actors, exports list, download ไม่เขียน |
| AC-23 | Download API | NODE-F007-05, NODE-F007-06 | ผู้ขอ, ผู้ใช้อื่นใน Organization เดียวกัน, auditor, ผู้ขอที่ถูกลดเป็น auditor/viewer, ถูกถอน, Organization อื่น |
| AC-24 | Data (cutoff, purge), Read API, Jobs | NODE-F007-01, NODE-F007-03, NODE-F007-05 | seed ตาม P-02 ใน list, detail และไฟล์ |
| AC-25 | Concurrency | NODE-F007-05 | ดู AC-25 |
| AC-26 | Security | NODE-F007-01, NODE-F007-02, NODE-F007-03, NODE-F007-05 | ดู AC-26 |
| AC-27 | Verification | NODE-F007-01, NODE-F007-02, P1 | ดู AC-27 |

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
- **OUTCOME:** migration `0019` (`audit_events`, partition, retention, `audit_recording_started_at`) อยู่; `recordAuditEvent` อยู่; 7 request type ของสมาชิก คำเชิญ และ settings เขียน event ใน transaction; hook `onMonitorAlertsChanged` ถูกลบ; `scripts/partitions.mjs` ครอบ `audit_events`
- **SOURCE:** Data, การเขียน event, Authorization และ security, Concurrency ใน Spec นี้; `AC-03`, `AC-04`, `AC-09`, `AC-14`, `AC-21`, `AC-24`, `AC-26`, `AC-27`
- **INVARIANTS:** lock order และ response/error ของ `F-004`/`F-006` ไม่เปลี่ยน; denial ไม่เขียน event และพฤติกรรมของ `auditDenials` คงเดิม (ย้ายที่อยู่เท่านั้น); no-op ไม่เขียน event; ไม่เก็บอีเมล, ชื่อ หรือ `invitation.id`; runtime role ได้ `select, insert` บน `audit_events` เท่านั้น; ไม่มี DEFAULT partition
- **FILES:** `packages/db/migrations/0019_organization_audit_log.sql` (new), `packages/db/src/schema.ts`, `packages/db/src/audit.ts` (new, partition wrapper), `packages/db/src/index.ts` (export `ensureAuditEventPartitions`), `apps/api/src/audit/record.ts` (new), `apps/api/src/audit/test-support.ts` (new, partition ของเดือนที่ระบุด้วย owner URL), `apps/api/src/audit/denials.ts` (new: ย้าย `auditDenials` จาก `organization-notifications/routes.ts:96-113` ซึ่งไม่ได้ export มาไว้ที่นี่ เพื่อให้ `apps/api/src/audit/routes.ts` ของ 03 และ 05 ใช้ร่วม), `apps/api/src/organization-notifications/members.ts` (รวม no-op ของ role เดิม), `invitations.ts`, `service.ts`, `routes.ts` (ส่ง `requestId`, import `auditDenials` ใหม่, ลบ `auditMonitorMutation` ของ settings), `packages/db/package.json` (เพิ่ม test ใหม่ใน `test:integration` ถ้ามี test ใน `packages/db/tests`), `scripts/partitions.mjs`, `scripts/quality/README.md` (หัวข้อ partitions), focused tests
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
- **CONTRACTS:** `monitorAuditChanges` และรูป `changes` ที่ NODE-F007-03/04/05 แสดงผล
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
- **PROOF:** ทุก role × A-only/B-only/A+B และ Organization ที่ไม่มีอยู่ เทียบ status/code/message (`AC-04`, `AC-05`); สมาชิกที่ `member.role` เก็บเป็น `"viewer,auditor"` ได้ผลเดียวกับ role ที่ normalize แล้วทั้ง list, detail และ actors (ไม่ได้สิทธิ์อ่านแบบ `auditor`); 51 event: ลำดับ, total, หน้าสองมีหนึ่งแถว, `offset >= total`, `asOf` กันแถวใหม่ (`AC-02`); AND ของตัวกรอง, `q` ตรง label/code/ชื่อผู้ดำเนินการ/ชื่อเป้าหมาย/UUID และไม่ตรงอีเมล, `%`/`_` ใน `q` (`AC-10`); รายละเอียดทุกหมวดและเป้าหมายที่ลบแล้ว (`AC-12`); 404 สี่กรณีเหมือนกัน (`AC-13`); seed ตาม P-02 ใน partition ที่ test helper ของ 01 สร้าง (`AC-24`); `retainedFrom` และ `recordingStartedAt` (`AC-09`); actors ไม่มีสมาชิกที่ไม่เคยทำ action (`AC-26`); log path เป็น route template และไม่มี `q`
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
- **INVARIANTS:** คำขอและ event อยู่ใน transaction เดียว; role ตรวจก่อนเปิดเผยจำนวน; ไม่เกิน 1 คำขอที่กำลังสร้างต่อผู้ใช้ต่อ Organization; Worker ตั้ง context จาก claim เท่านั้น; complete และ fail เป็น update แบบมีเงื่อนไขของ `claim_token` และ complete มีเงื่อนไข deadline; กฎ 60 นาทีอยู่ใน `audit_export_deadline()` เท่านั้น; ทุกทางที่เป็น `failed` รวม sweep ของ P-08 สร้าง notification ใน transaction เดียวกัน (ผู้รับตาม P-07); claim และ sweep ใช้ WHERE ของตัวเอง ไม่อิง policy และไม่แตะแถว `ready`/`failed`; claim owner ไม่มี grant บน `audit_exports`; ไม่มี network หรือการสร้างไฟล์ใน transaction; notification ถึงผู้ขอคนเดียว; download ตรวจ role ทุกครั้งและไม่เขียน event; ไม่ใช้ Redis
- **FILES:** `packages/db/migrations/0020_audit_exports.sql` (new), `packages/db/src/schema.ts`, `packages/db/src/tenant-context.ts` (`withTenantUserContextRaw`), `apps/api/src/audit/export-service.ts` (new), `apps/api/src/audit/routes.ts`, `apps/api/src/app.ts` (`logSafeOrganizationPath` ของ exports), `packages/api-contract/src/audit-log.ts`, `packages/api-contract/src/notification.ts`, `packages/db/src/notification.ts`, `apps/api/src/notifications/service.ts` (map ชนิดใหม่), `apps/worker/src/index.ts`, `apps/worker/src/audit/` (new), `apps/worker/src/materialize.ts`, `apps/worker/src/dispatch.ts` (เพิ่มขั้น stale sweep ในรอบของ `scheduler` ตาม P-08 (ค)), `apps/worker/package.json` (เพิ่ม test ใหม่ใน `test:integration`), `packages/db/package.json` (ถ้าเพิ่ม test ใน `packages/db/tests`), `apps/web/src/pages/NotificationsPage.tsx` (`itemTitle`, `itemContext` หมวด "องค์กร / บันทึกกิจกรรม", `ItemIcon` และลิงก์ `เปิดบันทึกกิจกรรม` ไป `.../audit-log#my-exports` ของชนิดใหม่ (`M-10`): switch ไม่มี default จึงต้องแก้พร้อม contract ไม่เช่นนั้น item ใหม่ได้ข้อความของ MFA ที่ `:67-70`), `apps/web/src/lib/api/openapi-types.gen.ts` (codegen เท่านั้น), focused tests
- **NON-GOALS:** web UI, deploy config, S3, BullMQ queue, เปลี่ยนการ claim/enqueue/retry ของ notification dispatch เดิมใน `dispatch.ts`
- **CONTRACTS:** export API, `AuditExportRecord`, notification ชนิดใหม่ที่ NODE-F007-06 ใช้; ชื่อ role `audit-exporter` และ readiness log ที่ P1 ใช้
- **VERIFY:** ตามคำสั่ง VERIFY ข้างบน: `apps/api` กับไฟล์ test ของ export และ notifications, `apps/worker` (`test:integration` ที่เพิ่มไฟล์แล้ว), `packages/db` ถ้าเพิ่ม test; `bun run codegen:check` test ที่ seed event ในเดือนที่ผ่านมาด้วย `createAuditPartitionFor` (เช่น cutoff ของไฟล์ตาม P-02) ต้องใช้ DB แยกแบบ `store.db.test.ts`
- **PROOF:** migration `0020` apply บน DB ที่มี `0019` และข้อมูลเดิม; RLS ของ `audit_exports` และ `audit_export_jobs` (runtime role ใน context ของผู้ใช้อื่นหรือ Organization อื่นอ่าน/update ไม่ได้); `claim_audit_export()` คืนแถว `queued` และแถว `running` ที่ lease หมดได้จริงและ update สำเร็จ (ไม่ติด policy ของแถวใหม่) แต่ไม่คืนแถวที่ lease ยังไม่หมด; claim owner select `audit_exports` ไม่ได้ (permission denied); insert ledger ที่ `tenant_id` หรือ `requested_by` ไม่ตรงกับแถวแม่ถูก FK ปฏิเสธ; claim ไม่คืนแถว `ready`/`failed` ที่พ้น deadline; ผู้ขอที่มีแถว `ready` เก่าที่พ้น deadline และแถว `queued` ใหม่ ยังถูก claim แถวใหม่ได้; sweep ของ `scheduler` (P-08 (ค)) ทำงานโดยไม่มี role `audit-exporter`, ไม่แตะแถว `ready`/`failed`, error ของ sweep ไม่หยุด dispatch เดิมในรอบ, และเปลี่ยนแถวที่พ้น deadline เป็น `failed` พร้อม notification หนึ่งรายการใน transaction เดียว; ลบแถวแม่แล้วแถว ledger หายตาม cascade; purge ล้างแถวที่หมดอายุใหม่ได้แม้มีแถวที่ล้างแล้วมากกว่า `p_limit` และไม่ update แถวที่ล้างแล้วซ้ำ; `auditor`/`viewer` เรียก `GET .../exports` ขณะมีแถวของตนที่พ้น deadline ได้ `403` และ `state` ไม่เปลี่ยน ไม่มี notification intent ใหม่; retention owner ล้าง `content` ได้เฉพาะแถวที่พ้น `file_expires_at` และลบได้เฉพาะแถวอายุเกิน 7 วัน; insert intent และ inbox item ของ `AUDIT_EXPORT_READY` และ `AUDIT_EXPORT_FAILED` ที่ scope `tenant` สำเร็จทั้งสองตาราง และ scope `account` ถูก check ปฏิเสธ; `auditor` และ `viewer` ได้ `403 PERMISSION_DENIED` ที่ไม่มีจำนวนใน body ทั้งเมื่อ filter มี 0 event และเมื่อมีมากกว่า 50,000 event (B-01); owner/admin ขอ CSV และ JSON ได้ ไฟล์ตรงกับ detail API ทุก field, ISO UTC, `timeZone`, note, preamble และ BOM (`AC-15`); 0 รายการ `422` และเกิน 50,000 `422` ไม่สร้างคำขอหรือ event; คำขอที่สองระหว่างคำแรก `409` และใน Organization อื่นสำเร็จ (`AC-16`); auditor/viewer/non-member ตรงได้ `403` ไม่มีคำขอหรือ event (`AC-05`); event ของ export มี `exportScope` ไม่มี `q` และ list/detail/download ไม่เขียน event (`AC-22`); ดาวน์โหลดทุกกรณีของ `AC-23` รวม `410` หลัง 24 ชั่วโมงและ `409` ระหว่างสร้าง; race ทุกแถวของ `AC-25`; notification ready/failed ถึงผู้ขอคนเดียวพร้อมลิงก์ (inbox API และ `NotificationsPage` แสดง label, หมวด "องค์กร / บันทึกกิจกรรม", icon และลิงก์ `เปิดบันทึกกิจกรรม` ไป `#my-exports` (`M-10`)); POST ที่ใช้ `filters` ของแถว `expired` (ขอใหม่) สำเร็จด้วย `201` และ `from` ที่เก่ากว่า `retainedFrom` ถูก clamp (`M-9`); ไฟล์เกิน 25 MiB เป็น `failed`; event อายุตาม P-02 ไม่อยู่ในไฟล์ (`AC-24`); ค่าลับที่รู้ค่าไม่อยู่ในไฟล์, cell `=HYPERLINK(...)` ถูก escape, Worker log ไม่มีชื่อหรือ filter (`AC-26`); shutdown ระหว่างสร้างไฟล์แล้ว claim ใหม่สำเร็จ
- **COVERS:** AC-05, AC-15, AC-16, AC-22, AC-23, AC-24, AC-25, AC-26

### P1 Worker role `audit-exporter` ใน deploy config

- **OWNER:** platform-engineer
- **READY:** NODE-F007-05 อยู่ใน review และมี entry point ของ role
- **OUTCOME:** environment ที่ deploy Worker รัน role `audit-exporter` อย่างน้อยหนึ่ง replica และ `bun run db:partitions` รันหลัง `db:migrate` ครอบ `audit_events`
- **SOURCE:** Jobs, Data (partition) ใน Spec นี้; `AC-27`
- **INVARIANTS:** role ที่มีอยู่ (`consumer`, `scheduler`, `monitor-scheduler`, `monitor-checker`) และ deploy config ของ role เหล่านั้นไม่เปลี่ยน (`scheduler` ได้ขั้น stale sweep เพิ่มจากโค้ดของ NODE-F007-05 ตาม P-08 (ค) โดยใช้ config เดิม); ไม่มี secret หรือ env ใหม่ role ใช้ `DATABASE_URL` และต้องได้ `REDIS_URL` เพราะ process บังคับทุก role (`apps/worker/src/index.ts:59`); container non-root (SYS-02)
- **FILES:** `compose.worker.yaml`, deploy manifest ของ environment ถ้ามีใน repository, `e2e/playwright.config.ts` ถ้า e2e ต้องเพิ่ม role
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
- **FILES:** `apps/web/src/lib/api/client.ts` (`requestFile`), `apps/web/src/lib/api/audit-log.ts`, `apps/web/src/pages/audit-log/` (`ExportDialog`, section, notice และ hash `#my-exports`), focused tests
- **NON-GOALS:** API change, การดูไฟล์ในหน้า, แก้ `ConfirmDialog` หรือ `NotificationsPage` (อยู่ใน 05)
- **CONTRACTS:** ไม่มี
- **VERIFY:** `bun run --cwd apps/web test -- <files>` ของ dialog, section, ปุ่ม และ download
- **PROOF:** dialog: focus เริ่มที่ตัวเลือกแรกใน `fieldset` "รูปแบบไฟล์", ขอบเขตแสดง "ณ โหลดเมื่อ" และ request body มี `asOf`/`from`/`to` เท่ากับ response รายการ (`M-4`), เนื้อหาเลื่อนในตัวโดย title และปุ่มยังเห็นที่ 200% zoom, ระหว่างส่ง `aria-busy` และ `ยกเลิก`/Escape ไม่ทำงาน, กดซ้ำได้ request เดียว (`M-3`); ผล POST `422` สองแบบ (เกินขนาดใช้ `details.total`), `409`, network และ `201` ตามขั้นตอน 8; `201` แล้วปุ่มเป็น `กำลังสร้างไฟล์…` ก่อน refetch (`M-1`) และลิงก์ `ดูไฟล์ส่งออกของฉัน` ย้าย focus ไป h2 (`M-5`); 0 รายการและเกิน 50,000 เป็น `aria-disabled` พร้อม `aria-describedby` (`M-2`); `inProgress` ทำให้ปุ่มและ `ขอใหม่` ทุกแถวเป็น `aria-disabled` กลับเป็น `ส่งออก` เมื่อเสร็จ (`AC-16`); section เป็น `<table>` ที่มี caption, live region เดียวประกาศเฉพาะแถวที่เปลี่ยน, ชื่อปุ่มรายแถว, poll ล้มเหลวคงแถว (`M-8`); เหตุผลตาม `failureCode` ทั้งสามแบบ และ `ปรับตัวกรอง` เขียน query string แล้ว focus ที่ section ตัวกรอง (`M-6`); แถว `expired` มี `ขอใหม่` และ `ขอใหม่` ของแถว `failed`/`expired` ส่ง `filters` absolute เดิม พร้อม error ในแถวด้วย `role="alert"` (`M-9`); ดาวน์โหลดได้ไฟล์ชื่อตาม header, `กำลังดาวน์โหลด…`, `404`/`409` refetch, `410` แถวเป็น "หมดอายุ" พร้อม `ขอใหม่`, network (`M-7`); `403` จาก exports list, poll, POST, `ขอใหม่` และ download ทุกทาง: poll หยุด, dialog ปิด, ปุ่มกับ section หาย, notice ระดับหน้าได้ focus และรายการยังอ่านได้ (`B-2`, `AC-06`, `AC-23`); `auditor` ไม่ส่ง request ไป exports list (`AC-05`); สลับ Organization ไม่เหลือแถวไฟล์ของ A (`AC-07`); state ของ section รวม skeleton ขั้นต่ำ (`AC-08`); focus trap และ `role="alert"`/`role="status"` (`AC-19`); เปิด `.../audit-log#my-exports` แล้ว focus ไป h2 และกรณี `auditor` เปิดที่ด้านบน (`M-10`)
- **COVERS:** AC-05, AC-06, AC-07, AC-08, AC-16, AC-19, AC-23

## Integrated verification

- หลัง NODE-F007-06 merge: scenario A-only/B-only/A+B ด้วยทุก role ตั้งแต่ทำทุก action ใน Event inventory → รีเฟรชรายการ → กรองและค้นหา → รายละเอียด → ส่งออก CSV และ JSON → notification → ดาวน์โหลด → ลด role จากอีก session → สลับ Organization (`AC-01`–`AC-24`)
- `AC-20`: ตรวจ OpenAPI ว่าไม่มี endpoint แก้/ลบ event หรือดูข้าม Organization และ grant ของ `audit_events`
- `AC-21`: รัน trigger test ของ 01 และ 02 ซ้ำบน head สุดท้าย
- Browser smoke ด้วย keyboard และ screen reader ทั้ง light/dark (`AC-17`–`AC-19`)
- Worker local ด้วย role `audit-exporter` ร่วมกับ role เดิม (P1)
- หลัง writer หยุดทั้งหมด Technical Lead สั่ง final code review หนึ่งครั้ง และ PR CI gates `bun run validate`, `COVERAGE_GATE=1 bun run test:coverage` ตาม `scripts/quality/README.md` ไม่มี release หรือ deploy task

## Decision record

ผู้ใช้ตอบผ่าน coordinator (AskUserQuestion) รับค่าแนะนำทั้งหมด

| Decision | ผล | วันที่ | ผู้ตัดสิน |
| -------- | -- | ------ | --------- |
| version ของ `F-004` | ออก `F-004-AC-3` (Product Owner แก้ `F-004` `feature.md`) | 2026-10-03 | ผู้ใช้ |
| `F-006` spec Revisions | บันทึกว่า Design decision "Audit: denial-only" ถูกแทนด้วย `F-007` `OD-08` (บันทึกแล้วใน `F-006` `spec.md`) | 2026-10-03 | ผู้ใช้ |
| ที่เก็บไฟล์ส่งออก | `bytea` ใน PostgreSQL | 2026-10-03 | ผู้ใช้ |
| ขนาดสูงสุดและอายุ | 50,000 event, 25 MiB, ดาวน์โหลดได้ 24 ชั่วโมง, แสดงคำขอ 7 วัน | 2026-10-03 | ผู้ใช้ |
| Worker แบบ DB claim | role `audit-exporter` ไม่ใช้ BullMQ | 2026-10-03 | ผู้ใช้ |
| DEFAULT partition | ไม่มี และยอมรับ risk ใน Risks ข้อแรก | 2026-10-03 | ผู้ใช้ |
| Quality target | ไม่กำหนด | 2026-10-03 | ผู้ใช้ |
| P-01 | ปฏิเสธพร้อมเหตุผลเมื่อเกิน 50,000 รายการ | 2026-10-03 | ผู้ใช้ |
| P-07 | แจ้งถ้ายังเป็นสมาชิก | 2026-10-03 | ผู้ใช้ |
| P-08 | ทางเลือก (ค) `scheduler` ทำ stale sweep | 2026-10-03 | ผู้ใช้ |
| อนุมัติ Spec | `Status` Approved, freeze `F-007-AC-1` (Product Owner บันทึกใน `feature.md`) ไม่ใช่ start authorization | 2026-10-03 | ผู้ใช้ |
| UX `M-9` | แถว "หมดอายุ" มีปุ่ม `ขอใหม่` Product Owner ออก `F-007-AC-2` (เปลี่ยนเฉพาะ `AC-16`) | 2026-10-03 | ผู้ใช้ |

## Open decisions

ข้อเหล่านี้ไม่อยู่ในคำตัดสินที่ส่งมา ใช้ค่าที่ Product Owner บันทึกใน `feature.md` และเป็น gate ของ node ตามคอลัมน์ READY

| Decision | Options | ข้อแนะนำ | Owner |
| -------- | ------- | -------- | ----- |
| None | | | |

ปิดใน `feature.md` `F-007-AC-2` (2026-10-03, Product Owner ตามที่ coordinator มอบ): P-03 (รับ map ตามตาราง "การเขียน event"), P-04 (label ใน Event inventory ของ `feature.md` `AUDIT_ACTION_LABELS`/`AUDIT_CATEGORY_LABELS` ใช้ตามตารางนั้น), `OD-10` (ไม่แสดงชื่อ "ไม่ใช่สมาชิกแล้ว" ตรงกับค่าเริ่มต้นของ Spec), `OD-11` (`PERMISSION_DENIED` "คุณไม่มีสิทธิ์ดูบันทึกกิจกรรม"), `OD-12` (icon `history`) และ UX review (`B-1`, `B-2`, `M-1`–`M-10`, `a-1`, `a-2`, `m-5`)

## Revisions

A change to an approved contract or AC is recorded here and approved again by the user.

| Date | Change | Approved by user | `acceptanceVersion` |
| ---- | ------ | ---------------- | ------------------- |
| 2026-10-02 | Draft แรก | Not yet | `F-007-AC-1` (draft) |
| 2026-10-02 | review round 1 (1 blocker, 5 major, 8 minor, 3 nit): ตรวจ role ก่อนนับใน POST export; แยก claim ledger `audit_export_jobs` (DB-10) พร้อม policy แบบ `monitor_schedule_claim_*`; กฎ 60 นาทีใน `audit_export_deadline()` และ complete มีเงื่อนไข deadline; ทุกทาง failed สร้าง notification และเพิ่ม P-07; drop/recreate scope check ของ notification; policy และ grant ของ retention owner; cutoff ต่อ batch; no-op ของ role เดิม; `formatAuditTimestamp`; คำสั่ง VERIFY ที่รันได้และ `package.json` ใน FILES; P1 VERIFY และ `REDIS_URL`; ย้าย `auditDenials`; แก้ redaction ของ URL และถ้อยคำ `StoredConfig` | Not yet | `F-007-AC-1` (draft) |
| 2026-10-02 | review round 2 (7 minor/nit): composite FK และ unique `(id, tenant_id, requested_by)` ของ ledger; `content_purged_at` ใน purge, policy และ grant ของ retention owner; ลำดับขั้นของ `GET .../exports`; ขยาย P-07 ให้ครอบทุกทาง fail; เพิ่ม P-08; time limit ครอบการอ่าน batch; ภาพรวมระบุ `REDIS_URL` | Not yet | `F-007-AC-1` (draft) |
| 2026-10-02 | review round 3 (1 major, 1 minor, 1 nit): claim ใช้ WHERE ของตัวเอง; sweep ของ P-08 เป็น `find_stale_audit_exports` แบบ read-only แล้ว Worker ทำ stale transition แบบมีเงื่อนไขพร้อม notification ใน transaction เดียว ไม่แก้ update policy ของ claim owner; ผลของ (ค) ต่อ P1 และ NODE-F007-05; `statement_timeout` ต่อ batch | Not yet | `F-007-AC-1` (draft) |
| 2026-10-03 | ผู้ใช้อนุมัติ Spec: `Status` Approved, freeze `F-007-AC-1`; บันทึกคำตัดสินใน Decision record; P-01, P-06, P-07, P-08 เป็นคำตัดสิน; ล็อก stale sweep ของ `scheduler` (P-08 (ค)) ใน Jobs และ NODE-F007-05; อ้าง `F-004-AC-3`; Start authorization ยังไม่มี (ผู้ใช้เริ่มด้วย `/implement-issue`) | 2026-10-03 | `F-007-AC-1` (frozen) |
| 2026-10-03 | ตาม `feature.md` `F-007-AC-2` (Product Owner ออกหลัง UX review ผู้ใช้ตัดสิน `M-9`): Web รับ UX `B-2`, `M-1`–`M-10`, `a-1`, `a-2` (exports query เฉพาะ `owner`/`admin`, handler `403` เดียว, `ExportDialog` แทน `ConfirmDialog`, dialog ส่ง `asOf`/`from`/`to` ของรายการ, anchor `#my-exports`, เหตุผลตาม `failureCode`, สถานะดาวน์โหลด, table และ live region เดียว, หมวดและลิงก์ใน inbox, เป้าหมายและขอบเขตของ event การส่งออก); `ขอใหม่` ของแถว `expired` ใน API, Web และ PROOF; ตรวจแล้วว่า code `422`/`409`/`404`/`410` ใน `feature.md` ตรงกับ API contract; NODE-F007-04/05/06 ปรับ OUTCOME, FILES และ PROOF; อ้าง `F-007-AC-2` แทน `F-007-AC-1` ยกเว้นแถวประวัติใน Revisions ไม่มีการเปลี่ยน API contract | 2026-10-03 | `F-007-AC-2` (frozen) |
| 2026-10-03 | Implementation deviation ของ NODE-F007-01 (`a401e91`): `audit_events.tenant_id references organization(id) on delete cascade` บันทึกเป็น provisional ใน Data รอผล code review ว่าขัด invariant ของ runtime role (`AC-20`, `AC-26`) หรือไม่ ยังไม่ได้รับการอนุมัติจากผู้ใช้ | Not yet (provisional) | `F-007-AC-2` (frozen) |
| 2026-10-03 | ผล code review ของ NODE-F007-01 (accept): C4 `on delete cascade` เปลี่ยนจาก provisional เป็น accepted (ทุกตาราง tenant cascade จาก `organization` อยู่แล้ว) และเพิ่ม `packages/db/src/index.ts` ใน FILES; C3 (Technical Lead): role update เป็น no-op เฉพาะเมื่อ raw role เท่ากับ role ที่ขอทุกตัวอักษร composite ที่ขอเป็น role เดียว update และเขียน event; NODE-F007-03 INVARIANTS/PROOF ใช้ role ที่ normalize แล้วสำหรับสิทธิ์อ่าน; NODE-F007-03/05 VERIFY ระบุ DB แยกสำหรับ `createAuditPartitionFor`; follow-up นอก scope: revoke `DELETE` บน `organization` จาก `nightwatch` ใน migration แยก ไม่เปลี่ยน API contract หรือ AC | Technical Lead (review outcome; ไม่มีการเปลี่ยน contract ที่ผู้ใช้อนุมัติ) | `F-007-AC-2` (frozen) |
