# Architecture Blueprint

กฎสำหรับพัฒนา NightWatch ซึ่งเป็นแพลตฟอร์ม cloud security แบบ multi-tenant
ที่รองรับ AWS เป็นหลัก เอกสารนี้กำหนดขอบเขต contracts และ invariants
ที่ C4 levels 1 ถึง 3 (context, containers, components) โดยไม่ได้อธิบายโค้ด
รายละเอียดการ implement อยู่ในโค้ด tests และ scripts
ส่วนเอกสารนี้กำหนดกฎที่สิ่งเหล่านั้นต้องปฏิบัติตาม

## 0. How to use this document

- อ้างอิงกฎด้วย ID (เช่น `TSQL-01`) ในงานที่มอบหมาย findings,
  reviews และการตัดสินใจ ID ต้องคงเดิม: เพิ่มกฎใหม่ต่อท้าย
  ห้ามเปลี่ยนลำดับเลขหรือนำ ID กลับมาใช้ซ้ำ
- แต่ละกฎเป็นข้อความหนึ่งข้อที่ตรวจสอบได้ `Never` หรือ “ห้าม” หมายถึงข้อห้าม
  ค่าที่ระบุว่า `baseline` คือค่าเริ่มต้นปัจจุบันที่โค้ดปรับได้
  แต่กฎที่กำกับค่าเหล่านั้นยังคงเดิม
- Status labels: `Implemented` (มีโค้ดแล้ว), `Planned` (กำหนด design แล้ว
  แต่ยังรอโค้ด), `Deferred` (อนุมัติให้เลื่อนแล้ว; กำหนด design แล้ว แต่ยังไม่มีโค้ด)
- เมื่อโค้ดกับเอกสารนี้ไม่ตรงกัน ต้องรายงานข้อขัดแย้งต่อ
  Technical Lead เป็น finding ห้ามแก้ฝ่ายใดฝ่ายหนึ่งโดยไม่รายงาน
- สิ่งที่อยู่นอกขอบเขตเอกสารนี้: toolchain, environment และคำสั่ง verification
  (`package.json`, `turbo.json`, CI, `scripts/quality/README.md`);
  กฎ UI (`docs/design-system.md`); ขอบเขตผลิตภัณฑ์
  (`docs/product-direction.md`)

คำศัพท์: tenant = organization; `tenantId` = organization id;
candidate = implementation revision ที่รวมงานแล้วและอยู่ระหว่าง validation

## 1. System context (C4 level 1)

```text
Public visitor ----> Landing site        (marketing only; no auth, no data)
Organization user -> Web SPA -> API -----> PostgreSQL
Operator (CLI) ----> provisioning on owner connection -> PostgreSQL
Platform admin ----> API                 (explicit per-operation guard)
API / Worker ------> SMTP relay          (verification, reset, invitation)
Worker ------------> cloud provider APIs (Prowler, AWS SDK),
                     HTTP/DNS/TCP monitor targets,
                     notification destinations
```

Actors: ผู้เยี่ยมชมทั่วไป; ผู้ใช้ของ organization ที่มี role เป็น `owner`, `admin`,
`viewer` หรือ `auditor`; operator; platform admin ระบบภายนอก:
บัญชี cloud provider (AWS เป็นหลัก, GCP), SMTP relay, ปลายทางการแจ้งเตือน
และ HTTP/DNS/TCP endpoints ที่ monitor

- CTX-01 ห้ามส่ง authentication, session cookies
  หรือข้อมูลภายในให้ landing site
- CTX-02 ผู้ใช้ของ organization เข้าถึงข้อมูลได้ผ่าน Web SPA -> API
  ด้วย session cookie เท่านั้น ไม่มีช่องทางผ่าน client อื่น
- CTX-03 การสร้าง organization ต้องทำโดย operator ผ่าน
  owner-connection CLI เท่านั้น ไม่มีช่องทางสร้าง organization ผ่าน HTTP
- CTX-04 การเข้าถึงของ platform admin ต้องมี guard ที่ชัดเจนเฉพาะแต่ละ
  operation ห้ามใช้เป็น global bypass ของ tenant context
- CTX-05 การเรียก outbound integrations (cloud APIs, SMTP, destinations,
  monitors) ต้องมาจาก API หรือ Worker เท่านั้น และต้องผ่าน
  SSRF และ credential helpers ที่ใช้ร่วมกัน (XC-05, XC-04)

## 2. Containers (C4 level 2)

```text
[Web SPA] --HTTP JSON + host-only cookie--> [API] --tenant SQL--> [PostgreSQL]
[API] --typed producers--> [Redis/BullMQ] <--consume-- [Worker]
[Worker] --SQL--> [PostgreSQL]; [Worker] --> Prowler / SDK / HTTP / SMTP
[Scheduler (Worker role)] --SQL due-work lookup--> producers
[Owner deployment / cron] --migrations + partition DDL--> [PostgreSQL]
[Landing] independent build and deploy; no internal dependency
```

| Container    | Technology                   | Status      | Location         |
| ------------ | ---------------------------- | ----------- | ---------------- |
| Web SPA      | React, Vite                  | Implemented | `apps/web`       |
| API          | Hono monolith บน Bun         | Implemented | `apps/api`       |
| PostgreSQL   | Drizzle, migrations, RLS     | Implemented | `packages/db`    |
| Worker       | BullMQ consumers, schedulers | Deferred    | `apps/worker`    |
| Redis/BullMQ | การขนส่ง jobs                | Deferred    | `packages/queue` |
| Landing      | Astro, deploy แยกอิสระ       | Deferred    | `apps/landing`   |

- CON-01 PostgreSQL เป็น system of record ส่วน Redis ใช้ขนส่งเท่านั้น
  ห้ามมี state ที่อยู่ใน Redis เพียงแห่งเดียว (DATA-02)
