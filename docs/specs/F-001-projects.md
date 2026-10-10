# F-001 Implementation spec: สร้างและจัดการ Project ภายใต้ Organization

Source: issue #90 (`F-001`, Parent `E-001`) · Shared contract: issue #100 (`TS-001`) · Status: Draft

Spec นี้คือส่วนของ `TS-001` ที่ `F-001` ต้อง implement กฎที่ `TS-001` กำหนดไว้แล้วใช้ตามนั้นโดยไม่คัดลอกซ้ำ จุดที่ spec นี้ต่างจาก `TS-001` อยู่ในหัวข้อ "ข้อแก้ไขที่ต้องนำกลับไปอัปเดต TS-001" Acceptance criteria อ้างจาก #90 ด้วย ID `AC-01` ถึง `AC-11`

## ขอบเขต

ทำใน F-001:

- Migration `0023_projects.sql` สร้าง `projects` และ `project_members` พร้อม RLS, grants และ audit actions ของ Project
- Contract, permission module และ API: รายการ สร้าง แก้ไข ลบ
- หน้า `/organizations/:organizationId/projects` พร้อม dialog สร้าง แก้ไข และยืนยันการลบ
- Nav leaf หนึ่งรายการใต้กลุ่ม `องค์กร` เพื่อให้เข้าหน้าได้โดยไม่ต้องพิมพ์ URL

ไม่ทำใน F-001 (เจ้าของงานอยู่ในวงเล็บ):

- API และหน้าสมาชิก Project, `member-candidates` (`F-002`, `TS-001-T05`, `T08`)
- `GET /{projectId}`, route ใต้ `/projects/:projectId/...`, `member_last_project`, `scope` ใน `nav-config.ts`, sidebar และตัวสลับ Project (`F-010`, `TS-001-T09`)
- การปฏิเสธนำผู้ดูแลคนสุดท้ายออกจากองค์กร (`F-003`, `TS-001-T11`)
- ลิงก์จากแถวในตารางไปหน้าของ Project เพราะยังไม่มีหน้าปลายทาง (`F-012`)

## Data และ RLS (`TS-001-T01`)

ใช้ตาราง `projects` และ `project_members` ตาม `TS-001` หัวข้อ "Data และ RLS" โดยมีรายละเอียดเพิ่มดังนี้

`projects`:

- `check (char_length(name) between 1 and 80)`, `check (description is null or char_length(description) between 1 and 500)`, `check (slug ~ '^[a-z0-9-]{3,40}$')` (`AC-03`)
- ไม่มีคอลัมน์ `created_by` ผู้สร้างดูได้จาก audit event `organization.project.create`
- Grants ให้ `nightwatch`: `select, insert, delete` และ `update (name, description, updated_at)` แบบระบุคอลัมน์ ทำให้ runtime role แก้ `slug`, `tenant_id` และ `id` ไม่ได้ในระดับฐานข้อมูล (`AC-03`, `AC-10`, DB-12) service เขียน `update` ด้วย SQL ที่ระบุคอลัมน์เอง ไม่ผ่าน helper ที่เขียนทุกคอลัมน์

`project_members`:

- โครงสร้างและ FK ตาม `TS-001` รวม `foreign key (tenant_id, user_id) references member (organization_id, user_id) on delete cascade` ซึ่งอ้าง unique index `member_organization_user_key`
- Grants ให้ `nightwatch`: `select, insert` เท่านั้น (DB-12) F-001 เขียนตารางนี้ครั้งเดียวตอนสร้าง Project (`AC-02`) และอ่านตอนนับสมาชิกและหาบทบาทของผู้ใช้ (`AC-05`) แถวถูกลบผ่าน cascade จาก `projects` และ `member` ซึ่ง PostgreSQL รันในฐานะ owner ของตาราง runtime role จึงไม่ต้องมีสิทธิ์ `delete` `F-002` เพิ่ม `update (role), delete` ใน migration ของตน

RLS ทั้งสองตารางใช้รูปแบบของ `0016_uptime_monitors.sql`: `enable` และ `force row level security`, restrictive policy `<table>_tenant_context` และ permissive policy `<table>_tenant_access` บน `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid` ทั้ง `using` และ `with check` (DB-04)

Index: `project_members (tenant_id, user_id)` สำหรับหา Project ที่ผู้ใช้เข้าร่วม

Audit actions ใน `0023`: เฉพาะ `organization.project.create`, `organization.project.update`, `organization.project.delete` ใน category `project` และ `target_type` `project`

