# F-005 delivery history

Historical planning sections extracted from `spec.md` at `19f780a`. Dates, task IDs, proposed acceptance rows and verification instructions below belong to that delivery record. They do not authorize new work or claim a fresh verification run.

Current contracts, acceptance trace and revisions remain in [Technical Spec](spec.md). Author verification and its remaining gaps are recorded in [integrated verification](verification.md).

## Review guide

อ่านตามลำดับนี้ก่อน ที่เหลือเป็นรายละเอียดของ contract:

1. **Open decisions** (ท้ายไฟล์): เหลือข้อเดียว คือ start authorization กับ `COMMIT_MODE`
2. **Design decisions → Risks**: ความเสี่ยงสูงสุดคือ Bun อาจไม่รองรับ pinned connect และการอ่าน peer certificate ถ้าไม่ผ่าน S02, S04, S08 ถูก block จนทางสำรองผ่าน
3. **Design decisions ที่เปลี่ยนพฤติกรรมที่ผู้ใช้เห็น**: poll 10 s กับรอบ 1 นาที, ตรวจครั้งแรกใน poll ถัดไป (ไม่ใช่ทันที), redirect `http` → `https` เท่านั้น, ใบรับรองไม่ผ่านทำให้ล้มเหลว, classification "ตรวจไม่ได้", Test ถูกปฏิเสธด้วย `503` เมื่อ limiter ใช้ไม่ได้, inbox แสดงเฉพาะ Organization ที่ active
4. **Jobs → State และ health**: ลำดับการตัดสิน health ทั้ง 7 ขั้น กำหนดสิ่งที่ผู้ใช้เห็นใน Overview และ Detail
5. **Jobs → Parse กับ evaluate แยกกันตาม PKG-01** และ **Design decisions → Chart**: parser อยู่ใน contract และ Worker อ่าน config ที่ normalize แล้ว, visx ไม่มี keyboard ในตัว `NODE-F005-11` ต้องทำ keyboard และการประกาศค่าเอง และยังไม่ได้ตรวจว่า visx 3.12.0 รองรับ React 19
6. **Tasks → ตาราง Order and ownership และกฎไฟล์ร่วม**: Task ที่แตะไฟล์ร่วม ได้แก่ 02 และ 03 (`env.ts`, `app.ts`), 06A, 06B, 07, 13 (contract และ generated types), 08S และ 08 (`apps/worker/src/index.ts`), 08 และ 09 (`record-result.ts`), P1 และ P2 (`package.json` root), 10, 11, 12, 14 (`router.tsx`, `monitors.ts`), 09 (notification เดิม) และ 11 (ไฟล์ของ F-004 จากการย้าย dialog)
7. **Acceptance coverage** (ท้ายไฟล์): ตาราง AC-01 ถึง AC-62 กับ Task ที่ครอบ


## สภาพ code ที่ spec นี้ต่อยอด

| เรื่อง | สภาพปัจจุบัน [ตรวจแล้ว] | ผลต่อ F-005 |
| --- | --- | --- |
| SSRF helper (OUT-01) | ไม่มี ไม่มี server-side HTTP call ใดใน `apps/api`, `apps/worker`, `packages/*` ไม่มี dependency undici, axios, got | ต้องสร้างใหม่ เป็น prerequisite (`NODE-F005-01`) |
| Runtime | API และ Worker รันบน Bun 1.3.14 (`apps/api/Dockerfile`, `apps/worker/package.json`), CI ติดตั้ง Node 24 ด้วย | pinned connect และการอ่าน peer certificate ต้องพิสูจน์บน Bun ก่อน (spike ใน `NODE-F005-01`) |
| Encryption at rest (DB-14) | ไม่มี helper AES-256-GCM ไม่มี env ของ key TOTP ใช้การเข้ารหัสของ Better Auth (`packages/db/src/schema.ts:179-182`) | ต้องสร้าง credential helper (`NODE-F005-02`) |
| Rate limit (REQ-04) | ไม่มี Redis sliding window API ไม่มี Redis client readiness บอก "no Redis in this phase" (`apps/api/src/app.ts:202`, `packages/api-contract/src/health.ts:12`) | ต้องสร้าง limiter และเพิ่ม Redis ให้ API (`NODE-F005-03`) ซึ่งเปลี่ยน readiness ตาม OPS-02 |
| Worker | roles `consumer`, `scheduler` (`apps/worker/src/index.ts:26,61-71`) queue `in-app-materialize` poll 60 s batch 10 (`dispatch.ts:18-21`) job id เป็น sha256 | เพิ่ม role และ queue ใหม่ตามแบบเดิม |
| Worker image | มี Dockerfile เดียวคือของ API | platform สร้าง Worker image และ compose (`NODE-F005-P2`) egress control ของ production เป็น dependency ก่อน release |
| Notification | event type ถูกจำกัดด้วย CHECK 4 ตัวใน `packages/db/migrations/0002_notification_foundation.sql` (บรรทัด 19-24, 30-36, 88-93, 108-114) tenant scope รับเฉพาะ `ORG-NOTIFICATION-SETTINGS-CHANGED` `toItem` hard-code event และ category (`apps/api/src/notifications/service.ts:35-69`) `actor.displayName` บังคับ (`packages/api-contract/src/notification.ts:28-37`) toggle มีตัวเดียว `org_settings_changed_enabled` ไม่มี link ต่อรายการใน popover inbox แสดงเฉพาะ Organization ที่ active | ต้องเปลี่ยน migration, contract, API และ web (`NODE-F005-09`) |
| Partition | ไม่มีตาราง partition และไม่มี partition maintenance job ทั้งที่ architecture กำหนด | ต้องสร้างสำหรับตารางผลตรวจ (`NODE-F005-04`, `NODE-F005-P1`) |
| Audit | ไม่มีตาราง audit มีเพียง `auditDenials` เขียน Pino warn (`apps/api/src/organization-notifications/routes.ts:73-93`) | ใช้แบบเดิม mutation ที่สำเร็จเขียน Pino info log แบบ best-effort (ผู้ใช้ตัดสิน 2026-09-29) |
| Optimistic concurrency | `notification_org_settings.version` + `expectedVersion` คืน `409 SETTINGS_VERSION_CONFLICT` | ใช้แบบเดียวกัน |
| Web | React Router v7 แบบ code-based (`apps/web/src/router.tsx`) `NAV_ICONS` ไม่มี `activity` ไม่มี Chart, Select, Textarea, Dialog กลาง ไม่มี chart library `MemberActionDialog` อยู่ใน `apps/web/src/pages/organization-members/` | เพิ่ม icon, route, component (`NODE-F005-10` ถึง `NODE-F005-12`) |
| Migration ล่าสุด | `0015_notification_dispatch_exhausted_requires_ack.sql` | F-005 จอง `0016` และ `0017` |
| Env ของ Worker | `apps/worker/src/index.ts:19-26` เรียก `loadEnv()` (มีเพียง `PORT`, `LOG_LEVEL`, `NODE_ENV`) และอ่าน `DATABASE_URL`, `REDIS_URL`, `WORKER_ROLES` จาก `process.env` ตรง | env ใหม่ไปอยู่ใน `loadMonitorEnv()` (`NODE-F005-02`) |
| Redis client | `bun.lock`: `bullmq` 5.81.5 ดึง `ioredis` 5.11.1 | API ใช้ `ioredis` 5.11.1 (`NODE-F005-03`) |
| Compose และ CI | `compose.yaml` เป็น dependency ของ dev เท่านั้นและห้าม production service, `.github/workflows/ci.yml` job `test` มี postgres, redis และรัน `db:migrate` ก่อน `test:coverage`, job `full` (e2e, `security:image`) รันเฉพาะ `workflow_dispatch`, `security:image` scan เฉพาะ API image, `e2e/playwright.config.ts` start Worker ด้วย `consumer,scheduler` | `NODE-F005-P1`, `NODE-F005-P2`, `NODE-F005-15` |


## Acceptance rows ที่ Technical Lead เสนอเพิ่ม

AC-55 ถึง AC-60 (Security, Concurrency, Verification) ที่ Technical Lead เสนอ อยู่ใน Acceptance matrix ของ `feature.md` แล้ว [ตรวจแล้ว 2026-09-29] AC-61 (audit) และ AC-62 (DNS ของ Test และการตรวจตามรอบ) ก็อยู่ใน matrix เช่นกัน spec นี้อ้าง AC เหล่านั้นตามเลขใน `feature.md` และไม่เก็บสำเนา


## Tasks

`READY` หมายถึง dependency พร้อม ไม่ใช่การอนุญาตให้เริ่ม ทุก Task ต้องได้ start authorization จากผู้ใช้ก่อน `COMMIT_MODE: none`

Order and ownership:

| Task | Depends on | Integration owner of shared files |
| ------ | ---------- | --------------------------------- |
| NODE-F005-01 SSRF outbound helper | None | software-engineer (`packages/shared/src/index.ts` ลำดับแรก) |
| NODE-F005-02 Credential helper และ env | None (แก้ `packages/shared/src/index.ts` หลัง 01 merge) | software-engineer (`packages/shared/src/env.ts` ทั้ง Task, `packages/shared/src/logger.ts`) |
| NODE-F005-03 Rate limiter และ Redis ใน API | 02 (`REDIS_URL` ใน env) | software-engineer (`apps/api/src/app.ts` ลำดับแรก, `packages/api-contract/src/health.ts`) |
| NODE-F005-04 Monitor schema และ DB functions | None | software-engineer (`packages/db/src/schema.ts` ลำดับแรก, migration `0016`) |
| NODE-F005-P1 Platform: env, Worker roles, partition runner | 02, 04 | platform-engineer (`scripts/`, `.github/workflows/ci.yml`, `package.json` root ลำดับแรก, `scripts/quality/README.md` ลำดับแรก, runbook) |
| NODE-F005-05 Check executor และ assertions | 01 | software-engineer (`packages/shared/src/monitor-check/`) |
| NODE-F005-06A Monitor API: contract, สิทธิ์, create, edit, pause, resume, delete | 01, 03 (`app.ts`), 04, 05 (type `NormalizedMonitorConfig`) | software-engineer (`packages/api-contract/src/monitor.ts` ลำดับแรก, `packages/api-contract/src/index.ts`, `apps/api/src/app.ts` หลัง 03, `apps/api/src/monitors/`) |
| NODE-F005-06B Monitor API: read models | 06A | ต่อจาก 06A สำหรับ `monitor.ts` และ `apps/api/src/monitors/` |
| NODE-F005-07 Test endpoint | 03, 05, 06B | ต่อจาก 06B |
| NODE-F005-08S Worker scheduler | 02, 04, P1 | software-engineer (`apps/worker/src/index.ts` ลำดับแรก, `apps/worker/src/monitor/scheduler.ts`, `apps/worker/src/monitor/queue.ts`) |
| NODE-F005-08 Worker checker และการบันทึกผล | 05, 08S | ต่อจาก 08S สำหรับ `apps/worker/src/index.ts` และ `queue.ts`, เจ้าของ `checker.ts`, `record-result.ts`, `egress-canary.ts` |
| NODE-F005-09 Monitor notifications | 06A, 08 | software-engineer (migration `0017`, `packages/db/src/schema.ts` หลัง 04, `packages/api-contract/src/notification.ts`, `apps/api/src/notifications/`, `apps/api/src/organization-notifications/service.ts`, `apps/worker/src/monitor/record-result.ts` หลัง 08, `NotificationsPage.tsx`, `NotificationsPopover.tsx`, `OrganizationNotificationSettingsPage.tsx`) |
| NODE-F005-P2 Platform: Worker image และ compose | P1, 08S, 08 | platform-engineer (`apps/worker/Dockerfile`, `compose.worker.yaml`, `package.json` root หลัง P1) |
| NODE-F005-10 Web Overview และ nav | 06B | software-engineer (`apps/web/src/router.tsx` ลำดับแรก, `nav-config.ts`, `icons.tsx`, `apps/web/src/lib/api/monitors.ts` ลำดับแรก, `docs/ref/shell-structure.md`) |
| NODE-F005-11 Web Detail, Pause, Delete | 10 | ต่อจาก 10 สำหรับ `router.tsx` และ `monitors.ts`, เจ้าของ `confirm-dialog.tsx`, การแก้ import ของ F-004, `apps/web/package.json` และ `bun.lock` |
| NODE-F005-12 Web Create, Edit, Test panel | 07, 11 | ต่อจาก 11 สำหรับ `router.tsx` และ `monitors.ts` |
| NODE-F005-13 ค่าลับ (S07): API และ Worker | 02, 07, 08 | ต่อจาก 07 สำหรับ `monitor.ts` และ `apps/api/src/monitors/`, ต่อจาก 08 สำหรับ `checker.ts` |
| NODE-F005-14 ค่าลับ (S07): Web | 12, 13 | ต่อจาก 12 สำหรับฟอร์มและ `monitors.ts` |
| NODE-F005-15 Integration: e2e, docs, integrated verification | ทุก Task ข้างบน | software-engineer (integration owner ของ `e2e/`, `docs/architecture.md` สถานะ Built, `scripts/quality/README.md` หลัง P1 และ P2) |