- CON-02 API เป็น modular monolith เดียว โดยมี domain modules อยู่ใต้
  `apps/api/src/<domain>` ห้ามแยก service, ใช้ DI container
  หรือสร้าง repository layer เผื่อไว้โดยยังไม่มีความจำเป็น
- CON-03 Worker ต้องไม่ผูกกับ API ผ่าน HTTP
  และใช้โค้ดร่วมกันผ่าน packages เท่านั้น
- CON-04 Landing site ต้องไม่มี `workspace:*` dependency, auth
  หรือ application API client
- CON-05 Web SPA import โค้ดที่ปลอดภัยสำหรับ browser ได้จาก `api-contract`
  เท่านั้น ห้าม import `shared`, `api`, PostgreSQL หรือ Redis clients
- CON-06 SQL commit และ Redis enqueue ไม่เป็น atomic ร่วมกัน:
  ต้อง commit ก่อน แล้ว enqueue จากนั้นชดเชยเมื่อเกิด failure (SCAN-02)

### 2.1 Code packages and dependency direction

- `packages/api-contract`: Zod schemas, types และ error contract
  ที่ปลอดภัยสำหรับ browser ต้อง export จาก package root เท่านั้น
- `packages/db`: Drizzle schema และ client, tenant helpers,
  migrations ที่มีลำดับ และ partitions ใช้ฝั่ง server เท่านั้น
- `packages/queue` (Deferred): job payloads, options, producers และ
  SQL `queue_jobs` ledger ใช้ฝั่ง server เท่านั้น; depend on `db` ได้
- `packages/shared`: permissions, limits, encryption, logging, SSRF,
  email config ใช้ฝั่ง server เท่านั้น; ห้าม import จาก app
- `packages/*-config`: compiler และ lint configuration
  ห้ามมี runtime code และห้าม import จาก app

- PKG-01 ทิศทางที่อนุญาต: web -> `api-contract`; api -> `api-contract`
  + `shared` + `db`; queue -> `db`; config packages ต้องไม่มี dependency
- PKG-02 ใช้ ESLint boundary rules บังคับ PKG-01
  ห้ามลดความเข้มงวดหรือปิดกฎเพื่อให้ผ่าน
- PKG-03 ห้ามมี circular imports ต้องประกอบ functions ด้วย inputs ที่ชัดเจน
- PKG-04 โครงสร้าง domain module: `routes.ts` (HTTP, context),
  `schemas.ts` (inputs), `service.ts` (logic ที่ไม่ผูกกับ transport)
  ห้าม import frontend ใน API

## 3. Components (C4 level 3)

### 3.1 API request pipeline

```text
Request
  -> request context, logs, metrics
  -> rate limiter
  -> credentialed CORS (exact origin)
  -> tenant middleware: session -> verified membership
                        -> tenantId, userId, userRole
  -> permission guard -> Zod parsing
  -> service(tenantId, ...)
  -> tenant transaction: scoped checks -> change -> COMMIT
  -> enqueue + audit -> response
```

- REQ-01 ต้องใช้ขอบเขต organization เดียวกันตลอด URL `orgId`,
  service `tenantId`, SQL context และ job payloads
- REQ-02 ก่อน implement ต้องจัดประเภททุก route เป็น tenant-protected,
  pre-tenant หรือ platform access ที่มีขอบเขตแคบ
- REQ-03 Tenant-protected routes (Planned) ต้อง resolve tenant ตามลำดับ
  route `orgId` -> `X-Org-ID` header -> membership แรกสุดตาม `created_at`
  ต้องเชื่อถือเฉพาะ membership ที่ตรวจสอบแล้ว
  ห้ามเชื่อถือค่าที่เลือกใน browser หรือ request bodies
- REQ-04 ต้องตรวจสอบ membership ก่อนเข้าถึงข้อมูลใด ๆ
- REQ-05 Application routes ต้องตอบ 401 เมื่อ session หายไปหรือไม่ถูกต้อง
  และ 403 เมื่อถูกปฏิเสธ membership หรือ permission โดยใช้ error envelope
  ของ `api-contract` ต้อง audit การปฏิเสธโดยไม่บันทึกข้อมูลที่ได้รับการปกป้อง
- REQ-06 ต้อง guard แต่ละ operation ด้วย permission ที่ชัดเจน (เช่น
  `project:manage` สำหรับสั่งเริ่มและยกเลิก scan)
- REQ-07 Routes รับผิดชอบการแปลงเข้าออก HTTP ส่วน services รับ `tenantId`
  และ typed inputs โดยต้องไม่ผูกกับ transport
- REQ-08 งาน network และ CPU ต้องอยู่นอก SQL transactions

### 3.2 Identity and admission (Better Auth boundary)

Implemented แล้วใน `apps/api/src/auth` บน PostgreSQL/Drizzle โดยมี entities:
users, sessions, provider accounts, verifications, memberships,
invitations และ TOTP two-factor เวอร์ชัน library ถูก pin ไว้ใน
`apps/api/package.json`

- AUTH-01 รับผู้ใช้ผ่าน invitation เท่านั้น ฝั่ง server ต้อง gate signup
  ด้วย invitation ที่ยัง pending และไม่หมดอายุ โดย email ต้องตรงกับ email
  ที่ใช้ signup แบบไม่แยกตัวพิมพ์เล็กใหญ่; client ส่ง invitation id ใน
  `X-Invitation-ID` header ไม่มีการเปิด signup ทั่วไป
- AUTH-02 Public invitation preview
  (`GET /api/onboarding/invitations/:invitationId`) ต้องตอบ not-found
  แบบเดียวกันทุกกรณีที่ id ไม่รู้จัก, cancelled, accepted หรือ expired
- AUTH-03 ต้องสร้าง account หลังจากผู้รับพิสูจน์ความเป็นเจ้าของ email แล้วเท่านั้น
  ทั้ง signup และการยอมรับ invitation ต้องผ่าน email verification