ฝั่งฐานข้อมูล: `0023` drop แล้ว add ใหม่ 4 constraint ใน `0020_organization_audit_log.sql` ได้แก่ column check ที่ไม่ได้ตั้งชื่อ 3 ตัว (`0020:20-45`, ชื่ออัตโนมัติคาดว่าเป็น `audit_events_category_check`, `audit_events_action_check`, `audit_events_target_type_check` ให้ยืนยันด้วย `\d audit_events` ก่อนเขียน) และ named constraint `audit_events_category_matches_action` (`0020:51-59`, เพิ่ม `when action like 'organization.project.%' then 'project'`) `audit_events` เป็น partitioned table (`0020:60`) การ alter constraint ทำที่ parent

ฝั่งเขียน:

1. `AUDIT_ACTIONS`, `AUDIT_ACTION_LABELS`, `AUDIT_CATEGORIES` และ `AUDIT_CATEGORY_LABELS` ใน `packages/api-contract/src/audit-log.ts`
2. `packages/shared/src/audit-export.ts` (`apps/api/src/audit/shared-parity.test.ts` ตรวจให้ตรงกัน)
3. `AUDIT_ACTION_CATEGORIES` และ union ของ `AuditEventTarget.type` ใน `apps/api/src/audit/record.ts`

ฝั่งอ่าน (หน้าบันทึกกิจกรรมใช้ไม่ได้ถ้าขาด เพราะ `targetOf` ใน `apps/api/src/audit/read-service.ts:124` ไม่มี `default`):

1. สมาชิก `project` ใน `auditTargetSchema` (`audit-log.ts:110-134`) รูปเดียวกับ `monitor`: `{ type: "project", projectId, displayName, deleted }`
2. join และคอลัมน์ที่ใช้ร่วมกันใน `packages/db/src/audit-events.ts:27-44`: `left join projects`, คอลัมน์ `projectExists`, `targetName` ที่ครอบ Project, การค้นหา `q` (`:97`) และ `AuditEventBatchRow` (`:105-122`) ทั้ง read-service และ Worker exporter ใช้ไฟล์นี้
3. case `project` ใน `targetOf` และ field คู่กับ `EventRow.monitorExists` (`read-service.ts:111`)
4. case `project` ใน `targetLabel` ของ `apps/worker/src/audit/events.ts:33-54` ซึ่งมี `default` ที่คืน "การตั้งค่าการแจ้งเตือน" typecheck จึงจับไม่ได้
5. case `project` ใน `targetText` ของ `apps/web/src/pages/audit-log/labels.ts:33-48`
6. `description` ใน `AUDIT_CHANGE_FIELDS` (`audit-log.ts:71`) และ `CHANGE_FIELD_LABELS` (`labels.ts`) พร้อมเปลี่ยน label ของ `name` จาก "ชื่อมอนิเตอร์" (`labels.ts:55`) เป็น "ชื่อ" เพราะ field นี้ใช้ร่วมกันแล้ว
7. เพิ่ม "โปรเจกต์" ในข้อความ `auditScopeNote` ทั้ง `audit-log.ts:430` และ `packages/shared/src/audit-export.ts:90` ไม่อย่างนั้นข้อความบอกผู้ใช้ว่าไม่ได้บันทึกการกระทำกับ Project

Drizzle: เพิ่ม `projects` และ `projectMembers` ใน `packages/db/src/schema.ts` และใน object `schema`

## Contract (`TS-001-T02`)

ไฟล์ใหม่ `packages/api-contract/src/project.ts` พร้อม `project.test.ts` และ re-export จาก `index.ts`

```ts
export const PROJECT_LIMIT_PER_ORGANIZATION = 50;

const projectName = z.string().trim().min(1).max(80);
const projectSlug = z.string().regex(/^[a-z0-9-]{3,40}$/);
const projectDescription = z
  .string()
  .trim()
  .max(500)
  .transform((value) => (value === "" ? null : value))
  .nullable();

export const createProjectRequestSchema = z.strictObject({
  name: projectName,
  slug: projectSlug,
  description: projectDescription.optional(),
});

export const updateProjectRequestSchema = z
  .strictObject({ name: projectName, description: projectDescription })
  .partial()
  .refine((body) => Object.keys(body).length > 0);

export const projectRoleSchema = z.enum(["admin", "member"]);

export const projectSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  myRole: projectRoleSchema.nullable(),
  updatedAt: z.iso.datetime(),
});

export const projectListResponseSchema = z.object({
  projects: z.array(projectSummarySchema),
});
```