กฎไฟล์ร่วม:

- ไฟล์ร่วมแก้ทีละ Task ตามลำดับในตาราง ("ลำดับแรก" คือ Task แรกที่แก้ Task ถัดไป rebase หลัง merge) เจ้าของ Task ปัจจุบันถือไฟล์จน handoff ไม่มี sibling แก้ไฟล์เดียวกันใน worktree เดียวกัน
- เริ่มพร้อมกันได้: 01 กับ 04 แล้วตามด้วย 02 (หลัง 01 สำหรับ `index.ts`) migration `0016` เป็นของ 04 และ `0017` เป็นของ 09 เท่านั้น
- `apps/web/src/lib/api/openapi-types.gen.ts` เป็นไฟล์ generate ทุก Task ที่เปลี่ยน route (06A, 06B, 07, 09, 13) รัน `bun run --cwd apps/web codegen` หลัง rebase และไม่แก้ด้วยมือ conflict แก้ด้วยการ generate ใหม่เท่านั้น
- `bun.lock` แก้โดย 03 (`ioredis` ของ API), 11 (visx) และ Task อื่นที่เพิ่ม dependency conflict แก้ด้วย `bun install` หลัง rebase ไม่แก้ด้วยมือ
- งานที่รันพร้อมกันได้หลัง dependency พร้อม: 09 กับ 13 (ไฟล์ไม่ซ้อนนอกจาก generated types), 09 กับ 10 และ 11, P2 กับ web Task ทั้งหมด

Definition of done ของทุก Task (นอกจาก `VERIFY` และ `PROOF` ของแต่ละ Task):

- focused checks ของ package ที่แตะ: `bun run lint`, `bun run typecheck`, unit test ของ package (`bun run --cwd <package> test`), DB test ด้วย `bun run test:integration` เมื่อแตะฐานข้อมูลหรือ Worker, `bun run codegen:check` เมื่อแตะ route
- การเตรียม DB test ในเครื่อง: `bun run db:up`, `bun run db:migrate`, `bun run db:partitions` (หลัง P1) แล้วรัน test ด้วย env จาก `resolveDevEnv()` ใน `scripts/dev-env.mjs` ตาม `scripts/quality/README.md` (ต้องมี `DATABASE_URL`, `DATABASE_OWNER_URL`, `REDIS_URL`) Task ที่เริ่มก่อน P1 merge (01 ถึง 06B) ใช้ key และ `OUTBOUND_TEST_ALLOWED_HOSTS` ที่ test ตั้งเองใน process ไม่ต้องรอ P1
- test ที่เขียนข้อมูลใช้ fixture ที่ไม่ซ้ำต่อ run และลบข้อมูลของตัวเอง
- handoff ระบุ AC ที่ proof ครอบ เป็น author-verified หรือ source-complete ตาม `worker-handoff` ไม่รัน full gate ระหว่างที่ sibling ยังเขียน