- AUTH-04 การยอมรับ invitation ต้องใช้ native flow ของ Better Auth
  การเปลี่ยนสถานะ pending -> accepted ต้องเป็น update statement เดียวที่มี guard
  และข้อกำหนด uniqueness ของ membership `(organization_id, user_id)`
  ทำให้การยอมรับซ้ำหรือพร้อมกันปลอดภัยด้าน idempotency
- AUTH-05 การยอมรับพร้อมกันที่แพ้การแข่งขันต้อง map membership uniqueness
  violation ไปเป็นการปฏิเสธแบบ deterministic เดียวกับที่ใช้สำหรับ invitation
  ที่ accepted แล้ว ห้าม remap database error อื่นใด
  รวมถึง uniqueness violations อื่น
- AUTH-06 Roles ต้องมีเพียง `owner`, `admin`, `viewer`, `auditor`
  เฉพาะสมาชิกที่มี role `owner` เท่านั้นที่ส่ง invitation ด้วย role `owner` ได้
- AUTH-07 ผู้ใช้แต่ละคนเลือกเปิด TOTP two-factor ได้ โดยใช้ challenge
  เมื่อ sign-in ด้วย credentials การกู้คืนใช้ backup codes ที่เข้ารหัสและใช้ได้ครั้งเดียว
  ห้ามออก full session ขณะที่ TOTP challenge ยัง pending
- AUTH-08 `auth.getSession(headers)` ต้องเป็น session entry point
  เพียงจุดเดียวสำหรับ application code
- AUTH-09 Session cookies ต้องเป็น host-only, `HttpOnly`, `SameSite=Lax`
  และ `Secure` ใน production ห้ามขยาย cookie scope เพื่อรองรับ CORS
- AUTH-10 `CORS_ORIGIN`, `APP_URL` และ `trustedOrigins` ต้องสอดคล้องกัน
  Credentialed CORS ที่ระบุ origin ตรงตัวต้องทำงานก่อน auth handler
  และมี `X-Invitation-ID` อยู่ใน allow-list
- AUTH-11 Better Auth raw endpoints ตอบด้วย error shape ของ library เอง
  รวมถึง 401 เมื่อ upstream ปฏิเสธ permission ส่วน application routes
  ใช้ envelope ของ `api-contract` (REQ-05)
- AUTH-12 ห้ามทำ authentication ให้ landing site (CTX-01)
  ห้าม log verification, reset หรือ invitation links (XC-07)

### 3.3 Organization access and provisioning

Implemented แล้วใน `apps/api/src/me` และ `apps/api/src/operator`

- ORG-01 `GET /api/me/context` และ `PATCH /api/me/active-org`
  ใช้ tenant-selection contract (`meContextResponseSchema`)
  กับ sessions ที่ตรวจสอบแล้วเท่านั้น: ตอบ 401 เมื่อไม่มี session
  และ 403 เมื่อ email ยังไม่ได้รับการยืนยัน
- ORG-02 Membership lookup ต้องเป็น pre-tenant parameterized query
  ที่กรองด้วย user id จาก session และเรียงตาม membership `created_at`
  ห้าม responses เปิดเผย organizations ที่ผู้ใช้ไม่ได้เป็นสมาชิก
- ORG-03 ต้องคืนค่า `last_active_tenant_id` ที่เก็บไว้เฉพาะเมื่อค่านั้น
  ยัง resolve ไปยัง membership ที่มีอยู่ในปัจจุบันได้
- ORG-04 การสลับ active organization ต้องตรวจสอบ membership อีกครั้ง
  ภายใน transaction เดียว โดยใช้ `FOR UPDATE` กับ membership row,
  อัปเดต `user.last_active_tenant_id` และสะท้อนค่าไปยัง
  `session.active_organization_id` ใน transaction เดียวกัน
  ห้ามใช้ค่าที่สะท้อนไว้ใน session เป็นหลักฐาน membership
- ORG-05 ต้อง audit การสลับที่ถูกปฏิเสธ โดยไม่บันทึกข้อมูล tenant หรือ secrets
- ORG-06 การ provision organization แรกต้องทำโดย operator เท่านั้น
  ผ่าน owner connection โดย transaction เดียวต้องสร้าง organization และ
  owner invitation ที่ pending หนึ่งรายการ ซึ่งมี id ที่คาดเดาไม่ได้
  และ TTL ที่มีขอบเขต (baseline 48 h)
- ORG-07 Provisioning ต้องจัดลำดับ retries ที่ทำพร้อมกันสำหรับแต่ละ slug
  ด้วย transaction-scoped advisory lock การรันซ้ำต้องสร้างหรือส่งซ้ำ
  pending owner invitation เพียงหนึ่งรายการ
  และห้ามสร้าง organization ซ้ำ
- ORG-08 ต้องระบุผู้กระทำ provisioning เป็น internal principal ที่สงวนไว้
  โดยไม่มี account, password หรือ session; principal นี้ห้าม log in
  และมีไว้ระบุที่มาของการกระทำใน audit เท่านั้น
- ORG-09 ต้องส่ง invitation email ผ่าน SMTP จริงหลัง commit
  หากส่งไม่สำเร็จต้อง exit ด้วย non-zero; การรันซ้ำเป็นช่องทาง retry

### 3.4 Tenant SQL and RLS (load-bearing)

| Caller          | Helper                                      | Status      |
| --------------- | ------------------------------------------- | ----------- |
| Drizzle queries | `withTenantContext(tenantId, tx => ...)`    | Implemented |
| API raw SQL     | `withTenantContextRaw(tenantId, tx => ...)` | Implemented |
| Worker raw SQL  | `withWorkerTenantContext(tenantId, ...)`    | Deferred    |

