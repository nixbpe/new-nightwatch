# สเปกการ implement: In-app Notification

**ฉบับ:** `notification-tech-spec/2026-09-25-consolidated`  
**สถานะ:** Technical design และ [`notification-api/1`](notification-api-contract.md) มี implementation สำหรับ Zod/OpenAPI, API, DB, Worker และ Web; ผล acceptance ทางเทคนิคอ้างอิง manifest/gates ของ candidate ที่ตรวจจริง ไม่เท่ากับ Product Owner acceptance หรือสิทธิ release  
**แหล่งขอบเขต:** คำตัดสินของผู้ใช้ในการสนทนาเรื่อง Notification ฉบับนี้ใช้แทนร่างในแชตก่อนหน้า เกณฑ์ PO-authored AC-01–AC-37 freeze ที่ [`draft:F-002-AC-1`](notification-feature-acceptance.md) แล้ว; การแก้ขอบเขตต้องออก acceptanceVersion ใหม่

## 1. Product contract

### เหตุการณ์รุ่นแรก

| Event | จุดเกิดเหตุการณ์ | ผู้รับ | การตั้งค่า |
| --- | --- | --- | --- |
| `ORG-NOTIFICATION-SETTINGS-CHANGED` | Owner/Admin เปลี่ยน Organization notification setting จริง | Owner/Admin **คนอื่น**ที่มีสิทธิ์ ณ originating commit และยังมีสิทธิ์ตอนส่ง | Owner/Admin เปิด–ปิด event นี้ได้; ค่าเริ่มต้น **เปิด** |
| `PASSWORD_CHANGED` | Credential state เปลี่ยนและ commit จริงจาก `change-password` หรือ `reset-password` รวมกรณี reset สร้าง credential ครั้งแรก | เจ้าของบัญชีเท่านั้น | Organization settings ปิดไม่ได้ |
| `MFA_ENABLED` / `MFA_DISABLED` | Effective **verified** MFA state เปลี่ยนและ commit จริง ไม่ใช่เพียงเริ่ม enrollment | เจ้าของบัญชีเท่านั้น | Organization settings ปิดไม่ได้ |

Role change และ member revoke **ไม่ใช่ notification origins** ของรุ่นแรก การ cutover เส้นทางเหล่านี้มีไว้ serialize recipient eligibility เท่านั้น และต้องคง security events เดิมที่อยู่นอก Feature นี้

Account-security event ยึด auth-state transition ที่ commit จริง แม้ขั้นตอน session/cookie ภายหลังล้มเหลวจน endpoint ตอบ non-2xx การใช้ reset token ไปโดยที่ credential ไม่เปลี่ยนไม่สร้าง `PASSWORD_CHANGED` Personal notification ผูกกับบัญชีและเห็นได้ไม่ว่า active Organization ใด

### Organization settings และ self-toggle

เฉพาะสมาชิก Organization role `owner`/`admin` ที่มีสิทธิ์ปัจจุบันจึงอ่านหรือแก้ notification settings ได้ รุ่นแรกมี switch เปิด–ปิด `ORG-NOTIFICATION-SETTINGS-CHANGED` โดยเริ่มต้น **เปิด** การเปลี่ยน switch ของ event นี้เองใช้ค่า **ก่อนเปลี่ยน** ตัดสินว่าจะสร้าง intent หรือไม่: เปิด→ปิดยังแจ้ง Owner/Admin คนอื่นในครั้งนั้น; ปิด→เปิดยังไม่แจ้งในครั้งนั้น การบันทึกค่าเดิมซ้ำไม่สร้าง event Notification แสดงผู้เปลี่ยน เวลา และชื่อหมวด settings ไม่แสดงค่าก่อน/หลัง

### Inbox และอายุข้อมูล

ไอคอนอยู่มุมขวาบนของ authenticated app shell เลือกไอคอนเปิด popover; “ดูทั้งหมด” เปิด Notification Center; เลือกรายการเปิด detail และทำเครื่องหมายรายการนั้นว่าอ่านแล้ว มี unread badge, mark-one และ mark-all Inbox ร่วมแสดง personal items ของเจ้าของบัญชี + Organization items ของ **active Organization ที่ server ตรวจแล้วเท่านั้น** Mark-all มีผลเฉพาะ personal items และรายการของ active Organization ไม่แตะ Organization อื่น หากไม่มี active Organization หรือ mirror ที่จำไว้ใช้ไม่ได้ ให้ตรวจสมาชิกภาพ ปรับ mirror เป็น null และยังแสดง personal items; ห้ามให้ stale Org ปิดกั้น personal notifications การสลับ Organization ต้องไม่แสดงผล request เก่าของ Organization ก่อนหน้า

