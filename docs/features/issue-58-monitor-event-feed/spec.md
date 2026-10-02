# Issue #58 Technical Spec: ฟีดเหตุการณ์ต่อ monitor และการตอบกลับล่าสุด

Owner: Technical Lead spec นี้ได้รับอนุมัติแล้ว จึงเป็น source of truth ของ implementation และ review

| Field                | Value |
| -------------------- | ----- |
| Issue                | [#58](https://github.com/nixbpe/new-nightwatch/issues/58) ต่อยอด F-005 (`docs/features/F-005-uptime-monitor/`) |
| Feature              | `docs/features/issue-58-monitor-event-feed/feature.md` (Product Owner, AC `P58-01` ถึง `P58-10`, `acceptanceVersion` `issue-58-AC-1`) |
| Epic                 | None |
| Status               | Approved |
| Scope approved by user | 2026-10-02 |
| Approved by user     | 2026-10-02 (ยืนยันทุก OD ตามข้อเสนอของ Technical Lead: "ยืนยัน OD ตามค่าแนะนำได้หมดเลย และให้เริ่ม implement ได้เลย") |
| Start authorization  | 2026-10-02, issue #58 (ข้อความเดียวกัน) |
| `COMMIT_MODE`        | owned-slice (ผู้ใช้อนุญาต 2026-10-02) commit ได้เฉพาะไฟล์ที่ Task เป็นเจ้าของ ไม่ครอบ push, PR, deploy หรือ force-push |
| `STOP_AT`            | review-ready |

ป้ายในวงเล็บ: [ตรวจแล้ว] คือสิ่งที่อ่านใน code หรือเอกสาร ณ 2026-10-02 [สมมติฐาน] คือสิ่งที่ยังไม่ได้พิสูจน์ เนื้อหา issue [ตรวจแล้ว]: reviewer ยืนยันด้วย `gh issue view 58` ว่าตรงกับสรุปที่ใช้เขียน spec นี้ (Technical Lead ไม่ได้เปิด `gh` เอง)

## ข้อขัดกับ contract เดิมที่ผู้ใช้ตัดสินแล้ว

ผู้ใช้ตัดสินทุกข้อ 2026-10-02 ตาม Decisions ท้ายไฟล์ spec นี้ไม่แก้ไฟล์ของ F-004, F-005 หรือ `docs/product-direction.md`

| ข้อขัด [ตรวจแล้ว] | การตัดสิน |
| --- | --- |
| F-005 AC-42 (`F-005-AC-1`, `docs/features/F-005-uptime-monitor/feature.md:516`) ห้ามเก็บ response header, response body เต็ม และค่า query กับ body ของคำขอ | OD-58-01 (b): Feature ใหม่ของ #58 (`issue-58-AC-1`) supersede AC-42 ของ F-005 เฉพาะ last response ประวัติผลตรวจ, incident, notification, ผลทดสอบ และ log คง AC-42 เดิม งานนี้ไม่แก้ F-005 (Q-02) OD-58-11 (d): ไม่เก็บรายละเอียด response ของคำขอที่มี query หรือ body จึงไม่มีค่า query หรือ request body ที่ถูกสะท้อนลงตาราง |
| F-005 AC-61 และ Design decisions → Audit ("ไม่มีตาราง audit") | OD-58-02 (a): ฟีดเก็บใน `monitor_events` ของ monitor ลบตาม monitor และ purge ที่ 30 วัน AC-61 คงเดิม audit log ระดับองค์กรเป็น Feature แยก |
| DIR-001 S3 (`docs/product-direction.md:34`) ไม่อนุญาต sensitive evidence | Q-01 (derived): ถือว่าครอบโดย OD-58-01 ที่ผู้ใช้อนุมัติ (body ที่ redact และตัดตามขีดใน spec นี้) ข้อความของ Direction ไม่ถูกแก้ในงานนี้ |
| F-004 AC-02 (`F-004-AC-2` frozen, `docs/features/F-004-organization-member-management/feature.md:56,91`) ห้าม `viewer` และ `auditor` เห็นข้อมูลสมาชิก | OD-58-08 (b): ชื่อผู้แก้แสดงเฉพาะ `owner` และ `admin` role อื่นได้ `member_hidden` F-004 ไม่ bump |

## สภาพ code ที่ spec นี้ต่อยอด [ตรวจแล้ว]

| เรื่อง | สภาพปัจจุบัน | ผลต่อ #58 |
| --- | --- | --- |
| Recent events ระดับองค์กร | `listRecentEvents` ใน `apps/api/src/monitors/read-service.ts:510-611` คืนสองแถวต่อ incident ที่ปิดแล้ว (`incident_opened` และ `incident_closed`, `UNION ALL` ที่ 520-544) ไม่ select `start_http_status` contract `monitorRecentEventSchema` (`packages/api-contract/src/monitor.ts:1028-1037`) ไม่มี HTTP status | เพิ่ม field แบบ optional จำนวนแถวคงเดิม |
| Test ที่ผูกกับสองแถวต่อ incident | `apps/api/src/monitors/read-list.db.test.ts:352,391-396,420-454` และ `apps/web/src/pages/monitors/OverviewPage.test.tsx:851-867` | คงรูปแบบเดิม จึงไม่กระทบ |
| Incidents ต่อ monitor | `listIncidents` (`read-service.ts:827-877`) หนึ่งแถวต่อ incident test ที่ `apps/api/src/monitors/read-detail.db.test.ts:753,773-803` UI คือตารางใน `apps/web/src/pages/monitors/detail/IncidentsCard.tsx:32-77` | คงตาราง (OD-58-03 (a)) |
| `monitor_incidents` | `0016_uptime_monitors.sql:139-160` มี `start_http_status` ไม่มี HTTP status หรือ response time ตอนปิด CHECK เพียง `(ended_at is null) = (end_reason is null)` (151-152) การปิดด้วย `recovered` อยู่ที่ `apps/worker/src/monitor/record-result.ts:195-208` | เพิ่ม column ตอนปิด |
| `monitor_events` | `0016_uptime_monitors.sql:162-174` kind CHECK `paused`, `resumed`, `config_changed` (บรรทัด 166) มีเพียง `url_masked` ไม่มี actor หรือค่าเดิม/ค่าใหม่ grant `select, insert` purge 30 วันด้วย `occurred_at` (`0016:304-309`) และ cascade เมื่อลบ monitor | ขยาย kind และ column |
| การเขียน `config_changed` | `apps/api/src/monitors/service.ts:543-547` เก็บ URL แบบ mask เมื่อ URL เปลี่ยนเท่านั้น save ที่ไม่เปลี่ยนอะไรไม่เขียน event (470-471) Edit ที่กระทบการตรวจรีเซ็ต `consecutive_failures` เป็น 0 (487-488) แม้มี incident เปิด Pause ปิด incident ด้วย `now()` ของฐานข้อมูล (625) pause/resume เขียน event ที่ 631-639 | เพิ่ม actor และรายการค่าที่เปลี่ยน |
| Audit | ไม่มีตาราง audit `auditMonitorMutation` (`apps/api/src/monitors/audit.ts:21-45`) เขียน Pino info `{actorUserId, action, organizationId, monitorId?}` `MonitorDenialAction` เป็น union ปิด (15-16) | AC-61 คงเดิม |
| Permission | `MonitorPermission` มี `read` และ `write` (`permissions.ts:7-15`) ข้อความ `PERMISSION_DENIED` คือ "คุณไม่มีสิทธิ์จัดการมอนิเตอร์ขององค์กรนี้" (40) | เพิ่ม `readResponse` พร้อมข้อความของตัวเอง |
| HTTP client | `packages/shared/src/outbound-http/http1.ts:31-33` HTTP/1.1 เท่านั้น regex ที่บรรทัด 85 เก็บเฉพาะรหัส ทิ้ง version และ reason phrase head ถอดเป็น `latin1` (201) ไม่เกิน 64 KiB (3) ชื่อ header เป็นตัวเล็ก header ซ้ำรวมด้วย `, ` (98-102) request header เขียนเป็น string ของ JS ลง socket (257) ซึ่งเข้ารหัสเป็น UTF-8 `findInvalidHeader` ห้ามเพียง CR, LF, NUL ในค่า (`headers.ts:25`) | ต้องคืน version และ reason phrase และ redact ค่าลับที่ไม่ใช่ ASCII ให้ครบ |
| SSRF helper | `OutboundResponse` (`send.ts:53-62`) สร้างจาก field ที่ระบุทีละตัว (568-580) `redirect_limit` และ `redirect_blocked` throw `OutboundError` (`send.ts:491-492,499,521,583-584,589,593,596-597`) catch 612-629 คืน `{ ok: false, failure, tls? }` ไม่มี response 3xx ถูกทิ้งที่ 566-567 | ส่ง version และ reason phrase ผ่าน `OutboundResponse` เท่านั้น path ของ redirect คงเดิม (OD-58-10 (a)) |
| Executor และ redactor | `run-check.ts` ต่อ query ลง URL ด้วย `buildCheckUrl` (45) GET และ HEAD ไม่ส่ง body (94-96) อ่าน body ไม่เกิน 1 MiB (19) คืนเฉพาะ status และ elapsed (213-224) ไม่เก็บ body (125-126) URL แบบ mask ที่ 139 failed path ที่ 182-191 `createRedactor(secretValues, extra)` (`monitor-check/redact.ts:39-52`) เทียบ substring กับค่าดิบ, JSON-escaped และ URL-encoded แล้วแทนทุกจุด (60-121) run-check ส่งเฉพาะค่าลับ (135-137) | ขยายผลให้มี snapshot |
| Retention ของผลตรวจ | policy ของ retention owner ใช้ `scheduled_for` (`0016:292-297`) F-005 Revisions 843(2) เลือกเวลาฐานข้อมูลแทน `checked_at` ของ Worker purge รันทุกรอบ scheduler (`apps/worker/src/monitor/scheduler.ts:85-89`) | ใช้ `scheduled_for` กับตารางใหม่ |
| Web mockup (CMP-06) | `MonitorDetailMockups.tsx:104-141` (`EventFeedMockup`, `LastResponseMockup`) ใช้ที่ `IncidentsCard.tsx:28,171` และ `DetailPage.tsx:31,494` mockup ที่สามอยู่ใน `apps/web/src/pages/workspace/EventsSection.tsx:245-265` | ลบ mockup ทั้งสาม |
| Consumer ของ recent events | `EventsSection.tsx` `eventDot` (34-38) และ `EventText` (40-70) แสดง kind ที่ไม่ใช่ incident เป็น SSL `RecentEventsCard.tsx:53-61` แสดง kind ที่ไม่ใช่ `ssl_level` เป็น pill "ล่ม" | ไม่เพิ่ม kind ใน recent events |
| Migration ล่าสุด | `0018_invitation_management.sql` | #58 จอง `0019` [สมมติฐาน: branch ของ #56 หรือ #57 อาจจองเลขเดียวกัน ต้องตรวจตอน rebase] |

## Contracts

### API

ทุก route อยู่ใต้ `/api/organizations/{organizationId}/monitors` ประกาศด้วย `createRoute` ใน `apps/api/src/monitors/read-routes.ts` schema อยู่ใน `packages/api-contract/src/monitor.ts` (REQ-02) ลำดับสิทธิ์และ error envelope ตาม F-005 spec หัวข้อ API และ Authorization and security ทุก read route ตรวจ membership ซ้ำใน tenant transaction เดียวกับที่อ่านข้อมูล โดย lock `organization FOR SHARE` ก่อน (F-005 Revisions 848(1))

| Operation | Method, path | สิทธิ์ | Success |
| --- | --- | --- | --- |
| Monitor events (ใหม่) | `GET /monitors/{monitorId}/events?limit&offset` | `read` | `200 { events[], page }` |
| Last response (ใหม่) | `GET /monitors/{monitorId}/last-response` | `readResponse` = `owner`, `admin` (OD-58-04) | `200 { response: LastResponse \| null }` |
| Recent events (additive) | `GET /monitors/recent-events?limit` | `read` | `200 { events[] }` เพิ่ม `httpStatus` แบบ optional |

- **Monitor events** `events[]` เป็น discriminated union ตาม `kind` `limit` 1..50 default 20 เลือกแถวที่ `at` อยู่ใน 30 วันล่าสุด:
  - `check_failed { id, at, failureReason, tlsReason, httpStatus | null, responseTimeMs | null }` ความล้มเหลวครั้งแรกของ streak (ดู Jobs)
  - `incident_opened { id, at, incidentId, reason, httpStatus | null }`
  - `incident_closed { id, at, incidentId, endReason: 'recovered' | 'paused_by_user', durationSeconds, httpStatus | null, responseTimeMs | null }` ค่า HTTP มีเฉพาะ `recovered` ที่บันทึกหลัง migration `0019`
  - `paused { id, at, actor }`, `resumed { id, at, actor }`
  - `config_changed { id, at, actor, changes[] }` (ดู Data → `changes`)
  - `id` ของแถวเป็น string คงที่: `event:<monitor_events.id>`, `incident:<incidentId>:opened`, `incident:<incidentId>:closed`
  - **ลำดับ**: `at desc` แล้ว rank ของแหล่ง (`incident_closed` 0, `monitor_events` 1, `incident_opened` 2) แล้ว `id desc` ลำดับนี้คงที่ข้ามสองตารางและระหว่างหน้า offset schema ไม่บังคับ `ended_at > started_at` และเวลามาจากสองนาฬิกา: `started_at` จาก `result.checkedAt` ของ Worker (`record-result.ts:183`) ส่วน Pause ปิดด้วย `now()` ของฐานข้อมูล (`service.ts:625`) เมื่อเวลาเท่ากัน rank วาง `incident_closed` ก่อน `incident_opened` เมื่อเวลากลับด้านจากนาฬิกาที่ต่างกัน ฟีดเรียงตาม `at` ที่เก็บจริง และยอมรับว่าแถวสองแถวนั้นอาจสลับลำดับ
  - incident ที่ยังเปิดและเริ่มก่อน 30 วันไม่มีแถว `incident_opened` ในฟีด สถานะล่มยังแสดงใน `DownBanner`, `StatusCard` และ `IncidentsCard` เดิม
  - `actor` (OD-58-05 (a), OD-58-08 (b)): `{ kind: 'member', userId, displayName } | { kind: 'member_hidden' } | { kind: 'former_member' } | { kind: 'deleted' } | { kind: 'unrecorded' }`
    - `member`: ผู้แก้ยังเป็นสมาชิก และผู้อ่านเป็น `owner` หรือ `admin`
    - `member_hidden`: ผู้แก้ยังเป็นสมาชิก และผู้อ่านเป็น `viewer` หรือ `auditor` ไม่มี `userId` หรือชื่อ
    - `former_member`: บัญชียังอยู่แต่พ้น Organization แล้ว (ทุก role ของผู้อ่าน)
    - `deleted`: `actor_kind = 'user'` และ `actor_user_id` เป็น `null` (บัญชีถูกลบ)
    - `unrecorded`: event ก่อน `0019`
- **Last response** `LastResponse`: `{ checkedAt, scheduledFor, configVersion, outcome, failureReason, url, detailOmitted: 'request_values' | null, statusLine: { httpVersion: 'HTTP/1.0' | 'HTTP/1.1', status, reasonPhrase | null } | null, headers: { name, value, redacted: boolean }[], headersTruncated, body: { kind: 'text', text, truncated, totalBytesRead } | { kind: 'omitted', reason: 'no_body' | 'not_text' | 'undecodable' | 'request_values' } | null }`
  - `url` คือ `finalUrl` ที่ mask แล้วจาก SSRF helper (`send.ts:575`) เมื่อผลเป็น `ok: true` ไม่ตัด เมื่อไม่มี response ใช้ `result.url` ของ executor (URL ของ config ที่ mask แล้ว, `run-check.ts:139`)
  - `detailOmitted: 'request_values'` (OD-58-11 (d)) เมื่อ URL หลังต่อ query (`buildCheckUrl`, `run-check.ts:45`) มี query หรือคำขอส่ง body จริง (method ที่ไม่ใช่ GET หรือ HEAD และมี body, `run-check.ts:94-96`) แถวนั้นมีเฉพาะ `httpVersion` และ `status` ใน `statusLine`, `reasonPhrase: null`, `headers: []`, `headersTruncated: false`, `body: { kind: 'omitted', reason: 'request_values' }` เมื่อไม่มี response `statusLine` และ `body` เป็น `null`
  - `statusLine: null` คือไม่มี response ที่ประเมิน (DNS, TLS, timeout, ถูกบล็อก, `redirect_limit`, `redirect_blocked` ตาม OD-58-10 (a))
  - `response: null` คือยังไม่มีผลตรวจที่บันทึกหลัง `0019`
- **Recent events**: `httpStatus: z.number().int().optional()` แบบเดียวกับ `durationSeconds` (`monitor.ts:1034`) `incident_opened` ใส่ค่าจาก `start_http_status` `incident_closed` ใส่ค่าจาก `end_http_status` ค่า `null` ในฐานข้อมูลและแถว `ssl_level` ไม่มี field นี้ ไม่เพิ่ม kind ใหม่
- **สิทธิ์ของ last-response ทั้ง route**: route ทั้งตัวอยู่หลัง `readResponse` `viewer` และ `auditor` จึงไม่เห็น status line, URL, headers หรือ body ใน panel แต่ยังเห็น HTTP status, response time และสาเหตุจาก `lastResult` ของ Detail เดิม (`checkResultSchema`, `monitor.ts:853-865`)
- **Errors**: `404 MONITOR_NOT_FOUND` สำหรับ id ที่ไม่มี, รูปแบบผิด หรืออยู่ Organization อื่น (AC-48), `403 MEMBERSHIP_DENIED`, `403 PERMISSION_DENIED` เมื่อ role ไม่มี `readResponse` ด้วยข้อความ "คุณไม่มีสิทธิ์ดูการตอบกลับของมอนิเตอร์นี้" ตรวจก่อน lookup monitor การปฏิเสธเข้า `auditMonitorDenials` ด้วย action `organization.monitor.read-response`

### Data

Migration `0019_monitor_event_feed.sql` ตาม DB-11, DB-12 Drizzle schema แก้ใน `packages/db/src/schema.ts`

| Table | การเปลี่ยน | Grants |
| --- | --- | --- |
| `monitor_incidents` | เพิ่ม `end_http_status integer`, `end_response_time_ms integer` (nullable, incident เดิมเป็น `null`) | คงเดิม |
| `monitor_events` | ขยาย CHECK ของ `kind` เป็น `paused`, `resumed`, `config_changed`, `check_failed` (หาชื่อ constraint จาก `pg_constraint` แบบ `0017` และ `RAISE EXCEPTION` ถ้าไม่พบ) เพิ่ม `actor_kind text not null default 'unrecorded' check (actor_kind in ('unrecorded', 'user'))`, `actor_user_id text references "user"(id) on delete set null` (`user.id` เป็น `text`, `packages/db/src/schema.ts:36`), `changes jsonb`, `failure_reason text`, `tls_reason text`, `http_status integer`, `response_time_ms integer` CHECK: `actor_kind = 'user'` ได้เฉพาะ `paused`, `resumed`, `config_changed`, `actor_user_id is not null` ต้องมี `actor_kind = 'user'`, `changes` มีเฉพาะ `config_changed`, field ของ `check_failed` มีเฉพาะ `check_failed` | `nightwatch`: คงเดิม (`select, insert`) |
| `monitor_last_responses` (ใหม่) | `monitor_id` PK, `tenant_id`, FK `(monitor_id, tenant_id)` ไป `monitors` `on delete cascade`, `scheduled_for`, `checked_at`, `config_version`, `outcome`, `failure_reason`, `url_masked`, `detail_omitted`, `http_version`, `http_status`, `reason_phrase`, `headers jsonb`, `headers_truncated`, `body_kind`, `body_text`, `body_truncated`, `body_bytes_read`, `body_omitted_reason` CHECK: `detail_omitted = 'request_values'` บังคับ `reason_phrase is null`, `headers = '[]'`, `body_text is null` หนึ่งแถวต่อ monitor ถูกเขียนทับทุกผลตรวจ ไม่ partition (ไม่เกิน 50 แถวต่อ Organization) RLS ตาม DB-04: restrictive context guard, tenant access `USING` และ `WITH CHECK`, `FORCE ROW LEVEL SECURITY` | `nightwatch`: `select, insert, update` `nightwatch_monitor_retention_owner`: `select, delete` ผ่าน policy `scheduled_for < now() - interval '30 days'` แบบ `0016:292-297` |

- **Actor แยกสามกรณีที่ฐานข้อมูล**: `actor_kind = 'unrecorded'` คือ event ก่อน `0019` หรือ `check_failed` `actor_kind = 'user'` และมี `actor_user_id` คือผู้ใช้ที่ยังมีบัญชี `actor_kind = 'user'` และ `actor_user_id` เป็น `null` คือบัญชีถูกลบ (FK `on delete set null`)
- **Retention** (OD-58-01): `check_failed` และ `config_changed` อยู่ใน `monitor_events` จึงถูก purge ที่ 30 วันตาม `occurred_at` (`now()` ของฐานข้อมูลสำหรับการกระทำของผู้ใช้ และ `result.checkedAt` สำหรับ `check_failed` ดู Jobs) และ cascade เมื่อลบ monitor (AC-19, AC-41) `0019` แก้ `purge_expired_monitor_data` ให้ลบแถวของ `monitor_last_responses` ที่ `scheduled_for` เก่ากว่า 30 วัน (monitor ที่หยุดชั่วคราวไม่มีผลใหม่มาเขียนทับ) เวลาฐานข้อมูลตาม F-005 Revisions 843(2)
- **`changes[]`**: union ของ `{ field, kind: 'value', before, after }`, `{ field, kind: 'changed' }`, `{ field, kind: 'secret', action: 'set' | 'replaced' | 'deleted' }` ชนิดของ `before` และ `after` ต่อ field:

| `field` | `kind` | ชนิดของ `before`, `after` |
| --- | --- | --- |
| `name`, `method`, `expectedStatus`, `auth.type` | `value` | `string` |
| `auth.headerName` | `value` | `string \| null` |
| `url` | `value` | `string` (mask ด้วย `maskUrl` ตาม AC-42) |
| `intervalSeconds`, `timeoutSeconds` | `value` | `number` |
| `headers.<name>` (header ที่ไม่ลับทั้งก่อนและหลัง) | `value` | `string \| null` (`null` คือไม่มี header นั้น) ค่าเดียวกับที่ทุก role อ่านได้ใน config แล้ว (OD-17 ของ F-005) |
| `headers.<name>` ที่ป้ายลับเปลี่ยนไม่ว่าทางใด | `secret` | ไม่มีค่า กันค่าเดิมของ header ที่เพิ่งติดป้ายลับค้างในฟีด 30 วัน |
| `queryParams.<name>` | `value` | `'•••' \| null` (AC-42) |
| `body`, `assertions` | `changed` | ไม่มีค่า (body ใหญ่ได้ถึง 64 KiB) |
| slot ค่าลับ (`auth.token`, `auth.username`, `auth.password`, `auth.apiKey`, `header.<headerId>`) | `secret` | ไม่มีค่าหรือ ciphertext (AC-25, AC-56) |

  ค่า string ต่อ field ตัดที่ 200 ตัวอักษร
- **Actor lookup**: ชื่อแสดงอ่านตอน query จากตาราง `user` join กับ membership ปัจจุบันของ Organization นี้เท่านั้น (DB-06) และเฉพาะเมื่อผู้อ่านเป็น `owner` หรือ `admin` ผู้ที่ไม่มี membership แล้วได้ `former_member` โดยไม่อ่านชื่อ ไม่ snapshot ชื่อหรืออีเมลลงตาราง (หลัก Logging ใน `docs/architecture.md:102`)

### Jobs

ไม่มี queue หรือ job ใหม่ งานอยู่ใน transaction B ของ checker เดิม (`apps/worker/src/monitor/record-result.ts`) และทำเฉพาะเมื่อ insert ผลตรวจสำเร็จจริง (JOB-07)

- **`check_failed`**: insert เมื่อผล `fail` ทำให้ `consecutive_failures` เปลี่ยนจาก 0 เป็น 1 และไม่มี incident เปิดอยู่ การตรวจต่อๆ ไปใน streak เดียวกันไม่เพิ่มแถว Edit ที่กระทบการตรวจรีเซ็ต streak ระหว่าง incident เปิด (`service.ts:487-488`) เงื่อนไข incident กันไม่ให้ฟีดแสดง "ตรวจล้มเหลว" ขณะ monitor ล่มอยู่ ผล `check_error` ไม่สร้าง event (AC-39) streak ที่ถึง 2 ครั้งมีทั้ง `check_failed` และ `incident_opened` insert ตั้ง `occurred_at = result.checkedAt` (นาฬิกา Worker) เหมือน `started_at` ของ incident (`record-result.ts:183`) ผลที่ยอมรับ: แถวจากการกระทำของผู้ใช้ใช้ `now()` ของฐานข้อมูล ลำดับระหว่างสองกลุ่มอาจคลาดได้เท่าความต่างของนาฬิกา และ purge ของ `check_failed` เลื่อนตามความต่างนั้น
- **Recovered**: update ที่ปิด incident ด้วย `recovered` (`record-result.ts:196-200`) ตั้ง `end_http_status` และ `end_response_time_ms` จากผลที่ผ่านในคำสั่งเดียวกัน Pause ที่ปิดด้วย `paused_by_user` เป็น `null`
- **Last response**: upsert `monitor_last_responses ... on conflict (monitor_id) do update ... where monitor_last_responses.scheduled_for < excluded.scheduled_for` ผลที่มาช้ากว่าไม่เขียนทับผลใหม่ ผลที่ถูกทิ้งตาม AC-38 ไม่ถึงขั้นนี้
- **Executor** (`packages/shared/src/monitor-check/`): คืน `responseSnapshot` ที่ redact และตัดแล้ว หรือ snapshot แบบ `detailOmitted: 'request_values'` ตามตัวกระตุ้นใน API ค่าดิบของ header และ body อยู่เฉพาะใน executor ไม่เข้า job payload, log หรือ error (JOB-05, OPS-01) `http1.ts` คืน version (`HTTP/1.0` หรือ `HTTP/1.1`) และ reason phrase `send.ts` ส่งสอง field นี้ต่อใน `OutboundResponse` การ parse status, classification และ path ของ redirect คงเดิม
- **Test (`POST /monitors/test`)** ไม่คืนและไม่เก็บ snapshot (Non-goals)

### Web

- **Detail** (`apps/web/src/pages/monitors/DetailPage.tsx`):
  - `MonitorEventsCard` ใหม่เพิ่มเป็น section ของตัวเองที่มี `h2` และคง `IncidentsCard` เดิม (OD-58-03 (a)) รายการเป็น `<ol>` เวลาเป็น `<time dateTime>` ระบุ timezone ข้อความต่อ kind อยู่ใน `detail/labels.ts` ("ตรวจล้มเหลว", "เริ่มล่ม", "กลับมาปกติ · HTTP 200 · 182 ms", "หยุดชั่วคราว", "เริ่มตรวจต่อ", "แก้ไขการตั้งค่า … โดย {ชื่อ}") ค่าเดิมและค่าใหม่แสดงเป็นข้อความ "ก่อน" และ "หลัง" ไม่พึ่งลูกศรหรือสี (CMP-01) actor: `member_hidden` "สมาชิก", `former_member` "อดีตสมาชิก", `deleted` "ผู้ใช้ที่ถูกลบ", `unrecorded` ไม่แสดงผู้แก้ pagination ใช้ `DataTablePagination` เดิม `EventFeedMockup` ถูกลบ
  - `LastResponseCard` ใหม่แทน `LastResponseMockup` ใน aside เป็น section ที่มี `h2`: status line, URL, ตาราง header (`<table>` ที่มี caption), body ใน `<pre>` ที่ wrap ใน container ของตัวเอง (LAY-02) Latin token ใช้ monospace (TYP-04) แสดง "ตรวจเมื่อ" และป้าย "ตัดแล้ว", "ค่าถูกซ่อน", "ไม่มี response", "เนื้อหาไม่ใช่ข้อความ" และ "เนื้อหานี้มาจากเป้าหมายโดยตรง" เมื่อ `detailOmitted = 'request_values'` แสดงเฉพาะ version และรหัสสถานะ พร้อมป้าย "ไม่เก็บ headers และเนื้อหา เพราะคำขอมี query หรือ body ซึ่งเป้าหมายอาจสะท้อนกลับ" `viewer` และ `auditor` เห็น "เฉพาะเจ้าของและผู้ดูแลเห็น headers และเนื้อหา" โดย web ไม่ยิง request
  - state ของทั้งสอง card: loading, empty, error พร้อม "ลองอีกครั้ง", refetch ล้มหลังมีข้อมูล ตามแบบ `IncidentsCard` (CMP-01)
- **Recent events**: `RecentEventsCard.tsx` และ `workspace/EventsSection.tsx` แสดง `HTTP {status}` เมื่อมีค่า ลบ mockup ของ #58 ใน `EventsSection.tsx:245-265` (mockup ของ #63 คงอยู่)
- **Query keys** ใต้ `TENANT_QUERY_PREFIX` (WEB-03) ใน `apps/web/src/lib/api/monitors.ts`: `['tenant','monitors',orgId,'events',monitorId,{limit,offset}]`, `['tenant','monitors',orgId,'last-response',monitorId]` refetch ตาม `MONITOR_REFETCH_INTERVAL_MS` เดิม mutation ของ monitor invalidate prefix `['tenant','monitors',orgId]` เดิมซึ่งครอบ key ใหม่
- generated types: `bun run --cwd apps/web codegen` ไม่แก้ `openapi-types.gen.ts` ด้วยมือ (WEB-01) response validate ด้วย contract schema (WEB-02)

### Authorization and security

- **ข้อความจากเป้าหมายที่เก็บผ่าน redactor** (reason phrase, ชื่อ header, ค่า header, body) ก่อนตัด (AC-43) เฉพาะ snapshot ที่ไม่ตรงตัวกระตุ้นของ OD-58-11 (d):
  - needle ของ redactor คือค่าลับของ monitor ทุกความยาวแบบเดิม ค่า query และ request body ไม่เป็น needle เพราะ snapshot ของคำขอที่มีค่าเหล่านั้นไม่เก็บข้อความจากเป้าหมาย (OD-58-11 (d)) redactor เทียบ substring และแทนทุกจุด (`redact.ts:44-52,60-121`) ค่าที่ไม่ลับซึ่งสั้นจึงปิดข้อความทั่วไปถ้าใช้เป็น needle เช่น `format=json` ทำให้ `content-type` เหลือ `application/•••`
  - ค่าลับที่ไม่ใช่ ASCII: request header ส่งเป็น UTF-8 (`http1.ts:257`) แต่ head ถอดเป็น `latin1` (`http1.ts:201`) executor เพิ่ม needle รูป `Buffer.from(value, 'utf8').toString('latin1')` ของทุกค่าลับ และ body ที่ถอดด้วย `iso-8859-1` ใช้ needle รูปเดียวกัน
  - header ที่ค่าถูกแทนด้วย `•••` เสมอ: `set-cookie`, `cookie`, `authorization`, `proxy-authorization`, `www-authenticate`, `proxy-authenticate`, ชื่อ header ลับของ monitor, ชื่อ API key header ของ auth
  - executor เลือก `body_kind` และ charset จาก `content-type` ดิบก่อน redact
  - เพดาน (OD-58-01): ไม่เกิน 50 header, ชื่อ header ไม่เกิน 256 ตัวอักษร, ค่าละไม่เกิน 1 KiB, reason phrase ไม่เกิน 128 ตัวอักษร (head ยาวได้ถึง 64 KiB, `http1.ts:3`), body ไม่เกิน 16 KiB หลัง decode เฉพาะ `text/*`, `application/json`, `application/*+json`, `application/xml`, `application/*+xml` ตามกฎ charset เดิม (AC-33) ชนิดอื่นเก็บ `omitted: not_text`
  - URL ที่แสดงใช้ `maskUrl` (AC-42)
- **PII ใน body**: redaction กันได้เฉพาะค่าที่ NightWatch รู้ค่า personal data ที่เป้าหมายตอบกลับมายังผ่านได้ ผู้อ่านจึงจำกัดเป็น `owner` และ `admin` (OD-58-04) และ panel บอกว่าเนื้อหามาจากเป้าหมาย
- **Log**: checker log คงเฉพาะ field เดิม (`tenantId`, `monitorId`, `outcome`, `failureReason`, ระยะเวลา) ไม่ log header, body หรือ `changes`
- **Audit**: AC-61 คงเดิม ฟีดเป็นข้อมูลแสดงผลของ monitor ที่ลบตาม monitor และ purge ที่ 30 วัน (OD-58-02 (a))
- **RLS**: ตารางใหม่และ column ใหม่อยู่ใต้ policy ของ Organization (DB-04) query ของ actor ผูก membership ของ Organization ที่ตรวจแล้ว ไม่เปิดเผยผู้ใช้นอก Organization

### Concurrency

- ลำดับ lock เดิมของ F-005 คงไว้ เพิ่ม `monitor_last_responses` ต่อท้ายหลัง `monitor_incidents` ใน transaction B
- Edit พร้อมกัน: `config_changed` เขียนในทรานแซกชันเดียวกับ compare-and-swap ของ `version` ฝั่งที่ได้ `409` ไม่เขียน event
- ผลตรวจสองผลของ monitor เดียวกันพร้อมกันไม่เกิด (claim token เดิม) ถ้าเกิด upsert แบบมีเงื่อนไข `scheduled_for` ให้ผลใหม่กว่าชนะ
- Delete ระหว่างการตรวจ: conditional update ทิ้งผล ไม่มี upsert (AC-38) cascade ลบแถว last response

## Design decisions

- **Per-monitor feed อยู่ใน `monitor_events` และ `monitor_incidents`** (OD-58-02 (a)): ตารางมี tenant RLS, retention 30 วันและ cascade อยู่แล้ว เลี่ยงตาราง audit ใหม่
- **`check_failed` เขียนตอนเกิด**: การหา "ล้มครั้งแรกของ streak" จากผลดิบต้องใช้ window function ข้าม partition ทุก request และ paging รวมกับ event อื่นทำได้ยาก การเขียนตอนเกิดได้หนึ่งแถวต่อ streak และ index `monitor_events_monitor_idx` เดิมรองรับ
- **ค่า HTTP ตอนปิด incident เก็บบน incident**: ผลตรวจถูก purge ก่อน incident (incident ปิดแล้วอยู่ได้ถึง 30 วันหลัง `ended_at`) join ไปผลตรวจจึงหาค่าไม่พบ
- **Last response แถวเดียวต่อ monitor**: เก็บต่อผลตรวจจะเพิ่ม 1,440 แถวต่อวันต่อ monitor ที่รอบ 1 นาที พร้อม body 16 KiB ต่อแถว การเขียนทับจำกัดไว้ที่ไม่เกิน 50 แถวต่อ Organization purge ใช้กับ monitor ที่หยุดเกิน 30 วัน
- **ไม่เก็บรายละเอียด response ของคำขอที่มี query หรือ body** (OD-58-11 (d)): เป็นทางเดียวที่ครบตาม AC-42 โดยไม่ปิดข้อความทั่วไป ต้นทุนคือ panel ของ monitor เหล่านั้นแสดงเพียง version และรหัสสถานะ
- **Recent events ไม่เพิ่ม kind**: consumer สองตัวแสดง kind ที่ไม่รู้จักผิด (`EventsSection.tsx:34-38` เป็น SSL, `RecentEventsCard.tsx:53-61` เป็น "ล่ม") เพิ่มเพียง `httpStatus` แบบ optional
- **ไม่เพิ่ม field ที่ไม่มีผู้ใช้**: incidents API คงเดิม (ฟีดเป็นผู้แสดงค่าตอนปิด) recent events ไม่เพิ่ม response time
- **Redirect ที่ล้มแสดง "ไม่มี response"** (OD-58-10 (a)): ตรงกับ AC-32 และ path ของ redirect ใน SSRF helper คงเดิม
- **`HTTP/2` อยู่นอกขอบเขต**: issue ระบุเองว่านอกขอบเขต [ตรวจแล้วโดย reviewer ด้วย `gh`] และ client เป็น HTTP/1.1 เท่านั้น (`http1.ts:31-33`) status line จึงแสดง `HTTP/1.0` หรือ `HTTP/1.1` ตามที่เป้าหมายตอบ
- **Architecture drivers ที่แตะ**: security และ privacy (header, body, actor), audit (ค่าเดิม/ค่าใหม่และผู้แก้), data growth: `check_failed` สูงสุดประมาณ 720 แถวต่อวันต่อ monitor เมื่อผลสลับผ่าน/ล้มทุก 60 s (ต่ำกว่าผลตรวจ 1,440 แถวต่อวัน) และ purge รันทุกรอบ scheduler (`scheduler.ts:85-89`) `config_changed`, `paused`, `resumed` เกิดตามการกระทำของผู้ใช้ ไม่มี target ด้าน performance เพิ่ม (ตาม F-005)
- **Risks**:
  - body ที่ redact แล้วยังมี personal data ของบุคคลที่สาม: ผู้อ่านเป็น `owner` และ `admin` เท่านั้น และ cap 16 KiB
  - header ซ้ำถูกรวมด้วย `, ` (`http1.ts:98-102`) ทำให้ `set-cookie` หลายตัวรวมกัน: `set-cookie` ถูก redact ทั้งค่า ค่าที่แสดงของ header ซ้ำอื่นเป็นค่ารวม
  - ค่าลับที่สั้นมากเป็น needle ทุกความยาวแบบเดิม จึงอาจปิดข้อความทั่วไปใน panel ได้ ผลนี้มีอยู่แล้วใน F-005 (`actual` ของ assertion) และไม่ลดการปิดค่าลับ
  - migration `0019` ชนกับ branch อื่น: ตรวจเลขตอน rebase ห้ามแก้ migration ที่ apply แล้ว (DB-11)
  - CHECK ของ `monitor_events.kind` ไม่มีชื่อที่ตั้งเอง: ค้นจาก `pg_constraint` แบบ `0017` และมี DB test
- **Assumptions**:
  - "failed check ครั้งเดียว" ใน issue หมายถึงความล้มเหลวที่ยังไม่ถึงเกณฑ์ล่ม แสดงหนึ่งแถวต่อ streak
  - event ก่อน `0019` ไม่มี actor และ `changes` ฟีดแสดง "แก้ไขการตั้งค่า" โดยไม่มีรายละเอียด
  - ฟีดแสดงข้อมูลภายใน retention 30 วันเดิม
  - OD-58-09 (request body ที่ถูกสะท้อนกลับ) ไม่มีข้อเสนอและผู้ใช้ไม่ได้ตัดสินแยก Technical Lead ถือว่า OD-58-11 (d) ครอบข้อนี้: คำขอที่ส่ง body จริงไม่เก็บรายละเอียด response จึงไม่มี request body ที่ถูกสะท้อนลงตาราง ข้อนี้ derive จาก (d) ถ้าผู้ใช้ต้องการอย่างอื่นต้องแก้ spec และบันทึกใน Revisions
- **Non-goals**: `HTTP/2`, response snapshot ของ Test, เก็บ response ต่อผลตรวจ, audit log ระดับองค์กร, event ของ SSL ในฟีดต่อ monitor, ปุ่ม copy หรือ download body, การแก้ AC-61, field ใหม่ใน incidents API, status และ header ของ 3xx ที่ redirect ล้ม, การแก้ F-004, F-005 และ `docs/product-direction.md`

## Acceptance

AC `P58-01` ถึง `P58-10` อยู่ใน Acceptance matrix ของ `docs/features/issue-58-monitor-event-feed/feature.md` (`issue-58-AC-1`) spec นี้อ้างตามเลขและไม่เก็บสำเนา Task อ้าง AC ผ่าน `COVERS` Technical Lead ตรวจแล้ว 2026-10-02 ว่าข้อความใน `feature.md` ตรงกับ contract ของ spec นี้ รวม P58-04 และ P58-05 ตาม OD-58-11 (d), P58-02 และ P58-06 ตาม OD-58-08 (b) และ P58-09 ที่แยก purge ของฟีด (`occurred_at`) กับ last response (`scheduled_for`) ตาม Data

## Tasks

`COMMIT_MODE: owned-slice` (ผู้ใช้อนุญาต 2026-10-02): worker แต่ละตัว commit เฉพาะไฟล์ใน `FILES` ของ Task ตัวเอง บน branch ของ worktree นี้ ไม่ push ไม่เปิด PR ไม่ deploy ไม่ force-push และไม่ rewrite commit ของ Task อื่น `READY` ของแต่ละ Task หมายถึง commit ของ Task ที่เป็น dependency อยู่บน branch แล้วและ handoff ผ่าน review ของ Technical Lead start authorization ได้รับแล้ว 2026-10-02

| Task | Depends on | Integration owner of shared files |
| ------ | ---------- | --------------------------------- |
| NODE-58-01 Migration และ schema | None | เจ้าของเดียวของ `packages/db/migrations/0019_monitor_event_feed.sql` และ `packages/db/src/schema.ts` |
| NODE-58-02 Executor snapshot และ status line | None | เจ้าของเดียวของ `packages/shared/src/outbound-http/http1.ts`, `send.ts` (เฉพาะ `OutboundResponse`), `packages/shared/src/monitor-check/` และ `packages/shared/src/index.ts` ถ้าต้อง export type ใหม่ |
| NODE-58-03 Worker: บันทึก event, ค่าตอนปิด, last response | 01, 02 | เจ้าของเดียวของ `apps/worker/src/monitor/` |
| NODE-58-04 API: contract, ฟีด, last response, recent events, config diff | 01 | เจ้าของเดียวของ `packages/api-contract/src/monitor.ts` และ `apps/api/src/monitors/` integration owner ของ `apps/web/src/lib/api/openapi-types.gen.ts` (generate ครั้งแรกและ commit) |
| NODE-58-05 Web: ฟีด, panel, recent events, ลบ mockup | 04 | เจ้าของเดียวของ `apps/web/src/pages/monitors/`, `apps/web/src/pages/workspace/EventsSection.tsx`, `apps/web/src/pages/WorkspacePage.test.tsx`, `apps/web/src/lib/api/monitors.ts` regenerate `openapi-types.gen.ts` ได้เฉพาะเมื่อผลต่างจาก commit ของ 04 |
| NODE-58-06 Integration verification | 01 ถึง 05 | เจ้าของเดียวของไฟล์ใหม่ใน `e2e/` |

กฎไฟล์ร่วม:

- ไฟล์ร่วมมีเจ้าของเดียวตามตาราง Task อื่นที่ต้องการแก้ไฟล์นั้นหยุดและแจ้ง Technical Lead ไม่แก้เอง
- `packages/api-contract/src/monitor.ts` เป็นของ 04 เท่านั้น type ของ snapshot ที่ 02 สร้างอยู่ใน `packages/shared` (PKG-01: Worker import contract ไม่ได้) 04 แปลง snapshot เป็น `LastResponse` ใน contract
- `apps/web/src/lib/api/openapi-types.gen.ts` สร้างด้วย `bun run --cwd apps/web codegen` เท่านั้น ไม่แก้ด้วยมือ
- `packages/db/src/schema.ts` เป็นของ 01 เท่านั้น 03 และ 04 ใช้ schema ที่ 01 commit แล้ว
- ลำดับ commit: 01 และ 02 (ขนานกันได้, ไฟล์ไม่ซ้อน) แล้ว 03 และ 04 (ขนานกันได้หลัง dependency พร้อม, ไฟล์ไม่ซ้อน) แล้ว 05 แล้ว 06 ไม่มี `bun.lock` หรือ dependency ใหม่ ถ้า Task ใดต้องเพิ่ม dependency ให้หยุดและแจ้ง Technical Lead

### NODE-58-01 Migration และ schema

- **OWNER:** software-engineer
- **READY:** start authorization 2026-10-02 (ไม่มี dependency)
- **OUTCOME:** `0019_monitor_event_feed.sql` และ Drizzle schema ตามหัวข้อ Data รวม CHECK ของ `detail_omitted`, policy และ grant ของ retention owner และการแก้ `purge_expired_monitor_data`
- **SOURCE:** Contracts → Data, DB-04, DB-11, DB-12
- **INVARIANTS:** ไม่แก้ `0016` ถึง `0018` ไม่เพิ่ม grant `update` หรือ `delete` ของ `nightwatch` บน `monitor_events`
- **FILES:** `packages/db/migrations/0019_monitor_event_feed.sql`, `packages/db/src/schema.ts`, `packages/db/tests/monitor.db.test.ts` (เพิ่ม `monitor_last_responses` ในรายการตารางของ RLS และ grant ที่ 47-55 และ 350-353)
- **NON-GOALS:** การเขียนข้อมูลจาก API หรือ Worker
- **CONTRACTS:** column และ CHECK ตาม Data ที่ 03 และ 04 ใช้
- **VERIFY:** `bun run test:integration` ของ `packages/db`
- **PROOF:** DB test ของ RLS แบบ A-only, B-only, A+B, CHECK ของ kind, actor และ `detail_omitted`, cascade, purge 30 วันตาม `scheduled_for` (รวม last response ของ monitor ที่หยุด) และ actor สามกรณี: (1) แถว `unrecorded` (2) `actor_kind = 'user'` กับผู้ใช้ที่มีบัญชี (3) ลบ user แล้ว `actor_user_id` เป็น `null` โดย `actor_kind` ยังเป็น `'user'` ภายใต้ `FORCE ROW LEVEL SECURITY` ทั้งที่ `nightwatch` มีเพียง `select, insert` บน `monitor_events`
- **COVERS:** P58-07, P58-09

### NODE-58-02 Executor snapshot และ status line

- **OWNER:** software-engineer (โหลด `security-and-hardening`)
- **READY:** start authorization 2026-10-02 (ไม่มี dependency)
- **OUTCOME:** `http1.ts` คืน version และ reason phrase `send.ts` ส่งต่อใน `OutboundResponse` executor คืน `responseSnapshot` ที่ redact และตัด หรือแบบ `detailOmitted: 'request_values'` ตามตัวกระตุ้น
- **SOURCE:** Jobs → Executor, Authorization and security, Contracts → API (Last response), OUT-01, JOB-05
- **INVARIANTS:** การ parse status, classification, redirect, การตรวจ address และ path ของ error ใน `send.ts` คงเดิม การแก้ `send.ts` จำกัดที่เพิ่ม `httpVersion` และ `reasonPhrase` ใน `OutboundResponse` (53-62) และตอนสร้างผล (568-580) ค่าดิบอยู่เฉพาะใน executor ค่า query และ request body ไม่เป็น needle
- **FILES:** `packages/shared/src/outbound-http/http1.ts`, `packages/shared/src/outbound-http/send.ts` (เฉพาะสองจุดข้างบน), `packages/shared/src/monitor-check/run-check.ts`, `types.ts`, tests (`redact.ts` แก้เฉพาะถ้าการเพิ่ม needle รูป latin1 ทำผ่าน `extra` ไม่ได้)
- **NON-GOALS:** HTTP/2, การเก็บข้อมูล, การคืน 3xx ของ redirect ที่ล้ม
- **CONTRACTS:** type `ResponseSnapshot` ที่ 03 ใช้ (shape ตาม `LastResponse` ยกเว้น field ที่ Worker เติม)
- **VERIFY:** `bun run --cwd packages/shared test` และ `test:bun` ของ `packages/shared`
- **PROOF:** test ของ denylist, ชื่อ header ลับ, ค่าลับสามรูปเดิมใน header และ body, ค่าลับที่ไม่ใช่ ASCII ที่ถูกสะท้อนใน header (ถอด `latin1`) และใน body `iso-8859-1`, reason phrase และชื่อ header ที่มีค่าลับ, เพดาน 50 header, 256 ตัวอักษร, 1 KiB, 128 ตัวอักษร, 16 KiB, content-type ที่ไม่ใช่ข้อความ, `body_kind` ที่เลือกจาก `content-type` ดิบก่อน redact, `HTTP/1.0`, ตัวกระตุ้น `request_values` สามกรณี: URL ของ config มี query, query param ที่ต่อด้วย `buildCheckUrl`, POST ที่ส่ง body และกรณีไม่ตรง: GET ที่มี body ใน config (ไม่ส่ง body), GET ไม่มี query, redirect ที่ล้มไม่มี snapshot ของ response
- **COVERS:** P58-04, P58-05

### NODE-58-03 Worker: บันทึก event, ค่าตอนปิด, last response

- **OWNER:** software-engineer
- **READY:** commit และ handoff ของ 01 และ 02 ผ่าน review ของ Technical Lead
- **OUTCOME:** transaction B เขียน `check_failed`, `end_http_status`, `end_response_time_ms` และ upsert last response ตาม Jobs
- **SOURCE:** Jobs, Concurrency, AC-38, AC-39
- **INVARIANTS:** ลำดับ lock เดิม ทุกการเขียนเกิดหลัง insert ผลตรวจสำเร็จ log ไม่มี field ใหม่
- **FILES:** `apps/worker/src/monitor/record-result.ts`, `apps/worker/src/monitor/checker.ts`, `apps/worker/src/monitor/checker.db.test.ts` (การนับ event ที่บรรทัด 79 จะนับ `check_failed` ด้วย, รายการตารางที่ 1045-1052 เพิ่ม `monitor_last_responses`), tests
- **NON-GOALS:** notification (คงเดิม)
- **CONTRACTS:** แถวใน `monitor_events`, `monitor_incidents`, `monitor_last_responses` ที่ 04 อ่าน
- **VERIFY:** `bun run test:integration` ของ Worker
- **PROOF:** DB test ลำดับผลใน P58-01, `occurred_at` ของ `check_failed` เท่ากับ `checkedAt`, ค่าตอนปิด incident, ผลมาช้า, ผลที่ถูกทิ้ง, check_error, snapshot ที่บันทึกตรงกับผลตรวจ รวมแถว `detail_omitted = 'request_values'`
- **COVERS:** P58-01, P58-03, P58-04, P58-08

### NODE-58-04 API

- **OWNER:** software-engineer
- **READY:** commit และ handoff ของ 01 ผ่าน review ของ Technical Lead
- **OUTCOME:** route `events` และ `last-response`, `httpStatus` ใน recent events, Edit, Pause, Resume เขียน `actor_kind`, `actor_user_id` และ `changes`
- **SOURCE:** Contracts → API, Data, Authorization and security, AC-42, AC-48
- **INVARIANTS:**
  - `config_changed.url_masked` คงความหมายเดิม (มีค่าเฉพาะเมื่อ URL เปลี่ยน) เพราะ `urlChanges` ของ `listChecks` (`read-service.ts:795`) และ `configChanges` ของ response times (`read-service.ts:911`) อ่าน column นี้
  - route ใหม่ตรวจ membership ซ้ำใน tenant transaction ที่อ่านข้อมูล โดย lock `organization FOR SHARE` ก่อน (F-005 Revisions 848(1)) last-response ตรวจ `readResponse` ซ้ำใน transaction นั้น ฟีดใช้ role ที่ตรวจใน transaction เดียวกันเพื่อเลือก `member` หรือ `member_hidden`
  - จำนวนแถวของ recent events และ incidents คงเดิม test ที่ `read-list.db.test.ts:352-454` และ `read-detail.db.test.ts:753-803` ผ่านโดยไม่แก้ expectation ของจำนวนแถว
- **FILES:** `packages/api-contract/src/monitor.ts`, `apps/api/src/monitors/read-routes.ts`, `read-service.ts`, `service.ts`, `permissions.ts` (`readResponse` และข้อความ error), `audit.ts` (`MonitorDenialAction` เพิ่ม `read-response`), `apps/api/src/monitors/secrets.db.test.ts` (รายการ `SCANNED_TABLES` ที่ 1171-1183 เพิ่ม `monitor_last_responses`), tests
- **NON-GOALS:** การแก้ AC-61 audit log, field ใหม่ใน incidents API
- **CONTRACTS:** OpenAPI ของ route ใหม่ที่ 05 generate
- **VERIFY:** `bun run --cwd apps/api test`, `bun run test:integration`, `bun run codegen:check`
- **PROOF:** HTTP test ทุก role ต่อ route ใหม่, diff ของทุก field ในตาราง `changes[]`, header ที่เปลี่ยนเป็นลับ, ค่าลับและ query ไม่อยู่ใน response, actor ทั้งห้าแบบ (`member` สำหรับ `owner`/`admin`, `member_hidden` สำหรับ `viewer`/`auditor`), ลำดับของฟีดเมื่อ `at` เท่ากันข้ามตาราง, Edit ที่แพ้ `409` ไม่เขียน event, last response แบบ `request_values`
- **COVERS:** P58-02, P58-03, P58-04, P58-05, P58-06, P58-08

### NODE-58-05 Web

- **OWNER:** software-engineer
- **READY:** commit และ handoff ของ 04 ผ่าน review ของ Technical Lead
- **OUTCOME:** `MonitorEventsCard` (section ใหม่ คง `IncidentsCard`), `LastResponseCard`, HTTP status ใน recent events ทั้งสองหน้า และลบ mockup ของ #58 ทั้งสามจุด
- **SOURCE:** Contracts → Web, `docs/design-system.md` CMP-01, CMP-05, CMP-06, LAY-02, TYP-04
- **INVARIANTS:** ตาราง incident ใน `IncidentsCard` คงเดิม mockup ของ #56, #57, #59, #63 คงอยู่ import ที่การลบทำให้ไม่ได้ใช้ถูกลบด้วย test ที่ต้องแก้ expectation ให้ตรงโดยไม่ลบ test [ตรวจแล้ว]:
  - `apps/web/src/pages/WorkspacePage.test.tsx:452-461` คาด 4 กลุ่มตัวอย่างรวม #58
  - `apps/web/src/pages/monitors/DetailPage.test.tsx:1410-1426` คาด mockup frame อย่างน้อย 3 ตัว (`>= 3` ที่ 1417) ไม่ผ่านหลังลบ frame ของ #58 สองตัว
  - `apps/web/src/pages/monitors/DetailPage.test.tsx:813-835` คาด `h2` 7 ตัวตามลำดับ ไม่ผ่านเมื่อเพิ่มสอง section ใหม่
- **FILES:** `apps/web/src/pages/monitors/detail/IncidentsCard.tsx` (ลบ `EventFeedMockup` เท่านั้น), `MonitorDetailMockups.tsx`, `labels.ts`, ไฟล์ card ใหม่ใน `detail/`, `DetailPage.tsx`, `DetailPage.test.tsx`, `RecentEventsCard.tsx`, `apps/web/src/pages/workspace/EventsSection.tsx`, `apps/web/src/pages/WorkspacePage.test.tsx`, `apps/web/src/lib/api/monitors.ts`, `openapi-types.gen.ts` (generate), tests
- **NON-GOALS:** เปลี่ยนตาราง incident
- **CONTRACTS:** none
- **VERIFY:** `bun run --cwd apps/web test`, `bun run lint`, `bun run typecheck`
- **PROOF:** test ของทุก kind และ actor ทุกแบบ, state ทั้งห้า, `viewer` และ `auditor` ไม่ยิง request last-response, panel แบบ `request_values` และ "ไม่มี response", ลำดับ heading, body wrap ไม่ทำให้หน้าเลื่อนแนวนอน
- **COVERS:** P58-01, P58-02, P58-03, P58-04, P58-06, P58-10

### NODE-58-06 Integration verification

- **OWNER:** software-engineer
- **READY:** commit และ handoff ของ 01 ถึง 05 ผ่าน review ของ Technical Lead
- **OUTCOME:** e2e ของ Detail และ Overview จากการตรวจจริงกับ target ใน test harness
- **SOURCE:** Integrated verification
- **FILES:** `e2e/`
- **VERIFY:** e2e ที่เกี่ยวข้อง
- **PROOF:** scenario ใน Integrated verification พร้อมผล
- **COVERS:** P58-01, P58-03, P58-04, P58-05

## Integrated verification

- Worker ตรวจ target ที่ให้ผล ผ่าน/ล้ม/ล้ม/ผ่าน แล้ว Detail แสดงฟีดสามแถว (`check_failed`, `incident_opened`, `incident_closed` พร้อม HTTP status และ response time) และ recent events บน Overview แสดง HTTP status ของการเริ่มล่มและการกลับมาปกติ (P58-01, P58-03)
- monitor GET ไม่มี query ที่ target ตอบ `200` JSON: panel แสดง `HTTP/1.1 200 OK`, URL แบบ mask, headers และ body จากนั้น target หมดเวลา panel แสดง "ไม่มี response" monitor ที่มี query: panel แสดงเฉพาะ version และรหัสสถานะพร้อมป้ายเหตุผล (P58-04)
- target ที่สะท้อน header ลับ (รวมค่าที่ไม่ใช่ ASCII), query และ body แล้วสแกน response ของ API, ตาราง และ log ที่จับได้ (P58-05)
- Gates หลังทุก writer หยุด ตาม `scripts/quality/README.md`

## Decisions

ผู้ใช้ยืนยันทุกข้อตามข้อเสนอของ Technical Lead 2026-10-02 ("ยืนยัน OD ตามค่าแนะนำได้หมดเลย และให้เริ่ม implement ได้เลย")

| # | Decision | ผล | ผู้ตัดสิน, วันที่ |
| - | -------- | -- | ----------------- |
| OD-58-01 | เก็บ response header และ body (ขัด F-005 AC-42 และ DIR-001 S3) | (b) Feature ใหม่ของ #58 (`issue-58-AC-1`) supersede AC-42 ของ F-005 เฉพาะ last response งานนี้ไม่แก้ F-005 เก็บแถวเดียวต่อ monitor ที่ถูกเขียนทับ purge เมื่อ `scheduled_for` เก่ากว่า 30 วัน ลบตาม monitor เพดานตาม Authorization and security ข้อเสนอเดิมคือ "(a) หรือ (b)" ใช้ (b) เพราะ Product Owner เขียน Feature แยกที่ `docs/features/issue-58-monitor-event-feed/feature.md` | ผู้ใช้, 2026-10-02 |
| OD-58-02 | config audit | (a) per-monitor ใน `monitor_events` audit log ระดับองค์กรเป็น Feature แยก (อาจรวมกับ #63) | ผู้ใช้, 2026-10-02 |
| OD-58-03 | start/recover สองแถว | (a) เพิ่มฟีดใหม่ คงตาราง incident หนึ่งแถวต่อ incident | ผู้ใช้, 2026-10-02 |
| OD-58-04 | ผู้อ่าน header และ body | (a) `readResponse` = `owner`, `admin` | ผู้ใช้, 2026-10-02 |
| OD-58-05 | ผู้แก้ที่พ้น Organization หรือลบบัญชี | (a) อ่านชื่อตอน query ผูกกับ membership แสดง "อดีตสมาชิก" และ "ผู้ใช้ที่ถูกลบ" | ผู้ใช้, 2026-10-02 |
| OD-58-06 | `HTTP/2` บน status line | นอกขอบเขต (issue ระบุเอง) | ปิดตาม issue, 2026-10-02 |
| OD-58-07 | Feature doc และ behavior rows | Product Owner เขียน Feature ใหม่ที่ `docs/features/issue-58-monitor-event-feed/feature.md` | ผู้ใช้, 2026-10-02 |
| OD-58-08 | ชื่อผู้แก้ขัด F-004 AC-02 | (b) ชื่อเฉพาะ `owner` และ `admin` role อื่นได้ `member_hidden` F-004 ไม่ bump | ผู้ใช้, 2026-10-02 |
| OD-58-09 | request body ที่ถูกสะท้อนกลับ | ไม่มีข้อเสนอและผู้ใช้ไม่ได้ตัดสินแยก ถือว่าครอบโดย OD-58-11 (d) (assumption ของ Technical Lead ดู Design decisions → Assumptions) | Technical Lead derive จาก OD-58-11, 2026-10-02 |
| OD-58-10 | panel เมื่อ redirect ล้ม | (a) แสดง "ไม่มี response" ไม่แก้ path ของ redirect ใน `send.ts` | ผู้ใช้, 2026-10-02 |
| OD-58-11 | วิธีปิดค่า query และ request body ที่ไม่ลับ | (d) ไม่เก็บ reason phrase, ชื่อ header, ค่า header และ body เมื่อ URL หลังต่อ query มี query หรือคำขอส่ง body จริง เก็บเฉพาะ version และรหัสสถานะ | ผู้ใช้, 2026-10-02 |

คำถามจาก `feature.md` ที่ coordinator ตัดสินตาม decision ของผู้ใช้ (derived ไม่ใช่การตัดสินของผู้ใช้โดยตรง, 2026-10-02):

| # | ผล |
| - | -- |
| Q-01 | DIR-001 S3 ถือว่าครอบโดย OD-58-01 (body ที่ redact และตัดแล้ว) |
| Q-02 | ไม่แก้ F-005 ในงานนี้ Feature ของ #58 บันทึกการ supersede AC-42 เฉพาะ last response |
| Q-04 | ไม่มี outcome metric ที่ต้องวัดในงานนี้ |

ยังเปิด: Q-03 ข้อความ empty state ของสอง card (UX Designer กับ Product Owner) ไม่ block contract NODE-58-05 ใช้ข้อความใน UI flow ของ `feature.md` จนกว่าจะได้ข้อความสุดท้าย

`feature.md` freeze เป็น `issue-58-AC-1` แล้ว (2026-10-02)

## Revisions

| Date | Change | Approved by user | `acceptanceVersion` |
| ---- | ------ | ---------------- | ------------------- |
| 2026-10-02 | ร่างแรก | Not yet | none |
| 2026-10-02 | แก้ตาม review รอบ 1: actor แยกสามกรณีด้วย `actor_kind`, redaction ของ query, request body และค่าลับที่ไม่ใช่ ASCII, เพดานของ reason phrase และชื่อ header, `url` และ `configVersion` ใน last response, retention ตาม `scheduled_for`, permission `readResponse`, ลำดับของฟีด, ชนิดของ `changes[]`, ตัด field ที่ไม่มีผู้ใช้, เพิ่ม P58-10, OD-58-08 ถึง OD-58-10, ปิด OD-58-06 | Not yet | none |
| 2026-10-02 | แก้ตาม review รอบ 2: ผลของ needle ที่ไม่ลับ (OD-58-11), `body_kind` เลือกก่อน redact, ลำดับเมื่อเวลาเท่าหรือกลับด้าน, `url` เมื่อไม่มี response, `occurred_at` ของ `check_failed`, `httpStatus` แบบ optional, แยก P58-05, ยืนยัน assumption ของ redirect และต้นทุนของ OD-58-10 (b) | Not yet | none |
| 2026-10-02 | แก้ตาม review รอบ 3: OD-58-11 (d) ไม่เก็บ reason phrase และชื่อ header และนิยามตัวกระตุ้น, ตารางผลของแต่ละทางเลือก, เพิ่ม `send.ts:491-492,499,521` ในรายการ throw | Not yet | none |
| 2026-10-02 | ผู้ใช้อนุมัติ spec และให้ start authorization ปิดทุก OD ตามข้อเสนอ (OD-58-01 เป็น (b), OD-58-09 derive จาก OD-58-11 (d)) ลดตาราง OD-58-11 เหลือ (d) เพิ่ม `detailOmitted` และ `request_values` ใน contract, ตัด needle ของค่าที่ไม่ลับ, ปิด blocker ของ F-004 และ F-005, `READY` หมายถึง handoff ของ dependency ผ่าน review | ผู้ใช้, 2026-10-02 | `issue-58-AC-1` |
| 2026-10-02 | `COMMIT_MODE: owned-slice` (ผู้ใช้อนุญาต) พร้อมเจ้าของไฟล์ร่วมต่อ Task และ `READY` = dependency commit แล้วและผ่าน review, Acceptance อ้าง `feature.md` แทนสำเนา, OD-58-01 บันทึกการ supersede AC-42 เฉพาะ last response, สิทธิ์ทั้ง route ของ last-response, Q-01, Q-02, Q-04 ตามที่ coordinator derive | ผู้ใช้ (`COMMIT_MODE`), 2026-10-02 | `issue-58-AC-1` |
| 2026-10-02 | ชี้แจงจาก review ของ Task (ไม่เปลี่ยน acceptance): เพิ่ม CHECK ของ `outcome`, `http_version`, `body_kind`, `body_omitted_reason` และ partial index `monitor_events_actor_user_idx` ใน `0019` (CR-58-01); `url` ของ last response ผ่าน redactor หลัง `maskUrl` เพราะ path จาก `Location` สะท้อนค่าลับได้ (CR-58-02-01, ตาม P58-05); แทน U+0000 จากเป้าหมายด้วย U+FFFD หลัง redact เพราะ `text`/`jsonb` ของ Postgres ไม่รับ (CR-58-02-02); เพดานค่า header 1 KiB นับเป็น 1024 byte UTF-8 (CR-58-02-05) | Technical Lead (ชี้แจงภายใน acceptance เดิม) | `issue-58-AC-1` |
| 2026-10-02 | ชี้แจงจาก final review (ไม่เปลี่ยน acceptance): `changes[]` ของ `url` ที่ต่างกันเฉพาะค่า query ได้ `kind: "changed"`; header ไม่ลับที่เปลี่ยนชื่อได้สอง entry `value` (ชื่อเดิม → `null`, `null` → ชื่อใหม่); header ลับที่เปลี่ยนชื่อโดย keep ค่าได้ `changed` ของทั้งสองชื่อ (CR-58-04-01, CR-58-F-08) | Technical Lead (ชี้แจงภายใน acceptance เดิม) | `issue-58-AC-1` |
| 2026-10-03 | ชี้แจงจาก Codex review ของ PR #69 (ไม่เปลี่ยน acceptance): purge ของ `monitor_last_responses` เป็น step แรกและใช้ `p_limit` ร่วม (ผลรวม ≤ `p_limit`); contract ของการ mask ค่าลับใน last response ตามหัวข้อ "Encoding contract ของ last response" ด้านล่าง | Technical Lead (ชี้แจงภายใน acceptance เดิม) | `issue-58-AC-1` |

### Encoding contract ของ last response

ข้อความจากเป้าหมายที่ถูก mask: url (`finalUrl` หลัง `maskUrl`), reason phrase, ชื่อ header, ค่า header และ body ที่เป็นข้อความ ค่าลับคือค่าของ slot ลับทุกค่ารวม base64 ของ Basic ทุกความยาว ไม่รวมค่า query และ request body (OD-58-11 (d))

- Needle ต่อค่าลับ: ค่าดิบ, UTF-8 ที่อ่านเป็น latin1, latin1 ซ้อนอีกชั้น และรูปที่ถอด `%XX` แล้วของแต่ละรูป
- ครอบ: needle บนข้อความเดิมและบนทุก view ที่ถอดได้ไม่เกิน 2 ชั้นในลำดับใดก็ได้จาก `+` เป็น space, `%XX` เป็น byte latin1, `%XX` เป็น UTF-8 (สองแบบหลังมีรุ่นที่แปลง `+` ด้วย) และ JSON escape (`\uXXXX` รวม surrogate pair, `\/`, `\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t`) hex ไม่สนตัวพิมพ์ ชื่อ header เทียบแบบ lowercase match ที่ทับหรือติดกันรวมเป็น `•••` เดียว ข้อความที่ไม่มี match คืนค่าเดิมทุกตัวอักษร header denylist มีค่าเป็น `•••` เสมอ
- ไม่ครอบ: encode ตั้งแต่ 3 ชั้น, HTML/XML entity, `%uXXXX`, Unicode normalization, ค่าที่ถูกเปลี่ยนตัวพิมพ์ (ยกเว้นชื่อ header), base64 หรือ encoding อื่นของค่าลับที่ไม่ใช่ Basic, `%` ดิบที่ติดหน้าค่าลับซึ่ง encode บางส่วน (CR-58-02-27), ค่าลับ lone surrogate ที่คร่อมคู่ที่ถอดแล้ว (CR-58-02-30)
- ขอบเขต: body สแกนเฉพาะ prefix `2 × 16384 + maxSpan` code unit (`maxSpan` = 36 ต่อ unit ของ needle, 54 ต่ออักขระ BMP ≥ U+0800 ที่ไม่ใช่ surrogate) output หยุดที่ `2 × 16384` และขยายครอบ match ที่เริ่มก่อนจุดนั้น ลำดับคือ mask, แทน U+0000 ด้วย U+FFFD แล้วจึงตัด
- Fail closed: budget เดียวต่อ snapshot (สแกน 48M อักขระ, view 4M อักขระ) ใช้ตามลำดับ url, reason phrase, header (ชื่อแล้วค่า) และ body เมื่อหมด ข้อความที่เหลือแต่ละชิ้นเป็น `•••` (header มี `redacted` และ `headersTruncated` เป็น true, body เป็น `{ kind: "text", text: "•••", truncated: true }`) head ที่หนาแน่นทำให้ body fail closed ได้โดยไม่มีค่าลับหลุด