- TSQL-01 Tenant helper ต้องเปิด transaction และตั้ง `app.tenant_id`
  ด้วย transaction-local `set_config(..., true)` ทุก query
  รวมถึง `tx.unsafe` ต้องใช้ `tx` ที่ส่งให้
  ห้ามใช้ global หรือ pooled handle
- TSQL-02 ต้อง bind ค่าทั้งหมด และระบุ tenant และ Project predicates
  อย่างชัดเจนควบคู่กับ RLS ต้องใช้ allow-list สำหรับ identifiers, sort columns
  และทิศทางการ sort ต้องตรวจสอบ parent scope ไม่ใช่เพียง foreign keys
- TSQL-03 Runtime roles ต้องเป็น non-owner และ `NOBYPASSRLS`
  สงวน owner access ไว้สำหรับ DDL; migrations ต้อง resolve `DATABASE_OWNER_URL`
  ก่อน `DATABASE_URL` ห้ามให้สิทธิ์ superuser แก่ runtime
- TSQL-04 Domain tables ที่มี `tenant_id` ต้องมี `USING`
  และ `WITH CHECK` policies เฉพาะแต่ละ table, restrictive context guards
  และ `FORCE ROW LEVEL SECURITY`
- TSQL-05 อ่าน shared-catalog rows (`tenant_id IS NULL`) ได้เมื่อมี
  tenant context ที่ถูกต้อง ห้าม tenant contexts เขียน rows เหล่านี้
- TSQL-06 ข้อจำกัด pre-tenant: global auth tables (`user`, `session`,
  `account`, `verification`, `organization`, `member`, `invitation`,
  `twoFactor`) ไม่ถูกจำกัด tenant scope ด้วย RLS เพราะ login, signup gate
  และ membership resolution ทำงานก่อนมี tenant context ใด ๆ
  และผู้ใช้เป็นสมาชิกข้าม organizations ได้ การแยกข้อมูลของ tables เหล่านี้
  อาศัย lookups ที่ตรวจสอบ membership และ auth queries ที่ผูกกับ organization
  ห้ามอาศัย `app.tenant_id`
- TSQL-07 Runtime role ต้องได้รับ DML grants บน auth tables
  เท่าที่จำเป็นจาก migrations และยังคงเป็น non-owner
  เพื่อให้ RLS มีผลบังคับกับ domain tables เมื่อเพิ่มเข้ามา
- TSQL-08 ต้อง review database role ที่ตั้งใจใช้ในทุกช่องทาง pre-tenant
  lookup, scheduler discovery, cross-tenant maintenance
  และ ledger access

### 3.5 Scan orchestration and completion gate (Deferred)

```text
API / scheduler -> scan queued -> COMMIT -> scan-orchestrate
  -> running + scan_tasks + total_tasks -> COMMIT -> scan-collect
  -> Prowler OCSF -> resources_current
  -> claim rule_evaluate_dispatched_at -> COMMIT total_rule_evaluate_jobs
  -> enqueue rule-evaluate -> finding_occurrences + finding_current
  -> notify-deliver (independent)
terminal counters -> tryFinalizeScan (both gates, CAS from running)
  -> terminal status -> reconcileStaleFindings -> refreshDailyAggregates
```

- SCAN-01 ต้องมี scan ที่ยังไม่เข้าสู่สถานะ terminal ได้เพียงรายการเดียวต่อ
  `(tenant_id, project_id)` โดยบังคับด้วย partial unique index ต้องแปลง
  uniqueness violation รวมถึง cause ที่ถูกห่อไว้ ให้เป็น 409
- SCAN-02 ต้อง commit สถานะ queued ก่อน enqueue หากมีรายงานว่า enqueue
  ล้มเหลว ต้องชดเชยโดยเปลี่ยนเป็น `failed` พร้อมสรุปข้อผิดพลาด
- SCAN-03 Scheduler ต้อง poll ตามช่วงเวลาคงที่และจำกัดขนาด batch
  (baseline ทุก 60 s, batch ละ 10) ต้อง claim งานที่ถึงกำหนดด้วย
  `FOR UPDATE SKIP LOCKED` แล้ว commit ก่อน enqueue พร้อมการชดเชยเมื่อ enqueue ล้มเหลว
- SCAN-04 อัตลักษณ์ของ task คือ `(scan_id, cloud_account_id, region)`
  ต้อง deduplicate ด้วย `jobId` ของ BullMQ ห้ามใช้ชื่อ job โดยใช้
  region สำรอง `us-east-1` และใช้ task `global` หนึ่งรายการสำหรับ GCP
  ต้องแนบ snapshot ของ scope และ configuration ไว้ใน task
- SCAN-05 ต้องรัน Prowler เป็น spawned process โดยส่ง argument array
  กำหนด timeout ที่มีขอบเขต (baseline 10 min) และเก็บ output `json-ocsf`
  ใน temporary directory ต้องยอมรับ exit code 0 และ 2 และจำแนก exit code
  อื่นกับ exception เป็น retryable หรือ terminal ให้สอดคล้องกับสถานะใน SQL
- SCAN-06 ต้องเลือก credentials ตาม `auth_mode` และเขียนไฟล์ credentials
  ชั่วคราวด้วย mode `0600` พร้อมลบใน `finally` ห้ามใส่ credentials
  ที่ถอดรหัสแล้วใน job หรือสรุปข้อมูลใน ledger
- SCAN-07 ต้อง dispatch เฉพาะรายการที่ check-id ตรงกับ rule ของ Project
  และ provider ที่เปิดใช้งาน ต้องเก็บ `effective_ruleset` และ
  `ruleSnapshot` ณ เวลา dispatch ไว้
- SCAN-08 ต้อง claim `rule_evaluate_dispatched_at IS NULL` แบบ atomic
  และ commit การเพิ่ม `total_rule_evaluate_jobs` ให้ครบก่อน enqueue
  รายการแรก ต้องกู้คืนได้ทั้งกรณี claim แล้วแต่ยังไม่ enqueue และ batch ที่ enqueue ไปเพียงบางส่วน