รายการหมดอายุ **30 วันนับจากเวลา event เกิด** ไม่ใช่เวลา enqueue, ส่งสำเร็จ หรืออ่าน List/detail/count ไม่แสดงรายการหมดอายุ แม้ batch cleanup ยังไม่ทำงาน

## 2. Data และ authorization boundaries

แยก **durable notification intent** ออกจาก **user-visible inbox item** Originating business mutation กับ intent ต้อง commit หรือ rollback ร่วมกัน Enqueue ทำหลัง commit ได้ แต่ transport ห้ามเป็นที่เก็บ state เพียงแห่งเดียว Stable business mutation identity และ database uniqueness ของ `(origin, recipient)` ป้องกันผลซ้ำ Retry ทำ bookkeeping ซ้ำได้ แต่ห้ามสร้าง visible item ซ้ำหรือ reset `read_at`

Organization intents, candidate recipients, settings และ inbox rows ต้องมี `tenant_id` ใช้ verified tenant transaction, explicit scope predicates และ PostgreSQL RLS พร้อม `FORCE ROW LEVEL SECURITY` Snapshot candidate recipient IDs ใน origin transaction ผู้เพิ่งได้รับ role ภายหลังไม่ได้ย้อนหลัง; candidate ที่ถูก revoke/demote ถูกตัดออกเมื่อส่ง

Account notification intents และ inbox rows เป็น **account-scoped domain data ใหม่** ไม่ใช่ global auth tables ที่ `TSQL-06` ระบุชื่อ ตาม `TSQL-13` ต้องใช้ PostgreSQL RLS พร้อม `FORCE ROW LEVEL SECURITY`, `user_id` predicate, transaction-local verified account context และ least-privilege grants `withAccountContext` ต้องใช้ transaction handle เดียวกันทุก statement ค่า context จาก request หรือ queue payload ไม่ใช่ authorization ในตัวเอง API derive account จาก verified session; Worker derive จาก claim บน **dispatch ledger แยกต่างหาก** ที่ผูก user ID และ intent ID กับ committed origin Ledger มี policy/grants เฉพาะสำหรับ bounded pre-context discovery; ห้ามค้นงานโดยข้าม account-domain RLS ซึ่งยังไม่มี `app.user_id` Runtime roles เป็น non-owner และ `NOBYPASSRLS`; DB owner connection ใช้ DDL/migrations ไม่ใช้ HTTP หรือ Worker DML

Intent, job payload, inbox presentation, audit และ logs ห้ามมี password, hash, reset token, MFA secret, backup codes, session cookie หรือ secrets อื่น Retention ของ operational/audit records เป็น policy แยก; ข้อกำหนด inbox 30 วันไม่เปลี่ยน policy นั้นโดยปริยาย

## 3. Atomic origins

### คง Better Auth endpoints สำหรับ Password/MFA

คง endpoint และพฤติกรรม Better Auth เดิม ทั้ง hashing, reset-token consumption, session/cookie และ security events **ไม่ cutover Password/MFA endpoints** แนวทาง technical design คือ wrapper แบบจำกัด scope ที่ DB-adapter write boundary: server-created request-local origin classifier ใช้แยก qualifying operations ส่วน Better Auth ยังทำ authentication Qualifying auth row write และ account notification intent insert ต้องใช้ **Drizzle transaction และ connection เดียวกัน** Direct trusted `auth.api` mutation paths ต้องมี coverage เทียบเท่า; route tag จาก browser ใช้ไม่ได้

- `change-password`: จับ credential password UPDATE ที่เปลี่ยน state จริง
- `reset-password`: จับ credential password UPDATE หรือ credential INSERT ครั้งแรก; ต้องแยกจาก signup INSERT และ OAuth/account-token updates
- MFA: แยก pending enrollment, verified enable, disable, re-enrollment และ re-verification; emit เฉพาะ effective verified-state transition หากต้องมี per-user transition projection/lock ต้องอัปเดตใน transaction เดียวกับ qualifying origin write และ intent

หาก Better Auth เรียก outer adapter transaction, wrapper ต้องส่ง wrapped transaction-bound adapter ผ่าน callback นั้น การเปิด pool transaction อีกวงละเมิด atomicity `databaseHooks.after`, UI/HTTP response callback หรือการเปิด Drizzle adapter transaction option อย่างเดียวไม่พิสูจน์สัญญานี้ Better Auth ปัจจุบัน consume reset verification token ก่อน credential write ในอีกขั้น: สเปกรับประกัน atomicity ของ **credential state + intent** ไม่อ้างว่า token consumption atomic รวมกัน Credential ที่ commit แล้วต้องมี intent แม้ขั้นตอนภายหลังทำให้ endpoint error