- ความยาวนับหลัง trim Zod 4 (`4.5.4` ใน repo) และ `char_length` ของ PostgreSQL นับเป็น code point ทั้งคู่ จึงได้ผลตรงกันทั้งภาษาไทยและ emoji (reviewer รัน Zod ยืนยันที่ขอบ 80/81)
- request schema ใช้ `z.strictObject` ตาม `monitor.ts:345,364` `updateProjectRequestSchema` ไม่มี `slug`, `organizationId` หรือ `tenantId` PATCH ที่ส่ง key เหล่านี้ได้ `400 VALIDATION_ERROR` และ body ว่างก็ได้ `400` (`AC-03`, `AC-10`)
- `myRole` เป็น `null` เมื่อผู้ใช้ไม่ได้เป็นสมาชิก Project ซึ่งเกิดได้กับ Owner/Admin เท่านั้น (`AC-05`)
- Error codes ใหม่: `PROJECT_NOT_FOUND` (404), `PROJECT_SLUG_TAKEN` (409), `PROJECT_LIMIT_REACHED` (409) ประกาศเป็น `PROJECT_ERROR_CODES` และ response schema ต่อ code แบบเดียวกับ `MONITOR_ERROR_CODES` และ `monitorErrorSchema` (`monitor.ts:147`, `monitor.ts:1346`)

## สิทธิ์ (`TS-001-T03`)

`apps/api/src/projects/access.ts` ใช้ `ProjectAccess` union ของ `TS-001` ใน F-001 ตาราง `PROJECT_PERMISSIONS` มีสอง action ที่มี route ใช้เท่านั้น (`project.read` มากับ `GET /{projectId}` ใน feature ที่ใช้) `F-002`, `F-011` และ `F-014` เพิ่ม action ของตนเข้าตารางเดียวกัน

| Action           | `org-admin` | `member` / `admin` | `member` / `member` | `none`    |
| ---------------- | ----------- | ------------------ | ------------------- | --------- |
| `project.update` | ได้         | ได้                | 403                 | 404       |
| `project.delete` | ได้         | 403                | 403                 | 404       |

- `org-admin` มาจาก `normalizeOrganizationRole(member.role)` เป็น `owner` หรือ `admin` อ่านใหม่หลัง lock แถว `organization` ทุกคำขอ (หลักใน `enterOrganization` แต่ไม่เรียกฟังก์ชันนั้นเพราะมันตรวจสิทธิ์ของมอนิเตอร์)
- แถว `project_members` ของผู้ใช้อ่านหลัง `projects ... for update` เสมอ เพราะ `F-002` เปลี่ยนบทบาทโดย lock แถว Project เดียวกัน การอ่านก่อน lock ทำให้ตรวจสิทธิ์จากบทบาทที่เพิ่งถูกเปลี่ยน
- สร้าง Project ไม่ผ่านตารางนี้ เพราะยังไม่มี Project ให้คำนวณ access ตรวจด้วย role ขององค์กรโดยตรง ไม่ใช่ `owner` หรือ `admin` ตอบ `403 PERMISSION_DENIED` (`AC-01`)
- ผู้ที่ไม่ใช่สมาชิกองค์กรตอบ `403 MEMBERSHIP_DENIED` ก่อนถึงตารางนี้ ตามรูปแบบเดิมของทุก route ใต้ `/api/organizations/{organizationId}`
- unit test ครอบทุกคู่ access × action ในตาราง

## Concurrency

ลำดับ lock ของทุก write: แถว `organization` แบบ `for share` แล้ว advisory lock `projects:<organizationId>` (เฉพาะ create) แล้วแถว `projects` แบบ `for update` (เฉพาะ update และ delete) ลำดับนี้ตรงกับ comment ที่ `monitors/service.ts:155`

- เพดาน 50 (`AC-11`): ภายใต้ advisory lock นับ `projects` ขององค์กร ถ้าได้ 50 ขึ้นไปตอบ `409 PROJECT_LIMIT_REACHED` คำขอสร้างพร้อมกันสองคำขอที่ Project ที่ 49 รอ lock เดียวกัน คำขอที่สองเห็นจำนวน 50 จึงสำเร็จได้ไม่เกินหนึ่ง
- slug ซ้ำ (`AC-04`): บังคับด้วย `unique (tenant_id, slug)` service แปลง `23505` ของ constraint นี้เป็น `409 PROJECT_SLUG_TAKEN` พร้อม `details: { field: "slug" }` ไม่ pre-check ด้วย select เพราะ select แข่งกับ insert ได้
- สร้าง (`AC-02`, `AC-09`): insert `projects`, insert `project_members (role = 'admin')` ของผู้สร้าง และ `recordAuditEvent` ในธุรกรรมเดียว
- แก้ไข: lock แถว Project แล้วเทียบค่าเดิม ถ้าไม่มีค่าเปลี่ยนตอบ `200` พร้อมข้อมูลเดิม ไม่เขียน audit และไม่เปลี่ยน `updated_at` ทำให้ PATCH ซ้ำได้ผลเท่าเดิม
- ลบ: lock แถว Project, delete แถว (cascade ลบ `project_members`) และเขียน audit ในธุรกรรมเดียว ลบซ้ำได้ `404 PROJECT_NOT_FOUND`
- แก้ไขหรือลบ Project ที่อีกคำขอลบไปแล้วได้ `404 PROJECT_NOT_FOUND`