- SCAN-09 ต้อง insert occurrence ให้ปลอดภัยต่อ retry โดยใช้ uniqueness
  `(scan_id, rule_id, resource_uid, observed_month)` และ upsert current
  findings บน `(tenant_id, project_id, provider, rule_id, resource_uid)`
  ต้องรองรับ retry ระหว่างการเขียนที่ commit แยกกัน

Completion gate ต้องผ่านทั้งสองเงื่อนไขจึงจะ finalize ตามปกติได้:

1. `total_tasks > 0` และ `completed_tasks + failed_tasks >= total_tasks`;
   collection task ที่ถูกยกเลิกให้นับเป็น failed ในเงื่อนไขนี้
2. `completed_rule_evaluate_jobs + failed_rule_evaluate_jobs >=
   total_rule_evaluate_jobs`; ต้องนับเฉพาะงานที่เสร็จหรือความล้มเหลวที่ใช้ attempt
   จนครบแล้ว ห้ามนับความล้มเหลวที่ยัง retry ได้

- SCAN-10 ต้องเลือก finalizer เพียงตัวเดียวด้วย
  `UPDATE ... WHERE status = 'running' RETURNING id` โดย terminal event
  ที่ซ้ำและ collection retry ต้องปลอดภัย
- SCAN-11 ลำดับความสำคัญของสถานะ: มีคำขอยกเลิก -> `cancelled`;
  มิฉะนั้น หาก collection หรือ evaluation ใดล้มเหลว -> `completed_with_errors`;
  มิฉะนั้น -> `completed` ต้องจัดการการยกเลิกก่อนมี task ความล้มเหลวจากการไม่มี account
  และ orchestration error นอก gate ที่กำหนดให้ต้องมี task
- SCAN-12 งานหลังผ่าน gate เป็นอิสระจากสถานะ terminal:
  `reconcileStaleFindings` ครอบคลุมเฉพาะ effective rules และส่วนของ
  provider/account/region/service ที่ครอบคลุมในการ scan; `refreshDailyAggregates`
  สร้างข้อมูลจาก current findings และ framework mappings สถานะ terminal
  ไม่ได้ยืนยันความสำเร็จของ notification, reconciliation หรือ aggregate
  ต้องแสดงความล้มเหลวและการกู้คืนของงานเหล่านี้แยกกัน
- SCAN-13 Sweeper ต้องเปลี่ยน scan ที่ไม่มีความเคลื่อนไหวเป็น failed เมื่อพ้นช่วงเวลา
  inactivity ที่กำหนด (baseline sweep ทุก 5 min, inactivity 30 min) หลังจาก
  เปรียบเทียบ counter กับงานที่ waiting, active และ delayed แล้ว
  การซ่อม counter ไม่ใช่การกู้คืนแบบ exactly-once

### 3.6 Queue topology (Deferred)

| Queue               | หน้าที่                              | Conc. | Attempts |
| ------------------- | ----------------------------------- | ----: | -------: |
| `scan-orchestrate`  | วางแผน task และกระจายงาน             |     2 |        3 |
| `scan-collect`      | เก็บข้อมูลด้วย Prowler               |     3 |        3 |
| `rule-evaluate`     | ประเมิน findings และขอให้แจ้งเตือน    |     5 |        3 |
| `report-generate`   | สร้าง XLSX/CSV/JSON                  |     2 |        3 |
| `health-collect`    | เก็บข้อมูลสุขภาพ infrastructure ของ AWS |     5 |        3 |
| `notify-deliver`    | นโยบายการส่งและผลการส่ง              |    10 |        3 |
| `prowler-rule-sync` | ดูแล rule catalog กลางของ provider  |     1 |        1 |
| `health-check`      | ทำ synthetic monitoring             |    10 |        3 |
| `slo-recalculate`   | ดูแล service objectives             |     5 |        3 |

- QUE-01 Concurrency และ attempts เป็น baseline ต่อ worker instance
  โดยใช้ exponential backoff เริ่มจาก 5 s ลำดับการเลือกค่าคือ override
  ราย queue -> ค่าเริ่มต้นของ worker -> ค่าที่มีในระบบ `prowler-rule-sync`
  รับเฉพาะ override ที่ระบุให้ queue นี้โดยตรง ห้ามใช้ global override
- QUE-02 Concurrency 1 ไม่ใช่ distributed singleton ต้องบังคับ
  พฤติกรรม singleton ใน SQL
- QUE-03 ทุก job ต้องมี `tenantId` ส่วน shared-catalog job ต้องได้รับ
  authorization แยกต่างหากผ่าน `requestedByTenantId` ห้ามใช้ identity
  ใน payload เป็น SQL context (TSQL-01)
- QUE-04 ต้องแยกสถานะ retryable, delayed และ exhausted ออกจากกัน
  และติดตาม ledger reconciliation รวมถึงความล้มเหลวระหว่าง enqueue กับการบันทึก ledger
- QUE-05 ปลายทาง notification ต้องมี scope ตาม tenant และ Project
  พร้อม policy และ mute window ต้องบันทึกผลลัพธ์ทุกรายการ ห้ามส่งซ้ำ
  เมื่อส่งสำเร็จแล้วแต่ retry เพื่อบันทึกข้อมูลประกอบ
- QUE-06 ต้อง pin เวอร์ชัน Prowler จนกว่าจะมีการเปลี่ยนแปลงที่ได้รับอนุมัติ
  และตรวจสอบ compatibility แล้ว ต้องแยกการเก็บข้อมูล security ด้วย Prowler,
  ข้อมูล health ผ่าน AWS SDK และ monitoring ผ่าน HTTP/DNS/TCP ออกจากกัน
  และแยก integration imports กับ credentials ออกจาก live OAuth sync

### 3.7 Web SPA data integration

