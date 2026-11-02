# F-012 Implementation spec: หน้าภาพรวมของ Project

Source: issue #95 (`F-012`, Parent `E-003`) · Shared contract: issue #101 (`TS-002`, Task `TS-002-T05`) และ `docs/specs/F-011-project-monitors.md` หัวข้อ "Dependency contract สำหรับ feature ถัดไป" · Design: artboard "โปรเจกต์ · ภาพรวม" (`project/ProjectOverview.dc.html` ใน canvas `Project Management`) · Status: Draft รอบ 2 (แก้ตาม review อิสระ `R95-F01`, `R95-F02`, `R95-F03`, 2026-10-31)

การอนุมัติ spec ไม่ใช่การอนุญาตให้ publish, deploy หรือ release

Spec นี้คือส่วนของ `TS-002` ที่ `F-012` ต้อง implement (`TS-002-T05`) บนโค้ดที่ merge แล้วถึง `a648413` (#109) กฎที่ `TS-001` (#100), `TS-002` (#101) และ spec ของ `F-011` กำหนดไว้แล้วใช้ตามนั้นโดยไม่คัดลอกซ้ำ Acceptance criteria อ้างจาก #95 ด้วย ID `AC-01` ถึง `AC-07` จุดที่ spec นี้ต่างจาก #95, #101 หรือ artboard อยู่ในหัวข้อ "ข้อแก้ไขที่ต้องนำกลับไปอัปเดต TS-002" และ "คำถามที่ยังเปิด"

## ขอบเขต

ทำใน F-012:

- Route `/organizations/:organizationId/projects/:projectId/overview` พร้อม loader และหน้า `apps/web/src/pages/projects/overview/ProjectOverviewPage.tsx`
- แถบมอนิเตอร์ล่ม ตัวเลขสรุป เหตุการณ์ล่าสุด การ์ดสมาชิก และสถานะว่างครั้งแรก (`AC-01`, `AC-02`, `AC-03`, `AC-05`, `AC-06`)
- Nav leaf `ภาพรวม` เป็น leaf แรกของกลุ่ม `โปรเจกต์` ใน `apps/web/src/components/shell/nav-config.ts` ทำให้ `/workspace` และการสลับ Project จากหน้านอก Project ไปที่ภาพรวม (`AC-07`)
- ลบ `apps/web/src/pages/WorkspacePage.tsx` ตาม `TS-002-T05` และแทน element ของ route `/workspace` ด้วย `apps/web/src/pages/WorkspaceEntryFallback.tsx` ที่ไม่แสดงข้อมูลมอนิเตอร์และไม่ navigate เอง (หัวข้อ "`/workspace` และ `WorkspaceEntryFallback`")
- `docs/ref/shell-structure.md` และ `docs/features.md`

ไม่ทำใน F-012 (เจ้าของงานอยู่ในวงเล็บ):

- การ์ดการเชื่อมต่อ AWS (`AC-04`): ซ่อนทั้งการ์ดจนกว่าจะมี `GET /api/organizations/{organizationId}/projects/{projectId}/aws-connection` (`F-014`, `TS-003-T04`, `TS-003-T06`) `F-014` เพิ่มการ์ดเหนือการ์ดสมาชิกในคอลัมน์ขวาโดยไม่เปลี่ยน layout อื่น
- endpoint ใหม่ทุกตัว: ภาพรวมใช้ endpoint ที่ `F-011` ส่งมอบแล้วเท่านั้น (`TS-002` หัวข้อ API)
- ภาพรวมรวมทุก Project ของ Owner/Admin (`F-016`)
- การเปลี่ยน rate limit, สิทธิ์ใน `apps/api/src/projects/access.ts`, contract ของมอนิเตอร์, `workspaceLoader`, `useCurrentProject` หรือ `lastProjectSave`

## Data และ RLS

ไม่มี migration ไม่มีการเปลี่ยน schema, policy หรือ grants หน้าอ่านผ่าน API ที่มีอยู่แล้วเท่านั้น

## Contract (`packages/api-contract`)

ไม่มี contract ใหม่ และไม่ regenerate OpenAPI client (`bun run codegen:check` ต้องผ่านโดยไม่มี diff) หน้าใช้สามแหล่งข้อมูล:

| ข้อมูล                                           | Endpoint                                                                                                                | Field ที่ใช้                                                                                                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ตัวเลขสรุปและมอนิเตอร์ล่ม (`AC-01`, `AC-02`, `AC-06`) | `GET /api/organizations/{organizationId}/projects/{projectId}/monitors` หน้าแรก (`limit` = `MONITOR_LIST_PAGE_SIZE`, `offset: 0`, ไม่ส่ง `sort`) | `summary { up, down, unknown, paused, total, limit }`, `monitors[].{ id, name, health, healthReason, openIncident { startedAt, reason } }`, `dataAsOf` (`monitorListResponseSchema`, `monitorStateSchema` ใน `packages/api-contract/src/monitor.ts`) |
| เหตุการณ์ล่าสุด (`AC-03`)                          | `GET .../monitors/recent-events?limit=10` (`MONITOR_RECENT_EVENTS_LIMIT`)                                               | `events[].{ kind, monitorId, monitorName, at, reason, durationSeconds, httpStatus, sslLevel, daysRemaining }` (`monitorRecentEventSchema`) response ไม่มี `dataAsOf` และไม่มี field บอกช่วงเวลา             |
| การ์ดสมาชิกและบทบาท (`AC-05`, `AC-06`)              | `GET /api/organizations/{organizationId}/projects/{projectId}`                                                          | `name`, `slug`, `memberCount`, `adminCount`, `myRole` (`projectDetailSchema` ใน `packages/api-contract/src/project.ts`)                                                                                    |

หน้าแรกของรายการด้วย `MONITOR_LIST_PAGE_SIZE` (25, `apps/web/src/lib/api/monitors.ts:50`) ครอบคลุมมอนิเตอร์ทุกตัวของ Project เพราะเพดานคือ 20 (`MONITOR_LIMIT_PER_PROJECT`, `packages/api-contract/src/monitor.ts:10`) แถบมอนิเตอร์ล่มจึงไม่มี pagination gap ภายใต้ contract ปัจจุบัน test "lists every down monitor of a Project at its cap of 20" (หัวข้อ Verification mapping) ยืนยัน `MONITOR_LIST_PAGE_SIZE >= MONITOR_LIMIT_PER_PROJECT` และกันการเปลี่ยน constant หรือ query param ในอนาคต key เดียวกับ `useMonitorTotal` ของ nav (`apps/web/src/components/shell/useNavCounts.ts`) และ `monitorsOverviewLoader` (`apps/web/src/lib/auth/loaders.ts`) จึงแชร์ cache กัน `OVERVIEW_LIST_PARAMS` (`limit: 20`) ใน `apps/web/src/lib/api/monitors.ts` ที่ `WorkspacePage` ใช้วันนี้ถูกลบเมื่อไม่มีผู้เรียก

## สิทธิ์

ไม่มี action ใหม่ใน `apps/api/src/projects/access.ts` หน้าอ่านผ่าน `monitor.read` และ `project.read` ซึ่ง `member/member` ทำได้ (`TS-001`) ฝั่งเว็บใช้ `useMonitorAccess(organizationId, projectId)` (`apps/web/src/pages/monitors/useMonitorAccess.ts`) กฎเดียวกับหน้ารายการ:

- `canWrite` ตัดสินปุ่ม `เพิ่มมอนิเตอร์` ในสถานะว่าง (`AC-06`): Owner/Admin องค์กร หรือ `myRole === "admin"`
- `projectGone` หรือ `isMonitorNotFound(error)` ของ query ใดก็ตาม ⇒ สถานะ Project หาย แบบเดียวกับ `apps/web/src/pages/monitors/OverviewPage.tsx` (ไม่บอกว่า Project มีอยู่)
- `failed` (Project lookup ล้มที่ไม่ใช่ 404) ⇒ สถานะ error พร้อม `retry` ไม่ใช่ read-only (CMP-01)
- ผู้ที่ไม่อยู่ในองค์กรตาม `me/context` ไม่ส่งคำขอ `403 MEMBERSHIP_DENIED` หรือ `PERMISSION_DENIED` แสดง `PageState kind="denied"` โดยไม่มีชื่อ Project หรือตัวเลขใด ๆ
- การ์ดสมาชิกอ่าน `memberCount` และ `adminCount` จาก Project detail เท่านั้น ไม่ขอรายชื่อสมาชิก (`GET .../members`) และไม่นับ Owner/Admin องค์กรที่ไม่ได้เป็นสมาชิก Project เป็น `adminCount` ลิงก์ `จัดการสมาชิก` ไปหน้าสมาชิก Project ซึ่งตรวจสิทธิ์แก้ไขของตัวเองอยู่แล้ว ผู้อ่านไม่ได้สิทธิ์เพิ่ม

## Web

### Route และ loader (WEB-03, WEB-04)

- `apps/web/src/router.tsx`: route `/organizations/:organizationId/projects/:projectId/overview` element `ProjectOverviewPage` loader `projectOverviewLoader`
- `projectOverviewLoader` ใน `apps/web/src/lib/auth/loaders.ts`: ขั้นตอนเดียวกับ `monitorsOverviewLoader` (gate session, `prefetchMeContext`, หยุดเมื่อผู้ใช้ไม่อยู่ในองค์กรของ URL) แล้ว prefetch `monitorQueryKeys.list(organizationId, projectId, { limit: MONITOR_LIST_PAGE_SIZE, offset: 0 })` และ `monitorQueryKeys.recentEvents(organizationId, projectId)` ทั้งคู่ `.catch(() => undefined)` เพราะหน้าแสดงสถานะ error เอง prefetch ลง `resolveQueryClientForIdentity(session.user.id)` เท่านั้น ไม่แตะ client ของ identity อื่น
- Query keys: รายการและเหตุการณ์ตาม `monitorQueryKeys`, Project detail ตาม `projectQueryKeys.detail(organizationId, projectId)` ทุก key อยู่ใต้ `TENANT_QUERY_PREFIX` และมี `organizationId` กับ `projectId` ของ URL (WEB-03) `refetchInterval` ของรายการและเหตุการณ์ = `MONITOR_REFETCH_INTERVAL_MS` (30 วินาที) เท่าหน้ารายการ และไม่ประกาศการ refetch ไม่ใช้ `placeholderData: keepPreviousData` กับ query ใดของหน้านี้ (หัวข้อ "Scope, identity และ late completion")

### Nav และ shell

- `nav-config.ts`: leaf `{ label: "ภาพรวม", path: "/organizations/:organizationId/projects/:projectId/overview" }` เป็น leaf แรกของกลุ่ม `โปรเจกต์` ก่อน `ตรวจสถานะบริการ` ไอคอนใช้ชื่อใน `apps/web/src/components/shell/icons.ts` ที่มีอยู่ ถ้าไม่มีตัวที่สื่อ เพิ่มหนึ่งไอคอน stroke SVG ใน `icons.ts`
- ผลที่ตามมาโดยไม่แก้ `projectSwitchDestination` และ `workspaceLoader`: `/workspace` ที่มี Project ล่าสุด `replace` ไปภาพรวม (`AC-07`, `F-010` `AC-06`) การสลับ Project จากหน้านอก Project ไปภาพรวมของ Project ใหม่ และการสลับจากหน้าภาพรวมไปภาพรวมของ Project ใหม่ (หน้าเดียวกัน) test ใน `nav-config.test.ts` describe "projectSwitchDestination (AC-04)" ที่คาดปลายทาง `monitors` เปลี่ยนเป็น `overview` และ `it.each` ปลายทางใน `loaders.test.tsx` describe "workspaceLoader" เปลี่ยนจาก `/monitors` เป็น `/overview`
- Breadcrumb: crumb ของ Project ใน header เป็นลิงก์ไปภาพรวม (`docs/ref/shell-structure.md` หัวข้อ Header เขียนไว้ว่า "not a link until a Project page exists")
- `docs/ref/shell-structure.md`: อัปเดตตัวอย่าง nav, ประโยค "Project pages that do not exist yet (overview, AWS connections) are not listed" เหลือเฉพาะ AWS, "A Project opens its first real navigation leaf (currently monitors)" เป็น overview และประโยค workspace fallback ในตาราง Layout กับหัวข้อ Workspace entry ให้ตรงกับ `WorkspaceEntryFallback` (ไม่มีข้อมูลมอนิเตอร์ retry ผ่าน loader)
- `docs/features.md`: เพิ่มแถว "ภาพรวมของ Project" ชี้ `apps/web/src/pages/projects/overview/` และ `apps/web/src/pages/WorkspaceEntryFallback.tsx`

### หน้า `ProjectOverviewPage.tsx` ตาม artboard

ลำดับส่วนจากบนลงล่าง ทุกส่วนอยู่ใน `Page` ของ shell:

1. `PageHeader`: eyebrow `// overview`, scope row (mark ของ Project, ชื่อ, tag `roleTag` จาก `useMonitorAccess`; ซ่อน scope row เมื่อ denied), title `ภาพรวม`, status line `ข้อมูล ณ <dataAsOf HH:mm:ss> (<TIME_ZONE>)` ด้วย `Time`, `formatTimeWithSeconds` และ `TIME_ZONE` จาก `apps/web/src/pages/monitors/format.tsx` เหมือน `WorkspacePage` วันนี้ (`R95-F02`: `summary` เป็น health ที่คำนวณ ณ `dataAsOf` ไม่ใช่ช่วง 24 ชั่วโมง จึงไม่มีข้อความช่วงเวลาใดที่ response ไม่ได้บอก) ไม่มีปุ่ม action ในหัวหน้า (artboard ไม่มี)
2. แถบมอนิเตอร์ล่ม (`AC-01`): แสดงเมื่อ `summary.down > 0` เท่านั้น `role="alert"` ขอบ `danger` พื้น `danger-tint` ไอคอน และข้อความ (COL-06) หัวแถบ `ล่ม <down> มอนิเตอร์` ตามด้วยหนึ่งแถวต่อมอนิเตอร์ที่ `health === "down"` ตามลำดับรายการ: ชื่อ (ลิงก์ไป `.../monitors/:monitorId`), `openIncident.reason` แบบ monospace, `ตั้งแต่ <openIncident.startedAt เป็น HH:mm>` ถ้า `openIncident` เป็น `null` แสดง `healthReason` แทนและไม่แสดงเวลา (CMP-01 ไม่เดาเวลา) ไม่แสดง HTTP status เพราะ list item ไม่มีค่านี้ ลิงก์ `ดูมอนิเตอร์` ไปหน้ารายการของ Project (หน้ารายการไม่รับตัวกรองจาก URL) แถบ mount ครั้งเดียวต่อการเปลี่ยนจาก 0 เป็น > 0 ไม่ re-mount ทุก refetch
3. ตัวเลขสรุป (`AC-02`): `section aria-label="สรุปมอนิเตอร์"` 4 ช่อง `มอนิเตอร์ทั้งหมด`, `ใช้งานได้`, `ล่ม`, `หยุดชั่วคราว` จาก `summary.total`, `up`, `down`, `paused` ตัวเลข monospace tabular ค่า `ล่ม` ใช้สี danger เฉพาะเมื่อ > 0 เมื่อ `summary.unknown > 0` เพิ่มบรรทัด `ยังไม่ทราบสถานะ <unknown> มอนิเตอร์` ใต้ช่องทั้งสี่ (artboard ไม่มีช่อง unknown แต่ CMP-01 ห้ามซ่อนค่าที่ไม่รู้ ผู้ review อิสระรับค่าเริ่มต้นนี้) ก่อน response แรกแสดง `PageState kind="loading"` ไม่แสดง 0 refetch ล้มหลังมีข้อมูลแสดง `Alert tone="warning"` `อัปเดตข้อมูลไม่สำเร็จ กำลังแสดงข้อมูล ณ <dataAsOf>` เหมือน `WorkspacePage` วันนี้
4. เหตุการณ์ล่าสุด (`AC-03`): `section aria-labelledby` หัวข้อ `เหตุการณ์ล่าสุด` บรรทัดใต้หัวข้อ `ล่าสุด <MONITOR_RECENT_EVENTS_LIMIT> รายการ · เวลาตามเขตเวลา <TIME_ZONE>` (`R95-F02`: response ไม่บอกช่วงเวลา จึงไม่อ้าง 24 ชั่วโมงหรือจำนวนวัน) ลิงก์ `มอนิเตอร์ทั้งหมด` ไปหน้ารายการ แถวละ เวลา `HH:mm` (monospace, `TIME_ZONE`), จุดสถานะ `aria-hidden`, ชื่อมอนิเตอร์เป็นลิงก์ไปหน้ารายละเอียด และข้อความตาม `kind`: `incident_opened` → `ล่ม · <reason>` (ต่อ `HTTP <httpStatus>` เมื่อมี), `incident_closed` → `กลับมาใช้งานได้ · ล่ม <durationSeconds เป็นนาทีหรือชั่วโมง>`, `ssl_level` → ข้อความระดับ SSL พร้อม `daysRemaining` ผ่าน `sslText` และ `sslDaysText` ใน `apps/web/src/pages/monitors/SslLabel.tsx` ย้าย `apps/web/src/pages/workspace/EventsSection.tsx` มาที่ `apps/web/src/pages/projects/overview/` ปรับเฉพาะจุดที่ artboard ต่าง และตัด `EventsMockups` ของ #63 ออก (ไม่ใช่ requirement ของ F-012 และ CMP-06 ไม่บังคับให้คง mockup) ไม่มีเหตุการณ์ → ข้อความ `ไม่มีเหตุการณ์ล่มหรือ SSL เตือนในช่วงที่เก็บข้อมูล` ภายใน section query ล้ม → ข้อความ error พร้อมปุ่ม `ลองใหม่` ภายใน section ส่วนอื่นของหน้ายังแสดง
5. คอลัมน์ขวา การ์ดสมาชิก (`AC-05`): หัวข้อ `สมาชิกโปรเจกต์` ข้อความ `<memberCount> คน · ผู้ดูแล <adminCount> คน` (ตัวเลข monospace) ลิงก์ `จัดการสมาชิก` ไป `/organizations/:organizationId/projects/:projectId/members` ไม่แสดง avatar stack ของ artboard เพราะต้องขอรายชื่อสมาชิกเพิ่มและ `AC-05` ต้องการเพียงจำนวน ค่าที่ยังไม่รู้ (detail ยังโหลดหรือล้ม) แสดง skeleton หรือ `ไม่ทราบ` ไม่แสดง 0 การ์ด AWS ของ artboard ไม่มีใน F-012 (`AC-04`) คอลัมน์ขวาจึงมีการ์ดเดียว
6. สถานะว่างครั้งแรก (`AC-06`): เมื่อ `summary.total === 0` แทนที่ส่วน 2 ถึง 4 ด้วย `EmptyState variant="first-run"` ไอคอน `ActivityIcon` หัวข้อ `ยังไม่มีมอนิเตอร์ในโปรเจกต์นี้` และปุ่ม `เพิ่มมอนิเตอร์` ไป `.../monitors/new` เฉพาะ `canWrite` ผู้ที่เขียนไม่ได้เห็น `สิทธิ์ของคุณ: ดูอย่างเดียว` การ์ดสมาชิกยังแสดง

Layout: คอลัมน์ซ้าย (แถบ, สรุป, เหตุการณ์) และคอลัมน์ขวา (การ์ด) ใน grid `lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]` เหมือน `WorkspacePage` วันนี้ ใต้ `lg` คอลัมน์ขวาต่อท้ายคอลัมน์ซ้าย ทุกลิงก์เป็น `Link` ของ react-router ไม่มีปุ่มที่เป็น `div`

### สถานะของหน้า (CMP-01)

| สถานะ                              | เงื่อนไข                                                                                                   | แสดง                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| loading                            | รายการยังไม่มีข้อมูล, `mePending`, `access.pending`, `switchedOrganization` หรือ context refresh หลัง 403 กำลังทำ | `PageHeader` และ `PageState kind="loading"` ไม่มีตัวเลข                                                                   |
| error                              | รายการล้มโดยไม่มีข้อมูลเก่า หรือ Project lookup ล้ม (`failed`)                                               | `PageState kind="error"` พร้อมปุ่มลองใหม่                                                                                 |
| stale                              | refetch ล้มหลังมีข้อมูล                                                                                     | ข้อมูลเดิมพร้อม `Alert tone="warning"` บอกเวลา `dataAsOf`                                                                 |
| Project หายหรือเข้าไม่ได้           | `PROJECT_NOT_FOUND` หรือ `MONITOR_NOT_FOUND` จาก query ใด                                                    | `PageState kind="denied" tone="info"` ข้อความ Project หาย พร้อมลิงก์ `ไปที่รายการโปรเจกต์` เหมือน `OverviewPage.tsx` และ invalidate `projectQueryKeys.all(organizationId)` |
| ไม่ใช่สมาชิกองค์กรหรือไม่มีสิทธิ์     | ไม่อยู่ในองค์กรตาม `me/context` หรือ `403` หลัง refresh context                                              | `PageState kind="denied"` `คุณไม่มีสิทธิ์ดูภาพรวมของโปรเจกต์นี้` ไม่มี scope row ชื่อ หรือตัวเลข                            |
| ยังไม่มีมอนิเตอร์                   | `summary.total === 0`                                                                                      | `EmptyState variant="first-run"` ตามข้อ 6                                                                                 |
| ปกติ                                | มีข้อมูล                                                                                                   | ข้อ 1 ถึง 5 แถบล่มเฉพาะเมื่อ `summary.down > 0`                                                                           |

### Scope, identity และ late completion (`R95-F03`, WEB-03, WEB-04)

หน้าภาพรวมเป็น protected route ใหม่ที่มี loader และเปลี่ยนปลายทางของ `/workspace` จึงต้องผูกการแสดงผลทุกอย่างกับ identity ที่ยืนยันแล้วและ organization+Project ของ URL ตามแบบ `apps/web/src/pages/monitors/OverviewPage.tsx` โดยไม่สร้าง resolver หรือ boundary ใหม่:

- Scope คือ `organizationId` และ `projectId` ของ URL เท่านั้น ไม่ใช้ `useCurrentProject` หรือ organization ที่ active แทน bookmark ของอีก organization ถ้าผู้ใช้ไม่อยู่ใน organization ของ URL ตาม `me/context` หน้าแสดง denied โดยไม่ส่งคำขอใด (loader ก็ไม่ prefetch) ถ้าอยู่ ทุก query ใช้ organization ของ URL แม้อีก organization จะ active
- การ์ดสมาชิก ตัวเลขสรุป แถบล่ม และเหตุการณ์ อ่านจาก query key ของ URL ปัจจุบันเท่านั้น ไม่มี `placeholderData` และไม่มี state ภายในที่เก็บ rows หรือ counts การสลับ Project หรือ organization จึงแสดง loading ของ key ใหม่ทันที rows และ counts ของ Project เดิมไม่ปรากฏใต้หัวหน้าของ Project ใหม่ state ภายในที่เหลือ (แถบล่ม mount ครั้งแรก, context refresh หลัง 403) อยู่ใน component ที่ `key={`${organizationId}:${projectId}`}` จึงถูก unmount เมื่อ scope เปลี่ยน
- Late completion: response ของ (org A, Project A) ที่มาถึงหลัง URL เปลี่ยนเป็น (org B, Project B) ถูกเขียนลง key ของ A เท่านั้นและไม่ถูก render เพราะหน้าอ่าน key ของ B ส่วน organization switch ใช้ `useLeaveOnOrganizationSwitch(organizationId)` (`apps/web/src/lib/tenant/useLeaveOnOrganizationSwitch.ts`) ปิด query และแสดง loading เหมือนหน้ารายการ และ query ใต้ `TENANT_QUERY_PREFIX` ถูก cancel และ remove โดย `TenantProvider` เมื่อ organization เปลี่ยน
- Identity: query cache แยกต่อ identity (`resolveQueryClientForIdentity`) loader prefetch ลง client ของ session ที่ยืนยัน หาก identity เปลี่ยน (sign-out/sign-in ในหน้า) `RootLayout` revalidate loader และ `SessionQueryProvider` สลับ client response ค้างของ identity เดิมตกอยู่ใน client ที่ retire และไม่ถูก publish หน้าไม่ต้องเขียนโค้ดเพิ่มสำหรับกรณีนี้ แต่ต้องมี test
- ไม่มี mutation และไม่มีการ save Project ล่าสุดจากหน้านี้ การ save เป็นของ shell (landing บน Project route) ตามเดิม

### `/workspace` และ `WorkspaceEntryFallback` (`AC-07`, `TS-002-T05`, `R95-F01`)

`workspaceLoader` (`apps/web/src/lib/auth/loaders.ts:147-208`) ไม่เปลี่ยนและเป็นผู้ตัดสิน redirect เพียงผู้เดียว ปลายทางกลายเป็นภาพรวมเพราะ leaf แรกของกลุ่ม Project เปลี่ยน loader คืน `null` ใน 4 กรณี (identity ไม่ตรงหรือ retire หรือ navigation ถูก abort, ไม่มีองค์กรที่ active, โหลด `me/context` ล้ม, โหลด Project ล่าสุดล้ม) ตาม dependency contract ของ `F-011` และกฎ "Failed requests, aborted navigation and identity changes do not redirect" ใน `docs/ref/shell-structure.md` กรณีเหล่านี้ต้องมีหน้าแสดง

ทางเลือกที่ draft รอบ 1 เสนอ (คง `WorkspacePage` แล้ว navigate ฝั่ง client เมื่อ `useCurrentProject().validation === "readable"`) ใช้ไม่ได้: บน `/workspace` ไม่มี Project route `getProjectRoute` คืน `null` และ `useCurrentProject` คืน `validation: "rejected"` เสมอ (`apps/web/src/components/shell/useCurrentProject.ts:112-117`) หน้าจึงค้าง loading และถ้าตัดเงื่อนไขออกแล้ว navigate จาก hint ที่ cache ไว้จะข้าม `workspaceLoader` ซึ่งตั้งใจคืน `null` เมื่อคำขอล้ม abort หรือ identity retire

F-012 ลบ `WorkspacePage.tsx`, `WorkspacePage.test.tsx` และ `apps/web/src/pages/workspace/` ทั้งโฟลเดอร์ (`StatStrip`, `IssuesSection`, `UptimeSection`, `rows.ts`; `EventsSection` ย้ายไป overview) แล้วให้ route `/workspace` ใช้ `WorkspaceEntryFallback` ใน `apps/web/src/pages/WorkspaceEntryFallback.tsx`:

- อ่านเฉพาะ `useTenant()` (`mePending`, `me`, `meError`, `retryMe`, `activeOrg`) และ `useRevalidator()` ของ react-router ไม่เรียก `useCurrentProject`, `fetchLastProject`, `fetchProjectList` หรือ query มอนิเตอร์ใด ไม่เรียก `navigate` ในทุกกรณี และไม่อ่าน hint Project จาก cache จึงไม่มีทาง redirect หลัง resolver ล้มหรือ identity retire นอกจากผ่าน loader
- สถานะ (ลำดับการตรวจ): (1) `mePending` หรือ `revalidator.state === "loading"` → `PageState kind="loading"` `กำลังเปิดพื้นที่ทำงาน…` testid `workspace-context-loading` (2) `me === undefined` → `PageState kind="error"` ข้อความจาก `meError` ปุ่ม `ลองใหม่` testid `workspace-context-error` / `workspace-context-retry` เรียก `retryMe()` (TenantProvider เป็นเจ้าของการกู้ context รวมกรณี self-leave `refresh-failed`) แล้วเมื่อ settle เรียก `revalidator.revalidate()` ให้ loader ตัดสินปลายทาง (3) `activeOrg === null` → `AccessNeeded` เดิม (ย้ายจาก `WorkspacePage.tsx` ทั้ง `useFocusHeadingAfterSelfLeave`, testid `workspace-access-needed`, `workspace-sign-out`) (4) มีองค์กรแต่ loader คืน `null` (Project ล่าสุดล้ม หรือรอ revalidation หลัง identity เปลี่ยน) → `PageHeader` scope เป็นองค์กร (ชื่อ role slug ผ่าน `workspace-identity` เดิม) ไม่มีชื่อ Project หรือตัวเลขใด และ `PageState kind="error"` `เปิดพื้นที่ทำงานไม่สำเร็จ` ปุ่ม `ลองใหม่` testid `workspace-entry-error` / `workspace-entry-retry` เรียก `revalidator.revalidate()` ซึ่งรัน `workspaceLoader` ใหม่ (รอ pending landing save, cancel read เก่า, `GET /api/me/last-project` สดแล้ว `replace`)
- สถานะ `workspace-no-project` ของวันนี้ไม่มีผู้เรียกอีกต่อไป เพราะ `last.projectId === null` ทำให้ loader `replace` ไปหน้าโปรเจกต์ทั้งหมดก่อนถึง component
- `isDenied` ใน `rows.ts` มีผู้เรียก 6 ไฟล์นอก `pages/workspace/` ย้ายไป `apps/web/src/pages/monitors/useMonitorAccess.ts` ข้าง `isMonitorNotFound` และแก้ import ใน `OverviewPage.tsx`, `DetailPage.tsx`, `ChecksHistoryPage.tsx`, `detail/ResponseTimeCard.tsx`, `projects/ProjectsPage.tsx`, `projects/members/ProjectMembersPage.tsx` และ `EventsSection.tsx`
- `AppShell.test.tsx` (17 จุด) และ `SelfLeaveAction.test.tsx` (1 จุด) ที่ render `WorkspacePage` เป็นเนื้อหาของ `/workspace` เปลี่ยนเป็น `WorkspaceEntryFallback` case ที่ assert ข้อมูลมอนิเตอร์หรือ `workspace-denied` ของหน้าเดิมย้าย assertion ไป `ProjectOverviewPage.test.tsx` หรือเปลี่ยนเป็น testid ของ fallback นับจำนวน case ที่เปลี่ยนตอนทำ `F-012-T02` และบันทึกใน PR
- `/workspace` ยังไม่อยู่ใน sidebar และ command palette `AppShell.tsx` ยังใส่ `bg-canvas-deep grid-line` ให้ route นี้ (LAY-08, LAY-09 ตาม shell-structure)

ทางเลือกที่ไม่เลือก: ให้ `workspaceLoader` redirect ไปหน้าโปรเจกต์ทั้งหมดในทุกกรณี `null` ขัดกฎข้างต้นเพราะกรณี `me/context` ล้มจะกลายเป็น redirect จากคำขอที่ล้ม

## Concurrency และข้อมูลเก่า

- ไม่มี mutation ในหน้านี้ ปุ่มทุกปุ่มเป็นลิงก์
- Project ถูกลบหรือถูกนำออกระหว่างเปิดหน้า: query ถัดไปตอบ `404` ⇒ สถานะ Project หาย และ invalidate รายการ Project เพื่อให้ตัวสลับ Project เลือกใหม่ (เหมือน `WorkspacePage` วันนี้)
- ถูกลด role ระหว่างเปิดหน้า: หน้าอ่านได้ต่อ (member ยังอ่านได้) ปุ่ม `เพิ่มมอนิเตอร์` หายเมื่อ `useMonitorAccess.refresh()` อ่าน `myRole` ใหม่
- ตัวเลขทุกค่ามาจาก response เดียวกัน (`summary` และ `monitors` ของ response เดียว) จึงไม่ผสมข้อมูลคนละเวลา เหตุการณ์ล่าสุดเป็นอีก query และมีเวลาของตัวเอง
- Scope และ identity transitions ตามหัวข้อ "Scope, identity และ late completion"

## Tasks

| Task         | งาน                                                       | ไฟล์หลัก                                                                                                                                                                                      | ขึ้นกับ                              | หลักฐาน                                                                                                                      |
| ------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `F-012-T01` | หน้าภาพรวม route loader nav breadcrumb และ docs           | `apps/web/src/pages/projects/overview/`, `apps/web/src/router.tsx`, `apps/web/src/lib/auth/loaders.ts`, `apps/web/src/components/shell/nav-config.ts`, `docs/ref/shell-structure.md`, `docs/features.md` | ไม่มี (`F-011` #107 และ #108 merge แล้ว) | `bun run --cwd apps/web test`: web test ต่อ `AC-01` ถึง `AC-03`, `AC-05`, `AC-06`, scope/identity tests, `nav-config.test.ts`, `loaders.test.tsx`; `bun run codegen:check` ไม่มี diff |
| `F-012-T02` | `/workspace` เป็น `WorkspaceEntryFallback` และลบ `WorkspacePage` กับ `pages/workspace/` | `apps/web/src/pages/WorkspaceEntryFallback.tsx` (+ test), `apps/web/src/pages/WorkspacePage.tsx` (ลบ), `apps/web/src/pages/workspace/` (ลบ), `apps/web/src/pages/monitors/useMonitorAccess.ts`, `apps/web/src/lib/api/monitors.ts`, `apps/web/src/components/shell/AppShell.test.tsx`, `apps/web/src/pages/organization-members/SelfLeaveAction.test.tsx` | T01                                  | web test: 4 กรณี `null` แสดง fallback ที่ไม่มีข้อมูลมอนิเตอร์, retry รัน loader, `loaders.test.tsx` "workspaceLoader" เดิมทุก case ผ่านด้วยปลายทาง `overview` (`AC-07`) |
| `F-012-T03` | E2E ภาพรวมและปลายทาง `/workspace`                          | `e2e/tests/project-overview.spec.ts` ใหม่; แก้ `e2e/tests/monitors-list-sort-view.spec.ts` (`openWorkspaceCertificate` คาด `/workspace` → monitors), `e2e/tests/project-switcher.spec.ts` ("workspace and root open the remembered Project" คาด `/monitors`), `e2e/tests/login-active-organization.spec.ts` (`workspace-identity` หลัง admission retry) อีก 9 ไฟล์ที่อ้าง `workspace` ใช้ regex ที่รับทั้ง `/workspace` และ `/organizations/.../projects/...` จึงไม่ต้องแก้ เว้นแต่รันแล้วล้ม | T01, T02                             | `bun run --cwd e2e test`                                                                                                     |

ทั้งสาม Task เป็นงานของผู้เขียนคนเดียวบน branch เดียว ไม่มี migration และไม่มี API จึงไม่ต้องรัน `test:integration` ของ `apps/api` หรือ `packages/db` นอกจาก gate ปกติของ PR required local gates ทุกตัวต้องรันบน candidate head ผลที่รันไม่ได้รายงาน not run พร้อม blocker ผลที่ล้มรายงาน observed fail ไม่ใช้ baseline ที่แดงอยู่ (9 notification tests และ dependency audit 7 รายการบน `a648413`) เป็น waiver และไม่เรียก merge-ready ขณะ required gate ยังแดง

## Verification mapping

| AC      | Test (ชื่อที่ต้องมีในโค้ด)                                                                                                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-01` | `ProjectOverviewPage.test.tsx` "shows the down banner with reason and start time and hides it at zero (AC-01)"; "a down monitor without an open incident shows its health reason and no time"; "lists every down monitor of a Project at its cap of 20" (20 มอนิเตอร์ `down` ทั้งหมด → 20 แถวในแถบ และ `fetchMonitorList` ถูกเรียกด้วย `{ limit: MONITOR_LIST_PAGE_SIZE, offset: 0 }` โดย `MONITOR_LIST_PAGE_SIZE >= MONITOR_LIMIT_PER_PROJECT`); e2e `project-overview.spec.ts` "a target that goes down shows in the banner" |
| `AC-02` | `ProjectOverviewPage.test.tsx` "renders the four summary numbers from the server and never zero before data (AC-02)"; "shows the unknown count when the server reports it"; "keeps the last numbers with a stale warning when a refetch fails"; "labels the data by dataAsOf and never by a window the response does not carry" |
| `AC-03` | `ProjectOverviewPage.test.tsx` "lists recent events with time, monitor and result (AC-03)"; "shows an in-section empty and error state for events"                                                                                                              |
| `AC-04` | ไม่มี test ใน F-012 (การ์ดไม่ถูกสร้าง) `ProjectOverviewPage.test.tsx` "renders no AWS card" กันการเพิ่มโดยไม่ตั้งใจ                                                                                                                                                 |
| `AC-05` | `ProjectOverviewPage.test.tsx` "shows member and admin counts with a link to members (AC-05)"; "shows unknown, not zero, while the Project detail is unavailable"; "requests no member list for the counts"                                                       |
| `AC-06` | `ProjectOverviewPage.test.tsx` "shows the first-run empty state with an add link for writers and read-only text for members (AC-06)"                                                                                                                             |
| `AC-07` | `nav-config.test.ts` describe "projectSwitchDestination (AC-04)" ปลายทาง `overview`; `loaders.test.tsx` describe "workspaceLoader" ทุก case เดิม (latest/first/none, pending landing save, abort while save pending, retire/identity, failed save, newer landing cancels read, last-project fails, abort/retire/identity while pending, no prefetch without confirmed selection, no list without membership) ผ่านด้วยปลายทาง `overview`; `WorkspaceEntryFallback.test.tsx` "shows the four loader-null states without monitor data and never navigates by itself (AC-07)", "retry re-runs the workspace loader and lands on the overview"; `AppShell.test.tsx` case ของ `/workspace`; e2e `login-active-organization.spec.ts`, `project-switcher.spec.ts` |

Test ที่ไม่ผูกกับ AC แต่บังคับตาม `docs/architecture.md` และ `docs/design-system.md`:

- Project หายหลังโหลด (CMP-01) ใน `ProjectOverviewPage.test.tsx` "A Project that is gone after the page loaded"; Project lookup ล้มไม่แสดงเป็นไม่มีสิทธิ์ "A failed Project lookup"; denied ไม่เปิดเผยชื่อ Project "a non-member sees no Project name or numbers"
- Scope และ identity (WEB-03, WEB-04, `R95-F03`) ใน `ProjectOverviewPage.test.tsx`: "drops rows and counts on a Project switch and never renders the old Project's late response" (A → B โดย response ของ A resolve หลัง B), "ignores a late response after an Organization switch", "a bookmark of another Organization the user belongs to reads that Organization, not the active one", "a bookmark of an Organization the user is not in sends no request"; `identityLifecycle.test.tsx` เพิ่ม `projectOverviewLoader` ใน case "isolates account caches and loader prefetches by identity"; `loaders.test.tsx` describe "projectOverviewLoader" 3 case ตามแบบ `monitorsOverviewLoader` (stages list and recent events for a member, requests nothing for an Organization the user does not belong to, sends an anonymous visitor to sign in)
- Browser evidence ตาม design system: screenshot หน้าภาพรวม 2 themes (ปกติ, แถบล่ม, ว่างครั้งแรก), keyboard ผ่านทุกลิงก์, `prefers-reduced-motion` ไม่มี transition ของแถบล่ม บันทึกใน PR

## ข้อแก้ไขที่ต้องนำกลับไปอัปเดต TS-002

| จุดใน #101                                              | ข้อแก้ไข                                                                                    | เหตุผล                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Web: ลบ `WorkspacePage` และ `/workspace` redirect ตาม `F-010` `AC-06` | ตามเดิม ลบ `WorkspacePage` แต่ route `/workspace` ยังมี element `WorkspaceEntryFallback` ที่ไม่มีข้อมูลมอนิเตอร์และไม่ navigate เอง | 4 กรณี `null` ของ `workspaceLoader` ต้องมีหน้าแสดง และคำขอที่ล้มห้าม redirect (shell-structure)   |
| Web: `overview` ใช้ list และ recent-events ของ Project    | ใช้หน้าแรกของ list ด้วย `MONITOR_LIST_PAGE_SIZE` ไม่ใช่ `OVERVIEW_LIST_PARAMS` และลบค่าหลัง | แชร์ cache กับ nav และ loader ตาม dependency contract ของ `F-011`                                   |
| Web: การ์ด AWS แสดงเมื่อ `TS-003-T04` เสร็จ ก่อนนั้นซ่อน | ตามเดิม การ์ดเป็นงานของ `F-014` ทั้ง component และ test                                       | F-012 ไม่สร้าง component ที่ไม่มีข้อมูล                                                               |

## ประวัติการ review

| Finding    | ระดับ | การแก้ในรอบ 2                                                                                                                                                                                                                       |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `R95-F01`  | P1    | ตัด client-side navigate และ `useCurrentProject` ออกจาก `/workspace` ลบ `WorkspacePage` เพิ่ม `WorkspaceEntryFallback` ที่ retry ผ่าน `useRevalidator` และให้ `workspaceLoader` เป็น authority ของ redirect เท่านั้น (หัวข้อ "`/workspace` และ `WorkspaceEntryFallback`") |
| `R95-F02`  | P2    | ตัดข้อความ `ข้อมูล 24 ชม. ล่าสุด` ใช้ `ข้อมูล ณ <dataAsOf>` ในหัวหน้า และ `ล่าสุด <N> รายการ` ในส่วนเหตุการณ์ ไม่อ้างช่วงเวลาที่ response ไม่ได้บอก (ข้อ 1 และ 4 ของหน้า) |
| `R95-F03`  | P2    | เพิ่มหัวข้อ "Scope, identity และ late completion" และ test ต่อ identity retirement, Project/Organization switch พร้อม late response, cross-organization bookmark และ `workspaceLoader` regressions เดิม (Verification mapping)         |

Defaults ที่ผู้ review รับ: หน้าแรก `limit 25 >= cap 20` พร้อม regression test 20 มอนิเตอร์ `down` ทั้งหมด, บรรทัด `summary.unknown` ใต้ 4 ช่อง, `adminCount` จาก Project detail, ซ่อนการ์ด AWS ตาม `AC-04`

## คำถามที่ยังเปิด

ไม่มีข้อใด block การเริ่ม implement ค่าเริ่มต้นใน spec ใช้ได้จนกว่าผู้ review จะแย้ง:

1. แถบมอนิเตอร์ล่มใช้ `role="alert"` ตาม artboard (ค่าเริ่มต้น, mount ครั้งเดียว) หรือ `role="status"` เพราะหน้า refetch ทุก 30 วินาที
2. ชื่อไอคอนของ leaf `ภาพรวม` ใน `icons.ts` (ตัดสินตอน implement จากไอคอนที่มี)
