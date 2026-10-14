# F-011 Implementation spec: มอนิเตอร์ เหตุการณ์ และการแจ้งเตือนภายใต้ Project

Source: issue #94 (`F-011`, Parent `E-003`) · Shared contract: issue #101 (`TS-002`) · Design: artboard "โปรเจกต์ · ตรวจสถานะบริการ" (`project/ProjectMonitors.dc.html`) · Status: Approved (ผู้ใช้อนุมัติ 2026-10-14)

การอนุมัติ spec ไม่ใช่การอนุญาตให้ publish, deploy หรือ release

PR #107 (merge 2026-10-13, head `65d7cda`) implement `F-011` และปิด #94 ก่อนมี spec ฉบับนี้ spec จึงบันทึก contract ตามโค้ดที่ merge แล้ว เพื่อให้ `F-012`, `F-016` และ `TS-003` อ้างได้ และรวบรวมจุดที่โค้ดต่างจาก #94 และ `TS-002` ไว้ในหัวข้อ "ข้อแก้ไขที่ต้องนำกลับไปอัปเดต TS-002" การตัดสินใจที่ #94 เปิดไว้ ผู้ใช้ยืนยันเมื่อ 2026-10-14 และบันทึกในหัวข้อที่เกี่ยวข้อง Acceptance criteria อ้างจาก #94 ด้วย ID `AC-01` ถึง `AC-09` กฎที่ `TS-001` (#100) และ `TS-002` กำหนดไว้แล้วใช้ตามนั้นโดยไม่คัดลอกซ้ำ

## ขอบเขต

