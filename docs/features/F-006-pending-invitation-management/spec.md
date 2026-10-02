# F-006 Technical Spec

Owner: Technical Lead Spec นี้เป็น source of truth ของ implementation และ review หลังผู้ใช้อนุมัติ อ้าง AC ใน `feature.md` โดยไม่ restate

ภาพรวม:
- `owner`/`admin` ดูรายการคำเชิญที่รอตอบรับ ส่งซ้ำ (resend) และยกเลิก (cancel) ได้ในหน้า "องค์กร → สมาชิก"
- API: endpoint ใหม่ 3 ตัว (list, resend, cancel) create ของ `F-004` เขียน `sent_at` และยกเลิกแถวหมดอายุของอีเมลเดียวกัน
- DB: migration `0018` เพิ่ม column `public_id` และ `sent_at` ในตาราง `invitation`
- Web: `PendingInvitationsSection` บน `OrganizationMembersPage` แบ่งหน้าละ 50 แถว
- Operator provisioning (`F-006-S04`): `bun run provision:organization` กับ Organization ที่มีอยู่ใช้ lock, โควตา และการหมุน id แบบเดียวกับ create และ resend
- ลำดับ PR: hotfix (ปิด native Better Auth route 9 path) → 01a → 01b → 02 → 03 → 04

| Field                | Value |
| -------------------- | ----- |
| Feature              | `F-006`, `acceptanceVersion` `F-006-AC-1` (`docs/features/F-006-pending-invitation-management/feature.md`) |
| Epic                 | `E-002`, `docs/epics/E-002-organization-member-governance.md` |
| Status               | Approved |
| Approved by user     | 2026-10-01 (freeze `F-006-AC-1`) |
| Start authorization  | ทั้ง `F-006` (hotfix → 01a → 01b → 02 → 03 → 04) |
| `COMMIT_MODE`        | owned-slice |
| `STOP_AT`            | merge-ready |

ศัพท์ที่ใช้ใน Spec นี้:
- `public_id` (`publicId` ใน API): UUID ที่ไม่ใช่ความลับ ใช้อ้างแถวคำเชิญใน list/resend/cancel ใช้ตอบรับคำเชิญไม่ได้
- หมุน id: เปลี่ยน `invitation.id` (bearer token ของลิงก์) เป็น UUID ใหม่ในแถวเดิม ลิงก์เดิมจึงใช้ไม่ได้
- `FOR UPDATE`: row lock ของ PostgreSQL transaction อื่นที่ขอ lock แถวเดียวกันต้องรอจนผู้ถือ commit หรือ rollback
- advisory lock (`pg_advisory_xact_lock`): lock ตาม key ที่ application กำหนด ไม่ผูกกับแถว ปล่อยเมื่อ transaction จบ

## คำตอบของ Technical Lead handoff notes

"ยืนยัน" หมายถึงอ่านจาก source เมื่อ 2026-10-01 ไม่ได้รัน DB, HTTP หรือ migration ข้อที่ไม่ระบุคือการตัดสินใจของ Spec นี้ที่รอผู้ใช้อนุมัติ

1. **Resend ด้วย contract ปัจจุบัน:** ทำไม่ได้ (ยืนยัน)
   - `invitation.id` คือ bearer token ของลิงก์ (`apps/api/src/auth/emails.ts:179`)
   - preview, signup gate และ accept ค้นด้วย id นี้ (`apps/api/src/auth/invitations.ts:29`, `apps/api/src/onboarding/service.ts:48-73`)
   - ตารางไม่มี token column แยก (`packages/db/migrations/0001_auth_foundation.sql:100-110`)
   - ทางแก้ดู Data และ Design decisions
2. **โควตา 100:** create นับเฉพาะ `status = 'pending' and expires_at > clock_timestamp()` อยู่แล้ว (ยืนยัน: `apps/api/src/organization-notifications/invitations.ts:81-86`, test `invitations.db.test.ts:342` "counts only live pending invitations up to 100") กฎนับของ `F-004-AC-2` จึงคงเดิม การเปลี่ยนใน create ดู Contracts คำเชิญที่หมดอายุคงเป็น `pending` ตลอดไป (ยืนยัน: `0001_auth_foundation.sql:114-118`)
3. **Cooldown:** 300 วินาที (`OD-T3`) เหตุผล:
   - จำกัดอีเมลถึงผู้รับหนึ่งคนไม่เกิน 12 ฉบับต่อชั่วโมงจากคำเชิญเดียว
   - ยาวพอให้ SMTP ที่ล้มชั่วคราวฟื้นตัว
   - สั้นพอให้ผู้ดูแลลองใหม่ใน session เดียวกัน
   - ความปลอดภัยของ race มาจาก lock
4. **Resend คำเชิญหมดอายุตอนครบ 100:** ตรวจ `activeCount` ใต้ lock ตาม Resend API และ Concurrency create ไม่ lock แถว invitation ใด (lock order ของ create ยืนยันจาก `invitations.ts:26-44`)
5. **Race:**
   - accept อ่านแถวด้วย id เดิมก่อน แล้ว `select ... for update` ซ้ำหลังได้ lock (ยืนยัน: `onboarding/service.ts:48-68`)
   - ถ้า resend commit การหมุน id ก่อน accept ได้ lock, select ด้วย id เดิมจะคืน 0 แถว และ accept ตอบ `404 INVITATION_NOT_FOUND` (ข้อสันนิษฐานจากการอ่านโค้ด ต้องพิสูจน์ด้วย DB test)
   - resend×resend ส่งอีเมลหนึ่งครั้งได้เฉพาะเมื่อ resend เขียน `sent_at` ใน transaction เดียวกับการหมุน id ก่อน SMTP
6. **Native route ที่เปิดเผย PII และ token:** มีช่องโหว่อยู่แล้วบน main (ยืนยันจากการอ่านโค้ด ยังไม่ได้รัน) hotfix ปิดทั้งหมด (ดู API และ Tasks)
   - native `GET /api/auth/organization/list-invitations` และ `GET /api/auth/organization/get-full-organization` ยังเปิดอยู่: guard ตรวจเฉพาะ `POST` และ 5 path (`routes.ts:41-49`) hook ปิด 5 path เดียวกัน (`auth/index.ts:38-44`, `:234`) และ `GET /api/auth/*` เข้า handler (`app.ts:371`)
   - ทั้งสอง route ตรวจแค่ membership (`crud-invites.mjs:535-538`, `crud-org.mjs:328-334`)
   - ทั้งสอง route คืนแถว invitation ทุกสถานะ รวม email และ `id` ให้สมาชิกทุก role รวม `viewer` (`better-auth@1.6.23` `dist/plugins/organization/routes/crud-invites.mjs:524-541`, `adapter.mjs:662-670` ไม่กรอง status; `routes/crud-org.mjs:299-336`, `adapter.mjs:317-365` join `invitation` ทั้งหมด)
   - `viewer` ใช้ id เปิด preview ได้ แต่ตอบรับเองไม่ได้ เพราะ accept ต้องใช้ session ที่ยืนยันอีเมลตรงกับคำเชิญ (`onboarding/service.ts:69-73`)
   - native `cancel-invitation` ตรวจ `hasPermission({ invitation: ["cancel"] })` ซึ่ง `adminAc` มี `admin` จึงยกเลิกคำเชิญ `owner` ได้ ไม่ตรวจ status และไม่ lock Organization ขัด `AC-03` (`crud-invites.mjs:408-457`, `:434-439`, `better-auth/dist/plugins/organization/access/statement.mjs:24-26`)
   - ไล่ครบทุก `createAuthEndpoint("/organization/...")` ใน `dist/plugins/organization` แล้ว route อื่นไม่คืนแถว invitation ของ Organization: `set-active` คืนเฉพาะ organization (`crud-org.mjs:390-396`) `list-user-invitations` คืนเฉพาะคำเชิญของอีเมลใน session และปฏิเสธ query `email` จาก HTTP (`crud-invites.mjs:593`)
   - native `list-members` และ `get-full-organization` คืนชื่อและอีเมลสมาชิกให้ `viewer` ขัด `F-004` `AC-02` (`crud-members.mjs:417-462`, `adapter.mjs:85-138`)
   - `get-active-member-role?userId=` คืน role ของสมาชิกอื่น (`crud-members.mjs:468-496`)
7. **จำนวนแถว:** รายการไม่มีขอบเขต (ยืนยัน) create ไม่บล็อกอีเมลที่มีแค่คำเชิญหมดอายุ จึงสะสมแถว `pending` ที่หมดอายุได้ไม่จำกัด รวมหลายแถวต่ออีเมลเดียว (`invitations.ts:81-84`) ทางแก้คือ pagination (`OD-T1`) และ create ยกเลิกแถวหมดอายุ (`OD-T2`)
8. **Authorization:** ดู Authorization และ security resend/cancel ตรวจ role ของ actor หลังได้ lock (ตาม `invitations.ts:41-63`)

## Contracts

### API

ทุก route:
- ใช้ `requireVerifiedSession`, error envelope REQ-03 และ shared Zod schema ใน `packages/api-contract` (REQ-02) แล้ว regenerate OpenAPI client (WEB-01) `requireVerifiedSession` ใช้ code `EMAIL_NOT_VERIFIED` (`me/service.ts:75`)
- ค่า `organizationId` ใน URL เป็น scope hint
- Resend และ cancel ตรวจ membership ก่อน lock ด้วย `assertMemberBeforeTenantContext` เหมือน create (`invitations.ts:17-21`)
- List ไม่ lock จึงตรวจ membership และ role ใน CTE เดียวกับการอ่าน และไม่เรียก `assertMemberBeforeTenantContext` (ตาม `listOrganizationMembers`, `members.ts:96-157`)

**`GET /api/organizations/{organizationId}/invitations?limit=50&offset=0`**