## API (`TS-001-T04`)

Module ใหม่ `apps/api/src/projects/` (`contract.ts`, `routes.ts`, `service.ts`, `access.ts`) ลงทะเบียนใน `createApp` ด้วย `registerProjectRoutes` ทุก route ทำตามขั้นใน `organization-notifications/routes.ts`: `requireVerifiedSession`, `auditDenials`, `assertMemberBeforeTenantContext` แล้ว `withTenantContextRaw`

| Method | Path | ผล | Errors |
| --- | --- | --- | --- |
| GET | `/api/organizations/{organizationId}/projects` | `200 projectListResponseSchema` | 403 `MEMBERSHIP_DENIED` |
| POST | `/api/organizations/{organizationId}/projects` | `201 projectSummarySchema` (`myRole: "admin"`, `memberCount: 1`) | 403 `PERMISSION_DENIED`, 409 `PROJECT_SLUG_TAKEN`, 409 `PROJECT_LIMIT_REACHED`, 400 `VALIDATION_ERROR` |
| PATCH | `/api/organizations/{organizationId}/projects/{projectId}` | `200 projectSummarySchema` | 403 `PERMISSION_DENIED`, 404 `PROJECT_NOT_FOUND`, 400 `VALIDATION_ERROR` |
| DELETE | `/api/organizations/{organizationId}/projects/{projectId}` | `204` | 403 `PERMISSION_DENIED`, 404 `PROJECT_NOT_FOUND` |

รายการ (`AC-05`, `AC-06`):

- `owner` และ `admin` ได้ทุก Project ขององค์กร role อื่นได้เฉพาะ Project ที่มีแถวใน `project_members`
- query เดียว: `projects` left join แถว `project_members` ของผู้ใช้เพื่อได้ `myRole` และ subquery นับ `project_members` เพื่อได้ `memberCount` ใส่ `tenant_id = $1` ทุกตาราง (หลัก DB ใน `docs/architecture.md`)
- เรียงตาม `name` แล้ว `id` ไม่มี pagination เพราะเพดาน 50 แถว ตัวกรองและการค้นหาทำที่ web

Audit (`AC-09`):

- `target: { type: "project", id }` ไม่มี `attributes` ตามแบบ `organization.monitor.create` (`monitors/service.ts:420`) และข้อห้ามใน `record.ts` ที่ไม่ให้เก็บชื่อหรือข้อความค้นหา read-service หาชื่อปัจจุบันจากตาราง `projects`
- `actorRole` เป็น role ขององค์กร
- update บันทึก `name` แบบค่าก่อนและหลังด้วย `scalarChange` ตามแบบ `monitors/audit.ts:189` และบันทึก `description` เป็น `before: null, after: { kind: "changed" }` ตามแบบ `orderChange` โดยไม่เก็บข้อความ เพราะคำอธิบายยาวได้ 500 ตัวอักษรและอาจมีข้อมูลส่วนบุคคล (หลัก "Logging, audit and health")

Logging: เพิ่ม segment `projects` และ `{projectId}` ใน `logSafeOrganizationPath` (`apps/api/src/app.ts:149-262`) วันนี้ segment ที่ไม่รู้จักกลายเป็น `:segment` (`app.ts:255-258`) จึงไม่รั่ว แต่ log อ่านไม่ออกว่าเป็น route ไหน test ใน `app.integration.test.ts` ตรวจ string ตรงตัว `/api/organizations/:organizationId/projects/:projectId`

Rate limit: ไม่ใช้ route ของ member และ monitor CRUD ก็ไม่ใช้ limiter (REQ-04 ใช้เฉพาะ monitor test route)

## Web (`TS-001-T06`, `TS-001-T07`)

API client: `apps/web/src/lib/api/projects.ts` เรียกผ่าน `request()` ของ `client.ts` ตรวจ response ด้วย schema จาก contract (WEB-01, WEB-02)

- `projectQueryKeys.all(orgId) = ["tenant", "projects", orgId]` และ `projectQueryKeys.list(orgId) = [...all(orgId), "list"]` (WEB-03) ตัวกรองและคำค้นไม่อยู่ใน key เพราะไม่ส่งไป API
- หลัง create, update หรือ delete สำเร็จ invalidate `projectQueryKeys.all(orgId)`