ทำใน F-011 (ส่งมอบใน #107):

- Migration `0026_project_monitors.sql`: ล้างข้อมูลมอนิเตอร์เดิม เพิ่ม `monitors.project_id` และ `subject_project_id` ของ notification
- Route มอนิเตอร์ทั้ง 15 operation ย้ายไปใต้ `/api/organizations/{organizationId}/projects/{projectId}/monitors` และลบ route ระดับองค์กร
- สิทธิ์ `monitor.read`, `monitor.write`, `monitor.readResponse` ในตาราง `PROJECT_PERMISSIONS` และลบ `apps/api/src/monitors/permissions.ts`
- เพดาน 20 มอนิเตอร์ต่อ Project แทนเพดาน 50 ต่อองค์กร
- ผู้รับการแจ้งเตือนระดับ Project ทั้งตอนสร้าง intent, ตอน materialize และตอนอ่าน inbox
- audit event ของมอนิเตอร์บันทึก Project ทั้งฝั่งเขียน ฝั่งอ่าน และ Worker exporter
- หน้ามอนิเตอร์ทั้ง 5 route ใต้ Project, nav leaf `ตรวจสถานะบริการ` ในกลุ่ม Project, ลิงก์จาก inbox และบันทึกกิจกรรม
- `docs/runbooks/uptime-monitor.md` (การล้างข้อมูลและลำดับ rollout) และ `docs/ref/shell-structure.md`

ไม่ทำใน F-011 (เจ้าของงานอยู่ในวงเล็บ):

- หน้าภาพรวมของ Project `projects/:projectId/overview` และการลบ `WorkspacePage` (`F-012`, `TS-002-T05`)
- ภาพรวมรวมทุก Project ของ Owner/Admin (`F-016`)
- การย้ายมอนิเตอร์ข้าม Project และการย้ายข้อมูลมอนิเตอร์เดิม (นอกขอบเขต `E-003`)
- การรัน script `e2e/verification/*.ts` 5 ตัว (api-matrix, purge-check, redis-outage, rls-check, worker-restart) ที่แก้ให้ใช้ Project แล้ว ต้องมี log ของ Worker ที่รันอยู่ (ยังไม่มีเจ้าของ)

## Data และ RLS (`TS-002-T01`)

Migration `0026_project_monitors.sql` (DB-11, DB-12) ใช้หมายเลข 0026 เพราะ `0024` และ `0025` เป็นของ `TS-001`

การล้างข้อมูล (`AC-08`):

- `truncate` 8 ตาราง: `monitors`, `monitor_secrets`, `monitor_schedule`, `monitor_check_results`, `monitor_check_hourly`, `monitor_incidents`, `monitor_events`, `monitor_last_responses` ระบุทุกตารางที่อ้าง `monitors` โดยไม่ใช้ `cascade` ตารางที่ migration ไม่รู้จักจึงทำให้ migration ล้ม แทนที่จะถูกล้างเงียบ ๆ `truncate` ไม่ถูกกรองด้วย RLS
- `delete from notification_intents where event_type like 'MONITOR\_%'` cascade ไป recipients, inbox items และ dispatch ledger ยก `force row level security` ของ `notification_intents` และ `notification_inbox_items` ชั่วคราวในธุรกรรมเดียวกัน แล้วตรวจว่าไม่มีแถว `MONITOR_*` เหลือ มิฉะนั้น `raise exception`
- `audit_events` ไม่ถูกแตะ (append-only และไม่มี FK ไป `monitors`) event ก่อน F-011 จึงไม่มี Project

โครงสร้างใหม่ (`AC-01`, `AC-07`):

- `monitors.project_id uuid not null` และ `constraint monitors_project_fkey foreign key (project_id, tenant_id) references projects (id, tenant_id) on delete cascade` ตาม "Dependency contract สำหรับ feature ถัดไป" ใน `docs/specs/F-001-projects.md` ลบ Project จึงลบมอนิเตอร์ และ cascade เดิมของ `0016` ลบ secrets, schedule, results, rollups, incidents, events และ last responses ต่อ
- `monitors_client_request_key` เปลี่ยนเป็น `unique (tenant_id, project_id, client_request_id)` replay ของ Create จึงค้นหาใน Project เดียว
- index `monitors_project_idx (tenant_id, project_id, id)` สำหรับรายการต่อ Project
- `notification_intents.subject_project_id` และ `notification_inbox_items.subject_project_id` เป็น `uuid` ไม่มี FK เพราะ notification อยู่ได้นานกว่ามอนิเตอร์และ Project พร้อม check `event_type not like 'MONITOR\_%' or subject_project_id is not null`
- RLS ของทุกตารางยังเป็นระดับ tenant ตาม `0016` (DB-04) ไม่มี policy ระดับ Project การกรอง Project บังคับด้วย `withProjectAccess` และ `project_id` ในทุก query (หลัก "Database and isolation" ใน `docs/architecture.md`)

Drizzle: `projectId`, `monitors_project_fkey` และ `monitors_project_idx` ของ `monitors` กับ `subjectProjectId` ของสองตาราง notification ใน `packages/db/src/schema.ts`

## Contract (`packages/api-contract`)

- `MONITOR_LIMIT_PER_PROJECT = 20` ใน `monitor.ts` แทน `MONITOR_LIMIT_PER_ORGANIZATION` ซึ่งถูกลบ `monitorListResponseSchema.summary.limit` เป็น `z.literal(MONITOR_LIMIT_PER_PROJECT)`
- `monitorListItemSchema.responseP95Ms24h: number | null` (`AC-04`)
- Param schema ใน `apps/api/src/monitors/params.ts`: `monitorProjectParamsSchema = projectOrganizationParamsSchema.extend({ projectId })` และ `monitorParamsSchema` เพิ่ม `monitorId` id เป็น string ยาวไม่เกิน 64 และตรวจรูปแบบ UUID ใน handler เพื่อให้ id ผิดรูปตอบ `404` เหมือน id ที่ไม่มี param schema ระดับองค์กรที่ไม่มีผู้ใช้แล้วถูกลบ
- Error codes: ไม่มี code ใหม่ `PROJECT_NOT_FOUND` (404) มาจาก `project.ts` ส่วน `MONITOR_NOT_FOUND` (404) และ `MONITOR_LIMIT_REACHED` (409) คงเดิมใน `MONITOR_ERROR_CODES`
- Notification: `monitorSubjectSchema = { projectId, monitorId, monitorName }` ใน `notification.ts`
- Audit: `auditTargetSchema` ประเภท `monitor` เพิ่ม `project?: { projectId, displayName, deleted }` ใน `audit-log.ts` optional เพราะ event ก่อน F-011 ไม่มี Project
- OpenAPI: regenerate `apps/web/src/lib/api/openapi-types.gen.ts` (`bun run codegen:check`)

## สิทธิ์ (`TS-001-T03`, `AC-02`, `AC-03`)

`apps/api/src/projects/access.ts` เป็นเจ้าของตารางเดียว F-011 เพิ่ม 3 action

| Action                                                                                  | `org-admin` | `member` / `admin` | `member` / `member` | `none` |
| --------------------------------------------------------------------------------------- | ----------- | ------------------ | ------------------- | ------ |
| `monitor.read` (list, recent-events, detail, checks, incidents, response-times, events) | ได้         | ได้                | ได้                 | 404    |
| `monitor.write` (create, edit, pause, resume, delete, test ทั้งสอง route)               | ได้         | ได้                | 403                 | 404    |
| `monitor.readResponse` (last-response)                                                  | ได้         | ได้                | 403                 | 404    |

- `none` ตอบ `404 PROJECT_NOT_FOUND` body เดียวกับ Project ที่ไม่มีอยู่หรือ id ผิดรูป (`AC-02`) 403 ใช้ `PERMISSION_DENIED` พร้อมข้อความเฉพาะ action ใน `DENIED_MESSAGES`
- ผู้ที่ไม่ใช่สมาชิกองค์กรได้ `403 MEMBERSHIP_DENIED` ก่อนถึงตารางนี้ ตาม convention ของทุก route ใต้ `/api/organizations/{organizationId}` คำตอบนี้มาก่อนการค้นหา Project จึงไม่บอกว่า Project มีอยู่หรือไม่ (ผู้ใช้ยืนยันเมื่อ 2026-10-14 ให้ใช้ `403` แม้ `AC-02` เขียนว่า `404`)
- มอนิเตอร์ของ Project อื่นที่เรียกผ่าน URL ของ Project ที่เข้าได้ตอบ `404 MONITOR_NOT_FOUND` แม้ผู้เรียกเป็น Owner ทุก query ระบุ `tenant_id` และ `project_id`
- Read action อ่าน role ขององค์กรใต้ `organization ... for share` (`readOrganizationRole`) write action ใช้ `enterOrganization` จากนั้นทั้งคู่ `lockProject` แบบ `for share` และอ่าน `project_members` ของผู้เรียกหลัง lock ตาม `TS-001`
- `monitor.readResponse` ให้ผู้ดูแลเท่านั้น เพราะ header และ body มาจากปลายทางและอาจมีข้อมูลส่วนบุคคล (OD-58-04 ของ #58) `AC-03` ระบุว่าเป็นข้อเสนอ ผู้ใช้ยืนยันเมื่อ 2026-10-14
- ฝั่งเว็บ `apps/web/src/pages/monitors/useMonitorAccess.ts` ใช้กฎเดียวกัน: `canWrite` เมื่อ role องค์กรเป็น `owner`/`admin` หรือ `myRole === "admin"` และ `DetailPage.tsx` ตั้ง `canReadResponse = canWrite`
- การตั้งค่าการแจ้งเตือนระดับองค์กร (`monitor_alerts_enabled`) ยังใช้สิทธิ์ Owner/Admin องค์กรเหมือนเดิม

## Concurrency

ลำดับ lock ของทุก write มอนิเตอร์ (comment ที่ `withMonitorWriteAccess` ใน `apps/api/src/monitors/service.ts`): แถว `organization` แบบ `for share`, แถว `projects` แบบ `for share`, advisory lock `monitors:<projectId>` (เฉพาะ create), แถว `monitors` แบบ `for update`, `monitor_schedule`, `monitor_incidents` สามลำดับหลังตรงกับ Worker ซึ่งไม่ lock `projects` แถว `projects` ใช้ `for share` เพื่อให้ write ของ Project เดียวกันไม่ต่อคิวกัน ส่วนการลบ Project ถือ `for update` จึงรอ write ที่ค้างอยู่

- เพดาน (`AC-06`): ใต้ advisory lock ต่อ Project ตรวจ replay ก่อน (replay ชนะเพดาน เพราะต้นฉบับนับแล้ว) แล้วนับ `monitors` ของ Project ถ้าได้ 20 ขึ้นไปตอบ `409 MONITOR_LIMIT_REACHED` สองคำขอพร้อมกันที่ตัวที่ 20 รอ lock เดียวกัน คำขอที่สองเห็นจำนวน 20 จึงสำเร็จได้ไม่เกินหนึ่ง Project ที่เต็มไม่กระทบ Project อื่น และไม่มีเพดานระดับองค์กร
- Replay: `clientRequestId` เดียวกันใน Project อื่นเป็นคำขอใหม่ตาม unique key ใหม่ และไม่คืนมอนิเตอร์ของ Project อื่น
- ตรวจสิทธิ์ Project ก่อน DNS และ outbound ทุกครั้ง: create, edit และ test เรียก `withMonitorWriteAccess` หรือ `assertMonitorExists` ก่อน `validateSaveTarget` แล้วตรวจซ้ำใต้ lock ก่อนอ่าน secret Project ที่ซ่อนจึงจบที่ `404` โดยไม่มี resolver หรือ timing signal (REQ-01, OUT-01) ผู้ดูแลที่ถูกนำออกระหว่าง pre-check กับการอ่าน secret ได้ `404` และไม่มีคำขอถึงปลายทาง
- ลบ Project (`AC-07`): `deleteProject` lock Project แบบ `for update` แล้ว `delete from projects` cascade ลบมอนิเตอร์สูงสุด 20 ตัวพร้อมผลตรวจ, rollup, incidents, events, secrets และ schedule ในธุรกรรมของคำขอเดียว ผลตรวจที่ Worker บันทึกหลังลบหาแถวมอนิเตอร์ไม่พบและถูกทิ้ง (`discarded`) เวลาบนข้อมูลขนาดจริงยังไม่ได้วัด (คำถามที่ยังเปิด)
- Project หายระหว่างใช้งาน: web ถือ `PROJECT_NOT_FOUND` จาก query หรือ mutation ใดเป็นสถานะ Project หาย (`projectGone`) ฟอร์มและประวัติการตรวจที่โหลดไว้แล้วไม่ใช้ต่อ

## API (`TS-002-T02`)

ฐาน `monitorBase = /api/organizations/{organizationId}/projects/{projectId}/monitors` ทุก route ทำตามขั้น `requireVerifiedSession`, `auditMonitorDenials`, `withProjectAccess` (`assertMemberBeforeTenantContext`, `withTenantContextRaw`, อ่าน role, `lockProject`) ก่อนแตะข้อมูล

| Method | Path ต่อจาก `monitorBase`                                                    | Action                 | Error เฉพาะ route                                                           |
| ------ | ---------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| GET    | `` (รายการ, query เดิม)                                                      | `monitor.read`         |                                                                             |
| GET    | `/recent-events`                                                             | `monitor.read`         |                                                                             |
| GET    | `/{monitorId}`, `/{monitorId}/checks`, `/incidents`, `/response-times`, `/events` | `monitor.read`         | 404 `MONITOR_NOT_FOUND`                                                     |
| GET    | `/{monitorId}/last-response`                                                 | `monitor.readResponse` | 403 `PERMISSION_DENIED`, 404 `MONITOR_NOT_FOUND`                            |
| POST   | `` (สร้าง)                                                                   | `monitor.write`        | 409 `MONITOR_LIMIT_REACHED`, 422 `MONITOR_TARGET_BLOCKED`, 503              |
| PATCH  | `/{monitorId}`                                                               | `monitor.write`        | 409 `MONITOR_VERSION_CONFLICT`, 422, 404 `MONITOR_NOT_FOUND`, 503           |
| POST   | `/{monitorId}/pause`, `/{monitorId}/resume`                                  | `monitor.write`        | 404 `MONITOR_NOT_FOUND`                                                     |
| DELETE | `/{monitorId}`                                                               | `monitor.write`        | 404 `MONITOR_NOT_FOUND`                                                     |
| POST   | `/test`, `/{monitorId}/test`                                                 | `monitor.write`        | 429 `MONITOR_TEST_RATE_LIMITED`, 503 `RATE_LIMIT_UNAVAILABLE`               |

ทุก route ตอบ 401, 403 (`EMAIL_NOT_VERIFIED`, `MEMBERSHIP_DENIED`, `PERMISSION_DENIED`) และ 404 `PROJECT_NOT_FOUND` route `/api/organizations/{organizationId}/monitors...` เดิมถูกลบและตอบเหมือน route ที่ไม่มีอยู่ (`AC-01`)

- รายการ (`AC-04`): `summary { up, down, unknown, paused, total, limit: 20 }` ของ Project ใน URL แต่ละแถวมี `responseP95Ms24h` เป็น nearest-rank p95 ของจุด response-times 24 ชม. ของมอนิเตอร์เดียวกัน (`null` เมื่อไม่มีข้อมูล) การเรียง `response_time` ใช้ p95 · 24 ชม. ก่อนแบ่งหน้า
- `recent-events` ของ Project ไม่มีมอนิเตอร์ของ Project อื่น
- Rate limit ของ test (REQ-04): key `{ userId, organizationId }` ใช้ร่วมกันทุก Project ขององค์กร (follow-up)
- Logging (หลัก "Logging, audit and health"): `logSafeOrganizationPath` ใน `apps/api/src/app.ts` รู้จัก segment `projects/{id}` และบันทึก `/api/organizations/:organizationId/projects/:projectId/monitors/:monitorId/...` path ระดับองค์กรเดิมไม่ถูกมองเป็น route มอนิเตอร์อีก

## Worker และการแจ้งเตือน (`TS-002-T03`, `AC-05`)

- `MonitorCheckJob` ไม่เปลี่ยน `apps/worker/src/monitor/record-result.ts` อ่าน `project_id` จากแถวมอนิเตอร์และส่งใน `MonitorEvent.projectId`
- `insertMonitorNotificationIntent` ใน `packages/db/src/notification.ts` เขียน `subject_project_id` และ snapshot ผู้รับเป็น `member` ขององค์กรที่เป็น `owner`/`admin` รวมกับสมาชิกใน `project_members` ของ Project นั้น `on conflict (origin, recipient_user_id) do nothing` ทำให้คนที่เป็นทั้งสองอย่างได้หนึ่งรายการ ไม่มี actor ให้ยกเว้น
- `apps/worker/src/materialize.ts` ตรวจสมาชิกภาพซ้ำตอนส่งใต้ advisory lock `notification-membership:<tenantId>`: ผู้รับต้องยังเป็น `member` และเป็น `owner`/`admin` หรือสมาชิก Project ณ เวลานั้น ผู้ที่ถูกนำออกจาก Project ก่อน materialize ไม่ได้รับ
- การอ่าน inbox (`monitorProjectAccess` ใน `apps/api/src/notifications/service.ts`): รายการ `MONITOR_*` แสดงต่อเมื่อผู้อ่านเป็น `owner`/`admin` หรือยังเป็นสมาชิก Project ของรายการ ใช้กับ list, unread count, mark-one (ไม่ผ่านตอบ 404) และ mark-all ผู้ที่ถูกนำออกเสียรายการและได้คืนเมื่อถูกเพิ่มกลับ รายการของ Project ที่ถูกลบยังอยู่สำหรับ Owner/Admin จนหมดอายุ และหายสำหรับสมาชิก ลิงก์ของรายการนั้นพาไปสถานะไม่พบ Project
- Job materialize ของ dispatch ที่ `0026` ลบไปแล้วล้มด้วย `notification dispatch claim is unavailable` ไม่ต้องทำอะไร (runbook)

## Audit (`AC-09`)

- ฝั่งเขียน: `monitorTarget(monitorId, projectId)` ใน `apps/api/src/monitors/audit.ts` คืน `target: { type: "monitor", id, attributes: { projectId } }` ใช้ใน create, update (รวม `secret.set` และ `secret.replace`), pause, resume และ delete action id `organization.monitor.*` ไม่เปลี่ยน route test ไม่บันทึก audit event (เหมือนเดิม)
- ฝั่งอ่าน: `apps/api/src/audit/read-service.ts` join `projects` เพื่อคืน `target.project { projectId, displayName, deleted }` event ก่อน F-011 ไม่มี `project` หน้าบันทึกกิจกรรมจึงแสดงชื่อมอนิเตอร์โดยไม่มีลิงก์
- Worker exporter `apps/worker/src/audit/events.ts` แสดง Project ในไฟล์ export

## Web (`TS-002-T04`)

Routes ใน `apps/web/src/router.tsx` ใต้ `/organizations/:organizationId/projects/:projectId/monitors`: รายการ (`monitorsOverviewLoader`), `/new`, `/:monitorId/edit`, `/:monitorId`, `/:monitorId/checks` route ระดับองค์กรเดิมลบแล้ว

- Query keys (WEB-03) ใน `apps/web/src/lib/api/monitors.ts`: `monitorQueryKeys.project(orgId, projectId) = ["tenant", "monitors", orgId, projectId]` และ `list`, `recentEvents`, `detail` ต่อท้าย `all(orgId)` ครอบทุก Project ใช้ตอน invalidate ทั้งองค์กร
- Loaders (WEB-04) ใน `apps/web/src/lib/auth/loaders.ts`: `monitorsOverviewLoader`, `monitorDetailLoader`, `monitorCreateLoader`, `monitorEditLoader` รับ `projectId` และ prefetch ด้วย key ของ Project `workspaceLoader` prefetch key ของ Project และรายการมอนิเตอร์ และไม่ขอมอนิเตอร์เมื่อไม่มี Project
- สิทธิ์ (`useMonitorAccess`): อ่าน `projectQueryKeys.detail` เพื่อได้ `myRole` `roleTag` เป็น `โปรเจกต์ · ผู้ดูแล` หรือ `โปรเจกต์ · สมาชิก` และ `องค์กร · <role>` สำหรับ Owner/Admin ที่ไม่ได้อยู่ใน Project `projectGone` เมื่อ `PROJECT_NOT_FOUND` `failed` (Project lookup ล้มที่ไม่ใช่ 404 สำหรับผู้ที่สิทธิ์เขียนขึ้นกับมัน) แสดงสถานะ error พร้อม `retry` ไม่แสดงเป็น read-only หรือไม่มีสิทธิ์ (CMP-01) Owner/Admin ไม่รอ Project lookup
- Nav (`nav-config.ts`): leaf `ตรวจสถานะบริการ` ในกลุ่ม `โปรเจกต์` (scope `project`) `count: "monitors"` คือ `summary.total` ของ Project ปัจจุบัน การสลับ Project จากหน้ารายละเอียด แก้ไข หรือประวัติการตรวจพาไปหน้ารายการของ Project ใหม่ (`projectSwitchDestination`)
- ลิงก์ใน inbox ใช้ `subject.projectId` ลิงก์ในหน้าบันทึกกิจกรรมใช้ `target.project.projectId`

หน้ารายการ `apps/web/src/pages/monitors/OverviewPage.tsx` ตาม artboard (`AC-04`):

- `PageHeader`: eyebrow `// MONITORS`, scope row ชื่อ Project พร้อม tag `roleTag`, title `ตรวจสถานะบริการ`, status line สรุปจำนวนจาก `summary`
- ปุ่ม `เพิ่มมอนิเตอร์` เฉพาะ `canWrite` เมื่อ `summary.total >= summary.limit` ปุ่มปิดพร้อมข้อความ `โปรเจกต์นี้มีมอนิเตอร์ครบ 20 ตัวแล้ว ลบมอนิเตอร์เดิมก่อนจึงจะเพิ่มได้` (`aria-describedby`) ผู้ที่เขียนไม่ได้เห็น `สิทธิ์ของคุณ: ดูอย่างเดียว`
- ปุ่มกรองตามสถานะ `aria-pressed` พร้อมจำนวนจาก `summary` ชื่อที่ screen reader อ่านรวมจำนวน การ์ดสรุป 4 ใบเดิมถูกเอาออกเพราะปุ่มกรองแสดงจำนวนแล้ว ข้อมูล SSL ยังอยู่ในมุมมองการ์ด
- ตาราง 5 คอลัมน์: มอนิเตอร์ (ชื่อและ URL แบบ monospace), สถานะ, เวลาตอบสนอง · p95 · 24 ชม., ความพร้อมใช้งาน · 24 ชม., ตรวจล่าสุด ค่าที่ไม่รู้แสดงเป็นข้อความ (CMP-01)
- ท้ายตาราง `แสดง <a>–<b> จาก <n> · เฉพาะมอนิเตอร์ของ <Project>`
- ป้ายสถานะ `up` เป็น `ใช้งานได้` ทั้งแอปตาม artboard (เดิม `ปกติ`)

สถานะของหน้า (CMP-01):

| สถานะ                       | เงื่อนไข                                                                  | แสดง                                                                    |
| --------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| loading, error              | query ยังไม่เสร็จหรือล้มเหลว รวม Project lookup ล้ม (`failed`)            | `PageState` พร้อมปุ่มลองใหม่                                             |
| Project หายหรือเข้าไม่ได้ | `PROJECT_NOT_FOUND` หรือ `MONITOR_NOT_FOUND` ของรายการ | `PageState kind="denied" tone="info"` ข้อความ Project หาย พร้อมลิงก์ `ไปที่รายการโปรเจกต์` แบบเดียวกันทั้งสองกรณี (ไม่บอกว่า Project มีอยู่) |
| ไม่ใช่สมาชิกองค์กร | `403 MEMBERSHIP_DENIED` | `PageState kind="denied"` `คุณไม่มีสิทธิ์ดูมอนิเตอร์ของโปรเจกต์นี้` โดยไม่มี scope row ชื่อหรือจำนวนของ Project |
| ยังไม่มีมอนิเตอร์           | `summary.total === 0`                                                     | `EmptyState variant="first-run"` พร้อมลิงก์เพิ่มสำหรับ `canWrite`      |
| ไม่พบผลลัพธ์                | รายการไม่ว่าง แต่ตัวกรองสถานะหรือคำค้นไม่ตรง                              | `EmptyState` พร้อมล้างตัวกรอง                                           |

หน้ารายละเอียดและฟอร์ม: ปุ่มเขียนและ `LastResponseCard` แสดงตาม `canWrite` สมาชิก Project ไม่ขอ `last-response` mutation ที่ได้ `PROJECT_NOT_FOUND` พาไปสถานะ Project หาย ฟอร์มที่ได้ `403` หลังถูกลด role คงค่าที่กรอกไว้ (CMP-02)

## Rollout (`docs/runbooks/uptime-monitor.md`)

- ผู้ใช้ยืนยันเมื่อ 2026-10-14 ว่าไม่มี environment ที่มีข้อมูลมอนิเตอร์จริง (`R-01` ของ `E-003` ปิด) การล้างด้วย `0026` กู้คืนจาก migration ไม่ได้ ถ้ามี environment ที่มีข้อมูลเกิดขึ้นก่อน deploy ต้องยืนยันใหม่
- Deploy API, Worker และ `0026` พร้อมกัน หรือหยุด API และ Worker รุ่นเก่าก่อน migrate เพราะรุ่นเก่า insert `monitors` (ไม่มี `project_id`) และ intent `MONITOR_*` (ไม่มี `subject_project_id`) ไม่ได้
- `bun run db:partitions` หลัง migrate ตามเดิม

## Tasks (`TS-002` สถานะหลัง #107)

| Task         | งาน                                                                                   | ไฟล์หลัก                                                                                                                                                     | สถานะ                                      | หลักฐาน                                                                                 |
| ------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `TS-002-T01` | Migration `0026`, Drizzle schema                                                      | `packages/db/migrations/0026_project_monitors.sql`, `packages/db/src/schema.ts`, `packages/db/tests/monitor.db.test.ts`                                       | Implemented                                | `cd packages/db && bun run test:integration`                                            |
| `TS-002-T02` | API ใต้ Project, สิทธิ์ใน `access.ts`, เพดาน 20, p95, log path                         | `apps/api/src/monitors/`, `apps/api/src/projects/access.ts`, `apps/api/src/app.ts`                                                                           | Implemented                                | `cd apps/api && bunx vitest run --project integration src/monitors/`                    |
| `TS-002-T03` | ผู้รับการแจ้งเตือนระดับ Project (intent, materialize, inbox) และ audit ฝั่งอ่าน/export | `packages/db/src/notification.ts`, `apps/worker/src/materialize.ts`, `apps/worker/src/monitor/notifications.ts`, `apps/api/src/notifications/service.ts`, `apps/api/src/audit/read-service.ts`, `apps/worker/src/audit/events.ts` | Implemented                                | worker และ api db tests ใน Verification mapping                                        |
| `TS-002-T04` | Codegen, client, หน้ามอนิเตอร์, nav, ลิงก์ inbox และบันทึกกิจกรรม, docs                | `apps/web/src/pages/monitors/`, `apps/web/src/lib/api/monitors.ts`, `apps/web/src/lib/auth/loaders.ts`, `apps/web/src/components/shell/`, `apps/web/src/router.tsx` | Implemented                                | `bun run codegen:check`, `bun run --cwd apps/web test`                                  |
| `TS-002-T05` | หน้าภาพรวมของ Project และลบ `WorkspacePage`                                            | `apps/web/src/pages/projects/overview/`                                                                                                                      | Deferred ไป `F-012`                        |                                                                                         |
| `TS-002-T06` | E2E มอนิเตอร์ใต้ Project และการแยก Project                                             | `e2e/tests/monitors*.spec.ts`, `e2e/tests/notifications.spec.ts`, `e2e/tests/project-switcher.spec.ts`                                                        | Implemented ส่วน F-011; `e2e/verification/*.ts` not run | `bun run --cwd e2e test`                                                                |

## Verification mapping

ผล `observed pass` อ้างจาก PR #107 (head `65d7cda`, PR CI ผ่าน 11 jobs, e2e local ผ่าน) spec นี้ตรวจว่า test case ตามชื่อด้านล่างมีอยู่ในโค้ด (source-complete) และไม่ได้รันซ้ำ ไฟล์ `*.db.test.ts` รันกับ runtime role `nightwatch` (NOBYPASSRLS)

| AC      | Test                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-01` | `packages/db/tests/monitor.db.test.ts` "rejects a monitor whose Project belongs to another Organization"; `apps/api/src/monitors/project-scope.db.test.ts` "the Organization-level monitor routes are gone (AC-01)"; `apps/api/src/monitors/path-logging.test.ts`; e2e `monitors.spec.ts`                                                                                                                           |
| `AC-02` | `project-scope.db.test.ts` "a user without access to the Project (AC-02)" ทั้ง 15 operation ได้ `404 PROJECT_NOT_FOUND` body เดียวกับ Project ที่ไม่มีอยู่, route test ไม่ทำ DNS; "a monitor of another Project (cross-Project IDOR)"; e2e `monitors-access.spec.ts` "an Organization viewer outside the Project gets the not-found state and no monitor data"                                                   |
| `AC-03` | `project-scope.db.test.ts` "permissions follow the Project role (AC-03)" 3 กรณี (สมาชิก Project, ผู้ดูแล Project ที่เป็น viewer องค์กร, Owner/Admin นอก Project); `secrets.db.test.ts` ผู้ดูแลถูกนำออกระหว่าง pre-check กับการอ่าน secret; web `OverviewPage.test.tsx` "keeps a Project member who is only an Organization viewer read-only", `DetailPage.test.tsx`; e2e `monitors-access.spec.ts` "monitor permissions by role and screen" |
| `AC-04` | `project-scope.db.test.ts` "list p95 over 24 h (AC-04)"; `read-list.db.test.ts` เรียง `response_time` ด้วย p95; web `OverviewPage.test.tsx` "Project monitor list" (หัวข้อและบทบาท, บรรทัดสรุป, คอลัมน์, ท้ายตาราง, สถานะว่าง, เพดาน 20); e2e `monitors-list-sort-view.spec.ts`, `monitors-states.spec.ts`                                                                                                   |
| `AC-05` | `apps/worker/src/monitor/notifications.db.test.ts` "reaches every Project member and Owner/Admin once each, and nobody outside the Project (AC-05)", "a Project member removed before materialize gets nothing"; `apps/api/src/notifications/monitor-items.db.test.ts` "monitor items follow Project access"; e2e `monitors.spec.ts` "a target that goes down and comes back reaches the inbox once each"               |
| `AC-06` | `apps/api/src/monitors/write-lifecycle.db.test.ts` "accepts the 20th monitor of a Project, rejects the 21st and replays the 20th without an audit (AC-06)", "lets exactly one of two concurrent creates take the 20th slot (AC-06)", "keys a replay by Project"; web `OverviewPage.test.tsx` ปุ่มปิดพร้อมข้อความเพดาน                                                                                            |
| `AC-07` | `project-scope.db.test.ts` "deleting a Project removes its monitors and their data (AC-07)"; `monitor.db.test.ts` "cascades secrets, schedule and child data"; worker `notifications.db.test.ts` "a result that arrives after its Project was deleted is discarded and notifies nobody (AC-07)"                                                                                                               |
| `AC-08` | `monitor.db.test.ts` "0026 wipes monitor data and scopes monitors to a Project" (สร้างฐานข้อมูลที่ 0025, seed มอนิเตอร์, notification มอนิเตอร์, notification อื่นและ audit event แล้ว apply 0026) ผ่านบนฐานข้อมูล local ไม่มี environment ที่มีข้อมูลจริงให้ตรวจ (ผู้ใช้ยืนยัน 2026-10-14)                                                                                                                                              |
| `AC-09` | `project-scope.db.test.ts` "audit events record the Project (AC-09)"; `apps/api/src/audit/read.db.test.ts` "monitor targets name their Project (AC-09)" (Project ปกติ, Project ที่ถูกลบ, event เก่าไม่มี Project); `apps/worker/src/audit/events.test.ts`                                                                                                                                                 |

Test เพิ่มที่ไม่ผูกกับ AC แต่บังคับตาม `docs/architecture.md` และ `docs/design-system.md`:

- RLS (DB-04): test เดิมของ `0016` ยังผ่านที่ path ใหม่ (`read-membership.db.test.ts`, `monitor.db.test.ts`) ไม่มี policy ใหม่
- Project หายหลังโหลดหน้า (CMP-01): web test ของฟอร์ม, ประวัติการตรวจ, รายละเอียด, รายการ และ `/workspace` ใน `OverviewPage.test.tsx` "A Project that is gone after the list loaded", `WorkspacePage.test.tsx`, `MonitorForm*.test.tsx`
- Project lookup ล้มไม่ถูกแสดงเป็นไม่มีสิทธิ์: `OverviewPage.test.tsx` "A failed Project lookup", `loaders.test.tsx`
- Log redaction: `path-logging.test.ts` path ของ route มอนิเตอร์ใต้ Project ถูกบันทึกเป็น template ตรงตัว

## ข้อแก้ไขที่ต้องนำกลับไปอัปเดต TS-002

| จุดใน #101                                                   | ข้อแก้ไข                                                                                                                                          | เหตุผล                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Data: migration `0024_monitors_under_projects.sql`           | `0026_project_monitors.sql`                                                                                                                       | `0024` และ `0025` เป็นของ `TS-001`                                                                                  |
| Data: audit event เพิ่ม `projectId` ใน metadata              | `target.attributes.projectId` ฝั่งเขียน และ `target.project { projectId, displayName, deleted }` ฝั่งอ่าน                                         | `record.ts` เก็บ attributes ของ target ฝั่งอ่านต้อง join `projects` เพื่อแสดงชื่อและสถานะลบ                          |
| Data: ล้างเฉพาะตารางมอนิเตอร์และ notification ที่อ้างมอนิเตอร์ | เพิ่ม `subject_project_id` พร้อม check constraint บน `notification_intents` และ `notification_inbox_items` และยก FORCE RLS ชั่วคราวใน migration | notification ต้องรู้ Project เพื่อลิงก์ไป route ใหม่และกรองผู้อ่าน FORCE RLS ซ่อนทุกแถวจาก migration role           |
| Data: ไม่ได้กล่าวถึง                                          | `monitors_client_request_key` เป็น `(tenant_id, project_id, client_request_id)`                                                                   | replay ต้องไม่คืนมอนิเตอร์ของ Project อื่น                                                                           |
| API: สร้างมอนิเตอร์ lock แถว Project ก่อนนับ                 | `projects ... for share` แล้ว advisory lock `monitors:<projectId>`                                                                                | write ของ Project เดียวกันไม่ต่อคิวกัน การลบ Project (`for update`) ยังรอ write ที่ค้างอยู่                           |
| API: log เก็บ id เป็น `:id`                                   | `:projectId` และ `:monitorId`                                                                                                                     | ตรงกับ template เดิมของ route มอนิเตอร์และ Project                                                                   |
| Worker: ผู้รับใน `packages/db/src/notification.ts`            | เพิ่มการตรวจซ้ำตอน materialize และการกรองตอนอ่าน inbox (list, unread, mark-one, mark-all)                                                        | snapshot ตอนสร้าง intent ไม่พอเมื่อสมาชิกถูกนำออกก่อนส่งหรือก่อนอ่าน (Codex P1 ใน #107)                               |
| Web: ลบ `WorkspacePage` และ `/workspace` redirect             | คงไว้ `/workspace` แสดงมอนิเตอร์ของ Project ปัจจุบันและ prefetch การ redirect ไป Project ล่าสุดทำใน #108 การลบหน้าเป็นของ `F-012`                | `TS-002-T05` ยังไม่เริ่ม                                                                                            |
| Web: endpoint สรุปสำหรับ sidebar                              | ยืนยันใช้ `summary.total` ของ list endpoint ไม่เพิ่ม endpoint                                                                                     | ตามที่ `TS-002` เสนอ                                                                                                 |
| ไม่ได้กล่าวถึง                                               | `monitor.readResponse` ให้ผู้ดูแล Project และ Owner/Admin ฝั่งเว็บ `canReadResponse = canWrite`                                                   | `AC-03` ผู้ใช้ยืนยัน 2026-10-14                                                                                           |
| ไม่ได้กล่าวถึง                                               | `responseP95Ms24h` ใน list item และการเรียง `response_time` ด้วย p95 ก่อนแบ่งหน้า                                                                | `AC-04` ต้องการ p95 · 24 ชม. และ Codex P2 ใน #107                                                                   |
| ไม่ได้กล่าวถึง                                               | ป้ายสถานะ `up` เป็น `ใช้งานได้`                                                                                                                   | artboard                                                                                                            |

## คำถามที่ยังเปิดและ follow-up

ไม่มีข้อใด block งานที่ merge แล้ว ทุกข้อยังไม่มีเจ้าของ:

1. เวลาลบ Project ที่มีมอนิเตอร์ 20 ตัวพร้อมผลตรวจ 30 วันในธุรกรรมเดียว ยังไม่ได้วัด
2. ชื่อผู้กระทำใน event feed ของมอนิเตอร์ยังใช้สิทธิ์ Owner/Admin องค์กร ผู้ดูแล Project ที่เป็น viewer องค์กรเห็น `member_hidden`
3. rate limit ของการทดสอบใช้ key ต่อผู้ใช้และองค์กร จึงใช้ร่วมกันทุก Project
4. script `e2e/verification/*.ts` 5 ตัวแก้ให้ใช้ Project แล้วแต่ยังไม่ได้รัน
5. notification ของ Project ที่ถูกลบยังอยู่ใน inbox ของ Owner/Admin จนหมดอายุ และลิงก์พาไปสถานะไม่พบ Project