- Query: `limit` integer `1..50` default `50`, `offset` integer `>=0` default `0`
- `200 { organizationId: uuid, invitations: [{ publicId: uuid, email: string, role: OrganizationRole, sentAt: datetime, expiresAt: datetime | null, expired: boolean, resendAvailableAt: datetime, manageable: boolean }], activeCount: number, activeLimit: 100, page: { limit, offset, total } }`
- แถวคือ `invitation` ของ Organization นี้ที่ `status = 'pending'` ทั้งที่หมดอายุและไม่หมดอายุ
- `expired` = `expires_at is null or expires_at <= clock_timestamp()` แถวที่ `expires_at` เป็น `null` แสดงป้าย "หมดอายุ" (`expires_at` nullable ที่ `0001_auth_foundation.sql:107`)
- `activeCount` คือ n ใน "n จาก 100"
- `manageable` คำนวณจาก role ปัจจุบันของ actor และ role ของคำเชิญ ใช้กับ UX เท่านั้น server ตรวจซ้ำตอน mutation
- `resendAvailableAt` = `sent_at + 300 s`
- `offset >= page.total` ตอบ `200` พร้อม `invitations: []` และ `page.total` จริง web ใช้ค่านี้ย้ายไปหน้าสุดท้ายที่มีแถว
- ลำดับคงที่ `sent_at desc, public_id` ข้ามทุกหน้า create และ resend เขียน `sent_at = clock_timestamp()` แถวที่เพิ่งสร้างหรือ resend จึงอยู่ต้นหน้าแรก
- ใช้ CTE เดียวหา authorization state, `activeCount`, `total` และ page rows ใน statement snapshot เดียว ตาม `listOrganizationMembers`
- ไม่คืน `invitation.id`, `inviter_id`, ชื่อผู้เชิญ หรือคำเชิญที่ `accepted`/`canceled`/`rejected`
- Errors: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 EMAIL_NOT_VERIFIED`, `403 MEMBERSHIP_DENIED` (ไม่เป็นสมาชิกหรือ Organization ไม่มีอยู่ ตอบเหมือนกัน), `403 PERMISSION_DENIED` (`viewer`/`auditor`) Denied ไม่มีจำนวนหรืออีเมล

**`POST /api/organizations/{organizationId}/invitations/{publicId}/resend`**

- Body ไม่มี `200 { resent: true, emailDispatch: 'accepted'|'failed', sentAt, expiresAt, resendAvailableAt }`
- ขั้นตอนใต้ lock ตามลำดับ:
  1. ตรวจ role ของ actor
  2. หาแถวด้วย `public_id` และ `organization_id`
  3. ตรวจสิทธิ์ต่อ role ของคำเชิญ
  4. ตรวจ cooldown: ปฏิเสธเมื่อ `clock_timestamp() < sent_at + interval '300 seconds'` (`sent_at` มาจาก create หรือ resend ล่าสุด) วินาทีที่ 299 ได้ `429` วินาทีที่ 300 ผ่าน
  5. ตรวจว่าผู้รับเป็นสมาชิกแล้วหรือไม่
  6. ถ้าคำเชิญหมดอายุ ตรวจ live duplicate ของอีเมลเดียวกันและ `activeCount`
  7. `update invitation set id = $newId, sent_at = t, expires_at = t + interval '48 hours', updated_at = t` โดย `t = clock_timestamp()` ตามสูตรของ create (`invitations.ts:105-109`)
  8. commit
- หลัง commit ส่ง SMTP ด้วย `buildInvitationEmail` เดิมที่ `invitationId = $newId`
- Errors: ชุดเดียวกับ list และ
  - `404 INVITATION_NOT_FOUND`: ไม่มี `publicId` ใน Organization นี้ หรือแถวไม่ `pending`
  - `403 PERMISSION_DENIED`: `admin` กับคำเชิญ `owner`
  - `429 INVITATION_RESEND_COOLDOWN` พร้อม `details: { resendAvailableAt }` (`AppError.details` ส่งออกใน envelope ที่ `app.ts:439`)
  - `409 USER_ALREADY_MEMBER`
  - `409 INVITATION_ALREADY_PENDING`: resend แถวหมดอายุขณะอีเมลเดียวกันมี live row อื่น หลัง migration เกิดได้กับแถว legacy เท่านั้น เพราะ create ยกเลิกแถวหมดอายุของอีเมลเดียวกัน
  - `409 INVITATION_LIMIT_REACHED`
- Resend คำเชิญที่ยังไม่หมดอายุไม่เปลี่ยน `activeCount` เพราะไม่สร้างแถว (A-04)

**`DELETE /api/organizations/{organizationId}/invitations/{publicId}`**

- `200 { canceled: true }`
- ขั้นตอนใต้ lock ตามลำดับ:
  1. ตรวจ role ของ actor
  2. หาแถว
  3. ตรวจสิทธิ์ต่อ role ของคำเชิญ
  4. `update invitation set status = 'canceled', updated_at = clock_timestamp()`
- ค่า `canceled` ตรงกับ Better Auth `InvitationStatus` (`schema.d.mts:319`)
- ทุก reader กรอง `status = 'pending'` cancel จึงคืนโควตา และลิงก์ได้ `404 INVITATION_NOT_FOUND` ทันที
- Errors: ชุดเดียวกับ list และ `404 INVITATION_NOT_FOUND`, `403 PERMISSION_DENIED`
- ไม่ส่งอีเมล

**Native Better Auth routes (hotfix):** เพิ่ม 9 path เข้า guard ทั้งสองชั้น: `createNativeOrganizationMutationGuard` (`routes.ts:41-49`) และ `BLOCKED_NATIVE_ORGANIZATION_MUTATION_PATHS` (`auth/index.ts:38-44`) guard ชั้นแรกต้องครอบ method `GET` ด้วย เพราะตอนนี้ตรวจเฉพาะ `POST` (`routes.ts:42`)
- Organization-side ที่ขัด `AC-02`, `AC-03`, `AC-10`: `/organization/list-invitations`, `/organization/get-full-organization`, `/organization/cancel-invitation`
- Recipient-side ที่ web ไม่ใช้ (`get-invitation` คืน `inviterEmail`): `/organization/get-invitation`, `/organization/reject-invitation`, `/organization/list-user-invitations`
- รายชื่อและ role สมาชิกที่ขัด `F-004` `AC-02`: `/organization/list-members`, `/organization/get-active-member-role`
- `/organization/delete` (ผู้ใช้ยืนยันว่าไม่ต้องการ flow ลบ Organization) ปิด deadlock ในหัวข้อ Concurrency

ทุก path ได้ `403 PERMISSION_DENIED` และ log denial แบบเดียวกับ 5 path เดิม Web ไม่เรียก route เหล่านี้ (ยืนยัน: grep `apps/`, `packages/`, `e2e/` ไม่พบผู้เรียกหรือ server-side call ของ `auth.api` และ grep `useActiveOrganization|useListOrganizations|useActiveMember` ไม่พบ hook ของ `organizationClient`)

**Create และ accept:** `POST /api/organizations/{organizationId}/invitations` และ `POST /api/onboarding/invitations/{invitationId}/accept` คง request, response, error และโควตาเดิมของ `F-004-AC-2` create เปลี่ยนดังนี้:
1. ตรวจ role, member, live duplicate และโควตาทั้งหมดตามเดิม
2. (ผู้ใช้เลือก `OD-T2`) ใน transaction เดียวกันและก่อน insert รัน `update invitation set status = 'canceled', updated_at = clock_timestamp() where organization_id = $1 and lower(email) = $2 and status = 'pending' and (expires_at is null or expires_at <= clock_timestamp())`
3. insert แถวใหม่พร้อม `sent_at` (ดู Data)

ถ้าขั้น 1 ปฏิเสธคำขอ create จะไม่ยกเลิกแถวใด `0018` ไม่มี data change ล้างแถวซ้ำที่มีอยู่ก่อน migration (ผู้ใช้เลือก)

### Operator provisioning (`F-006-S04`)

ข้อเท็จจริงจาก source (`apps/api/src/operator/provision-organization.ts`) ที่ต้องแก้:
- Organization ที่มีอยู่: อ่าน organization ด้วย slug โดยไม่ lock (`:122-125`) ตรวจ membership (`:128-143`) อ่าน live row ของอีเมลโดยไม่ lock (`:144-151`) และ re-send ด้วย id เดิม (`:158-164`)
- insert คำเชิญ `owner` โดยไม่นับโควตา (`:166-180`)
- ใช้ `now()` (เวลาเริ่ม transaction) ทั้งตอนตรวจหมดอายุ (`:147`) และตอน insert (`:171`) คำสั่งที่รอ lock จึงนับแถวที่หมดอายุระหว่างรอว่ายังใช้ได้ และเขียนเวลาที่เก่ากว่าเวลาที่ได้ lock
- lock เดียวคือ advisory ต่อ slug (`:107-109`) path อื่นไม่ขอ key นี้

ขั้นตอนใหม่ของ Organization ที่มีอยู่ ทั้งหมดใน transaction เดียว ใช้ `t = clock_timestamp()` หลังได้ lock ตาม create (`invitations.ts:83`, `:105-109`):
1. advisory ต่อ slug และ upsert internal user ตามเดิม (`:107-120`)
2. `select id, name from organization where slug = $1 for update` (แทน `:122-125`)
3. `pg_advisory_xact_lock(hashtext($1)::bigint)` ด้วย key `notification-membership:${organizationId}` (key เดียวกับ `invitations.ts:38-40`)
4. ตรวจ membership ตามเดิม (`:128-143`) ถ้าเป็นสมาชิกแล้ว: output เดิม "already a member ... nothing to do" exit code 0 ไม่ส่งอีเมล (`:244-249`)
5. `select id, role from invitation where organization_id = $1 and lower(email) = lower($2) and status = 'pending' and expires_at > clock_timestamp() for update`
6. ถ้ามี live row role อื่น: ไม่เปลี่ยนแถวใด ไม่ส่งอีเมล throw error เดิม (`:153-157`) ซึ่ง `main` พิมพ์ `provision-organization: failed` พร้อมข้อความ และ exit code 1 (`:296-298`) (`AC-17` ข้อ 3)
7. ถ้ามี live row role `owner` (re-send, `AC-18`): `update invitation set id = $newId, sent_at = t, expires_at = t + interval '48 hours', updated_at = t` ไม่ตรวจ cooldown (`OD-18`) ไม่ตรวจโควตาเพราะไม่สร้างแถว `inviter_id` และ `public_id` ไม่เปลี่ยน outcome คืน `$newId` และ `resent: true`
8. ถ้าไม่มี live row: นับ `status = 'pending' and expires_at > clock_timestamp()` ของ Organization ด้วย predicate ของ create (`invitations.ts:85-86`)
   - ถ้าครบ 100: ไม่เปลี่ยนแถวใด ไม่ส่งอีเมล throw `Error("Organization \"<slug>\" already has 100 pending invitations; no invitation was created.")` transaction rollback และ `main` จบด้วย exit code 1 ผ่าน path เดียวกับขั้น 6 (`AC-16` ข้อ 3)
   - ถ้าน้อยกว่า 100: ยกเลิกแถวหมดอายุของอีเมลเดียวกัน (`OD-T2`) ด้วย `update invitation set status = 'canceled', updated_at = t where organization_id = $1 and lower(email) = lower($2) and status = 'pending' and (expires_at is null or expires_at <= t)` ต้องใช้ `lower($2)` เพราะ provisioning เก็บอีเมลตามที่ operator พิมพ์ (`:34`, `:176`) ต่างจาก create ที่ส่งอีเมลที่ normalize แล้ว (`invitations.ts:67`, `:83`) แล้ว insert แถว `owner` ที่ `created_at = sent_at = t`, `expires_at = t + interval '48 hours'`
9. commit แล้วส่ง SMTP ด้วย id ที่ commit (`:263-272`) SMTP ล้มเหลว: output เดิมให้รันคำสั่งซ้ำ และ exit code 1 (`:273-283`, `AC-18` ข้อ 5)

- การสร้าง Organization ใหม่ (`:190-217`) argument (`:29-35`) และ internal provisioning principal (`:19-22`) ไม่เปลี่ยน แถวคำเชิญของ Organization ใหม่ใช้ default ของ `sent_at`
- DB/RLS: `organization` และ `invitation` ไม่มี RLS policy (ยืนยัน: grep `row level security` และ `create policy` ใน `packages/db/migrations` พบเฉพาะตาราง `notification_*` ที่ `0002_notification_foundation.sql:180-191` และ `monitor_*` ที่ `0016_uptime_monitors.sql:176-189`) provisioning จึง `select ... for update` นอก `withTenantContextRaw` ได้ทั้งเมื่อต่อด้วย `DATABASE_OWNER_URL` หรือ `DATABASE_URL` (`:237`) privilege ของ `FOR UPDATE` บน `organization` เป็นชุดเดียวกับที่ create ใช้ (`invitations.ts:27`) ไม่มี grant ใหม่
- ทุกทางที่ปฏิเสธไม่ส่ง SMTP เพราะ throw ก่อน commit และ `main` ส่งอีเมลหลัง commit เท่านั้น
- Re-send เขียน `sent_at = t` resend ของ `F-006` จึงได้ `429 INVITATION_RESEND_COOLDOWN` จนถึง `t + 300 s` (`OD-18`)
- ถ้า NODE-F006-03 แยก statement หมุน id เป็น helper ใน `apps/api/src/organization-notifications/invitations.ts` provisioning ใช้ helper เดียวกันกับ `PoolClient` ของตัวเอง
- Test เดิมที่ขัด contract ใหม่: `provision-organization.db.test.ts:118` และ `:140-141` คาดว่า re-send คืน id เดิม ต้องแก้เป็น id ใหม่; `:197-224` ยังผ่าน แต่ comment ที่ `:208` ("stays 'pending'") ขัด `OD-T2` และต้องเพิ่ม assertion ว่าแถวหมดอายุเป็น `canceled`

### Data

Migration ใหม่ `packages/db/migrations/0018_invitation_management.sql` (DB-11, DB-12; migration ล่าสุดตอนนี้คือ `0017_monitor_notifications.sql`) และ `packages/db/src/schema.ts` ให้ตรงกัน: `publicId: uuid("public_id").notNull().defaultRandom()`, `sentAt: timestamp("sent_at", { mode: "date" }).notNull().defaultNow()` และ `uniqueIndex("invitation_public_id_key").on(table.publicId)` ใน table `invitation` (`schema.ts:155-177`)

```sql
alter table invitation
  add column public_id uuid not null default gen_random_uuid(),
  add column sent_at timestamptz;