Route: `/organizations/:organizationId/projects` เป็น sibling ของ route สมาชิกใน `router.tsx` loader `projectsLoader` ใน `lib/auth/loaders.ts` ตามแบบ `monitorsOverviewLoader` (WEB-04)

Nav: leaf `โปรเจกต์ทั้งหมด` ใน group `องค์กร` ของ `nav-config.ts` ไม่กำหนด `roles` และไม่มี `count` (ชื่อจาก design artboard Sidebar) `F-010` เป็นเจ้าของ sidebar ตาม Project ต่อ

หน้า `apps/web/src/pages/projects/ProjectsPage.tsx`:

- `PageHeader`: eyebrow `// PROJECTS`, title `โปรเจกต์`, status line `<n> โปรเจกต์ · คุณเข้าร่วม <m> โปรเจกต์` และคำอธิบายตาม design ปุ่ม `สร้างโปรเจกต์` แสดงเฉพาะ `owner` และ `admin` (`AC-01`)
- ปุ่มปิดเมื่อ `projects.length >= PROJECT_LIMIT_PER_ORGANIZATION` (Owner/Admin เห็นทุก Project จำนวนในรายการจึงเป็นจำนวนจริงขององค์กร) พร้อมข้อความใต้ปุ่ม `องค์กรมีโปรเจกต์ครบ 50 โปรเจกต์แล้ว ลบโปรเจกต์ที่ไม่ใช้ก่อนสร้างใหม่` (`AC-11`)
- ตาราง `DataTable` คอลัมน์ตาม design: โปรเจกต์ (ชื่อและ slug แบบ monospace), สมาชิก, บทบาทของคุณ (`ผู้ดูแล`, `สมาชิก`, `ไม่ได้เข้าร่วม` ด้วย `StatusPill`), อัปเดตล่าสุด (`YYYY-MM-DD HH:mm` ด้วย formatter ใน `pages/monitors/format.tsx`) (`AC-05`)
- คอลัมน์การทำงานแสดง `แก้ไข` เมื่อ `myRole === "admin"` หรือ role องค์กรเป็น `owner`/`admin` และ `ลบ` เมื่อ role องค์กรเป็น `owner`/`admin` (`OD-01`)
- `SegmentedControl` `ทั้งหมด` / `ที่ฉันเข้าร่วม` และช่องค้นหา `ค้นหาด้วยชื่อหรือ slug` แบบ debounce ตาม `monitors/OverviewPage.tsx` กรองฝั่ง client แบบไม่สนตัวพิมพ์บน `name` และ `slug` และประกาศผลด้วย `role="status"` (`AC-07`)

สถานะของหน้า (CMP-01, `AC-06`, `AC-07`, ข้อความตาม `OD-03`):

| สถานะ | เงื่อนไข | แสดง |
| --- | --- | --- |
| loading, error | query ยังไม่เสร็จหรือล้มเหลว | `PageState` |
| ไม่มีสิทธิ์ | ไม่ใช่สมาชิกองค์กรใน URL หรือ API ตอบ `403 MEMBERSHIP_DENIED` หรือ `PERMISSION_DENIED` | `PageState kind="denied"` ตามแบบ `monitors/OverviewPage.tsx:218,273-279` และ `isDenied` (`workspace/rows.ts:14-17`) |
| ยังไม่มี Project | `owner`/`admin`, รายการว่าง | `EmptyState variant="first-run"` `ยังไม่มีโปรเจกต์` พร้อมปุ่มสร้าง |
| ไม่ได้อยู่ใน Project ใด | role อื่น, รายการว่าง | `EmptyState` `คุณยังไม่ได้อยู่ในโปรเจกต์ใด ติดต่อเจ้าของหรือผู้ดูแลองค์กรเพื่อเข้าร่วมโปรเจกต์` |
| ไม่พบผลลัพธ์ | รายการไม่ว่าง แต่ตัวกรองหรือคำค้นไม่ตรง | `EmptyState` `ไม่พบโปรเจกต์ที่ตรงกับตัวกรอง` พร้อมปุ่ม `ล้างตัวกรอง` |

`ProjectFormDialog` (สร้างและแก้ไข) ใน `pages/projects/`:

- โครง modal ตาม `audit-log/ExportDialog.tsx` (portal, `role="dialog"`, `aria-modal`) ทำตาม CMP-02, CMP-03 และ LAY-07
- ช่อง ชื่อ, slug (โหมดแก้ไขแสดงเป็นข้อความ monospace แก้ไม่ได้), คำอธิบาย (textarea, optional) พร้อม hint ความยาวและรูปแบบ slug
- จัดการ error แบบ `MonitorForm.handleError`: `PROJECT_SLUG_TAKEN` แสดงที่ช่อง slug `slug นี้ถูกใช้แล้วในองค์กร` และคงค่าทุกช่อง (`AC-04`), `PROJECT_LIMIT_REACHED` แสดงระดับฟอร์ม, `PERMISSION_DENIED` และ `PROJECT_NOT_FOUND` ปิด dialog แล้ว refetch รายการ

ลบ: `ConfirmDialog` `confirmVariant="destructive"` title `ลบโปรเจกต์ <name>` เนื้อหา `มอนิเตอร์ สมาชิก และการเชื่อมต่อ AWS ของโปรเจกต์นี้จะถูกลบด้วย และกู้คืนไม่ได้` (`AC-08`)

## Dependency contract สำหรับ feature ถัดไป

ตารางที่เป็นของ Project (`F-011` มอนิเตอร์, `F-014`/`F-015` การเชื่อมต่อ AWS) ต้องมี `foreign key (project_id, tenant_id) references projects (id, tenant_id) on delete cascade` เพื่อให้ข้อความใน `AC-08` เป็นจริง ถ้า feature ใดลบแบบ cascade ไม่ได้ (เช่นต้องลบ partition หรือเรียก AWS) feature นั้นต้องเปลี่ยนขั้นลบ Project ก่อน merge

## Tasks

| Task | งานใน F-001 | ไฟล์หลัก | ขึ้นกับ | หลักฐาน |
| --- | --- | --- | --- | --- |
| `TS-001-T01` | `0023_projects.sql`, Drizzle schema | `packages/db/migrations/0023_projects.sql`, `packages/db/src/schema.ts`, `packages/db/tests/projects.db.test.ts` (เพิ่มใน script `test:integration` ของ package) | ไม่มี | `cd packages/db && bun run test:integration` |
| `TS-001-T02` | Contract และ audit actions ฝั่ง TS | `packages/api-contract/src/project.ts`, `audit-log.ts`, `packages/shared/src/audit-export.ts` | T01 | `bun run --cwd packages/api-contract test` |
| `TS-001-T03` | `access.ts` | `apps/api/src/projects/access.ts`, `access.test.ts` | T02 | `cd apps/api && bun run test` |
| `TS-001-T04` | API, audit เขียนและอ่าน (รวม Worker exporter), log redaction | `apps/api/src/projects/`, `apps/api/src/audit/record.ts`, `apps/api/src/audit/read-service.ts`, `packages/db/src/audit-events.ts`, `apps/worker/src/audit/events.ts`, `apps/api/src/app.ts` | T03 | `cd apps/api && bunx vitest run --project integration src/projects/` |
| `TS-001-T06` | OpenAPI codegen และ client | `apps/web/src/lib/api/openapi-types.gen.ts`, `apps/web/src/lib/api/projects.ts` | T04 | `bun run codegen:check` |
| `TS-001-T07` | หน้า, dialog, loader, nav leaf, `targetText` และ label ของ field ในหน้าบันทึกกิจกรรม, `docs/features.md`, ตัวอย่าง nav ใน `docs/ref/shell-structure.md` | `apps/web/src/pages/projects/`, `router.tsx`, `lib/auth/loaders.ts`, `components/shell/nav-config.ts` | T06 | `bun run --cwd apps/web test` |
| `TS-001-T10` (ส่วน F-001) | E2E | `e2e/tests/projects.spec.ts` | T07 | `bun run --cwd e2e test tests/projects.spec.ts` |

T01 ถึง T04 ใช้ไฟล์ต่อกันจึงทำเรียงกัน T07 เริ่มทำ UI กับ mock client ได้หลัง T02 แต่ต้องรอ T06 ก่อนต่อ API จริง ทุก task ปิดด้วย `bun run typecheck` และ `bun run lint`

## Verification mapping

ทุกข้อผูกกับ test ที่ระบุชื่อ case ไว้ ไฟล์ `*.db.test.ts` รันกับ runtime role `nightwatch` (NOBYPASSRLS)