- FE-01 Typed client ใน `apps/web/src/lib/api` ต้องเรียก `/api` พร้อม
  credentials และรองรับ JSON, response 204 ที่ไม่มีเนื้อหา และ response ที่ไม่ใช่ OK
- FE-02 ต้อง validate response ด้วย schema จาก `api-contract` ณ runtime
  TypeScript generics ไม่ได้ validate ข้อมูล `ApiError` จะเปิดเผย
  `error.code` และ `details` จาก server เฉพาะเมื่อ map ไว้อย่างชัดเจน
- FE-03 ลำดับการเลือก tenant จาก `/me/context`: organization ใน memory
  ที่ยังใช้ได้ -> `lastActiveTenantId` ที่ยังใช้ได้ -> membership แรก
- FE-04 ต้องเปลี่ยน tenant หลังจาก `PATCH /me/active-org` สำเร็จเท่านั้น
  จากนั้นจึงอัปเดต snapshot ที่ router ใช้ รีเซ็ต Project และล้าง
  query ที่ผูกกับ tenant
- FE-05 ต้องกำหนด query key จาก `organizationId`, `projectId`, filters
  และ ids ที่เลือก (baseline `staleTime: 30_000`, `retry: 1`) ห้ามให้
  response ที่อยู่ระหว่างรับกลับมาเติมข้อมูลใน view ของ tenant อื่น
- FE-06 ต้อง poll scan ที่ active (baseline ทุก 5 s) จนกว่า shared
  active-scan predicate จะระบุว่าเข้าสู่สถานะ terminal ต้องใช้ polling
  ไม่ใช่ WebSocket หรือ SSE
- FE-07 Role helper และ router helper มีไว้เพื่อ UX เท่านั้น
  ส่วน authorization อยู่ที่ API
- FE-08 โครงสร้าง UI, tokens และ accessibility ต้องเป็นไปตาม
  `docs/design-system.md`

## 4. Persistence model

```text
organizations (= tenants) -- memberships(role) -- users
  -- sessions / accounts / MFA
  +-- teams -- team_memberships
  +-- projects -- project_cloud_accounts / project_frameworks
  +-- frameworks -- framework_mappings -- rules
  +-- scan_schedules -- scans -- scan_tasks
  +-- finding_occurrences -> finding_current -> daily aggregates
  +-- resources_current -- resource_edges
  +-- services -- owners / dependencies
  +-- monitors -- targets / runs -- service_objectives
  +-- reports / org_credentials
  +-- notification_destinations -- notification_deliveries
  +-- employees / service_integrations
  +-- audit_events / queue_jobs
```

- DATA-01 User id ใช้ text; organization และ Project id ใช้ UUID;
  role เป็นไปตาม AUTH-06 ต้องบังคับความสัมพันธ์ที่ปลอดภัยต่อ tenant
  และ `last_active_tenant_id` ต้องมี membership ที่ยังใช้ได้
- DATA-02 ต้องจัดเก็บ schedule, ยอดรวมและผลลัพธ์ของ task และ evaluation,
  การยกเลิก, effective rulesets และ dispatch claims ใน SQL
  ห้ามเก็บเป็น progress ใน Redis เพียงอย่างเดียว
- DATA-03 ต้องแยกประวัติ occurrence รายเดือน, current findings และสรุปรายวัน
  เป็นคนละตาราง (ไม่ใช่ event sourcing) และแยกข้อมูล employee
  กับ provider inventory ออกจาก login account
- DATA-04 `audit_events` และ `queue_jobs` เป็นบันทึกการปฏิบัติงาน
  ไม่ใช่ business state ส่วน ledger ไม่ใช่ queue engine
- DATA-05 Report ต้องเก็บ bytes ของ XLSX/CSV/JSON ใน `reports.content`;
  ไม่ใช้ PDF และไม่ใช้ object storage ต้องอ่านข้อมูลใน tenant transaction
  แล้ว serialize นอก transaction ก่อนจัดเก็บใน transaction ที่มี scope
- DATA-06 Migration เป็นไฟล์ `NNNN_*.sql` ที่มีลำดับ รันด้วย custom runner
  โดยใช้ `__nightwatch_migrations` ติดตามสถานะ พร้อม advisory locking
  และหนึ่ง transaction ต่อ migration ห้ามใช้ `drizzle-kit push` หรือ `migrate`
  ห้ามเขียน migration ที่ apply แล้วใหม่ ต้อง review SQL ที่ generate
  โดยเทียบกับลำดับ migration ที่ apply แล้ว
- DATA-07 แต่ละ migration ต้องมี constraints, RLS policies, grants
  และ partitions ตาม scope ของตัวเอง
- DATA-08 ต้องสร้าง monthly partition สำหรับ `audit_events`, `monitor_runs`
  และ `finding_occurrences` ล่วงหน้า 12 เดือน ด้วย scheduled DDL
  ภายใต้ owner role ห้ามสร้างขณะรับ request หรือจาก DML worker

## 5. Cross-cutting contracts

- XC-01 Validation: ใช้ Zod schema ใน `api-contract` สำหรับ input
  และใช้ validator ร่วมกันจาก `shared`
- XC-02 Errors: `AppError(status, code, message, details?)` ->
  `{ error: { code, message, details? } }` ลำดับ argument ต้องเริ่มด้วย
  status (decision F001-ERR1) ห้ามนำ overload แบบ code-first กลับมา
  ใน environment ที่ใกล้เคียง production ต้องแสดง unknown error แบบทั่วไป
- XC-03 Audit event ต้องมี request context และ actor context พร้อมระบุว่า
  เป็น transactional หรือ best-effort ห้ามใส่ secrets หรือข้อมูลที่ต้องคุ้มครอง
  ใน payload