update invitation set sent_at = created_at;
alter table invitation
  alter column sent_at set default now(),
  alter column sent_at set not null;
create unique index invitation_public_id_key on invitation (public_id);
```

- `public_id` ไม่ใช่ความลับและใช้ตอบรับคำเชิญไม่ได้ `invitation.id` คงเป็น bearer token
- `gen_random_uuid()` มีใน PostgreSQL 17 (`compose.yaml:9` `postgres:17.11-alpine`) และ `0016_uptime_monitors.sql:8` ใช้อยู่แล้ว default แบบ volatile ให้ค่าแยกต่อแถวเดิมตอน `add column`
- ไม่มี FK อ้าง `invitation.id` จึงหมุน primary key ได้ (ยืนยัน: grep `packages/db` ไม่พบ `references invitation`)
- Create เพิ่ม `sent_at = created_at` ใน insert เดิม (`invitations.ts:104-111`) provisioning ของ Organization ที่มีอยู่เขียน `sent_at` เอง (ดู Operator provisioning) การสร้าง Organization ใหม่ใช้ default ของ column โดยไม่ต้องแก้ (`apps/api/src/operator/provision-organization.ts:198`)
- RLS: `invitation` เป็น login/membership table ตาม DB-06 ไม่มี tenant RLS และไม่เพิ่ม policy query ทุกตัวผูก `organization_id = $1` และ membership ของ actor
- Grants เดิม `select, insert, update, delete` ของ `nightwatch` ครอบ column ใหม่แล้ว ไม่มี grant ใหม่ (`0001_auth_foundation.sql:140-143`, DB-07)
- ไม่มี partition, retention job หรือ index เพิ่ม นอกจาก unique index ข้างบน (`invitation_organization_idx` มีอยู่)

### Jobs

ไม่มี queue, job หรือ automatic retry SMTP ใช้ mailer เดิมหลัง commit (ตาม `routes.ts:233-248`) ถ้า SMTP ล้มเหลวหลัง resend (A-07):
- id ใหม่และวันหมดอายุใหม่ยัง commit อยู่ ลิงก์เดิมใช้ไม่ได้
- response เป็น `emailDispatch: 'failed'`
- cooldown ยังนับ

### Web

- Component ใหม่ `PendingInvitationsSection` บน `OrganizationMembersPage` ต่อจาก `InvitationPanel` และก่อนตารางสมาชิก render เฉพาะเมื่อ actor role จาก server-confirmed context เป็น `owner`/`admin`
- Query key `['tenant', 'invitations', organizationId, { limit, offset }]` ใต้ `TENANT_QUERY_PREFIX` (WEB-03) ไม่ prefetch ใน loader เพราะ section มี loading state ของตัวเองตาม `AC-04`
- Pagination (`AC-01`, `AC-05`–`AC-07`, `AC-11`):
  - `limit` 50 ปุ่ม "หน้าก่อนหน้า"/"หน้าถัดไป" ตาม pattern ของตารางสมาชิก และแสดง `page.total`
  - เปลี่ยนหน้าแสดง loading โดยไม่ใช้ข้อมูลของหน้าเดิมเป็น placeholder
  - offset กลับเป็น 0 เมื่อ Organization เปลี่ยน, หลัง create ที่ server ยืนยันใน `InvitationPanel` และหลัง resend ที่ server ยืนยัน (ทั้ง `accepted` และ `failed`)
  - หลัง cancel และทุก refresh คง offset เดิม
  - ถ้า response มี `invitations: []`, `page.total > 0` และ offset > 0 web โหลด offset `floor((page.total - 1) / 50) * 50` (หน้าสุดท้ายที่มีแถว)
  - ถ้า `page.total = 0` แสดง empty
- Focus (`AC-11`):
  - หลังเปลี่ยนหน้าด้วยปุ่ม หรือ cancel ที่ทำให้ย้ายหน้าหรือไม่เหลือแถว focus ไป heading ของ section
  - หลัง resend สำเร็จ focus ไปปุ่ม "ส่งซ้ำ" ของ `publicId` เดิมที่ต้นหน้าแรก
  - ปุ่มนี้อยู่ใน cooldown เสมอหลัง resend จึงใช้ `aria-disabled="true"` แทน attribute `disabled` เพื่อให้รับ focus และอ่านข้อความ cooldown ได้
  - สถานะ cooldown ของปุ่มเทียบ `resendAvailableAt` กับนาฬิกาของ browser server เป็นผู้ตัดสินจริงด้วย `429`
- Invalidate invitation list ของ Organization หลัง:
  - create ใน `InvitationPanel` (ทั้ง `accepted` และ `failed`)
  - resend และ cancel
  - `403`/`404`/`409`/`429` ของ mutation
- `MEMBERSHIP_DENIED`/`PERMISSION_DENIED` invalidate `ME_CONTEXT_QUERY_KEY` ตาม pattern ของ `MemberRevokeAction`
- ทุก completion ผ่าน `useOrganizationScope` เพื่อทิ้งผลของ Organization เดิม (`AC-09`)
- Confirmation ของ resend/cancel ใช้ dialog pattern เดียวกับ `MemberRevokeAction` ไม่เพิ่ม dependency
- Error mapping (ข้อความ error ไม่มีอีเมลผู้รับ):
  - `INVITATION_LIMIT_REACHED` → ข้อความใน `AC-05`
  - `INVITATION_RESEND_COOLDOWN` → "ส่งซ้ำได้อีกครั้งเมื่อ {เวลา}" จาก `details.resendAvailableAt` (web `ApiError` เก็บ `details` ที่ `apps/web/src/lib/api/client.ts:188-189`)
  - `404 INVITATION_NOT_FOUND` ของ resend → refresh และ "ไม่พบคำเชิญนี้แล้ว" (แถว "ส่งซ้ำ" ของ UI flow)
  - `404` ของ cancel → refresh และ "ยกเลิกคำเชิญไม่สำเร็จ โหลดรายการล่าสุดแล้ว" (แถว "ยกเลิก" ของ UI flow)
  - `USER_ALREADY_MEMBER` ของ resend → refresh และ "ผู้รับเป็นสมาชิกแล้ว"
  - `INVITATION_ALREADY_PENDING` ของ resend → refresh และ "มีคำเชิญที่ยังใช้ได้สำหรับอีเมลนี้แล้ว" (ถ้อยคำที่ผู้ใช้ยืนยันเมื่อ 2026-10-01)
  - failure อื่นของ resend → "ส่งคำเชิญซ้ำไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" และคงแถว
- ไม่ render `invitation.id` หรือ URL ลิงก์เชิญ (`AC-10`) Focus, status region และ layout ตาม `AC-11` และ `docs/design-system.md` LAY-02, COL-03, CMP-01–CMP-03, A11Y-01

### Authorization และ security

| Operation | owner | admin | viewer / auditor | non-member |
| --------- | ----- | ----- | ---------------- | ---------- |
| list | `200` | `200` | `403 PERMISSION_DENIED` | `403 MEMBERSHIP_DENIED` |
| resend/cancel คำเชิญ `owner` | อนุญาต | `403 PERMISSION_DENIED` | `403 PERMISSION_DENIED` | `403 MEMBERSHIP_DENIED` |
| resend/cancel คำเชิญ `admin`/`viewer`/`auditor` | อนุญาต | อนุญาต | `403 PERMISSION_DENIED` | `403 MEMBERSHIP_DENIED` |

- Role ของ actor อ่านใต้ lock ตอน mutation (`normalizeOrganizationRole`) role ที่ไม่รู้จักเป็น server error
- server ปฏิเสธ `viewer`/`auditor` ก่อน lookup คำเชิญ สอง role นี้จึงไม่รู้ว่า `publicId` มีอยู่
- `admin` ได้ `404` สำหรับ `publicId` ที่ไม่มี และ `403` สำหรับคำเชิญ `owner` ซึ่งต่างจาก revoke (`members.ts:201-204`) เหตุผล:
  - `OD-02` ให้ `admin` เห็นแถว `owner` อยู่แล้ว
  - การแยก `404` จำเป็นต่อข้อความ "ไม่พบคำเชิญนี้แล้ว" ในแถว "ส่งซ้ำ" ของตาราง state ใน UI flow ของ `feature.md` และการ refresh ตาม `AC-07`
- `publicId` ของ Organization B ส่งผ่าน URL ของ A ได้ `404` เพราะ query ผูก `organization_id`
- Log/audit:
  - `auditDenials` บันทึก `actorUserId`, action คงที่ (`organization.invitation.list`, `organization.invitation.resend`, `organization.invitation.cancel`) และ code เท่านั้น (ตาม `routes.ts:76-94`)
  - SMTP failure บันทึก `{ action: 'organization.invitation.resend.send', code: 'SMTP_FAILED' }`
  - ไม่บันทึก Organization id, `publicId`, invitation id, email หรือ role
  - Request completion log normalize path เป็น route template ตาม `F-004` spec: เพิ่ม state ใน `logSafeOrganizationPath` ให้ได้ `/api/organizations/:organizationId/invitations/:publicId` และ `.../:publicId/resend` (`apps/api/src/app.ts:147-218`)
  - ตอนนี้ segment หลัง `invitations` กลายเป็น `:segment` จึงไม่รั่วแต่ไม่แยก route (`app.ts:184-214`)

### Concurrency

**Lock order ของ resend และ cancel:**
1. `organization FOR UPDATE`
2. `pg_advisory_xact_lock(hashtext($1)::bigint)` ด้วย key `notification-membership:${organizationId}` (call และ key เดียวกับ `invitations.ts:38-40`, `onboarding/service.ts:61-63`, `members.ts:222-224`)
3. `member` ของ actor `FOR UPDATE`
4. `invitation` row `FOR UPDATE`

ทุก check และ write อยู่ใน transaction เดียว ไม่มี network I/O ใน transaction (REQ-01)

**Lock หลัง advisory lock ของ path อื่น:**
- create: lock `member` ของ actor และไม่ lock invitation (`invitations.ts:41-44`)
- accept: lock `invitation` ก่อน `member` ของผู้รับ (`onboarding/service.ts:64-81`)
- role/revoke: lock actor แล้ว target (`members.ts:274-287`, `:318-330`)
- leave: lock เฉพาะ actor (`members.ts:370-374`)
- operator provisioning ของ Organization ที่มีอยู่ (ใหม่): ก่อน organization row ถือ advisory ต่อ slug (`provision-organization.ts:107-109`) และ upsert internal user (`:111-120`) หลัง advisory `notification-membership` lock live row ของอีเมล `FOR UPDATE` ไม่ lock `member`

**ทำไมไม่เกิด deadlock:** ทุก path first-party และ provisioning ที่ lock `member`/`invitation` ได้ lock ของ organization row ก่อน row lock อื่น (`invitations.ts:26-44`, `onboarding/service.ts:56-81`, `members.ts:216-224`, `me/service.ts:186-202`, `notifications/service.ts:158-167`)
- lock สองตัวที่ provisioning ถือก่อน organization row (advisory ต่อ slug และ internal user row) ไม่มี path อื่นขอ ยกเว้น provisioning ด้วยกัน ซึ่งขอตามลำดับเดียวกัน ผู้ถือ organization row lock จึงไม่รอ lock ที่ provisioning ถืออยู่
- writer ข้างบนใช้ `FOR UPDATE`
- notification scope resolution ใช้ `organization FOR SHARE` ก่อน lock `member` `FOR UPDATE` (`apps/api/src/notifications/service.ts:158-167`) `FOR SHARE` ชนกับ `FOR UPDATE` จึง serialize ตั้งแต่ lock แรก

**Path ที่ไม่ใช้ lock นี้:**
- provisioning ที่สร้าง Organization ใหม่ (`provision-organization.ts:190-217`) ถือเฉพาะ advisory ต่อ slug และ row ที่ตัวเอง insert ยังไม่มี path อื่นเห็น Organization นั้นจนกว่า commit
- native `reject-invitation` (`crud-invites.mjs:393-396`) และ native `cancel-invitation` (`:447-450`) update แถว invitation แถวเดียวโดยไม่ถือ lock อื่น รอได้แต่ไม่เกิด cycle hotfix ปิดทั้งสอง route ก่อน NODE-F006-01a
- native `POST /api/auth/organization/update` (`owner`/`admin`) update organization row แถวเดียวโดยไม่ถือ lock อื่น รอได้แต่ไม่เกิด cycle (`crud-org.mjs:228`)
- native `POST /api/auth/organization/delete` เกิด deadlock ได้ (ข้อสรุปจากการอ่านโค้ด ยังไม่ได้รัน):
  - บน main ยังเปิดให้ `owner`: ไม่อยู่ใน guard (`routes.ts:43-49`, `auth/index.ts:38-44`) ไม่ได้ตั้ง `disableOrganizationDeletion` (`auth/index.ts:145-159`) และ `ownerAc` มี `organization: ["update", "delete"]` (`statement.mjs:45`, `auth/permissions.ts:10`)
  - route ตรวจ `hasPermission({ organization: ["delete"] })` แล้วเรียก `adapter.deleteOrganization` (`crud-org.mjs:239-240`, `:269-274`, `:286`)
  - adapter ลบ `member` → `invitation` → `organization` ใน transaction เดียว จึงได้ organization row lock เป็นลำดับสุดท้าย (`adapter.mjs:266-292`; `runWithTransaction` เรียก `adapter.transaction` ที่ `@better-auth/core@1.6.23` `dist/context/transaction.mjs:53-69` และ NightWatch แทนด้วย `database.db.transaction` ที่ `auth/auth-origin-intents.ts:536-548`)
  - ถ้า delete ลบ `member` แล้ว ขณะ resend/cancel ถือ `organization FOR UPDATE` และรอ `member` ของ actor จะเกิด deadlock ที่ PostgreSQL ยกเลิกหนึ่ง transaction
  - ปัญหานี้มีอยู่แล้วกับทุก path first-party ที่ lock `member` หรือ `invitation` หลัง organization row (เช่น create, accept, role, revoke, leave ของ `F-004`, `setActiveOrganization` ที่ `me/service.ts:186-202` และ notification scope resolution)
  - hotfix ปิด path นี้ใน guard ทั้งสองชั้นก่อน NODE-F006-01a จึงไม่มี resend/cancel ที่รันขณะ delete ยังเปิด

ผู้ได้ lock ก่อนชนะ ตารางอ่านว่า "สองคำขอที่ชนกัน → ผู้ชนะ → ผลของอีกฝ่าย"

| Race | ผลที่ยอมรับ |
| ---- | ----------- |
| accept (id เดิม) × resend | resend ชนะ → accept ด้วย id เดิมได้ `404 INVITATION_NOT_FOUND` ลิงก์ใหม่ใช้ได้; accept ชนะ → resend ได้ `404` ไม่ส่งอีเมล |
| accept × cancel | accept ชนะ → cancel ได้ `404`; cancel ชนะ → accept ได้ `404` |
| resend × resend | คำขอแรกชนะ → commit และส่งอีเมลหนึ่งครั้ง; คำขอที่สองหาแถวด้วย `public_id` เดิม อ่าน `sent_at` ใหม่ใต้ lock → `429 INVITATION_RESEND_COOLDOWN` ไม่ส่ง |
| cancel × cancel | คำขอแรกชนะ → `200`; คำขอที่สอง → `404 INVITATION_NOT_FOUND` เพราะแถวไม่ `pending` แล้ว |
| resend × cancel | cancel ชนะ → resend ได้ `404`; resend ชนะ → cancel ยกเลิกแถวที่หมุน id แล้ว ลิงก์ใหม่ใช้ไม่ได้ (อีเมลที่ resend ส่งหลัง commit อาจถึงผู้รับหลัง cancel และลิงก์ในนั้นได้ `404`) |
| resend คำเชิญหมดอายุ × create อื่นที่ 99 | ผู้ได้ lock ก่อนชนะ → ผู้ที่สองเจอ `activeCount = 100` ได้ `409 INVITATION_LIMIT_REACHED` |
| resend คำเชิญหมดอายุ × create อีเมลเดียวกัน | create ชนะ → แถวหมดอายุเป็น `canceled` และ resend ได้ `404 INVITATION_NOT_FOUND` ไม่ส่งอีเมล; resend ชนะ → create เจอ live row (`invitations.ts:81-84`) ได้ `409 INVITATION_ALREADY_PENDING` (`:89-95`) ก่อนขั้นยกเลิกและ insert จึงไม่ยกเลิกแถวใด |
| resend หรือ cancel × ลด role หรือ revoke actor | การเปลี่ยน role ชนะ → resend/cancel อ่าน role ใหม่ได้ `403` ไม่เขียน |
| provisioning × create อีเมลเดียวกัน | provisioning ชนะ → create เจอ live row ได้ `409 INVITATION_ALREADY_PENDING` ไม่ส่งอีเมล; create ชนะด้วย role `owner` → provisioning หมุน id ของแถวนั้น ลิงก์ในอีเมลของ create ใช้ไม่ได้ ลิงก์ของ provisioning ใช้ได้; create ชนะด้วย role อื่น → provisioning ไม่เปลี่ยนแถว ไม่ส่งอีเมล exit code 1 |
| provisioning × create อีเมลอื่นที่ 99 | ผู้ได้ lock ก่อนชนะ → create ที่มาทีหลังได้ `409 INVITATION_LIMIT_REACHED` หรือ provisioning ที่มาทีหลังไม่สร้างแถว ไม่ส่งอีเมล exit code 1 |
| provisioning × resend คำเชิญหมดอายุของอีเมลอื่นที่ 99 | ผู้ได้ lock ก่อนชนะ → resend ที่มาทีหลังได้ `409 INVITATION_LIMIT_REACHED` ไม่ส่ง หรือ provisioning ที่มาทีหลังไม่สร้างแถว ไม่ส่งอีเมล exit code 1 |
| provisioning × resend ของ `owner` (คำเชิญ `owner` ที่ยังไม่หมดอายุ) | provisioning ชนะ → resend อ่าน `sent_at` ใหม่ใต้ lock ได้ `429 INVITATION_RESEND_COOLDOWN` ไม่ส่ง (`OD-18`); resend ชนะ → provisioning หมุน id อีกครั้งโดยไม่ตรวจ cooldown ลิงก์ของ resend ใช้ไม่ได้ ลิงก์ของ provisioning ใช้ได้ |
| provisioning × resend คำเชิญหมดอายุของอีเมลเดียวกัน | provisioning ชนะ → ยกเลิกแถวหมดอายุแล้ว insert แถวใหม่ resend ได้ `404 INVITATION_NOT_FOUND` ไม่ส่ง; resend ชนะ → แถวนั้นเป็น live row provisioning หมุน id ถ้า role `owner` หรือ exit code 1 ถ้า role อื่น |
| provisioning × cancel | cancel ชนะ → provisioning ไม่เจอ live row จึงนับโควตาแล้วสร้างแถวใหม่ (หรือ exit code 1 ที่ 100); provisioning ชนะ → cancel ยกเลิกแถวที่หมุน id แล้ว ลิงก์ในอีเมลของ provisioning ได้ `404` |
| provisioning × accept | accept ชนะ → provisioning เจอ membership แสดง "already a member" exit code 0 ไม่ส่งอีเมล; provisioning ชนะ → accept ด้วย id เดิมได้ `404 INVITATION_NOT_FOUND` (`onboarding/service.ts:64-68`) ลิงก์ใหม่ใช้ได้ |
| provisioning × provisioning (slug เดียวกัน) | advisory ต่อ slug serialize → คำสั่งที่สองหมุน id ของแถวที่คำสั่งแรกสร้างหรือหมุน มี live row หนึ่งแถว ผู้รับได้อีเมลสองฉบับ ลิงก์ของคำสั่งที่ commit หลังเท่านั้นที่ใช้ได้ |

## Design decisions

| Driver | การตัดสินใจ | เหตุผล |
| ------ | ----------- | ------ |
| Security (bearer link) | หมุน `invitation.id` ในแถวเดิม และเพิ่ม `public_id` สำหรับการจัดการ | ลิงก์เดิมตายตอน commit โดยไม่แก้ preview, signup gate, accept หรือ email ของ `F-004` |
| Security (authorization bypass) | Hotfix เป็น PR แยก ปิด native route 9 path ตาม API contract เริ่มพร้อม `F-006` ภายใต้ start authorization เดียวกัน และ merge ก่อน NODE-F006-01a (ผู้ใช้เลือก) | Native list และ full organization ส่ง bearer id กับ email ให้ `viewer` (ขัด `AC-02`, `AC-10`) native cancel ให้ `admin` ยกเลิกคำเชิญ `owner` ได้ ไม่ตรวจ status และไม่ lock (ขัด `AC-03`) ช่องโหว่มีอยู่บน main แล้ว และ web ไม่เรียก route ใดใน 9 path |
| Consistency (operator provisioning) | Provisioning ของ Organization ที่มีอยู่ใช้ lock prefix, predicate โควตา, การยกเลิกแถวหมดอายุ และการหมุน id เดียวกับ create และ resend ไม่ตรวจ cooldown แต่เขียน `sent_at` (`OD-18`) | `AC-16`–`AC-18` ผูกทุกทางที่สร้างหรือส่งคำเชิญ ใช้ lock เดียวกันจึงพิสูจน์โควตาและ live row ต่ออีเมลด้วย race test ชุดเดียว |
| Abuse control (REQ-04) | Cooldown เป็น domain invariant ใน DB ตรวจใต้ Organization lock ไม่ใช้ Redis sliding window | ต้องรับประกันอีเมลไม่เกินหนึ่งฉบับเมื่อ resend พร้อมกัน Redis limiter ของ REQ-04 มี timeout 2 s และอาจไม่บล็อกเมื่อ Redis ล้ม จึงรับประกันข้อนี้ไม่ได้ ตอนนี้ limiter ของ REQ-04 ต่อเฉพาะ monitor routes (`apps/api/src/monitors/routes.ts`, `monitors/test-route.ts`) ไม่มีบน `/api/organizations/*/invitations` และ Spec นี้ไม่เพิ่ม |
| Privacy | List คืน email ให้ owner/admin เท่านั้น ไม่มี id ลับใน response, URL หรือ log | `AC-02`, `AC-10`, หลัก "Logging, audit and health" |
| Consistency | Lock prefix เดียวกับ create/accept (`organization FOR UPDATE` → advisory) cooldown เช็คใต้ lock | server ตรวจทั้งโควตา 100 และ "ส่งอีเมลไม่เกินหนึ่งครั้ง" ใต้ lock เดียวกัน |
| Performance | ไม่ตั้งเป้า latency ใหม่ List ใช้ `invitation_organization_idx` และ page ไม่เกิน 50 แถว | Feature ไม่ระบุ quality target จึงไม่สร้างตัวเลข |
| Audit | คง denial-only audit ตาม `F-004` | Audit report UI เป็น non-goal ของ `F-006` |
| Maintainability | Hotfix PR แล้ว 5 PR ของ `F-006` (01a backend, 01b web, 02 cancel, 03 resend, 04 provisioning) migration อยู่ใน 01a (`OD-T10`) | แต่ละ node พิสูจน์ด้วย suite หลักชุดเดียว และ review DB/security แยกจาก UI |

**Risks**

- Verification email ที่ค้างอยู่ฝั่งผู้รับอ้าง id เดิม (`buildVerificationEmail` ต่อ `invitationId` ที่ `emails.ts:135-138`) หลัง resend continuation นั้นได้ `404` ผู้รับต้องใช้ลิงก์ในอีเมลใหม่ ยอมรับเพราะตรงกับ `OD-05`
- ผู้รับที่อยู่ระหว่างสมัครด้วยลิงก์เดิม: web เก็บ id ไว้ใน `sessionStorage` (`apps/web/src/lib/auth/continuation.ts:15`) และส่ง header `X-Invitation-ID` (`AcceptInvitationPage.tsx:320`) หลัง resend signup gate ตอบ `403 INVITATION_REQUIRED` (`auth/invitations.ts:41-55`) ผู้รับต้องเปิดลิงก์ใหม่ ยอมรับด้วยเหตุผลเดียวกับข้อบน
- (ผลของ `OD-18` ที่ผู้ใช้เลือก เพิ่มหลังการยอมรับ risk ข้อ 5 ของ Decision record) Re-send ของ provisioning ไม่ผ่าน cooldown operator ที่รันซ้ำส่งอีเมลถึงผู้รับได้ทุกครั้ง และลิงก์จาก resend หรือ create ก่อนหน้าใช้ไม่ได้ การรันคำสั่งต้องใช้ credential ของ DB (`provision-organization.ts:237`)
- Native `organization/delete` เกิด deadlock กับ path first-party ได้จนกว่า hotfix merge (ดู Concurrency) หลัง hotfix ไม่มี API ลบ Organization ซึ่งผู้ใช้ยืนยันว่าไม่ต้องการ
- Pagination ใช้ลำดับ `sent_at desc` resend ทำให้แถวย้ายหน้า ผู้ใช้อาจเห็นแถวซ้ำหรือข้ามหลัง refresh ยอมรับเพราะ refresh ใช้ค่าที่ server ยืนยัน
- แถว legacy ที่ pending หมดอายุและซ้ำอีเมลเดียวกันมีอยู่ได้ก่อน migration server บล็อก resend ของแถวเหล่านั้นด้วย `INVITATION_ALREADY_PENDING` เมื่อมี live row

**Assumptions**

- Role ของคำเชิญเป็นค่าเดียว (`owner`/`admin`/`viewer`/`auditor`) เพราะ first-party create เขียนจาก `OrganizationRole` แถวที่ role ไม่รู้จักเป็น server error ตาม pattern ของ member list
- `inviter_id` ไม่เปลี่ยนเมื่อ resend อีเมลใหม่ใช้ชื่อของ actor ที่ resend ตาม create (`routes.ts:233-238`) ชื่อผู้เชิญไม่แสดงใน UI (`AC-12`)

**Non-goals:** ตาม `AC-12` และไม่มี retention job, delivery tracking, platform หรือ CI change

## Proposed acceptance rows (Technical Lead)

Technical Lead เพิ่มแถวเหล่านี้ใน Acceptance matrix ของ `feature.md` ตอนผู้ใช้อนุมัติ Spec งานนี้ห้ามแก้ `feature.md` จึงยังอยู่ที่นี่

| AC | Category | Observable behavior | Verification |
| -- | -------- | ------------------- | ------------ |
| AC-13 | Concurrency | ทุก race ในตาราง Concurrency ให้ผลตามคอลัมน์ "ผลที่ยอมรับ" ลิงก์เดิมตอบรับไม่ได้หลัง resend หรือ re-send ของ provisioning commit และ resend พร้อมกันส่งอีเมลหนึ่งครั้ง create, resend และ provisioning ไม่ทำให้ `activeCount` เกิน 100 แถว race ของ provisioning พิสูจน์ร่วมกับ `AC-17` และ `AC-18` | Real DB/HTTP test ที่ถือ lock ด้วย transaction ค้างแล้วปล่อย: accept×resend, accept×cancel, resend×resend, cancel×cancel, resend×cancel, resend หมดอายุ×create ที่ 99, resend หมดอายุ×create อีเมลเดียวกัน, demotion ระหว่างรอ lock และแถว provisioning ทั้ง 8 แถวทั้งสองลำดับ นับ SMTP attempts ผ่าน mailer capture |
| AC-14 | Security | Response, log และ audit ของ list/resend/cancel ไม่มี `invitation.id`, ลิงก์ หรือ email นอก list ที่ได้รับอนุญาต Native `list-invitations`, `get-full-organization` และ `cancel-invitation` ถูกปฏิเสธ `admin` resend/cancel คำเชิญ `owner` ผ่าน request ตรงไม่ได้ `publicId` ของ B ใน URL ของ A ได้ `404` | HTTP test ทุก role × A/B, captured log/audit, เรียก native routes ตรง, เทียบ body ของ denied ใน Organization ที่มีและไม่มีคำเชิญ |
| AC-15 | Verification | Migration `0018` apply บน DB ที่มีข้อมูล `F-004` แล้ว backfill `sent_at = created_at` และ `public_id` ไม่ซ้ำ Verification ของ `F-004` `AC-05`–`AC-07` ผ่านซ้ำ | Migration test บน DB ที่ seed คำเชิญก่อน migrate, รัน `invitations.db.test.ts` และ onboarding accept tests เดิม |

## AC trace

| AC | Contract | Task | Test |
| -- | -------- | ---- | ---- |
| AC-01 | List API, Data, Web | NODE-F006-01a, NODE-F006-01b | 01a: DB/HTTP A-only/B-only/A+B, accepted/canceled/expired rows, `activeCount`, pagination; 01b: web table และ pagination |
| AC-02 | List API, Native routes, Authorization | Hotfix, NODE-F006-01a, NODE-F006-01b | Hotfix: native list/full organization `403` ทุก role; 01a: HTTP role matrix; 01b: UI hidden section |
| AC-03 | Resend/Cancel API, Native routes, Authorization, Web | Hotfix, NODE-F006-02, NODE-F006-03 | Hotfix: native `cancel-invitation` `403`; 02/03: HTTP actor × invitation role, demotion before send, SMTP count; web แถว `owner` ของ `admin` ไม่มีปุ่ม |
| AC-04 | Web | NODE-F006-01b | Web pending/empty/failure/retry |
| AC-05 | Resend API, Jobs, Web | NODE-F006-03 | DB/HTTP old/new link, expiry range, 99/100, cooldown วินาที 299/300 รวมหลัง SMTP failure และหลัง create; web confirmation, SMTP outcomes, resend จากหน้าที่สองแล้วโหลดหน้าแรก |
| AC-06 | Cancel API, Web | NODE-F006-02 | DB/HTTP old link `404`, re-invite, `activeCount` from 100; web confirmation/focus, 51 แถวแล้วยกเลิกในหน้าแรก, ยกเลิกแถวเดียวของหน้าสุดท้าย |
| AC-07 | Concurrency, Web | NODE-F006-02, NODE-F006-03 | Other-session accept/cancel then mutate; ผู้รับเป็นสมาชิกแล้ว resend; resend แถว legacy ที่ซ้ำ live row; หน้าเกินจำนวนจริงหลังอีก session ยกเลิก; role change then mutate; ข้อความตามผลของ server |
| AC-08 | Create change, Web | NODE-F006-01a, NODE-F006-01b | 01a: create ยกเลิกแถวหมดอายุของอีเมลเดียวกัน, แถว legacy, response/code/โควตาของ `F-004-AC-2` และรัน verification ของ `F-004` `AC-05`–`AC-07` ซ้ำ; 01b: create then list refresh ต้นหน้าแรก; accept then both tables |
| AC-09 | Web | NODE-F006-01b, NODE-F006-02, NODE-F006-03 | Deferred A responses after A→B success/denied |
| AC-10 | API, Web | NODE-F006-01a (response), NODE-F006-01b–03 (DOM) | 01a: list response ไม่มี id; 01b–03: DOM scan for id/link; denied messages |
| AC-11 | Web | NODE-F006-01b, NODE-F006-02, NODE-F006-03 | Keyboard/focus/status, light/dark |
| AC-12 | API, Web | NODE-F006-01a, NODE-F006-01b, NODE-F006-02, NODE-F006-03, NODE-F006-04 (NON-GOALS), Integrated | ทุก node: ไม่มี endpoint/UI นอก scope และ `F-004` invitation tests เดิมผ่าน; Integrated: contract scan และ rerun `F-004` `AC-05`–`AC-07` |
| AC-13 | Concurrency | NODE-F006-02, NODE-F006-03, NODE-F006-04 (แถว provisioning) | ดู AC-13 |
| AC-14 | Security | Hotfix (native routes), NODE-F006-01a, NODE-F006-02, NODE-F006-03, NODE-F006-04 (output และ log ของ provisioning) | ดู AC-14 |
| AC-15 | Data | NODE-F006-01a | ดู AC-15 |
| AC-16 | Operator provisioning, Concurrency | NODE-F006-04 | DB test ของ `provisionOrganization` ที่ live 99 และ 100 (รวม 100 ที่มีแถวหมดอายุเพิ่ม), process test ของ `main` ตรวจ output, exit code และ SMTP attempts, list API ตรวจ `activeCount` และแถวต้นหน้าแรก |
| AC-17 | Operator provisioning, Concurrency | NODE-F006-04 | Race test provisioning × create อีเมลเดียวกัน, × resend หมดอายุอีเมลเดียวกัน, × provisioning, × create อีเมลอื่นที่ 99, × resend คำเชิญหมดอายุของอีเมลอื่นที่ 99 นับ live row ต่ออีเมลและทั้ง Organization; live row role `admin` แล้วตรวจ output, exit code และแถวไม่เปลี่ยน |
| AC-18 | Operator provisioning, Jobs, Concurrency | NODE-F006-04 | Re-send: id เปลี่ยน, ลิงก์เดิม `404` และใหม่ `200`, 48 ชั่วโมง, ไม่มีแถวใหม่, list ต้นหน้าแรก; race × resend, × cancel, × accept ทั้งสองลำดับแล้วเปิดลิงก์ในอีเมลที่ capture; SMTP failure; resend ของ `F-006` หลัง re-send ได้ `429` (`OD-18`) |

## Tasks

| Task | Depends on | Integration owner of shared files |
| ---- | ---------- | --------------------------------- |
| Hotfix native routes (PR แยก เริ่มพร้อม `F-006`) | invitation create/accept ของ `F-004` (อยู่บน main ใน `355ce1f`), Spec approved, start authorization ของ `F-006` | software-engineer |
| NODE-F006-01a List backend (`F-006-S01`) | Hotfix merged, Spec approved, start authorization | software-engineer |
| NODE-F006-01b List web (`F-006-S01`) | NODE-F006-01a merged | software-engineer |
| NODE-F006-02 Cancel (`F-006-S03`) | NODE-F006-01b merged | software-engineer |
| NODE-F006-03 Resend (`F-006-S02`) | NODE-F006-02 merged | software-engineer |
| NODE-F006-04 Operator provisioning (`F-006-S04`) | NODE-F006-03 merged | software-engineer |

- ลำดับคือ hotfix → 01a → 01b → 02 → 03 → 04
- `355ce1f` เป็น ancestor ของ `main` (main session ยืนยันด้วย `git merge-base --is-ancestor`)
- Hotfix เป็น PR แยกและเริ่มพร้อม `F-006` ภายใต้ start authorization เดียวกัน (ผู้ใช้เลือก) merge ก่อน NODE-F006-01a
- NODE-F006-04 ต้องอยู่หลัง 03: ใช้ `public_id`/`sent_at` ของ 01a, statement หมุน id ของ 03 และ PROOF ของ `AC-17`/`AC-18` ต้องมี race กับ cancel (02) และ resend (03)
- Hotfix แก้ guard ใน `routes.ts` และ `auth/index.ts` node ของ `F-006` แก้เฉพาะ first-party route ใน `routes.ts` และไม่แก้ `auth/index.ts` จึงเริ่ม 01a บน main ที่มี hotfix แล้ว
- Recipient-side route ทั้งสาม (`get-invitation`, `reject-invitation`, `list-user-invitations`) อยู่ใน hotfix เพราะใช้ guard ทั้งสองชั้นจุดเดียวกับ 6 path อื่น และ PROOF ชุดเดียวกัน (native route `403` และ log denial) guard list จึงมีผู้แก้ PR เดียว
- Cancel มาก่อน resend เพราะไม่ต้องมี cooldown, การหมุน id หรือ SMTP จึงพิสูจน์ lock และ authorization ของ mutation ก่อน
- ไม่มี Task ของ platform-engineer เพราะไม่มี environment, CI, secret หรือ infrastructure change migration รันผ่าน runner เดิม
- shared files ต่อไปนี้มีผู้แก้ทีละ node ตามลำดับ: `packages/api-contract/src/auth.ts`, `packages/api-contract/src/index.ts`, `apps/api/src/organization-notifications/invitations.ts` (รวม NODE-F006-04 ถ้า export helper หมุน id), `apps/api/src/organization-notifications/routes.ts`, `apps/web/src/lib/api/openapi-types.gen.ts`, `apps/web/src/lib/api/invitations.ts`, `apps/web/src/pages/organization-members/PendingInvitationsSection.tsx`
- `apps/web/src/pages/OrganizationMembersPage.tsx` แก้เฉพาะใน NODE-F006-01b `PendingInvitationsSection` เป็นเจ้าของ confirmation dialog, status region และ pending guard ของ resend/cancel เอง

### Hotfix native routes

- **OWNER:** software-engineer
- **READY:** Spec approved และ start authorization ของ `F-006` (ครอบ hotfix ตามที่ผู้ใช้เลือก) การบันทึก hotfix ใน `F-004` spec ตามโครงของ "Issue #16 hotfix" (`F-004` `spec.md:89-110`) เป็นงานแยก งานนี้ห้ามแก้ `F-004`
- **OUTCOME:** native route 9 path ใน API contract "Native Better Auth routes (hotfix)" ได้ `403 PERMISSION_DENIED` ทุก method และทุก role PR แยก merge ก่อน NODE-F006-01a
- **SOURCE:** API contract "Native Better Auth routes (hotfix)", Concurrency (native `organization/delete`); `F-006` `AC-02`, `AC-03`, `AC-14` ส่วน native route; `F-004` `AC-02`
- **INVARIANTS:** 5 path เดิมยังถูกปิด; first-party route และ path อื่นของ `/api/auth/*` (sign-up, session, `set-active`) ไม่เปลี่ยน; log denial มี actor, action และ code เท่านั้น; web ไม่เรียก path ที่ปิด
- **FILES:** `apps/api/src/organization-notifications/routes.ts` (`createNativeOrganizationMutationGuard` ครอบ `GET`), `apps/api/src/auth/index.ts` (`BLOCKED_NATIVE_ORGANIZATION_MUTATION_PATHS`), `apps/api/src/organization-notifications/routes.db.test.ts`, `apps/api/src/auth/auth.db.test.ts`
- **NON-GOALS:** first-party endpoint ใหม่, migration, web change, `disableOrganizationDeletion`
- **CONTRACTS:** guard list ที่ NODE-F006-01a ตรวจซ้ำแบบ regression
- **VERIFY:** `bun run test:integration` เฉพาะ suite ของ guard, auth และ invitation, grep `apps/`, `packages/`, `e2e/` ว่าไม่มีผู้เรียก 9 path
- **PROOF:** ทั้ง 9 path ได้ `403 PERMISSION_DENIED` จาก guard ชั้นแรกผ่าน HTTP ตรง (รวม `viewer`, `admin`, `owner`) และ hook ปฏิเสธทั้ง 9 path เมื่อเรียก Better Auth handler โดยไม่ผ่าน guard, `list-invitations`/`get-full-organization` ไม่คืน email หรือ id, `admin` ยกเลิกคำเชิญ `owner` ผ่าน native `cancel-invitation` ไม่ได้และแถวยัง `pending`, `owner` เรียก `organization/delete` แล้ว Organization ยังอยู่, captured log ของ denial ไม่มี PII/token, verification ของ `F-004` `AC-02` และ invitation tests เดิมผ่าน
- **COVERS:** AC-02 (native), AC-03 (native cancel), AC-14 (native routes), `F-004` AC-02

### NODE-F006-01a List backend

- **OWNER:** software-engineer
- **READY:** Hotfix merged, Spec approved และ start authorization ของ `F-006`
- **OUTCOME:** migration `0018` อยู่; list API คืนคำเชิญ pending แบบ pagination พร้อม `activeCount`; create เขียน `sent_at` และยกเลิกแถวหมดอายุของอีเมลเดียวกัน; completion log ใช้ route template
- **SOURCE:** API (list, create change), Data, Authorization และ security ใน Spec นี้; `AC-01`, `AC-02`, `AC-08`, `AC-10`, `AC-12`, `AC-14`, `AC-15`
- **INVARIANTS:** ไม่มี `invitation.id` ใน response/log; request, response, error และโควตาของ create และ accept ของ `F-004-AC-2` คงเดิม; create ยกเลิกแถวหมดอายุหลังผ่านทุก check และก่อน insert ใน transaction เดียวกัน; list ไม่คืนข้อมูลเมื่อ denied; native route ที่ hotfix ปิดยังถูกปิด
- **FILES:** `packages/db/migrations/0018_invitation_management.sql` (new), `packages/db/src/schema.ts`, `apps/api/src/organization-notifications/invitations.ts`, `apps/api/src/organization-notifications/routes.ts` (first-party list route), `apps/api/src/app.ts` (`logSafeOrganizationPath`), `packages/api-contract/src/auth.ts`, `packages/api-contract/src/index.ts`, `apps/web/src/lib/api/openapi-types.gen.ts` (codegen เท่านั้น), focused tests
- **NON-GOALS:** web UI, resend, cancel, retention job, data change ล้างแถวซ้ำเดิม
- **CONTRACTS:** list response, `publicId`, `sent_at`, generated client ที่ NODE-F006-01b ใช้ต่อ
- **VERIFY:** `bun run test:integration` เฉพาะ invitation/migration/route suites, `bun run codegen:check`
- **PROOF:** response ต่อ role × A/B และ non-member (`AC-01`, `AC-02`), denied body เท่ากันใน Organization ที่มีและไม่มีคำเชิญ, `activeCount` กับแถวหมดอายุ/ตอบรับ/ยกเลิก, `limit` นอก `1..50` ได้ `400`, boundary 49/50/51 แถว (`page.total`, จำนวนแถวต่อหน้า, หน้าที่สองของ 51 มีหนึ่งแถว), `offset >= page.total` ได้ `200` ที่ `invitations: []`, `page.total` และ `activeCount` ไม่ขึ้นกับหน้า, ลำดับ `sent_at desc, public_id` คงที่ข้ามหน้าและแถวที่เพิ่งสร้างอยู่ต้นหน้าแรก, `resendAvailableAt` ของแถวที่เพิ่งสร้าง = `sent_at` ของ create + 300 s, create แถวใหม่เปลี่ยนแถวหมดอายุทุกแถวของอีเมลเดียวกันเป็น `canceled` (รวมแถว legacy ที่หมดอายุ) และลิงก์ของแถวนั้นได้ `404`, create ที่ถูกปฏิเสธ (`409`/`403`) ไม่ยกเลิกแถวใด, response/code/โควตาของ `F-004-AC-2` ไม่เปลี่ยนและรัน verification ของ `F-004` `AC-05`–`AC-07` ซ้ำ (`AC-08`), response ไม่มี id (`AC-10`), captured logs ไม่มี PII/token และ path เป็น route template (`AC-14`), migration backfill (`AC-15`), regression: native route ของ hotfix ยัง `403`, ผล `F-004` invitation tests เดิม (`AC-12`)
- **COVERS:** AC-01, AC-02, AC-08, AC-10, AC-12, AC-14, AC-15

### NODE-F006-01b List web

- **OWNER:** software-engineer
- **READY:** NODE-F006-01a merged
- **OUTCOME:** owner/admin เห็น section คำเชิญที่รอตอบรับพร้อม n จาก 100, ป้าย "หมดอายุ" และ pagination
- **SOURCE:** Web, List API ใน Spec นี้; `AC-01`, `AC-02`, `AC-04`, `AC-08`–`AC-12`
- **INVARIANTS:** ไม่มี `invitation.id` หรือลิงก์ใน DOM; ไม่แสดงข้อมูลของ Organization เดิมหลัง switch; section ไม่ render สำหรับ `viewer`/`auditor`
- **FILES:** `apps/web/src/lib/api/invitations.ts`, `apps/web/src/pages/OrganizationMembersPage.tsx`, `apps/web/src/pages/organization-members/PendingInvitationsSection.tsx` (new), `apps/web/src/pages/organization-members/InvitationPanel.tsx` (invalidate list), focused tests
- **NON-GOALS:** API หรือ migration change, resend, cancel
- **CONTRACTS:** query key และ section composition ที่ NODE-F006-02/03 ใช้ต่อ
- **VERIFY:** web unit tests ของ section และ `InvitationPanel`
- **PROOF:** `viewer`/`auditor` ไม่เห็น section (`AC-02`), ตาราง, `page.total` และ n ตรงกับ response ของ A/B ทุกหน้า (`AC-01`), boundary 49/50/51 แถว (ปุ่ม "หน้าถัดไป" ใช้ได้เฉพาะ 51), เปลี่ยนหน้าแสดง loading โดยไม่มีแถวของหน้าเดิม, offset กลับเป็น 0 เมื่อ Organization เปลี่ยน, refresh ที่ได้ `invitations: []` ขณะ `page.total > 0` โหลดหน้าสุดท้ายที่มีแถว และ `page.total = 0` แสดง empty, section loading/empty/error/retry (`AC-04`), list refresh หลัง create ทั้ง `accepted`/`failed` แสดงแถวใหม่ต้นหน้าแรกและหลัง accept (`AC-08`), response A ที่ค้างหลัง switch A→B ไม่เปลี่ยน B (`AC-09`), DOM ไม่มี id/ลิงก์ (`AC-10`), keyboard ของ pagination, focus ไป heading หลังเปลี่ยนหน้า, status และป้าย "หมดอายุ" ใน light/dark (`AC-11`), ไม่มี UI นอก scope (`AC-12`)
- **COVERS:** AC-01, AC-02, AC-04, AC-08, AC-09, AC-10, AC-11, AC-12

### NODE-F006-02 Cancel

- **OWNER:** software-engineer
- **READY:** NODE-F006-01b merged
- **OUTCOME:** ยกเลิกคำเชิญหลัง confirmation ลิงก์เดิมได้ `404` และโควตาคืนทันที
- **SOURCE:** API (cancel), Concurrency, Web; `AC-03`, `AC-06`, `AC-07`, `AC-09`–`AC-14`
- **INVARIANTS:** lock order ตามหัวข้อ Concurrency (prefix เดียวกับ create/accept); role ของ actor อ่านใต้ lock; ไม่ส่งอีเมล
- **FILES:** `apps/api/src/organization-notifications/invitations.ts`, `routes.ts`, `packages/api-contract/src/auth.ts`, `index.ts`, generated client, `apps/web/src/lib/api/invitations.ts`, `PendingInvitationsSection.tsx`, `apps/web/src/pages/organization-members/InvitationCancelAction.tsx` (new), focused tests
- **NON-GOALS:** resend, bulk cancel
- **CONTRACTS:** confirmation/focus pattern ที่ NODE-F006-03 ใช้ต่อ
- **VERIFY:** DB/HTTP cancel matrix (actor × role ของคำเชิญ ใน A และ B รวม `admin` → คำเชิญ `owner` ผ่าน request ตรง และ `publicId` ของ B ใน URL ของ A), races accept×cancel, cancel×cancel และ demotion/revoke ของ actor ระหว่างรอ lock, captured log/audit, web cancel/focus tests, `bun run codegen:check`
- **PROOF:** status `canceled`, preview และ accept ด้วยลิงก์เดิมได้ `404` เหมือน id ที่ไม่มีอยู่, cancel คำเชิญหมดอายุสำเร็จ, re-invite สำเร็จ, `activeCount` จาก 100 เป็น 99, "กลับ"/Escape ไม่ส่ง request, section กัน action อื่นระหว่าง pending และ success แสดงหลังรายการที่ refresh ไม่มีแถวนั้นเท่านั้น (`AC-06`), `admin` เห็นแถว `owner` พร้อม "เฉพาะเจ้าของจัดการได้" และไม่มีปุ่มยกเลิก (`AC-03`), race outcome, UI หลัง accept/cancel จากอีก session หรือ demotion แสดง error, refresh รายการ, ไม่ replay, ไม่แสดง success และ invalidate `ME_CONTEXT_QUERY_KEY` เมื่อได้ `MEMBERSHIP_DENIED`/`PERMISSION_DENIED` (`AC-07`), `viewer`/`auditor` ได้ `403` เท่ากันในแถวที่มีและไม่มี, captured logs ไม่มี PII/token, request count ของ UI, cancel ได้ `404` แสดง "ยกเลิกคำเชิญไม่สำเร็จ โหลดรายการล่าสุดแล้ว" โดยไม่มีอีเมล (`AC-07`), 51 แถวแล้วยกเลิกแถวในหน้าแรก: คงหน้าแรกและแถวที่ 51 เลื่อนขึ้นมา, ยกเลิกแถวเดียวของหน้าสุดท้าย (ไม่ใช่หน้าแรก): โหลดหน้าสุดท้ายที่มีแถว (`AC-06`), อีก session ยกเลิกทุกแถวของหน้าสุดท้ายแล้ว refresh: โหลดหน้าสุดท้ายที่มีแถวหรือ empty (`AC-07`), focus หลังกลับ/สำเร็จ/ล้มเหลว รวมแถวสุดท้าย, แถวเดียวของหน้าสุดท้าย (ไป heading) และแถวเดียว, cancel ที่ค้างจาก A หลัง switch ไม่เปลี่ยน B
- **COVERS:** AC-03, AC-06, AC-07, AC-09, AC-10, AC-11, AC-12, AC-13, AC-14

### NODE-F006-03 Resend

- **OWNER:** software-engineer
- **READY:** NODE-F006-02 merged
- **OUTCOME:** ส่งคำเชิญซ้ำหลัง confirmation ด้วยลิงก์ใหม่อายุ 48 ชั่วโมง ลิงก์เดิมตาย cooldown แสดงเวลา
- **SOURCE:** API (resend), Jobs, Concurrency, Web; `AC-03`, `AC-05`, `AC-07`, `AC-09`–`AC-14`
- **INVARIANTS:** lock order ตามหัวข้อ Concurrency; role ของ actor อ่านใต้ lock; `sent_at` เขียนใน transaction เดียวกับการหมุน id ก่อน SMTP (handoff 5); ไม่มีแถวใหม่; SMTP หลัง commit; ไม่ retry อัตโนมัติ; ไม่เกิน 100 live; ไม่ส่งอีเมลเมื่อ denied
- **FILES:** `apps/api/src/organization-notifications/invitations.ts`, `routes.ts`, `packages/api-contract/src/auth.ts`, `index.ts`, generated client, `apps/web/src/lib/api/invitations.ts`, `PendingInvitationsSection.tsx`, `apps/web/src/pages/organization-members/InvitationResendAction.tsx` (new), focused tests
- **NON-GOALS:** เปลี่ยน role หรืออีเมลของคำเชิญ, bulk resend, delivery tracking
- **CONTRACTS:** resend response และ `INVITATION_RESEND_COOLDOWN`
- **VERIFY:** DB/HTTP resend matrix (actor × role ของคำเชิญ ใน A และ B รวม `admin` → คำเชิญ `owner` ผ่าน request ตรง และ `publicId` ของ B ใน URL ของ A), 99/100 กับคำเชิญหมดอายุ, cooldown ที่วินาที 299 (`429`) และ 300 (ผ่าน) โดยตั้ง `sent_at` ของแถวทดสอบเป็น `clock_timestamp() - interval '299 seconds'`/`'300 seconds'` ทั้งหลัง create, หลัง resend ที่ SMTP `accepted` และหลัง resend ที่ SMTP `failed`, web cooldown ที่ 299/300 ด้วย fake clock, races ที่เหลือใน `AC-13` (accept×resend, resend×resend, resend×cancel, resend หมดอายุ×create ที่ 99, resend หมดอายุ×create อีเมลเดียวกันตาม `lower(email)` ของ create ทั้งสองลำดับ, demotion), SMTP accepted/failed ผ่าน mailer capture, web resend/cooldown/focus tests, `bun run codegen:check`
- **PROOF:** id เปลี่ยน, `public_id` ไม่เปลี่ยน, ลิงก์เดิม `404` และลิงก์ใหม่ `200`, `expires_at - sent_at = 48 hours`, resend คำเชิญที่ยังไม่หมดอายุไม่เปลี่ยน `activeCount` และจำนวนแถวต่ออีเมล, ผู้รับยังไม่เป็นสมาชิกหลัง resend, "กลับ"/Escape ไม่ส่ง request และกดยืนยันซ้อนส่ง request เดียว (request count), `admin` ไม่มีปุ่มส่งซ้ำในแถว `owner` (`AC-03`), `viewer`/`auditor` ได้ `403` เท่ากันในแถวที่มีและไม่มี, resend หมดอายุ×create อีเมลเดียวกัน: create ชนะได้ resend `404` และแถวเดิม `canceled`, resend ชนะได้ create `409 INVITATION_ALREADY_PENDING` และ create ไม่ยกเลิกแถวใด อีเมลนั้นมี live row ไม่เกินหนึ่งแถว, SMTP attempts ต่อ race และ denied = 0, UI หลัง accept/cancel จากอีก session หรือ demotion แสดง error, refresh รายการ, ไม่ replay, ไม่แสดง success และ invalidate `ME_CONTEXT_QUERY_KEY` เมื่อได้ `MEMBERSHIP_DENIED`/`PERMISSION_DENIED` (`AC-07`), captured logs, ข้อความ UI ทุกผลตามตาราง state รวม `USER_ALREADY_MEMBER` แสดง "ผู้รับเป็นสมาชิกแล้ว" (กรณีผู้รับเข้าร่วมก่อน resend) และ `INVITATION_ALREADY_PENDING` แสดง "มีคำเชิญที่ยังใช้ได้สำหรับอีเมลนี้แล้ว" (แถว legacy หมดอายุที่ซ้ำ live row) พร้อม refresh และไม่มีอีเมลในข้อความ (`AC-07`), resend จากหน้าที่สองทั้ง SMTP `accepted`/`failed` แล้ว UI โหลดหน้าแรกที่มีคำเชิญนั้นต้นรายการ (`AC-05`), focus ไปปุ่ม "ส่งซ้ำ" ของคำเชิญเดิมต้นหน้าแรกซึ่งเป็น `aria-disabled` และอ่านข้อความ cooldown ได้ (`AC-11`), resend ที่ค้างจาก A หลัง switch ไม่เปลี่ยน B
- **COVERS:** AC-03, AC-05, AC-07, AC-09, AC-10, AC-11, AC-12, AC-13, AC-14

### NODE-F006-04 Operator provisioning

- **OWNER:** software-engineer
- **READY:** NODE-F006-03 merged
- **OUTCOME:** `bun run provision:organization` กับ Organization ที่มีอยู่เคารพโควตา 100, ไม่สร้าง live row ที่สองของอีเมล และ re-send ด้วยลิงก์ใหม่อายุ 48 ชั่วโมงที่ใช้ได้ ณ เวลา commit
- **SOURCE:** Operator provisioning และ Concurrency ใน Spec นี้; `AC-13` (แถว provisioning), `AC-14`, `AC-16`, `AC-17`, `AC-18`; `OD-18`, `OD-T2`
- **INVARIANTS:** lock order organization row → advisory `notification-membership` → invitation row หลัง advisory ต่อ slug; ทุก check และ write ใช้ `clock_timestamp()` หลังได้ lock; ไม่ตรวจ cooldown แต่เขียน `sent_at`; ไม่มีแถวใหม่ตอน re-send; SMTP หลัง commit เท่านั้น ทางที่ปฏิเสธส่ง 0 ฉบับ; การสร้าง Organization ใหม่, argument และ internal provisioning principal ไม่เปลี่ยน; ไม่ log ลิงก์หรือ invitation id
- **FILES:** `apps/api/src/operator/provision-organization.ts`, `apps/api/src/operator/provision-organization.db.test.ts`, `apps/api/src/operator/provision-organization.test.ts`, `apps/api/src/organization-notifications/invitations.ts` (เฉพาะ export helper หมุน id ถ้า 03 ไม่ได้ export), focused race tests
- **NON-GOALS:** UI ของ provisioning, cooldown ของ provisioning, เปลี่ยน argument หรือ output ของการสร้าง Organization ใหม่, ล้างแถวซ้ำก่อน migration
- **CONTRACTS:** output และ exit code ในหัวข้อ Operator provisioning
- **VERIFY:** `bun run test:integration` เฉพาะ provisioning, invitation และ onboarding suites; race test ที่ถือ transaction ค้างแล้วปล่อยสำหรับแถว provisioning ทั้ง 8 แถวใน Concurrency ทั้งสองลำดับ; test ของ output และ exit code: `main` ไม่ถูก export และรันเฉพาะใต้ `import.meta.main` (`provision-organization.ts:228`, `:295`) worker เลือก spawn process พร้อม SMTP capture ผ่าน env หรือ export entry point ที่รับ argv (ตอนนี้ `provision-organization.test.ts` ทดสอบเฉพาะ `parseProvisionArgs` ที่ `:15`); นับ SMTP ผ่าน mailer capture
- **PROOF:** live 99 → สร้างแถว `owner` หนึ่งแถว `sent_at = created_at` และ `expires_at - sent_at = 48 hours` แถวอยู่ต้นหน้าแรกของ list และ `activeCount` เป็น 100; live 100 (รวมกรณีมีแถวหมดอายุเพิ่ม) → ไม่มีแถวใหม่, SMTP 0, output มีข้อความโควตา 100 และ exit code 1 (`AC-16`); สร้างแถวใหม่ยกเลิกแถวหมดอายุของอีเมลเดียวกันและลิงก์ของแถวนั้นได้ `404` (`OD-T2`); live row role `admin` → แถวไม่เปลี่ยน, SMTP 0, exit code 1; race × create อีเมลเดียวกัน, × resend หมดอายุ, × provisioning, × create อีเมลอื่นที่ 99 และ × resend คำเชิญหมดอายุของอีเมลอื่นที่ 99 ได้ live row ต่ออีเมลไม่เกินหนึ่งและ `activeCount` ไม่เกิน 100 (`AC-17`); re-send → id เปลี่ยน, `public_id` ไม่เปลี่ยน, ลิงก์เดิม `404` และใหม่ `200`, ไม่มีแถวใหม่, `activeCount` ไม่เปลี่ยน, แถวขึ้นต้นหน้าแรก, re-send ภายใน 300 วินาทีสำเร็จ และ resend ของ `F-006` ได้ `429` จนถึง `sent_at + 300 s`; race × resend, × cancel, × accept ตามผลในตาราง Concurrency และลิงก์ในอีเมลที่ capture ใช้ได้เฉพาะของผู้ที่ commit หลัง; SMTP failure → แถวคงอยู่ output ให้รันซ้ำ exit code 1 (`AC-18`); captured log ไม่มีลิงก์หรือ id (`AC-14`); test เดิมของการสร้าง Organization ใหม่และ "already a member" ผ่าน
- **COVERS:** AC-12 (NON-GOALS ของ provisioning), AC-13 (แถว provisioning), AC-14 (provisioning log), AC-16, AC-17, AC-18

## Integrated verification

- หลัง NODE-F006-04 merge รัน scenario รวม A-only/B-only/A+B ตั้งแต่ create → list → resend → accept ด้วยลิงก์ใหม่และเดิม → cancel → re-invite และ switch A→B ระหว่าง request ค้าง (`AC-01`–`AC-11`)
- Provisioning กับ Organization ที่มีอยู่: รันคำสั่งที่ live 99 และ 100, re-send แล้วเปิดลิงก์เดิมและใหม่ และตรวจรายการบนหน้า "องค์กร → สมาชิก" (`AC-16`–`AC-18`)
- `AC-12`: ตรวจ OpenAPI ว่าไม่มี role change, bulk หรือ history endpoint และรัน verification ของ `F-004` `AC-05`–`AC-07` ซ้ำ
- Browser smoke ของหน้า "องค์กร → สมาชิก" ด้วย keyboard ทั้ง light/dark (`AC-11`)
- หลัง writer หยุดทั้งหมด Technical Lead สั่ง final code review หนึ่งครั้ง และ PR CI gates `bun run validate`, `COVERAGE_GATE=1 bun run test:coverage` ตาม `scripts/quality/README.md` ไม่มี release หรือ deploy task

## Decision record

ผู้ใช้ตอบผ่าน AskUserQuestion ของ main session คำตอบยังไม่ใช่การอนุมัติ Spec

| Decision | ผล | วันที่ | ผู้ตัดสิน |
| -------- | -- | ------ | --------- |
| `OD-T1` | pagination `limit`/`offset` 50 ต่อหน้า | 2026-10-01 | ผู้ใช้ |
| `OD-T2` | create เปลี่ยนแถวหมดอายุของอีเมลเดียวกันเป็น `canceled` ใน transaction เดียวกับ insert ไม่ล้างแถวซ้ำก่อน migration | 2026-10-01 | ผู้ใช้ |
| `OD-T3` | cooldown 300 วินาทีนับจาก `sent_at` ล่าสุด นับแม้ SMTP ล้มเหลว | 2026-10-01 | ผู้ใช้ |
| `OD-T4` | resend `USER_ALREADY_MEMBER`/`INVITATION_ALREADY_PENDING` แสดงข้อความเฉพาะแล้ว refresh (ถ้อยคำใน Web error mapping) | 2026-10-01 | ผู้ใช้ |
| `OD-T5` | ปิด native `get-invitation`, `reject-invitation`, `list-user-invitations` | 2026-10-01 | ผู้ใช้ |
| `OD-T6` | hotfix แยก ปิด `list-invitations`, `get-full-organization`, `cancel-invitation` | 2026-10-01 | ผู้ใช้ |
| `OD-T7` | รวม `list-members`, `get-active-member-role` ใน hotfix | 2026-10-01 | ผู้ใช้ |
| `OD-T8` | เพิ่ม `organization/delete` เข้า guard ใน hotfix ไม่ต้องการ flow ลบ Organization | 2026-10-01 | ผู้ใช้ |
| `OD-T9` | cancel `404` แสดง "ยกเลิกคำเชิญไม่สำเร็จ โหลดรายการล่าสุดแล้ว" | 2026-10-01 | ผู้ใช้ |
| `OD-T10` | แตก NODE-F006-01 เป็น 01a (backend) และ 01b (web) | 2026-10-01 | ผู้ใช้ |
| Pagination behavior | resend สำเร็จโหลดหน้าแรก, หน้าว่างหลัง cancel หรือ refresh ไปหน้าสุดท้ายที่มีแถว, focus หลังเปลี่ยนหน้าไป heading ของ section | 2026-10-01 | ผู้ใช้ |
| Provisioning scope | อนุมัติ scope `F-006-S04` และ `AC-16`–`AC-18` ตามข้อความใน `feature.md` | 2026-10-01 | ผู้ใช้ (AskUserQuestion) |
| `OD-18` | re-send ของ provisioning ไม่ผ่าน cooldown 300 วินาที แต่เขียน `sent_at` ทำให้ cooldown ของ resend เริ่มนับใหม่ | 2026-10-01 | ผู้ใช้ (AskUserQuestion) |
| Provisioning `OD-T2` | provisioning ที่สร้างคำเชิญ `owner` ใหม่ยกเลิกแถวหมดอายุของอีเมลเดียวกันแบบ create | 2026-10-01 | ผู้ใช้ (AskUserQuestion) |
| Design decisions | ยอมรับการหมุน `invitation.id` + `public_id` + `sent_at` ใน `0018`, cooldown ใน DB ใต้ Organization lock แทน Redis limiter (REQ-04), audit เฉพาะ denial ตาม `F-004` และอีเมล resend ใช้ชื่อคนที่กด resend (`inviter_id` ไม่เปลี่ยน) | 2026-10-01 | ผู้ใช้ (AskUserQuestion) |
| Risks | ยอมรับทุก risk ในหัวข้อ Risks ยกเว้นสองข้อของ provisioning ซึ่งย้ายมาแก้ใน scope | 2026-10-01 | ผู้ใช้ (AskUserQuestion) |
| Hotfix timing | hotfix native route 9 path เริ่มพร้อม `F-006` ไม่เริ่มก่อน | 2026-10-01 | ผู้ใช้ (AskUserQuestion) |
| ค่าการเริ่มงาน | Start authorization ทั้ง `F-006` (hotfix → 01a → 01b → 02 → 03 → 04), `COMMIT_MODE: owned-slice`, `STOP_AT: merge-ready` มีผลเมื่อผู้ใช้อนุมัติ Spec | 2026-10-01 | ผู้ใช้ (AskUserQuestion) |
| `acceptanceVersion` | คง `F-006-AC-1` ยังไม่ freeze | 2026-10-01 | ผู้ใช้ (AskUserQuestion) |
| อนุมัติ Spec | อนุมัติ Spec ไม่มีข้อแก้ freeze `F-006-AC-1` ค่าการเริ่มงานที่เลือกไว้มีผล | 2026-10-01 | ผู้ใช้ |
| Create กลับหน้าแรก | หลัง create สำเร็จ (ทั้ง `accepted` และ `failed`) section reset offset เป็น 0 ให้แถวใหม่ที่ต้นหน้าแรกมองเห็นได้ (จาก Codex review ของ #52) | 2026-10-02 | ผู้ใช้ (AskUserQuestion) |
| Stacked PRs | เริ่ม NODE-F006-01a ถึง 04 ในรอบเดียวเป็น stacked PR ต่อจาก hotfix (PR #50) `READY` ที่เขียนว่า "<node ก่อนหน้า> merged" หมายถึง PR ของ node ก่อนหน้า merge-ready และ node นี้ต่อจาก head ของ PR นั้น Integrated verification รันที่ head ของ NODE-F006-04 ลำดับ merge คือจากล่างขึ้นบน | 2026-10-01 | ผู้ใช้ |

## Open decisions

| Decision | Options | ข้อแนะนำ | Owner |
| -------- | ------- | -------- | ----- |
| None | | | |

## Revisions

Review round 1-4 ทำโดย Technical Lead จากการอ่าน source เท่านั้น ไม่ได้รัน DB, HTTP หรือ migration findings ทุกข้อแก้ใน body แล้ว

| Date | Change | Approved by user | `acceptanceVersion` |
| ---- | ------ | ---------------- | ------------------- |
| 2026-10-01 | Draft แรก | Not yet | `F-006-AC-1` (draft) |
| 2026-10-01 | review round 1: 10 รายการ แก้ข้อเท็จจริงของ lock order, native route และ trace เพิ่ม `OD-T7` | Not yet | `F-006-AC-1` (draft) |
| 2026-10-01 | review round 2: 8 รายการ แก้ข้อสรุป deadlock (native `organization/delete`), scope ของ `AC-13`, dependency และ PROOF เพิ่ม `OD-T8`, `OD-T9` | Not yet | `F-006-AC-1` (draft) |
| 2026-10-01 | review round 3: 9 รายการ แก้ READY, ผลของ `OD-T2` ต่อ create, PROOF/INVARIANTS ของทุก node และ path ใน Concurrency | Not yet | `F-006-AC-1` (draft) |
| 2026-10-01 | review round 4: 4 รายการ เพิ่ม race resend หมดอายุ×create อีเมลเดียวกัน, `OD-T10`, dependency `355ce1f` และแก้ citation `crud-members.mjs` | Not yet | `F-006-AC-1` (draft) |
| 2026-10-01 | ใส่คำตอบ `OD-T1`–`OD-T10` ของผู้ใช้ (Decision record): เพิ่ม Hotfix native routes, แตก NODE-F006-01 เป็น 01a/01b, ลบทางเลือกที่ไม่ได้เลือก และปรับ Contracts, AC trace และ Tasks ให้ตรงกับ `feature.md` ฉบับที่ Product Owner แก้ (pagination, ข้อความ resend/cancel, create ยกเลิกแถวหมดอายุ, cooldown 299/300) | Not yet | `F-006-AC-1` (draft) |
| 2026-10-01 | ผู้ใช้ยืนยันถ้อยคำ `OD-T4` แบบสั้นและ pagination behavior | Not yet | `F-006-AC-1` (draft) |
| 2026-10-01 | ลบรายละเอียด review round 1-4, ย่อ handoff notes และ Decision record, ปรับภาษาให้อ่านง่าย ไม่เปลี่ยน contract, AC หรือ Task | Not yet | `F-006-AC-1` (draft) |
| 2026-10-01 | รวม operator provisioning (`F-006-S04`, `AC-16`–`AC-18`): เพิ่ม contract Operator provisioning, แถว race ของ provisioning 8 แถว, NODE-F006-04, AC trace ของ `AC-16`–`AC-18`; แก้ `AC-13`, Risks, Data และเวลาเริ่ม hotfix; บันทึกคำตอบผู้ใช้ 8 ข้อใน Decision record | Not yet | `F-006-AC-1` (draft) |
| 2026-10-01 | ผู้ใช้อนุมัติ Spec: `Status` Approved, freeze `F-006-AC-1`, Start authorization ทั้ง `F-006`, `COMMIT_MODE: owned-slice` และ `STOP_AT: merge-ready` มีผล | 2026-10-01 | `F-006-AC-1` (frozen) |
| 2026-10-01 | ผู้ใช้สั่งเริ่ม NODE-F006-01a ถึง 04 เป็น stacked PR ต่อจาก hotfix: ตีความ `READY` และเวลารัน Integrated verification ตาม Decision record "Stacked PRs" ไม่เปลี่ยน contract, AC หรือ Task | 2026-10-01 | `F-006-AC-1` (frozen) |
| 2026-10-02 | Web: offset กลับเป็น 0 หลัง create ที่ server ยืนยันด้วย (Decision record "Create กลับหน้าแรก") ไม่เปลี่ยน API contract หรือ AC | 2026-10-02 | `F-006-AC-1` (frozen) |
| 2026-10-03 | Design decision "Audit: คง denial-only audit ตาม `F-004`" ถูกแทนด้วย `F-007` `OD-08`: create, resend และ cancel ที่สำเร็จเขียน audit event แบบ in-transaction ตาม `docs/features/F-007-organization-audit-log/spec.md` denial audit คงเดิม ข้อความ AC ของ `F-006` ไม่เปลี่ยน | 2026-10-03 (ผ่าน coordinator) | `F-006-AC-1` (frozen) |
