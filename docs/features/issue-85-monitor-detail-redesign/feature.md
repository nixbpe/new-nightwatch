# Issue #85 Monitor Detail Redesign Feature

Owner: Product Owner (behavior), Technical Lead (Concurrency/Security/Verification rows, route and contract decisions). Delta ของ F-005; ไม่สร้าง Feature ID ใหม่

| Field | Value |
| --- | --- |
| Issue | [#85](https://github.com/nixbpe/new-nightwatch/issues/85) |
| Epic | None |
| Direction | `DIR-001/v3` เดิม, extension ของ F-005 |
| Related Feature / Story | [baseline F-005](../F-005-uptime-monitor/feature.md), เพิ่ม `F-005-S10` ไม่สร้าง Feature ID ใหม่ |
| Technical Spec | [spec.md](spec.md) Approved โดยผู้ใช้ 2026-10-06 (รวมข้อความ UI ที่เสนอ 3 ข้อ) OD-85-02 ปิดแล้ว (caption/legend ตาม canvas) ยังไม่มี start authorization |
| Scope approved by user | 2026-10-06, ผู้ใช้ยืนยัน PD-85-01/PD-85-04 และสั่งให้ Technical Lead ออก Technical Spec ต่อจากเอกสารนี้ |
| acceptanceVersion | `F-005-AC-3` (ต่อจาก `F-005-AC-2` ของ [#57](../issue-57-monitor-response-stats/feature.md), ซึ่งยังคง frozen ไม่เปลี่ยน) |
| Acceptance status | frozen, AC-75 ถึง AC-90 (AC-75 ถึง AC-87 behavior rows; AC-88 ถึง AC-90 technical rows จาก Spec ที่ผู้ใช้อนุมัติ 2026-10-06) |
| outcome_status | Not measured |

Baseline AC-01 ถึง AC-62 และ #57 delta AC-63 ถึง AC-74 อ่านได้จาก [baseline Feature](../F-005-uptime-monitor/feature.md#acceptance-matrix) และ [#57 Feature](../issue-57-monitor-response-stats/feature.md) แบบ read-only งานนี้ไม่แก้ตัวเลขหรือ contract ของ AC เดิมกลุ่มนั้น

## Problem and scope

หน้ารายละเอียดมอนิเตอร์ (`/organizations/:organizationId/monitors/:monitorId`) มี 10 section ในหน้าเดียวพร้อมย่อหน้าอธิบายวิธีคำนวณยาวหลายจุด และมี pagination เต็มรูปแบบ (เลขหน้า + ก่อนหน้า/ถัดไป) แยกกัน 3 จุด ทำให้สมาชิกที่ดูมอนิเตอร์สแกนสถานะได้ช้าและหน้าหนาแน่นเกินจำเป็น Scope/non-goals เต็มอยู่ใน [Scope and non-goals (#85)](#scope-and-non-goals-85) ด้านล่าง ไม่ย้าย baseline Feature ทั้งเล่ม

- In scope: ดูรายละเอียดใน delta ด้านล่าง
- Non-goals: ดูรายละเอียดใน delta ด้านล่าง

## Outcome

Outcome และข้อจำกัดการวัดอยู่ใน [Scope and non-goals (#85)](#scope-and-non-goals-85)

## UI flow

Canonical flow/states ของงานนี้อยู่ใน [UI flow and states (#85)](#ui-flow-and-states-85)

## Stories

- `F-005-S10` ในฐานะสมาชิกที่มีสิทธิ์อ่าน ฉันเห็นหน้ารายละเอียดมอนิเตอร์ที่กระชับขึ้นโดยไม่เสียข้อมูลสำคัญ และเปิดดูประวัติการตรวจแบบเต็มในหน้าแยกที่โหลดเพิ่มได้เรื่อยๆ แทนกดเปลี่ยนหน้าทีละ 20 แถว เพื่อสแกนสถานะได้เร็วและไล่ดูแนวโน้มย้อนหลังได้ต่อเนื่อง รวม loading, empty, error และ denied ตาม [Issue #85 delta](#issue-85-delta) ครอบคลุม AC-75 ถึง AC-90

## Issue #85 delta

### Identity, authority and evidence

- Parent: F-005, `DIR-001/v3` เดิม; revision ของ delta: `F-005-AC-3`, status `frozen` (AC-75 ถึง AC-90: AC-75 ถึง AC-87 behavior rows, AC-88 ถึง AC-90 technical rows ย้ายจาก Spec), Story `F-005-S10` ไม่สร้าง Feature ID ใหม่
- Canonical Technical Spec ของ delta: [spec.md](spec.md) Approved โดยผู้ใช้ 2026-10-06 รวม TD-85-01 ถึง TD-85-09, contracts, Tasks และข้อความ UI ที่เสนอ 3 ข้อ OD-85-02 (caption/legend ตาม canvas) ปิดแล้วเช่นกัน การอนุมัตินี้ไม่ใช่ start authorization หรือ release ผู้ใช้ยังไม่ให้ start authorization
- หลักฐานที่อ่าน: [issue #85](https://github.com/nixbpe/new-nightwatch/issues/85) (เพิ่งสร้างโดย session นี้ ยังไม่มี comment), [Claude Design canvas](https://claude.ai/artifact/SLxPDA7UR2kP5DfzzqU65e) ("NightWatch Monitor Detail Redesign", เป็น artifact ส่วนตัว ต้อง share ก่อนให้คนอื่นเปิดดูได้) ที่ผู้ใช้และ session นี้ทำร่วมกันผ่านหลายรอบ comment บน artboard `Main.dc.html` และ `ChecksHistory.dc.html`, `apps/web/src/pages/monitors/DetailPage.tsx`, การ์ดทั้งหมดใน `apps/web/src/pages/monitors/detail/` (รวม `ResponseTimeCard.tsx` และ `apps/web/src/components/ui/response-time-chart.tsx`), `apps/web/src/router.tsx`, `apps/web/src/lib/api/monitors.ts` (`MONITOR_HISTORY_PAGE_SIZE`), `packages/api-contract/src/monitor.ts` (`monitorChecksResponseSchema`: `checks` สูงสุด 50 ต่อหน้า, `page.{limit,offset,total}`), `apps/web/src/components/ui/data-table.tsx` (`DataTablePagination`) ที่ HEAD ปัจจุบันของ branch ที่ใช้ทำงานนี้ ไม่มี customer research หรือ runtime verification ใหม่
- งานนี้เป็นงาน design exploration ล้วนจนถึงตอนนี้: ไม่มีโค้ด production ของหน้ารายละเอียดถูกแก้ตามเอกสารนี้เลย การ์ด/route/contract ที่อ้างด้านล่างเป็นของจริงใน repo วันนี้ (ก่อนงานนี้) ใช้เป็นหลักฐาน baseline เท่านั้น
- Design canvas อ้างอิง token ที่ implement จริงแล้วในงานก่อนหน้า session นี้ (`apps/web/src/index.css`, `docs/design-system.md`: COL-07 `primary-glow`, LAY-08 `canvas-deep`, LAY-09 `grid-line`, MOT-01 `live-pulse`) ระหว่างทำ canvas พบและแก้ข้อผิดพลาดหนึ่งจุด: `canvas-deep`/`grid-line` ผูกกับ route `/workspace` เท่านั้นตาม `WORKSPACE_ROUTE` ใน `apps/web/src/components/shell/AppShell.tsx` หน้ารายละเอียดมอนิเตอร์ไม่อยู่ใน route นั้น จึงต้องใช้ `--background` ปกติเหมือนหน้าอื่น ไม่ใช้ `canvas-deep`/`grid-line` ข้อเท็จจริงนี้ต้องคงไว้ใน Technical Spec ต่อไป

### Scope and non-goals (#85)

- In scope: ลดความหนาแน่นของหน้ารายละเอียด (ตัดย่อหน้าอธิบายวิธีคำนวณที่ไม่จำเป็นออก, ตัดเลขนำหน้าหัวข้อ "01".."06" ที่เป็นของตกแต่งออก), ตัด section "ผลล่าสุดและ Assertions" ออกจากหน้ารายละเอียด, แยก section "ประวัติการตรวจ" ออกเป็นหน้าใหม่ต่างหากพร้อมลิงก์ไป-กลับ, เปลี่ยน pagination แบบเลขหน้าของประวัติการตรวจเป็น preview + โหลดเพิ่ม, เพิ่มตัวสลับกราฟ/ตารางในการ์ดเวลาตอบสนอง, เพิ่มเลขแกนตั้ง (ms) และสัญลักษณ์ "ไม่ตอบสนอง" ในกราฟเดิม, ปรับจุดบอกข้อมูลสดที่ "ข้อมูล ณ" ให้มี glow เฉพาะตอนข้อมูลสดจริง (ไม่ pulsing ตอนข้อมูลเก่า)
- Read permissions ใช้ AC-02, AC-48, AC-49 เดิม: `owner`, `admin`, `viewer`, `auditor` ที่เป็นสมาชิกอ่านได้เหมือน Detail ปัจจุบัน ไม่มี write operation ใหม่ หน้าประวัติการตรวจใหม่ใช้สิทธิ์อ่านเดียวกันกับ Detail ของมอนิเตอร์เดียวกัน
- Non-goals: เปลี่ยน contract หรือวิธีคำนวณของ #57 (p50/p95/checks/failed), เปลี่ยน schema หรือ pagination contract ของ `fetchMonitorChecks`/`MonitorChecksResponse`, เพิ่ม API endpoint ใหม่, เปลี่ยน uptime/incident classification, เปลี่ยน scheduler/check executor, เปลี่ยน retention 30 วัน, เพิ่มฟีเจอร์ "เลือกโชว์/ซ่อนแต่ละ section" (พิจารณาระหว่างทำ canvas แล้วไม่เอา), เปลี่ยนหน้า Overview/Workspace, target latency/performance ใหม่ และการ release
- Outcome: สมาชิกที่ดูมอนิเตอร์สแกนสถานะได้เร็วขึ้นและไล่ดูประวัติย้อนหลังได้ต่อเนื่องโดยไม่ต้องกดเปลี่ยนหน้าทีละ 20 แถว สังเกตผ่าน UI review ตาม AC-75 ถึง AC-90 ไม่มี baseline การใช้งานหรือ target เชิงตัวเลข เพราะเป็นงานปรับ UI ไม่ใช่งานวัด metric

### Delegated product decisions (#85)

ตารางนี้เป็นข้อเสนอของ Product Owner draft จากสิ่งที่ผู้ใช้ตัดสินระหว่างทำ canvas ไม่ใช่การอนุมัติ ยังต้องรอผู้ใช้ยืนยันพร้อมเอกสารนี้ทั้งฉบับ

| ID | Decision |
| -- | -------- |
| PD-85-01 | ตัด section "ผลล่าสุดและ Assertions" ออกจากหน้ารายละเอียดทั้งหมด ไม่มีที่แสดงผลตรวจล่าสุดครั้งเดียวพร้อม assertion breakdown อีกที่ใดในหน้าเดิม ผู้ใช้ให้เหตุผลว่าซ้ำซ้อนกับประวัติการตรวจ (แถวบนสุดของประวัติคือผลล่าสุด) ข้อควรระวังเดิม: baseline `F-005-S03` เคย promise ให้ Detail แสดง "การตรวจล่าสุด" เป็นส่วนหนึ่งของการดู Detail การตัดออกทั้งหมดเป็นการเปลี่ยน behavior ที่เคย ship แล้วจริง ไม่ใช่แค่ cosmetic ผู้ใช้ยืนยันแล้ว 2026-10-06: ตัดออกทั้งหมดตามที่ตัดสินใน canvas freeze เป็น AC-84 |
| PD-85-02 | ฟีดเหตุการณ์และเหตุการณ์ (incidents) ไม่ต้องแสดง pagination chrome ใดๆ เมื่อจำนวนแถวที่มีจริงน้อยกว่าหรือเท่ากับจำนวนที่แสดงอยู่แล้ว (ตัวอย่างจริงมี 1 แถว) draft นี้เห็นแค่กรณี 1 แถวจากตัวอย่าง ไม่ได้ตัดสินกรณี total มากกว่าจำนวนที่แสดง ผู้ใช้มอบให้ Technical Lead กำหนด threshold ที่ชัดเจน (เช่น "ซ่อน pagination เมื่อ total <= แถวที่แสดงในหน้าแรก") ในเอกสาร Spec (ไม่ block การ approve Feature นี้, ผูกกับ AC-86) |
| PD-85-03 | หน้าประวัติการตรวจใหม่ใช้ "โหลดเพิ่ม" (ปุ่มเดียว เพิ่มจำนวนแถวที่แสดงทีละก้อน) แทน `DataTablePagination` เดิม (เลขหน้า + ก่อนหน้า/ถัดไป) โดยใช้ contract การอ่านข้อมูลเดิม (`fetchMonitorChecks`/`monitorChecksResponseSchema`) ไม่สร้าง endpoint ใหม่ contract เดิมเป็น offset/limit อยู่แล้ว (`page.{limit,offset,total}`, `checks` สูงสุด 50 ต่อ response) ไม่มี cursor ผู้ใช้มอบให้ Technical Lead ตัดสินชื่อ route จริงและขนาดก้อนต่อการกด "โหลดเพิ่ม" หนึ่งครั้ง (ไม่เกิน 50) และจะสะสมผลที่ได้แบบเพิ่ม `offset` ต่อเนื่องหรือขอ `limit` ใหม่ที่ใหญ่ขึ้นทุกครั้ง (ไม่ block การ approve Feature นี้) |
| PD-85-04 | ป้ายสถานะ "ล่ม" ที่หัวหน้า (health badge) ใส่ glow ตามคำขอของผู้ใช้ระหว่างทำ canvas เดิมขัดกับ `docs/design-system.md` COL-07/LAY-04 (frozen): glow เคยจำกัดเฉพาะจุดข้อมูลสดหรือคู่กับ focus ring เท่านั้น ไม่รวม severity badge ผู้ใช้ยืนยันแล้ว 2026-10-06 ให้เพิ่มกติกาใหม่รองรับ แก้ไข `docs/design-system.md` แล้ว: เพิ่ม COL-08 ("severity badge ของมอนิเตอร์ที่มี incident active ใช้ `primary-glow` ได้, glow หยุดทันทีเมื่อ incident จบ/pause/เป็นประวัติ") และแก้ LAY-04 ให้ครอบคลุมกรณีนี้ freeze เป็น AC-87 |
| PD-85-05 | จุดบอกข้อมูลสด "ข้อมูล ณ {time}" แสดง glow pulsing เฉพาะตอนข้อมูลสดจริง (fetch ล่าสุดสำเร็จ) ถ้า background refetch ล้มเหลวและหน้าแสดงข้อมูลเก่าพร้อมคำเตือน "อัปเดตข้อมูลไม่สำเร็จ กำลังแสดงข้อมูล ณ..." (ของเดิมใน `apps/web/src/pages/monitors/DetailPage.tsx`) จุดต้องไม่ pulsing ต่อ (CMP-01) สอดคล้องกับ pattern เดียวกันที่ implement แล้วในหน้า Workspace session นี้ (`apps/web/src/pages/WorkspacePage.tsx`, `live-pulse`) แต่ตัว `live-pulse` class/token เองยังไม่เคยต่อเข้ากับหน้ารายละเอียดมอนิเตอร์มาก่อน ถือเป็นงานใหม่ของ #85 ไม่ใช่การใช้ของเดิมซ้ำ |

### UI flow and states (#85)

ใช้ route เดิมของ Detail และเพิ่ม route ใหม่หนึ่งเส้นทางสำหรับประวัติการตรวจ (ชื่อ route ที่แน่นอนเป็นการตัดสินใจทางเทคนิคของ Technical Lead เสนอ `/organizations/:organizationId/monitors/:monitorId/checks`)

1. สมาชิกเปิด Detail เห็นหัวข้อ, สถานะ, เวลาตอบสนอง (พร้อมตัวเลือกช่วง 24 ชม./7 วัน/30 วันเดิม), สถานะปัจจุบัน, ฟีดเหตุการณ์, เหตุการณ์, การตั้งค่า, การแจ้งเตือน, SSL และการตอบกลับล่าสุด โดยไม่มีย่อหน้าอธิบายวิธีคำนวณยาวคั่นระหว่างค่าต่างๆ
2. สมาชิกกดปุ่ม "ดูข้อมูลกราฟเป็นตาราง" ในการ์ดเวลาตอบสนอง การ์ดสลับจากกราฟเป็นตารางเวลา/ค่าเฉลี่ยของชุดข้อมูลเดียวกัน ปุ่มเปลี่ยนป้ายเป็น "ดูข้อมูลเป็นกราฟ" ให้กดสลับกลับได้ โฟกัสค้างที่ปุ่ม
3. สมาชิกกดลิงก์ "ดูประวัติการตรวจ →" ที่การ์ดเล็กบนสุดของคอลัมน์ขวา ไปหน้าประวัติการตรวจของมอนิเตอร์เดียวกัน เห็นตารางประวัติพร้อมปุ่ม "โหลดเพิ่ม" กดแล้วเพิ่มจำนวนแถวที่แสดงโดยไม่รีโหลดหน้า และมีลิงก์ "กลับไปหน้ามอนิเตอร์" กลับมา Detail เดิม

| Screen | State | Behavior and recovery |
| ------ | ----- | --------------------- |
| Detail | Loading | ใช้ loading/skeleton เดิมของแต่ละการ์ดตาม baseline AC-14/15/22 ไม่มีการเปลี่ยนแปลง |
| Detail, การ์ดสถานะปัจจุบัน | ข้อมูลสด | จุด "ข้อมูล ณ" มี glow pulsing ตาม PD-85-05 |
| Detail, การ์ดสถานะปัจจุบัน | Refetch error (ข้อมูลเก่าที่ยังแสดง) | จุด "ข้อมูล ณ" หยุด pulsing ทันที แสดงเวลาของข้อมูลที่ยังอยู่พร้อมคำเตือนเดิม "อัปเดตข้อมูลไม่สำเร็จ" ตาม PD-85-05 |
| Detail, การ์ดเวลาตอบสนอง | กราฟ ↔ ตาราง | สลับมุมมองของชุดข้อมูลเดียวกันโดยไม่โหลดใหม่ โฟกัสไม่หลุดจากปุ่ม ปุ่มอื่นในหน้าไม่เปลี่ยนตำแหน่ง |
| Detail, ฟีดเหตุการณ์ / เหตุการณ์ | จำนวนแถวน้อยกว่าที่เคยแสดงเป็น pagination | ไม่แสดง pagination chrome ตาม PD-85-02 (threshold แน่นอนรอ Spec) |
| หน้าประวัติการตรวจ (ใหม่) | Loading | แสดง loading state แบบเดียวกับตารางอื่นในหน้า Detail (skeleton แถว) ไม่ใช่หน้าว่างเปล่า |
| หน้าประวัติการตรวจ (ใหม่) | Empty | มอนิเตอร์ที่ยังไม่มีผลตรวจแสดง "ยังไม่มีผลการตรวจ" ไม่มีปุ่มโหลดเพิ่ม |
| หน้าประวัติการตรวจ (ใหม่) | Error | "โหลดประวัติการตรวจไม่สำเร็จ" พร้อม "ลองอีกครั้ง" เหมือนรูปแบบ error เดิมของ Detail |
| หน้าประวัติการตรวจ (ใหม่) | โหลดเพิ่มจนครบ | ปุ่ม "โหลดเพิ่ม" หายไปเมื่อไม่มีแถวเพิ่มอีก ไม่ค้างเป็นปุ่มกดไม่ได้ |
| หน้าประวัติการตรวจ (ใหม่) | Denied / not found / tenant switch | ใช้กติกาเดียวกับ Detail: non-member เห็น denied ตาม AC-02; id ผิดหรือข้าม Organization ตอบ "ไม่พบมอนิเตอร์นี้" ตาม AC-48 ทั้งสองแบบไม่เปิดเผยว่ามีอยู่ |
| หน้าประวัติการตรวจ (ใหม่) | Accessibility | ปุ่ม "โหลดเพิ่ม" และลิงก์กลับเป็น element จริง (`<button>`/`<a href>`) โฟกัสได้ด้วย keyboard หลังกด "โหลดเพิ่ม" โฟกัสไม่หลุดจากปุ่มและแถวใหม่ประกาศแบบ polite ครั้งเดียว ไม่ย้าย focus ไปแถวใหม่เอง |
| Detail, ตัวสลับกราฟ/ตาราง | Accessibility | มุมมองที่ไม่ได้ active ต้องไม่อยู่ใน accessibility tree (ถอดออกจริง ไม่ใช่แค่ซ่อนด้วย CSS) ปุ่มมี label ที่สื่อผลลัพธ์หลังกด ไม่ใช่แค่ "สลับ" |

Optional wireframe:

```text
+--------------------------------------------------+------------------+
| ← กลับไปรายการมอนิเตอร์                             |                  |
| [ชื่อมอนิเตอร์]  [สถานะ]        [หยุด][ลบ][แก้ไข]     |                  |
| [แบนเนอร์ล่ม ถ้ามี]                                  |                  |
+----------------------------------------------------+ [ลิงก์ดูประวัติ]  |
| เวลาตอบสนอง  [24 ชม.|7 วัน|30 วัน]                   | [การตั้งค่า]      |
|  p50 p95 จำนวนการตรวจ ล้มเหลว                        | [การแจ้งเตือน]    |
|  [กราฟ/ตาราง] [สลับมุมมอง]                            | [SSL]            |
+------------------------------------------------------+ [การตอบกลับล่าสุด]|
| สถานะปัจจุบัน  •ข้อมูล ณ ...                           |                  |
|  uptime 24h/7d/30d                                  |                  |
+------------------------------------------------------+                  |
| ฟีดเหตุการณ์ / เหตุการณ์                               |                  |
+--------------------------------------------------+------------------+
```

## Acceptance matrix (#85 delta)

`acceptanceVersion: F-005-AC-3`, status `frozen` เฉพาะ AC-75 ถึง AC-90 สำหรับ `F-005-S10`: AC-75 ถึง AC-87 เป็น behavior/accessibility rows ของ Product Owner, AC-88 ถึง AC-90 เป็น Concurrency/Security/Verification rows ของ Technical Lead ที่ร่างใน [Spec](spec.md) และย้ายเข้ามาเมื่อผู้ใช้อนุมัติ Spec 2026-10-06 ตามรูปแบบ AC-72 ถึง AC-74 ของ #57 ไม่ bump version ตาม OD-85-04 (a) Baseline AC-01 ถึง AC-62 และ #57 delta AC-63 ถึง AC-74 ไม่เปลี่ยน

| AC | Category | Observable behavior | Verification |
| -- | -------- | -------------------- | ------------- |
| AC-75 | Scope | หน้ารายละเอียดไม่มีย่อหน้าอธิบายวิธีคำนวณที่เป็นส่วนเสริมเกินกว่าที่ #57 บังคับ (เช่น "p50/p95 ใช้ nearest-rank จากเวลาที่วัดได้และไม่เป็น null") แทนที่ด้วย caption สั้นบรรทัดเดียวต่อการ์ด เนื้อหาที่ #57 บังคับให้แสดงต้องคงอยู่ครบ ย่อคำได้แต่ตัดทิ้งไม่ได้: ข้อความ cap "คำนวณจากผลตรวจล่าสุดไม่เกิน 1,440 รายการ" (AC-68/PD-57-08, frozen) ยังแสดงเหมือนเดิมเฉพาะตอนชน cap, ขอบช่วงจริงและการปัด UTC-hour (AC-67) ย่อเป็นบรรทัดเดียว, นิยามประชากร/หน่วย/เขตเวลาที่อ่านได้เป็นข้อความ (AC-71) อยู่ในรูปแบบย่อที่สุดเท่าที่ยังอ่านได้ | เทียบ snapshot ข้อความก่อน/หลังต่อการ์ดเวลาตอบสนองและสถานะปัจจุบัน ยืนยันข้อความ cap, ขอบช่วง และนิยามประชากรยังอยู่ครบตาม AC-67/68/71 |
| AC-76 | Accessibility | ข้อความแนะนำวิธีใช้กราฟด้วย keyboard ที่มีอยู่แล้วในโค้ดจริง ("เลือกกราฟด้วย Tab แล้วใช้ลูกศรซ้ายขวาเพื่อดูค่าแต่ละจุด", `response-time-chart.tsx`) เป็น `aria-hidden="true"` อยู่แล้ว คือ hint สำหรับผู้ใช้คีย์บอร์ดที่มองเห็นจอเท่านั้น ไม่ได้ถูก screen reader อ่าน งานลดคำอธิบายของ #85 ต้องไม่ลบข้อความนี้ออกจากหน้าจอ เพราะเป็นการลด discoverability ของผู้ใช้คีย์บอร์ดที่มองเห็น ส่วนการประกาศค่าที่เลือกให้ screen reader ใช้ `aria-live="polite"` region แยกต่างหาก (บรรทัดถัดไปในไฟล์เดียวกัน) ซึ่งทำงานอยู่แล้วและไม่อยู่ในขอบเขตของงานนี้ | ตรวจ DOM ของการ์ดเวลาตอบสนองก่อน/หลัง ยืนยันข้อความ hint ยังแสดงบนจอ และ `aria-live` region ยังอยู่ไม่เปลี่ยน |
| AC-77 | Scope | การ์ดเวลาตอบสนองมีปุ่มสลับกราฟ/ตารางที่ทำงานจริง: กดแล้วแสดงตารางเวลา/ค่าเฉลี่ยของชุดข้อมูลเดียวกันแทนกราฟ ป้ายปุ่มเปลี่ยนตามสถานะ (เช่น "ดูข้อมูลกราฟเป็นตาราง" ↔ "ดูข้อมูลเป็นกราฟ") กดซ้ำสลับกลับได้ ไม่เปลี่ยนช่วงเวลา (24 ชม./7 วัน/30 วัน) ที่เลือกอยู่ | กดปุ่มสลับไปมาและยืนยันข้อมูลตรงกันทั้งสองมุมมอง รวม 24h/7d/30d |
| AC-78 | Scope | กราฟเวลาตอบสนองมีป้ายตัวเลขแกนตั้งเป็นหน่วย ms กำกับเส้น gridline อย่างน้อย 1 จุด และ legend แยกสัญลักษณ์ "ไม่ตอบสนอง" ออกจาก "หยุดชั่วคราว" และ "ไม่มีข้อมูล" อย่างชัดเจน ใช้ความหมายเดิมของ no-response/pause/gap ใน `ResponseTimeChart`/`ResponseTimeCard` ไม่เพิ่มหมวดข้อมูลใหม่ | ตรวจ label แกนตั้งและ legend ด้วยสายตาและ accessibility tree เทียบกับชุดข้อมูลที่มีทั้งสามกรณี |
| AC-79 | Scope | มีลิงก์ "ดูประวัติการตรวจ" อยู่ที่คอลัมน์ขวาของ Detail ชี้ไปหน้าประวัติการตรวจใหม่ของมอนิเตอร์เดียวกัน และหน้าประวัติการตรวจใหม่มีลิงก์กลับมา Detail เดิม เนื้อหาตารางประวัติใช้ contract `fetchMonitorChecks`/`MonitorChecksResponse` เดิม ไม่เปลี่ยนชนิดข้อมูลต่อแถว | กดลิงก์ทั้งสองทิศทาง ยืนยัน route/breadcrumb/ไม่ reload ข้าม session |
| AC-80 | Scope | หน้าประวัติการตรวจใหม่แสดง preview จำนวนหนึ่งก่อน แล้วมีปุ่ม "โหลดเพิ่ม" เพิ่มจำนวนแถวที่แสดงต่อการกดหนึ่งครั้ง แทนเลขหน้า + ก่อนหน้า/ถัดไป เดิม ปุ่มหายไปเมื่อไม่มีแถวเพิ่ม ไม่ค้างเป็นปุ่มกดไม่ได้ (threshold และกลไกจริงตาม PD-85-03 รอ Spec) | โหลดเพิ่มซ้ำจนครบชุดข้อมูลทดสอบ ตรวจปุ่มหายไปถูกจังหวะ |
| AC-81 | State | จุดบอกข้อมูลสด "ข้อมูล ณ {time}" ที่การ์ดสถานะปัจจุบัน pulsing เฉพาะตอนข้อมูลสดจริง หยุด pulsing ทันทีเมื่อ background refetch ล้มเหลวและหน้าแสดงข้อมูลเก่าพร้อมคำเตือนเดิม ไม่ลบจุดออกทั้งหมด เพียงไม่ animate ตาม PD-85-05 | จำลอง refetch ล้มเหลวหลังโหลดสำเร็จ ตรวจ class/animation state ของจุด |
| AC-82 | Out of scope | งานนี้ไม่เปลี่ยน contract หรือวิธีคำนวณของ #57 (p50/p95/checks/failed), ไม่เพิ่ม API endpoint ใหม่, ไม่เปลี่ยน uptime/incident classification, ไม่เพิ่มฟีเจอร์เลือกโชว์/ซ่อนแต่ละ section (พิจารณาแล้วไม่เอา), ไม่เปลี่ยนหน้า Overview/Workspace | ตรวจ diff เฉพาะไฟล์ภายใต้ `apps/web/src/pages/monitors/detail/`, `apps/web/src/pages/monitors/DetailPage.tsx` และไฟล์ route ใหม่ของประวัติการตรวจ ไม่มีไฟล์ของ #57/#58/#59/#60/Workspace ถูกแก้โดยไม่จำเป็น |
| AC-83 | Authorization | หน้าประวัติการตรวจใหม่ใช้สิทธิ์อ่านเดียวกับ Detail: `owner`/`admin`/`viewer`/`auditor` ที่เป็นสมาชิกอ่านได้ non-member ของ Organization เห็น denied เหมือน Detail ตาม AC-02 (ไม่เห็นชื่อ URL หรือจำนวนมอนิเตอร์ของ Organization นั้น) id ผิด รูปแบบผิด หรืออยู่ Organization อื่นตอบ "ไม่พบมอนิเตอร์นี้" เหมือน AC-48 ทั้งสองคำตอบไม่เปิดเผยว่ามอนิเตอร์นี้มีอยู่ ไม่มีข้อมูลค้างจาก Organization อื่นหลังสลับ Organization | ทดสอบทุก read role, non-member (denied ตาม AC-02), id ผิด/ข้าม Organization ("ไม่พบมอนิเตอร์นี้" ตาม AC-48), tenant switch เหมือนรูปแบบ AC-48/AC-49 เดิม |
| AC-84 | Scope | หน้ารายละเอียดไม่มี section "ผลล่าสุดและ Assertions" (การ์ดแยกที่แสดงผลตรวจครั้งล่าสุดพร้อม assertion breakdown ของแต่ละ assertion) อีกต่อไป ผู้ใช้ยืนยันการตัดนี้แล้ว 2026-10-06 (PD-85-01) | ตรวจหน้ารายละเอียดหลัง implement ไม่พบการ์ดหรือ heading นี้ ตรวจว่าไม่มีโค้ดที่ import `LastResultCard` เหลือค้างใน `DetailPage.tsx` |
| AC-85 | Scope | หน้ารายละเอียดไม่มีตารางประวัติการตรวจ (ไม่มี `ChecksHistoryCard` เดิม) และไม่มี pagination chrome ใดๆ ที่เกี่ยวกับประวัติการตรวจอยู่ในหน้านี้อีก การดูประวัติทำผ่านลิงก์ไปหน้าใหม่ตาม AC-79 เท่านั้น | ตรวจหน้ารายละเอียดหลัง implement ไม่พบตารางหรือ `DataTablePagination` ของประวัติการตรวจ |
| AC-86 | Scope | ฟีดเหตุการณ์และเหตุการณ์ (incidents) ไม่แสดง pagination chrome (เลขหน้า/ก่อนหน้า/ถัดไป) เมื่อจำนวนแถวทั้งหมดน้อยกว่าหรือเท่ากับ threshold ที่ Technical Lead กำหนด (PD-85-02 มอบให้ Technical Lead freeze ค่าใน Spec) เมื่อเกิน threshold ยังต้องมีทางเลื่อนดูแถวที่เหลือ (รูปแบบเดิมหรือโหลดเพิ่ม เป็นการตัดสินใจทางเทคนิค) | ทดสอบด้วยชุดข้อมูลที่แถวน้อยกว่า/เท่ากับ/มากกว่า threshold ตรวจการแสดง/ซ่อน pagination chrome |
| AC-87 | Scope | Badge สถานะ "ล่ม" ของมอนิเตอร์ที่มี incident active แสดง `primary-glow` ได้ตาม COL-08/LAY-04 ที่เพิ่มใหม่ (`docs/design-system.md`) glow หยุดทันทีเมื่อ incident จบ, ถูก pause หรือ badge แสดงสถานะในอดีต (ไม่ active) badge ยังคงพื้นหลังและ label สีตาม COL-01/COL-02 เดิม ไม่เปลี่ยน | ทดสอบ badge ขณะมี incident active เทียบกับขณะ incident จบ/ถูก pause ตรวจ `box-shadow`/glow class เปลี่ยนตามสถานะ |
| AC-88 | Concurrency | หน้าประวัติการตรวจไม่แสดงแถวซ้ำและไม่ข้ามแถวที่เก่ากว่าแถวบนสุดที่โหลดไว้เมื่อมีผลใหม่ระหว่างโหลดเพิ่ม (ตัดซ้ำด้วย `scheduledFor`, รวม `urlChanges` ไม่ซ้ำ); ผลที่ใหม่กว่าการโหลดครั้งแรกไม่แสดงหลังเริ่มโหลดเพิ่ม และสรุปนับเฉพาะแถวที่แสดงโดยไม่อ้างว่าครบ; ปุ่มตาม `total` ของ response ล่าสุดและไม่วนโหลดเมื่อ chunk ว่าง; ไม่ refetch หลาย chunk; retention ตัดท้ายทำให้ปุ่มหาย; มอนิเตอร์ถูกลบหรือสมาชิกถูกนำออกระหว่างดูเปลี่ยนเป็น not-found/denied โดยไม่มีแถวค้าง; สลับ Organization ระหว่าง fetch ไม่มี response เก่าเข้าหน้าใหม่; จุด "ข้อมูล ณ" และ badge glow หยุดเมื่อ refetch detail ล้มเหลวและกลับมาเมื่อสำเร็จ | Web tests ที่ควบคุม response: insert ระหว่าง chunk, total คลาดจาก rows, chunk ว่าง, 404/403 ระหว่างโหลดเพิ่ม, tenant switch ขณะ request ค้าง, กดซ้ำเร็ว; Detail refetch error แล้วสำเร็จ |
| AC-89 | Security | หน้าใหม่ไม่มี endpoint, query, migration, grant หรือ write path ใหม่; ใช้ checked tenant/monitor predicates และ FORCE RLS เดิม; ทุก read role อ่านได้; non-member ได้ 403 `MEMBERSHIP_DENIED` และ UI denied ตาม AC-02 ด้วย body เดียวกับ Organization ที่ไม่มีอยู่; id ที่ไม่มี, รูปแบบผิด หรือข้าม Organization ได้ 404 `MONITOR_NOT_FOUND` และ "ไม่พบมอนิเตอร์นี้" เดียวกันตาม AC-48; ทั้งสองแบบไม่เปิดเผยการมีอยู่ ชื่อ Organization, URL, ชื่อมอนิเตอร์หรือจำนวน; loader ไม่ prefetch ให้ non-member; แสดงเฉพาะ `url_masked`; ไม่มี logging, credential read หรือ fresh-auth boundary ใหม่ | `read-detail.db.test.ts` access cases ด้วย runtime NOBYPASSRLS URLs, unit `path-logging.test.ts`; Web tests ทุก read role, non-member, foreign id, tenant switch และ cache หลัง denial; diff ไม่มีไฟล์ใน `apps/api`, `packages/api-contract` หรือ `packages/db` |
| AC-90 | Verification | รายงานผล #85 แยก observed pass, observed fail และ not verified ต่อ AC-75 ถึง AC-89 พร้อม source state, command, manual UI evidence และเหตุผลของ check ที่ข้าม; diff ตรวจตามช่อง verification ของ AC-82 โดยไฟล์นอก path ที่ AC-82 ระบุต้องอยู่ในรายการไฟล์ที่จำเป็นของ [Spec Design decisions](spec.md#design-decisions-85); keyboard และ screen reader สำหรับ AC-76, AC-77, AC-80; ทั้งสอง theme และ reduced motion สำหรับ AC-81, AC-87; ไม่อ้าง latency, capacity หรือ release approval | NODE-F005-85V ตาม [Spec Integrated verification](spec.md#integrated-verification-85) |

## Open decisions

ผู้ใช้ยืนยัน PD-85-01 และ PD-85-04 แล้วเมื่อ 2026-10-06 (ดู AC-84, AC-87 และ `docs/design-system.md` COL-08) PD-85-02/PD-85-03 ตัดสินแล้วโดย Technical Lead เป็น TD-85-04 และ TD-85-01/02/03 ใน [spec.md](spec.md#design-decisions-85) หลังเขียน Spec เบื้องต้น ยังพบและแก้ไข 4 จุดเพิ่มเติมจากผล code-reviewer ของ Spec (ดู Revisions): AC-75 (OD-85-01), AC-83 และ UI flow (OD-85-05), Motion principle ใน `docs/design-system.md` (OD-85-03) ผู้ใช้ยืนยันทั้งหมดแล้ว 2026-10-06 ไม่มี product-level decision ค้างที่ block เอกสารนี้อีก

## Revisions

| Date | Change | Approved by user | `acceptanceVersion` |
| ---- | ------ | ----------------- | -------------------- |
| 2026-10-06 | Draft `F-005-S10`: ลดความหนาแน่นหน้ารายละเอียด, ตัด section ผลล่าสุด, แยกหน้าประวัติการตรวจ, ตัวสลับกราฟ/ตาราง, แกนตั้ง ms + legend ไม่ตอบสนอง, live-pulse ที่ gate ด้วยความสดของข้อมูล จาก Claude Design canvas ที่ผู้ใช้ทำร่วมกับ session นี้ เพิ่ม draft AC-75 ถึง AC-86 และ PD-85-01 ถึง PD-85-05 ยังไม่มี user approval | Not yet | F-005-AC-3 (draft) |
| 2026-10-06 | ผู้ใช้ยืนยัน PD-85-01 (ตัด "ผลล่าสุดและ Assertions" ออกทั้งหมด, freeze AC-84) และ PD-85-04 (เพิ่มกติกา glow บน severity badge ที่ incident active, freeze AC-87, แก้ `docs/design-system.md` เพิ่ม COL-08 และแก้ LAY-04) มอบ PD-85-02/PD-85-03 ให้ Technical Lead ตัดสินใน Spec freeze AC-75 ถึง AC-87 ทั้งหมด สั่งให้ Technical Lead ออก Technical Spec ต่อ | Yes | F-005-AC-3 |
| 2026-10-06 | แก้ตามผล code-reviewer ของ `spec.md`: OD-85-01 แก้ AC-75 ไม่ให้ตัดข้อความ cap/ขอบช่วง/ประชากรที่ #57 AC-67/68/71 (frozen) บังคับไว้ ย่อได้แต่ตัดทิ้งไม่ได้; OD-85-03 แก้ Motion principle ใน `docs/design-system.md` ให้ระบุ COL-08 เป็นข้อยกเว้นเฉพาะของกติกา live-element-เดียวต่อ view; OD-85-04 คงไว้ตามเดิม (technical rows AC-88 ถึง AC-90 อยู่ใต้ `F-005-AC-3` จนกว่าจะอนุมัติ Spec); OD-85-05 แก้ AC-83 และ UI flow ให้ non-member เห็น denied ตาม AC-02 แยกจาก id ผิด/ข้าม Organization ที่เห็น "ไม่พบมอนิเตอร์นี้" ตาม AC-48 (เดิมเขียนรวมกันผิด) ผู้ใช้ยืนยันทั้ง 4 ข้อแล้ว | Yes | F-005-AC-3 |
| 2026-10-06 | ผู้ใช้อนุมัติ [Technical Spec](spec.md) ทั้งฉบับ รวมข้อความ UI ที่เสนอ 3 ข้อ Technical Lead ย้าย technical rows AC-88 (Concurrency), AC-89 (Security), AC-90 (Verification) จาก Spec เข้า matrix นี้โดยไม่เปลี่ยน criteria และ freeze ภายใต้ `F-005-AC-3` ตาม OD-85-04 (a) behavior rows AC-75 ถึง AC-87 ไม่เปลี่ยน ยังไม่มี start authorization หรือ release authorization | Yes, 2026-10-06 | F-005-AC-3 (frozen) |