- XC-04 Encryption: AES-256-GCM, IV แบบสุ่มขนาด 12-byte, tag ขนาด 16-byte,
  key แบบ base64url ขนาด 32-byte; มี active key หนึ่งรายการและเก็บ key เก่าพร้อมเวอร์ชันไว้
  ไม่ใช่ KMS envelope encryption
- XC-05 SSRF: ทุก outbound HTTP(S) call ต้องใช้ shared helper
  ซึ่งครอบคลุม embedded credentials, blocked headers, private addresses,
  redirects, การเปลี่ยน DNS และพฤติกรรมขณะเชื่อมต่อ
- XC-06 Rate limiting: ใช้ Redis sliding window แยกจาก auth throttling
  โดยมี limiter timeout 2-second ต้องทดสอบกรณี limiter error
  ห้ามสันนิษฐานว่าเป็น fail-closed
- XC-07 Logging: ใช้ structured Pino ใน runtime ที่ใกล้เคียง production
  พร้อม redaction แยกตาม entrypoint ห้าม log ทั้ง job, credentials,
  provider response ที่มี secrets หรือลิงก์ verification, reset
  และ invitation
- XC-08 Health: `/health` ใช้ตรวจ liveness; `/ready` รัน
  `SELECT 1` กับฐานข้อมูล -> 200/503 และเพิ่ม Redis ping เมื่อมี queue
  Readiness ไม่ได้ยืนยันว่า RLS, partitions, SMTP หรือการทำงานของ worker ใช้งานได้
- XC-09 Mail: ต้องใช้ SMTP จริงพร้อม `verify()` ตอน startup
  ห้าม fallback ไปใช้ fake transport ในทุก environment

## 6. Deployment topology

```text
Web SPA, Landing: independent static builds and deployments
API image:    owner-role pre-deploy migrations + partition bootstrap
              -> application-role runtime -> /health, /ready
Worker image: combined consumers + scheduler/dispatcher loops,
              or explicitly configured separate roles
PostgreSQL + Redis; owner-role monthly partition-maintenance cron
```

- DEP-01 ต้องเลือกอย่างชัดเจนว่าจะใช้ worker entrypoint แบบรวมหรือแยก
  Default entrypoint เริ่มเฉพาะ main consumers ไม่ใช่ทุก role ต้องตรวจว่า
  consumer และ scheduler ใดทำงานอยู่ก่อนเพิ่มจำนวน replica
- DEP-02 Container ต้องรันแบบ non-root และ pin runtime dependencies
  โดย environment ตอน build และ runtime ต้องสอดคล้องกัน
- DEP-03 ต้องทดสอบ shutdown, job ที่ถูกขัดจังหวะหรือ stalled และผลของงานที่
  ปลอดภัยต่อ retry ห้ามสันนิษฐานว่าจะ drain งานได้ครบ
- DEP-04 ต้องทำ partition maintenance ระหว่างการ deploy แต่ละครั้ง (DATA-08)
- DEP-05 ต้องตรวจสอบ TLS, origins, secrets, จำนวน replica, credentials
  และสิทธิ์ฐานข้อมูลใน environment เป้าหมาย การใช้ production credentials,
  การทำ migration, deployment และ release ต้องได้รับ authorization
  อย่างชัดเจน

## 7. Quality attribute checklists

ใช้ checklist เหล่านี้ในการออกแบบ review หรือ verify การเปลี่ยนแปลง แต่ละข้ออ้างอิง rules ที่ต้องตรวจ ให้ทำเครื่องหมายว่าผ่านเฉพาะเมื่อมีหลักฐานรองรับ

### 7.1 Security and tenant isolation

- [ ] จัดประเภท route เป็น tenant-protected, pre-tenant หรือ platform แล้ว (REQ-02)
- [ ] ตรวจสอบ membership ก่อนเข้าถึงข้อมูล และไม่เชื่อถือ tenant ที่ client ส่งมาโดยไม่ตรวจสอบ (REQ-03, REQ-04)
- [ ] ทุก operation มี permission guard ที่ระบุชัดเจน และ platform access จำกัดอยู่เฉพาะ operation นั้น (REQ-06, CTX-04)
- [ ] Tenant SQL ทำงานผ่าน helper โดยใช้ `tx` ที่ได้รับ พร้อม predicates ที่ระบุ scope ชัดเจน (TSQL-01, TSQL-02)
- [ ] Migration ของ domain table ใหม่มี RLS policies, FORCE RLS และ runtime grants ครบถ้วน (TSQL-04, DATA-07)
- [ ] การเปลี่ยน auth state ยังคงปลอดภัยเมื่อเกิด replay หรือ concurrency (AUTH-04, AUTH-05, ORG-04)
- [ ] การเพิกถอนสิทธิ์มีผลกับ operations ถัดไป ไม่ใช่เฉพาะ response ทันทีหลังเพิกถอน (ORG-03, ORG-04)
- [ ] ไม่มี secrets หรือ links ใน logs, jobs, ledger หรือ audit payloads (XC-03, XC-07, SCAN-06)
- [ ] Outbound calls ผ่าน SSRF helpers (XC-05)

### 7.2 Data integrity and concurrency

- [ ] บังคับ invariants ใน SQL ด้วย unique indexes, claims และ CAS ไม่ใช่อาศัย code เพียงอย่างเดียว (SCAN-01, SCAN-08, SCAN-10, QUE-02)
- [ ] Commit ก่อน enqueue และมี compensation (CON-06, SCAN-02)
- [ ] Writes เป็น idempotent และ totals ปลอดภัยต่อ retries (SCAN-08, SCAN-09, QUE-05)
- [ ] Migrations เรียงลำดับ เป็นการเพิ่มต่อจากของเดิม (additive) และไม่มีการเขียนทับ migration เดิม (DATA-06)

### 7.3 Reliability and recovery