### NODE-F005-01 SSRF outbound helper

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`, `security-and-hardening`)
- **READY:** spec อนุมัติและผู้ใช้ให้ start authorization
- **OUTCOME:** helper ที่ส่งคำขอ HTTP(S) ได้เฉพาะไปยัง address สาธารณะ ตาม SSRF helper ในหัวข้อ Authorization and security พร้อมผล TLS ของ hop สุดท้าย, classification ของ error และ `maskUrl()`
- **SOURCE:** Authorization and security (SSRF helper), Jobs (classification), OUT-01, REQ-01
- **INVARIANTS:** ไม่มี IP ใน error ไม่มี dependency ใหม่โดยไม่แจ้ง Technical Lead
- **Spike และทางสำรอง (ขั้นแรกของ Task ส่ง checkpoint ให้ Technical Lead ก่อนเขียน helper จริง)**:
  1. บน Bun 1.3.14 ด้วย local TLS server ที่ใช้ใบรับรองของ CA ทดสอบ พิสูจน์ทั้งห้าข้อ: (a) connect ไปยัง IP ที่ pin พร้อม `servername` เป็น hostname เดิม (b) การตรวจ hostname และ chain ผ่านกับใบรับรองถูกต้องและล้มกับชื่อไม่ตรง (c) `getPeerCertificate()` คืน `issuer` และ `valid_to` (d) `socket.remoteAddress` เท่ากับ IP ที่ pin (e) ยุติ socket หลัง handshake ที่ไม่ผ่านโดย server ไม่ได้รับ byte ของ request ลองตามลำดับ: `node:https.request` พร้อม option `lookup` ที่คืน IP ที่ตรวจแล้ว แล้วจึง `node:tls.connect` ตรง
  2. ถ้า `node:https` ผ่านทั้งห้าข้อ ใช้ `node:https` ถ้าไม่ผ่านแต่ `node:tls.connect` ผ่าน ใช้ทางสำรองที่ผู้ใช้ตัดสิน: HTTP/1.1 client ขนาดเล็กบน `node:tls` (และ `node:net` สำหรับ `http`) ที่ส่ง `Connection: close` และ `Accept-Encoding: identity`, อ่าน status line และ header, รองรับ `Content-Length`, `Transfer-Encoding: chunked` และ body ที่จบเมื่อปิด connection, หยุดอ่านที่ `maxBodyBytes`, ไม่รองรับ HTTP/2, `100 Continue` หรือ keep-alive
  3. ถ้า `node:tls.connect` ไม่ผ่านข้อใดข้อหนึ่ง หยุด Task และรายงานผลต่อข้อ Technical Lead ส่งเรื่องให้ผู้ใช้ตัดสินเรื่อง Node 24 ห้ามเปลี่ยน runtime เอง
  4. checkpoint มีคำสั่งที่รัน, ผลต่อข้อ a ถึง e ของแต่ละทาง และทางที่เลือก
- **FILES:** `packages/shared/src/outbound-http/*`, `packages/shared/src/index.ts`, `packages/shared/package.json` (ถ้าจำเป็น), tests
- **NON-GOALS:** assertion, monitor config, การเรียกใช้จาก API หรือ Worker
- **CONTRACTS:** `validateOutboundUrl(url)`, `sendOutboundRequest({ url, method, headers, body, timeoutMs, maxRedirects, secretHeaderNames, maxBodyBytes })` คืน `{ ok, response?, tls?, failure? }` (`failure.reason` และ `tls.reason` ตาม enum ใน Jobs และ API), `maskUrl(url)`, resolver และ address policy ฉีดได้สำหรับ test เท่านั้น: API และ Worker อ่าน `OUTBOUND_TEST_ALLOWED_HOSTS` (รายการ hostname ของ test harness เช่น `target.nw-test.internal` ไม่รับ IP literal หรือ wildcard) ซึ่ง env schema ของ 02 ปฏิเสธเมื่อ `NODE_ENV=production` การยกเว้นผูกกับ hostname ที่ขอเท่านั้น hostname อื่นที่ resolve ไป address ต้องห้ามเดียวกันยังถูกบล็อก test ของ AC-09, AC-55 และ AC-62 จึงใช้ hostname ที่ไม่อยู่ในรายการ ไม่มีทางปิด SSRF helper ทั้งหมด
- **VERIFY:** `bun run --cwd packages/shared test` บน Bun 1.3.14:
  - unit test ของทุกช่วง address ทั้งค่าแรกและค่าสุดท้ายของช่วง, parser normalization (`0x7f.1`, `2130706433`, `017700000001`, `[::ffff:127.0.0.1]`, `[::ffff:7f00:1]`), `localhost` และ `a.localhost`
  - URL: userinfo, scheme `ftp` และ `file`, ยาว 2,048 ผ่าน 2,049 ไม่ผ่าน, port 80, 443, 1024, 65535 ผ่าน และ 22, 1023 ไม่ผ่าน
  - integration test ด้วย local HTTP/TLS server และ DNS stub: DNS ที่คืน address สาธารณะหนึ่งตัวกับ private หนึ่งตัวถูกปฏิเสธ, DNS ที่เปลี่ยนคำตอบระหว่าง validate กับ connect ไม่ทำให้ connect ไป address ใหม่
  - redirect: 5 hop ผ่าน 6 hop ได้ `redirect_limit`, loop ได้ `redirect_limit`, `http` → `https` ผ่าน, `https` → `http` และไป address ต้องห้ามได้ `redirect_blocked`, redirect ไป host อื่นตัด header ลับ, `http` → `https` host เดิมคง header ลับ
  - TLS: หมดอายุ, ชื่อไม่ตรง, self-signed, CA ไม่รู้จักได้ `tls_invalid` พร้อม `tlsReason` และไม่มี byte ของคำขอถึง server, ใบรับรองถูกต้องคืน issuer และ `notAfter` ของ hop สุดท้าย
  - header ต้องห้ามและ CR/LF ถูกปฏิเสธ, timeout รวมทุก hop, body เกิน `maxBodyBytes` หยุดอ่าน, error ไม่มี IP
- **PROOF:** ผล spike พร้อมคำสั่งที่รัน, ผล test ต่อรายการ, listener ที่ยืนยันว่าไม่มีการเชื่อมต่อไป address ต้องห้าม
- **COVERS:** AC-09 (address policy ที่ save ใช้), AC-28 (URL, port), AC-29 (header ต้องห้าม, CR/LF), AC-34, AC-35 (TLS), AC-42 (mask helper), AC-55, AC-62 (resolve ใหม่และ connection-time check)

### NODE-F005-02 Credential helper และ env

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`, `security-and-hardening`)
- **READY:** spec อนุมัติและ start authorization แก้ `packages/shared/src/index.ts` หลัง 01 merge
- **OUTCOME:** `encryptSecret({ tenantId, monitorId, slot, value })` และ `decryptSecret(...)` ตาม Credential helper พร้อม `monitorEnvSchema` และ `loadMonitorEnv()` ใหม่ใน `packages/shared/src/env.ts` ที่ทั้ง API และ Worker เรียก ([ตรวจแล้ว] Worker เรียก `loadEnv()` ซึ่งมีเพียง `PORT`, `LOG_LEVEL`, `NODE_ENV` และอ่าน `DATABASE_URL`, `REDIS_URL`, `WORKER_ROLES` จาก `process.env` ตรงใน `apps/worker/src/index.ts:19-26` จึงไม่มี schema เดิมให้เพิ่ม) ครอบ env ทั้งหมดของ F-005: `CREDENTIAL_ENCRYPTION_KEYS`, `CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION`, `REDIS_URL` (ให้ API), `MONITOR_EGRESS_CANARY_URLS` (optional, รายการ URL คั่นด้วย comma), `OUTBOUND_TEST_ALLOWED_HOSTS` (optional, ถ้าตั้งค่าเมื่อ `NODE_ENV=production` ให้ startup ล้ม)
- **SOURCE:** Authorization and security (Credential helper), Jobs (Classification), DB-14, JOB-05
- **INVARIANTS:** ไม่ log ค่าหรือ key, production ไม่มี key ให้ startup ล้ม, dev มี key ที่ระบุว่าใช้ใน dev เท่านั้นแบบ `DEV_BETTER_AUTH_SECRET`, `REDACT_PATHS` ครอบ `headers.*.value`, `secrets`, `auth` ของ monitor
- **FILES:** `packages/shared/src/credentials.ts`, `packages/shared/src/env.ts`, `packages/shared/src/index.ts`, `packages/shared/src/logger.ts` (`REDACT_PATHS`), tests
- **NON-GOALS:** re-encrypt, KMS, Redis client
- **CONTRACTS:** ชื่อ env ทั้งห้าตัวและ `loadMonitorEnv()` ส่งให้ 03, 06A, 07, 08S, 08, 15 และ P1
- **VERIFY:** round trip, AAD ผิดถอดไม่ได้, key version เก่ายังถอดได้, key ผิดขนาดถูกปฏิเสธที่ startup, production ไม่มี key แล้ว `loadMonitorEnv` ล้ม, `OUTBOUND_TEST_ALLOWED_HOSTS` คู่กับ `NODE_ENV=production` แล้ว `loadMonitorEnv` ล้ม, `OUTBOUND_TEST_ALLOWED_HOSTS` ที่มี IP literal หรือ wildcard ถูกปฏิเสธ, `loadEnv` และ `loadAuthEnv` เดิมไม่เปลี่ยนพฤติกรรม, logger redact ค่าในตัวอย่าง payload
- **PROOF:** ผล unit test และตัวอย่าง log ที่ redact แล้ว
- **COVERS:** AC-56 (primitive)

### NODE-F005-03 Rate limiter และ Redis ใน API

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`, `security-and-hardening`)
- **READY:** 02 handoff ผ่าน review (`REDIS_URL` อยู่ใน env schema)
- **OUTCOME:** API มี Redis client, sliding-window limiter ตาม Rate limit และ readiness ที่ ping Redis (OPS-02)
- **SOURCE:** Authorization and security (Rate limit), REQ-04, OPS-02
- **INVARIANTS:** timeout 2 s, ไม่แตะ login throttling ของ Better Auth, readiness อ้างเฉพาะสิ่งที่ตรวจจริง, Redis client ใช้ `ioredis` 5.11.1 ซึ่งเป็น dependency ของ `bullmq` 5.81.5 อยู่แล้ว ([ตรวจแล้วใน `bun.lock`]) ประกาศเป็น direct dependency ของ API ที่ `5.11.1` ไม่เพิ่ม library ใหม่
- **FILES:** `apps/api/src/rate-limit/*`, `apps/api/src/app.ts` (readiness), `apps/api/package.json`, `bun.lock`, `packages/api-contract/src/health.ts`, tests
- **NON-GOALS:** นำ limiter ไปใช้กับ route อื่น
- **CONTRACTS:** `consumeRateLimit({ key, limit, windowMs })` คืน `{ allowed, retryAfterSeconds }` หรือ throw `RATE_LIMIT_UNAVAILABLE`
- **VERIFY:** integration test กับ Redis จริง (`REDIS_URL` จาก CI หรือ `bun run db:up`): ที่ขีด, เกินขีด, window เลื่อน (ใช้ clock ที่ฉีดได้ ไม่รอ 60 s จริง), key ต่อผู้ใช้และต่อ Organization แยกกัน, Redis หยุด, Redis หน่วงเกิน 2 s (proxy ที่หน่วงหรือ `CLIENT PAUSE`) ได้ `RATE_LIMIT_UNAVAILABLE`, readiness ล้มเมื่อ Redis ลงและผ่านเมื่อขึ้น, test เดิมของ `health.ts` ปรับตาม readiness ใหม่
- **PROOF:** ผล test และ response ของ readiness เมื่อ Redis ขึ้นและลง
- **COVERS:** AC-11 (server), AC-57 (limiter failure)

### NODE-F005-04 Monitor schema และ DB functions

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`, `security-and-hardening`)
- **READY:** spec อนุมัติและ start authorization
- **OUTCOME:** migration `0016_uptime_monitors.sql`, Drizzle schema และ helper ใน `packages/db` ตาม Data
- **SOURCE:** Data, DB-01 ถึง DB-12
- **INVARIANTS:** ไม่แก้ migration เดิม, ตารางผลตรวจและ rollup เป็น partition รายเดือน, function ทุกตัวมี owner เฉพาะและ `search_path` คงที่, runtime role ไม่ได้สิทธิ์ owner
- **FILES:** `packages/db/migrations/0016_uptime_monitors.sql`, `packages/db/src/schema.ts`, `packages/db/src/monitor.ts`, `packages/db/src/index.ts`, `*.db.test.ts`
- **NON-GOALS:** notification columns (09), API, Worker
- **CONTRACTS:** ชื่อตาราง, `claim_due_monitor_checks`, `purge_expired_monitor_data`, `ensure_monitor_partitions`
- **VERIFY:** `bun run db:migrate` บน database ใหม่, DB test แบบ A-only, B-only, A+B ต่อทุกตาราง, insert `monitors` กับ `monitor_schedule` ด้วย runtime role ใน tenant context, claim พร้อมกันสอง connection ไม่ได้แถวซ้ำ, claim ตั้ง `next_check_at = now() + interval_seconds` และ `claimed_until = now() + timeout_seconds + 60 s` จาก `monitor_schedule`, lease ที่หมดอายุถูก claim ใหม่ได้, purge ไม่ลบ incident เปิด, partition function สร้างและ drop ถูกเดือน, ลบ monitor แล้ว `monitor_secrets`, `monitor_schedule` และข้อมูลลูก cascade หมด, runtime role `select` `monitor_schedule` ใน context ของ A ไม่เห็นแถวของ B และเรียก `ensure_monitor_partitions` ไม่ได้, purge กับผลอายุ 29 และ 31 วัน, incident ปิดแล้ว 29 และ 31 วัน, incident เปิดอายุ 40 วัน (ลบเฉพาะที่เกิน 30 วันและปิดแล้ว), purge ทีละไม่เกิน `p_limit` แถว
- **PROOF:** ผล `bun run test:integration` ของ package และ query ของ `pg_policy`, `pg_proc`, grants
- **COVERS:** AC-41 (purge), AC-46 (cascade), AC-58

### NODE-F005-P1 Platform: env, Worker roles, partition runner

- **OWNER:** platform-engineer (โหลด `worker-handoff`, `debugging-and-error-recovery` เมื่อ setup ล้ม)
- **READY:** ชื่อ env จาก 02 และ `ensure_monitor_partitions` จาก 04
- **OUTCOME:** dev, CI และ e2e มี `CREDENTIAL_ENCRYPTION_KEYS`, `CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION`, `REDIS_URL` ของ API, `MONITOR_EGRESS_CANARY_URLS`, `OUTBOUND_TEST_ALLOWED_HOSTS` (CI และ e2e เท่านั้น) และ `WORKER_ROLES` ที่รวม `monitor-scheduler`, `monitor-checker` มีคำสั่ง `bun run db:partitions` ที่ใช้ `DATABASE_OWNER_URL` รันหลัง `db:migrate` ทุก environment มี runbook ของการหมุน key และวิธีรัน Worker role ใหม่
- **SOURCE:** Data (partition), Jobs, DB-09, SYS-02
- **สภาพที่ตรวจแล้ว (2026-09-29)**:
  - `compose.yaml` มีเฉพาะ dependency ของ dev (`postgres:17.11-alpine`, `mailpit`, `redis:7.4.7-alpine`) จัดการผ่าน `bun run db:*` (`scripts/db.mjs`) และหัวไฟล์ห้ามเพิ่ม production service Redis สำหรับ API จึงมีอยู่แล้ว ไม่ต้องแก้ `compose.yaml`
  - `scripts/dev-env.mjs:58` ตั้ง `REDIS_URL` ให้ dev แล้ว
  - `.github/workflows/ci.yml`: job `test` (unit + integration ผ่าน `bun run test:coverage`) มี service postgres และ redis, env `DATABASE_URL`, `DATABASE_OWNER_URL`, `REDIS_URL` และรัน `bun run db:migrate` ก่อน test job `full` (e2e + `security:image`) รันเฉพาะ `workflow_dispatch` และรัน `bun run --cwd apps/api provision-e2e-fixture`
  - `e2e/playwright.config.ts:60-66` start Worker ด้วย `WORKER_ROLES: "consumer,scheduler"`
  - `security:image` ใน `package.json` root build และ scan เฉพาะ `apps/api/Dockerfile`
  - `scripts/dev.mjs` รัน `turbo run dev` และอ่าน secret จาก `.env.compose.local` ที่ `bun run db:up` เขียน, `apps/worker/package.json` script `dev` ตั้ง `WORKER_ROLES=consumer,scheduler` ตายตัว (role ใหม่ใน dev จึงเป็นงานของ `NODE-F005-08`)
  - ยังไม่ได้ตรวจ: เนื้อหาและตัวสร้างของ `.env.compose.local` ใน `scripts/db.mjs` (P1 ต้องอ่านก่อนเพิ่ม key ของ dev)
- **INVARIANTS:** ไม่มี key จริงใน repo, CI ใช้ค่าที่สร้างใน job (แบบ "Generate development secret" เดิม) หรือ secret ของ CI, ไม่ deploy, ไม่สร้าง infrastructure ใหม่นอก repo, ไม่เพิ่ม service ใน `compose.yaml`
- **FILES:** `scripts/dev-env.mjs` (key ของ dev, canary), `scripts/db.mjs` (ถ้า key ของ dev ต้องเขียนลง `.env.compose.local`), `scripts/partitions.mjs` (ใหม่, ใช้ `DATABASE_OWNER_URL`), `package.json` root (script `db:partitions`), `.github/workflows/ci.yml` (job `test` และ `full`: env ใหม่และ `bun run db:partitions` หลัง `db:migrate`), `scripts/quality/README.md`, runbook ใน `docs/` (การหมุน key, role ของ Worker)
- **NON-GOALS:** Worker image (`NODE-F005-P2`), `e2e/playwright.config.ts` (`NODE-F005-15`), network egress control ของ production (dependency ใน Design decisions)
- **CONTRACTS:** ชื่อ env และคำสั่ง `db:partitions` ให้ 08S, 08, 15 และ integrated verification
- **VERIFY:** `bun run db:up && bun run db:migrate && bun run db:partitions` บน database ใหม่ แล้วมี partition ของเดือนก่อน เดือนปัจจุบัน และล่วงหน้า 3 เดือน รันซ้ำไม่ error, runtime role เรียก function ไม่ได้, dev มี env ครบตาม `loadMonitorEnv()`, diff ของ `ci.yml` ให้ job `test` และ `full` มี env ครบและ `OUTBOUND_TEST_ALLOWED_HOSTS` ไม่อยู่ใน job `build`
- **PROOF:** log ของคำสั่ง, diff ของ workflow, ผล CI run ถ้าผู้ใช้อนุญาตให้ push
- **COVERS:** AC-60 (partition ล่วงหน้า)

### NODE-F005-05 Check executor และ assertions

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`, `security-and-hardening`)
- **READY:** 01 handoff ผ่าน review
- **OUTCOME:** `runCheck(config, secrets)` ใน `packages/shared/src/monitor-check/` ที่สร้างคำขอ ส่งผ่าน SSRF helper ประเมิน expected status และ assertion ทั้งสามชนิด redact และตัดค่า แล้วคืน result shape ตาม API
- **SOURCE:** Jobs (Check executor, Classification), API (Check result view)
- **INVARIANTS:** ไม่เก็บ body เต็ม, ค่าลับถูกแทนก่อนตัด, `not_evaluated` เมื่อไม่มี response, GET และ HEAD ไม่ส่ง body
- **FILES:** `packages/shared/src/monitor-check/*`, `packages/shared/src/index.ts`, tests
- **NON-GOALS:** การบันทึกผล, rate limit, egress canary (อยู่ใน 08)
- **CONTRACTS:** `runCheck(normalizedConfig, secrets, deps)` โดย `deps` ฉีด resolver, clock และ address policy ได้, type `NormalizedMonitorConfig` (ranges และ `pathSegments` ที่ parse แล้ว), `sslLevel(notAfter, now)` ตามสูตร SSL level ใน API (ใช้โดย 06B, 08, 09), enum `assertions[].reason` และ `tlsReason` parser อยู่ใน contract ของ 06A ไม่อยู่ใน Task นี้
- **VERIFY:** response แต่ละแบบต่อ assertion แต่ละชนิดตาม AC-33 ด้วย config ที่ normalize แล้ว: 204, body ไม่ใช่ JSON, path ไม่พบ, หลายค่า, ชนิดไม่ตรง (`"1"` กับ `1`), expected ที่เป็นข้อความธรรมดา, charset ที่ไม่รองรับ, body เกิน 1 MiB (`evaluatedFromPrefix`), endpoint ที่สะท้อน header และ Basic credential, status นอก ranges, response time เท่ากับ threshold ไม่ผ่านและน้อยกว่าผ่าน, `sslLevel` ที่เหลือ 30 วันพอดี, 30 วันกับ 1 วินาที, 7 วันพอดี, 7 วันกับ 1 วินาที, 1 วินาที, 0 และติดลบ, ค่าจริงยาว 200 และ 201 ตัวอักษร, ไม่มี response แล้ว assertion ทุกข้อเป็น `not_evaluated` `no_response`
- **PROOF:** ตาราง test ต่อกรณีใน AC-32, AC-33, AC-43
- **COVERS:** AC-10 (classification), AC-17 (ตัดค่า), AC-32, AC-33 (evaluate), AC-43 (primitive), AC-05 และ AC-36 (สูตร SSL level)

### NODE-F005-06A Monitor API: contract, สิทธิ์, create, edit, pause, resume, delete

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`, `security-and-hardening`)
- **READY:** 01, 03, 04, 05 handoff ผ่าน review
- **OUTCOME:** `packages/api-contract/src/monitor.ts` (config schema พร้อมค่าเริ่มต้น, parser `parseExpectedStatus`, `parseJsonPath`, `parseExpectedValue`, กฎ URL และรายการ header ต้องห้ามแบบ browser-safe, constant ขีดจำกัด, error code, view schema ทั้งหมดที่ 06B ใช้), การเก็บ config แบบ normalize ตาม "Parse กับ evaluate แยกกันตาม PKG-01", permission map, error hook `MONITOR_INVALID`, audit helper และ route Create, Edit, Pause, Resume, Delete ที่ทำงานพร้อม uniform not-found, version conflict, monitor limit, save-time SSRF check, schedule และ `monitor_events` ตาม Scheduling กรณีพิเศษ ไม่รวมค่าลับ
- **SOURCE:** API, Data, Jobs (Scheduling กรณีพิเศษ), Authorization and security, Concurrency
- **INVARIANTS:** membership และ permission ก่อน lookup, `MONITOR_NOT_FOUND` เหมือนกันทั้งสามแบบ, ไม่มี network call ใน transaction, Pause และ Delete ล้าง claim, field ที่กระทบการตรวจตามรายการใน Scheduling กรณีพิเศษเท่านั้นที่เพิ่ม `check_config_version`, ลำดับ lock ตาม Concurrency, audit หลัง commit เฉพาะเมื่อ state เปลี่ยน, config ใน response แสดงค่า query และ body ให้ทุก role ที่อ่านได้ (OD-23 ผู้ใช้ตัดสิน 2026-09-29: ไม่ใช่ค่าลับ ไม่ขยาย S3)
- **FILES:** `apps/api/src/monitors/{contract,routes,service,permissions,audit,invalid-input}.ts`, `apps/api/src/app.ts` (register, path normalization), `packages/api-contract/src/monitor.ts`, `packages/api-contract/src/index.ts`, generated types, tests
- **NON-GOALS:** read models (06B), Test endpoint (07), ค่าลับ (13), notification (09)
- **CONTRACTS:** OpenAPI ของ write route, `monitorConfigSchema`, view schema, constant ของขีดจำกัด, error code, `auditMonitorMutation`
- **VERIFY:** HTTP/DB test ด้วย `bun run test:integration`:
  - role × operation: `owner`, `admin` สำเร็จ, `viewer`, `auditor` ได้ `403 PERMISSION_DENIED` ไม่มีแถวเปลี่ยน, non-member และ Organization ที่ไม่มีจริงได้ `403 MEMBERSHIP_DENIED` body เหมือนกัน
  - id ไม่มี, `not-a-uuid`, id ของ Organization อื่น ได้ `404 MONITOR_NOT_FOUND` body เหมือนกันใน Edit, Pause, Resume, Delete
  - validation ทุก `reason` รวมค่าขอบ: URL 2,048 ผ่าน 2,049 ไม่ผ่าน, port 443, 1023, 1024, 65535, userinfo, scheme `ftp`, header และ query 20 ผ่าน 21 ไม่ผ่าน, ชื่อ 256 และ 257, ค่า 4 KiB และเกิน, body 64 KiB และเกิน, assertion 10 และ 11, timeout 1, 30, 31, `HEAD` กับ body assertion, header ซ้ำและต้องห้าม, CR/LF, error ไม่มีค่า input
  - AC-09: `MONITOR_TARGET_BLOCKED` เมื่อ host เป็น IP literal ต้องห้าม (`127.0.0.1`, `[::1]`, `169.254.169.254`, `10.0.0.1`) และเมื่อ hostname resolve ไป address ต้องห้ามด้วย DNS stub (hostname ที่ไม่อยู่ใน `OUTBOUND_TEST_ALLOWED_HOSTS`), body ไม่มี IP, ไม่มีแถวใหม่ และ listener บน `127.0.0.1` ไม่เห็นการเชื่อมต่อ
  - Create ครั้งที่ 50 ผ่าน 51 ได้ `409 MONITOR_LIMIT_REACHED`, สองคำขอพร้อมกันที่ 49 ได้ผ่านหนึ่ง, `clientRequestId` ซ้ำคืนตัวเดิมและ audit หนึ่งรายการ
  - Edit พร้อมกันสอง session ได้ `409` หนึ่งฝั่ง, แก้ชื่ออย่างเดียวไม่เปลี่ยน `check_config_version`, แก้ URL เพิ่ม version เขียน `config_changed` พร้อม URL แบบ mask, แก้ interval ตั้ง `next_check_at` ตามสูตรและอัปเดต `monitor_schedule.interval_seconds`, แก้ timeout อัปเดต `monitor_schedule.timeout_seconds` และเพิ่ม `check_config_version`, Edit ส่ง `expected_status_text` และข้อความ assertion เดิมกลับมาใน Detail
  - Create และ Resume ตั้ง `next_check_at = now()`, Pause ขณะมี incident ปิดด้วย `paused_by_user`, Pause ซ้ำและ Resume ซ้ำคืนสถานะปัจจุบันไม่มี audit ซ้ำ, Delete ซ้ำได้ `404`
  - audit log หนึ่งรายการต่อ mutation ที่สำเร็จ มี `actorUserId`, action, `organizationId`, `monitorId` ไม่มี URL หรือ config, ไม่มีเมื่อถูกปฏิเสธ, logger ที่ throw ไม่ทำให้ mutation ล้ม
  - log ที่จับได้มี path แบบ template ไม่มี monitor id, `/monitors/test` ไม่ถูกแทนเป็น `:monitorId`
  - parser ของ contract: expected status `200-299,301` ผ่าน, `99`, `600`, `300-200`, รูปแบบผิดและ 11 ช่วงถูกปฏิเสธ, JSONPath `$.a['b'][0]` ผ่าน และ filter, wildcard, `..` ถูกปฏิเสธ, `parseExpectedValue` ของ `1`, `true`, `null`, `"1"`, `ok`, response time threshold เท่ากับ timeout ผ่านและมากกว่าถูกปฏิเสธ
  - แถว `monitors` เก็บ ranges และ `pathSegments` ที่ normalize แล้ว, test เทียบรายการ header ต้องห้ามและกฎ port ของ contract กับของ `packages/shared` ว่าตรงกัน
- **PROOF:** ตาราง role × operation พร้อม status และ code, แถวในฐานข้อมูลหลังแต่ละกรณี, log ที่จับได้
- **COVERS:** AC-02 (API write), AC-03 (API ยกเว้น Test), AC-06 (ค่าเริ่มต้น), AC-09 (save: resolve ตรง), AC-16 (ขีดจำกัด, JSONPath, expected), AC-18 (API), AC-19 (API), AC-28 (save), AC-29 (save), AC-30 (parser และ save), AC-31, AC-40 (API), AC-48 (write), AC-49 (API), AC-50 (API), AC-54 (schedule), AC-57 (write), AC-59 (create, edit), AC-61 (monitor mutation)

### NODE-F005-06B Monitor API: read models

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`, `security-and-hardening`)
- **READY:** 06A handoff ผ่าน review
- **OUTCOME:** route List, Recent events, Detail, Checks, Incidents, Response times ที่คำนวณ health, freshness, SSL level, uptime, coverage, gap และ URL แบบ mask ตาม API และ Jobs
- **SOURCE:** API, Jobs (State และ health, Uptime และ coverage), Data
- **INVARIANTS:** health ตามลำดับ 7 ขั้นโดยใช้ `now()` ของฐานข้อมูล, SSL level ใช้ `sslLevel` จาก 05, `summary` ไม่ขึ้นกับตัวกรองและรวมเท่า `total`, query ใช้ index ของ `(monitor_id, scheduled_for)` และ rollup ไม่อ่านผลดิบเกิน 24 ชม., ลำดับและตัวกรองจาก allow-list, register `GET /monitors/recent-events` ก่อน `GET /monitors/{monitorId}` เพราะ `monitorId` เป็น string (ตาม AC-48) และจะจับ `recent-events` ถ้าลำดับกลับกัน มี test ยืนยัน
- **FILES:** `apps/api/src/monitors/{read-routes,read-service,health,uptime}.ts`, `packages/api-contract/src/monitor.ts` (ถ้าต้องปรับ view), generated types, tests
- **NON-GOALS:** write route, การเขียนผลตรวจ (08)
- **CONTRACTS:** response ตาม API สำหรับ 10 และ 11
- **VERIFY:** DB/HTTP test ด้วย fixture ที่เขียนตรงลงตาราง (ไม่ต้องมี Worker):
  - health ทั้ง 7 ขั้น: ยังไม่ตรวจ, ผลอายุเท่ากับ `2 × interval` พอดี (ยังสด) และเกิน 1 s (เก่า) ทั้งขณะปกติและขณะมี incident (`lastKnownDown`), `check_error` ล่าสุด, ผ่าน/ล้ม (up + 1), ล้มครั้งแรกของ config ใหม่ (unknown + 1), หลังแก้ config ที่มี incident เปิด, หยุด
  - SSL ที่เหลือ 30 วันพอดี, 30 วันกับ 1 วินาที, 7 วันพอดี, 7 วันกับ 1 วินาที และหมดอายุ ใน List และ Detail
  - uptime และ coverage: monitor อายุ 2 ชม. ในช่วง 30 วัน, ช่วงหยุด 1 ชม., `check_error` ไม่นับ, ไม่มีผลเลยได้ `null`, fixture คำนวณมือ
  - response times: gap จาก Worker หยุด 10 นาที, ช่วงหยุด, bucket รายชั่วโมงที่ว่าง, `configChanges` เมื่อ URL เปลี่ยน
  - checks page มี `urlChanges` และ `url` แบบ mask ไม่มีค่า query
  - role ทุกตัวอ่านได้, non-member ได้ `MEMBERSHIP_DENIED` ไม่มีชื่อ URL หรือจำนวน, id สามแบบได้ `MONITOR_NOT_FOUND` เหมือนกัน
  - List กรอง `health` และ `q` ที่มี `%` และ `_` แล้ว `summary` ไม่เปลี่ยน
- **PROOF:** ตาราง fixture กับค่าที่คาดและค่าที่ได้, ตาราง role × route
- **COVERS:** AC-02 (API read), AC-05 (data), AC-12 (health), AC-14, AC-15 (data), AC-18 (urlChanges), AC-41 (coverage), AC-42 (response), AC-48 (read), AC-40 (health หลังแก้), AC-54 ("รอตรวจครั้งแรก")

### NODE-F005-07 Test endpoint

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`, `security-and-hardening`)
- **READY:** 03, 05, 06B handoff ผ่าน review
- **OUTCOME:** `POST /monitors/test` และ `POST /monitors/{monitorId}/test` ที่ตรวจ membership และ permission แล้ว validation และ normalize ด้วย parser ของ contract (แบบเดียวกับ 06A) แล้ว rate limit แล้วรัน `runCheck` ของ shared หนึ่งครั้ง และไม่เขียนฐานข้อมูล
- **SOURCE:** API (Test), Authorization and security (Rate limit), REQ-01, REQ-04
- **INVARIANTS:** ไม่มีแถวใหม่ในตารางใด, ไม่มีคำขอออกเมื่อ denied, validation ไม่ผ่าน, rate-limited หรือ limiter ล้ม, ผลของเป้าหมายคืน `200` ส่วน error ของบริการใช้ envelope, validation ไม่ผ่านไม่กินโควตา rate limit
- **FILES:** `apps/api/src/monitors/test-route.ts`, `apps/api/src/monitors/routes.ts`, `packages/api-contract/src/monitor.ts`, generated types, tests
- **NON-GOALS:** ใช้ค่าลับที่เก็บไว้ (13)
- **CONTRACTS:** `monitorTestResultSchema`
- **VERIFY:** HTTP test ด้วย local target และ DNS stub:
  - role: `viewer`, `auditor` ได้ `403` และ listener ไม่เห็นคำขอ
  - ครั้งที่ 10 ภายใน 60 s ต่อผู้ใช้ผ่าน ครั้งที่ 11 ได้ `429` พร้อม `retryAfterSeconds` และ `Retry-After`, ผู้ใช้สามคนใน Organization เดียวรวมครั้งที่ 31 ได้ `429`, หลัง window เลื่อนผ่านอีกครั้ง
  - Redis หยุดและ Redis หน่วงเกิน 2 s ได้ `503 RATE_LIMIT_UNAVAILABLE` ไม่มีคำขอออก
  - URL ผิดแต่ละแบบใน AC-28 และค่าผิดใน AC-29 ได้ `MONITOR_INVALID` ไม่มีคำขอออก
  - ผลของเป้าหมาย: 200 ผ่าน, 503, timeout ที่ timeout 1 s และ 10 s, DNS ไม่พบ, TLS หมดอายุ, redirect 6 hop, redirect `https` → `http`, redirect ไป address ต้องห้าม (`redirect_blocked`) ทุกแบบคืน `200` พร้อม `failureReason` และ assertion `not_evaluated` เมื่อไม่มี response
  - AC-62: บันทึก monitor ที่ host resolve ไป address สาธารณะ แล้วเปลี่ยน DNS stub ให้คืน `127.0.0.1` ก่อน `POST /monitors/{id}/test` ได้ `blocked_address` ไม่มี IP ใน body และ listener บน `127.0.0.1` ไม่เห็นการเชื่อมต่อ
  - `POST /monitors/{id}/test` กับ id สามแบบใน AC-48 ได้ `404` เหมือนกัน
  - นับแถวทุกตาราง monitor ก่อนและหลังเท่ากัน, `bun run codegen:check`
- **PROOF:** จำนวนคำขอที่ listener เห็นต่อกรณี, ตารางไม่มีแถวใหม่
- **COVERS:** AC-03 (Test), AC-08, AC-10, AC-11, AC-28 (Test), AC-29 (Test), AC-32 (Test), AC-34 (Test), AC-48 (Test), AC-57, AC-62 (Test)

### NODE-F005-08S Worker scheduler

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`, `security-and-hardening`)
- **READY:** 02, 04 และ P1 handoff ผ่าน review
- **OUTCOME:** role `monitor-scheduler` ใน `WORKER_ROLES` ที่ทุก `MONITOR_SCHEDULER_INTERVAL_MS = 10_000` เรียก `claim_due_monitor_checks(10)` ซ้ำได้ถึง 50 batch, enqueue ลง queue `monitor-check` ด้วย job id ตาม Jobs และ `attempts: 1`, เรียก `purge_expired_monitor_data(500)`, log warning เมื่อ partition ล่วงหน้าน้อยกว่า 2 เดือน (อ่าน `pg_inherits` ด้วย runtime role) และหยุดก่อน checker เมื่อ SIGTERM
- **SOURCE:** Jobs (Worker role, Payload, Scheduling กรณีพิเศษ, Shutdown), JOB-02, JOB-03, JOB-06
- **INVARIANTS:** ไม่ถือ transaction ระหว่าง enqueue, payload มีเฉพาะ 5 field ใน Jobs, ไม่ใช้ owner role, interval และ clock ฉีดได้ใน test แต่ค่าคงที่ใน production คือ 10 s, ใช้ `#running` guard แบบ `dispatch.ts` กันรอบซ้อน
- **FILES:** `apps/worker/src/index.ts` (parse role ใหม่, shutdown order), `apps/worker/src/monitor/scheduler.ts`, `apps/worker/src/monitor/queue.ts` (ชื่อ queue, job id, payload type), tests
- **NON-GOALS:** การตรวจและการบันทึกผล (08)
- **CONTRACTS:** `MonitorCheckJob` payload type และ `monitorCheckJobId()` ใน `queue.ts` ที่ 08 ใช้
- **VERIFY:** `bun run test:integration` ของ Worker: สอง scheduler พร้อมกันไม่ enqueue ซ้ำ (job id เดียวกันและ claim ไม่ซ้ำ), Redis หยุดระหว่าง enqueue แล้ว lease หมดอายุและ claim ใหม่ในรอบถัดไป, Worker หยุด 10 นาทีแล้วกลับมาได้ job ใหม่หนึ่งงานต่อ monitor ไม่ยิงย้อนหลัง, monitor ที่หยุดไม่ถูก claim, purge ถูกเรียกทุกรอบ, test ที่ยืนยันค่าคงที่ 10 s, SIGTERM หยุด scheduler ก่อน, `WORKER_ROLES` ที่มี role ไม่รู้จักยังล้มเหมือนเดิม
- **PROOF:** แถว `monitor_schedule` และ job ใน queue หลังแต่ละ scenario
- **COVERS:** AC-19 (หยุดแล้วไม่ถูก claim), AC-37 (scheduler), AC-41 (เรียก purge), AC-54 (next poll), AC-60 (partition warning)

### NODE-F005-08 Worker checker และการบันทึกผล

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`, `security-and-hardening`)
- **READY:** 05 และ 08S handoff ผ่าน review
- **OUTCOME:** role `monitor-checker` ตาม Jobs ที่ตรวจ บันทึกผล (รวม `url_masked`), rollup, state, incident, SSL state, `check_error` และ egress canary
- **Checkpoint ภายใน Task** (ส่ง checkpoint สั้นให้ Technical Lead หลังแต่ละข้อ ไม่ใช่ handoff): (1) transaction A และ B พร้อม conditional update, insert ผลแบบ idempotent และการทิ้งผลที่มาช้า (2) state, streak, incident และ rollup (3) SSL state, classification `check_error`, egress canary และ shutdown ของ checker
- **SOURCE:** Jobs, Concurrency, Data (functions), JOB-01, JOB-05, JOB-07
- **INVARIANTS:** ค่าที่ถอดรหัสไม่ออกนอกหน่วยความจำ, conditional update ก่อนเขียนผล, ลำดับ lock ตาม Concurrency, ไม่ใช้ owner role, ทุกคำขอออกรวม canary ผ่าน SSRF helper, canary, DNS resolver และ clock ฉีดได้ใน test (CI อาจไม่มี internet)
- **FILES:** `apps/worker/src/index.ts` (register checker หลัง 08S), `apps/worker/src/monitor/{checker,record-result,egress-canary}.ts`, `apps/worker/package.json` (script `dev` เปลี่ยนเป็น `WORKER_ROLES=consumer,scheduler,monitor-scheduler,monitor-checker`), tests
- **NON-GOALS:** notification intent (09 เพิ่มใน `record-result.ts` หลัง handoff), ค่าลับจาก API (13) ส่วนการถอดรหัสและ `secret_decrypt_failed` อยู่ใน Task นี้โดยใช้ fixture ciphertext
- **CONTRACTS:** จุดต่อ `onMonitorEvent(tx, event)` ใน `record-result.ts` ที่ 09 ใช้ (event: `incident_opened`, `incident_closed { endReason }`, `ssl_level_entered { level, host, notAfter }`), SSL state ต่อ `(ssl_host, ssl_not_after)`
- **VERIFY:** Worker integration test ด้วย `bun run test:integration`, local target และ DNS stub:
  - Create แล้ว (scheduler interval ที่ฉีดเป็น 1 s) ผลแรกเกิดใน poll ถัดไป, Resume เช่นเดียวกัน (AC-54)
  - สอง checker พร้อมกันได้ผลหนึ่งแถวต่อ `scheduled_for`, job ซ้ำ id เดิมไม่ได้ผลที่สอง, kill checker กลางการตรวจแล้ว lease หมดอายุ ไม่มีผลครึ่งทาง, SIGTERM รอ job ที่ทำงานอยู่ไม่เกิน 30 s, job ที่ล้มไม่ถูก retry
  - Pause, Delete และ Edit ที่กระทบการตรวจ ระหว่างเป้าหมายตอบช้า 5 s: ไม่มีผล incident หรือ event
  - ลำดับ ผ่าน/ล้ม/ล้ม/ผ่าน เปิดและปิด incident, ผ่าน/ล้ม/ผ่าน ไม่เปิด, ล้ม/ล้ม ตั้งแต่ครั้งแรกเปิด incident, ผ่าน/`check_error`/ล้ม ได้ streak 1
  - ค่าลับถอดไม่ได้และ canary ล้มได้ `check_error` ไม่มี incident, canary ไม่ได้ตั้งค่าใช้ error code อย่างเดียว
  - AC-62: DNS ของ monitor เปลี่ยนไป `127.0.0.1` หลังบันทึก การตรวจตามรอบได้ `blocked_address` นับเป็น `fail` ไม่มี IP ในแถวผลตรวจ และ listener บน `127.0.0.1` ไม่เห็นการเชื่อมต่อ, redirect ข้าม host รายงาน SSL ของ host สุดท้าย, ใบรับรองหมดอายุได้ `tls_invalid` พร้อม `tlsReason`
  - retention: ผลอายุ 31 วันถูกลบ 29 วันยังอยู่, incident เปิดอายุ 40 วันยังอยู่
  - แถวผลตรวจไม่มีค่า query, body หรือ header
- **PROOF:** แถวผลตรวจ, incident และ schedule หลังแต่ละ scenario พร้อม trigger และ interleaving ที่ใช้, เวลาที่วัดได้ของผลแรก
- **COVERS:** AC-12 (state), AC-13, AC-17 (storage), AC-19 (worker), AC-34 (ตามรอบ), AC-35 (SSL state), AC-37, AC-38, AC-39, AC-40 (worker), AC-41 (retention จริง), AC-42 (storage), AC-54 (first check), AC-55 (canary), AC-59 (ผลที่มาช้า), AC-60, AC-62 (ตามรอบ)

### NODE-F005-09 Monitor notifications

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`, `security-and-hardening`)
- **READY:** 06A และ 08 handoff ผ่าน review (OD-16 ตัดสินแล้ว)
- **OUTCOME:** migration `0017`, writer ใน `record-result.ts`, contract union, API inbox และ settings, web inbox, popover และหน้าตั้งค่า ตาม Notification
- **SOURCE:** Notification, Data (`0017`), DB-10, JOB-03, JOB-06
- **INVARIANTS:** origin ตามรูปแบบที่กำหนด, toggle อ่านใน transaction เดียวกับ intent, notification settings-changed เดิมทำงานเหมือนเดิม, ไม่มี URL แบบไม่ mask หรือค่าลับใน notification
- **FILES:** `packages/db/migrations/0017_monitor_notifications.sql`, `packages/db/src/schema.ts`, `packages/db/src/notification.ts`, `apps/worker/src/monitor/record-result.ts`, `apps/worker/src/materialize.ts` (column list), `apps/api/src/notifications/*`, `apps/api/src/organization-notifications/service.ts`, `packages/api-contract/src/notification.ts`, generated types, `apps/web/src/pages/NotificationsPage.tsx`, `apps/web/src/components/shell/NotificationsPopover.tsx`, `apps/web/src/pages/OrganizationNotificationSettingsPage.tsx`, tests
- **NON-GOALS:** ช่องทางอื่นนอก in-app, per-user preference, การแสดง inbox ข้าม Organization
- **CONTRACTS:** event type 5 ตัว, `monitorAlertsEnabled`
- **VERIFY:**
  - DB test ว่า CHECK ชุดใหม่แทนชุดเดิม และ event type เดิมยัง insert ได้
  - ลำดับ ล้ม/ล้ม/ผ่าน/ล้ม/ล้ม ได้ down, recovered, down (3 รายการต่อผู้รับ), หยุดระหว่างล่มไม่มี recovered, ลบระหว่างล่มไม่มี recovered และ notification เดิมคงอยู่
  - SSL ครั้งแรกที่ 5 วันได้ danger รายการเดียว, 31 → 30 → 8 → 7 → 0 วัน → หมดอายุได้ caution, danger, expired อย่างละหนึ่ง, เข้าระดับเดิมซ้ำไม่ส่ง, ต่ออายุแล้วไม่ส่ง และเข้าเกณฑ์ครั้งใหม่ส่งอีก
  - toggle ปิดตอนเปิด incident แล้วเปิดตอนปิดไม่มี recovered, Organization ที่ไม่มีแถว settings ได้ notification, PATCH ที่ส่งเฉพาะ `settingsChangedEnabled` แบบเดิมยังผ่าน, `viewer` แก้ toggle ได้ `403`
  - ผู้รับ: `owner`, `admin` ได้ `viewer`, `auditor` ไม่ได้ ผู้ที่ถูกลด role ก่อน materialize ไม่ได้ ผู้ใช้สอง Organization เห็นเฉพาะ Organization ที่ active
  - Redis หยุดระหว่างเปิด incident แล้วเปิดกลับได้ notification หนึ่งรายการ
  - web: inbox และ popover แสดง title, icon, ลิงก์ "เปิดมอนิเตอร์" ต่อ event 5 ชนิด, หน้า settings แสดงและบันทึก checkbox
  - audit log เมื่อเปลี่ยน `monitorAlertsEnabled` สำเร็จ ไม่มีเมื่อ `409` หรือถูกปฏิเสธ, test เดิมของ notification (API, Worker, web) ผ่าน, `bun run codegen:check`
- **PROOF:** จำนวนแถว intent และ inbox ต่อ scenario, ภาพหรือ DOM ของรายการใน inbox และ popover
- **COVERS:** AC-19 (notification คงอยู่หลังลบ), AC-24, AC-36, AC-51, AC-52 (ผู้รับ), AC-53, AC-61 (toggle)

### NODE-F005-P2 Platform: Worker image และ compose

- **OWNER:** platform-engineer (โหลด `worker-handoff`, `debugging-and-error-recovery` เมื่อ build ล้ม)
- **READY:** P1, 08S และ 08 handoff ผ่าน review (entry point และ role ของ Worker มีแล้ว)
- **OUTCOME:** `apps/worker/Dockerfile` ที่ build และรัน Worker ได้ทุก role ผ่าน `WORKER_ROLES` และไฟล์ compose ใหม่ `compose.worker.yaml` ที่รันคู่กับ `compose.yaml` (`docker compose -f compose.yaml -f compose.worker.yaml`, project name และ `NW_SLOT` เดียวกัน) โดยมี service `monitor-scheduler` และ `monitor-checker` แยกกัน ไม่แก้ `compose.yaml` เพราะหัวไฟล์ห้าม production service
- **SOURCE:** Jobs (Worker role), SYS-02, OPS-01
- **INVARIANTS:** non-root, runtime pin ตรงกับ API (`oven/bun:1.3.14-alpine` แบบ `apps/api/Dockerfile`) ถ้า spike ใน 01 เลือก Node 24 ให้หยุดถาม Technical Lead ก่อน, ไม่มีค่าลับหรือ key ใน image, secret มาจาก env ตอนรัน, `OUTBOUND_TEST_ALLOWED_HOSTS` ไม่อยู่ใน image หรือ `compose.worker.yaml`
- **FILES:** `apps/worker/Dockerfile`, `.dockerignore` (ถ้าต้องแก้), `compose.worker.yaml` (ใหม่), `package.json` root (`security:image` ให้ build และ scan ทั้ง API และ Worker image, หลัง P1), `scripts/quality/README.md`, runbook ใน `docs/`
- **NON-GOALS:** deploy, network egress control ของ production, infrastructure นอก repo
- **CONTRACTS:** ชื่อ image `nightwatch-worker` และ service ใน `compose.worker.yaml`
- **VERIFY:** `docker build -f apps/worker/Dockerfile .`, `docker compose -f compose.yaml -f compose.worker.yaml up` แล้ว Worker ทั้งสอง role เริ่ม ต่อ Postgres และ Redis ของ dev ได้ และหยุดด้วย SIGTERM ภายใน 30 s, `docker run ... id -u` ไม่เป็น 0, `bun run security:image` build และ scan ทั้งสอง image
- **PROOF:** log ของ build และ compose, user ใน container ไม่ใช่ root, ผล image scan
- **COVERS:** AC-60 (SIGTERM ใน container)

### NODE-F005-10 Web Overview และ nav

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`)
- **READY:** 06B handoff ผ่าน review
- **OUTCOME:** leaf, icon `activity`, route และ loader ของ Overview, summary, ตาราง, ตัวกรอง, pagination, card เหตุการณ์ล่าสุด, เหตุผลข้างปุ่ม "เพิ่มมอนิเตอร์" เมื่อครบ 50 ตัว, status line "สิทธิ์ของคุณ: ดูอย่างเดียว" และทุก state ของ Overview ตัวอย่าง nav ใน `docs/ref/shell-structure.md` เพิ่ม "ตรวจสถานะบริการ"
- **SOURCE:** Web, State tables, Health model และ Accessibility ใน `feature.md`
- **INVARIANTS:** ไม่แสดงข้อมูลของ Organization อื่นระหว่าง loading หรือหลังสลับ, failure ไม่กลายเป็น empty, ไม่ประกาศ auto refetch, `HealthPill` ใช้ tone ตาม Health model (`primary` + CheckIcon เฉพาะ `up`), `SslLabel` ใช้ tone ตามระดับ, route ใหม่ต้องเป็นปลายทางจริงเท่านั้น (ไม่เพิ่ม route ของ 11 และ 12 ล่วงหน้า)
- **FILES:** `apps/web/src/router.tsx`, `apps/web/src/components/shell/nav-config.ts`, `apps/web/src/components/shell/icons.tsx`, `apps/web/src/lib/auth/loaders.ts`, `apps/web/src/lib/api/monitors.ts`, `apps/web/src/pages/monitors/OverviewPage.tsx` และ component ย่อย (`HealthPill`, `SslLabel`), `docs/ref/shell-structure.md`, tests
- **NON-GOALS:** Detail, ฟอร์ม
- **CONTRACTS:** query key factory ใน `monitors.ts`, `HealthPill` และ `SslLabel` ที่ 11 ใช้ต่อ
- **VERIFY:** `bun run --cwd apps/web test` และ browser smoke:
  - leaf แสดงใน sidebar และใน ⌘K สำหรับทั้งสี่ role, ไม่แสดงเมื่อไม่มี active Organization, active บน `/monitors` (sub-route ทดสอบใน 11 และ 12 เมื่อ route มีจริง)
  - ทุก state ใน State tables ของ Overview และ card เหตุการณ์ล่าสุด (card error ไม่ล้มทั้งหน้า), refetch ล้มหลังมีข้อมูลแสดง warning พร้อมเวลา
  - summary รวมเท่า total, ลำดับ ล่ม, ไม่ทราบสถานะ, ปกติ, หยุดชั่วคราว, SSL ทุกระดับ, "ล้มเหลว 1 ครั้ง", "ล่าสุดทราบว่าล่ม", "รอตรวจครั้งแรก"
  - `viewer` และ `auditor` ไม่เห็นปุ่มเพิ่ม เห็นข้อความ first-run แบบอ่านอย่างเดียว, non-member ได้ denied ไม่เห็นชื่อ URL หรือจำนวน, ครบ 50 ตัวแสดงเหตุผลข้างปุ่ม
  - ผลกรองประกาศ "พบ 3 จาก 12" ผ่าน `role="status"` ครั้งเดียว, เลื่อน fake timer ผ่าน refetch 30 s สองรอบแล้วข้อความใน live region ไม่เปลี่ยน, ตารางมี `aria-label`, สถานะมีคำทุกจุด, pill ของ `unknown`, `paused` และ "ตรวจไม่ได้" ไม่ใช่ tone `primary` และไม่มี CheckIcon
  - สลับ Organization ระหว่าง request ค้างแล้วไม่แสดงข้อมูลเดิม, ทั้งสองธีม
- **PROOF:** ผล test, ภาพหน้าจอต่อ state
- **COVERS:** AC-01, AC-02 (UI), AC-03 (ปุ่มใน Overview), AC-04, AC-05, AC-12 (Overview), AC-20, AC-31 (เหตุผลข้างปุ่ม), AC-49 (สลับ Organization บน Overview)

### NODE-F005-11 Web Detail, Pause, Delete

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`)
- **READY:** 10 handoff ผ่าน review ขั้นแรกของ Task: ตรวจ peer dependency ของ visx 3.12.0 กับ React 19 ถ้าไม่รองรับให้หยุดและรายงาน ห้ามใช้ `--force` หรือ override
- **OUTCOME:** หน้า Detail ทุก section, กราฟ response time ที่ประกอบจาก visx primitive ใน `response-time-chart.tsx` พร้อม keyboard ของตัวเอง สรุปข้อความ และ `<table>` ทางเลือกของแอป, ประวัติ, incident, SSL card, Pause/Resume, Delete dialog และการย้าย `MemberActionDialog` ไป `confirm-dialog.tsx`
- **SOURCE:** Web (Components), Design decisions (Chart), State tables, Special states และ Accessibility ใน `feature.md`, CMP-05
- **INVARIANTS:** "ไม่ทราบสถานะ", "หยุดชั่วคราว" และ "ตรวจไม่ได้" ไม่ใช้ tone หรือ icon ของ "ปกติ", ปุ่ม Pause ไม่ unmount, พฤติกรรม dialog ของหน้าสมาชิกไม่เปลี่ยน, bucket `null` วาดเป็นช่องว่างมีป้ายด้วย `defined` ไม่ลากเส้นเชื่อม, แถบหยุดวาดเองด้วย `@visx/shape` `Bar`, สีมาจาก CSS token ทั้งสองธีม, chart โหลดแบบ lazy เฉพาะ Detail, ติดตั้งเฉพาะ `@visx/shape`, `@visx/scale`, `@visx/axis`, `@visx/group`, `@visx/responsive` แบบ pin version เดียวกัน และบันทึก license (MIT) ใน handoff, keyboard ของกราฟตาม Web (Components) ไม่ประกาศทุก refetch
- **FILES:** `apps/web/src/router.tsx`, `apps/web/src/lib/api/monitors.ts`, `apps/web/src/pages/monitors/DetailPage.tsx` และ component ย่อย, `apps/web/src/components/ui/response-time-chart.tsx`, `apps/web/src/components/ui/confirm-dialog.tsx`, `apps/web/package.json`, `bun.lock`, ไฟล์ F-004: `apps/web/src/pages/organization-members/MemberActionDialog.tsx` (ย้ายออก), `apps/web/src/pages/OrganizationMembersPage.tsx`, `apps/web/src/pages/organization-members/SelfLeaveAction.tsx`, `apps/web/src/pages/organization-members/MemberRoleActions.test.tsx`, tests
- **NON-GOALS:** ฟอร์ม Edit, chart ในหน้าอื่น
- **CONTRACTS:** `ConfirmDialog` props เท่ากับ `MemberActionDialog` เดิม, `ResponseTimeChart` รับ `{ range, buckets, pauses, configChanges }` ตาม API
- **VERIFY:**
  - web test ของทุก state และ special state ของ Detail (รวม "ตรวจไม่ได้", "รอตรวจตามค่าใหม่", SSL ทุกระดับพร้อมผู้ออกและวันคงเหลือ, "อ่านใบรับรองไม่ได้" พร้อมเหตุผลจาก `tlsReason`), assertion ทุกแถวมีคำ "ผ่าน" "ไม่ผ่าน" หรือ "ไม่ได้ประเมิน" และป้าย "ตัดแล้ว", กราฟที่มีช่องว่างและช่วงหยุดทั้งสองธีม, เครื่องหมายจุดเปลี่ยน URL ในกราฟและประวัติ
  - `viewer` และ `auditor` ไม่เห็นปุ่มแก้ไข หยุด เริ่มต่อ ลบ และเห็น "สิทธิ์ของคุณ: ดูอย่างเดียว", non-member ได้ denied, id สามแบบแสดง "ไม่พบมอนิเตอร์นี้" (รวมเปิดจากลิงก์ notification ของ monitor ที่ลบแล้ว)
  - Pause ขณะล่ม, Pause และ Resume คงโฟกัส, Delete ยกเลิกไม่ส่ง mutation, Delete ยืนยันไป Overview พร้อม Notice และโฟกัส h1, Delete ของตัวที่ถูกลบแล้วไป Overview พร้อม "มอนิเตอร์นี้ถูกลบแล้ว", Delete ล้มคืนโฟกัสปุ่มเปิดพร้อม Alert, `PERMISSION_DENIED` ขณะ dialog เปิดแสดง "สิทธิ์ของคุณเปลี่ยนแล้ว", monitor ถูกลบหรือหยุดโดยอีก session แล้ว refetch, สลับ Organization ที่ Detail ไม่แสดงข้อมูลเดิม, leaf active บน `/:monitorId`
  - test ของหน้าสมาชิกรันซ้ำและผ่าน
  - keyboard แบบอัตโนมัติ (Testing Library + `user-event` ใน `happy-dom` [ตรวจแล้วว่ามีใน `apps/web/package.json`]): Tab เข้า region ของกราฟ, `ArrowRight` และ `ArrowLeft` เปลี่ยนจุดที่เลือก, `Home` และ `End`, ข้อความใน `aria-live` ของจุดปกติ ("14:30 เวลาตอบสนอง 182 ms"), จุดในช่องว่าง ("ไม่มีข้อมูล") และจุดในช่วงหยุด ("หยุดชั่วคราว"), ปุ่ม "ดูข้อมูลกราฟเป็นตาราง" เปิดด้วย `Enter` และ `<table>` มี `caption` และ `th` ทั้งสามช่วง, heading ของ section เป็น `h2` ตามลำดับ
  - screen reader แบบ manual ตาม AC-15 และ AC-22: VoiceOver บน macOS กับ Safari ของเครื่องที่ทดสอบ
  - `bun run security:audit` หลังติดตั้ง visx, ขนาด gzip ของ chunk Detail ก่อนและหลังจาก output ของ `bun run build` และขนาดของ package visx ที่ติดตั้งจริง
- **PROOF:** ผล test, ภาพหน้าจอสองธีมของกราฟที่มีช่องว่างและแถบหยุดพร้อม focus ring, version และ license ของ package visx ที่ติดตั้ง, ขนาด bundle ที่วัดได้, ผล audit และหลักฐาน screen reader ที่ reviewer ต้องได้ครบก่อน mark AC-15 และ AC-22 เป็น observed pass:
  - version ของ macOS, Safari และ VoiceOver
  - transcript ข้อความที่ VoiceOver อ่านจริง (คัดลอกจาก VoiceOver Caption Panel หรือถอดจาก screen recording) สำหรับ 7 ขั้น: Tab เข้ากราฟ (ชื่อ region พร้อมหน่วย ช่วงเวลา แหล่ง), ลูกศรขวาหนึ่งครั้ง, `End`, จุดในช่องว่าง, จุดในช่วงหยุด, เปิดตาราง, อ่านแถวแรกของตาราง
  - รายการ heading จาก VoiceOver rotor ของหน้า Detail
  - ขั้นที่ไม่ตรงกับที่คาดบันทึกเป็น observed fail พร้อมข้อความจริง ไม่ตัดออก ถ้าไม่มี transcript ให้ mark AC-15 และ AC-22 เป็น not verified
- **COVERS:** AC-01 (active บน Detail), AC-02 (Detail), AC-03 (ปุ่มใน Detail), AC-12 (UI), AC-13 (UI), AC-14 (UI), AC-15, AC-17 (UI), AC-18 (เครื่องหมาย URL), AC-19 (UI), AC-22, AC-23, AC-32 (ประวัติ), AC-35 (card), AC-39 (UI), AC-40 (UI), AC-48 (UI), AC-49 (dialog, สลับ Organization), AC-50 (UI), AC-52 (ลิงก์ไป monitor ที่ลบแล้ว)

### NODE-F005-12 Web Create, Edit, Test panel

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`)
- **READY:** 07 และ 11 handoff ผ่าน review
- **OUTCOME:** ฟอร์ม Create และ Edit ทั้งสองโหมด, validation ข้างช่องจาก schema เดียวกับ server, Test panel ทุก state, denied state และข้อความคำเตือน query และ body
- **SOURCE:** Web, API (errors), State tables, Test Configuration และ Accessibility ใน `feature.md`
- **INVARIANTS:** validation ข้างช่องใช้ Zod schema และ parser ใน `packages/api-contract/src/monitor.ts` เท่านั้น (web import `packages/shared` ไม่ได้ตาม PKG-01) server ยังเป็นผู้ตัดสินสุดท้าย, สลับโหมดไม่ลบค่า, กดบันทึกหรือทดสอบซ้ำระหว่าง pending ไม่ส่งซ้ำ, ค่าคงอยู่หลัง failure และหลัง `PERMISSION_DENIED`, ผลทดสอบเก่าติดป้าย stale เมื่อแก้ฟอร์ม
- **FILES:** `apps/web/src/router.tsx`, `apps/web/src/lib/api/monitors.ts`, `apps/web/src/pages/monitors/MonitorFormPage.tsx` และ component ย่อย, tests
- **NON-GOALS:** ช่องค่าลับและ auth (14)
- **CONTRACTS:** `MonitorForm` ที่ 14 เพิ่ม section ค่าลับ
- **VERIFY:** `bun run --cwd apps/web test` และ browser smoke:
  - ค่าเริ่มต้น (5 นาที, 200-299, 10 s, GET), สลับโหมดพื้นฐานกับขั้นสูงไม่ลบค่าและแสดง "มีการตั้งค่าขั้นสูง N รายการที่ยังใช้งานอยู่"
  - error ข้างช่องของทุก `reason` ใน `MONITOR_INVALID` และ `MONITOR_TARGET_BLOCKED` โฟกัสช่องแรกที่ผิด error ผูก `aria-describedby`, ค่าคงอยู่หลัง failure
  - กดบันทึกซ้ำส่งหนึ่งคำขอ, กดทดสอบซ้ำส่งหนึ่งคำขอ, บันทึกโดยไม่ทดสอบและหลังทดสอบไม่ผ่านได้, บันทึกแล้วไป Detail ที่แสดง "รอตรวจครั้งแรก"
  - Test panel ทุก state ใน Test Configuration รวม `blocked_address` ที่แสดง "ที่อยู่นี้ไม่อนุญาตให้ตรวจสอบ" และ `redirect_blocked` ที่แสดง "ที่อยู่ปลายทางของ redirect ไม่อนุญาตให้ตรวจสอบ" โดย DOM ไม่มี IP, `429` ที่ปุ่ม disabled จนครบ `retryAfterSeconds` โดยไม่ประกาศนับถอยหลัง, `503` และ `500` เป็น Alert "ทดสอบไม่สำเร็จ" แยกจากผลเป้าหมาย, stale label หลังแก้ฟอร์ม, ผลประกาศผ่าน `role="status"` โดยโฟกัสอยู่ที่ปุ่ม
  - Edit: `409` แสดงข้อความ conflict และคงค่า, id สามแบบแสดง "ไม่พบมอนิเตอร์นี้", `viewer` และ `auditor` เปิด `/new` และ `/edit` ตรงได้ denied, role ลดลงระหว่างเปิดฟอร์มแสดง "สิทธิ์ของคุณเปลี่ยนแล้ว" และคงค่า, ถูกนำออกจาก Organization แสดง denied ไม่มีข้อมูลค้าง, สลับ Organization ที่ Edit ไม่แสดงข้อมูลเดิม, leaf active บน `/new` และ `/:monitorId/edit`
  - ขีดจำกัดแถว 20, assertion 10, body 64 KiB แสดง error ข้างช่อง, JSONPath ที่มี filter แสดง error, คำเตือนถาวรใต้ query และ body
  - keyboard ของ radiogroup ด้วยลูกศร, แถวที่เพิ่มลบมีชื่อเฉพาะแถว โฟกัสหลังเพิ่มและลบตาม Accessibility ของ `feature.md`
- **PROOF:** ผล test, จำนวนคำขอที่ส่งเมื่อกดซ้ำ, ภาพหน้าจอต่อ state
- **COVERS:** AC-01 (active บน `/new`, `/edit`), AC-03 (denied บน `/new`, `/edit`), AC-06, AC-07, AC-08 (UI), AC-09 (UI ข้างช่อง URL), AC-62 (ข้อความใน Test panel ไม่มี IP), AC-10 (UI), AC-11 (UI), AC-16, AC-18 (Edit), AC-21, AC-28 (UI), AC-29 (UI), AC-30 (UI), AC-31 (UI), AC-32 (UI), AC-33 (UI), AC-34 (UI), AC-47, AC-48 (Edit), AC-49 (ฟอร์ม), AC-50 (Test), AC-54 (UI)

### NODE-F005-13 ค่าลับ (S07): API และ Worker

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`, `security-and-hardening`)
- **READY:** 02, 07, 08 handoff ผ่าน review (DIR-001 v3 บันทึก S3 exception แล้วตาม `feature.md`)
- **OUTCOME:** auth ทั้งสามชนิดและ header ลับทำงานใน Create, Edit, Test และการตรวจตามรอบ แบบ write-only ตามค่าลับในหัวข้อ Authorization and security การตั้ง แทนที่ หรือลบค่าลับเพิ่ม `check_config_version` ตาม Scheduling กรณีพิเศษ
- **SOURCE:** Authorization and security (ค่าลับ, Credential helper), Jobs (ลำดับของ checker, Scheduling กรณีพิเศษ), OD-02
- **INVARIANTS:** ค่าลับไม่อยู่ใน response, payload, schedule, notification, ผลตรวจ, ผลทดสอบ, error หรือ log, origin เปลี่ยนต้องกรอกใหม่หรือลบ, redirect ไป host หรือ port อื่นไม่ส่งค่าลับ, header ที่ชนกับ header ของ auth ถูกปฏิเสธ
- **FILES:** `apps/api/src/monitors/*`, `packages/api-contract/src/monitor.ts`, generated types, `apps/worker/src/monitor/checker.ts`, tests
- **NON-GOALS:** UI (14), credential ประเภทอื่น, re-encrypt
- **CONTRACTS:** `secrets` ใน Create และ Edit, `secretSlots` ใน view, error `MONITOR_SECRET_ORIGIN_CHANGED`
- **VERIFY:** HTTP/DB และ Worker test ด้วย `bun run test:integration`:
  - Create พร้อม bearer, basic, apiKey และ header ลับ แล้ว Detail คืน `secretSlots` เท่านั้น
  - Edit: keep ใช้ค่าเดิม, replace, replace ว่างได้ `MONITOR_INVALID` `required`, delete, เปลี่ยนชนิด auth ลบ slot เดิม, ลบ header ลับลบ slot, ลบ monitor แล้วไม่มีแถวใน `monitor_secrets`
  - เปลี่ยน scheme, host หรือ port ขณะ keep ได้ `422 MONITOR_SECRET_ORIGIN_CHANGED` ทั้ง Edit และ Test ผ่าน request ตรง, เปลี่ยน path อย่างเดียวผ่าน
  - Test ใน Edit แบบ keep ส่งค่าที่เก็บไว้ (listener เห็นค่า), แบบ replace ส่งค่าใหม่และแถวใน `monitor_secrets` ไม่เปลี่ยน
  - redirect ไป host อื่นไม่มี header ลับ, `http` → `https` host เดิมมี header ลับ
  - endpoint ที่สะท้อน header และ Basic credential: `actual`, `failureReason` และข้อความ error แสดง `•••`
  - Worker ใช้ค่าลับตามรอบ, ciphertext ที่ถูกแก้ได้ `check_error` `secret_decrypt_failed`
  - สแกนค่าลับที่รู้ค่าในทุก response, BullMQ payload, ทุกตาราง monitor และ notification และ log ที่จับได้ (รวม audit log) ไม่พบ
  - audit log `secret.set` และ `secret.replace` ต่อการตั้งหรือแทนที่ที่สำเร็จ, `bun run codegen:check`
- **PROOF:** ผลสแกนที่ไม่พบค่าลับ, แถว `monitor_secrets` หลังแต่ละกรณี, คำขอที่ listener เห็น
- **COVERS:** AC-25 (API), AC-26 (API), AC-29 (auth header conflict), AC-43, AC-44 (API), AC-45, AC-46, AC-56, AC-61 (ค่าลับ)

### NODE-F005-14 ค่าลับ (S07): Web

- **OWNER:** software-engineer (โหลด `build`, `worker-handoff`, `security-and-hardening`)
- **READY:** 12 และ 13 handoff ผ่าน review
- **OUTCOME:** section การยืนยันตัวตน และ checkbox "ค่าลับ" ของ header ใน Create และ Edit ตาม wireframe Edit (secret-replace pattern) Detail แสดงชนิด auth และชื่อ header ลับพร้อม "ตั้งค่าแล้ว"
- **SOURCE:** UI flow C2, Test Configuration (ต้องกรอกค่าลับใหม่), Accessibility ใน `feature.md`, API (ค่าลับ)
- **INVARIANTS:** ช่องค่าลับ `type="password"` และ `autocomplete="new-password"`, browser ไม่เคยได้ค่าลับ, ค่าที่กรอกไม่อยู่ใน cache ของ query หรือ log, ปุ่มทดสอบและบันทึก disabled เมื่อ origin เปลี่ยนจนกว่าจะเลือกแทนที่หรือลบ
- **FILES:** `apps/web/src/pages/monitors/*` (section auth, header ลับ, Detail), `apps/web/src/lib/api/monitors.ts`, tests
- **NON-GOALS:** API, Worker
- **CONTRACTS:** ไม่มีใหม่
- **VERIFY:** `bun run --cwd apps/web test`: "ตั้งค่าแล้ว" และ "แทนที่", ไม่กดแทนที่ส่ง `keep`, แทนที่แล้วปล่อยว่างได้ error "กรอกค่าใหม่ หรือกดยกเลิกการแทนที่", เปลี่ยนชนิด auth แจ้ง "ค่าลับของชนิดเดิมจะถูกลบ" ก่อนบันทึก, แก้ host ของ URL แสดง "เปลี่ยนที่อยู่ปลายทาง ต้องกรอกค่าลับใหม่หรือลบค่าลับเดิม" และปุ่ม disabled, `viewer` เห็นชนิด auth และ "ตั้งค่าแล้ว" ไม่เห็นค่า, DOM และ query cache ไม่มีค่าลับหลังบันทึก
- **PROOF:** ผล test, ภาพหน้าจอ Edit ก่อนและหลังกดแทนที่
- **COVERS:** AC-25 (UI), AC-26 (UI), AC-44 (UI)

### NODE-F005-15 Integration: e2e, docs, integrated verification

- **OWNER:** software-engineer (integration owner) Technical Lead สั่ง final review และ gate หลัง writer หยุด
- **READY:** ทุก Task ข้างบน handoff ผ่าน review และ writer ทุกตัวหยุด
- **OUTCOME:** e2e ของ flow หลักใน `e2e/`, `docs/architecture.md` ปรับข้อความสถานะให้ตรงกับ code (System parts และ Background jobs: Worker role monitor และ queue `monitor-check` เป็น `Implemented`, SSRF helper ของ OUT-01, limiter ของ REQ-04, encryption ของ DB-14 และ monthly partition เป็น `Implemented`) โดยไม่เปลี่ยนกฎหรือเลข rule, integrated verification ด้านล่างครบพร้อมหลักฐาน
- **SOURCE:** Integrated verification, AGENTS.md (อัปเดตเอกสารเมื่อ contract เปลี่ยน)
- **INVARIANTS:** แก้เฉพาะ section สถานะใน `docs/architecture.md` ไม่แก้หรือ renumber rule ID ถ้าพบว่า code ขัดกับ rule ให้รายงาน Technical Lead ไม่แก้ทั้งสองฝั่ง, e2e ใช้ target ภายใน test harness ผ่าน `OUTBOUND_TEST_ALLOWED_HOSTS` เท่านั้น
- **FILES:** `e2e/tests/monitors.spec.ts` (แบบ `e2e/tests/notifications.spec.ts` [ตรวจแล้ว]), `e2e/playwright.config.ts` (`WORKER_ROLES` เพิ่ม `monitor-scheduler,monitor-checker` และ env ใหม่ใน `runtimeEnv()`), target server ของ e2e, `docs/architecture.md`, `scripts/quality/README.md` (ถ้า e2e ต้องการ env ใหม่)
- **NON-GOALS:** release, deploy, feature code ใหม่
- **CONTRACTS:** ไม่มีใหม่
- **VERIFY:** `bun run e2e` สำหรับ owner สร้าง monitor ทดสอบก่อนบันทึก เห็นผลแรก หยุด เริ่มต่อ ลบ, `viewer` อ่านได้แต่ไม่มี action, notification ล่มและกลับมาปกติปรากฏใน inbox และตามด้วย integrated verification ทุกข้อ
- **PROOF:** ผล e2e, ตาราง AC-01 ถึง AC-61 พร้อม observed pass, observed fail หรือ not verified
- **COVERS:** AC-02, AC-03, AC-20 ถึง AC-23, AC-25, AC-27, AC-49, AC-53, AC-55 ถึง AC-62 (integrated)


## Integrated verification

เจ้าของคือ `NODE-F005-15` หลัง writer ทุก Task หยุด:

- AC-02 และ AC-03: ตาราง role × operation เต็มทั้ง UI และ request ตรง รวม Test และ secret operation
- AC-20 ถึง AC-23: keyboard และ screen reader review ของทุก flow ทั้งสองธีม, zoom 200% และ reflow ตาม LAY-02
- AC-25 และ AC-56: สแกนค่าลับที่รู้ค่าใน log ของ API และ Worker ที่จับได้ระหว่าง scenario ทั้งหมด
- AC-61: ทุก mutation ที่สำเร็จมี audit log หนึ่งรายการ ไม่มีค่าลับ ค่า query หรือ body และ mutation ที่ถูกปฏิเสธไม่มี audit log
- AC-27: review ขอบเขตของ diff ทั้งหมด
- AC-49: สอง session เปลี่ยน role และนำออกจาก Organization ระหว่างเปิดฟอร์ม dialog และ Detail
- AC-53 ข้ามส่วน: หยุด Redis ระหว่าง incident เปิด แล้วเปิดกลับ ดูว่า notification มาครั้งเดียว
- AC-55 ถึง AC-60: รันซ้ำบน stack ที่รวมทุก Task (API, Worker ทุก role, PostgreSQL, Redis)
- ทุก AC รายงานเป็น observed pass, observed fail หรือ not verified พร้อมหลักฐาน
- Gate ตาม `scripts/quality/README.md` หลัง writer หยุด: `bun run validate`, `COVERAGE_GATE=1 bun run test:coverage` (รวม integration test ตาม job `test` ของ CI), `bun run build`, `bun run security` [ตรวจแล้ว] CI รัน e2e และ `security:image` เฉพาะ job `full` ที่เป็น `workflow_dispatch` จึงไม่ใช่ gate ของ PR `NODE-F005-15` รัน `bun run e2e` ในเครื่องเป็นหลักฐานของ integrated verification ส่วน `security:image` ของ Worker image เป็นหลักฐานของ P2 ไม่มี release หรือ deploy task ใน spec นี้


## Open decisions

| Decision | Owner |
| -------- | ----- |
| Start authorization และ `COMMIT_MODE` | ผู้ใช้ |


## Chart library comparison (ผู้ใช้เลือก visx 2026-09-29)

ตารางที่ใช้ตอนผู้ใช้เลือก เก็บไว้เป็นเหตุผลของการตัดสินใน Design decisions Web ใช้ React 19, Vite 8, Tailwind 4 [ตรวจแล้วใน `apps/web/package.json`] ขนาดและ license มาจากหน้า npm และเว็บวิเคราะห์ package [จากแหล่งภายนอก ยังไม่ได้วัดใน repo]

| เกณฑ์ | Recharts 3 | visx (`@visx/xychart`) | uPlot |
| --- | --- | --- | --- |
| ขนาด (min + gzip) | ประมาณ 136 KB ทั้ง package | ประมาณ 96 KB (`xychart`) ใช้ package ย่อย (`@visx/shape`, `@visx/axis`) ได้เล็กกว่า | ประมาณ 21 KB |
| License | MIT | MIT | MIT |
| Render และสีตามธีม | SVG, สีรับค่า CSS variable ของ status roles ได้ตรง ธีม light/dark ตาม token โดยไม่ต้อง redraw [สมมติฐาน] | SVG, ใช้ CSS variable ได้ตรง | Canvas ต้องอ่านค่า token ด้วย JS และ redraw เมื่อสลับธีม |
| Keyboard และ screen reader | `accessibilityLayer` เปิดเป็นค่าเริ่มต้นใน v3: Tab เข้ากราฟและใช้ลูกศร | ไม่มีในตัว ต้องทำเอง | Canvas ไม่มี DOM ให้ screen reader ไม่มี keyboard ในตัว |
| ช่องว่างของข้อมูล (CMP-05) | ค่า `null` ตัดเส้นเป็นช่องว่าง (`connectNulls` ปิดเป็นค่าเริ่มต้น) แถบช่วงหยุดใช้ `ReferenceArea` | `defined` ของ line path ตัดช่องว่าง แถบวาดเองด้วย `rect` | `null` เป็นช่องว่างเป็นค่าเริ่มต้น แถบต้องเขียน plugin |
| การดูแล | ใช้แพร่หลาย ออก v3 แล้ว ทีมหลายคน | มีผู้ดูแลต่อเนื่อง (health score สูงในเว็บวิเคราะห์) | ผู้ดูแลหลักคนเดียว ไม่ใช่ React component |
| งานที่ต้องเขียนเอง | น้อย: axis, tooltip, legend มีในตัว | มาก: ประกอบกราฟจาก primitive | ปานกลาง: wrapper React, theme, plugin แถบหยุด |

Technical Lead เสนอ Recharts 3 ผู้ใช้เลือก visx

แหล่ง: [recharts 3.0.0 release](https://newreleases.io/project/npm/recharts/release/3.0.0), [recharts package analysis](https://mcp.depscope.dev/pkg/npm/recharts), [@visx/xychart on npm](https://npmjs.com/package/@visx/xychart), [@visx/xychart analysis](https://mcp.depscope.dev/pkg/npm/@visx/xychart), [uPlot on npm](https://npmjs.com/package/uplot), [uPlot analysis](https://depscope.dev/pkg/npm/uplot)
