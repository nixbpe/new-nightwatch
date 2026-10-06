# Issue #57 Monitor Response Stats Technical Spec

Owner: Technical Lead. Canonical Technical Spec ของ issue #57 สำหรับ F-005-S09; requirements และ AC-63 ถึง AC-74 อยู่ใน [Issue #57 Feature](feature.md#acceptance-matrix-57-delta), baseline Approved/Implemented อยู่ใน [F-005 Spec](../F-005-uptime-monitor/spec.md) ไม่สร้าง Feature ID ใหม่

## Issue #57 delta


เพิ่ม exact p50/p95 และ failed count ต่อช่วง 7d/30d พร้อมนิยาม 24h ตาม [F-005-S09 และ delta Acceptance matrix](feature.md#issue-57-delta) โดยเปลี่ยนเฉพาะ response-times read และ UI ที่ใช้ข้อมูลนี้

| Field | Value |
| --- | --- |
| Feature | F-005, Story F-005-S09, `acceptanceVersion` F-005-AC-2 ([Feature](feature.md#acceptance-matrix-57-delta), frozen) |
| Status | Approved (เฉพาะ #57; baseline Approved/Implemented ใน F-005 spec คงเดิม) |
| Approved by user | 2026-10-06, ผู้ใช้ยืนยันใช้ตามคำแนะนำใน session นี้; freeze F-005-AC-2 |
| Start authorization | 2026-10-06, ผู้ใช้เรียก poteto-mode และ implement-issue สำหรับ #57 ใน session นี้ |
| `COMMIT_MODE` | owned-slice |
| `STOP_AT` | merge-ready (PR ต้องยังไม่ merged; ไม่อนุญาต release) |
| Delivery | Not implemented |

Product decisions PD-57-01 ถึง PD-57-09 และ technical design TD-57-01 ถึง TD-57-04/contracts ด้านล่างได้รับอนุมัติจากคำยืนยันใช้ตามคำแนะนำของผู้ใช้ 2026-10-06 ใน session นี้ Acceptance matrix `F-005-AC-2` เฉพาะ AC-63 ถึง AC-74 เป็น `frozen`; ไม่ใช้ approval ของ baseline ย้อนหลัง การอนุมัติ spec ไม่อนุญาต implementation start หรือ release ด้วยตัวเอง; คำสั่ง implementation แยกระบุใน Start authorization ด้านบน ข้อความ baseline ที่ Feature ยัง draft แต่ spec Approved เป็น record inconsistency ที่รักษาไว้

อ่าน [Contracts](#contracts-57), [Design decisions](#design-decisions-57), [Tasks](#tasks-57), [verification](#integrated-verification-57) และ [Open decisions](#open-decisions-57) สำหรับ delta นี้เท่านั้น

Source inspection ที่ HEAD `292ce19`: `getResponseTimes`/`readInTenant` ใน `apps/api/src/monitors/read-service.ts`, `windowStart` ใน `uptime.ts`, `monitorResponseTimesResponseSchema` ใน `packages/api-contract/src/monitor.ts`, `rangeStats`/`toChartProps` และ `ResponseTimeCard` ใน Web; `run-check.ts` คืน timeout ms null และ measured HTTP/assertion fail เป็น elapsedMs, `record-result.ts` เขียน raw/rollup ใน transaction เดียวและไม่ rollup check_error; `0016_uptime_monitors.sql` มี raw PK/partition/RLS/grants และ hourly checks/passed/sum/max/response_checks ตรวจ issue ล่าสุดผ่าน `gh issue view 57` ไม่มี comments การตรวจ source นี้ไม่ใช่ runtime proof ข้อความ issue เรื่อง grep percentile/line refs เก่าไม่ตรง current code ให้ใช้ symbols ข้างต้น

### Contracts (#57)

#### API (#57)

คง operation `GET /api/organizations/{organizationId}/monitors/{monitorId}/response-times?range=24h|7d|30d`, default `24h` และ error envelopes เดิม เพิ่ม required metadata ทุก branch และ required summary เฉพาะ long-range branch ใน `monitorResponseTimesResponseSchema`:

| Branch / field | Wire type / invariant |
| --- | --- |
| all: `dataAsOf` | ISO datetime, T ฝั่ง server ของ response-times request นี้ ไม่ยืมเวลาอ่าน Detail |
| all: `window` | `{ from: ISO datetime, to: ISO datetime }`, `to = dataAsOf`, `from = windowStart(range,T)` ตาม PD-57-06 รวมทั้งสองขอบสำหรับ scheduled population |
| 24h | `points`/`gaps`/`pauses`/`configChanges`/`unit` เดิม ไม่มี summary จาก API; points ไม่เกิน 1440, KPI คำนวณ client จาก points ชุดนี้ |
| 7d/30d: `summary` | `{ p50Ms: integer|null, p95Ms: integer|null, checks: nonnegative integer, failed: nonnegative integer }`, required แม้ไม่มีผล, `0 <= failed <= checks` |
| 7d/30d: `buckets` | `{ hourStart, avgMs: number|null, maxMs: integer|null, checks, responseChecks }` เดิม ไม่มี percentile/failed ต่อ bucket; chronological, empty hour เป็น counts 0 และ avg/max null |
| long-range bucket count | ปกติ 168/720; T ตรง UTC hour ให้รวม bucket ที่เริ่มตรง T จึงมากสุด 169/721, schema `.max(721)` แทน `.max(720)` เพื่อไม่ทิ้งผล scheduled=T |

Zod ใช้ `.int()` สำหรับค่าที่มาจาก stored integer ms (ยอมรับ 0 เป็น measurement จริง), nullable สำหรับ percentile, counts `.int().min(0)` และ shape รองรับ OpenAPI generation ไม่มีค่าที่ใช้ placeholder success ตรวจ `failed <= checks` ใน focused contract/API tests; ไม่เพิ่ม refinement ที่ทำให้ generated wire shape แตกต่างจาก runtime shape

`window` แสดง measurement bounds ไม่ได้อ้าง complete coverage ของ monitor ที่อายุน้อย/มี gap/cap; `dataAsOf` คือ boundary clock ไม่ใช่ guarantee ว่าไม่มี result commit หลัง T ก่อน statement snapshot อ้างข้อมูลที่บันทึกและมองเห็นใน read statement ตาม PD-57-06

คง `401 UNAUTHENTICATED`, verification/session errors เดิม, `403 MEMBERSHIP_DENIED`, `404 MONITOR_NOT_FOUND` สำหรับ missing/malformed/foreign monitor และ `400 INVALID_INPUT` สำหรับ unsupported range ตรวจพบจาก current routes/tests; DB/unknown failure คืน standard generic error, ห้ามแปลงเป็น summary ศูนย์ ไม่เพิ่ม write route หรือ query parameters ที่ให้ client เลือก tenant/window clock เอง

#### Data and query (#57)

เลือก raw-query exact nearest-rank ใน PostgreSQL ต่อ monitor เดียว ใช้ existing `monitor_check_results` partitioned by scheduled_for และ PK `(monitor_id, scheduled_for)` ไม่สร้าง table/column/index/function/migration และไม่แก้ Worker/rollup/retention

Population ของทั้ง points และ long-range summary: bind `monitor_id`, checked `tenant_id`, start, T; predicate `scheduled_for >= start AND scheduled_for <= T` บน partition key ไม่ใช่ `checked_at` และไม่กรอง config version เพื่อรักษาประวัติข้ามการแก้ config ตาม baseline ห้ามเติมผลก่อนสร้าง monitor, pause, missed slot หรือ Test Configuration

- 24h: scoped raw rows `ORDER BY scheduled_for DESC LIMIT MONITOR_RESPONSE_POINTS_MAX`; cap ก่อนกรอง outcome/null ทุก KPI จึงใช้ subset เดียวกัน คืน points ascending scheduled_for เช่นเดิม `at=checked_at` แม้ checked_at ต่างจาก T/ขอบช่วง PK ทำให้ scheduled_for ต่อ monitor ไม่เสมอกัน จึงไม่ต้องเพิ่ม tie-breaker หรือสุ่มเลือก
- 7d/30d: scoped raw CTE ไม่ cap; `percentile_disc(ARRAY[0.50,0.95]) WITHIN GROUP (ORDER BY response_time_ms)` จาก non-null ms ทุก outcome (รวม measured check_error) คืน stored sample integer ไม่ interpolate; empty population คืน null ทั้งคู่ ไม่ `coalesce` เป็น 0
- summary checks = count pass+fail; failed = count fail จาก raw CTE เดียวกัน จึงรวม null-response failure แต่ไม่รวม check_error; convert pg count/bigint เป็น JSON integer ที่สอดคล้อง schema ห้ามคืน numeric string
- buckets derive จาก CTE เดียวกัน โดย group UTC hour ของ scheduled_for และเฉพาะ pass+fail เหมือน rollup เดิม: checks=count, responseChecks=count(non-null ms), avgMs=round(sum(ms)/responseChecks,2), maxMs=max(ms); ไม่มี response ให้ avg/max null เติม empty UTC hours ตั้งแต่ start ถึง floorUTC-hour(T) รวม current hour
- ใช้ UTC ที่ explicit ใน SQL hour expression ไม่ขึ้นกับ session timezone; bucket ปัจจุบันเป็นเฉพาะ visible rows <=T ไม่ใช้ scheduled ในอนาคตหรือ forecast ถ้า T ตรง hour bucket สุดท้ายมีช่วงการสังเกตยาว 0 ณ instant T แต่ยังมีผลตรง T ได้
- summary measured check_error อาจทำให้ percentile มีค่าในชั่วโมงที่ bucket checks=0/avg=null; เป็นประชากรที่ product ตั้งใจต่างกัน ไม่แอบเพิ่ม check_error เข้า graph rollup semantics หรือเปลี่ยน health

Dataflow: request/session → `readInTenant` membership/read permission และ transaction-local tenant context → clock T → หนึ่ง scoped SQL statement สำหรับ monitor status, pause/config events ที่จำเป็น และ response-time raw population → bounded payload mapping/derivePauses/computeGaps เดิม → Zod/OpenAPI wire → scoped query cache → client 24h KPI หรือ long summary KPI

ใช้ monitor-scoped CTE เป็น gate ของ statement เดียว: monitor ไม่พบตอบ not-found แยกจาก monitor ที่พบแต่ raw population ว่าง เก็บ event masking/order/inference ของ pause เดิม แต่ filter events ที่อยู่ใน displayed window ไม่ให้ configChanges หลัง T ปรากฏ การโหลด pause history ที่จำเป็นสำหรับ infer state ก่อน start ยังคง existing behavior ถ้ามี pause/resume commit หลัง T แต่ก่อน statement snapshot ให้โหลด events หลัง T เฉพาะเพื่อย้อนสถานะ paused/active ของ monitor กลับ ณ T ก่อน derivePauses แล้วตัด payload intervals ที่ T ไม่ใช้ current paused status กับ history ที่กรอง events หลัง T ทิ้งจนอนุมานว่าหยุดทั้งช่วงผิด SQL statement รวม events/status กับ result reads ให้ snapshot เดียว; ไม่แก้ `readInTenant` หรือ tenant helper ให้ทุก route เปลี่ยน isolation level

#### Authorization, RLS and concurrency (#57)

รักษา [Architecture](../../architecture.md) DB-01 ถึง DB-04, DB-09, REQ-02/03/05 และ WEB-01 ถึง WEB-04:

- require verified session และ read permission สำหรับ owner/admin/viewer/auditor ก่อน tenant data; recheck membership ภายใน `readInTenant` ภายใต้ organization `FOR SHARE` เช่นเดิม non-member ไม่เห็น aggregates, count, masked URL หรือ monitor existence
- ทุก query/CTE/filter มี tenant_id และ monitor_id แม้ PK นำด้วย monitor_id; ใช้ client transaction เดียวกับ context ห้ามใช้ pool query, owner role, SECURITY DEFINER หรือ cross-tenant cache เพื่อเร่ง percentile
- existing raw/hourly tables มี ENABLE/FORCE RLS, restrictive context policies และ runtime grants ใน `0016_uptime_monitors.sql`; delta ใช้ raw SELECT grant เดิม ต้องทดสอบ direct RLS denial ด้วย runtime NOBYPASSRLS ทั้ง A/B/missing context ไม่ถือ source inspection เป็น runtime proof
- organization lock/rechecked permission เดิมทำให้ membership removal ที่ commit ก่อน authorization ถูกปฏิเสธ; ถ้า read ได้ lock ก่อน mutation การอ่านที่ authorized อาจจบก่อน removal commit รอบถัดไปต้อง denied, UI clear cache ตาม WEB-03
- SQL statement snapshot เดียวทำให้ KPI/buckets/events/status เห็น committed version เดียวเมื่อ Worker insert/pause/delete/purge ชนกัน; read เห็น before หรือ after commit ได้แต่ห้าม summary ก่อนและ buckets หลังใน response เดียว Worker writes result+rollup atomically ตาม source แต่ delta ไม่พึ่ง rollup snapshot
- ไม่เพิ่ม monitor row/advisory locks หรือเปลี่ยน lock order; read ไม่ block checker writes ด้วย row locks แต่ยังมี MVCC/table locks ปกติ Partition DDL อาจรอ transaction, ใช้ existing owner runner lock_timeout ไม่ปรับ platform ในงานนี้
- T จาก DB clock ที่ existing driver แปลงเป็น Date ให้ normalize/bind millisecond instant เดียวกับ `dataAsOf`/`window.to`; ไม่ serialize microsecond T อีกค่าหนึ่งที่ predicates ไม่ได้ใช้ Long query ไม่ทำ JavaScript sort ของผลดิบใน transaction (REQ-01); SQL aggregate ทำใน database, web sort เฉพาะ capped 24h points
- ไม่มี credential read/decrypt, outbound calls, audit mutation หรือ fresh-auth boundary ใหม่; logs/denials คง existing redaction ห้าม log raw samples/SQL parameters/config/URLs/response body เพิ่มเพื่อวัด query cost

#### Web (#57)

ใช้ route/component เดิม, `monitorQueryKeys.responseTimes(organizationId,monitorId,range)`, identity-owned cache และ refetch interval เดิม `fetchMonitorResponseTimes` runtime-validate schema ที่เพิ่ม metadata/summary (WEB-01/02) generated client regenerate จาก API จริง

- `rangeStats` 24h ยัง nearest-rank จาก non-null points แต่ checks ตัด check_error, failed นับ fail; 7d/30d รับค่าจาก `response.summary` ไม่ใช้ bucket avg/max หา percentileหรือ derive count จากชุดอื่น
- `toChartProps` ใช้ `response.window` ไม่สร้าง window จาก Detail `dataAsOf` อีก ใช้ context เฉพาะ intervalSeconds/createdAt; long current bucket endAt ให้ไม่เกิน window.to ตรวจ chart/table edge T ตรง hour และ points ที่ checked_at ข้ามขอบโดยไม่ใช้ chart clipping เปลี่ยน population KPI
- `ResponseTimeCard` แสดง grid สี่ KPI ทุกช่วง แสดงคำอธิบาย non-null/target checks, scheduled window, ขอบเวลาจริงพร้อม timezone เดิมของหน้า และ long-window rounding UTC-hour ตาม [UI states](feature.md#ui-flow-and-states-57) ใช้ label/value/หน่วยเป็นข้อความตาม TYP-04/CMP-05
- 24h เมื่อ points.length เท่ากับ cap ให้แสดงข้อความ cap ที่ PO กำหนด แม้จำนวน rows ทั้งช่วงพอดี 1440 ไม่ต้อง query total/truncated flag ใหม่; checks อาจน้อยกว่า cap เพราะ check_error ห้ามอ้าง checks เป็นจำนวน points ทั้งหมด
- เอา `PercentilesMockup` ของ #57 ออกพร้อม import/export/function ที่การเปลี่ยนนี้ทำให้ unused เท่านั้น ไม่แก้ mockup ของ issue อื่น และไม่แทน empty/error ด้วยตัวอย่าง
- loading ใหม่/range switch มี KPI skeleton; ไม่มี keepPreviousData/placeholderData ที่ติด label ใหม่ API failure ไม่ใช่ค่าศูนย์; refetch failure คงเฉพาะ same-key data พร้อม warning, response.dataAsOf และ retry action ทุกกรณี
- membership denied/not-found ต้องเลือก security error state ก่อน render cached data, ซ่อน KPI/graph ค้างและใช้ Detail error mapping เดิม แม้ React Query ยังถือ data จาก success ก่อนหน้า in-flight response ของ org/range เก่าห้ามเข้าหน้าใหม่
- polite announcement ครั้งเดียวต่อ user range selection ที่ latest request สำเร็จ (รวม empty) ไม่ย้าย focus, ไม่ประกาศ auto-refetch/retries เป็น range selection ใหม่; null/error/denied labels อ่านได้โดยไม่ tooltip ทดสอบ rapid selection superseded response ไม่ประกาศผิดช่วง คง chart keyboard และ table control ตาม AC-15/22

### Design decisions (#57)

| ID | Approved technical choice / tradeoff |
| --- | --- |
| TD-57-01 | SQL exact `percentile_disc` nearest-rank จาก raw; averages/maxima หรือ hourly percentile รวมกันไม่ได้ exact range percentile; sketch/histogram approximation ขัด non-goals; exact per-hour sample storage ซ้ำ raw และเพิ่ม migration/write/backfill ที่ไม่จำเป็น |
| TD-57-02 | summary counts และ response-time buckets จาก scoped raw statement เดียว Rollup `sum(checks-passed)` คำนวณ failed ได้สำหรับ full-hour population ปกติ แต่ rollup ไม่มี per-result <=T และไม่รับรอง retained raw population เมื่อ purge/drift จึงไม่เลือก mixed-source summary; uptime/Overview ยังใช้ rollup เดิม ไม่เปลี่ยนสูตร/retention |
| TD-57-03 | single statement snapshot แทนเพิ่ม REPEATABLE READ ให้ shared read helper หรือ lock monitor ระหว่าง percentile ลด scope และไม่เสี่ยง stale membership snapshot ของ shared transaction; events/status รวมใน read statement ของ endpoint นี้เท่านั้น |
| TD-57-04 | metadata required ทุก range; summary long-range only ให้ 24h คง client formula; schema max721 รองรับ inclusive T ที่ตรง hour เป็น technical contract correction ตาม PD-57-06 ไม่เพิ่ม bucket metric ใหม่ |

Cost estimate เชิงข้อมูล (ไม่ใช่ target/benchmark): ที่รอบ 1 นาทีประมาณ 10,080 raw rows ต่อ 7d และ 43,200 ต่อ 30d ต่อ monitor; long query scan/sort มีต้นทุนสูงกว่า 168/720 rollup rows และ poll เดิมอาจเพิ่ม load หลายผู้อ่าน Scope ที่ PO รับไม่มี latency/availability target ไม่รับรอง production capacity ให้ implementation เก็บ `EXPLAIN (ANALYZE, BUFFERS)` บน task-owned fixtures 7d/30d, จำนวน rows, elapsed time, plan/partition pruning และ spill เป็น diagnostic-only ห้ามเงียบๆ cap/approximate/เพิ่ม cache หรือ migration เพื่อผ่าน ถ้ามีปัญหาจริงให้เสนอปรับ approved contract ผ่านผู้ใช้ก่อนเปลี่ยน

Rollout/backfill: ไม่ต้อง backfill/migration หรือเปลี่ยน retention เพราะ raw history มีอยู่แล้ว; raw-only fixture ใน tests ต้องพร้อมให้ response-time buckets derive ใหม่ อย่าแก้ seedHourly helper รวมให้ uptime fixture เปลี่ยนพฤติกรรม ไม่มี feature flag ใหม่ Required fields ทำให้ web ใหม่ใช้ API เก่าไม่ได้; web เก่าอาจอ่าน additive metadata/summary ได้แต่ schema max720 เดิมจะปฏิเสธ exact-hour 721 payload จึงไม่อ้างว่า API-first deployment ปลอดภัยสำหรับทุก client Spec นี้กำหนด coordinated API/Web candidate เท่านั้น หากจะ deploy แบบ version skew/rolling ต้องวาง compatibility reader stage (widen bucket bound ก่อน, tolerate metadata ที่ยังขาดโดยคง baseline behavior ชั่วคราว) และจัดการ browser bundle เก่าก่อนสลับ writer contract ผ่านแผน release แยก ไม่เพิ่ม feature flag หรือ deploy task ใน scope นี้

### Tasks (#57)

เป็น task graph ที่เสนอสำหรับ implementation ภายหลัง ยังไม่มี dispatch/estimate commitment งาน sequential เพื่อให้ contract/generated fixtures ของไฟล์ร่วมมี owner เดียว

| Task | Depends on | Integration owner of shared files |
| --- | --- | --- |
| NODE-F005-57A | spec Approved และ implementation start authorized แล้ว 2026-10-06 | software-engineer: contract/schema/API และ generated client |
| NODE-F005-57B | 57A handoff | software-engineer: Web/card/chart adapters และ Web fixtures |
| NODE-F005-57V | 57A/57B stopped พร้อม owned changes | software-engineer: integrated scenarios/evidence; Technical Lead สั่ง gates/ตัดสินผล |

#### NODE-F005-57A Contract and exact read

- **OWNER:** software-engineer
- **READY:** spec Approved และ matrix frozen แล้ว 2026-10-06; ผู้ใช้อนุญาต implementation start ผ่าน implement-issue ใน session นี้ technical rows AC-72 ถึง AC-74 รวมใน issue #57 Feature matrix แล้ว
- **OUTCOME:** endpoint คืน metadata, exact long-range summary/buckets จาก snapshot เดียวและ capped 24h points ตาม contracts
- **SOURCE:** [API](#api-57), [query](#data-and-query-57), [Security/concurrency](#authorization-rls-and-concurrency-57), [Feature delta](feature.md#acceptance-matrix-57-delta)
- **INVARIANTS:** PD-57-01 ถึง PD-57-09, scoped bound SQL/runtime RLS; no shared helper isolation change
- **FILES:** `packages/api-contract/src/monitor.ts`, `apps/api/src/monitors/read-service.ts`, `read-response-times.db.test.ts`, `read-test-support.ts` (new raw fixtures เฉพาะงานนี้), `read-membership.db.test.ts`, `read-detail.db.test.ts`, existing contract test file ใน module ถ้าจำเป็น; `apps/web/src/lib/api/openapi-types.gen.ts` generated owner ของ 57A และ existing API/Web response fixtures ที่ compile ต้องอัปเดต metadata/summary ร่วมกับ owner 57B ก่อน integration
- **NON-GOALS:** [Feature non-goals](feature.md#scope-and-non-goals), source Worker/DB helper/schema changes, index tuning/backfill
- **CONTRACTS:** API metadata/summary/schema handoff ให้ 57B; generate client ด้วย `bun run --cwd apps/web codegen` หลัง API schema final ห้าม manual-edit generated output
- **VERIFY:** `bun run --cwd apps/api test`; `bun run --cwd apps/api test:integration src/monitors/read-response-times.db.test.ts src/monitors/read-membership.db.test.ts src/monitors/read-detail.db.test.ts` ผ่าน worktree environment และ runtime/owner URLs ตาม Quality README; `bun run codegen:check`
- **PROOF:** fixture expected arithmetic, bounds/cap/721 cases, raw/bucket consistency under controlled concurrent commit, direct RLS deny and route permissions, successful schema parsing/generated drift; plan/timing evidence แยก diagnostic-only ไม่มี claim latency gate
- **COVERS:** AC-64, AC-65, AC-66, AC-67, AC-68, AC-69 (server), AC-63 (API support), AC-72, AC-73, AC-74 (DB/codegen/diagnostic proof support)

#### NODE-F005-57B Live KPI consumption

- **OWNER:** software-engineer
- **READY:** 57A contract/generated shapes ส่งมอบแล้ว; start authorization เดียวกับ 57A
- **OUTCOME:** live four KPIs ทุกช่วงพร้อม evidence/time/cap/state labels และ #57 mockup removal
- **SOURCE:** [Web](#web-57), [Feature flow/states](feature.md#ui-flow-and-states-57), [Feature ACs](feature.md#acceptance-matrix-57-delta)
- **INVARIANTS:** API schema validation, tenant/range scoped cache, chart/health semantics ไม่เปลี่ยน, null ไม่ใช้ fallback zero
- **FILES:** `apps/web/src/components/ui/response-time-series.ts`, `response-time-series.test.ts`, `response-time-chart.test.tsx`; `apps/web/src/pages/monitors/detail/ResponseTimeCard.tsx`, `MonitorDetailMockups.tsx`, `apps/web/src/pages/monitors/DetailPage.test.tsx`; existing monitor/API Web fixture tests ที่ schema เปลี่ยน ห้ามแก้ generated types (57A owner)
- **NON-GOALS:** [Feature non-goals](feature.md#scope-and-non-goals), chart library/redesign/layout ใหม่, mockup issue อื่น
- **CONTRACTS:** [API](#api-57), summary required long-range; chart uses response.window/dataAsOf
- **VERIFY:** `bun run --cwd apps/web test src/components/ui/response-time-series.test.ts src/components/ui/response-time-chart.test.tsx src/pages/monitors/DetailPage.test.tsx`; `bun run --cwd apps/web typecheck`
- **PROOF:** expected 24h/7d/30d KPI fixture parity, checks excludes check_error, no #57 mockup, loading/null/error/refetch/denial and superseded-range tests, UTC window/cap/current hour representation; keyboard/screen reader cases ส่งให้ 57V ทำ manual integrated proof
- **COVERS:** AC-63, AC-64 (24h), AC-65 (24h), AC-66 (24h), AC-67 (display), AC-68 (display), AC-69 (cache/denial), AC-70, AC-71 (component support), AC-74 (UI proof support)

#### NODE-F005-57V Integrated proof

- **OWNER:** software-engineer
- **READY:** writers หยุด, 57A/57B handoffs พร้อม; Technical Lead สั่ง full checks เท่านั้น ไม่ bind candidate เอง
- **OUTCOME:** integrated behavior/security/UI evidence แยกจาก diagnostic plan data และ skipped checks
- **SOURCE:** [Integrated verification](#integrated-verification-57), [Quality gates](../../../scripts/quality/README.md), Feature AC-63 ถึง AC-74 และ baseline regression ที่ระบุ
- **INVARIANTS:** safe task-owned environment/URLs; no owner runtime/production DB, no acceptance freeze/release claim
- **FILES:** focused monitor E2E scenario ใน `e2e/tests/monitors-states.spec.ts` ถ้าจำเป็น และ `docs/features/issue-57-monitor-response-stats/verification.md` execution evidence ของ #57; ไม่แก้ historical approval/source contracts ระหว่างเก็บผล
- **NON-GOALS:** unrelated baseline repairs, PR/deploy/release; scope blocker ต้องส่ง Technical Lead
- **CONTRACTS:** None
- **VERIFY:** integrated commands/scenarios ด้านล่างหลัง full writer stop; ไม่รัน DB suites ขนานบน database เดียว
- **PROOF:** commit/source state ที่ตรวจ, AC-to-result pass/fail/not-run, captured browser+API values, keyboard/screen reader notes, codegen/gate outputs, runtime role/RLS negative cases และ skipped reasons; full validation failure ส่ง findings ไม่ซ่อม/เปิด phase เอง
- **COVERS:** AC-63 ถึง AC-74 แบบ integrated, baseline AC-14/15/22/39/48/49 regression

### Integrated verification (#57)

| AC / rule | Owned proof / scenario |
| --- | --- |
| AC-63 | 57A+57B+57V: real API fixture ค่าเดียวกันสามช่วง, สี่ KPI และไม่มี #57 mockup |
| AC-64 | 57A+57B: [10,20,30,40] → 20/40, N=0/1, zero/duplicates และ unequal hourly populations ต่างจาก percentile ของ averages |
| AC-65 | 57A+57B: HTTP/assertion measured fail, timeout/DNS/TLS null fail, single fail ไม่เป็น incident, Test ไม่มี persisted row, check_error ไม่นับ failed |
| AC-66 | 57A+57B: all-timeout checks=failed>0/null percentile; check_error-only null counts0, measured check_error percentile non-null/counts0; health ไม่เปลี่ยน |
| AC-67 | 57A+57B+57V: fixed T ตรง/กลาง hour, start/T ±1ms, scheduled ตรง T มองเห็น, scheduled>T ไม่เข้า; checked_at ข้ามขอบ, timezone/session zone ต่างกัน, young monitor และ clipped current-hour table; metadata เวลาเดียวกัน |
| AC-68 | 57A+57B: seed >1440 จริงภายใน 24h โดย unique scheduled_for (existing 1500-at-60s test มีเพียง1440ใน window จึงยังไม่พิสูจน์ overflow), cap ก่อนกรอง outcome, long uncapped, raw retained edge/pause/gap ไม่เติมผล |
| AC-69 | 57A+57B+57V: read roles4, non-member/malformed/foreign404, concurrent removal, authorized-before-removal ordering, denied cached UI และ pending tenant switch |
| AC-70 | 57B+57V: ทุก state ใน Feature, rapid selection/out-of-order resolution, initial error ไม่มี success KPI, refetch error มี same-key timestamp/warning/retry |
| AC-71 | 57B+57V: manual keyboard/screen reader ทั้งสามช่วง, both themes desktop, null/error/denied, focus และ polite selection announcement ครั้งเดียว ไม่ auto-refetch |
| AC-72 | 57A+57V: controlled interleaving result insert/purge/delete/pause/resume รอบ statement, summary/bucket count agreement และ before/after snapshot outcome; pause/resume หลัง T ก่อน snapshot ต้อง infer state ณ T ถูก; membership removal ก่อน authorization และหลัง read organization lock ตาม allowed ordering; fixed T/history retained fixture ตรวจ missing raw ไม่ใช้ rollup แทน |
| AC-73 (DB-01/02/03/04/09, REQ-05, OPS-01) | 57A+57V: runtime role attributes/grants/FORCE RLS ตรวจ catalog และ direct A/B/no-context SELECT, bound SQL/same-client context, route denials/errors/logs ไม่รั่ว protected input/raw samples; ไม่ข้าม DB checks แม้ไม่มี migration |
| AC-74 | 57A+57B+57V: actual source state และ outcomes ต่อ AC-63 ถึง AC-73, codegen drift/full gates และ manual UI evidence พร้อม skipped reasons; plan/rows/time/spill ของ task-owned 7d/30d fixtures แยก diagnostic-only ไม่ถือเป็น latency/capacity/release proof |
| AC-14/15/22/39/48/49 | 57V: uptime ไม่เปลี่ยน, chart gaps/pause/table keyboard, check_error health, non-disclosure/cache invalidation baseline |

Technical acceptance rows AC-72 (Concurrency), AC-73 (Security), AC-74 (Verification) และ behavior rows AC-63 ถึง AC-71 ใน [Issue #57 Feature matrix](feature.md#acceptance-matrix-57-delta) เป็น frozen ตามคำอนุมัติผู้ใช้ 2026-10-06 โดยไม่เปลี่ยน criteria ทุก delta AC map ไป Task/scenario ด้านบน Baseline AC-01 ถึง AC-62 คงเดิม การอนุมัติและ freeze ไม่ใช่ runtime proof หรือ implementation start

Full checks เมื่อ implementation ได้รับอนุญาตและ writers หยุด: `bun run validate`, integration suite ผ่าน runtime/owner URLs จาก worktree resolver, `COVERAGE_GATE=1 bun run test:coverage`, `bun run security` และ focused browser scenario ผ่าน `bun run --cwd e2e test tests/monitors-states.spec.ts` ตาม [Quality README](../../../scripts/quality/README.md) (`e2e/package.json` เรียก `scripts/e2e.mjs` ที่ส่ง arguments ให้ Playwright); E2E ไม่มี PR gate เดิม ยังต้องทำ UI verification ที่ scope นี้ต้องใช้ ไม่อ้าง release approval หรือ CI green จาก local checks ไม่เปลี่ยน infra/images จึงไม่สั่ง image scan เป็น task ใหม่ของ delta

Document validation: ตรวจ relative links/anchors, template fields, AC mappings และ diff เท่านั้น ยังไม่รัน commands ของ implementation ข้างต้น Runtime acceptance ทุก AC-63 ถึง AC-74 = not verified; ไม่สร้าง verification evidence ย้อนหลังใน baseline record

### Open decisions (#57)

None. ผู้ใช้ยืนยันใช้ตามคำแนะนำ 2026-10-06: อนุมัติ contracts/query/raw-bucket tradeoffs และ required wire fields/max721, freeze `F-005-AC-2` คำสั่ง implementation แยกได้รับแล้วผ่าน implement-issue ตาม Start authorization; release ยังไม่ได้รับอนุญาต

Query cost/production capacity เป็นความเสี่ยงและแผนวัดใน [Design decisions](#design-decisions-57) และ AC-74; ยังไม่มี runtime evidence หรือ latency target Rolling deployment/browser bundle compatibility เป็นข้อกำหนดแผน release ในหัวข้อเดียวกัน ไม่รับรอง rolling-safe และไม่มี release authorization

### Revisions (#57)

| Date | Change | Approved by user | `acceptanceVersion` |
| --- | --- | --- | --- |
| None (drafting run นี้ไม่ invent approval date) | Draft F-005-S09: metadata, exact raw summary/buckets, 24h client checks delta, Tasks และ verification จาก PD-57-01 ถึง PD-57-09; เพิ่ม draft technical rows AC-72 ถึง AC-74 และ mappings โดยรักษา behavior/baseline rows ไม่มี owner-integration blocker | Not yet | F-005-AC-2 (draft) |
| 2026-10-06 | ผู้ใช้ยืนยันใช้ตามคำแนะนำ อนุมัติ PD-57-01 ถึง PD-57-09, TD-57-01 ถึง TD-57-04/contracts และ freeze AC-63 ถึง AC-74 โดยไม่เปลี่ยน criteria; ลบ OD ที่ปิดแล้วและเก็บ query cost/deployment compatibility เป็นความเสี่ยง/แผนตรวจ; ยังไม่อนุญาต implementation start หรือ release | 2026-10-06, คำยืนยันใน session นี้ | F-005-AC-2 (frozen) |
| 2026-10-06 | ผู้ใช้เรียก poteto-mode และ implement-issue สำหรับ #57; อนุญาต Tasks 57A/57B/57V, scoped commits และเปิด PR ที่ยังไม่ merged หลัง local checks ผ่าน; STOP_AT merge-ready, ไม่อนุญาต merge/release และไม่เปลี่ยน contracts/AC | 2026-10-06, คำสั่งใน session นี้ | F-005-AC-2 (frozen) |
