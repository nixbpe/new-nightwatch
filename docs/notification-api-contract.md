# In-app Notification — API contract

**ฉบับ:** `notification-api/1`  
**สถานะ:** Contract `notification-api/1` มี Zod schemas, Hono OpenAPI routes ทั้งเจ็ด, API handlers และ generated Web client; การตรวจ candidate อ้างอิง bound manifest, review และ gates ใน handoff ไม่ใช่ Product Owner acceptance หรือสิทธิ release  
**อ้างอิง:** [Technical implementation spec](notification-implementation-spec.md) §1–5, [frozen Feature AC-01–AC-37](notification-feature-acceptance.md) และ `docs/architecture.md` (`REQ-01`–`06`, `XC-01`–`02`, `FE-01`–`02`)

เอกสารนี้กำหนด business/API semantics ที่ใช้ implement `packages/api-contract`, Hono routes และ client แล้ว Generated Web types มาจาก API composition จริงและ client ตรวจ response ด้วย Zod ข้อกำหนดนี้ไม่เปลี่ยน error shape ของ Better Auth native routes

## 1. ตัวตนและ scope

ทุก operation ต้องมี verified session; หาก email ยังไม่ verified ให้ใช้ boundary เดียวกับ `/api/me/context` Personal rows ผูก `session.user.id` เสมอ Organization rows ของ inbox ผูก **active Organization ที่ server ตรวจ membership ปัจจุบันแล้ว** เท่านั้น หากไม่มี active Organization หรือ session mirror อ้าง Organization ที่สมาชิกภาพใช้ไม่ได้ ให้ API ปรับ mirror ให้เป็น null อย่างสอดคล้องกับ `ORG-04` และตอบเฉพาะ personal rows ห้ามรับ `userId` หรือ `organizationId` จาก query/body ของ inbox operations เพื่อเปลี่ยน scope ผู้ใช้ที่เพิ่งถูกถอด membership ต้องไม่เห็นรายการ Organization เดิม แม้ item เคยถูกส่งแล้ว

Organization settings ใช้ `organizationId` ใน URL เป็น hint ฝั่ง server ต้องตรวจ membership/Owner/Admin ของ Organization นั้นโดยตรงและใช้ ID เดียวกันตลอด service/transaction; ไม่จำเป็นต้องเป็น active Organization หาก actor เป็น Owner/Admin ที่ยังมีสิทธิ์ ค่า setting เป็นระดับ Organization ไม่ใช่ personal scope

## 2. Shapes ที่ต้องนิยามเป็น Zod

ชื่อ field/type ต่อไปนี้เป็นส่วนของสัญญา `notification-api/1`; ห้ามเปลี่ยนระหว่างเขียน handler โดยไม่ปรับฉบับและผู้ใช้ API

```ts
type NotificationEventType =
  | "ORG-NOTIFICATION-SETTINGS-CHANGED"
  | "PASSWORD_CHANGED"
  | "MFA_ENABLED"
  | "MFA_DISABLED";
type ISODateTime = string; // ISO 8601 UTC timestamp, Zod ตรวจ datetime offset

type NotificationItem = {
  id: string; // UUID; opaque recipient item ID ไม่ใช่ intent ID
  scope: "account" | "organization";
  organizationId: string | null; // UUID สำหรับ organization, null สำหรับ account
  eventType: NotificationEventType;
  occurredAt: ISODateTime;
  readAt: ISODateTime | null;
  actor: { displayName: string } | null; // มีเฉพาะ organization settings event
  category: "notification-settings" | null; // มีเฉพาะ organization settings event
};
type NotificationDetail = NotificationItem; // detail ไม่มีข้อมูลลับหรือ action URL ในฉบับนี้

type NotificationListResponse = {
  items: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number; // จำนวนที่ยังไม่อ่านและไม่หมดอายุใน personal + active org
};
type NotificationCountResponse = { unreadCount: number };
type MarkReadResponse = { id: string; readAt: ISODateTime };
type MarkAllReadResponse = { markedCount: number }; // จำนวน rows ที่เพิ่งเปลี่ยนใน request นี้

type OrganizationNotificationSettings = {
  organizationId: string; // UUID
  settingsChangedEnabled: boolean;
  version: number; // integer >= 0; default ไม่มี row = enabled:true, version:0
};
type UpdateOrganizationNotificationSettings = {
  settingsChangedEnabled: boolean;
  expectedVersion: number; // integer >= 0; CAS ป้องกันเขียนทับค่าหน้าเก่า
};
```

