# F-005 Technical Spec

Owner: Technical Lead เมื่อ spec นี้ได้รับอนุมัติ spec นี้เป็น source of truth ของ implementation และ review AC อ้างถึง Acceptance matrix ใน `feature.md` ไม่คัดลอกซ้ำ

| Field                | Value                                                           |
| -------------------- | --------------------------------------------------------------- |
| Feature              | F-005, `acceptanceVersion` F-005-AC-1 (`feature.md`, status draft) |
| Epic                 | None                                                            |
| Status               | Approved                                                        |
| Approved by user     | 2026-09-29                                                      |
| Start authorization  | None (original planning record)                                 |
| `COMMIT_MODE`        | none (original planning record)                                 |
| `STOP_AT`            | review-ready (original planning record)                          |
| Delivery             | Implemented in `8e1ec42` (PR #49).                              |

The delivery record does not change acceptance approval or claim a new runtime verification. Current contracts and revisions remain below; historical plans are in `history.md`.

ข้อความในวงเล็บ [ตรวจแล้ว] คือสิ่งที่อ่านใน code หรือเอกสาร ณ 2026-09-29 ข้อความ [ข้อเสนอ] คือการออกแบบหรือค่าที่ผู้ใช้ยังไม่อนุมัติ ข้อความ [สมมติฐาน] คือสิ่งที่ยังไม่ได้พิสูจน์

## Review guide

Read Contracts, Design decisions and Acceptance coverage for this feature's baseline contract. The delivered task plan and pre-implementation snapshot are in [delivery history](history.md). Author results and remaining gaps are in [integrated verification](verification.md).

Event-feed and last-response changes are specified in [issue #58](../issue-58-monitor-event-feed/spec.md). Successful-mutation audit behavior is specified in [F-007](../F-007-organization-audit-log/spec.md). Read those contracts when the assignment touches these extensions.

## สภาพ code ที่ spec นี้ต่อยอด

The pre-implementation snapshot recorded on 2026-09-29 is in [delivery history](history.md). Current system status is recorded in [Architecture Rules](../../architecture.md).

## Contracts

### API

ทุก route อยู่ใต้ `/api/organizations/{organizationId}/monitors` ประกาศด้วย `createRoute` ของ `@hono/zod-openapi` ใน domain ใหม่ `apps/api/src/monitors/` (`contract.ts`, `routes.ts`, `service.ts`, tests) และ register ใน `apps/api/src/app.ts` Zod schema อยู่ใน `packages/api-contract/src/monitor.ts` (REQ-02) web ใช้ generated OpenAPI types และ validate response ด้วย schema เดียวกัน (WEB-01, WEB-02)

| Operation | Method, path | สิทธิ์ | Success |
| --- | --- | --- | --- |
| List (Overview) | `GET /monitors?limit&offset&health&q` | read | `200 { summary, monitors[], page, dataAsOf }` |
| Recent events | `GET /monitors/recent-events?limit` | read | `200 { events[] }` (incident เปิด/ปิด และระดับ SSL ปัจจุบัน) |
| Detail | `GET /monitors/{monitorId}` | read | `200 { monitor }` |
| Check history | `GET /monitors/{monitorId}/checks?limit&offset` | read | `200 { checks[], page }` |
| Incidents | `GET /monitors/{monitorId}/incidents?limit&offset` | read | `200 { incidents[], page }` |
| Response times | `GET /monitors/{monitorId}/response-times?range=24h\|7d\|30d` | read | `200 { range, unit: 'ms', buckets[], pauses[], configChanges[] }` |
| Create | `POST /monitors` | write | `201 { monitor }` |
| Edit | `PATCH /monitors/{monitorId}` | write | `200 { monitor }` |
| Pause, Resume | `POST /monitors/{monitorId}/pause`, `/resume` | write | `200 { monitor }` (idempotent: หยุดตัวที่หยุดแล้วคืนสถานะปัจจุบัน) |
| Delete | `DELETE /monitors/{monitorId}` | write | `204` |
| Test (ก่อนสร้าง) | `POST /monitors/test` | write | `200 { result }` |
| Test (ใน Edit) | `POST /monitors/{monitorId}/test` | write | `200 { result }` |

รายละเอียดที่ต้องตรง:

- **Input:** `limit` 1..50 default 25 (list) หรือ 20 (checks, incidents), `offset` >= 0 แบบ member list เดิม `health` เป็น `up|down|unknown|paused` `q` trim ยาวไม่เกิน 200 ค้นใน name และ host ด้วย `ILIKE` ที่ escape `%` `_` และ bind ค่า (DB-02) ลำดับ list คงที่: health (ล่ม, ไม่ทราบสถานะ, ปกติ, หยุดชั่วคราว), `lower(name)`, `id` จาก allow-list (DB-08) `summary` นับทุก monitor ของ Organization ไม่ขึ้นกับตัวกรอง
- **Config body** (Create, Edit, Test ใช้ schema เดียว `monitorConfigSchema`): `name`, `url`, `intervalSeconds` (60, 300, 900), `timeoutSeconds`, `method`, `headers[] { id?, name, value?, secret }`, `queryParams[] { name, value }`, `body { type: 'json'|'text', content } | null`, `expectedStatus` (string ตาม AC-30 แปลงเป็น `{from,to}[]`), `assertions[]` (`jsonPathEquals { path, expected }`, `bodyContains { text }`, `responseTimeBelow { ms }`), `auth` (`none | bearer | basic | apiKey { headerName }`) ส่วนค่าลับส่งเป็น `secrets` แยก (ดู Authorization and security) ไม่มี field `mode` เพราะโหมดพื้นฐานและขั้นสูงเป็นเรื่องของ UI
- **ค่าเริ่มต้นของ config** (AC-06): `intervalSeconds` 300, `timeoutSeconds` 10, `method` `GET`, `expectedStatus` `"200-299"`, `headers`, `queryParams`, `assertions` ว่าง, `body` `null`, `auth` `none` schema ใส่ค่าเหล่านี้ด้วย `.default()` เพื่อให้ web และ server ได้ค่าเดียวกัน ชื่อและ URL ซ้ำกันได้ ไม่มี unique constraint (AC-31)
- **List item** (`monitors[]`): `id`, `name`, `url` (config URL ตาม OD-17), `status`, `health`, `healthReason`, `lastKnownDown`, `consecutiveFailures`, `lastCheckAt`, `lastResponseTimeMs`, `openIncident { startedAt, reason } | null`, `ssl { level, daysRemaining, host }`, `uptime { h24, d30 }` (shape เดียวกับ Monitor view) `summary` = `{ up, down, unknown, paused, total, limit }` โดย `up + down + unknown + paused = total` และ `limit` คือขีด 50 เพื่อให้ Overview แสดงเหตุผลข้างปุ่มเมื่อ `total >= limit` (AC-05, AC-31)
- **Recent events** `events[]`: `{ kind: 'incident_opened' | 'incident_closed' | 'ssl_level', monitorId, monitorName, at, reason, durationSeconds?, sslLevel?, daysRemaining? }` `limit` 1..20 default 10 ภายในข้อมูลที่เก็บ 30 วัน เรียง `at desc` `ssl_level` มาจากระดับ SSL ปัจจุบันที่ไม่ใช่ `ok`
- **Incidents** `incidents[]`: `{ id, startedAt, endedAt | null, durationSeconds, startReason, startHttpStatus | null, endReason: 'recovered' | 'paused_by_user' | null }` เรียง `startedAt desc`
- **SSL level** (AC-05, AC-24, AC-36, OD-10): คำนวณที่ server จาก `ssl_not_after` และ `now()` ทุก request และในการตรวจทุกครั้ง `daysRemaining = ceil((ssl_not_after - now()) / 1 day)` (ปัดขึ้น เพื่อให้ `daysRemaining <= 30` ตรงกับเหลือเวลาไม่เกิน 30 วันจริง) `expired` เมื่อ `ssl_not_after <= now()`, `danger` เมื่อ `daysRemaining <= 7`, `caution` เมื่อ `daysRemaining <= 30`, นอกนั้น `ok` ค่า `level` อื่น: `not_https`, `unreadable`, `no_data` ค่าขอบ: เหลือ 30 วันพอดีเป็น `caution`, 30 วันกับ 1 วินาทีเป็น `ok`, 7 วันพอดีเป็น `danger`, 7 วันกับ 1 วินาทีเป็น `caution`
- **Freshness** (AC-12, OD-08): ผล "เก่ากว่าเกณฑ์" เมื่อ `now() - checked_at > 2 × intervalSeconds` เท่ากับพอดียังไม่เก่า
- **Create** รับ `clientRequestId: uuid` unique ต่อ `(tenant_id, client_request_id)` คำขอซ้ำคืน monitor เดิมด้วย `201` (AC-07, ผู้ใช้ตัดสิน 2026-09-29)
- **Edit** รับ `expectedVersion` ไม่ตรงคืน `409 MONITOR_VERSION_CONFLICT` details `{ currentVersion }` ไม่เขียนอะไร (AC-18)
- **Monitor view** คืน config ที่ไม่ลับครบ (OD-17) ค่าลับคืนเป็น `secretSlots[] { slot, configured: true }` เท่านั้น state: `health` (`up|down|unknown|paused`), `healthReason` (`never_checked|stale|awaiting_new_config|check_error|null`), `lastKnownDown`, `consecutiveFailures`, `lastCheckAt`, `lastResult`, `openIncident`, `ssl { state, host, issuer, notAfter, daysRemaining, reason }`, `uptime { h24, d7, d30: { percent|null, checks, coveragePercent } }`, `version`, `dataAsOf` (เวลา server)
- **Check result view**: `scheduledFor`, `checkedAt`, `outcome` (`pass|fail|check_error`), `httpStatus`, `responseTimeMs`, `failureReason` (enum, ตาราง Jobs), `tlsReason` (`expired|hostname_mismatch|untrusted|self_signed|handshake_failed|null`, AC-35), `assertions[] { kind, expected, actual, actualType, actualTruncated, status: 'pass'|'fail'|'not_evaluated', reason }`, `url` แบบ mask (AC-42, เก็บเป็น `url_masked` ในแถวผลตรวจ), `configVersion`, `evaluatedFromPrefix`
  - `assertions[].reason` เป็น enum: `not_json`, `path_not_found`, `multiple_matches`, `type_mismatch` (พร้อม `actualType`), `no_body`, `undecodable`, `value_mismatch`, `text_not_found`, `too_slow`, `no_response` (ใช้กับ `not_evaluated` AC-32) ข้อความภาษาไทยอยู่ที่ web
- **Checks page** คืน `urlChanges[] { at, url }` (URL แบบ mask) ที่อยู่ในช่วงเวลาของหน้านั้นด้วย เพื่อแสดงเครื่องหมายจุดเปลี่ยน URL ในประวัติ (AC-18, OD-19)
- **Response times** (AC-15): ช่วง 24 ชม. คืนจุดรายครั้ง `{ at, responseTimeMs, outcome }` และ `gaps[] { from, to }` ที่ server คำนวณ: ช่วงที่ห่างจากผล `pass|fail` ก่อนหน้าเกิน `2 × interval` และไม่อยู่ในช่วงหยุด ช่วง 7 และ 30 วันคืน bucket รายชั่วโมง `{ hourStart, avgMs | null, maxMs | null, checks }` bucket ที่ไม่มีผลและไม่หยุดทั้งชั่วโมงเป็น `null` ทุกช่วงคืน `pauses[] { from, to }` และ `configChanges[] { at, urlChanged, url? }`
- **Test result** ใช้ shape เดียวกับ check result โดยไม่มี `scheduledFor` และไม่บันทึกลงฐานข้อมูล (AC-08) ผลของเป้าหมายทุกแบบ (DNS, TLS, timeout, ถูกบล็อก, redirect เกิน) คืน `200` เพราะเป็นผลของเป้าหมาย ส่วนปัญหาของบริการทดสอบคืน error envelope (AC-10)
- **Errors** (REQ-03, envelope `{ error: { code, message, details? } }`):

| Status, code | เมื่อ |
| --- | --- |
| `401 UNAUTHENTICATED`, `403 EMAIL_NOT_VERIFIED` | ตาม `requireVerifiedSession` เดิม |
| `403 MEMBERSHIP_DENIED` | ไม่ใช่สมาชิก หรือ Organization ไม่มีจริง (ตอบเหมือนกัน) |
| `403 PERMISSION_DENIED` | viewer หรือ auditor เรียก write ตรวจก่อน lookup monitor และก่อนส่งคำขอออก (AC-03, AC-49) |
| `404 MONITOR_NOT_FOUND` | id ไม่มี, รูปแบบผิด หรืออยู่ Organization อื่น ทุก operation (AC-48) path param `monitorId` จึงเป็น `z.string().max(64)` แล้ว parse uuid ใน handler ไม่ใช้ `z.uuid()` ที่จะคืน 400 |
| `400 MONITOR_INVALID` | ค่าไม่ผ่าน validation details `{ fields: [{ field, reason }] }` `field` มาจาก allow-list ของ path ใน config (`url`, `headers.2.name`, …) `reason` เป็น enum คงที่ (`required`, `too_long`, `invalid_format`, `blocked_scheme`, `embedded_credentials`, `blocked_port`, `blocked_header`, `duplicate`, `crlf`, `auth_header_conflict`, `invalid_json`, `invalid_jsonpath`, `body_assertion_with_head`, `out_of_range`, `too_many`) ไม่ echo input หรือ Zod issue (REQ-05) monitor routes ใช้ hook ของตัวเองที่แปลง issue เป็น `{field, reason}` ไม่ใช้ `INVALID_INPUT` ทั่วไปที่ไม่มี field |
| `422 MONITOR_TARGET_BLOCKED` | Create หรือ Edit ที่ host เป็นหรือ resolve ไปที่อยู่ต้องห้าม details `{ field: 'url' }` ไม่มี IP ไม่ส่งคำขอออก (AC-09) Test และการตรวจตามรอบไม่ใช้ code นี้ แต่คืนผล `blocked_address` ตาม AC-62 |
| `422 MONITOR_SECRET_ORIGIN_CHANGED` | Edit หรือ Test ที่เปลี่ยน scheme, host หรือ port และยังมี slot ค่าลับแบบ `keep` (AC-44) |
| `409 MONITOR_LIMIT_REACHED` | Organization มี monitor ครบขีด (AC-31) |
| `409 MONITOR_VERSION_CONFLICT` | ดูด้านบน |
| `429 MONITOR_TEST_RATE_LIMITED` | details `{ retryAfterSeconds }` และ header `Retry-After` (AC-11) |
| `503 RATE_LIMIT_UNAVAILABLE` | limiter ใช้ไม่ได้หรือเกิน 2 s ไม่ส่งคำขอออก (REQ-04) |
| `500 INTERNAL_ERROR` | ข้อความ generic ใน production-like |

- Delete ของ monitor ที่ถูกลบไปแล้วคืน `404 MONITOR_NOT_FOUND` web แปลเป็น "มอนิเตอร์นี้ถูกลบแล้ว" บน Overview (AC-50)
- ขีดจำกัดตัวเลขทั้งหมดอยู่ในหัวข้อ Design decisions (OD-20) และประกาศเป็น constant ใน `packages/api-contract/src/monitor.ts` เพื่อให้ web และ server ใช้ค่าเดียวกัน

### Data

Migration `0016_uptime_monitors.sql` (monitor) และ `0017_monitor_notifications.sql` (notification) ตาม DB-11, DB-12 Drizzle schema เพิ่มใน `packages/db/src/schema.ts` ทุกตารางของ Organization มี `tenant_id uuid not null references organization(id) on delete cascade` และ policy แบบ `notification_org_settings` ใน `0002` (restrictive context guard, tenant access `USING` และ `WITH CHECK`, `FORCE ROW LEVEL SECURITY`) ตาม DB-04

| Table | สาระ | Grants ให้ `nightwatch` |
| --- | --- | --- |
| `monitors` | config ที่ไม่ลับ (ชื่อ, URL, method, headers ที่ไม่ลับ, query, body, auth type, api key header name), `expected_status_text` (ข้อความที่ผู้ใช้กรอก สำหรับแสดงใน Edit) คู่กับ `expected_status_ranges jsonb` (รูปที่ normalize แล้ว), `assertions jsonb` ที่เก็บทั้งข้อความที่กรอก (`path`, `expected`) และรูปที่ normalize แล้ว (`pathSegments`, `expectedValue`), `status active|paused`, `version` (ทุกการแก้), `check_config_version` (เฉพาะ field ที่กระทบการตรวจ AC-40), state (`consecutive_failures`, `last_check_at`, `last_outcome`, `last_passed_config_version`), SSL (`ssl_host`, `ssl_issuer`, `ssl_not_after`, `ssl_state`, `ssl_reason`, `ssl_notified_not_after`, `ssl_notified_level`), `client_request_id` unique ต่อ tenant, `created_at`, `updated_at` | select, insert, update, delete |
| `monitor_secrets` | `(monitor_id, slot)` PK, `ciphertext bytea`, `iv`, `auth_tag`, `key_version` slot เป็น `auth.token`, `auth.username`, `auth.password`, `auth.apiKey`, `header.<headerId>` FK ไป `monitors` `on delete cascade` (AC-46) | select, insert, update, delete (API ไม่ select `ciphertext` ใน read path ยกเว้น Test ใน Edit) |
| `monitor_schedule` | ledger สำหรับ scheduler: `monitor_id` PK (FK ไป `monitors` `on delete cascade`), `tenant_id`, `next_check_at`, `claim_token`, `claimed_until`, `check_config_version`, `interval_seconds`, `timeout_seconds` เท่านั้น (สอง field หลังให้ claim function คำนวณ `next_check_at` และ `claimed_until` โดยไม่อ่าน `monitors` ข้าม Organization และ API อัปเดตพร้อม Edit) ไม่มี URL หรือค่าลับ (DB-10) มี tenant RLS, restrictive guard และ `FORCE ROW LEVEL SECURITY` แบบตารางอื่น (DB-04) API insert ตอน Create และ update ตอน Edit, Pause, Resume checker update แบบ conditional ใน tenant context `claim_due_monitor_checks` เป็นทางเดียวที่อ่านข้าม Organization | select, insert, update, delete |
| `monitor_check_results` | partition รายเดือนตาม `scheduled_for` unique `(monitor_id, scheduled_for)` เก็บเฉพาะ field ใน AC-42 และ Check result view (`url_masked`, `check_config_version`, `interval_seconds` ณ เวลาตรวจ) ไม่มี response header, body เต็ม, ค่า query หรือ body ของคำขอ | select, insert |
| `monitor_check_hourly` | rollup ต่อชั่วโมง `(monitor_id, hour_start)` PK: `checks`, `passed`, `covered_seconds`, `response_ms_sum`, `response_ms_max` partition รายเดือน | select, insert, update |
| `monitor_incidents` | `started_at`, `ended_at`, `start_reason`, `start_http_status`, `end_reason recovered|paused_by_user`, `down_notified bool` unique partial index `(monitor_id) where ended_at is null` บังคับ incident เปิดได้หนึ่งตัว | select, insert, update |
| `monitor_events` | timeline `paused`, `resumed`, `config_changed` (พร้อม URL แบบ mask เมื่อ URL เปลี่ยน OD-19) ใช้คำนวณช่วงหยุดและเครื่องหมายจุดเปลี่ยน | select, insert |

Functions (SECURITY DEFINER, `search_path` คงที่, owner เป็น nologin role เฉพาะงาน, `EXECUTE` ให้ `nightwatch` เท่านั้น ตาม DB-10 และแบบ ledger ใน `0008`):

- `claim_due_monitor_checks(p_limit int)` owner `nightwatch_monitor_schedule_owner`: ใน update เดียว เลือก `monitor_schedule` ที่ `next_check_at <= now()` และ (`claim_token is null` หรือ `claimed_until < now()`) `FOR UPDATE SKIP LOCKED` ตั้ง `claim_token` ใหม่, `claimed_until = now() + timeout_seconds + 60 s`, `next_check_at = now() + interval_seconds` (ไม่ไล่ตรวจย้อนหลัง AC-37) คืน `(monitor_id, tenant_id, claim_token, check_config_version, scheduled_for)` limit 1..100 (JOB-02, JOB-06)
- `purge_expired_monitor_data(p_limit int)` owner `nightwatch_monitor_retention_owner`: ลบ `monitor_check_results`, `monitor_check_hourly`, `monitor_events` ที่เก่ากว่า 30 วัน และ incident ที่ `ended_at` เก่ากว่า 30 วัน ไม่ลบ incident ที่ยังเปิด (AC-41) ทีละ batch
- `ensure_monitor_partitions(p_months_ahead int)` owner `nightwatch_owner` เรียกโดย partition runner ด้วย `DATABASE_OWNER_URL` เท่านั้น (DB-09) สร้าง partition ของเดือนก่อน (เพราะ retention 30 วันคร่อมเดือนก่อน และ fixture ของ test ต้องใส่ข้อมูลอายุ 31 วันได้บน database ใหม่), เดือนปัจจุบัน และล่วงหน้า 3 เดือน และ drop partition ที่ช่วงทั้งหมดเก่ากว่า 31 วัน ไม่มี default partition migration `0016` เรียก function นี้ครั้งแรกเอง

Migration `0017_monitor_notifications.sql`:

- drop และสร้าง CHECK 4 ตัวของ `notification_intents` และ `notification_inbox_items` ใหม่ ให้ tenant scope รับ `MONITOR_DOWN`, `MONITOR_RECOVERED`, `MONITOR_SSL_CAUTION`, `MONITOR_SSL_DANGER`, `MONITOR_SSL_EXPIRED` [ตรวจแล้วใน `0002`]: `notification_intents_scope_check` (บรรทัด 30) และ `notification_inbox_items_scope_check` (บรรทัด 108) มีชื่อ ส่วน CHECK ของ column `event_type` (บรรทัด 19 และ 88) ไม่มีชื่อ Postgres จึงตั้งชื่อตาม convention เป็น `notification_intents_event_type_check` และ `notification_inbox_items_event_type_check` [สมมติฐาน จนกว่าจะ query `pg_constraint` บน database ที่ migrate แล้ว] migration ใช้ `DO` block ที่หาชื่อจาก `pg_constraint` ตาม `conrelid` และนิยาม แล้ว drop ถ้าไม่พบให้ `RAISE EXCEPTION` ไม่ drop แบบเงียบ DB test ยืนยันว่าเหลือ CHECK ชุดใหม่เท่านั้น
- เพิ่ม column nullable ใน `notification_intents` และ `notification_inbox_items`: `subject_monitor_id uuid` (ไม่มี FK เพราะ notification ต้องอยู่ต่อหลังลบ monitor AC-19), `subject_monitor_name text`, `monitor_reason text`, `ssl_not_after timestamptz`
- เพิ่ม `notification_org_settings.monitor_alerts_enabled boolean not null default true` (OD-16 ผู้ใช้ตัดสิน 2026-09-29)

### Jobs

Worker role ใหม่ใน `WORKER_ROLES` (OD-21, Technical Lead ตัดสิน ดู Design decisions):

| Role | งาน |
| --- | --- |
| `monitor-scheduler` | ทุก 10 s เรียก `claim_due_monitor_checks(10)` ซ้ำได้ถึง 50 batch ต่อรอบ commit แล้ว enqueue ลง queue `monitor-check` ด้วย job id `monitor-check-<sha256(monitorId\0claimToken)>` (JOB-03, แบบ `dispatch.ts:188-195`) และเรียก `purge_expired_monitor_data(500)` ทุกรอบ ไม่ถือ transaction ระหว่าง enqueue |
| `monitor-checker` | BullMQ Worker ของ `monitor-check` concurrency 20 `attempts: 1` (ผลที่ retry หลังรอบผ่านไปเป็นผลเก่า) |

- **Payload** `{ tenantId, monitorId, claimToken, checkConfigVersion, scheduledFor }` เท่านั้น ไม่มี URL, header หรือค่าลับ (JOB-01, JOB-03, JOB-05)
- **ลำดับของ checker**:
  1. transaction A ใน `withTenantContextRaw(tenantId)`: โหลด monitor, schedule และ ciphertext ถ้า monitor ไม่มี, หยุด, `claim_token` ไม่ตรง หรือ `check_config_version` ไม่ตรง ให้จบงานโดยไม่บันทึก (AC-38) commit
  2. นอก transaction (REQ-01): credential helper ถอดรหัสค่าลับในหน่วยความจำ แล้ว check executor ส่งคำขอผ่าน SSRF helper ค่าที่ถอดรหัสไม่ถูกเขียนลงไฟล์ ไม่เข้า job ledger หรือ log (JOB-05)
  3. transaction B ใน tenant context ด้วยลำดับ lock ในหัวข้อ Concurrency: conditional update `monitor_schedule set claim_token = null where monitor_id = $1 and claim_token = $2 and check_config_version = $3` ถ้าไม่ได้แถว ให้ทิ้งผล (JOB-07) ถ้าได้ ให้ insert result `on conflict (monitor_id, scheduled_for) do nothing` และทำขั้นต่อไปเฉพาะเมื่อ insert จริง: upsert rollup, อัปเดต state, เปิดหรือปิด incident, คำนวณระดับ SSL, เขียน notification intent (ดู Notification)
- **Classification ของผล** (OD-26 ผู้ใช้มอบให้ Technical Lead กำหนด 2026-09-29 ข้อนี้คือการตัดสินของ Technical Lead ใน spec):

| Outcome | เหตุ | นับใน failure streak, incident, uptime |
| --- | --- | --- |
| `pass` | status อยู่ใน expected และทุก assertion ผ่าน | นับ |
| `fail` | `http_status`, `assertion_failed`, `timeout`, `dns_not_found`, `connect_refused`, `connect_failed`, `tls_invalid` (expired, hostname mismatch, untrusted, self-signed), `blocked_address`, `redirect_blocked`, `redirect_limit`, `body_read_failed` | นับ |
| `check_error` ("ตรวจไม่ได้") | `secret_decrypt_failed`, `internal_egress_failed`, `resolver_unavailable` (`EAI_AGAIN`, `ENETUNREACH` ฝั่ง Worker), `executor_error` | ไม่นับ ไม่เปิด incident ไม่นับใน uptime (AC-39) |

  `internal_egress_failed` มาจาก egress canary: เมื่อผลเป็นความล้มเหลวระดับเครือข่าย checker ดูผล canary ที่ cache 30 s (DNS resolve และ TLS connect ไปยังปลายทางที่ตั้งใน env `MONITOR_EGRESS_CANARY_URLS` ผ่าน SSRF helper) ถ้า canary ล้มด้วย ผลเป็น `check_error` กันไม่ให้ทุก monitor ขึ้นล่มพร้อมกันเมื่อเครือข่ายขาออกของ NightWatch ล้ม ฐานข้อมูลใช้ไม่ได้บันทึกอะไรไม่ได้ จึงเป็นช่วงไม่มีข้อมูล และ health เป็น "ไม่ทราบสถานะ" ตามเกณฑ์ความสด
- **State และ health** (คำนวณที่ server ต่อ request ด้วย `now()` ของฐานข้อมูล):
  1. `status = paused` → `paused`
  2. ไม่มีผลของ `check_config_version` ปัจจุบัน → `unknown` เหตุ `never_checked` หรือ `awaiting_new_config` (AC-40, AC-54) `lastKnownDown = true` ถ้ามี incident เปิด
  3. ผลล่าสุดเก่ากว่า `2 × interval` → `unknown` เหตุ `stale` (AC-12, OD-08, OD-09)
  4. ผลล่าสุดเป็น `check_error` → `unknown` เหตุ `check_error`
  5. มี incident เปิด → `down`
  6. ผลล่าสุดของ config ปัจจุบันผ่าน หรือ `consecutive_failures = 1` และเคยผ่านใน config ปัจจุบัน → `up` (UI แสดง "ล้มเหลว 1 ครั้ง")
  7. นอกนั้น (ล้มครั้งแรกของ config ปัจจุบัน) → `unknown` พร้อม `consecutiveFailures = 1`
- **Incident**: `consecutive_failures` ถึง 2 และไม่มี incident เปิด → เปิด incident ผลผ่านหนึ่งครั้งหลังล่มปิด incident ด้วย `recovered` ผ่านของ config ใหม่เท่านั้นที่ปิด incident ค้างจาก config เก่า (AC-40) Edit ที่กระทบการตรวจรีเซ็ต `consecutive_failures = 0` ไม่ปิด incident Pause ปิด incident ด้วย `paused_by_user` Resume รีเซ็ต streak (AC-19)
- **Uptime และ coverage** (AC-14, AC-41): `percent = passed / (passed + failed)` ของผลในช่วง ไม่นับ `check_error` ถ้าไม่มีผลเลยเป็น `null` ("ยังไม่มีข้อมูล") `coveragePercent = min(100, covered_seconds / expected_seconds)` เมื่อ `covered_seconds` คือผลรวม `interval` ของแต่ละผล `pass|fail` และ `expected_seconds` คือช่วงตั้งแต่ `max(window_start, created_at)` ถึง `now()` หักช่วงหยุดจาก `monitor_events` ช่วง 24 ชม. คำนวณจาก `monitor_check_results` ช่วง 7 และ 30 วันจาก `monitor_check_hourly` (ขอบชั่วโมงแรกของช่วงปัดตามชั่วโมง, ผู้ใช้ตัดสิน 2026-09-29)
- **Response times**: ตาม API (Response times) 24 ชม. ไม่เกิน 1,440 จุด 7 และ 30 วัน 168 และ 720 bucket
- **Scheduling กรณีพิเศษ**:
  - Create และ Resume ตั้ง `next_check_at = now()` (OD-14 ตรวจครั้งแรกในรอบ poll ถัดไป ประมาณ 10 s บวกเวลาในคิว AC-54)
  - Field ที่กระทบการตรวจ (เพิ่ม `check_config_version`, รีเซ็ต `consecutive_failures`, ล้าง `claim_token`, ตั้ง `next_check_at = now()`, AC-40): `url`, `method`, `headers`, `queryParams`, `body`, `auth`, ค่าลับทุก slot (replace, delete), `expectedStatus`, `assertions`, `timeoutSeconds` Field ที่ไม่กระทบ: `name` (ไม่เปลี่ยน health และ schedule)
  - แก้ `intervalSeconds` อย่างเดียว: ไม่เพิ่ม `check_config_version` ตั้ง `next_check_at = greatest(now(), last_check_at + interval ใหม่)` เกณฑ์ความสดใช้ interval ใหม่ทันที
  - ทุกการแก้เพิ่ม `version` และเขียน `monitor_events config_changed` (พร้อม URL แบบ mask เมื่อ URL เปลี่ยน)
  - Pause และ Delete ล้าง `claim_token` ใน transaction เดียวกับการเปลี่ยนสถานะ ผลที่มาช้าจึงถูกทิ้งที่ conditional update
- **Shutdown**: SIGTERM หยุด scheduler ก่อน แล้วปิด BullMQ Worker รอ job ที่ทำงานอยู่ไม่เกิน timeout สูงสุด 30 s หลังจากนั้น abort คำขอออก ผลที่ไม่ได้บันทึกกลายเป็นช่วงไม่มีข้อมูลและ lease หมดอายุเอง
- **Parse กับ evaluate แยกกันตาม PKG-01**: Worker import ได้เฉพาะ `packages/shared` และ `packages/db` ไม่ใช่ `packages/api-contract` ส่วน Web import ได้เฉพาะ contract ดังนั้น
  - parser ที่ต้องใช้ทั้ง Web และ API (`parseExpectedStatus`, `parseJsonPath`, `parseExpectedValue`, กฎ URL, รายการ header ต้องห้าม, ขีดจำกัด) อยู่ใน `packages/api-contract/src/monitor.ts` แบบ browser-safe ไม่มี dependency
  - API parse config ด้วย contract แล้วเก็บรูปที่ normalize แล้วลงฐานข้อมูล (`expected_status_ranges jsonb` เป็น `{from,to}[]`, assertion jsonb ที่มี `pathSegments` และ `expected` ที่แปลงชนิดแล้ว) Worker อ่านรูปนี้โดยไม่ parse ซ้ำ
  - `packages/shared/src/monitor-check/` รับเฉพาะ config ที่ normalize แล้ว (type ประกาศใน shared เอง) และ `packages/shared/src/outbound-http/` บังคับกฎ URL และ header ต้องห้ามซ้ำอีกชั้นเป็น defense in depth รายการใน contract และ shared ต้องตรงกัน โดยมี test ใน API (ซึ่ง import ได้ทั้งสอง) เทียบสองรายการ
- **Check executor** อยู่ใน `packages/shared/src/monitor-check/` ใช้ร่วมกันโดย Test ใน API และ checker ใน Worker (SYS-01, PKG-01) ประกอบด้วยการสร้างคำขอ (GET, HEAD ไม่ส่ง body), การประเมิน assertion และการ redact
  - assertion ทุกข้อเป็น `not_evaluated` เมื่อไม่มี response (AC-32)
  - JSONPath ประเมินจาก `pathSegments` ที่ contract parse ไว้แล้ว พบหลายค่าไม่ผ่าน และเทียบกับ `expectedValue` ตามชนิด JSON (OD-24 ผู้ใช้ตัดสิน 2026-09-29) ส่วน syntax subset (`$`, `.name`, `['name']`, `[index]`) และการแปลง `expected` เป็น JSON scalar ถ้าเป็น JSON ที่ถูกต้อง ไม่เช่นนั้นเป็นข้อความ (AC-16, AC-33) อยู่ใน parser ของ contract ตาม "Parse กับ evaluate แยกกันตาม PKG-01"
  - body decode รองรับ `utf-8`, `us-ascii`, `iso-8859-1` ตาม `Content-Type` charset ค่าอื่นเป็น "ไม่ผ่าน: ถอดรหัสไม่ได้" อ่าน body ไม่เกิน 1 MiB ถ้าเกินประเมินจากส่วนต้นและตั้ง `evaluatedFromPrefix` (AC-33)
  - ค่าจริงตัดที่ 200 ตัวอักษร (AC-17) และแทนค่าลับทุกค่า (รวม base64 ของ Basic credential) ด้วย `•••` ก่อนตัด ทั้งใน `actual`, `failureReason` และข้อความ error (AC-43)

### Notification

- **Writer**: transaction B ของ checker เป็นผู้เขียน intent ไม่มี queue ใหม่ writer insert `notification_intents` ด้วย `on conflict (origin) do nothing` แล้ว re-select (แบบ `packages/db/src/notification.ts:115-229`) snapshot ผู้รับเป็น `owner` และ `admin` ปัจจุบัน (ไม่มี actor ให้ตัดออก) แล้วเรียก `create_notification_dispatch` scheduler และ materialize เดิมส่งต่อและกรองผู้รับซ้ำตอน materialize (`apps/worker/src/materialize.ts:105-138`) queue ใช้ไม่ได้จึงไม่ทำให้ผลตรวจหรือ incident หาย เพราะ intent และ ledger อยู่ในฐานข้อมูลแล้ว ledger เดิม retry เอง (AC-53)
- **Origin (dedupe ถาวร เพราะ intent ไม่ถูก purge)**: `monitor:<monitorId>:incident:<incidentId>:down`, `monitor:<monitorId>:incident:<incidentId>:recovered`, `monitor:<monitorId>:ssl:<sslHost>:<notAfterEpoch>:<caution|danger|expired>`
- **กฎ** (AC-24, AC-36, AC-51, AC-52):
  - `MONITOR_DOWN` เมื่อเปิด incident และ `monitor_alerts_enabled` เป็นจริงใน transaction เดียวกัน แล้วตั้ง `down_notified = true` Organization ที่ยังไม่มีแถวใน `notification_org_settings` ถือว่า `monitor_alerts_enabled = true` (ค่าเริ่มต้นของ column)
  - `MONITOR_RECOVERED` เฉพาะ incident ที่ `down_notified` และปิดด้วย `recovered`
  - SSL ส่งเมื่อระดับใหม่รุนแรงกว่า `ssl_notified_level` ของ `(ssl_host, ssl_not_after)` เดียวกัน ถ้าตรวจครั้งแรกอยู่ระดับวิกฤต ส่งเฉพาะวิกฤต ถ้า `not_after` หรือ host เปลี่ยน รีเซ็ตระดับที่แจ้งโดยไม่ส่ง
  - monitor ที่หยุดไม่มีการตรวจ จึงไม่มี event
- **Contract**: organization item ใน `packages/api-contract/src/notification.ts` เปลี่ยนเป็น discriminated union ตาม `eventType` รายการ monitor มี `category: 'monitor'`, `actor: null`, `subject { monitorId, monitorName }`, `reason`, `sslNotAfter` `toItem` และ `itemFields` ใน `apps/api/src/notifications/service.ts` อ่าน column ใหม่ settings GET คืน `monitorAlertsEnabled` PATCH รับ `settingsChangedEnabled` และ `monitorAlertsEnabled` เป็น optional ต้องมีอย่างน้อยหนึ่ง field พร้อม `expectedVersion` เดิม client เดิมที่ส่งเฉพาะ `settingsChangedEnabled` ยังใช้ได้ การเปลี่ยน `monitorAlertsEnabled` เป็นการแก้ settings จึงสร้าง `ORG-NOTIFICATION-SETTINGS-CHANGED` ตามกฎเดิม (เมื่อค่า settings-changed เดิมเปิด) สิทธิ์แก้เป็น `owner` และ `admin` ตาม `hasSettingsAdministratorRole` เดิม
- **Web**: `NotificationsPage.tsx` และ `NotificationsPopover.tsx` แสดง title, context, icon ต่อ event และลิงก์ "เปิดมอนิเตอร์" ไป `/organizations/<id>/monitors/<monitorId>` ลิงก์ไป monitor ที่ถูกลบหรือไม่มีสิทธิ์แสดง "ไม่พบมอนิเตอร์นี้" หรือ denied จากหน้า Detail (AC-52) `OrganizationNotificationSettingsPage.tsx` เพิ่ม checkbox "แจ้งเตือนมอนิเตอร์"
- **ข้อจำกัดเดิม** [ตรวจแล้ว]: inbox แสดงรายการของ Organization ที่ active เท่านั้น admin ที่อยู่หลาย Organization ไม่เห็นแจ้งเตือนของ Organization อื่นจนกว่าจะสลับ ผู้ใช้ยอมรับเป็นข้อจำกัดของ MVP (2026-09-29) ความล่าช้าต่ำสุดเท่ากับ poll 60 s ของ dispatch scheduler บวก retry ไม่มี target ของความล่าช้า (วัดใน pilot)

### Web

- **Routes** ใน `apps/web/src/router.tsx` ใต้ `TenantProvider`/`AppShell`: `/organizations/:organizationId/monitors`, `/new`, `/:monitorId`, `/:monitorId/edit` loader ใน `apps/web/src/lib/auth/loaders.ts` ใช้ `gateVerifiedSession` และ prefetch ผ่าน identity query client (WEB-04) `/new` และ `/edit` ไม่ redirect ตาม role หน้าแสดง `PageState kind="denied"` เองตามแบบ `OrganizationNotificationSettingsPage.tsx`
- **Nav**: leaf `{ label: 'ตรวจสถานะบริการ', icon: 'activity', path: '/organizations/:organizationId/monitors' }` ต่อจาก ภาพรวม ใน `nav-config.ts` ไม่มี `roles` และไม่มี palette entry `isLeafActive` จับ prefix อยู่แล้ว จึง active บน sub-route (AC-01) เพิ่ม `ActivityIcon` ใน `apps/web/src/components/shell/icons.tsx` และ key `activity` ใน `NAV_ICONS`
- **Query keys** ใน `apps/web/src/lib/api/monitors.ts` ใต้ `TENANT_QUERY_PREFIX` เพื่อให้การสลับ Organization cancel และ remove ตามกลไกเดิม (WEB-03):
  - `['tenant','monitors',orgId,'list',{limit,offset,health,q}]`
  - `['tenant','monitors',orgId,'recent-events']`
  - `['tenant','monitors',orgId,'detail',monitorId]`
  - `['tenant','monitors',orgId,'checks',monitorId,{limit,offset}]`
  - `['tenant','monitors',orgId,'incidents',monitorId,{limit,offset}]`
  - `['tenant','monitors',orgId,'response-times',monitorId,range]`

  mutation สำเร็จ invalidate `['tenant','monitors',orgId]` Test เป็น mutation ไม่ cache list และ detail refetch ทุก 30 s โดยไม่ประกาศ (principle ของ Web app และ accessibility ของ Overview)
- **Error mapping**: `PERMISSION_DENIED` บนฟอร์มหรือ dialog แสดง "สิทธิ์ของคุณเปลี่ยนแล้ว" และคงค่า `MEMBERSHIP_DENIED` แสดง denied และ refresh context `MONITOR_NOT_FOUND` แสดง "ไม่พบมอนิเตอร์นี้" (AC-48, AC-49)
- **Components**:
  - กราฟ: visx primitive (ผู้ใช้เลือก 2026-09-29) ประกอบใน `apps/web/src/components/ui/response-time-chart.tsx` โหลดแบบ lazy เฉพาะหน้า Detail pin version และบันทึก license สีมาจาก CSS token ของ status roles ทั้งสองธีม (CMP-05, Evidence surfaces) bucket `null` วาดเป็นช่องว่างผ่าน `defined` แถบหยุดวาดเอง keyboard: region ของกราฟ focus ได้ (`tabIndex={0}`, `role="group"` พร้อม `aria-label` ที่บอกหน่วย ช่วงเวลา และแหล่ง) ลูกศรซ้ายขวาเลื่อนจุดข้อมูล Home และ End ไปจุดแรกและสุดท้าย ค่าของจุดที่เลือกประกาศผ่าน `aria-live="polite"` (เวลา, ms หรือ "ไม่มีข้อมูล", ช่วงหยุด) ตารางทางเลือกเป็น `<table>` ของแอปจากข้อมูลชุดเดียวกัน
  - Select, Textarea, Checkbox, password: native element กับ `textInputClass` แบบ `DisplayPage.tsx` และ `ResetPasswordPage.tsx`
  - Dialog (ผู้ใช้ตัดสิน 2026-09-29): ย้าย `MemberActionDialog` ไป `apps/web/src/components/ui/confirm-dialog.tsx` ไม่เปลี่ยนพฤติกรรม ไฟล์ของ F-004 ที่แตะ [ตรวจแล้วด้วย grep]: `apps/web/src/pages/organization-members/MemberActionDialog.tsx` (ย้ายออก), `apps/web/src/pages/OrganizationMembersPage.tsx`, `apps/web/src/pages/organization-members/SelfLeaveAction.tsx`, `apps/web/src/pages/organization-members/MemberRoleActions.test.tsx` (import) test ของหน้าสมาชิกต้องรันซ้ำ
- **States และ accessibility**: ตาม State tables และ Accessibility ของ `feature.md` ทุกข้อ ตาม `docs/design-system.md` COL-01, COL-02, CMP-01, CMP-02, CMP-03, CMP-05, LAY-02 เวลาแสดงด้วย `<time dateTime>` และระบุ timezone

### Authorization and security

- **Permission map** ใหม่ `apps/api/src/monitors/permissions.ts`: `read` ให้ `owner`, `admin`, `viewer`, `auditor`, `write` ให้ `owner`, `admin` parse role แบบ composite ด้วย `normalizeOrganizationRole` เดิม ลำดับต่อ request: `requireVerifiedSession` → `assertMemberBeforeTenantContext` → permission → lookup monitor ใน `withTenantContext` → validation เชิงเครือข่าย → คำขอออก การปฏิเสธเข้า `auditDenials` ด้วย action `organization.monitor.{list,read,create,update,pause,resume,delete,test}` ไม่บันทึก monitor id, URL หรือ input mutation ที่สำเร็จเขียน audit log ตาม AC-61: helper `auditMonitorMutation(logger, { actorUserId, action, organizationId, monitorId? })` เรียกหลัง commit ห่อ `try/catch` ให้ logger ล้มไม่กระทบ response action คงที่ `organization.monitor.{create,update,pause,resume,delete,secret.set,secret.replace}` และ `organization.notification-settings.monitor-alerts.update` สำหรับ toggle ไม่มี URL, config, ค่า query, body หรือค่าลับ คำขอที่ถูกปฏิเสธไม่เรียก helper นี้ Pause หรือ Resume ที่ไม่เปลี่ยนสถานะ (idempotent) และ Create ที่ replay ด้วย `clientRequestId` เดิมไม่เขียน audit ซ้ำ
- **Log redaction**: เพิ่ม segment `monitors/{monitorId}` ใน path normalization ของ `apps/api/src/app.ts:121-183` โดยคง segment คงที่ `test` และ `recent-events` ไว้ ไม่แทนด้วย `:monitorId` เพิ่ม `REDACT_PATHS` ใน `packages/shared/src/logger.ts` สำหรับ header value, auth และ secrets log ของ checker บันทึกเฉพาะ `tenantId`, `monitorId`, `outcome`, `failureReason`, ระยะเวลา (OPS-01)
- **ค่าลับ (S07, OD-02 บันทึกใน DIR-001 v3 แล้ว)**:
  - Create รับ `secrets: { slot, value }[]` Edit รับ `secrets: { slot, action: 'keep' | 'replace' | 'delete', value? }[]` `replace` ที่ว่างคืน `MONITOR_INVALID` reason `required` (AC-26)
  - เปลี่ยน auth type หรือลบ header ลับ ลบ slot เดิมใน transaction เดียวกับการบันทึก (AC-46)
  - response ไม่มีค่าหรือ ciphertext มีเพียง `configured` (AC-25)
  - Test ใน Edit ที่เป็น `keep` ใช้ค่าที่เก็บไว้ ถอดรหัสใน credential helper ภายใน API ค่า `replace` ใช้กับคำขอทดสอบนั้นและไม่ถูกบันทึก (AC-45)
  - เปลี่ยน scheme, host หรือ port ขณะมี slot `keep` คืน `MONITOR_SECRET_ORIGIN_CHANGED` (AC-44)
  - redirect ไป host อื่นหรือ port อื่น ไม่ส่ง header ลับและ auth ไปยัง hop ถัดไป redirect `http` → `https` ของ host เดียวกัน (port 80 ไป 443) ส่งต่อได้ เพราะเป็นการยกระดับ ไม่ใช่เปลี่ยนปลายทาง (ต่อยอด AC-44, ผู้ใช้ตัดสิน 2026-09-29)
  - header ที่ชื่อชนกับ header ที่ auth สร้าง (`Authorization` สำหรับ bearer และ basic, ชื่อ API key header) ถูกปฏิเสธ (AC-29)
- **Credential helper** `packages/shared/src/credentials.ts`: AES-256-GCM, IV 12 byte สุ่มต่อครั้ง, AAD = `tenantId|monitorId|slot` กันการสลับ ciphertext ข้ามแถว, key จาก env `CREDENTIAL_ENCRYPTION_KEYS` (JSON map version ไป base64 32 byte) และ `CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION` (DB-14) ค่าเก่าที่ใช้ key version เดิมยังถอดได้ การ re-encrypt เมื่อหมุน key อยู่นอกขอบเขต
- **SSRF helper** `packages/shared/src/outbound-http/` (OUT-01, รายการ address และ port ที่ Technical Lead กำหนดตาม AC-09, AC-28, AC-55 และ AC-62 ผู้ใช้ตัดสินรับ 2026-09-29):
  - URL: scheme `http` หรือ `https` เท่านั้น, ไม่มี userinfo, ยาวไม่เกิน 2,048, host ผ่าน WHATWG URL parser (normalize IPv4 แบบตัวเลขฐานต่างๆ) ปฏิเสธ `localhost`, `*.localhost`
  - Port: 80, 443 และ 1024-65535 (ค่าทำงาน ลดการใช้เป็นเครื่องสแกนบริการ well-known port)
  - IPv4 ต้องห้าม: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16` (รวม metadata `169.254.169.254` และ `169.254.170.2`), `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`
  - IPv6 ต้องห้าม: `::/128`, `::1/128`, `::ffff:0:0/96` (ตรวจ IPv4 ที่ฝังตามรายการ IPv4), `64:ff9b::/96`, `100::/64`, `2001::/32`, `2001:db8::/32`, `2002::/16`, `fc00::/7` (รวม `fd00:ec2::254`), `fe80::/10`, `ff00::/8`
  - DNS: resolve ทุก attempt และทุก hop ถ้ามี address ใดต้องห้ามให้ปฏิเสธ แล้ว connect ไปยัง address ที่ตรวจแล้วเท่านั้น (pin) และตรวจ `remoteAddress` ของ socket หลัง connect (connection-time check)
  - Redirect: follow `301, 302, 303, 307, 308` ไม่เกิน 5 hop (OD-13) ตรวจทุก hop ตามกฎข้างบน loop หรือเกินเป็น `redirect_limit` `http` → `https` อนุญาต `https` → `http` หรือไป address ต้องห้ามเป็น `redirect_blocked` (AC-34) expected status ใช้กับ response สุดท้าย
  - Header ต้องห้าม: `Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Keep-Alive`, `Upgrade`, `TE`, `Trailer`, `Expect`, `Proxy-*` ค่า header ห้ามมี CR หรือ LF (AC-29)
  - TLS: ตรวจ chain และ hostname ด้วย CA store ของ runtime ใบรับรองไม่ผ่านทำให้การตรวจล้มเหลว ไม่มีตัวเลือกข้ามใน MVP อ่าน peer certificate ของ hop สุดท้ายเพื่อรายงาน SSL ของ hostname นั้น (AC-35, OD-25 ผู้ใช้ตัดสิน 2026-09-29) ถ้าใบรับรองไม่ผ่าน ยุติก่อนส่ง byte ของคำขอ จึงไม่ส่ง header ลับให้ปลายทางที่ยืนยันไม่ได้
  - Timeout รวมทุก hop เท่ากับ `timeoutSeconds` ของ monitor
  - error ที่แสดงหรือเก็บไม่มี IP ที่ resolve ได้ (AC-09, AC-62)
  - helper คืน `maskUrl()` ที่แทนค่า query ด้วย `•••` ใช้กับประวัติ, incident, notification, ผลทดสอบ และ log (AC-42)
- **Rate limit** `apps/api/src/rate-limit/` (REQ-04): Redis sorted-set sliding window ผ่าน Lua script แบบ atomic, timeout 2 s, key `rl:monitor-test:u:<userId>:o:<orgId>` และ `rl:monitor-test:o:<orgId>` แยกจาก login throttling ของ Better Auth ตรวจหลัง permission และก่อน DNS หรือคำขอออก limiter ล้มคืน `503 RATE_LIMIT_UNAVAILABLE` และไม่ส่งคำขอออก (fail closed ผู้ใช้ตัดสิน 2026-09-29 เพราะ Test ส่งคำขอออกจริง)
- **Save-time validation (AC-09)**: Create และ Edit ตรวจ host ที่เป็น IP literal และ resolve host นอก transaction (REQ-01) ไม่ส่งคำขอ HTTP ถ้าเป็นหรือ resolve ไป address ต้องห้ามคืน `422 MONITOR_TARGET_BLOCKED` DNS ไม่พบให้บันทึกได้ เพราะเป้าหมายอาจล่มชั่วคราว Test และการตรวจตามรอบ resolve ใหม่ทุกครั้งตาม AC-62

### Concurrency

- **ลำดับ lock เดียวทั้ง API และ Worker**: `organization` row (`FOR SHARE` ใน monitor path) → advisory xact lock `notification-membership:<orgId>` (เฉพาะ path ที่เขียน notification intent) → advisory xact lock `monitors:<orgId>` (เฉพาะ Create) → `monitors` row `FOR UPDATE` → `monitor_schedule` row → `monitor_incidents`
  - member path เดิมถือ `organization FOR UPDATE` แล้ว advisory lock (`organization-notifications/service.ts:142-155`, `members.ts:218-223`) และไม่แตะ monitor rows จึงไม่เกิดวงรอ
  - transaction B ของ checker ที่อาจเขียน notification ต้องเอา lock ของ `organization` และ advisory ก่อน `monitors FOR UPDATE` ห้ามเอาหลังถือ `monitors FOR UPDATE` ถ้าจะลดการรอ ให้อ่าน state โดยไม่ lock ก่อน แล้วเอา lock ตามลำดับนี้และตรวจ state ซ้ำ (ดู Risks)
- **Create กับขีดจำกัด**: count และ insert ภายใต้ `monitors:<orgId>` สองคำขอพร้อมกันที่ monitor ลำดับ 49 ได้ผ่านหนึ่ง อีกคำขอได้ `MONITOR_LIMIT_REACHED` (AC-31)
- **Edit พร้อมกัน**: compare-and-swap ด้วย `version` ภายใต้ `monitors FOR UPDATE` ผู้แพ้ได้ `409` ไม่มีการเขียน (AC-18)
- **Pause, Resume, Delete ซ้ำหรือชนกัน**: Pause และ Resume idempotent Delete ซ้ำได้ `404` Pause ที่ชนกับ Delete ได้ผลของคำขอที่ commit ก่อน อีกคำขอได้ `404` หรือสถานะปัจจุบัน (AC-50)
- **ผลตรวจที่มาช้า**: Pause, Delete, Edit ที่กระทบการตรวจ ทำให้ conditional update ของ checker ไม่พบแถว ผลถูกทิ้งทั้งหมด (AC-38)
- **หลาย replica**: `SKIP LOCKED` + claim token + job id กัน enqueue ซ้ำ unique `(monitor_id, scheduled_for)` กันผลซ้ำ unique partial index กัน incident เปิดซ้อน origin unique กัน notification ซ้ำ (AC-37, AC-51)
- **Test กดซ้ำ**: web disable ปุ่มระหว่าง pending และไม่ส่งคำขอที่สอง (AC-50)

## Design decisions

- **Security (OUT-01, DB-14, JOB-05)**: สร้าง SSRF helper, credential helper และ check executor ใน `packages/shared` เพราะ API (Test) และ Worker (ตรวจตามรอบ) ต้องใช้พฤติกรรมเดียวกัน PKG-01 อนุญาตทั้งสองให้ import package นี้
- **Runtime feasibility (ความเสี่ยงสูงสุด)**: Bun ต้องรองรับ connect ไปยัง IP ที่ pin พร้อม SNI และ `Host` ของชื่อเดิม และต้องอ่าน peer certificate ได้ [สมมติฐาน ยังไม่ได้พิสูจน์] `NODE-F005-01` เริ่มด้วย spike บน Bun 1.3.14 ลำดับ: ลอง `node:https` พร้อม `lookup` ก่อน ถ้าไม่ผ่านใช้ทางสำรองที่ผู้ใช้ตัดสิน 2026-09-29: (1) HTTP/1.1 client ขนาดเล็กบน `node:tls` socket ใน Bun ที่ connect ด้วย IP (2) ถ้าข้อ 1 ไม่ผ่านด้วย ใช้ Node 24 สำหรับ checker แต่ต้องหยุดถามผู้ใช้ก่อน ระหว่างนั้น S02, S04, S08 ถูก block รายละเอียดอยู่ใน `NODE-F005-01`
- **Scheduling (JOB-02, OD-06, ผู้ใช้ตัดสิน 2026-09-29)**: คงตัวเลือกรอบ 1 นาที scheduler poll ทุก 10 s ต่างจาก baseline 60 s เพราะรอบ 1 นาทีกับเกณฑ์ความสด 2 นาทีไม่มีที่ว่างพอ ถ้า poll ทุก 60 s ผลอาจห่างถึง 120 s บวก timeout แล้ว monitor ปกติจะกลายเป็น "ไม่ทราบสถานะ" สลับไปมา ด้วย poll 10 s ผลห่างไม่เกินประมาณ 60 + 10 + 30 = 100 s ต้นทุนคือแถว 1,440 ต่อวันต่อ monitor และคำขอออกที่มากขึ้น 5 เท่าเทียบกับ 5 นาที batch 10 ต่อครั้ง ซ้ำได้ถึง 50 ครั้งต่อรอบ รับได้ประมาณ 3,000 claim ต่อนาทีต่อ scheduler ยังไม่มีตัวเลขจำนวน Organization จึงไม่ประเมินเกินนี้
- **ตรวจครั้งแรก (OD-14, ผู้ใช้ตัดสิน 2026-09-29)**: Create และ Resume ตั้ง `next_check_at = now()` การตรวจครั้งแรกเกิดใน poll ถัดไป (ประมาณ 10 s บวกเวลาในคิว) ไม่ใช่ทันที เพราะ API ไม่ enqueue job เอง (SYS-01 และ principle commit before enqueue)
- **Worker role (OD-21, Technical Lead)**: `monitor-scheduler` และ `monitor-checker` แยกจาก role notification เดิม เพื่อ scale checker ได้โดยไม่เพิ่ม scheduler queue `monitor-check` ใช้ `attempts: 1` เพราะผลที่ retry หลังรอบผ่านไปเป็นผลเก่า
- **Classification ของความล้มเหลว (OD-26, Technical Lead)**: จำแนกด้วย error code และ egress canary ตามตาราง Classification ใน Jobs canary กันกรณีเครือข่ายขาออกของ NightWatch ล้มแล้วทุก monitor ขึ้นล่มพร้อมกัน ฐานข้อมูลใช้ไม่ได้บันทึกผลไม่ได้ จึงเป็นช่วงไม่มีข้อมูล ไม่ใช่แถว "ตรวจไม่ได้" (AC-39)
- **Query และ body ไม่ใช่ค่าลับ (OD-23, ผู้ใช้ตัดสิน 2026-09-29)**: ทุก role ที่อ่านได้เห็นค่าใน config ฟอร์มแสดงคำเตือนถาวร (AC-47) ค่า query ถูก mask ในประวัติ, incident, notification, ผลทดสอบ และ log (AC-42) S3 exception ไม่ขยาย ผู้ที่ต้องส่งความลับใช้ header ลับแทน
- **JSONPath (OD-24, ผู้ใช้ตัดสิน 2026-09-29)**: พบหลายค่าเป็น "ไม่ผ่าน" และเทียบตามชนิด JSON เพราะผลที่ขึ้นกับลำดับหรือการแปลงชนิดเงียบๆ ทำให้ผ่านผิด subset ของ syntax และการแปลง `expected` ผู้ใช้ตัดสินในรอบคำถามที่สอง (ดูด้านล่าง)
- **ใบรับรอง (OD-25, ผู้ใช้ตัดสิน 2026-09-29)**: ใบรับรองไม่ผ่าน (หมดอายุ, ชื่อไม่ตรง, chain ไม่น่าเชื่อถือ, self-signed) ทำให้การตรวจล้มเหลว ไม่มีตัวเลือกข้ามใน MVP SSL ที่แสดงเป็นของ hostname ใน hop สุดท้าย เพราะเป็น host ที่ตอบ response ที่ประเมิน TLS ยุติก่อนส่งคำขอ จึงไม่ส่งค่าลับให้ปลายทางที่ยืนยันตัวตนไม่ได้
- **Redirect (AC-34, ผู้ใช้ตัดสิน 2026-09-29)**: อนุญาต `http` → `https` เพราะเป็น redirect ปกติของเว็บ ปิด `https` → `http` เพราะลดระดับการเข้ารหัส
- **S08 เป็น Story แยก (OD-03a, ผู้ใช้ตัดสิน 2026-09-29)**: งานตรวจตามรอบอยู่ใน `NODE-F005-08S` (scheduler) และ `NODE-F005-08` (checker) ซึ่งตรงกับ `F-005-S08`
- **Data growth (architecture: time-growing tables)**: ผลตรวจที่รอบ 1 นาที 50 monitor ต่อ Organization เท่ากับประมาณ 2.16 ล้านแถวต่อ Organization ต่อ 30 วัน จึงใช้ partition รายเดือนและ rollup รายชั่วโมง Overview ที่คำนวณ uptime 30 วันของ 50 monitor จากผลดิบต้องอ่านถึง 2 ล้านแถวทุก refetch ส่วน rollup อ่าน 36,000 แถว
- **Notification**: ใช้ intent และ ledger เดิมแทน queue ใหม่ writer อยู่ใน transaction เดียวกับผลตรวจ incident และ notification จึง commit พร้อมกัน (commit before enqueue)
- **ขีดจำกัด OD-20, OD-13, OD-07 และ port** (ผู้ใช้รับเป็นค่าทำงาน 2026-09-29):

| ค่า | ค่าทำงาน | เหตุผลด้านต้นทุน |
| --- | --- | --- |
| Test rate limit | 10 ครั้งต่อ 60 s ต่อผู้ใช้ต่อ Organization และ 30 ครั้งต่อ 60 s ต่อ Organization | Test หนึ่งครั้งถือ API request ได้ถึง 30 s และส่งคำขอออกจริง ขีดต่อ Organization กันการใช้ NightWatch ยิงเป้าหมายภายนอก |
| Monitor ต่อ Organization | 50 | ที่รอบ 1 นาทีเท่ากับ 72,000 การตรวจต่อวันต่อ Organization |
| Header, query param | แถวละไม่เกิน 20, ชื่อไม่เกิน 256, ค่าไม่เกิน 4 KiB | ขนาด config และคำขอ |
| Assertion | ไม่เกิน 10 | เวลา CPU ต่อการตรวจ |
| Request body | ไม่เกิน 64 KiB | เก็บใน `monitors` และส่งทุกรอบ |
| Response body ที่อ่าน | ไม่เกิน 1 MiB | หน่วยความจำของ checker concurrency 20 |
| ค่าจริงที่ตัด | 200 ตัวอักษร | ขนาดแถวผลตรวจ |
| URL, name | 2,048 และ 100 ตัวอักษร | ขนาดแถวและ UI |
| Expected status | ไม่เกิน 10 ช่วงหรือรหัส รูปแบบ `200-299,301` | AC-30 |
| Redirect (OD-13) | ไม่เกิน 5 hop | เวลารวมยังอยู่ใน timeout |
| Timeout (OD-07) | 1-30 s ค่าเริ่มต้น 10 s และต้องน้อยกว่ารอบตรวจ | 30 s ต่อ slot ของ concurrency 20 |
| Response time assertion | 1 ms ถึง timeout | AC-30 |

- **Risks**:
  - Bun ไม่รองรับ pinned connect หรือ peer certificate: spike ใน `NODE-F005-01` และทางสำรองในข้อ Runtime feasibility
  - ชื่อ CHECK ของ column `event_type` ใน `0002` ไม่ได้ตั้งเอง: migration ค้นจาก `pg_constraint` และ `RAISE EXCEPTION` ถ้าไม่พบ DB test ยืนยัน
  - partition ไม่ถูกสร้างล่วงหน้า insert ผลตรวจล้ม: runner รันหลัง `db:migrate` ทุก environment และ scheduler log warning เมื่อเหลือ partition ล่วงหน้าน้อยกว่า 2 เดือน
  - egress canary ตั้งปลายทางผิด: checker ถือว่า canary ที่ไม่ได้ตั้งค่าเป็น "ไม่ทราบ" และใช้ classification ตาม error code อย่างเดียว
  - advisory lock `notification-membership:<orgId>` ใช้ร่วมกับ materialize และ member mutation ถ้า transaction B เอา lock นี้ทุกผลตรวจ (ประมาณ 50 ครั้งต่อนาทีต่อ Organization ที่รอบ 1 นาที) จะเพิ่มการรอของการเชิญและเปลี่ยน role ทางลด: อ่าน state ก่อน แล้วเอา lock ตามลำดับเดิมเฉพาะเมื่ออาจเกิด event และตรวจ state ซ้ำหลังได้ lock วิธีเลือกให้ implementation ของ `NODE-F005-08` และ `NODE-F005-09` ตัดสินพร้อมหลักฐาน
  - `OUTBOUND_TEST_ALLOWED_HOSTS` เปิดช่องให้ test ยิงไป host ภายใน ถ้าหลุดไป production จะเป็นช่อง SSRF: env schema ทำให้ startup ล้มเมื่อตั้งค่าคู่กับ `NODE_ENV=production` และ `NODE-F005-02` ต้องมี test ของกรณีนี้
  - สิทธิ์ Worker: checker และ scheduler ใช้ runtime role `nightwatch` (NOBYPASSRLS) งานข้าม Organization ผ่าน function ที่มี owner เฉพาะเท่านั้น ไม่มี path ใดใช้ `nightwatch_owner` ขณะรัน (DB-03, DB-09)
- **Assumptions**:
  - CA store ของ Bun เป็นมาตรฐานเดียวกับที่ใช้ตัดสินว่าใบรับรองน่าเชื่อถือ
  - เวลาที่แสดงใช้ formatter เดิมของแอปและระบุ timezone ได้
  - Redis เดิมของ Worker ใช้ร่วมกับ limiter ของ API ได้ (dev และ CI มี Redis ตัวเดียวอยู่แล้ว [ตรวจแล้ว] production ยังไม่ได้ตัดสิน)
- **ตัดสินโดยผู้ใช้ 2026-09-29 (รอบคำถามที่สอง)**:
  - OD-16: ผู้รับ `owner` และ `admin` toggle เดียว `monitorAlertsEnabled` ค่าเริ่มต้นเปิด เพราะผู้รับตรงกับผู้มีสิทธิ์แก้ monitor และ toggle เดียวไม่ต้องออกแบบหน้า settings ใหม่
  - Limiter ใช้ไม่ได้: `503` ไม่ส่งคำขอออก เพราะการยอมให้ผ่านทำให้ NightWatch ยิงเป้าหมายภายนอกได้ไม่จำกัด
  - Inbox หลาย Organization: รับข้อจำกัดเดิมใน MVP ไม่แก้ระบบ notification
  - Audit ของ mutation ที่สำเร็จ: Pino info log แบบ best-effort ขยายในรอบคำถามที่สามเป็น AC-61 (ดูข้อ Audit ด้านล่าง)
  - Production: เพิ่ม `NODE-F005-P2` สำหรับ Worker image และ compose เท่านั้น network egress control ของ production เป็น dependency ก่อน release (ตาราง Dependencies)
  - Retention: 30 วันเป็นค่าของ F-005 (OD-11) incident ที่ปิดแล้วลบเมื่อ `ended_at` เก่ากว่า 30 วัน incident ที่เปิดไม่ถูกลบ
  - Dialog: ย้ายไป `components/ui/confirm-dialog.tsx` (ดู Web)
  - JSONPath: subset `$`, `.name`, `['name']`, `[index]` ไม่มี filter หรือ wildcard `expected` แปลงเป็น JSON scalar ถ้าเป็น JSON ที่ถูกต้อง ไม่เช่นนั้นเป็นข้อความ
  - Performance และ latency: ไม่มี target ใน F-005 วัดใน pilot
  - กราฟ: ใช้ visx (ผู้ใช้เลือกในรอบคำถามที่สาม ดูข้อ Chart ด้านล่าง)
  - Audit (AC-61): ครอบทุก mutation ที่สำเร็จ ดูข้อ Audit ด้านล่าง
- **Chart (ผู้ใช้เลือก visx 2026-09-29)**: ประกอบกราฟจาก visx primitive ใน `apps/web/src/components/ui/response-time-chart.tsx` ข้อดีที่ได้: SVG ใช้ CSS token ของ status roles ได้ตรงทั้งสองธีม, เลือกเฉพาะ package ที่ใช้, ควบคุมการวาดช่องว่างและแถบหยุดได้เอง, license MIT ต้นทุนที่รับ: visx ไม่มี keyboard และ screen reader ในตัว `NODE-F005-11` ต้องทำเอง (region ที่ focus ได้, ลูกศรเลื่อนจุดข้อมูล, ประกาศค่า) และเขียน axis, tooltip, แถบหยุดเองมากกว่า Recharts ตารางเปรียบเทียบอยู่ในหัวข้อ Chart library comparison
  - Package ที่คาดว่าต้องใช้: `@visx/shape` (`LinePath` พร้อม `defined` สำหรับช่องว่าง, `Bar` สำหรับแถบหยุด), `@visx/scale` (`scaleTime`, `scaleLinear`), `@visx/axis`, `@visx/group`, `@visx/responsive` (`ParentSize`) ไม่ใช้ `@visx/xychart` และ `@visx/tooltip` เพราะ tooltip และ keyboard เขียนเองให้ตรง design system
  - ขนาดที่พบ [จากแหล่งภายนอก ยังไม่ได้วัดใน repo]: `@visx/axis` ประมาณ 8.7 KB gzip, `@visx/responsive` ประมาณ 2.3 KB gzip, version 3.12.0 ทั้งชุด license MIT ขนาด gzip ของ `@visx/shape` และ `@visx/scale` (ซึ่งดึง `d3-shape` และ `d3-scale`) ยังไม่พบ ต้องวัดจาก chunk จริง
  - ยังไม่ได้ตรวจ: peer dependency ของ visx 3.12.0 รองรับ React 19 หรือไม่ ถ้าไม่รองรับ `NODE-F005-11` ต้องหยุดและรายงานก่อนติดตั้ง ไม่ใช้ `--force` หรือ override
- **Audit (AC-61, ผู้ใช้ตัดสิน 2026-09-29)**: mutation ที่สำเร็จทุกชนิด (create, update, pause, resume, delete, ตั้งหรือแทนที่ค่าลับ, เปลี่ยน `monitorAlertsEnabled`) เขียน Pino info log แบบ best-effort หลัง commit มี `actorUserId`, action, `organizationId` และ `monitorId` (ถ้ามี) ไม่มีค่าลับ ค่า query หรือ body logger ล้มไม่ทำให้ mutation ล้ม mutation ที่ถูกปฏิเสธไม่เขียน audit log (ใช้ `auditDenials` warn เดิมแยกกัน) ไม่มีตาราง audit
- **ตัดสินโดยผู้ใช้ 2026-09-29 (รอบคำถามที่สี่)**:
  - AC-31: ชื่อและ URL ของ monitor ซ้ำกันได้ ไม่มี unique constraint เพราะหลาย monitor อาจตรวจ URL เดียวกันด้วย assertion หรือ auth ต่างกัน
  - AC-07: กันการสร้างซ้ำที่ server ด้วย `clientRequestId` unique ต่อ Organization คำขอซ้ำคืนตัวเดิม เพราะปุ่มที่ disable ใน web ไม่กันการ retry ของเครือข่าย
  - Uptime และ coverage: สูตรในหัวข้อ Jobs (ไม่นับ `check_error` และช่วงหยุด, coverage จาก `covered_seconds` ต่อช่วงที่คาด) ช่วง 24 ชม. จากผลดิบ ช่วง 7 และ 30 วันจาก rollup รายชั่วโมงที่ปัดขอบตามชั่วโมง เพราะอ่านข้อมูลน้อยกว่าผลดิบประมาณ 60 เท่า
  - ค่าลับเมื่อ redirect: ส่งต่อเมื่อ `http` → `https` ของ host เดิม ตัดทิ้งเมื่อ host หรือ port เปลี่ยน เพราะการยกระดับไม่เปลี่ยนปลายทางแต่การเปลี่ยน host อาจส่งค่าลับให้บุคคลอื่น
  - SSRF: รายการ IPv4, IPv6, hostname และ port (80, 443, 1024-65535) ในหัวข้อ SSRF helper
- **Dependencies**:

| Predecessor | Dependent | Owner | Ready condition |
| --- | --- | --- | --- |
| Production network egress control ของ Worker (จำกัดขาออกไม่ให้ถึงเครือข่ายภายในของ AWS) | F-005 release | ผู้ใช้กับ platform | มีการตัดสินเรื่อง deployment และ Task ของตัวเอง defense in depth ต่อจาก SSRF helper |

- **Non-goals**: AC-27 ทั้งหมด, การ re-encrypt ค่าลับเมื่อหมุน key, ตาราง audit ใหม่, metrics หรือ alert ของ platform, network egress control ของ production (dependency ด้านบน), target ด้าน performance, การตรวจจากหลาย region

## Acceptance rows ที่ Technical Lead เสนอเพิ่ม

The original proposed rows are in [delivery history](history.md). Acceptance criteria live in [Feature](feature.md); this cleanup does not change their version or approval status.

## Tasks

The delivered task plan, ownership and `VERIFY`/`PROOF` instructions are in [delivery history](history.md#tasks). New work requires a separate assignment against the current contracts.

## Integrated verification

The original verification plan is in [delivery history](history.md#integrated-verification). Executed author evidence and unverified paths are recorded in [integrated verification](verification.md).

## Open decisions

The original start-authorization decision is retained in [delivery history](history.md#open-decisions). Delivery is recorded above; new work requires its own authorization.

## Chart library comparison (ผู้ใช้เลือก visx 2026-09-29)

The comparison supporting the user's chart choice is in [delivery history](history.md). The selected chart behavior remains in Design decisions.

## Acceptance coverage

ตาราง AC ของ `feature.md` (AC-01 ถึง AC-62) กับ Task ที่ proof ครอบ ค่าขอบอยู่ใน `VERIFY` ของ Task ที่ระบุ ตัวเลขคือ `NODE-F005-<id>` และ IV คือ integrated verification ใน `NODE-F005-15`

| AC | Tasks | AC | Tasks |
| -- | ----- | -- | ----- |
| AC-01 | 10, 11, 12 | AC-32 | 05, 07, 11, 12 |
| AC-02 | 06A, 06B, 10, 11, IV | AC-33 | 05, 06A (parser), 12 |
| AC-03 | 06A, 07, 10, 11, 12, IV | AC-34 | 01, 07, 08, 12 |
| AC-04 | 10 | AC-35 | 01, 08, 11 |
| AC-05 | 05, 06B, 10 | AC-36 | 05, 09 |
| AC-06 | 06A, 12 | AC-37 | 08S, 08 |
| AC-07 | 06A (`clientRequestId`), 12 | AC-38 | 08 |
| AC-08 | 07, 12 | AC-39 | 08, 11 |
| AC-09 | 01, 06A, 12 | AC-40 | 06A, 06B, 08, 11 |
| AC-10 | 05, 07, 12 | AC-41 | 04, 06B, 08S, 08 |
| AC-11 | 03, 07, 12 | AC-42 | 01, 06B, 08 |
| AC-12 | 06B, 08, 10, 11 | AC-43 | 05, 13 |
| AC-13 | 08, 11 | AC-44 | 13, 14 |
| AC-14 | 06B, 11 | AC-45 | 13 |
| AC-15 | 06B, 11 | AC-46 | 04, 13 |
| AC-16 | 06A, 12 | AC-47 | 12 |
| AC-17 | 05, 08, 11 | AC-48 | 06A, 06B, 07, 11, 12 |
| AC-18 | 06A, 06B, 11, 12 | AC-49 | 06A, 10, 11, 12, IV |
| AC-19 | 06A, 08S, 08, 09, 11 | AC-50 | 06A, 11, 12 |
| AC-20 | 10, IV | AC-51 | 09 |
| AC-21 | 12, IV | AC-52 | 09, 11 |
| AC-22 | 11, IV | AC-53 | 09, IV |
| AC-23 | 11, IV | AC-54 | 06A, 06B, 08S, 08, 12 |
| AC-24 | 09 | AC-55 | 01, 08, IV |
| AC-25 | 13, 14, IV | AC-56 | 02, 13, IV |
| AC-26 | 13, 14 | AC-57 | 03, 06A, 07, IV |
| AC-27 | IV | AC-58 | 04, IV |
| AC-28 | 01, 06A, 07, 12 | AC-59 | 06A, 08, IV |
| AC-29 | 01, 06A, 07, 12, 13 | AC-60 | P1, P2, 08S, 08, IV |
| AC-30 | 06A, 12 | AC-61 | 06A, 09, 13, IV |
| AC-31 | 06A, 10, 12 | AC-62 | 01, 07, 08, 12, IV |

Story กับ Task: S01 → 06B, 10; S02 → 06A, 07, 08S, 08, 12; S03 → 06B, 11; S04 → 05, 06A, 07, 12; S05 → 06A, 11, 12; S06 → 09; S07 → 02, 13, 14; S08 → 04, 08S, 08, P1, P2

## Revisions

A change to an approved contract or AC is recorded here and approved again by the user.

| Date | Change | Approved by user | `acceptanceVersion` |
| ---- | ------ | ---------------- | ------------------- |
| 2026-09-29 | ร่างแรก | Not yet | F-005-AC-1 (draft) |
| 2026-09-29 | รับการตัดสินของผู้ใช้: OD-03a (S08 เป็น Story แยก), OD-23, OD-24, OD-25 และ OD-26 มอบให้ Technical Lead กำหนด | Not yet (spec ยังเป็น draft) | F-005-AC-1 (draft) |
| 2026-09-29 | รับการตัดสินของผู้ใช้: OD-06 (รอบ 1 นาที, poll 10 s), OD-14 (ตรวจใน poll ถัดไป), ค่า OD-20, OD-13, OD-07 และ port เป็นค่าทำงาน, ทางสำรองของ spike (`node:tls` ใน Bun ก่อน Node 24) redirect อนุญาต `http` → `https` ปิด `https` → `http` ฐานข้อมูลล่มเป็นช่วงไม่มีข้อมูล | Not yet (spec ยังเป็น draft) | F-005-AC-1 (draft) |
| 2026-09-29 | รับการตัดสินของผู้ใช้: OD-16, limiter `503`, ข้อจำกัด inbox หลาย Organization, audit เป็น Pino info log, เพิ่ม `NODE-F005-P2` (Worker image และ compose) และ egress control เป็น dependency, retention 30 วันรวม incident ที่ปิด, ย้าย dialog, JSONPath subset, ไม่มี target ด้าน performance, ใช้ chart library ที่เพิ่ม (ตัวที่ใช้รอเลือก) เพิ่ม Review guide | Not yet (spec ยังเป็น draft) | F-005-AC-1 (draft) |
| 2026-09-29 | รับการตัดสินของผู้ใช้: chart ใช้ visx primitive พร้อม keyboard ที่ทำเอง, audit log ครอบทุก mutation ที่สำเร็จตาม AC-61 (รวมค่าลับและ toggle) | Not yet (spec ยังเป็น draft) | F-005-AC-1 (draft) |
| 2026-09-29 | Review round 1: เพิ่ม contract ที่ขาด (ค่าเริ่มต้น, list item, recent events, incidents, สูตร SSL level แบบปัดขึ้น, เกณฑ์ความสด, `tlsReason`, reason ของ assertion, `url_masked`, gap ของ 24 ชม., `urlChanges`, field ที่กระทบการตรวจ, การแก้ interval, settings PATCH แบบ optional, การส่งค่าลับเมื่อ redirect, `OUTBOUND_TEST_ALLOWED_HOSTS`), แยก 06 เป็น 06A และ 06B, แยก 13 เป็น 13 และ 14, เพิ่ม 15 (e2e, docs, integrated verification), แก้ลำดับไฟล์ร่วม (`env.ts`, `index.ts`, `app.ts`, generated types), เพิ่ม Definition of done, ขยาย VERIFY ด้วยค่าขอบของทุก Task | Not yet (spec ยังเป็น draft) | F-005-AC-1 (draft) |
| 2026-09-29 | Review round 2: แก้ข้อขัด PKG-01 (parser อยู่ใน contract, เก็บ config แบบ normalize, Worker ไม่ parse), `loadMonitorEnv()` ตามสภาพ env ของ Worker ที่ตรวจแล้ว, แยก 08 เป็น 08S และ 08 พร้อม checkpoint, ขั้น spike และทางสำรองของ 01, หลักฐาน screen reader ของ 11, `OUTBOUND_TEST_ALLOWED_HOSTS` ผูกกับ hostname, partition ของเดือนก่อน, P1 และ P2 ตามสภาพ compose และ CI ที่ตรวจแล้ว (`compose.worker.yaml` แยก, `security:image` ครอบ Worker), e2e ไม่ใช่ gate ของ PR, map AC-09 ฉบับใหม่ (save เท่านั้น) และ AC-62 ใหม่ (Test และตามรอบ) ลง 01, 06A, 07, 08, 12, 15 | Not yet (spec ยังเป็น draft) | F-005-AC-1 (draft) |
| 2026-09-29 | Review round 3: `monitor_schedule` เพิ่ม `interval_seconds` และ `timeout_seconds` ที่ claim function ต้องใช้, `monitors` เก็บข้อความที่กรอกคู่กับรูป normalize เพื่อแสดงใน Edit, ข้อความ executor ที่ยังบอกว่า parse ใน shared, dependency ของ 06A, P1 ไม่แตะ compose, role ของ Worker ใน dev เป็นงานของ 08 (`apps/worker/package.json` [ตรวจแล้ว]), `loadMonitorEnv` ใน VERIFY ของ 02, ลำดับ `node:https` ก่อน `node:tls` ใน Design decisions, ข้อความ "Product Owner กำลังแก้" ที่ล้าสมัย, ตาราง AC-55 ถึง AC-60 ที่ซ้ำกับ `feature.md` แทนด้วยการอ้าง, เพิ่ม Acceptance coverage AC-01 ถึง AC-62, คำสถานะ `Implemented` ใน Task 15 | Not yet (spec ยังเป็น draft) | F-005-AC-1 (draft) |
| 2026-09-29 | รับการตัดสินของผู้ใช้ (รอบคำถามที่สี่): AC-31 ชื่อและ URL ซ้ำได้, `clientRequestId` ของ AC-07, สูตร uptime และ coverage กับ rollup รายชั่วโมง, การส่งและตัดค่าลับเมื่อ redirect, รายการ address และ port ของ SSRF helper ผู้ใช้ยังไม่อนุมัติ spec และยังไม่ให้ start authorization | Not yet (ผู้ใช้ขออ่านก่อน) | F-005-AC-1 (draft) |
| 2026-09-29 | ผู้ใช้อนุมัติ spec ในการสนทนา `/implement-issue` และสั่ง `COMMIT_MODE = owned-slice` (ไม่เปลี่ยน contract หรือ AC) | 2026-09-29 | F-005-AC-1 |
| 2026-09-29 | ผู้ใช้เปลี่ยนการเลือก chart จาก visx เป็น SVG เขียนเองด้วย `d3-scale` และ `d3-shape` เพราะ visx 3.12.0 ประกาศ peer `react` ถึง `^18` (web ใช้ React 19) มีผลกับ Design decisions (Chart), Web (Components) และ `NODE-F005-11`: แทน `@visx/*` ทุกจุดด้วย `d3-scale` และ `d3-shape` (pin version, ตรวจ license และ peer ก่อนติดตั้ง), `@visx/responsive` แทนด้วย `ResizeObserver`, ขั้นตรวจ peer ของ visx ยกเลิก, `defined` ของ `line()` ยังตัดช่องว่าง, แถบหยุดวาดด้วย `rect`, keyboard และ `aria-live` ตามเดิม, `@visx/axis` แทนด้วย axis ที่เขียนเองจาก scale ไม่เปลี่ยน AC หรือ contract ของ API | 2026-09-29 | F-005-AC-1 |
| 2026-09-30 | Technical Lead ตัดสินแทนผู้ใช้ที่มอบอำนาจการตัดสินใจด้านการออกแบบในรอบ implement (ไม่เปลี่ยน AC): (1) Scheduling: Pause ตั้ง `monitor_schedule.next_check_at = NULL` และล้าง `claim_token`, การแก้ระหว่างหยุดคง NULL (ข้ามกฎ `now()` และ `greatest()`), Resume ตั้ง `now()`, `claim_due_monitor_checks` ข้ามแถว NULL, 06A เพิ่ม VERIFY แก้ monitor ที่หยุดแล้วยังไม่ถูก claim (2) 06B: monitor นับว่าหยุดอยู่ ณ ต้นช่วงเมื่อ event `paused` หรือ `resumed` แรกในช่วงเป็น `resumed` หรือไม่มี event ในช่วงและสถานะปัจจุบันเป็น `paused` (retention ลบ event เก่ากว่า 30 วัน จึงอนุมานจากส่วนที่เหลือ) เพิ่ม fixture หยุด 40 วันยังหยุด, หยุด 40 วันเริ่มต่อ 10 วัน, หยุด 40 วันเริ่มต่อ 35 วัน (3) 06B: ต้นช่วง 7 และ 30 วันของ rollup และ `expected_seconds` ปัดขึ้นเป็นขอบชั่วโมงถัดไป เพื่อไม่ขอ bucket ที่ purge อาจลบแล้ว (4) Classification: `invalid_request` จาก SSRF helper จัดเป็น `executor_error` (`check_error`) และ 05 ต้องเรียก `validateOutboundUrl` กับ `findInvalidHeader` ก่อนส่ง (5) SSRF helper: เพิ่ม `::/96` (IPv4-compatible IPv6) เข้ารายการต้องห้าม เป็นส่วนเพิ่มจากรายการที่ผู้ใช้รับ (6) `search_path` ไม่เพิ่ม `pg_temp` ตาม `0002` ถึง `0015` บันทึกเป็นความเสี่ยงใน PR (7) P1: partition runner ตั้ง `lock_timeout` (8) เจ้าของ `packages/shared/src/index.ts`: 02 ก่อน, 05 เพิ่มบรรทัด export ของตัวเองใน commit แยกหลัง 02 (9) Test ที่พิสูจน์พฤติกรรม Bun ต้องรันด้วย `bun --bun` (vitest ปกติรันบน Node) gate สุดท้ายต้องมีการรันบน Bun | ผู้ใช้มอบให้ Technical Lead ตัดสิน 2026-09-30 (ไม่ได้อนุมัติรายข้อ) | F-005-AC-1 |
| 2026-09-30 | Technical Lead ตัดสินหลังรีวิว `NODE-F005-01` (ผู้ใช้มอบอำนาจตัดสินและอนุมัติ 2026-09-30, ไม่ได้อนุมัติรายข้อ, ไม่เปลี่ยน AC): (1) SSRF helper: รายการ IPv6 ต้องห้ามเพิ่ม `::/96`, `::ffff:0:0:0/96`, `64:ff9b:1::/48` (2) redirect ที่เปลี่ยน host หรือ port ตัด `authorization`, `proxy-authorization`, `cookie` เสมอ นอกเหนือจาก `secretHeaderNames` (3) `maxRedirects` ถูกจำกัดที่ 5 ภายใน helper (4) เวลาต่อ address แบ่งจากเวลาที่เหลือหารจำนวน address ที่เหลือ (5) `packages/shared` มี script `test:bun` (`bun --bun vitest run`) สำหรับ gate บน Bun เพราะ `test` และ `test:coverage` รัน vitest บน Node และ coverage ล้มเมื่อรันด้วย `bun --bun` (v8 coverage รายงาน 0/0) | ผู้ใช้มอบให้ Technical Lead ตัดสิน 2026-09-30 (ไม่ได้อนุมัติรายข้อ) | F-005-AC-1 |
| 2026-09-30 | Technical Lead ตัดสินหลังรีวิว `NODE-F005-02` และ `NODE-F005-05` (ผู้ใช้มอบอำนาจตัดสินและอนุมัติ 2026-09-30, ไม่ได้อนุมัติรายข้อ, ไม่เปลี่ยน AC): (1) credential helper รับและคืน `{ keyVersion, iv, authTag, ciphertext }` ตรงกับคอลัมน์ของ `monitor_secrets` แทน string เดียว และ argument `env` ของ `encryptSecret` กับ `decryptSecret` บังคับส่ง (2) production ปฏิเสธ key version `dev` และค่า dev key สาธารณะ (3) `url` ในผลตรวจเก็บแบบ mask เท่านั้น ไม่ตัดที่ 200 ตัวอักษร (AC-17 ใช้กับ `actual` ของ assertion) (4) JSONPath ประเมินด้วย scanner ที่เดินเฉพาะ path และรองรับ JSON ซ้อนลึกเกิน 128 ชั้น (5) charset alias `utf8`, `ascii`, `latin1` นับเป็น `utf-8`, `us-ascii`, `iso-8859-1` (6) `NODE-F005-06A` และ Test ต้องตรวจความยาว URL หลังต่อ query param (`href.length <= 2048`) ด้วยวิธีต่อ URL เดียวกับ executor และคืน `400 MONITOR_INVALID` field `url` reason `too_long` เพราะ URL ที่ยาวเกินทำให้ทุกการตรวจเป็น `check_error` ตลอดไป (7) `NODE-F005-P2`: image ของ Worker ต้องตั้ง `NODE_ENV=production` และตรวจค่านี้ตอน startup | ผู้ใช้มอบให้ Technical Lead ตัดสิน 2026-09-30 (ไม่ได้อนุมัติรายข้อ) | F-005-AC-1 |
| 2026-09-30 | Technical Lead ตัดสินระหว่างรีวิว `NODE-F005-06A` และ `NODE-F005-08S` (ผู้ใช้มอบอำนาจตัดสินและอนุมัติ 2026-09-30, ไม่ได้อนุมัติรายข้อ, ไม่เปลี่ยน AC): (1) route เขียนของ 06A (Create, Edit, Pause, Resume) คืน `{ monitor }` แบบ record (config, `status`, `version`, `secretSlots`, เวลา) ไม่มี state ที่คำนวณ ส่วน Detail ของ 06B คืน view ที่มี state (health, uptime, SSL, incident) เพราะ state คำนวณเป็นงานของ 06B และ web invalidate แล้ว refetch Detail หลังทุก mutation (2) JSONPath จำกัด 32 segment, ข้อความ assertion (path, expected, bodyContains) จำกัด 4 KiB (3) `monitor_events.config_changed.url_masked` เขียนเมื่อ URL ที่ต่อ query param แล้วและ mask แล้วเปลี่ยน (เพิ่มหรือเปลี่ยนชื่อ param มีเครื่องหมาย แก้เฉพาะค่าไม่มี) (4) JSON ที่ผิดรูปหรือว่างได้ `400 INVALID_INPUT` และ content type ผิดได้ `415 UNSUPPORTED_MEDIA_TYPE` จาก `onError` ทุก route (เดิม 500) (5) 06A รับชนิด auth และ header `secret: true` แต่ไม่รับ field `secrets` และไม่เก็บค่า secret จนกว่า `NODE-F005-13` จะเพิ่มกฎ `required` สำหรับ slot ที่ขาด (6) Pause และ Resume เพิ่ม `version` (7) Create ที่ replay ด้วย `clientRequestId` เดิมคืน monitor เดิมด้วย `201` ก่อนการตรวจ DNS ตอนบันทึก (8) ทุก free-text field ปฏิเสธ NUL และ Unicode ที่ไม่ well-formed ด้วย reason `invalid_format` (9) `maskUrl` ปิดทับ query pair ที่ไม่มี `=` ด้วย (10) การปิดระบบของ Worker ต้องจบภายใน 25 วินาที (`armHardDeadline`) และการปิด worker และ queue ทุกตัวมีเวลาจำกัด (`closeWithin`) | ผู้ใช้มอบให้ Technical Lead ตัดสิน 2026-09-30 (ไม่ได้อนุมัติรายข้อ) | F-005-AC-1 |
| 2026-09-30 | Technical Lead ตัดสินระหว่างรีวิว `NODE-F005-08`, `06B`, `07` และ `09` (ผู้ใช้มอบอำนาจตัดสินและอนุมัติ 2026-09-30, ไม่ได้อนุมัติรายข้อ, ไม่เปลี่ยน AC): (1) `monitor_check_hourly` เพิ่มคอลัมน์ `response_checks integer not null default 0` (จำนวนผลที่มีเวลาตอบสนอง, CHECK `0 <= response_checks <= checks`) เพื่อให้ค่าเฉลี่ย `avgMs = response_ms_sum / response_checks` ไม่เอนต่ำเมื่อมีผลที่ไม่มีเวลาตอบสนอง (2) egress canary ไม่ตาม redirect และนับ status line ใดๆ (รวม redirect ที่ helper ปฏิเสธ) ว่าเข้าถึงได้ (3) ผลที่จบหลังสัญญาณปิดระบบถูกยกเลิกไม่ถูกบันทึกและกลายเป็นช่วงไม่มีข้อมูล ระยะรอ job ที่กำลังทำงานตอนปิดระบบคือ 15 วินาที (แทน 30 วินาทีที่ spec ระบุ) เพื่ออยู่ใต้ hard deadline 25 วินาที (4) ระดับ SSL ที่แสดงใช้สถานะที่บันทึกเมื่อเป็น `unreadable`, `not_https` หรือ `no_data` และ event ระดับ SSL ประทับเวลาที่ระดับนั้นเริ่ม (5) การแจ้งเตือน SSL และ `MONITOR_RECOVERED` ถูกควบคุมด้วย `monitor_alerts_enabled` เช่นเดียวกับ `MONITOR_DOWN` (AC-24) เมื่อปิดจะไม่ส่งแต่ `ssl_notified_*` ยังเลื่อนไป (6) Test endpoint ต้องทำงานได้นานถึง 30 วินาทีผ่าน `Bun.serve` จึงต้องตั้ง `idleTimeout` ให้เกินค่านั้น | ผู้ใช้มอบให้ Technical Lead ตัดสิน 2026-09-30 (ไม่ได้อนุมัติรายข้อ) | F-005-AC-1 |
| 2026-09-30 | Technical Lead ตัดสินระหว่างรีวิว `NODE-F005-13` (ผู้ใช้มอบอำนาจตัดสินและอนุมัติ 2026-09-30, ไม่ได้อนุมัติรายข้อ, ไม่เปลี่ยน AC): (1) Create รับ `secrets: { slot, value }[]` และ Edit รับ `secrets: { slot, action: 'keep'\|'replace'\|'delete', value? }[]` โดย slot คือ `auth.token`, `auth.username`, `auth.password`, `auth.apiKey`, `header.<headerId>` (UUID ตัวพิมพ์เล็ก) (2) กฎ `required`: ทุก slot ที่ config ต้องใช้ต้องมีค่าหรือ slot ที่ `keep` ไว้ตอน Create และ Edit (400 `MONITOR_INVALID` `required` ที่ field `auth` หรือ `headers.N.value`) Test ไม่บังคับกฎนี้ (slot ที่ขาดเป็นผลตรวจ) (3) `delete` รับได้เฉพาะ slot ที่ config ในการบันทึกเดียวกันไม่ต้องใช้แล้ว (idempotent) และ `delete` ของ slot ที่ยังจำเป็นได้ 400 `required` ที่ `secrets.N.slot` (4) `keep` โดยไม่มีแถวที่เก็บไว้ได้ 400 `required` ที่ `secrets.N` และ `value` ที่มากับ `keep` หรือ `delete` ได้ `invalid_format` (5) header ลับต้องมี `id` เป็น UUID จาก client ตอน Create และ Test ก่อนสร้าง ส่วน Edit จับคู่ชื่อกับ id ที่เก็บไว้ (6) เปลี่ยน scheme, host หรือ port ที่มีผล (origin ของ URL ที่ต่อแล้ว) ขณะมี `keep` ได้ `422 MONITOR_SECRET_ORIGIN_CHANGED` ทั้ง Edit และ Test ใน Edit (7) รหัส `503 CREDENTIALS_UNAVAILABLE` เมื่อแอปไม่มี env ของ credential และคำขอต้องเข้ารหัสหรือถอดรหัส (8) อ่านแถว monitor และ slot ของ secret ใน statement เดียวกัน (snapshot เดียว) ทั้งใน API (Test ใน Edit) และ Worker เพื่อไม่ให้ secret ใหม่ถูกส่งไปที่ origin เดิม | ผู้ใช้มอบให้ Technical Lead ตัดสิน 2026-09-30 (ไม่ได้อนุมัติรายข้อ) | F-005-AC-1 |
| 2026-09-30 | Technical Lead ตัดสินหลัง task-15 รายงานอาการ AC-19 (task-15 ถอนรายงานภายหลัง เพราะผลที่เห็นเป็นผลใหม่หลัง Resume แต่ช่องว่างในโค้ดอ่านพบจริงว่า `computeHealth` ไม่มีตัวบอก Resume จึงคงการแก้) (ผู้ใช้มอบอำนาจตัดสินและอนุมัติ 2026-09-30, ไม่เปลี่ยน AC): (1) health หลัง Resume: ผลที่ `scheduled_for` เก่ากว่า event `resumed` ล่าสุด (เทียบแบบ strict, เวลาเท่ากันนับเป็นผลใหม่เพราะเป็น slot แรกหลัง Resume) ไม่นับเป็นผลปัจจุบัน ได้ `unknown` เหตุผล `stale` (ใช้ค่าเดิมใน contract) จนมีผลของ slot หลัง Resume (2) เทียบด้วย `scheduled_for` ที่เป็นเวลาฐานข้อมูลทั้งสองฝั่ง ไม่ใช้ `checked_at` ของ Worker เพื่อไม่ให้นาฬิกาต่างกันทำให้ค้าง `stale` (3) `awaiting_new_config` ยังมาก่อนกฎนี้ | ผู้ใช้มอบให้ Technical Lead ตัดสิน 2026-09-30 (ไม่ได้อนุมัติรายข้อ) | F-005-AC-1 |
| 2026-09-30 | Technical Lead บันทึกส่วนของ contract ที่ implement เพิ่มจากข้อความเดิมของ spec ระหว่างรีวิวรอบสุดท้าย (ไม่เปลี่ยน AC): (1) ผลของ Test มี field `ssl` เพื่อแสดง SSL ตาม AC-08 (2) bucket response time ของช่วง 7 และ 30 วันมี field `responseChecks` ควบคู่กับ `{ hourStart, avgMs, maxMs, checks }` ตามคอลัมน์ที่ Revisions 841(1) เพิ่ม | ผู้ใช้มอบให้ Technical Lead ตัดสิน 2026-09-30 (ไม่ได้อนุมัติรายข้อ) | F-005-AC-1 |
| 2026-09-30 | Technical Lead ตัดสินจาก Codex review ของ PR #49 (ผู้ใช้มอบอำนาจตัดสินและอนุมัติ 2026-09-30, ไม่เปลี่ยน AC): (1) Edit ที่เปลี่ยน origin ที่มีผล (scheme, host, port ของ URL ที่ต่อ query แล้ว เทียบด้วยตัวเดียวกับ `MONITOR_SECRET_ORIGIN_CHANGED`) ล้าง `ssl_host`, `ssl_issuer`, `ssl_not_after`, `ssl_state`, `ssl_reason`, `ssl_notified_not_after`, `ssl_notified_level` ใน update เดียวกับที่เพิ่ม `check_config_version` จน read models แสดง `no_data` ถึงผลตรวจใหม่ เปลี่ยนเฉพาะ path หรือ query ไม่ล้าง (2) certificate ที่ยังไม่ถึงวันเริ่มใช้ (`CERT_NOT_YET_VALID`) จัดเป็น `tls_invalid` เหตุผล `handshake_failed` ไม่ใช่ `expired` เพราะ enum เดิมไม่มีค่าที่ตรงกว่าและ `untrusted` หมายถึง chain | ผู้ใช้มอบให้ Technical Lead ตัดสิน 2026-09-30 (ไม่ได้อนุมัติรายข้อ) | F-005-AC-1 |
| 2026-09-30 | Technical Lead ตัดสินจาก Codex review รอบ 2 ของ PR #49 (ผู้ใช้มอบอำนาจตัดสินและอนุมัติ 2026-09-30, ไม่เปลี่ยน AC): (1) check ที่อ่าน certificate ไม่ได้ (unreadable) ไม่ส่ง SSL level event เลย เพื่อไม่ให้วันหมดอายุของ certificate เก่าทำให้แจ้ง danger หรือ expired ผิดหลังต่ออายุ (2) check ที่อ่านได้และกรณี `CERT_HAS_EXPIRED` ส่ง event เมื่อระดับสูงกว่าระดับที่ส่งแล้วของ certificate เดียวกัน (host และ `not_after`) โดยอ่านจาก `ssl_notified_level` และ `ssl_notified_not_after` ซึ่งเลื่อนเสมอแม้ monitor alerts ปิด ไม่ใช้ `last_check_at` (3) ข้อจำกัดที่รับ: certificate ที่หมดอายุจริงแต่ `not_after` ที่เก็บไว้ยังไม่ถึง (เช่น rollback) ไม่มี SSL expired event แต่ check ล้มและเปิด incident ตามปกติ | ผู้ใช้มอบให้ Technical Lead ตัดสิน 2026-09-30 (ไม่ได้อนุมัติรายข้อ) | F-005-AC-1 |
| 2026-09-30 | Technical Lead ตัดสินจาก Codex review รอบ 3 และ 4 ของ PR #49 (ผู้ใช้มอบอำนาจตัดสินและอนุมัติ 2026-09-30, เพิ่ม enum แบบ additive, ไม่เปลี่ยน AC): (1) body ที่เกิน 1 MiB ประเมินจาก prefix ตาม AC-33 โดยตรวจ grammar ของ prefix ถ้าผิดรูป (รวม NDJSON หรือหลายเอกสาร) ได้ `not_json` (2) เพิ่ม assertion reason `prefix_ended` (ต่อท้าย enum ใน shared และ api-contract) สำหรับ path ที่ prefix จบก่อนตัดสินได้ มี status `not_evaluated` และไม่ทำให้ check fail ถ้าไม่มี assertion อื่นล้ม ผลข้างเคียงที่รับ: monitor ที่ assertion เดียวอยู่หลังจุดตัดจะผ่านและแสดงว่าประเมินไม่ได้ ส่วน body ที่เป็น whitespace ล้วนก็ได้ผลแบบเดียวกัน (3) key ที่พบใน prefix ประเมินตามปกติแม้อาจมี key ซ้ำหลังจุดตัด (4) `bodyContains` ที่ข้อความอยู่หลังจุดตัดยังเป็น `text_not_found` (5) timeout หลัง handshake สำเร็จเก็บ certificate ของ hop สุดท้ายไว้ (reason ยังเป็น timeout) และ SSL state เดินหน้าจาก certificate นั้น (6) กราฟ 7 และ 30 วัน: ชั่วโมงในอดีตนับเป็น pause เมื่อ pause ครอบเต็มชั่วโมง slack 2 เท่าของ interval ใช้กับชั่วโมงปัจจุบันเท่านั้น (7) enqueue ล้มคืน claim ที่ยังไม่ส่งกลับเป็น slot เดิมภายใต้ claim token เดิม | ผู้ใช้มอบให้ Technical Lead ตัดสิน 2026-09-30 (ไม่ได้อนุมัติรายข้อ) | F-005-AC-1 |
| 2026-09-30 | Technical Lead ตัดสินจาก Codex review รอบ 5 ของ PR #49 (ผู้ใช้มอบอำนาจตัดสินและอนุมัติ 2026-09-30, ไม่เปลี่ยน AC): (1) ทุก read route ของ monitor ตรวจ membership ซ้ำภายใน tenant transaction เดียวกับที่อ่านข้อมูล โดย lock `organization FOR SHARE` ก่อน ตาม lock order ของ write path (2) Test ใน Edit ตรวจ write permission ซ้ำใน transaction ที่อ่าน monitor และค่าลับที่เก็บไว้ ก่อนถอดรหัส และปิด transaction ก่อนส่งคำขอออก (3) กราฟและ card ของ response time: ผ่อนผันช่วงที่ไม่มี pause ครอบเฉพาะที่ขอบ window และต้องมี pause ที่ตัดกับ window จึงถือว่าหยุดตลอด ต้น window ของช่วง 7 และ 30 วันใช้ bucket แรกจาก response (4) follow-up: ปลาย window และต้นช่วง 24 ชั่วโมงยังใช้เวลาอ่านของ Detail ซึ่งอาจต่างจาก response ได้ไม่เกินรอบ refetch 30 s การแก้ต้องให้ API ส่งเวลาอ่านกลับ (contract) | ผู้ใช้มอบให้ Technical Lead ตัดสิน 2026-09-30 (ไม่ได้อนุมัติรายข้อ) | F-005-AC-1 |