| AC | Test |
| --- | --- |
| `AC-01` | API db test: `viewer` และ `auditor` POST ได้ `403 PERMISSION_DENIED`; web test: ไม่มีปุ่มสร้างสำหรับ `viewer` และ `auditor`; E2E: `viewer` ไม่เห็นปุ่ม |
| `AC-02` | API db test: หลัง POST มีแถว `project_members` ของผู้สร้าง `role = 'admin'` และ response `myRole: "admin"` |
| `AC-03` | contract test: ขอบ 0/1/80/81 ของชื่อ, 2/3/40/41 และอักขระนอก `[a-z0-9-]` ของ slug, 500/501 ของคำอธิบาย; API db test: PATCH ที่ส่ง `slug` ได้ `400` และ slug ในฐานข้อมูลไม่เปลี่ยน; db test: `update projects set slug` และ `set tenant_id` ด้วย role `nightwatch` ถูกปฏิเสธ |
| `AC-04` | API db test: slug ซ้ำได้ `409 PROJECT_SLUG_TAKEN`, `details.field = "slug"`; slug เดียวกันในอีกองค์กรสร้างได้; web test: error อยู่ที่ช่อง slug และค่าที่กรอกยังอยู่ |
| `AC-05` | API db test: `memberCount`, `myRole`, `updatedAt` ถูกต้อง, Owner เห็น Project ที่ไม่ได้เข้าร่วมพร้อม `myRole: null`; web test: pill `ไม่ได้เข้าร่วม` |
| `AC-06` | API db test: `viewer` ที่ไม่อยู่ใน Project ใดได้รายการว่าง และไม่เห็น Project ที่ไม่ได้เข้าร่วม; web test: ข้อความให้ติดต่อผู้ดูแลองค์กร |
| `AC-07` | web test: ตัวกรอง `ที่ฉันเข้าร่วม`, ค้นหาด้วยชื่อและ slug, สถานะ `ไม่พบ` แยกจาก `ยังไม่มีโปรเจกต์` |
| `AC-08` | web test: ConfirmDialog มีข้อความครบสามรายการ และกดยกเลิกแล้วไม่เรียก API; db test: ลบ Project แล้วแถว `project_members` หายด้วย |
| `AC-09` | API db test: หลัง create, update และ delete เรียก `GET` audit log ของ API แล้วได้สาม event พร้อม target `project` (`deleted: true` หลังลบ); Worker test: export มี label ของ Project ไม่ใช่ "การตั้งค่าการแจ้งเตือน"; ทำให้ `recordAuditEvent` throw ด้วย `vi.spyOn` แล้ว POST ไม่เหลือแถว Project |
| `AC-10` | contract test: `updateProjectRequestSchema` ปฏิเสธ `organizationId`, `tenantId` และ `slug`; db test เดียวกับ `AC-03` ที่ปฏิเสธ `update ... set tenant_id`; OpenAPI ไม่มี route ที่เปลี่ยนองค์กรของ Project |
| `AC-11` | API db test: Project ที่ 51 ได้ `409 PROJECT_LIMIT_REACHED`; race test: มี 49 Project แล้วส่ง POST สองคำขอพร้อมกันด้วย connection แยกกัน สำเร็จหนึ่ง ได้ `409` หนึ่ง และนับได้ 50; web test: ปุ่มปิดพร้อมข้อความเพดานเมื่อรายการมี 50 Project |

Test เพิ่มที่ไม่ผูกกับ AC แต่บังคับตาม `docs/architecture.md`:

- RLS (DB-04): อ่าน เขียน และลบ `projects` และ `project_members` ข้ามองค์กรไม่ได้, ไม่มี `app.tenant_id` แล้วอ่านไม่ได้, grants ตรงกับรายการข้างบน ตามแบบ `packages/db/tests/monitor.db.test.ts:251`
- Cascade จาก auth table: ลบแถว `member` ด้วย role `nightwatch` โดยไม่ตั้ง `app.tenant_id` แล้วแถว `project_members` ที่ FORCE RLS ถูกลบจริง (เป็นตาราง RLS แรกที่อ้างตาราง auth)
- denied state: web test ที่ API ตอบ `403 MEMBERSHIP_DENIED` แสดง `PageState kind="denied"` (CMP-01)
- `PROJECT_NOT_FOUND`: ผู้ใช้ที่เข้าถึง Project ไม่ได้ PATCH หรือ DELETE ได้ `404` เหมือน id ที่ไม่มีอยู่, และ id ของ Project ในองค์กรอื่นได้ `404`
- Log redaction: path ของ PATCH Project ถูก log เป็น `/api/organizations/:organizationId/projects/:projectId` ตรงตัว

## ข้อแก้ไขที่ต้องนำกลับไปอัปเดต TS-001