`actor.displayName` เป็นข้อมูลแสดงผู้เปลี่ยน ณ เวลาที่ event เกิด; เก็บ/อ่านตาม retention เดียวกับ inbox item ไม่ใช้ credential, email, token หรือรายละเอียดค่าก่อน/หลัง หาก display name ไม่มีค่า ให้ใช้ชื่อที่ UI ระบุว่าไม่ทราบผู้เปลี่ยน; ห้ามดึงข้อมูล Organization ที่ไม่มีสิทธิ์มาเติมโดยอ้อม `scope` กับ `organizationId` และ `eventType` ต้องเป็น discriminated Zod union ไม่ใช่ string ทั่วไป: account scope อนุญาตเฉพาะ Password/MFA events โดย `actor/category` เป็น null; organization scope อนุญาตเฉพาะ settings-changed โดย `actor` ไม่เป็น null และ `category='notification-settings'`

## 3. Routes, status และ body

| Method/path | Input | Success | ขอบเขตและผล |
| --- | --- | --- | --- |
| `GET /api/notifications` | query `limit?: integer 1..50` (default 20), `cursor?: string` (opaque, 1..2048 chars) | `200 NotificationListResponse` | เรียง `occurredAt DESC, id DESC`; personal + verified active Org, ไม่รวม expired |
| `GET /api/notifications/unread-count` | ไม่มี | `200 NotificationCountResponse` | scope เดียวกับ list; ใช้สำหรับ badge |
| `POST /api/notifications/:id/open` | ไม่มี body; `id` UUID | `200 NotificationDetail` | เปิด detail และ mark-read atomically ก่อนตอบ; เปิดซ้ำคืน `readAt` เดิม |
| `PATCH /api/notifications/:id/read` | ไม่มี body; `id` UUID | `200 MarkReadResponse` | explicit mark-one; idempotent, readAt เดิมเมื่ออ่านซ้ำ |
| `POST /api/notifications/read-all` | ไม่มี body | `200 MarkAllReadResponse` | เปลี่ยนเฉพาะ personal + active Org ณ request; ไม่มี active Org เปลี่ยน personal เท่านั้น; อ่านซ้ำได้ `markedCount:0` |
| `GET /api/organizations/:organizationId/notification-settings` | `organizationId` UUID | `200 OrganizationNotificationSettings` | Owner/Admin เท่านั้น; ยังไม่มี row ให้คืน default on/version 0 |
| `PATCH /api/organizations/:organizationId/notification-settings` | `organizationId` UUID; JSON `UpdateOrganizationNotificationSettings` | `200 OrganizationNotificationSettings` | Owner/Admin เท่านั้น; CAS expectedVersion, no-op ไม่สร้าง event; ค่าเปลี่ยนจริง version เพิ่ม 1 พร้อม atomic origin intent ตามค่าก่อนเปลี่ยน |

ห้ามทำ GET detail ที่เปลี่ยน read state; การเปิดรายละเอียดใช้ `POST /open` ตามตาราง และ route UI จะแสดง detail จาก response นี้ Retry `POST /open` หรือ `PATCH /read` ไม่เปลี่ยน `readAt` ที่มีแล้ว หลังหมดอายุให้ถือว่าไม่พบ item แม้ยังไม่ cleanup

Settings PATCH ที่ `expectedVersion` ไม่ตรงคืน `409` แม้ payload ใหม่เท่ากับค่าปัจจุบัน; ผู้ใช้ต้องโหลดค่าปัจจุบันใหม่ PATCH ที่ version ตรงแต่ค่าไม่เปลี่ยนคืน version เดิมและไม่สร้าง intent เมื่อเปลี่ยนจริง ให้ snapshot candidate recipients/อ่านค่า toggle ก่อน mutation ภายใต้ shared Organization lock และ commit preference+intent ร่วมกัน

## 4. Cursor และ concurrency

Cursor เป็น opaque token ที่ server ตรวจความถูกต้องและผูกกับ verified user ID, active Organization ID หรือ `null`, `limit` และ sort anchor `(occurredAt, id)`; มีอายุ 24 ชั่วโมงนับจากออก token และต้องป้องกันการแก้ scope/anchor ด้วย integrity protection ห้ามใส่ credential หรือ notification content ใน cursor เมื่อ Organization switch, ผู้ใช้เปลี่ยน, token ไม่ถูกต้องหรือหมดอายุ ให้คืน `400 INVALID_CURSOR` แล้วเริ่ม pagination ใหม่ ห้ามใช้ cursor ของ Org เดิมกับ Org ใหม่