- [ ] แยกสถานะ retryable, exhausted และ terminal ออกจากกันชัดเจน (QUE-04, SCAN-05)
- [ ] กู้คืนจาก partial failures ได้ ทั้ง claim-before-enqueue, partial batches และ stalled scans (SCAN-08, SCAN-13)
- [ ] งานหลังเปลี่ยน terminal status รายงาน failures ของตัวเอง (SCAN-12)
- [ ] ทดลอง shutdown และกรณี jobs ถูกขัดจังหวะแล้ว (DEP-03)

### 7.4 Observability and audit

- [ ] ใช้ structured logs พร้อม redaction ที่ทุก entrypoint (XC-07)
- [ ] บันทึก audit สำหรับ security-relevant events และ denials โดยไม่มี protected data (REQ-05, ORG-05, XC-03)
- [ ] Health และ readiness สะท้อน dependencies จริงและข้อจำกัดของการตรวจ (XC-08)
- [ ] สามารถสังเกต failures ของ ledger และ reconciliation ได้ (QUE-04)

### 7.5 Performance and scalability

- [ ] Network และ CPU work อยู่นอก SQL transactions (REQ-08)
- [ ] ระบุ batch และ concurrency limits ชัดเจน โดยกำหนดต่อ instance (SCAN-03, QUE-01)
- [ ] Query keys และ cache แยกตาม tenant และ Project (FE-05)
- [ ] Partitioned tables มี partitions เตรียมไว้ล่วงหน้า (DATA-08)

### 7.6 Maintainability and boundaries

- [ ] เคารพ dependency direction และ package layout (PKG-01 to PKG-04)
- [ ] เปลี่ยน contracts ใน `api-contract` ก่อน แล้วจึงปรับ clients และ consumers (FE-02, XC-02)
- [ ] ไม่มี abstraction ที่สร้างเผื่อโดยไร้ความจำเป็น, shim หรือ convention อีกชุดที่แข่งขันกับของเดิม (CON-02, PKG-03)
- [ ] Pin เวอร์ชัน Prowler และ runtime dependencies (QUE-06, DEP-02)

### 7.7 Privacy and data protection

- [ ] เข้ารหัส credentials ขณะจัดเก็บ (at rest) ด้วย versioned keys (XC-04)
- [ ] Temporary credential files ใช้ mode 0600 และถูกลบหลังใช้งาน (SCAN-06)
- [ ] ไม่ใส่ personal data หรือ secrets ใน logs และ audit payloads (XC-03, XC-07)
- [ ] บันทึกการพิจารณาว่าข้อกำกับ เช่น GDPR ใช้กับระบบหรือไม่ เป็น decision ที่มี owner ห้ามสันนิษฐานเอง

### 7.8 Operability and deployability

- [ ] แยก owner role กับ runtime role และรัน migrations แบบ pre-deploy ด้วย owner role (TSQL-03, DEP-01)
- [ ] เลือก Worker entrypoint roles อย่างชัดเจนก่อน scaling (DEP-01)
- [ ] ตรวจ TLS, origins, secrets และ privileges ใน target environment (DEP-05)
- [ ] ตรวจ SMTP ตอน startup และไม่มี fake transport (XC-09)

### 7.9 Accessibility and UX

- [ ] ปฏิบัติตาม design system และครอบคลุม interaction กับ accessibility states (FE-08)
- [ ] Authorization ไม่พึ่ง UI helpers (FE-07)

## 8. Verification guidelines

ข้อกำหนดด้านหลักฐานสำหรับผู้ implement และ QA Engineer ใช้ร่วมกับ commands และ gates ใน `scripts/quality/README.md`

- VER-01 Mocks พิสูจน์ RLS หรือ role denial ไม่ได้ ต้องตรวจการปฏิเสธด้วย database roles จริง, tenant A/B isolation, cross-Project not-found และพฤติกรรมเมื่อไม่มี context โดยใช้ non-owner roles บน dedicated disposable database
- VER-02 ตรวจ pre-tenant lookups, scheduler discovery และ ledger access แยกจาก tenant paths (TSQL-08)
- VER-03 เมื่อเปลี่ยน stateful auth หรือ authorization ต้องตรวจ lifecycle: grant -> revoke -> attempted reuse; pending -> consumed -> replay; identity หรือ session เปลี่ยน -> stale authorization
- VER-04 สำหรับ concurrency invariants ต้องบังคับให้เกิด interleaving เป้าหมายด้วย controlled synchronization ที่มีขอบเขตชัดเจน การส่ง concurrent requests อย่างเดียวไม่ใช่หลักฐาน (SCAN-01, AUTH-05, ORG-04)
- VER-05 ครอบคลุม active-scan races, partial writes และ enqueues, dispatch-claim crashes, exhausted retries, cancellation, duplicates และ concurrent finalizers ทั้ง SQL/Redis และ send/bookkeeping ยังคงเป็น non-atomic
- VER-06 ตรวจ notification delivery, report content, reconciliation coverage, การกู้คืน aggregates หลังเปลี่ยน terminal status และรอยต่อเดือน แยกจาก terminal status
- VER-07 ทดลอง UI auth flows ใน browser จริง (`e2e/`, Playwright) ตั้งแต่ entry point จนถึงปลายทางที่สังเกตได้ Manual workaround ใช้ช่วยวินิจฉัย ไม่ใช่หลักฐานว่าระบบทำงานถูกต้อง
- VER-08 Health 200, typecheck, build หรือ mock ที่ผ่าน ไม่ได้ยืนยันว่า integrations, recovery หรือ delivery ทำงานถูกต้อง
- VER-09 เมื่อสั่ง integration run โดยชัดเจนแต่ database ใช้งานไม่ได้ ต้อง fail ให้เห็นชัด ผล no-DB ที่ผ่านไม่ใช่ integration evidence

## 9. Decisions referenced

- F001-ERR1: `AppError` ใช้ argument order แบบ status-first (XC-02) ที่มา: user decision; เอกสาร planning ของ F-001 ไม่ได้อยู่ใน repository