### Organization notification-settings API ใหม่

สร้าง **first-party notification-settings GET/PATCH ของ Organization** ไม่ intercept หรือแทน Better Auth `/organization/update` เพื่อสร้าง settings-change event PATCH ต้องใช้ transaction เดียว: acquire shared Organization lock → ตรวจ Owner/Admin ปัจจุบันซ้ำ → อ่านค่าเดิม → เปลี่ยนค่าจริง → snapshot Owner/Admin คนอื่นที่ eligible → สร้าง intent/candidates ตาม toggle ค่าเดิม → commit หาก intent ล้มเหลว settings change ต้อง rollback

### Recipient eligibility และ membership races

Cutover role-change/revoke mutations ที่กระทบ eligibility เป็น first-party routes ย้าย callers และปิด native bypass เส้นทางเหล่านี้ **ไม่ emit inbox event ของ Feature นี้** Settings PATCH, role change, revoke และ active-Organization synchronization ต้องใช้ lock/serialization protocol ร่วมกัน: lock ก่อนอ่าน membership, ตรวจ actor/target permissions ซ้ำใน transaction แล้วจึงเปลี่ยนค่าหรือ snapshot รักษา last-owner invariant และล้าง invalid active-Organization mirrors ตาม contract เดิม Worker ตรวจทั้ง immutable candidate จาก origin และ Owner/Admin membership ปัจจุบันตอนส่ง ผู้ได้รับ role หลัง origin ไม่ถูกเพิ่ม; ผู้ถูก revoke/demote ไม่ได้รับ

## 4. Queue, Worker และ recovery

`QUE-03` กำหนด job scope เป็น discriminated **tenant** หรือ **account**; tenant job มี tenant ID, account job มี account user ID โดย payload ใช้กำหนด SQL context ไม่ได้ สำหรับ Feature นี้ใช้ channel `in-app-materialize` ตาม `docs/architecture.md` §4.4 (baseline concurrency 5, attempts 3); **ไม่ใช้** `notify-deliver` ซึ่ง `QUE-05` กำหนดสำหรับ tenant+Project notification destinations Shared-catalog jobs ยังใช้ authorization rule ของตนเอง; account job ห้ามใช้ tenant ID ปลอมหรือ remembered tenant

Dispatcher/Worker ใช้ SQL intent และ dispatch ledger แยกที่บันทึกพร้อม originating mutation เป็น source of truth; Redis เป็น transport Ledger เก็บเฉพาะ scope/intent IDs และ claim/retry metadata ไม่เก็บ protected content Enqueue หลัง origin commit บันทึก dispatch failure เป็น durable retryable state กู้คืน claimed-but-not-enqueued และ partially enqueued work จำกัด claim/batch และทำ delivery แบบ idempotent Queue attempts ครบแล้วห้ามทิ้ง durable intent เงียบ ๆ Worker claim ledger ภายใต้ policy/grants จำกัดก่อน derive verified `app.user_id` แล้วจึงใช้ account-domain RLS ตรวจ committed intent และ recipient eligibility; ไม่เชื่อ `userId` จาก job Pending/failed item ไม่แสดงใน inbox แต่ backlog/failure ต้องตรวจสอบได้ฝั่งปฏิบัติการ

## 5. API contract

[`notification-api/1`](notification-api-contract.md) เป็นสัญญา endpoint สำหรับงาน API handler/client: route/method, Zod field shapes ที่ต้อง implement ใน `packages/api-contract`, cursor, scope, read transition, settings CAS และ exact HTTP/error codes ระบุแล้ว ห้ามเลือก business behavior ใหม่ระหว่างเขียน handler; OpenAPI ต้อง derive จาก routes จริง, generated Web types ต้องตรงกับ OpenAPI และ response ต้อง validate ด้วย Zod Runtime contract test ต้องพิสูจน์ permission, stale active-Organization fallback เป็น personal-only, cursor scope, settings conflict และ mark-all scope ตามเอกสารนั้น Better Auth native endpoints คง error shape เดิม

Zod schemas, Hono OpenAPI routes ทั้งเจ็ด, API handlers และ generated Web types มี source แล้ว; ต้องตรวจ parity และ integration gates บน candidate ที่หยุดแก้ไขก่อนถือว่า acceptance ผ่าน

## 6. UI และ accessibility

แทน empty-only `NotificationsPopover` ปัจจุบันด้วยข้อมูล personal + active Organization จริง แยก loading, empty, content, denied และ failure; ห้ามแสดง illustrative items ให้ดูเหมือนข้อมูลจริงหรือใช้ empty แทน error Badge นับเฉพาะ visible unread items Popover, center, detail และ Owner/Admin settings ต้องรองรับ keyboard, accessible names, visible/returned focus, narrow viewport, text zoom 200% และทั้งสอง theme Read state อยู่ฝั่ง server ไม่ใช่ browser-only Query keys และ identity/tenant invalidation ต้องเป็นไปตาม `FE-05`, `FE-10`, `FE-11`