Keyset pagination ใช้ลำดับ `occurredAt DESC, id DESC`; `id` UUID ไม่ซ้ำและเป็น tie-breaker ทุก scope Item ที่เข้ามาใหม่หลังหน้าก่อนอาจอยู่เหนือ anchor และไม่ปรากฏในหน้าต่อไปจน refresh; การลบ/หมดอายุระหว่างหน้าให้ข้าม item นั้นโดยไม่เติมรายการหมดอายุกลับเข้ามา `nextCursor` เป็น null เมื่อไม่มีรายการต่อ Unread count คำนวณ ณ request และอาจเปลี่ยนระหว่างหน้าเพราะ Worker/การอ่าน; ไม่ถือเป็น snapshot ข้าม requests

สำหรับ mark-all ให้ bind active Organization ที่ตรวจ membership แล้วตลอด operation และใช้ predicate `recipient_user_id=session.user.id` ทั้ง account/organization; concurrent insert หลัง operation ไม่ถูก mark โดยย้อนหลัง การสลับ Org ระหว่าง request ต้องไม่แตะ Organization ใหม่หรืออื่นโดยไม่ตั้งใจ

## 5. Error contract

Application routes ทั้งหมดใช้ `{ "error": { "code": string, "message": string, "details"?: unknown } }` จาก `packages/api-contract/src/error.ts`; `message` แสดงผู้ใช้ได้และไม่เปิดเผย protected data หรือ stack trace Exact status/code:

| กรณี | Status | `error.code` |
| --- | ---: | --- |
| ไม่มี session ที่ valid | 401 | `UNAUTHENTICATED` |
| Session email ยังไม่ verified | 403 | `EMAIL_NOT_VERIFIED` |
| ไม่ใช่สมาชิก Organization ที่ URL ของ settings ระบุ | 403 | `MEMBERSHIP_DENIED` |
| เป็นสมาชิกแต่ไม่ใช่ Owner/Admin สำหรับ settings GET/PATCH | 403 | `PERMISSION_DENIED` |
| Item ID ไม่มีอยู่, หมดอายุ, เป็นของคนอื่นหรือ Org ที่ไม่ active/ไม่มีสิทธิ์ | 404 | `NOTIFICATION_NOT_FOUND` |
| UUID, body, limit หรือ query ไม่ถูกต้อง | 400 | `INVALID_INPUT` |
| Cursor ไม่ถูกต้อง, scope ไม่ตรง หรือใช้ไม่ได้แล้ว | 400 | `INVALID_CURSOR` |
| Settings `expectedVersion` ไม่ตรง | 409 | `SETTINGS_VERSION_CONFLICT` |

List/count/mark-all ที่ไม่มี active Org หรือ active Org ใน session mirror ใช้ไม่ได้ต้องทำ personal-only หลังตรวจสมาชิกภาพและปรับ mirror เป็น null; ห้ามให้ stale Org ปิดกั้น personal notifications Cursor ที่ผูก Org เดิมใช้ต่อไม่ได้และคืน `INVALID_CURSOR` Direct Org-scoped settings URL ที่สมาชิกภาพใช้ไม่ได้ยังคืน `MEMBERSHIP_DENIED`; detail ของ item Org ที่ไม่ใช่บริบทที่มีสิทธิ์คืน `NOTIFICATION_NOT_FOUND` ห้ามแยก error ระหว่าง item ID ของคนอื่นกับ item ที่ไม่มีอยู่ Status/code ทุกช่องต้องประกาศใน Hono OpenAPI response และ Zod error schema ก่อนเริ่มเขียน handler/client

## 6. Acceptance ของ API-contract slice

- Zod schemas ใน `packages/api-contract` ตรง field/discriminant ที่กำหนด; OpenAPI เกิดจาก routes จริง; generated client types และ runtime response parsing ใช้ schema เดียวกัน
- Authorization matrix, RLS boundary, cursor scope, CAS conflict, no-op setting write, self-toggle old value, idempotent mark-read, mark-all scope, 30-day expiry และ partial Organization switch มี integration verification ตาม implementation spec §8
- มี focused API/DB integration, browser smoke, contract/codegen parity และ candidate-level quality/security gates ตาม implementation spec §8; ต้องอ้าง digest ของ bound candidate และหลักฐานจริง ไม่ใช้การ freeze ข้อตกลงเป็นการอนุญาต release
