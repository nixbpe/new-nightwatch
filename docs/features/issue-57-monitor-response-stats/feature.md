# Issue #57 Monitor Response Stats Feature

Owner: Product Owner (behavior), Technical Lead (Concurrency/Security/Verification rows). Relocation นี้คง scope/semantics เดิม; UI flow ยังไม่มี runtime/UX verification ใหม่

| Field | Value |
| --- | --- |
| Issue | [#57](https://github.com/nixbpe/new-nightwatch/issues/57) |
| Epic | None |
| Direction | `DIR-001/v3` เดิม, extension ของ F-005 |
| Related Feature / Story | [baseline F-005](../F-005-uptime-monitor/feature.md), `F-005-S09` ไม่สร้าง Feature ID ใหม่ |
| Technical Spec | [canonical issue #57 spec](spec.md) |
| Scope approved by user | 2026-10-06, ผู้ใช้ยืนยันใช้ตามคำแนะนำและอนุมัติ spec/Acceptance matrix ของ #57 ใน session นี้ |
| acceptanceVersion | `F-005-AC-2` |
| Acceptance status | frozen, AC-63 ถึง AC-74 |
| outcome_status | Not measured |

Baseline AC-01 ถึง AC-62 และ approval/history อ่านได้จาก [baseline Feature](../F-005-uptime-monitor/feature.md#acceptance-matrix) และ [baseline Spec](../F-005-uptime-monitor/spec.md) แบบ read-only Approval ของ baseline ไม่ใช่ approval ของ issue #57

## Problem and scope

Scope/non-goals ของการอ่าน p50/p95 และ failed checks อยู่ใน [Scope and non-goals](#scope-and-non-goals) ด้านล่าง ไม่ย้าย baseline Feature ทั้งเล่ม

## Outcome

Outcome และข้อจำกัดการวัดคงตามแถว Outcome ใน [Scope and non-goals](#scope-and-non-goals)

## UI flow

Canonical flow/states ของงานนี้อยู่ใน [UI flow and states (#57)](#ui-flow-and-states-57)

## Stories

- `F-005-S09` ในฐานะสมาชิกที่มีสิทธิ์อ่าน ฉันเลือก 24 ชม., 7 วัน หรือ 30 วันใน Detail แล้วอ่าน p50/p95 และจำนวนการตรวจล้มเหลวจากข้อมูลจริง เพื่อเปรียบเทียบความช้าและความเสถียรด้วยนิยามเดียวกัน รวม loading, empty, error และ denied ตาม [Issue #57 delta](#issue-57-delta) ครอบคลุม AC-63 ถึง AC-71

## Issue #57 delta

### Identity, authority and evidence

- Parent: F-005, `DIR-001/v3` เดิม; revision ของ delta: `F-005-AC-2`, status `frozen`, Story `F-005-S09` ไม่สร้าง Feature ID ใหม่
- Canonical Technical Spec ของ delta: [issue #57 spec](spec.md#issue-57-delta); requirements และ Acceptance matrix ด้านล่างยังเป็น canonical ของ F-005-S09
- Scope/behavior เป็น delegated decision ของ Product Owner; ผู้ใช้ยืนยันใช้ตามคำแนะนำเมื่อ 2026-10-06 และอนุมัติ Technical Spec/Acceptance matrix ของ #57 ใน session นี้ จึง freeze `F-005-AC-2` เฉพาะ AC-63 ถึง AC-74 ไม่มี implementation start หรือ release authorization
- หลักฐานที่อ่าน: [issue #57 และ comments](https://github.com/nixbpe/new-nightwatch/issues/57) (OPEN, ไม่มี comments ในผล `gh issue view`), [baseline spec](../F-005-uptime-monitor/spec.md), `apps/api/src/monitors/read-service.ts` (`getResponseTimes`), `apps/api/src/monitors/uptime.ts` (`windowStart`), `packages/api-contract/src/monitor.ts`, `apps/web/src/components/ui/response-time-series.ts` (`rangeStats`) และ `apps/web/src/pages/monitors/detail/ResponseTimeCard.tsx` ที่ HEAD `292ce19` ของ branch `feature-p50-p95-7d-30d` ไม่มี customer research หรือ runtime verification ใหม่
- Issue อ้างว่า 24h คำนวณได้แล้ว สอดคล้อง code ปัจจุบัน: nearest-rank จาก point ที่ `responseTimeMs` ไม่เป็น null และนับ `fail`; 7d/30d มีเพียง hourly avg/max/checks/responseChecks และยังแสดง `PercentilesMockup` ตำแหน่งบรรทัดที่ issue อ้างเปลี่ยนไปแล้ว ใช้ชื่อ contract/function เป็นหลักฐาน
- ข้อเท็จจริงของ baseline: header/matrix ของ Feature ยังระบุ `F-005-AC-1` เป็น `draft`; spec header ระบุ `Approved`, approved by user `2026-09-29`, Delivery `Implemented` ใน `8e1ec42` (PR #49) และ Revisions มีบันทึกอนุมัติ spec ข้อความประวัติใน Feature ที่ระบุ spec ยังไม่อนุมัติจึงไม่ตรงกับ spec ปัจจุบัน งานนี้รักษาบันทึกเดิม ไม่สร้างประวัติ freeze ย้อนหลัง ไม่ reset Approved/Implemented ของ baseline และไม่ใช้ approval เดิม freeze delta นี้ TL ต้องระบุ version/status ของ delta แยกใน spec

### Scope and non-goals

- In scope: p50, p95 และ KPI “ล้มเหลว” ต่อช่วง 7d/30d ใน card เวลาตอบสนองของ Detail จากผลตรวจจริง; คง 24h คำนวณจาก points ฝั่ง client; ทำให้นิยาม percentile/fail/checks สอดคล้องตามตารางด้านล่าง; แทน mockup ของ KPI ที่ส่งมอบด้วยข้อมูลจริง
- Read permissions ใช้ AC-02, AC-48 และ AC-49: `owner`, `admin`, `viewer`, `auditor` ที่เป็นสมาชิกอ่านได้ ไม่ต้องมี write permission; non-member/ข้าม Organization ไม่มีข้อมูลรั่วทั้ง request ตรงและ UI ไม่มี write operation ใหม่
- Non-goals: percentile หรือ failed ต่อ bucket, percentile จาก hourly averages, approximate percentile, Overview KPI ใหม่, เปลี่ยน uptime/coverage/incident classification, เปลี่ยน scheduler/check executor, เปลี่ยน retention 30 วันหรือ point cap, redesign/nav/dialog ใหม่, งาน #58/#60, target latency/performance ใหม่ และการ release
- Outcome: สมาชิกอ่าน tail latency และจำนวน fail ของช่วงที่เลือกได้โดยไม่มีตัวเลข mockup ปนข้อมูลจริง สังเกตผ่าน fixture และ UI review ตาม AC-63 ถึง AC-71; baseline ของการใช้งานยังไม่ทราบ ไม่มี target เชิงตัวเลขหรือผลลัพธ์ที่วัดแล้ว

### Delegated product decisions

| ID | Decision |
| -- | -------- |
| PD-57-01 | Percentile มีหน่วย ms ประชากรคือผลตรวจที่บันทึกของ monitor เดียวใน Organization เดียวและช่วงที่เลือก ซึ่งมี `responseTimeMs` ที่วัดได้และไม่เป็น null ทุกผลมีน้ำหนักหนึ่งเท่ากัน รวม `pass` และ measured `fail` (เช่น HTTP status/assertion ไม่ผ่าน) รวม measured `check_error` หากมีค่าจริง ตามตัวกรอง non-null เดิมของ 24h ไม่ใช้ avg/max รายชั่วโมงแทนผลดิบ |
| PD-57-02 | เรียงค่าจากน้อยไปมาก ใช้ nearest-rank: p50 = ค่าลำดับ `ceil(0.50 × N)`, p95 = ค่าลำดับ `ceil(0.95 × N)` (เริ่มที่ 1) N=0 ให้ null ทั้งคู่ แสดง “ไม่มีข้อมูล”; N=1 ให้ค่าตัวเดียวทั้งคู่ ค่าซ้ำคงน้ำหนักตามจำนวนผล ห้ามแทน null ด้วย 0 หรือ timeout ที่ตั้ง |
| PD-57-03 | “ล้มเหลว” คือจำนวนผล `outcome === 'fail'` ต่อช่วง รวม timeout, DNS/TLS และ fail อื่นตาม baseline classification แม้ไม่มีเวลาตอบสนอง ไม่รวม `check_error`, pause, รอบที่พลาด หรือผล Test Configuration ที่ไม่ถูกบันทึก ไม่ใช่จำนวน incident และไม่ต้องล้มเหลวติดกันครบ 2 ครั้งจึงนับ |
| PD-57-04 | Timeout/null ไม่มีค่าทดแทนใน percentile ถ้า timeout มี `responseTimeMs` ที่วัดได้จริงให้รวมตาม PD-57-01; fail ที่ null เพิ่ม failed และ checks แต่ไม่เพิ่มประชากร percentile; `check_error` ไม่เพิ่ม failed หรือ checks และไม่ถูกแสดงว่าเป้าหมายล่ม ค่าที่วัดได้ของมันยังอยู่ในประชากร percentile ตาม PD-57-01 |
| PD-57-05 | KPI “จำนวนการตรวจ” (checks) หมายถึงจำนวนผล `pass` + `fail` ที่บันทึกในชุดของช่วงนั้น ไม่รวม `check_error` ใช้ทุกช่วง การปรับ 24h จากเดิม `points.length` ให้ตัด `check_error` เป็น delta ที่ตั้งใจเพื่อให้ตรงกับ 7d/30d เดิม ไม่เปลี่ยนข้อมูล point หรือประวัติการตรวจ คำอธิบายระบุ checks ไม่นับปัญหาฝั่งระบบ และ percentile นับเฉพาะค่าที่วัดได้ |
| PD-57-06 | ใช้เวลาฝั่ง server เป็นขอบช่วง T การเลือกประชากรใช้ `scheduled_for` ไม่ใช้ `checked_at` (ซึ่งยังเป็นเวลาที่แสดงจุด) 24h เริ่ม T−24h; 7d/30d เริ่ม `ceilUTC-hour(T−7d/30d)` ถ้าตรงขอบชั่วโมงอยู่แล้วไม่ขยับ รวมขอบเริ่ม ไม่รวมผลที่ scheduled หลัง T; รวมผลที่ scheduled ตรง T เมื่อบันทึกและมองเห็นในการอ่านนั้น ชั่วโมงปัจจุบันรวมเฉพาะผลที่มีแล้ว ไม่คาดคะเนผลในอนาคต ทุก KPI ในการอ่านเดียวกันต้องใช้ขอบช่วงเดียวกัน ไม่ใช่วันปฏิทินตาม timezone ของ browser |
| PD-57-07 | 7d/30d ใช้ผลตรวจจริงที่ยังเก็บอยู่ทั้งหมดในช่วง ไม่มี cap 1,440 แบบ 24h; กราฟยังเป็น hourly buckets ที่เริ่มจากขอบเดียวกันและรวมชั่วโมงปัจจุบัน คำอธิบายต้องบอกว่า 7d/30d ปัดขอบเริ่มเป็นชั่วโมง UTC และแสดงขอบเวลาที่ใช้จริง เวลาแสดงใช้ timezone เดิมของหน้า ไม่เปลี่ยน window เมื่อเปลี่ยน timezone |
| PD-57-08 | 24h คง newest ไม่เกิน `MONITOR_RESPONSE_POINTS_MAX = 1440` ตาม `scheduled_for` ก่อนคำนวณ KPI ทุกตัวจาก point ชุดนั้น กรณีชน cap ให้แสดง “คำนวณจากผลตรวจล่าสุดไม่เกิน 1,440 รายการ” ไม่อ้างว่าครอบคลุมผลทั้งหมดใน 24h parity คือสูตร ประชากรที่เข้าเกณฑ์และ classification เดียวกันภายในชุดที่เลือก ไม่รับรองขนาดประชากรหรือขอบเวลาเหมือนกันทั้งสามช่วง |
| PD-57-09 | ไม่มีผล pass/fail: checks=0, failed=0; ไม่มีเวลาที่วัดได้: p50/p95 เป็น null ทั้งที่ checks/failed อาจมากกว่า 0 ค่าศูนย์ของ fail เป็นจำนวนจริงของข้อมูลที่อ่านสำเร็จ ไม่ใช่เครื่องหมายว่าสุขภาพเป็น UP ต้องคง unknown/paused/gaps และเหตุผลเดิมของ Detail |

ตัวอย่างขอบช่วง: ถ้า T=`2026-06-30T10:30:00Z` 7d เริ่ม `2026-06-23T11:00:00Z`, 30d เริ่ม `2026-05-31T11:00:00Z`; ถ้า T ตรง `10:00:00Z` ขอบเริ่มยังเป็น `10:00:00Z` ของวันที่ลบช่วงนั้น ผลที่ scheduled ก่อนขอบแต่ checked หลังขอบไม่เข้าชุดนี้ ผลที่ scheduled อยู่ในช่วงแต่ checked หลัง T เข้าชุดเมื่อบันทึกและมองเห็นในการอ่านนั้น ไม่มีการสร้างผลย้อนหลังให้ช่วง pause/gap หรือก่อนสร้าง monitor

### UI flow and states (#57)

ใช้ Detail และ card เวลาตอบสนองเดิม ไม่เพิ่ม route, dialog หรือ flow ใหม่

1. สมาชิกเปิด Detail เลือก `24 ชม.` (ค่าเริ่มต้น), `7 วัน` หรือ `30 วัน` ผ่าน control เดิม โฟกัสค้างที่ตัวเลือก
2. โหลดข้อมูลช่วงที่เลือก แล้วแสดง p50/p95 หน่วย ms, “จำนวนการตรวจ” และ “ล้มเหลว” เป็นข้อมูลจริงพร้อมคำอธิบายประชากร/ขอบช่วงตาม PD-57-01 ถึง PD-57-09 กราฟ/ตาราง hourly avg/max ยังคงเดิม ไม่เปลี่ยนชื่อ avg เป็น percentile
3. อ่านสรุปข้อความหรือเปิดตารางทางเลือกได้ด้วย keyboard; ไม่จำเป็นต้องใช้ tooltip เพื่ออ่าน KPI

| Screen | State | Behavior and recovery |
| ------ | ----- | --------------------- |
| Detail response-time card | Loading / range switch | แสดง “กำลังโหลดกราฟเวลาตอบสนอง” พร้อม loading/skeleton ของ KPI ไม่แสดง 0 หรือ KPI ของช่วงก่อนเป็นข้อมูลช่วงใหม่ โฟกัสค้างตัวเลือก |
| Detail response-time card | Success | สี่ KPI ตรงช่วงที่เลือก ไม่มี `PercentilesMockup`/ตัวอย่างแทน KPI ที่ส่งมอบ คงกราฟ สรุป และตารางเดิม แสดงขอบช่วงและข้อจำกัด 24h |
| Detail response-time card | Empty / all-null / paused | แสดง p50/p95 “ไม่มีข้อมูล” เมื่อ N=0 แสดง checks/failed ตามผลจริง (0 เมื่อไม่มี) คง “ยังไม่มีผลการตรวจ”, “ไม่มีผลใน {ช่วง}” หรือ “หยุดชั่วคราวตลอดช่วง ไม่มีการตรวจ” ตามกรณี all-timeout แสดงจำนวน fail จริง ไม่มี percentile ปลอม |
| Detail response-time card | Initial error | “โหลดกราฟเวลาตอบสนองไม่สำเร็จ” + “ลองอีกครั้ง” ไม่มี KPI ที่ดูเป็นผลสำเร็จ หน้าและ section อื่นยังใช้ได้ |
| Detail response-time card | Refetch error | คงข้อมูลเฉพาะช่วงและ Organization เดิมพร้อม “อัปเดตกราฟไม่สำเร็จ” และเวลาของข้อมูลที่ยังแสดง ให้ลองอีกครั้งได้ ไม่ทำข้อมูลเก่าดูเป็นข้อมูลปัจจุบัน |
| Detail response-time card | Denied / not found / tenant switch | denied/not-found ตาม Detail และ AC-48/AC-49 ห้ามแสดง KPI ค้างจาก Organization ก่อน หรือเปิดเผยข้อมูล monitor ของ Organization อื่น |
| Detail response-time card | Accessibility | KPI มี label/value/หน่วยเป็นข้อความ screen reader อ่านได้ คำอธิบาย p50/p95 และ null อยู่ในเนื้อหา ตัวเลือกใช้ Tab/ลูกศรตาม radiogroup เดิม โฟกัสไม่ย้ายเมื่อโหลด/ผิดพลาด ประกาศสรุปการเปลี่ยนช่วงแบบ polite ครั้งเดียวหลังผู้ใช้เลือก ไม่ประกาศทุก auto-refetch ใช้ตารางและ keyboard กราฟเดิมตาม AC-15/AC-22 ไม่มี dialog เพิ่ม |

### Acceptance matrix (#57 delta)

`acceptanceVersion: F-005-AC-2`, status `frozen` เฉพาะ AC-63 ถึง AC-74 ตามการอนุมัติผู้ใช้ 2026-10-06; AC-63 ถึง AC-71 เป็น behavior rows ของ Product Owner, AC-72 ถึง AC-74 เป็น technical rows ของ Technical Lead สำหรับ F-005-S09 AC-01 ถึง AC-62 และประวัติ `F-005-AC-1` ไม่เปลี่ยน Freeze ไม่ใช่ implementation start หรือ release authorization

| AC | Category | Observable behavior | Verification |
| -- | -------- | ------------------- | ------------ |
| AC-63 | Scope | สมาชิกเลือกทั้งสามช่วงใน Detail แล้วเห็น p50/p95 ms, checks และ failed จากข้อมูลจริงตาม PD-57-01 ถึง PD-57-09; 7d/30d ไม่มี percentile mockup หรือตัวเลขตัวอย่างแทนผลจริง คง chart/table เดิม | fixture เดียวต่อช่วง ตรวจ KPI และการหายไปของ mockup |
| AC-64 | Scope | Percentile ใช้ non-null measured responseTimeMs ต่อผลและ nearest-rank ตาม PD-57-01/02/04 ไม่ใช่ percentile ของ hourly avg; ไม่มีค่าเป็น null ตัวเดียวให้ p50=p95 ค่าซ้ำมีน้ำหนักตามจำนวนจริง | ชุดค่ามือ [10,20,30,40] ให้ p50=20, p95=40; N=0/1/ค่าซ้ำ; ชั่วโมงที่มีจำนวนผลต่างกัน |
| AC-65 | Scope | failed นับ fail ทุกประเภทต่อช่วง รวม timeout และ null-response fail ไม่รวม check_error, Test Configuration, pause/gap หรือจำนวน incident; measured fail อยู่ใน percentile ส่วน null ไม่ถูกแทนด้วย timeout/0 | pass/fail HTTP/assertion/timeout/null/check_error ผสม รวม fail ครั้งเดียวที่ไม่เปิด incident |
| AC-66 | Scope | checks คือ pass+fail ทุกช่วงตาม PD-57-05 (24h ตัด check_error ออกจากจำนวนเดิม); ชุด all-timeout ให้ checks=failed มากกว่า 0 และ p50/p95 “ไม่มีข้อมูล”; ชุด check_error-only null ให้ checks=failed=0 คง “ตรวจไม่ได้” ไม่แสดง UP | fixture all-timeout, check_error-only, measured check_error และชุดผสม |
| AC-67 | Scope | ขอบช่วง/เวลาอ้างอิงตาม PD-57-06/07: scheduled_for กำหนดสมาชิก รวมขอบเริ่มและผลที่ scheduled ตรง T ที่มองเห็น ไม่รวม scheduled หลัง T; 7d/30d ปัดขึ้น UTC-hour และรวมชั่วโมงปัจจุบัน ทุก KPI ในการอ่านเดียวกันใช้ขอบเดียวกัน แสดงขอบจริงและการปัด UTC-hour | T ตรงชั่วโมง/กลางชั่วโมง; ก่อน/ตรง/หลัง start และ T; scheduled กับ checked ข้ามขอบ; timezone ต่างกัน; monitor อายุสั้นกว่า window |
| AC-68 | Scope | 24h คำนวณ KPI จาก newest points ไม่เกิน 1,440 พร้อมข้อความ cap เมื่อชน cap; 7d/30d คิดทั้งช่วงที่ยังเก็บโดยไม่มี cap นี้ parity จำกัดตาม PD-57-08 ไม่มีการอ้างผลเกินชุดหรือเติม missing เป็น pass | มากกว่า 1,440 ผลใน 24h และช่วงยาว, pause/gap, retention edge; ตรวจข้อความ cap |
| AC-69 | Authorization | read roles ทั้งสี่ดู KPI ได้โดยไม่มี write permission; non-member/monitor id ผิดหรือข้าม tenant ถูกปฏิเสธตาม AC-02/48/49 ไม่มีข้อมูล KPI ค้างหลังสลับ Organization หรือเสีย membership | UI/request ตรงทุก read role, non-member, cross-tenant และ tenant switch |
| AC-70 | State | loading/empty/all-null/paused/error/refetch-error/denied/success ตาม state table #57; สลับช่วงไม่ติด KPI เก่า under label ใหม่ failure ไม่กลายเป็น empty/0 ข้อมูลเก่าใน refetch failure มี warning กับเวลาและลองใหม่ได้ | จำลองทุก state รวมเลือกช่วงเร็วและ refetch ล้มหลังมีข้อมูล |
| AC-71 | Accessibility | KPI/หน่วย/ประชากร/ขอบช่วง/null อ่านได้เป็นข้อความ ใช้ keyboard เลือกช่วงและเปิดตารางได้ โฟกัสคงเดิม ประกาศเฉพาะผู้ใช้เปลี่ยนช่วงตาม state table คงกราฟและตารางทางเลือก AC-15/22 ไม่มี dialog ใหม่ | keyboard และ screen reader manual review ทั้งสามช่วงและ null/error |
| AC-72 | Concurrency | response-times ของ #57 ใช้ statement snapshot เดียวสำหรับ KPI/buckets/events/status เมื่อ Worker insert, purge, pause/resume หรือ delete ชนกับ read เห็น committed state ก่อนหรือหลังได้ แต่ไม่ผสม population ของ summary กับ buckets; membership removal ที่ commit ก่อน authorization ถูกปฏิเสธ ถ้า read ได้ organization lock ก่อน removal การอ่านที่ authorized อาจจบก่อน removal commit และรอบถัดไปต้อง denied; ขอบ T และ pause state ใช้ตาม delta contracts | controlled interleaving insert/purge/pause/resume/delete รอบ statement และ membership removal รอบ organization lock; ตรวจ before/after outcomes, summary/bucket counts และ pause หลัง T ไม่ทำให้ infer หยุดทั้งช่วงผิด |
| AC-73 | Security | ทุก raw/aggregate read ของ #57 ใช้ checked tenant/monitor predicates และ transaction-local context/client เดียว, runtime non-owner NOBYPASSRLS และ existing FORCE RLS/grants ตาม DB-01/02/03/04/09; A มองไม่เห็น B และ missing context ไม่เปิดเผยผล; denials/errors/logs ไม่เปิดเผย protected inputs หรือ raw samples ตาม REQ-05/OPS-01, ไม่มี credential read/decrypt หรือ fresh-auth boundary ใหม่ | runtime catalog role/grants/FORCE RLS checks, direct A/B/no-context SELECT และ route denial พร้อมค่าทดสอบที่รู้ค่าใน errors/logs; ไม่ใช้ owner role เป็นหลักฐาน runtime isolation |
| AC-74 | Verification | รายงานผลตรวจ #57 แยก observed pass/observed fail/not verified ต่อ AC-63 ถึง AC-73 พร้อม source state/command/manual UI evidence และ skipped reasons; generated-client drift และ required DB/RLS/security checks มีผลตรวจจริง; query plan/timing ของ 7d/30d เป็น diagnostic-only ไม่อ้าง latency target, production capacity หรือ release approval จาก evidence นี้ | 57V integrated proof ตาม delta spec/Quality README: focused unit/DB/UI tests, codegen:check, full validation/coverage/security และ keyboard/screen reader notes; EXPLAIN (ANALYZE, BUFFERS) บน task-owned fixtures พร้อม plan/rows/time/spill แยกจาก acceptance claims |

### Decisions, dependencies and readiness (#57)

Product open decisions: None สำหรับ delta นี้ scope/behavior ด้านบนตัดสินภายใต้อำนาจที่ผู้ใช้มอบ ข้อ OD-21/OD-22 และ dependencies ของ baseline คงเป็นบันทึกเดิม ไม่อ้างว่าเป็น blocker ใหม่ของ #57

| Predecessor | Dependent | Required input | Owner | Ready condition |
| ----------- | --------- | -------------- | ----- | --------------- |
| PD-57-01 ถึง PD-57-09 และ frozen AC-63 ถึง AC-71 | TL drafting spec สำหรับ F-005-S09 | นิยามประชากร ขอบช่วง cap และ states | Product Owner (delegated ใน session) | พร้อมใน delta นี้ |
| Existing response-times read contract และ retained results | F-005-S09 technical planning | contract/fixture ที่อ่านได้ตามสิทธิ์ tenant และ window ที่กำหนด | Technical Lead | หลักฐาน source ตรวจแล้ว; TL ระบุวิธีให้ KPI กับ buckets ใช้ประชากร/ขอบช่วงที่สอดคล้องใน spec |
| Delta Technical Spec approval | Freeze ของ F-005-AC-2 | Approved spec และคำยืนยันใช้ตามคำแนะนำใน session นี้ | ผู้ใช้ ผ่าน Technical Lead | อนุมัติและ freeze แล้ว 2026-10-06; implementation start แยกได้รับแล้วผ่าน implement-issue ตาม Spec |

Technical decisions TD-57-01 ถึง TD-57-04 และ contracts ใน [Spec](spec.md#design-decisions-57) ได้รับอนุมัติ 2026-10-06: exact raw-query nearest-rank, scoped single-statement snapshot, response clock/window และ required long-range summary/max721 ไม่มี technical OD ค้าง Query cost เป็นความเสี่ยงและแผนวัดตอน implementation; rolling deployment/browser compatibility เป็นข้อกำหนดแผน release ไม่ใช่หลักฐานว่าผ่านแล้ว

Verification plan ที่เสนอ: TL map AC ใหม่ไป contract/unit/DB/UI tests; ใช้ fixture nearest-rank, unequal hourly populations, measured fail, timeout/null/check_error, boundary UTC-hour, retention/young monitor/pause, cap overflow และ permissions; ตรวจ loading/error/range-switch/mockup removal พร้อม keyboard/screen reader ตรวจ baseline regression AC-14/15/22/39/48/49 ไม่ใช่หลักฐานว่าผ่านแล้ว

Readiness: spec Approved และ matrix `frozen` ตามคำยืนยันผู้ใช้ 2026-10-06 ไม่มี product/technical OD ค้าง implementation start แยกได้รับแล้วผ่าน implement-issue ตาม Spec; ยังไม่มี runtime proof หรือ release approval ความเสี่ยงคงเหลือ: query cost/snapshot ยังไม่ตรวจ runtime, cap ทำให้ 24h เป็น subset, baseline approval/status ไม่ตรงกันตามประวัติ และยังไม่มี runtime/UI verification การวัด query cost เป็น diagnostic-only ไม่รับรอง production capacity; rolling deployment/browser compatibility ต้องระบุในแผน release แยก


## Open decisions

None. คำตัดสินและ readiness อยู่ใน [Decisions, dependencies and readiness (#57)](#decisions-dependencies-and-readiness-57); approval และขอบเขต implementation/release อยู่ใน [Spec](spec.md#open-decisions-57)

## Revisions

| Date | Change | Approved by user | `acceptanceVersion` |
| --- | --- | --- | --- |
| 2026-10-06 | ผู้ใช้ยืนยันใช้ตามคำแนะนำ อนุมัติ scope/spec และ freeze AC-63 ถึง AC-74 โดยไม่เปลี่ยน criteria; ปิด OD และเก็บ query cost/deployment compatibility เป็นความเสี่ยงและแผนตรวจ; ยังไม่อนุญาต implementation start หรือ release | 2026-10-06, คำยืนยันใน session นี้ | F-005-AC-2 (frozen) |
