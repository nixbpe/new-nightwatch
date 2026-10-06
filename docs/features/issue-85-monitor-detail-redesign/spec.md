# Issue #85 Monitor Detail Redesign Technical Spec

Owner: Technical Lead. Canonical Technical Spec ของ issue #85 สำหรับ `F-005-S10`; requirements และ AC-75 ถึง AC-90 อยู่ใน [Issue #85 Feature](feature.md#acceptance-matrix-85-delta), #57 delta อยู่ใน [#57 Spec](../issue-57-monitor-response-stats/spec.md), baseline อยู่ใน [F-005 Spec](../F-005-uptime-monitor/spec.md) ไม่สร้าง Feature ID ใหม่

## Issue #85 delta

ลดความหนาแน่นของ Detail, ย้ายประวัติการตรวจไปหน้าใหม่ที่โหลดเพิ่มทีละก้อน, เพิ่มตัวสลับกราฟ/ตาราง และผูก glow กับความสดของข้อมูล ตาม [F-005-S10 และ delta Acceptance matrix](feature.md#issue-85-delta) โดยเปลี่ยนเฉพาะ Web ไม่เปลี่ยน API, schema หรือ DB

| Field | Value |
| --- | --- |
| Feature | F-005, Story `F-005-S10`, `acceptanceVersion` F-005-AC-3 ([Feature](feature.md#acceptance-matrix-85-delta), frozen, AC-75 ถึง AC-90) |
| Status | Approved |
| Approved by user | 2026-10-06, ผู้ใช้อนุมัติ Spec ทั้งฉบับรวมข้อความ UI ที่เสนอ 3 ข้อ; freeze F-005-AC-3 (AC-75 ถึง AC-90) |
| Start authorization | 2026-10-07, `/implement-issue` (ยืนยัน spec issue #85, `docs/features/issue-85-monitor-detail-redesign/spec.md`) |
| `COMMIT_MODE` | owned-slice |
| `STOP_AT` | merge-ready |
| Delivery | Not implemented |

ผู้ใช้อนุมัติ scope ของ Feature และยืนยัน PD-85-01/PD-85-04 เมื่อ 2026-10-06 และ freeze AC-75 ถึง AC-87 แล้ว วันเดียวกันผู้ใช้เลือกทางเลือก (a) ของ OD-85-01, OD-85-03, OD-85-04 และ OD-85-05 Product Owner แก้ AC-75, AC-83, UI flow table และ Feature Revisions ตามผลนั้น และแก้ Motion principle ใน `docs/design-system.md` ให้ระบุ COL-08 เป็นข้อยกเว้น `acceptanceVersion` คง `F-005-AC-3` Technical design TD-85-01 ถึง TD-85-09, contracts, Tasks และข้อความ UI ที่เสนอ 3 ข้อได้รับอนุมัติจากผู้ใช้ 2026-10-06 Acceptance matrix `F-005-AC-3` เฉพาะ AC-75 ถึง AC-90 เป็น `frozen`: technical rows AC-88 ถึง AC-90 ย้ายจาก Spec เข้า [Feature matrix](feature.md#acceptance-matrix-85-delta) โดยไม่เปลี่ยน criteria การอนุมัติ Spec ไม่อนุญาต implementation start หรือ release ด้วยตัวเอง ผู้ใช้ตัดสิน OD-85-02 แล้ว 2026-10-06 (บันทึกใน [Revisions](#revisions-85)) `/implement-issue` ที่ยืนยัน spec นี้โดยตรงเมื่อ 2026-10-07 authorizes scope-now Tasks ตามกติกาของตัวเอง overriding `Start authorization: None` และ `COMMIT_MODE: none` เดิม

อ่าน [Contracts](#contracts-85), [Design decisions](#design-decisions-85), [Technical acceptance rows](#technical-acceptance-rows-85), [Tasks](#tasks-85), [verification](#integrated-verification-85) และ [Open decisions](#open-decisions-85) สำหรับ delta นี้เท่านั้น

Source inspection ที่ `main` @ `49cdcbb` (อ่านจาก `.git/refs/heads/main`; Technical Lead ไม่มี shell ใน run นี้ ต่อมา `docs/design-system.md` ฉบับแก้ (COL-08, LAY-04 และข้อยกเว้น COL-08 ใน Motion principle) ถูก commit เป็น `a418091` บน `main` ตามที่ team-lead แจ้ง 2026-10-06 Technical Lead ยืนยันเพียงว่า `.git/refs/heads/main` ชี้ `a418091` ไม่ได้อ่านเนื้อหา commit): `DetailPage`, การ์ดใน `apps/web/src/pages/monitors/detail/`, `ResponseTimeChart` (`response-time-chart.tsx`), `DataTable`/`DataTablePagination`, `routes` ใน `router.tsx`, `monitorDetailLoader`, `getBreadcrumbTrail`, `useLeaveOnOrganizationSwitch`, `monitorQueryKeys`/`fetchMonitorChecks` ใน `apps/web/src/lib/api/monitors.ts`, `live-pulse` ใน `index.css` และ `WorkspacePage.tsx`, `pageSchema`/`monitorHistoryQuerySchema`/`monitorChecksResponseSchema` ใน `packages/api-contract/src/monitor.ts`, `listChecks` ใน `apps/api/src/monitors/read-service.ts` และ `read-detail.db.test.ts` อ่าน COL-07, COL-08, LAY-02, LAY-04, MOT-01, Motion principle, CMP-01 และ CMP-05 จาก `docs/design-system.md` ใน working tree การตรวจ source นี้ไม่ใช่ runtime proof `ux-designer` ตอบคำถาม 4 ข้อเรื่อง focus/ประกาศ/load-more failure/สีจุดข้อมูลเก่า จากการอ่าน code และเอกสาร ยังไม่ได้ทดสอบกับ screen reader

ข้อเท็จจริงที่ต้องคงไว้:

- หลังผู้ใช้อนุมัติ Spec 2026-10-06 field "Technical Spec" (บรรทัด 11) และหัวข้อ "Identity, authority and evidence" (บรรทัด 42 ถึง 43) ของ `feature.md` ยังเขียนสถานะก่อนอนุมัติ (Spec รออนุมัติ, frozen เฉพาะ AC-75 ถึง AC-87) เป็น record inconsistency ที่ Product Owner แก้ Technical Lead แก้ `feature.md` เฉพาะการย้าย AC-88 ถึง AC-90 เข้า matrix, field "Acceptance status" และ Revisions ตามที่ team-lead อนุญาต
- AC-84 (PD-85-01, ผู้ใช้ยืนยันแล้ว) แทนวลี "ผลตรวจล่าสุดใน Detail" ของ baseline AC-17 และ "การตรวจล่าสุด" ของ `F-005-S03` ส่วนวลี "ประวัติการตรวจ" ของ AC-17 (assertion ผ่าน/ไม่ผ่าน, ค่าตัดที่ 200 ตัวอักษร) ย้ายไปหน้าประวัติการตรวจใหม่และยังต้องผ่าน
- `LastResultCard` เป็นที่เดียวที่แสดงป้าย "ประเมินจากส่วนต้นของ response" (baseline AC-33) ของผลตรวจที่บันทึกไว้ AC-84 ทำให้ป้ายนี้เหลือเฉพาะผลทดสอบใน `TestPanel.tsx` ตารางประวัติไม่เคยแสดงป้ายนี้ที่ HEAD Spec ไม่เพิ่ม UI ใหม่ให้ บันทึกเป็น follow-up ให้ Product Owner
- Detail และหน้าประวัติการตรวจใช้ `--background` ปกติ ไม่ใช้ `canvas-deep`/`grid-line` หรือ grain เพราะใน `AppShell.tsx` `WORKSPACE_ROUTE` จับเฉพาะ `/workspace` และ `DATA_DENSE_ROUTE` จับเฉพาะรายการมอนิเตอร์และ `/notifications` (Feature, Identity)
- แกนตั้งของกราฟมีอยู่แล้วที่ HEAD: `y.ticks(4)` วาด gridline พร้อมตัวเลข และมีป้าย `ms` (`response-time-chart.tsx` บรรทัด 250 ถึง 277) SVG เป็น `aria-hidden` หน่วยอยู่ใน `aria-label` ของ group

### Contracts (#85)

#### API and data (#85)

ไม่เปลี่ยน API operation, Zod schema, OpenAPI, table, RLS policy, grant, migration หรือ job ใช้ของเดิมดังนี้:

| Operation | Contract ที่ใช้ |
| --- | --- |
| `GET /api/organizations/{organizationId}/monitors/{monitorId}/checks?limit&offset` | `monitorHistoryQuerySchema`: `limit` 1 ถึง 50 (default 20), `offset` >= 0; `monitorChecksResponseSchema`: `checks` ไม่เกิน 50, `page.{limit,offset,total}`, `urlChanges`; `listChecks` เรียง `scheduled_for desc`, อ่าน rows และ `total` เป็นสอง statement, `urlChanges` จำกัดตามขอบ page |
| `GET .../{monitorId}`, `.../incidents`, `.../events`, `.../response-times` | ไม่เปลี่ยน |
| Errors | `401 UNAUTHENTICATED`, `403 MEMBERSHIP_DENIED`, `404 MONITOR_NOT_FOUND` (missing/malformed/foreign), `400 INVALID_INPUT` เดิม |

`bun run codegen:check` ต้องไม่มี drift

#### Web routes and data (#85)

| Route | Loader | Element |
| --- | --- | --- |
| `/organizations/:organizationId/monitors/:monitorId` | `monitorDetailLoader` เดิม | `DetailPage` |
| `/organizations/:organizationId/monitors/:monitorId/checks` (ใหม่, TD-85-01) | `monitorDetailLoader` เดิม | `ChecksHistoryPage` ใหม่ |

- Breadcrumb และ nav active: `isLeafActive` จับ prefix `/organizations/:organizationId/monitors` จึงแสดง "ตรวจสถานะบริการ" เหมือน Detail ไม่แก้ `breadcrumb.ts`/`nav-config.ts`
- Organization switch: regex ใน `OrgSwitcher.tsx` ไม่จับ route นี้ หน้าใหม่ใช้ `useLeaveOnOrganizationSwitch` เหมือน Detail (AC-49)
- Query key ใหม่ `monitorQueryKeys.checksHistory(organizationId, monitorId)` = `[...TENANT_QUERY_PREFIX, "monitors", organizationId, "checks-history", monitorId]` สำหรับ `useInfiniteQuery` อยู่ใต้ `all(organizationId)` เพื่อให้ invalidation และการล้างเมื่อสลับ Organization ทำงาน (WEB-03) ห้ามใช้ key shape เดียวกับ query แบบ page เดียว ลบ `monitorQueryKeys.checks` เพราะผู้ใช้เดียวคือ `ChecksHistoryCard` ที่ถูกลบ
- `MONITOR_CHECKS_CHUNK_SIZE = 50` ใน `apps/web/src/lib/api/monitors.ts` เท่ากับ `limit` สูงสุดของ contract
- หน้าใหม่อ่าน `monitorQueryKeys.detail` เดิมเพื่อชื่อมอนิเตอร์และ not-found/denied โดยไม่ตั้ง `refetchInterval`

`ChecksHistoryPage` contract:

- Mount แบบ keyed `${organizationId}:${monitorId}` เหมือน `DetailPage`
- ลำดับ gating เหมือน `DetailPage`: `mePending`/สลับ Organization/re-read membership เป็น loading; `meError` เป็น error พร้อมลองอีกครั้ง; non-member หรือ denied เป็น "คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้" โดยไม่แสดงชื่อ Organization ตาม AC-02, AC-83 และ Detail ปัจจุบัน (`DetailPage.tsx` บรรทัด 334 ถึง 344); `MONITOR_NOT_FOUND` จาก query ใดก็ได้เป็น "ไม่พบมอนิเตอร์นี้" พร้อมลิงก์กลับรายการ; denied/not-found ไม่ render แถวหรือชื่อจาก cache แยก gating ร่วมกับ `DetailPage` เป็น module ใน `apps/web/src/pages/monitors/` ได้เฉพาะเมื่อทั้งสองหน้าใช้จริง
- Header: ลิงก์ "กลับไปหน้ามอนิเตอร์" (`<Link>` ไป Detail) ด้านบนตามรูปแบบลิงก์กลับของ Detail, `PageHeader` title เป็นชื่อมอนิเตอร์ (ระหว่างโหลดใช้ "มอนิเตอร์" เหมือน Detail), h2 "ประวัติการตรวจ" และ meta "เวลาแสดงตามเขตเวลา {TIME_ZONE}" เดิม
- ตาราง: ย้าย `columns`, `markUrlChanges` และรายการ "เปลี่ยน URL เมื่อ..." เหนือตารางจาก `ChecksHistoryCard` โดยไม่เปลี่ยนคอลัมน์ (AC-17 ส่วนประวัติ, AC-18) รายการเหนือตารางใช้ `urlChanges` ที่รวมแล้วและ key `at` + `url` `markUrlChanges` ทำบนรายการสะสมทั้งหมด จุดเปลี่ยน URL ที่คร่อมขอบ chunk จึงถูกทำเครื่องหมาย `DataTable` ส่ง `className="max-h-none"` เพื่อไม่ให้มี vertical scrollbar ในตาราง (LAY-02) แนวนอนยัง scroll ใน region ได้
- โหลดเพิ่ม (TD-85-02): `useInfiniteQuery` `initialPageParam: 0`, `queryFn` เรียก `fetchMonitorChecks(organizationId, monitorId, { limit: MONITOR_CHECKS_CHUNK_SIZE, offset })`, `getNextPageParam` คืน `last.page.offset + last.checks.length` เมื่อ `last.checks.length > 0` และค่านั้นน้อยกว่า `last.page.total` มิฉะนั้นคืน `undefined` รวมแถวโดยตัดซ้ำด้วย `scheduledFor` (เก็บตัวแรก ลำดับยังเป็น `scheduled_for desc`) และรวม `urlChanges` โดยตัดซ้ำด้วย `at` + `url`
- Auto refetch (TD-85-03): `refetchInterval` เท่ากับ `MONITOR_REFETCH_INTERVAL_MS`, `refetchOnWindowFocus` และ `refetchOnReconnect` ทำงานเฉพาะตอนมี 1 chunk หลังโหลดเพิ่มให้เป็น `false` ตั้ง `gcTime: 0` เพื่อทิ้ง chunk ที่สะสมเมื่อออกจากหน้า การเปิดหน้าครั้งถัดไปจึงเริ่มจาก chunk แรกเสมอ และไม่มีการ refetch หลาย chunk ตอน mount หยุด refetch เมื่อ denied/not-found เหมือน Detail
- แถวใหม่ที่เกิดหลังผู้ใช้เริ่มโหลดเพิ่มจะไม่แสดงจนกว่าเปิดหน้าใหม่ (ผลของ TD-85-03) ข้อความสรุปจึงนับ n จากแถวที่แสดงจริงหลังตัดซ้ำ และใช้ "แสดงครบ" เฉพาะเมื่อ n >= `total` ของ response ล่าสุด

| State | Behavior |
| --- | --- |
| Initial loading | skeleton แถวและ `role="status"` "กำลังโหลดประวัติการตรวจ" เดิม |
| Empty (`total === 0`) | "ยังไม่มีผลการตรวจ" ไม่มีปุ่มและไม่มีสรุปจำนวน |
| Initial error | "โหลดประวัติการตรวจไม่สำเร็จ" + "ลองอีกครั้ง" |
| Data | ตาราง, ข้อความสรุปบนจอ "แสดง 1–{n} จาก {total}" (n = แถวหลังตัดซ้ำ) และ `<button>` "โหลดเพิ่ม" เมื่อมี next page |
| Loading more | ปุ่มยัง mount อยู่ `aria-disabled="true"` ไม่ใช้ `disabled` และไม่รับคลิกระหว่าง `isFetchingNextPage` |
| Load-more error | คงแถวและสรุปเดิม แสดง `<Alert tone="error">` "โหลดประวัติการตรวจไม่สำเร็จ" เหนือปุ่ม ปุ่มคง label "โหลดเพิ่ม" กดซ้ำคือ retry Alert หายเมื่อเริ่มโหลดใหม่ ถ้าได้ 403/404 ไปที่ state denied/not-found แทน ไม่ใช้ Alert นี้ |
| Background refetch error (1 chunk) | คงแถวพร้อม warning "อัปเดตประวัติการตรวจไม่สำเร็จ" เดิม |
| Chunk ที่มีแต่แถวซ้ำ (k = 0) | เกิดเมื่อมีผลใหม่อย่างน้อย 50 ผลระหว่างการกดสองครั้ง ประกาศครั้งเดียวด้วย k = 0 ตามจริง ปุ่มยังอยู่ถ้ามี next page |
| ไม่มี next page | ไม่มีปุ่ม ถ้า n >= `total` (n เกิน `total` ได้เมื่อ retention ลบ partition ระหว่าง chunk) สรุปเป็น "แสดงครบ {n} รายการ" ถ้า n น้อยกว่า `total` (มีผลใหม่หลังโหลดครั้งแรก) สรุปเป็น "แสดง 1–{n} จาก {total}" ตามด้วยบรรทัด "ผลตรวจที่ใหม่กว่าการโหลดครั้งแรกจะแสดงเมื่อเปิดหน้านี้ใหม่" |

Accessibility ของหน้าใหม่ (AC-80, Feature UI state row "Accessibility"):

- ปุ่มเป็น `<button>` ลิงก์กลับเป็น `<a href>` ผ่าน `<Link>` ทั้งคู่ใช้ focus ring เดิม (A11Y-01)
- ทุกการโหลดเพิ่มที่ผู้ใช้กดและปุ่มยังอยู่: โฟกัสค้างที่ปุ่ม `<p role="status" className="sr-only">` ที่ mount ตลอดประกาศครั้งเดียว "โหลดเพิ่ม {k} แถว (แถวที่ {n-k+1}–{n} จาก {total})" ไม่ประกาศ background refetch และไม่ย้ายโฟกัสไปแถวใหม่
- การโหลดครั้งสุดท้ายที่ทำให้ปุ่มหายไป: ถ้าปุ่มถือโฟกัสอยู่ ย้ายโฟกัสไปข้อความสรุป `<p tabIndex={-1}>` ซึ่ง render อยู่ข้างปุ่มตลอด และใช้ outline แบบ `TITLE_FOCUS_CLASS` ของ `AuditLogPage.tsx` รอบนี้ไม่เขียน live region เพื่อไม่ให้อ่านซ้ำ นี่เป็นข้อยกเว้นเดียวของ "โฟกัสไม่หลุดจากปุ่ม" เพราะปุ่มไม่มีอยู่แล้ว
- ข้อความ "แสดงครบ {n} รายการ" และข้อความประกาศข้างบน (ข้อเสนอของ `ux-designer`) และบรรทัด "ผลตรวจที่ใหม่กว่า..." (ข้อเสนอของ Technical Lead) ได้รับอนุมัติพร้อม Spec 2026-10-06 ตามถ้อยคำที่ร่าง

#### Detail page (#85)

Layout (AC-79, AC-84, AC-85):

- คอลัมน์หลักเรียง `ResponseTimeCard`, `StatusCard`, `MonitorEventsCard`, `IncidentsCard` ตาม Feature UI flow ข้อ 1 ลบ `LastResultCard` (AC-84) และ `ChecksHistoryCard` (AC-85) ลบ prop `code` "01" ถึง "06" (Feature In scope) heading ยังเป็น h2 ตามลำดับ (AC-22)
- คอลัมน์ขวาเพิ่มการ์ดเล็กบนสุดที่มี `<Link>` "ดูประวัติการตรวจ" ไป `${overviewPath}/${monitorId}/checks` ลูกศร "→" เป็น `aria-hidden` ตามด้วย `ConfigCard`, `AlertsCard`, `SslCard`, `LastResponseCard` เดิม
- ย้าย `failureText` จาก `LastResultCard.tsx` ไป `detail/labels.ts` แล้วลบ `LastResultCard.tsx` ทั้งไฟล์ `AssertionTable` ยังอยู่ (หน้าประวัติใช้) และ `EVALUATED_FROM_PREFIX_TEXT` ยังอยู่ (`TestPanel.tsx` ใช้)

Captions (AC-75 ฉบับแก้ 2026-10-06 ตาม OD-85-01 (a); รูปแบบและถ้อยคำตาม OD-85-02 ที่ผู้ใช้ตัดสิน 2026-10-06 หลัง team-lead เทียบ canvas `Main.dc.html` กับ code ปัจจุบัน Technical Lead ไม่ได้เปิด canvas เอง):

- `ResponseTimeCard`: รวม `<p>` ที่แสดงตลอดหรือตามเงื่อนไข 4 ท่อนเดิม (`ResponseTimeCard.tsx` บรรทัด 266 ถึง 269, 284 ถึง 289, 290 ถึง 299 และ 300 ถึง 305) เป็นย่อหน้าเดียวแบบ canvas: คั่นแต่ละท่อนด้วย `·` และใช้ `text-xs text-foreground-secondary` ย่อหน้านี้คือ caption ของ AC-75 และขึ้นบรรทัดใหม่ได้ตามความกว้าง ท่อนที่ต้องมีและเงื่อนไขเดิม:
  - หน่วย `ms`, ช่วง, แหล่งข้อมูล และเขตเวลา แสดงตลอด (AC-75, AC-71, baseline AC-15, CMP-05)
  - นิยามประชากรและ null แสดงตลอด ใช้ถ้อยคำเดิมโดยตัดเฉพาะวลี "ใช้ nearest-rank" (OD-85-01): เวลาที่วัดได้และไม่เป็น null รวมผลล้มเหลวและปัญหาฝั่งระบบที่วัดได้, ไม่มีค่าที่วัดได้แสดง "ไม่มีข้อมูล", จำนวนการตรวจนับ pass + fail ไม่นับปัญหาฝั่งระบบ, ล้มเหลวนับผล fail ไม่ใช่จำนวนเหตุการณ์ (AC-71, PD-57-05)
  - ขอบช่วง `scheduled_for` จาก `data.window` แสดงเมื่อ `data !== undefined` ทุกช่วง และหมายเหตุการปัด UTC-hour เฉพาะเมื่อ range ไม่ใช่ `24h` (AC-67, PD-57-07)
  - ข้อความ cap "คำนวณจากผลตรวจล่าสุดไม่เกิน 1,440 รายการ" คำต่อคำ เฉพาะเมื่อ `data.range === "24h"` และ `points.length === MONITOR_RESPONSE_POINTS_MAX` (AC-68, PD-57-08)
- Invariant: ไม่มี state ใดที่ท่อน cap, ขอบช่วง หรือประชากรหายไปจากที่ HEAD เคยแสดง การประกอบ string และคำเชื่อมระหว่างท่อนเป็นงานของ NODE-F005-85C ภายใต้ invariant นี้ `<p role="status">` ของ `response-range-announcement` ยังเป็น element แยก ไม่รวมเข้าย่อหน้านี้
- `StatusCard`: canvas ไม่มี caption นี้ ผู้ใช้ให้คงข้อความเดิมคำต่อคำ "คำนวณจากการตรวจที่มีผล ไม่รวมช่วงหยุดชั่วคราวและช่วงที่ตรวจไม่ได้ ช่วงไม่มีข้อมูลไม่นับเป็นปกติ" ที่ HEAD เป็น `<p className="text-xs text-foreground-secondary">` ย่อหน้าเดียวอยู่แล้ว (`StatusCard.tsx` บรรทัด 192 ถึง 195) จึงไม่ต้องแก้ ข้อมูลของ baseline AC-14 (จำนวนการตรวจและ coverage ต่อช่วงใน `UptimeWindow`) คงเดิม
- `aria-label` ของ group กราฟไม่เปลี่ยน เพราะไม่ใช่ย่อหน้าที่มองเห็น

ตัวสลับกราฟ/ตาราง (AC-76, AC-77, TD-85-05):

- State `view: "chart" | "table"` ใน `ResponseTimeCard` ค่าเริ่มต้น `"chart"` แยกจาก `range`: สลับช่วงไม่เปลี่ยน view และสลับ view ไม่เปลี่ยนช่วง
- ปุ่มอยู่ก่อนมุมมองที่สลับ ภายใน branch ที่มีกราฟเดิม (`hasChecks || paused`) label "ดูข้อมูลกราฟเป็นตาราง" ในมุมมองกราฟ และ "ดูข้อมูลเป็นกราฟ" ในมุมมองตาราง ไม่ใช้ `aria-expanded`, `aria-controls` หรือ `aria-pressed` เพราะ label บอกผลหลังกดแล้ว ปุ่ม mount ตลอด โฟกัสจึงไม่หลุด
- ตำแหน่งปุ่ม (Feature UI state "ปุ่มอื่นในหน้าไม่เปลี่ยนตำแหน่ง"): ปุ่มสลับและตัวเลือกช่วงอยู่เหนือส่วนที่สลับจึงไม่ขยับ เนื้อหาใต้การ์ดอาจเลื่อนตามผลต่างความสูงของกราฟ (240 px พร้อม legend) กับตาราง (`max-h-80` ใน `response-time-table.tsx`) ไม่ fix ความสูงเพราะจะตัดเนื้อหา ผลนี้เป็นการตีความที่ 85V ต้องตรวจด้วยสายตา
- Render เฉพาะมุมมองที่ active (มุมมองอื่น unmount ไม่ใช่ซ่อนด้วย CSS) ตารางคือ `ResponseTimeTable` ด้วย `series` ชุดเดียวกัน ไม่ fetch ใหม่
- อยู่นอกส่วนที่สลับและ mount ตลอด: KPI grid, ข้อความสรุป, `response-range-announcement` (#57 AC-71) และ refetch warning
- AC-76: ในมุมมองกราฟ hint `<p aria-hidden="true">` และ `aria-live="polite"` ของ `ResponseTimeChart` (บรรทัด 475 ถึง 486) ไม่เปลี่ยน

แกนและ legend (AC-78, TD-85-08):

- คงแกนตั้งที่มีอยู่และตรวจเป็น regression: ตัวเลขกำกับ gridline มาจาก `y.ticks(4)` ที่สเกลตามข้อมูล ไม่ใช้ค่าตายตัวของ mock (0/100/250/400) และคงป้าย `ms`
- Legend ใช้ถ้อยคำ canvas คำต่อคำ (OD-85-02, ผู้ใช้ตัดสิน 2026-10-06) แทนข้อความเดิมใน `response-time-chart.tsx` บรรทัด 487 ถึง 498:

  | Legend เดิม | Legend ใหม่ | เงื่อนไขการแสดง |
  | --- | --- | --- |
  | "เส้น: เวลาตอบสนอง" | "— เวลาตอบสนอง (แกนตั้ง: ms)" | ตลอด |
  | "× ตรวจแล้ว ไม่มีเวลาตอบสนอง (เช่น หมดเวลา)" | "✕ ไม่ตอบสนอง" | เมื่อมี entry `no-response` เหมือน HEAD |
  | "แถบเทา: หยุดชั่วคราว" | "▦ หยุดชั่วคราว" | ตลอด |
  | "แถบลาย: ไม่มีข้อมูล" | "▤ ไม่มีข้อมูล" | ตลอด |
  | "เส้นประ: เปลี่ยน URL หรือแก้ค่า" | "┊ เปลี่ยนค่า" | ตลอด |
  | "○ ตรวจไม่ได้ (ปัญหาฝั่งระบบ)" | คงเดิม | เมื่อมี entry `check-error` เหมือน HEAD |

- Glyph (`—`, `✕`, `▦`, `▤`, `┊`, `○`) อยู่ใน `<span aria-hidden="true">` เพื่อให้ screen reader อ่านเฉพาะข้อความไทย `✕` ใช้ `text-danger` ให้ตรงกับ mark `stroke-danger` ข้อความยังบอกความหมายจึงไม่พึ่งสีอย่างเดียว
- Canvas เป็น mock สถานะเดียวที่ไม่มีผลตรวจไม่ได้ จึงไม่มีรายการ `○` รายการนี้คงไว้เพราะกราฟยังวาด mark `check-error` (baseline AC-39, CMP-05) ไม่เพิ่มหมวดข้อมูลใหม่ (AC-78) และไม่แก้ `response-time-table.tsx` หรือ `describeEntry` ที่ยังใช้คำ "ตรวจแล้ว ไม่มีเวลาตอบสนอง"

จุด "ข้อมูล ณ" (AC-81, TD-85-06):

- `DetailPage` ส่ง `fresh={!detail.isError}` ให้ `StatusCard` ซึ่ง render จุด 6 px `aria-hidden` หน้า "ข้อมูล ณ"
- `fresh`: `live-pulse bg-primary` (MOT-01, COL-07) เป็น element เดียวใน Detail ที่ใช้ `live-pulse`
- ไม่ `fresh`: `bg-foreground-secondary` ไม่มี `live-pulse` และไม่มี glow (CMP-01, Motion principle) Alert "อัปเดตข้อมูลไม่สำเร็จ กำลังแสดงข้อมูล ณ..." เดิมคงอยู่ Detail คงจุดไว้ต่างจาก Workspace ที่ซ่อนจุด ตามที่ AC-81 กำหนด

Glow ของ severity badge (AC-87, TD-85-07, ข้อยกเว้น COL-08 ใน Motion principle):

- เงื่อนไข: `monitor.health === "down" && monitor.openIncident !== null && !detail.isError`
- ใช้เฉพาะ `HealthPill` ใน header ของ Detail ผ่าน wrapper (`rounded-full`) ใน `DetailPage.tsx` หรือ `detail/` ไม่แก้ `HealthPill.tsx` ที่ `MonitorTable` และ `MonitorCards` ของ Overview ใช้ร่วม (AC-82)
- เป็น `box-shadow` คงที่จาก `var(--primary-glow)` ไม่ใช้ `live-pulse` และไม่ animate ไม่เพิ่ม color token fill/label/dot ของ `StatusPill` คงตาม COL-01/COL-02 badge โฟกัสไม่ได้ จึงไม่กระทบ A11Y-01
- glow หายใน render ถัดไปเมื่อ incident จบ, pause หรือ refetch ล้มเหลว (ข้อหลังใช้ Motion principle ข้อ stale)

Pagination ของฟีดเหตุการณ์และเหตุการณ์ (AC-86, TD-85-04):

- Render `DataTablePagination` เฉพาะเมื่อ `page.offset > 0 || page.offset + rows.length < page.total` ที่ offset 0 เท่ากับซ่อนเมื่อ `total <= MONITOR_HISTORY_PAGE_SIZE` (20) เกิน threshold ใช้ pagination เดิมไม่เปลี่ยน เงื่อนไข `offset > 0` คงทางกลับเมื่อ total ลดลงขณะอยู่หน้า 2

#### Authorization and security (#85)

รักษา [Architecture](../../architecture.md) DB-01 ถึง DB-04, DB-09, REQ-03/05, OPS-01 และ WEB-01 ถึง WEB-04:

- อ่านได้เฉพาะ `owner`, `admin`, `viewer`, `auditor` ที่เป็นสมาชิก (AC-02, AC-83) ไม่มี write path, endpoint, query, migration หรือ grant ใหม่ `listChecks` ใช้ `readInTenant` และ `assertMonitorInTenant` พร้อม predicate `monitor_id` + `tenant_id` บน `monitor_check_results` ที่มี FORCE RLS/grants ใน `0016_uptime_monitors.sql` เดิม
- Disclosure: id ที่ไม่มี, รูปแบบผิด หรือข้าม Organization ได้ 404 เดียวกันและ UI "ไม่พบมอนิเตอร์นี้" (AC-48); non-member ได้ 403 และ UI denied ตาม AC-02 โดยไม่เห็นชื่อ Organization, ชื่อมอนิเตอร์หรือจำนวนแถว ทั้งสองคำตอบไม่เปิดเผยว่ามอนิเตอร์มีอยู่ (AC-83 ฉบับแก้ 2026-10-06 ตาม OD-85-05 (a)); หลัง denied/not-found หรือสลับ Organization ไม่มีแถวค้างจาก cache (WEB-03, AC-49)
- Loader: `monitorDetailLoader` ตรวจ session และ membership ก่อน prefetch (WEB-04)
- หน้าใหม่แสดงเฉพาะ `url_masked` เดิม ไม่แสดง last response body (OD-58-04, owner/admin เท่านั้น อยู่ใน Detail ต่อ)
- ไม่เพิ่ม logging, audit, credential read/decrypt หรือ fresh-auth boundary
- ต้องตรวจจริง (ไม่ใช่ N/A): `read-detail.db.test.ts` describe "Detail, Checks and Incidents: access" (ทุก role กับ `/checks` และ suffix อื่น, foreign monitor) ด้วย runtime NOBYPASSRLS URLs ตาม Quality README, unit test `path-logging.test.ts` (ไม่ใช้ DB) และ Web tests ของหน้าใหม่สำหรับ denied, non-member, not-found และ tenant switch

#### Concurrency (#85)

- Offset drift: Worker insert ผลใหม่ที่หัวรายการระหว่าง chunk ทำให้ chunk ถัดไปซ้อนแถวเดิม ตัดซ้ำด้วย `scheduledFor` (PK `(monitor_id, scheduled_for)`) จึงไม่แสดงแถวซ้ำ การ insert เลื่อนแถวลงอย่างเดียว จึงไม่มีแถวที่เก่ากว่าแถวบนสุดที่โหลดไว้ถูกข้าม ผลที่ยอมรับ: ผลที่ใหม่กว่าการโหลด chunk แรกไม่แสดงหลังเริ่มโหลดเพิ่ม และสรุปไม่อ้างว่าครบ (ดู state "ไม่มี next page") `urlChanges` ที่ซ้อนกันตัดซ้ำด้วย `at` + `url`
- `listChecks` อ่าน rows และ `total` เป็นสอง statement ไม่รับรอง snapshot เดียว ผลที่ยอมรับ: ปุ่มและสรุปตาม `total` ของ response ล่าสุด chunk ถัดไปอาจคืนเฉพาะแถวซ้ำ หรือปุ่มอาจหายเมื่อ retention ตัดท้าย ห้ามวนโหลดไม่รู้จบ (`getNextPageParam` ต้องมี `checks.length > 0`)
- Retention ลบ partition ที่เก่ากว่า 31 วัน: chunk ท้ายสั้นลงหรือว่าง แล้วปุ่มหายไป
- มอนิเตอร์ถูกลบหรือสมาชิกถูกนำออกระหว่างดู: request ถัดไปได้ 404/403 หน้าเปลี่ยนเป็น not-found/denied ไม่ render แถวที่สะสม และ re-read membership แบบ Detail
- สลับ Organization ระหว่าง fetch: ไป Overview ของ Organization ใหม่ key อยู่ใต้ tenant prefix และ component keyed จึงไม่มี response เก่าเข้าหน้าใหม่ (WEB-03)
- กดซ้ำเร็ว: ไม่รับคลิกระหว่าง fetch background refetch มีเฉพาะตอน 1 chunk ถ้าผู้ใช้กดโหลดเพิ่มระหว่าง refetch ของ chunk แรก ผลยังถูกต้องเพราะตัดซ้ำ
- Detail: จุด "ข้อมูล ณ" และ badge glow ตามผล fetch ล่าสุดของ detail query และกลับมาเมื่อ refetch สำเร็จ ตัวสลับ view ไม่ผูกกับ range การประกาศช่วงของ response ที่ถูกแทนที่ยังตาม #57 contract เดิม

### Design decisions (#85)

| ID | Technical choice / tradeoff |
| --- | --- |
| TD-85-01 | PD-85-03 route: `/organizations/:organizationId/monitors/:monitorId/checks` ตรงกับ API path `/monitors/{monitorId}/checks` และอยู่ใต้ prefix ของ nav จึงไม่ต้องแก้ breadcrumb ใช้ `monitorDetailLoader` เดิมแทน loader ใหม่ ไม่เลือก query parameter บน Detail (`?view=checks`) เพราะรวม state และ focus ของสองหน้าไว้ใน component เดียว |
| TD-85-02 | PD-85-03 กลไก: สะสมผลด้วย `offset` ทีละ 50 ผ่าน `useInfiniteQuery` และตัดซ้ำ chunk แรกคือ preview ไม่เลือกการขยาย `limit` เพราะ `pageSchema`/`monitorHistoryQuerySchema` จำกัด `max(50)` จึงหยุดที่ 50 แถว ไม่เลือก cursor เพราะต้องเปลี่ยน contract (AC-82) ขนาด 50 ลดจำนวน request; preview จึงยาว 50 แถวแทน 20 แถวของการ์ดเดิม |
| TD-85-03 | Auto refetch (interval, focus, reconnect) เฉพาะตอนมี 1 chunk และ `gcTime: 0`: preview ยังสดทุก 30 s เหมือนการ์ดเดิม และไม่ refetch N chunk ตอน interval, focus, reconnect หรือ mount ซ้ำ ไม่เลื่อนแถวใต้ผู้อ่าน tradeoff: หลังโหลดเพิ่ม ผลใหม่ไม่แสดงจนกว่าจะเปิดหน้าใหม่ และสรุปบอกตามจริง |
| TD-85-04 | PD-85-02 threshold: ซ่อน pagination chrome เมื่อ offset 0 และ `total <= 20` เกินนั้นใช้ `DataTablePagination` เดิม เพราะ diff เล็กที่สุดและไม่ต้องใช้กลไก infinite กับอีกสองการ์ด |
| TD-85-05 | ตัวสลับแทน disclosure: เปลี่ยนจากปุ่ม `aria-expanded` ที่ต่อตารางใต้กราฟเป็นการแทนที่มุมมองด้วย label ที่เปลี่ยน ตาม AC-77 และ Feature UI state row |
| TD-85-06 | จุดข้อมูลเก่าคงไว้เป็นสี neutral ไม่มี glow: AC-81 ห้ามลบจุด, CMP-01 ห้ามข้อมูลเก่าดูเป็นปัจจุบัน สี Primary นิ่งยังอ่านว่าสด (`ux-designer`) |
| TD-85-07 | Badge glow คงที่และใช้เฉพาะ Detail ผ่าน wrapper: Motion principle จำกัด live treatment หนึ่ง element ต่อ view และระบุ COL-08 เป็นข้อยกเว้นเดียว (ผู้ใช้เลือก OD-85-03 (a) 2026-10-06) `live-pulse` จึงมีเฉพาะจุด "ข้อมูล ณ" ส่วน glow ของ badge คงที่ และหายเมื่อ refetch ล้มเหลวตามข้อ stale ของ Motion principle ไม่แก้ `HealthPill.tsx` เพื่อไม่แตะ Overview (AC-82) |
| TD-85-08 | AC-78: แกนตั้งมีแล้วที่ HEAD จึงเป็น regression delta คือ legend ใช้ glyph และถ้อยคำ canvas (OD-85-02) โดยไม่เปลี่ยนเงื่อนไขการแสดงและหมวดข้อมูล รายการ `○` ตรวจไม่ได้ที่ canvas ไม่มีคงไว้เพราะกราฟยังวาด mark นี้ |
| TD-85-09 | ย้าย code แทนสร้างใหม่: `ChecksHistoryCard` ย้ายเป็น `ChecksHistoryPage` และลบไฟล์เดิม, `failureText` ย้ายไป `labels.ts` ก่อนลบ `LastResultCard.tsx`, ลบ `monitorQueryKeys.checks` ที่ไม่มีผู้ใช้แล้ว test เดิมที่ mock `fetchMonitorChecks` ยังคอมไพล์ได้ ไม่บังคับแก้ |

Architecture drivers ที่แตะ:

- Runtime: Feature ไม่มี latency, availability หรือ load target และ Spec ไม่สร้างขึ้นเอง ภาระต่อผู้ดูหนึ่งคนเท่ากับการ์ดเดิม (1 request ทุก 30 s และตอน focus/reconnect เมื่อมี 1 chunk) และ 1 request ต่อการกดโหลดเพิ่ม (TD-85-03 ตัด refetch หลาย chunk) ความเสี่ยง: DOM โตตามแถวที่โหลดโดยไม่มี virtualization สูงสุดคือทุกแถวที่ยังเก็บอยู่ ซึ่งเกิน 43,200 แถว (รอบ 60 s ใน 30 วัน) ได้ เพราะ `db:partitions` ลบ partition รายเดือนเมื่อทั้งช่วงเก่ากว่า 31 วันเท่านั้น ไม่ใช่ target ถ้าพบปัญหาจริงให้เสนอเปลี่ยน contract ผ่านผู้ใช้
- Protection: ตาม [Authorization and security](#authorization-and-security-85)
- Operability: accessibility ตาม Feature UI states และ A11Y-01, ข้อความไทยเท่านั้น ไม่มี feature flag ไม่เปลี่ยน health, metrics หรือ alerts

ไฟล์ที่จำเป็นนอก path ที่ช่อง verification ของ AC-82 ระบุ (`detail/`, `DetailPage.tsx`, ไฟล์ route ใหม่): `apps/web/src/router.tsx` (ลงทะเบียน route, AC-79), `apps/web/src/lib/api/monitors.ts` (key ใหม่และลบ key ที่ไม่มีผู้ใช้, AC-80), `apps/web/src/components/ui/response-time-chart.tsx` (legend อยู่ในไฟล์นี้, AC-78), test ของหน้าและ component ที่เปลี่ยน และ E2E ที่เลือกปุ่มด้วย label เดิม ไม่แก้ไฟล์ของ #57/#58/#59/#60/Workspace, `HealthPill.tsx`, `index.css`, API, contract หรือ DB

Rollout: เปลี่ยนเฉพาะ Web ไม่มี migration, backfill หรือ flag ไม่มี API version skew bookmark ของ Detail ยังใช้ได้ Technical exclusions เพิ่มจาก [Feature non-goals](feature.md#scope-and-non-goals-85): virtualization ของตาราง, ปรับ `DataTable` ส่วนกลาง, แก้ #57 response-times query และแก้ test mock เดิมที่ยังผ่าน

### Technical acceptance rows (#85)

AC-88 (Concurrency), AC-89 (Security) และ AC-90 (Verification) อยู่ใน [Feature Acceptance matrix](feature.md#acceptance-matrix-85-delta) เป็น `frozen` ภายใต้ `F-005-AC-3` ตั้งแต่ผู้ใช้อนุมัติ Spec 2026-10-06 ไม่ bump version ตาม OD-85-04 (a) Feature matrix เป็น canonical ของ criteria ทั้งหมด ข้อความเดิมในหัวข้อนี้ย้ายไปโดยไม่เปลี่ยน criteria ดู contracts ที่รองรับใน [Concurrency](#concurrency-85), [Authorization and security](#authorization-and-security-85) และ [Integrated verification](#integrated-verification-85)

### Tasks (#85)

Task graph ได้รับอนุมัติพร้อม Spec 2026-10-06 ยังไม่มี start authorization, dispatch หรือ estimate งานเรียงลำดับเพราะ `DetailPage.tsx` และ `DetailPage.test.tsx` เป็นไฟล์ร่วม ไฟล์ร่วมมี owner ทีละ Task ตามลำดับในตาราง

| Task | Depends on | Integration owner of shared files |
| --- | --- | --- |
| NODE-F005-85A | Spec Approved (2026-10-06) และ start authorization (ยังไม่ได้รับ) | software-engineer: route, query key, หน้าใหม่ และการแก้ `DetailPage.tsx`/`DetailPage.test.tsx` รอบแรก |
| NODE-F005-85B | 85A handoff (`docs/design-system.md` ฉบับแก้ commit แล้วใน `a418091`) | software-engineer: `DetailPage.tsx`/`DetailPage.test.tsx` รอบสอง และการ์ด Detail |
| NODE-F005-85C | 85B handoff | software-engineer: `ResponseTimeCard`, chart และ `DetailPage.test.tsx` ส่วนเวลาตอบสนอง |
| NODE-F005-85V | 85A/85B/85C stopped | software-engineer: integrated evidence และ E2E; Technical Lead สั่ง gates และตัดสินผล |

#### NODE-F005-85A Checks history page

- **OWNER:** software-engineer
- **READY:** Spec Approved 2026-10-06 (ผ่านแล้ว) และผู้ใช้ให้ start authorization (ยังไม่ได้รับ)
- **OUTCOME:** หน้าประวัติการตรวจใหม่โหลดเพิ่มทีละ 50 แถว พร้อมลิงก์ไปกลับระหว่าง Detail และหน้าใหม่ และ Detail ไม่มีตารางประวัติแล้ว
- **SOURCE:** [Web routes and data](#web-routes-and-data-85), [Authorization and security](#authorization-and-security-85), [Concurrency](#concurrency-85), TD-85-01/02/03/09, Feature AC-79, AC-80, AC-83, AC-85
- **INVARIANTS:** ไม่เปลี่ยน API/contract; key อยู่ใต้ tenant prefix; ตัดซ้ำด้วย `scheduledFor`; gating ตาม Detail
- **FILES:** ใหม่ `apps/web/src/pages/monitors/ChecksHistoryPage.tsx`, `ChecksHistoryPage.test.tsx`; `apps/web/src/router.tsx` (AC-79); `apps/web/src/lib/api/monitors.ts` (key และ chunk, AC-80); `apps/web/src/pages/monitors/detail/labels.ts` (รับ `failureText`); `detail/LastResultCard.tsx` (แก้ import เท่านั้น); ลบ `detail/ChecksHistoryCard.tsx`; `DetailPage.tsx` เฉพาะลบ `ChecksHistoryCard` และเพิ่มการ์ดลิงก์ (AC-79, AC-85); `DetailPage.test.tsx` ย้าย case ประวัติไป test ใหม่
- **NON-GOALS:** [Feature non-goals](feature.md#scope-and-non-goals-85), technical exclusions ใน [Design decisions](#design-decisions-85), events/incidents pagination (85B)
- **CONTRACTS:** route และ `failureText` ใน `labels.ts` ส่งให้ 85B
- **VERIFY:** `bun run --cwd apps/web test src/pages/monitors/ChecksHistoryPage.test.tsx src/pages/monitors/DetailPage.test.tsx`; `bun run --cwd apps/web typecheck`; `bun run --cwd apps/web lint`; `bun run --cwd apps/api test` (รวม `path-logging.test.ts`); `bun run --cwd apps/api test:integration src/monitors/read-detail.db.test.ts` ผ่าน runtime/owner URLs ของ worktree ตาม Quality README (regression ของ request ตรง: "answers a non-member like a missing Organization, without names, URLs or counts" และ "answers a missing, a malformed and a foreign id with the same 404" ครอบ `/checks` อยู่แล้ว)
- **PROOF:** test ทุก state ในตารางของหน้าใหม่, ตัดซ้ำและไม่ข้ามแถวเมื่อ offset เลื่อน, สรุปเมื่อ n น้อยกว่า `total`, chunk ว่างหยุดโหลด, ไม่ refetch หลาย chunk (interval, focus, reconnect, remount), URL change คร่อม chunk และรายการเหนือตาราง, focus/ประกาศรวมรอบสุดท้าย, `aria-disabled` ระหว่างโหลด, ทุก read role, non-member เห็น denied "คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้" ตาม AC-02 โดยไม่มีชื่อ Organization หรือมอนิเตอร์, id ที่ไม่มี/รูปแบบผิด/ข้าม Organization เห็น "ไม่พบมอนิเตอร์นี้" ตาม AC-48 (ทั้ง UI และ request ตรง), 404/403 ระหว่างโหลดเพิ่ม, tenant switch, ลิงก์สองทิศทางเป็น client navigation, assertion และค่าที่ตัด 200 ตัวอักษรในประวัติ (AC-17)
- **COVERS:** AC-79, AC-80, AC-83 (Web), AC-85, AC-88 (หน้าใหม่), AC-89 (Web)

#### NODE-F005-85B Detail density, live dot, badge glow and pagination threshold

- **OWNER:** software-engineer
- **READY:** 85A handoff; `docs/design-system.md` ฉบับแก้ (COL-08, LAY-04 และข้อยกเว้น COL-08 ใน Motion principle) commit แล้ว (ผ่าน: `a418091` บน `main` ยังไม่ push ตามที่ team-lead แจ้ง 2026-10-06)
- **OUTCOME:** Detail ไม่มีผลล่าสุดและเลขหัวข้อ; caption ของสถานะปัจจุบันคงข้อความเดิม; จุด "ข้อมูล ณ" และ badge glow ผูกกับความสด; pagination ซ่อนเมื่อไม่เกิน 20 แถว
- **SOURCE:** [Detail page](#detail-page-85), TD-85-04/06/07/09, Feature AC-75, AC-81, AC-84, AC-86, AC-87
- **INVARIANTS:** ไม่แก้ `HealthPill.tsx`; `live-pulse` มีเพียงจุดเดียวใน Detail; glow ไม่แทน focus ring; ไม่แก้ #57 contracts; ข้อมูลจำนวนการตรวจและ coverage ของ AC-14 คงอยู่
- **FILES:** `apps/web/src/pages/monitors/DetailPage.tsx` (รวม wrapper glow, AC-87), `DetailPage.test.tsx`; ลบ `detail/LastResultCard.tsx`; `detail/StatusCard.tsx`, `detail/StatusCard.test.tsx` (AC-75, AC-81); `detail/IncidentsCard.tsx`, `detail/MonitorEventsCard.tsx`, `DetailEventFeed.test.tsx` (AC-86)
- **NON-GOALS:** [Feature non-goals](feature.md#scope-and-non-goals-85), `ResponseTimeCard` และ chart (85C), `HealthPill.tsx`, `index.css` token ใหม่
- **CONTRACTS:** None
- **VERIFY:** `bun run --cwd apps/web test src/pages/monitors/DetailPage.test.tsx src/pages/monitors/detail/StatusCard.test.tsx src/pages/monitors/DetailEventFeed.test.tsx src/pages/monitors/OverviewPage.test.tsx`; `bun run --cwd apps/web typecheck`; `bun run --cwd apps/web lint`
- **PROOF:** ไม่มี heading/การ์ดผลล่าสุดและไม่มี import `LastResultCard`; ไม่มี section code; caption ของ `StatusCard` เป็นข้อความเดิมคำต่อคำ; class ของจุดตอนสดและตอน refetch error; glow ตอน incident active, จบ, pause และ refetch error; Overview pill ไม่มี glow; pagination ที่ total 1, 20, 21 และ offset > 0 หลัง total ลดลง
- **COVERS:** AC-75 (สถานะปัจจุบันและเลขหัวข้อ), AC-81, AC-84, AC-86, AC-87, AC-88 (Detail), AC-82 (ขอบเขตไฟล์)

#### NODE-F005-85C Response-time card toggle, caption and legend

- **OWNER:** software-engineer
- **READY:** 85B handoff
- **OUTCOME:** การ์ดเวลาตอบสนองสลับกราฟ/ตารางได้, caption เป็นย่อหน้าเดียวคั่นด้วย `·` และ legend ใช้ glyph กับถ้อยคำ canvas โดยคง hint และ live region เดิม
- **SOURCE:** [Detail page](#detail-page-85), TD-85-05/08, Feature AC-75, AC-76, AC-77, AC-78; [#57 Web](../issue-57-monitor-response-stats/spec.md#web-57)
- **INVARIANTS:** ไม่เปลี่ยน #57 data/announcement contract; มุมมองที่ไม่ active ถูก unmount; `response-range-announcement` mount ตลอด
- **FILES:** `apps/web/src/pages/monitors/detail/ResponseTimeCard.tsx`; `apps/web/src/components/ui/response-time-chart.tsx` (legend เท่านั้น, AC-78); `response-time-chart.test.tsx`; `DetailPage.test.tsx` ส่วนเวลาตอบสนอง
- **NON-GOALS:** [Feature non-goals](feature.md#scope-and-non-goals-85), `response-time-series.ts`, `response-time-table.tsx`, chart library หรือ series semantics
- **CONTRACTS:** None
- **VERIFY:** `bun run --cwd apps/web test src/components/ui/response-time-chart.test.tsx src/pages/monitors/DetailPage.test.tsx`; `bun run --cwd apps/web typecheck`; `bun run --cwd apps/web lint`
- **PROOF:** สลับไปกลับทั้ง 24h/7d/30d โดย range และข้อมูลตรงกัน, label ทั้งสองสถานะ, focus ค้างที่ปุ่ม, ปุ่มสลับและตัวเลือกช่วงไม่ขยับ, มุมมองที่ไม่ active ไม่อยู่ใน DOM, hint และ `aria-live` ยังอยู่ในมุมมองกราฟ, range announcement ทั้งสองมุมมองและยังเป็น element แยกจาก caption; snapshot ข้อความก่อน/หลังทุก state ที่ HEAD แสดง caption (24h ไม่ชน cap, 24h ชน cap, 7d, 30d, ก่อนข้อมูลมา): caption เป็นย่อหน้าเดียวคั่นด้วย `·` แบบ `text-xs text-foreground-secondary`, มีหน่วย/ช่วง/แหล่ง/เขตเวลา, วลี "ใช้ nearest-rank" ถูกตัด, นิยามประชากร/null ครบ (AC-71), ขอบช่วงเมื่อมีข้อมูลและหมายเหตุ UTC-hour เฉพาะ 7d/30d (AC-67), ข้อความ cap คำต่อคำเฉพาะ 24h ที่ชน cap (AC-68) และไม่มี state ใดที่ท่อนเหล่านี้หายไปจาก HEAD; legend ตรงตารางใน [Detail page](#detail-page-85) คำต่อคำ, glyph เป็น `aria-hidden`, `✕` เป็น `text-danger`, รายการ `✕`/`○` แสดงตามเงื่อนไขเดิมด้วยข้อมูลที่มีทั้งหยุด/ไม่มีข้อมูล/ไม่ตอบสนอง/ตรวจไม่ได้; แกนตั้งเดิมที่สเกลตามข้อมูล
- **COVERS:** AC-75 (เวลาตอบสนอง), AC-76, AC-77, AC-78

#### NODE-F005-85V Integrated proof

- **OWNER:** software-engineer
- **READY:** writers หยุด, handoff 85A/85B/85C พร้อม; Technical Lead สั่ง full checks และไม่ bind candidate เอง
- **OUTCOME:** หลักฐาน behavior, security และ UI แบบ integrated พร้อม check ที่ข้ามและเหตุผล
- **SOURCE:** [Integrated verification](#integrated-verification-85), [Quality gates](../../../scripts/quality/README.md), Feature AC-75 ถึง AC-87, AC-88 ถึง AC-90 และ baseline regression ที่ระบุ
- **INVARIANTS:** ใช้ environment และ URLs ของ worktree เท่านั้น ไม่ใช้ owner role เป็นหลักฐาน runtime isolation ไม่อ้าง freeze หรือ release
- **FILES:** `e2e/tests/monitors-states.spec.ts` (บรรทัด 663 เลือกปุ่มด้วย label เดิม), `e2e/tests/monitors-access.spec.ts` (บรรทัด 500), scenario หน้าประวัติถ้าจำเป็น; `docs/features/issue-85-monitor-detail-redesign/verification.md`
- **NON-GOALS:** ซ่อม baseline ที่ไม่เกี่ยว, PR, deploy, release; blocker ด้าน scope ส่ง Technical Lead
- **CONTRACTS:** None
- **VERIFY:** commands ใน [Integrated verification](#integrated-verification-85) หลัง writers หยุดทั้งหมด ไม่รัน DB suites ขนานบน database เดียว
- **PROOF:** source state ที่ตรวจ, ผลต่อ AC แบบ pass/fail/not-run, ภาพหรือบันทึก browser ทั้งสอง theme และ reduced motion, บันทึก keyboard/screen reader, ผล gates, runtime role/RLS negative cases, รายการไฟล์ใน diff เทียบ FILES และเหตุผลของ check ที่ข้าม
- **COVERS:** AC-75 ถึง AC-90 แบบ integrated, baseline AC-14/15/17/18/22/33/48/49 และ #57 AC-67/68/70/71 regression

### Integrated verification (#85)

| AC / rule | Owned proof / scenario |
| --- | --- |
| AC-75 | 85B+85C+85V: snapshot ข้อความก่อน/หลังของการ์ดเวลาตอบสนอง (ย่อหน้าเดียวคั่นด้วย `·`, หน่วย/ช่วง/แหล่ง/เขตเวลา, ข้อความ cap, ขอบช่วง และนิยามประชากรครบตาม AC-67/68/71 รวม fixture ที่ชน cap ใน 24h และช่วง 7d/30d) และสถานะปัจจุบัน (caption เดิมคำต่อคำ) |
| AC-76 | 85C+85V: DOM ของมุมมองกราฟมี hint `aria-hidden` บนจอและ `aria-live="polite"` เดิม |
| AC-77 | 85C+85V: สลับทั้งสามช่วง, ข้อมูลตาราง/กราฟตรงกัน, label, focus, มุมมองที่ไม่ active ไม่อยู่ใน accessibility tree |
| AC-78 | 85C+85V: แกนตั้ง `ms` และ gridline ที่สเกลตามข้อมูล, legend "✕ ไม่ตอบสนอง", "▦ หยุดชั่วคราว", "▤ ไม่มีข้อมูล" แยกกันชัดด้วยข้อมูลที่มีทั้งสามกรณี ด้วยสายตาและ accessibility tree (glyph ไม่ถูกอ่าน) |
| AC-79 | 85A+85V: ลิงก์ Detail ไปหน้าใหม่และกลับ, route, breadcrumb "ตรวจสถานะบริการ", client navigation ไม่ reload |
| AC-80 | 85A+85V: โหลดเพิ่มจนครบชุดทดสอบมากกว่า 100 แถว ปุ่มหายถูกจังหวะ ไม่ค้างเป็นปุ่มกดไม่ได้, focus และประกาศตาม contract |
| AC-81 | 85B+85V: จำลอง refetch ล้มเหลวหลังสำเร็จ ตรวจ class จุดและ reduced motion |
| AC-82 | 85V: diff เทียบ FILES ของ 85A/85B/85C; ไม่มีไฟล์ #57/#58/#59/#60/Workspace/API/contract ถูกแก้นอกที่ระบุ |
| AC-83 | 85A+85V: ทุก read role, non-member เห็น denied ตาม AC-02, id ที่ไม่มี/รูปแบบผิด/ข้าม Organization เห็น "ไม่พบมอนิเตอร์นี้" ตาม AC-48, tenant switch บนหน้าใหม่ ทั้ง UI และ request ตรง |
| AC-84, AC-85 | 85A+85B+85V: Detail ไม่มีการ์ดผลล่าสุด, ตารางประวัติ หรือ `DataTablePagination` ของประวัติ; ไม่มี import `LastResultCard`/`ChecksHistoryCard` |
| AC-86 | 85B+85V: ฟีดเหตุการณ์และเหตุการณ์ที่ total 1, 20, 21 |
| AC-87 | 85B+85V: badge ขณะ incident active, จบ, pause, refetch error; Overview ไม่มี glow; ทั้งสอง theme |
| AC-88 | 85A+85B+85V: scenario ใน [Concurrency](#concurrency-85) |
| AC-89 | 85A+85V: integration `read-detail.db.test.ts` ด้วย runtime URLs, unit `path-logging.test.ts`, Web denial cases, diff ไม่มีไฟล์ API/contract/DB |
| AC-90 | 85V: รายงานตาม AC-90 |
| AC-15/22, #57 AC-70/71 | 85C+85V: ตารางทางเลือก keyboard, heading order, range announcement และ state ของการ์ดเวลาตอบสนองไม่ถดถอย |
| AC-14 | 85B+85V: uptime ต่อช่วงพร้อมจำนวนการตรวจและ coverage ยังแสดงหลังย่อ caption |
| AC-17/18 | 85A+85V: assertion, จุดเปลี่ยน URL ในตาราง และรายการเปลี่ยน URL เหนือตารางในหน้าประวัติ |
| AC-33 | 85V: ป้าย "ประเมินจากส่วนต้นของ response" ของผลทดสอบใน `TestPanel.tsx` ไม่ถดถอย; ผลที่บันทึกไว้ไม่มีที่แสดงป้ายนี้แล้วตาม AC-84 (follow-up ของ Product Owner) |
| AC-48/49 | 85A+85B+85V: not-found เดียวกันและไม่มีข้อมูลค้างหลังสลับ Organization ทั้ง Detail และหน้าใหม่ |

Behavior rows AC-75 ถึง AC-87 และ technical rows AC-88 (Concurrency), AC-89 (Security), AC-90 (Verification) ใน [Issue #85 Feature matrix](feature.md#acceptance-matrix-85-delta) เป็น frozen ตามคำอนุมัติผู้ใช้ 2026-10-06 โดยไม่เปลี่ยน criteria ทุก delta AC map ไป Task/scenario ด้านบน Baseline AC-01 ถึง AC-62 และ #57 AC-63 ถึง AC-74 คงเดิม การอนุมัติและ freeze ไม่ใช่ runtime proof หรือ implementation start

Full checks เมื่อ implementation ได้รับอนุญาตและ writers หยุด: `bun run validate` (รวม `codegen:check`), integration suite ผ่าน runtime/owner URLs จาก worktree resolver, `COVERAGE_GATE=1 bun run test:coverage`, `bun run security` และ `bun run --cwd e2e test tests/monitors-states.spec.ts tests/monitors-access.spec.ts` ตาม [Quality README](../../../scripts/quality/README.md) ไม่เปลี่ยน infra หรือ image จึงไม่สั่ง `security:image` E2E ไม่ใช่ PR gate เดิม แต่ scope นี้ยังต้องมี UI verification ไม่อ้าง CI green หรือ release approval จาก local checks

Document validation ของ run นี้: ตรวจ relative links, anchors, template fields, AC mapping และ symbols ที่อ้างกับ source ที่ `49cdcbb` ยังไม่รัน command ใดของ implementation Runtime acceptance ของ AC-75 ถึง AC-90 = not verified

### Open decisions (#85)

| Decision / missing input | Owner | Blocks Task / AC |
| --- | --- | --- |
| Follow-up: ป้าย "ประเมินจากส่วนต้นของ response" (AC-33) ของผลที่บันทึกไว้ไม่มีที่แสดงหลัง AC-84 จะเพิ่มในหน้าประวัติหรือไม่ | Product Owner | None (ไม่ block) |

ไม่มี technical decision ค้าง ผู้ใช้ตัดสิน OD-85-01, OD-85-03, OD-85-04 และ OD-85-05 ด้วยทางเลือก (a) และ OD-85-02 (caption/legend จาก canvas) เมื่อ 2026-10-06 (บันทึกใน [Feature Revisions](feature.md#revisions) และ [Revisions](#revisions-85)) ผลอยู่ใน Captions, แกนและ legend, TD-85-07, TD-85-08, Technical acceptance rows และ Authorization and security ด้านบน Product-level decisions อื่นของ Feature ปิดแล้วตาม [Feature Open decisions](feature.md#open-decisions) PD-85-02 และ PD-85-03 ตัดสินเป็น TD-85-01 ถึง TD-85-04 ใน Spec นี้ ข้อความ UI ที่เสนอ 3 ข้อได้รับอนุมัติพร้อม Spec 2026-10-06 Product Owner ยังต้องแก้ field "Technical Spec" และหัวข้อ Identity ใน `feature.md` ให้ตรงกับสถานะหลังอนุมัติ

ก่อนเริ่ม implement เหลือเพียง start authorization แยกจากผู้ใช้ `docs/design-system.md` ฉบับแก้ commit แล้วใน `a418091` (ยังไม่ push)

### Revisions (#85)

| Date | Change | Approved by user | `acceptanceVersion` |
| --- | --- | --- | --- |
| 2026-10-06 (draft) | Draft Spec ของ `F-005-S10`: route และกลไกโหลดเพิ่ม (PD-85-03 เป็น TD-85-01/02/03), threshold pagination (PD-85-02 เป็น TD-85-04), contracts ของ Detail, draft technical rows AC-88 ถึง AC-90, Tasks 85A/85B/85C/85V และ OD-85-01 ถึง OD-85-04 | Not yet | F-005-AC-3 (behavior rows frozen; technical rows draft) |
| 2026-10-06 (draft) | แก้ตามผล `code-reviewer`: ผูกย่อหน้านิยาม p50/p95 กับ OD-85-01, เพิ่ม OD-85-05 (non-member ใน AC-83), สรุปจำนวนแถวตามจริงเมื่อมีผลใหม่ และตัด refetch หลาย chunk (`gcTime: 0`, focus/reconnect), glow ผ่าน wrapper ไม่แก้ `HealthPill.tsx`, รายการไฟล์ที่จำเป็นนอก path ของ AC-82, รายการเปลี่ยน URL เหนือตาราง, state k = 0 และ 403/404 ระหว่างโหลดเพิ่ม, `path-logging.test.ts` เป็น unit test, เหตุผลของพื้นหลัง, COL-08 ต้อง commit ก่อน 85B, regression AC-14/AC-33 และถ้อยคำ OD-85-01(b)/OD-85-04 | Not yet | F-005-AC-3 (behavior rows frozen; technical rows draft) |
| 2026-10-06 (draft) | ผู้ใช้เลือกทางเลือก (a) ของ OD-85-01, OD-85-03, OD-85-04 และ OD-85-05 Product Owner แก้ AC-75, AC-83, UI flow table ใน Feature และ Motion principle ใน `docs/design-system.md` Spec ปรับตามผล: Captions และ PROOF ของ NODE-F005-85C ตาม AC-75 ฉบับใหม่ (คงข้อความ cap คำต่อคำ, ขอบช่วงบรรทัดเดียว, นิยามประชากร/null แบบย่อ, ตัดวลี nearest-rank), TD-85-07 อ้างข้อยกเว้น COL-08, AC-89 และ PROOF/VERIFY ของ NODE-F005-85A แยก non-member (denied ตาม AC-02) กับ id ผิด/ข้าม Organization ("ไม่พบมอนิเตอร์นี้" ตาม AC-48), technical rows คง `F-005-AC-3` และ freeze พร้อมการอนุมัติ Spec, ลบ OD ที่ตัดสินแล้ว การตัดสินรายข้อนี้ไม่ใช่การอนุมัติ Spec ทั้งฉบับ | Not yet (ตัดสินรายข้อแล้ว 2026-10-06; Spec ทั้งฉบับยังรออนุมัติ) | F-005-AC-3 (behavior rows frozen; technical rows draft) |
| 2026-10-06 | ผู้ใช้อนุมัติ Spec ทั้งฉบับรวมข้อความ UI ที่เสนอ 3 ข้อตามถ้อยคำที่ร่าง: อนุมัติ TD-85-01 ถึง TD-85-09, contracts และ Tasks; ย้าย AC-88 ถึง AC-90 เข้า Feature matrix โดยไม่เปลี่ยน criteria และ freeze AC-75 ถึง AC-90 ภายใต้ `F-005-AC-3` (ไม่ bump ตาม OD-85-04 (a)); ลบแถวข้อความที่เสนอออกจาก Open decisions; READY ด้าน design-system ของ NODE-F005-85B ผ่านด้วย `a418091` ยังไม่อนุญาต implementation start (ผู้ใช้ให้รอ OD-85-02) หรือ release | 2026-10-06, คำอนุมัติของผู้ใช้ผ่าน team-lead | F-005-AC-3 (frozen) |
| 2026-10-06 | ผู้ใช้ตัดสิน OD-85-02 หลัง team-lead อ่าน canvas `Main.dc.html` และเทียบกับ code: legend ใช้ glyph และถ้อยคำ canvas คำต่อคำ (คงรายการ `○` ตรวจไม่ได้ที่ canvas ไม่มีเพราะกราฟยังวาด mark นี้) และแกนตั้งสเกลตามข้อมูล; caption ของ `ResponseTimeCard` รวม 4 ท่อนเดิมเป็นย่อหน้าเดียวคั่นด้วย `·` โดยคงหน่วย/ช่วง/แหล่ง/เขตเวลา, นิยามประชากร (ตัดเฉพาะ "ใช้ nearest-rank"), ขอบช่วงกับการปัด UTC-hour และข้อความ cap คำต่อคำตามเงื่อนไขเดิม; caption ของ `StatusCard` คงข้อความเดิมคำต่อคำ (ไม่ต้องแก้) ปรับ Captions, legend, TD-85-08, READY/OUTCOME/PROOF ของ 85B/85C และ integrated rows AC-75/AC-78 ปิด OD-85-02 ไม่เปลี่ยน AC ใด ยังไม่มี start authorization | 2026-10-06, คำตัดสินของผู้ใช้ผ่าน team-lead | F-005-AC-3 (frozen) |