## 7. Migration, sequencing และ readiness

1. **Architecture contract:** `docs/architecture.md` ระบุ `TSQL-13` สำหรับ account-scoped RLS และ dispatch-ledger claim แยก และ `QUE-03` สำหรับ typed tenant/account job scope; migrations/helpers และ Worker path ของ in-app notification มี source และ focused runtime-role DB proof แล้ว แต่กฎอื่นที่ยัง Deferred ไม่เปลี่ยนสถานะโดยปริยาย
2. **Schema และ origin:** ordered SQL migrations, scope constraints, uniqueness, RLS, restricted claims, Better Auth adapter wrapper, Organization settings transaction และ membership cutover มี source และ focused real-DB tests; credential/MFA และ settings intent/dispatch failure injection ผ่านในระหว่าง build; migration ที่ applied ต้องคง bytes เดิม โดยเฉพาะ `0006_notification_account_mfa_backfill.sql` และ `0007_notification_dispatch_failure_summary.sql`
3. **Async และ API:** dispatcher/Worker ใน `apps/worker`, SQL recovery, API/Zod/OpenAPI และ generated Web client มี source; focused isolated DB+Redis scheduler queue-add/ack failure และ recovery, materialization/replay, completed-only inbox visibility และ sanitized SQL failure summary ถูกพิสูจน์ร่วมกับ candidate gates
4. **Integrated verification:** browser ของ personal + active Organization A/B, settings, worker materialization, keyboard และ responsive light/dark 200% อยู่ใน focused Chromium และ root E2E การอนุญาต deploy/release ต้องแยกจาก technical candidate verification

**Readiness ตาม slice:** Product policy, technical design, API contract และ PO acceptanceVersion `draft:F-002-AC-1` ถูก freeze แล้ว Implementation มี scoped proof, browser smoke, independent technical review และ quality/security gates บน candidate ที่ bind ตาม manifest; ตรวจ digest ปัจจุบันจากหลักฐาน handoff ไม่อนุมานจากวันที่หรือเอกสารนี้ เอกสารนี้ไม่ใช่ Product Owner acceptance หรือ release authorization

## 8. Required implementation proof

- บังคับ intent INSERT fail แล้วตรวจว่า credential/effective MFA หรือ Organization settings state rollback พร้อม intent Trace `change-password`, `reset-password` UPDATE/first-credential INSERT เทียบ signup, MFA pending/verified/disable/re-enrollment, direct auth calls, nested adapter transaction และ endpoint error ภายหลัง auth state commit แล้ว Reset token ถูกใช้แต่ credential ไม่เปลี่ยนต้องไม่สร้าง event
- ทดสอบ promote/revoke/demote แข่งกับ Organization settings commit และ Worker delivery แบบ deterministic พิสูจน์ origin snapshot + delivery recheck, last-owner, active-Organization synchronization และการปิด stock-route bypass
- ใช้ runtime DB roles จริงพิสูจน์ missing account context, cross-user/cross-Organization denial, transaction-local context cleanup, restricted SQL claims และ forged tenant/account job payload
- Crash/retry รอบ origin commit, enqueue, claim, inbox write และ acknowledgement: ต้องมี visible item เดียว, recovery จาก durable state และคง `read_at`
- พิสูจน์ personal visibility ข้าม Organization switch/เมื่อไม่มี active Organization, mark-all isolation, detail mark-read, ขอบเขต 30 วันจาก event timestamp, การซ่อน expired item ก่อน cleanup และ cursor behavior ตาม **frozen** API contract
- Browser smoke popover → center → detail, settings permission, loading/empty/error states, keyboard/focus, responsive layout, text zoom 200% และทั้งสอง theme

**หลักฐานทางเทคนิค:** scoped auth/DB integration ตรวจ credential/MFA/settings rollback และ pre-existing MFA state, runtime-role RLS/ledger, membership/recipient race, API scope/settings, Worker scheduler enqueue/ack fault และ Redis materialization/replay รวม dispatch สอง origin ใน batch เดียว; focused Chromium ตรวจ password origin → inbox/read, personal + Organization A/B, composite-role admin `/me` → B settings CAS, UI loading/empty/denied/error และ 375px/200% ทั้งสอง theme. Security scan ต้องครอบคลุม tracked/untracked candidate paths และ bound manifest; ผล acceptance/release เป็นการตัดสินแยกจาก technical proof