| จุดใน #100 | ข้อแก้ไข | เหตุผล |
| --- | --- | --- |
| Concurrency: เพดานใช้ `organization ... for update` | ใช้ `for share` บน `organization` แล้ว advisory lock `projects:<organizationId>` | ตรงกับเพดานมอนิเตอร์ (`monitors/service.ts:366`) การสร้าง Project จึงไม่ต่อคิวกับ writer อื่นที่ถือ `for share` เช่นการสร้างมอนิเตอร์ ส่วนการเปลี่ยนสมาชิกองค์กร (`for update`) ยังต่อคิวกันเหมือนเดิม ผลต่อ `AC-11` เท่าเดิม |
| Data: audit actions ทั้ง Project และสมาชิกใน `0023` | `0023` เพิ่มเฉพาะ `organization.project.create|update|delete` ส่วน `organization.project.member.*` ไปอยู่ใน migration ของ `F-002` | action ที่ยังไม่มีใคร emit จะโผล่เป็นตัวเลือกในตัวกรองหน้าบันทึกกิจกรรม |
| Data: รายการไฟล์ที่ต้องแก้สำหรับ audit action | เพิ่ม `packages/shared/src/audit-export.ts` และ `shared-parity.test.ts` | parity test ล้มถ้าไม่แก้ |
| ไม่ได้กล่าวถึง | grants แบบระบุคอลัมน์ `update (name, description, updated_at)` บน `projects` | บังคับ `AC-03` และ `AC-10` ที่ฐานข้อมูล |
| ไม่ได้กล่าวถึง | `logSafeOrganizationPath` ต้องรู้จัก segment `projects` | หลัก "Logging, audit and health" |
| ไม่ได้กล่าวถึง | error code ของ slug ซ้ำคือ `PROJECT_SLUG_TAKEN` | `AC-04` ระบุแค่ `409` |
| `ProjectAction` มีครบทุก feature ตั้งแต่แรก | F-001 เพิ่มแค่ `project.update` และ `project.delete` feature อื่นเพิ่มของตน | ไม่มี action ที่ไม่มี route ใช้ |
| Data: `0023` รวม `member_last_project` | เลื่อนไป migration ของ `F-010` | F-001 ไม่มี Project ล่าสุดให้จำ |
| Data: grants ของ `project_members` | F-001 ให้แค่ `select, insert` | cascade รันในฐานะ owner และ F-001 ไม่มี route แก้สมาชิก |
| Data: audit target | `target` ของ Project ไม่มี `attributes` และต้องเพิ่มฝั่งอ่าน 7 จุดในหัวข้อ Data | `record.ts` ห้ามเก็บชื่อใน `attributes` และ `targetOf` ไม่มี `default` |
| Concurrency: ลำดับ lock ของ `LAST_PROJECT_ADMIN` | ทุก write ที่แตะ Project lock แถว `organization` ก่อนแถว `projects` | `F-002` ที่ lock แถว Project ก่อนแล้วเพิ่มสมาชิก (FK ถือ `KEY SHARE` บน `member`) อาจ deadlock กับ `TS-001-T11` ที่ lock `organization` แล้ว `member` |
| API: `GET /{projectId}` | เลื่อนไป `F-010` หรือ `F-012` ที่มีหน้าใช้จริง | F-001 แก้ไขจากข้อมูลในรายการ |

## การตัดสินใจที่ยืนยันแล้ว

ผู้ใช้ยืนยันเมื่อ 2026-10-11:

| ID | การตัดสินใจ |
| --- | --- |
| `OD-01` | ปุ่ม `แก้ไข` และ `ลบ` อยู่ในคอลัมน์การทำงานของแต่ละแถว เปิดเป็น dialog ไม่เพิ่ม route ใหม่ใน F-001 |
| `OD-02` | slug ใช้ `^[a-z0-9-]{3,40}$` ตาม `AC-03` ยอมรับ `-` ที่หัวหรือท้าย และ `--` ไม่แก้ #90 |
| `OD-03` | ข้อความ UI ใน spec นี้ (empty states, เพดาน 50, ยืนยันการลบ, slug ซ้ำ) เป็นข้อความที่ใช้จริง |
| `OD-04` | spec อยู่ที่ไฟล์นี้และเป็น comment ใน #90 |

## คำถามที่ยังเปิด

ไม่มีข้อใด block การเริ่ม implement:

1. การเพิ่มหรือนำสมาชิกออกเปลี่ยน `updated_at` ของ Project หรือไม่ เป็นการตัดสินใจของ `F-002`
2. ผู้ใช้ถูกลบพร้อมกับการสร้าง Project (cascade `user` ไป `member` ไม่ lock องค์กร) ทำให้ insert `project_members` ล้มด้วย `23503` และตอบ `500` spec นี้ยอมรับผลนี้เพราะผู้ใช้ที่ถูกลบไม่มี session ใช้ต่อ
