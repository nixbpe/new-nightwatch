# Issue #59 Technical Spec: เรียงลำดับฝั่ง server และข้อมูลเพิ่มในรายการ monitor

Owner: Technical Lead spec นี้ได้รับอนุมัติแล้ว จึงเป็น source of truth ของ implementation และ review

| Field                | Value |
| -------------------- | ----- |
| Issue                | [#59](https://github.com/nixbpe/new-nightwatch/issues/59) ต่อยอด F-005 (`docs/features/F-005-uptime-monitor/`) |
| Feature              | None (ข้ามขั้นตอน Product Owner แบบ issue #60 ผู้ใช้รับแถว AC P59-01 ถึง P59-10 โดยตรง), `acceptanceVersion` `issue-59-AC-1` (frozen 2026-10-06) |
| Epic                 | None |
| Status               | Approved |
| Approved by user     | 2026-10-06 (`/implement-issue`, team-lead ส่งต่อ) |
| Start authorization  | 2026-10-06, /implement-issue ("อนุมัติ spec เลย แล้วเริ่ม implement") |
| `COMMIT_MODE`        | owned-slice commit ได้เฉพาะไฟล์ใน FILES ของ Task ตัวเองบน branch `issue-59-monitor-list-sort-view` push และเปิด PR ได้เฉพาะ integration owner (ผู้ถือ NODE-59-03) หลัง local gate ผ่าน ไม่ merge ไม่ force-push |
| `STOP_AT`            | merge-ready |

ป้ายในวงเล็บ: [ตรวจแล้ว] คือสิ่งที่อ่านใน code หรือเอกสาร ณ 2026-10-05 บน branch `feature-server-monitor` [สมมติฐาน] คือสิ่งที่ยังไม่ได้พิสูจน์ เนื้อหา issue มาจาก team-lead (Technical Lead ไม่ได้เปิด `gh` เอง) canvas (`claude.ai/artifact/...`) และ branch `feat/redesign-claude-design` ไม่ได้เปิดดู ผู้ใช้ยืนยันให้ใช้ตำแหน่ง mockup ที่ยืนยันจาก code แทน ตัวเลขตัวอย่างใน canvas และใน mockup (`SPARK` ใน `MonitorListMockups.tsx:11-14`) ไม่ใช้ใน contract

ผู้ใช้ยืนยันทุก decision 2026-10-05 และอนุมัติ spec ทั้งฉบับ 2026-10-06 freeze ที่ `issue-59-AC-1` (ดู Revisions) การแก้ของ review รอบ 3 (R3-01 ถึง R3-05) ไม่เคยผ่าน review อิสระ Technical Lead ตรวจซ้ำตอนรับ handoff และ final review

## ข้อขัดกับ contract เดิม

งานนี้ไม่แก้ไฟล์ของ F-005 ตามแบบ #58 และ #60

| ข้อขัด [ตรวจแล้ว] | ผลของงานนี้ |
| --- | --- |
| F-005 spec `:53` ตรึงลำดับ list "health (ล่ม, ไม่ทราบสถานะ, ปกติ, หยุดชั่วคราว), `lower(name)`, `id`" และ feature `:281` "เรียงตามสิ่งที่ต้องดูก่อน" | ไม่ขัด: ลำดับนี้เป็นค่าเริ่มต้นในชื่อ `problems` ลำดับอื่นเป็นตัวเลือกเพิ่ม ไม่ supersede F-005 |
| F-005 spec `:56` ตรึง field ของ list item | additive: เพิ่ม `method`, `intervalSeconds`, `ssl.issuer`, `ssl.notAfter`, `responseSparkline` ไม่เปลี่ยนหรือลบ field เดิม |
| F-005 AC-05 (`feature.md:480`) รายการคอลัมน์ของตาราง Overview | additive: Table เพิ่มคอลัมน์ "เมธอด" และ "รอบตรวจ" คอลัมน์เดิมคงอยู่ |
| #60 spec (`issue-60-monitor-alert-settings/spec.md:78`) "List ไม่เพิ่ม" `alerts` | คงเดิม งานนี้ไม่เพิ่ม `alerts` ใน list |

## สภาพ code ที่ spec นี้ต่อยอด [ตรวจแล้ว]

เลขบรรทัดใน issue เลื่อนแล้วทุกจุด (#58 และ #60 merge แล้ว) และ "สิ่งที่มีวันนี้" ของ issue ล้าสมัยสองข้อ: ลำดับ list และ view toggle

| เรื่อง | สภาพปัจจุบัน | ผลต่อ #59 |
| --- | --- | --- |
| Query ของ list | `monitorListQuerySchema` (`packages/api-contract/src/monitor.ts:1003-1018`, issue อ้าง `970-986`) มี `limit`, `offset`, `health`, `q` ไม่มี sort | เพิ่ม `sort` |
| ลำดับ list | SQL `order by lower(m.name), m.id` (`apps/api/src/monitors/read-service.ts:203`, issue อ้าง `182`) แล้ว `listMonitors` เรียงซ้ำด้วย `HEALTH_ORDER` แบบ stable (`read-service.ts:441-446,465-474`) ลำดับจริงคือ health group แล้วชื่อ ไม่ใช่ชื่ออย่างเดียวตามที่ issue เขียน | ค่าเริ่มต้น `problems` คือลำดับนี้ |
| Test ที่ผูกกับลำดับ | `apps/api/src/monitors/read-list.db.test.ts:73` ("groups down, unknown, up, paused, then lower(name), then id"), `:117` และ `apps/web/src/pages/monitors/OverviewPage.test.tsx:455` ("lists rows in server order", issue อ้าง `:355`) | expectation ของลำดับผ่านโดยไม่แก้ |
| Pagination | `listMonitors` โหลดทุกแถวขององค์กร (ไม่เกิน 50) คำนวณ health ใน JS แล้ว `slice(offset, offset + limit)` (`read-service.ts:457-475`) uptime คำนวณเฉพาะแถวในหน้า (`:476-481`) | sort ทำใน JS ก่อน slice sort ตาม uptime ต้องคำนวณ uptime ทุกแถว |
| `method`, `intervalSeconds` | อยู่ใน `monitorRecordSchema` (`monitor.ts:794-795`, issue อ้าง `762-763`) `STATE_QUERY` select `m.interval_seconds` แล้ว (`read-service.ts:162`) แต่ไม่ select `m.method` `monitorListItemSchema` (`monitor.ts:981-990`) ไม่มีทั้งสอง | เพิ่ม `m.method` ใน `STATE_QUERY` และสอง field ใน list item |
| SSL ใน list | `sslListSchema` (`monitor.ts:929-933`, issue อ้าง `896-900`) มี `level`, `daysRemaining`, `host` `STATE_QUERY` select `ssl_issuer`, `ssl_not_after` แล้ว (`read-service.ts:166-167`) Detail ส่ง `issuer`, `notAfter` จาก row ตรง (`read-service.ts:743-744`, schema `monitor.ts:961-968`) | เพิ่มสอง field ใน list item ไม่ต้องเพิ่ม query |
| ซีรีส์เวลาตอบสนอง | `GET /monitors/{monitorId}/response-times` (`monitorResponseTimesResponseSchema`, `monitor.ts:1270-1304`, issue อ้าง `964-968`) ราย monitor `7d`/`30d` อ่าน `monitor_check_hourly` (`read-service.ts:994-1027`) Worker upsert rollup ทุกผลตรวจ รวมชั่วโมงปัจจุบัน (`apps/worker/src/monitor/record-result.ts:489-499`) | sparkline อ่าน rollup เดียวกันแบบ batch |
| View toggle | มีแล้ว: `SegmentedControl` label "รูปแบบการแสดงผล", option `การ์ด`/`ตาราง`, ค่าเริ่มต้น `table`, เก็บใน `localStorage` key `nightwatch:monitors-view` แบบกัน error (`apps/web/src/pages/monitors/OverviewPage.tsx:49-72,143,299-309,546-556`) `MonitorCards` (`apps/web/src/pages/monitors/list/MonitorCards.tsx`) test ที่ `OverviewPage.test.tsx:202-285` | คงเดิมทั้งหมด |
| Formatter รอบตรวจ | `intervalText` (`apps/web/src/pages/monitors/detail/labels.ts:14-18`) คืน "ทุก N นาที" component `IntervalText` (`apps/web/src/pages/monitors/detail/IntervalText.tsx:1-15`) แยกตัวเลขเป็น `font-mono` ตาม TYP-04 `form/BasicSection.tsx:7` import จาก `../detail/` อยู่แล้ว | card และ Table ใช้ `IntervalText` ตัวเดิม ไม่ย้ายไฟล์ |
| Formatter วันที่ของ SSL | `dateFormat` (วัน เดือนย่อ ปี) เป็นตัวแปรภายใน `detail/SslCard.tsx:7-11` ไม่ export `format.tsx` ไม่มี formatter วันที่ที่มีปี (`formatDateTime` `:38-40` ไม่มีปีและมีเวลา) | ย้ายเป็น export ใน `format.tsx` |
| Table | `MonitorTable.tsx:95-172` มี 8 คอลัมน์: สถานะ, ชื่อ, URL, 24 ชม., 30 วัน, ตอบสนอง, SSL, ตรวจล่าสุด | เพิ่ม "เมธอด" และ "รอบตรวจ" |
| Mockup ของ #59 | `SortMockup` และ `CardEnrichmentMockup` ใน `apps/web/src/pages/monitors/list/MonitorListMockups.tsx` ใช้ที่ `OverviewPage.tsx:35,530,579` mockup SSL ใน `apps/web/src/pages/workspace/IssuesSection.tsx:155-164` (issue อ้าง `WorkspacePage.tsx` และ `MonitorTable.tsx`) test ยืนยัน mockup ที่ `OverviewPage.test.tsx:211,224,232` และ `apps/web/src/pages/WorkspacePage.test.tsx:442-452` (นับ 3 sample รวม issue "59" และยืนยันว่าไม่มีวันที่รูป `\d{1,2} ต\.ค\. \d{4}` ที่ `:452`) | ลบ mockup ทั้งสามและแก้ test assertion `:452` ต้องปรับเพราะบรรทัด "หมดอายุ {วันที่}" จริงอาจตรงรูปนี้ |
| Consumer อื่นของ list | Workspace (`apps/web/src/pages/WorkspacePage.tsx:99-100`) และ loader (`apps/web/src/lib/auth/loaders.ts:151-152`) ใช้ `OVERVIEW_LIST_PARAMS` (limit 50) loader ของ Overview prefetch ด้วย `listParams` (`loaders.ts:232`) `useNavCounts.ts:31` ใช้ `FIRST_PAGE` query key ของ list สร้างจาก field ทีละตัว (`apps/web/src/lib/api/monitors.ts:73-85`) `useNavCounts.ts:23-25,30` และ `loaders.ts:228-232` ตั้งใจใช้ key เดียวกับหน้าแรกของ Overview (`{ limit: 25, offset: 0 }`) | ทุก consumer ที่ไม่ส่ง `sort` ได้ลำดับเดิม key ต้องมี `sort` เฉพาะเมื่อไม่ใช่ค่าเริ่มต้น |
| Fixture ของ list item | literal ของ list item อยู่ใน `OverviewPage.test.tsx:71-92` และ literal `Item["ssl"]` 10 ชุดที่ `:583-634` (typed), `DetailActions.test.tsx:360-383` (typed) และ `WorkspacePage.test.tsx:103-123` รวมแถวที่แทน `ssl` ทั้ง object ที่ `:139-143` (caution) และ `:602-606` (expired) (`overrides: Record<string, unknown>` แล้ว `as MonitorRow` typecheck ไม่จับ field ที่ขาด แถว SSL warning ที่ขาด `issuer`/`notAfter` ได้ `undefined` ซึ่งผ่าน guard `=== null`) ไฟล์ test อื่นที่ mock `fetchMonitorList` ใช้ `monitors: []` | สามไฟล์นี้ต้องแก้ทุกช่วงที่ระบุ |
| Seed ของ API test | `seedMonitor` (`apps/api/src/monitors/read-test-support.ts:7-22,31-35`) ไม่มี option `method` หรือ `sslIssuer` คอลัมน์ `method` default `'GET'` (`0016_uptime_monitors.sql:12`) | ต้องเพิ่ม option เพื่อพิสูจน์ว่า select ถูกคอลัมน์ |
| Test ของ SSL ใน list | `read-list.db.test.ts:271-275,287-291,302-306,318` เทียบ `item?.ssl` ด้วย `toEqual({ level, daysRemaining, host })` | expectation ต้องเพิ่ม `issuer`, `notAfter` |
| Transaction ของ read | `withTenantContextRaw` เปิดด้วย `begin` ธรรมดา (`packages/db/src/tenant-context.ts:62`) จึงเป็น READ COMMITTED แต่ละ statement เห็นข้อมูลที่ commit ล่าสุด `now()` เป็นค่าเดียวทั้ง transaction (`read-service.ts:73-75`) | ดู Concurrency |
| ชนิดของ rollup | `response_checks integer`, `response_ms_sum bigint` (`packages/db/migrations/0016_uptime_monitors.sql:122-123`) bucket ของ `7d` cast `response_ms_sum::text` แล้วหารใน JS (`read-service.ts:1002,1018-1021`) | หารใน SQL ตรง ๆ จะเป็นการหารจำนวนเต็ม |
| `problemRows` ของ Workspace | down ก่อน แล้ว SSL warning ที่ไม่ล่ม (`IssuesSection.tsx:20-25`) เรียงฝั่ง client จากลำดับของ server | ไม่เปลี่ยน |
| Migration ล่าสุด | `0022_monitor_alert_settings.sql` | ไม่มี migration |

## Contracts

### API

ไม่มี route ใหม่ ทุกการเปลี่ยนอยู่ที่ `GET /api/organizations/{organizationId}/monitors` และ schema ใน `packages/api-contract/src/monitor.ts` (REQ-02) สิทธิ์ `read` เดิม

- **`sort` ใน `monitorListQuerySchema`**:

  ```ts
  export const MONITOR_LIST_SORTS = ["problems", "name", "uptime", "response_time", "newest"] as const;
  export type MonitorListSort = (typeof MONITOR_LIST_SORTS)[number];
  sort: z.enum(MONITOR_LIST_SORTS).default("problems"),
  ```

  ค่านอก enum คืน `400 INVALID_INPUT` เหมือน query value อื่นที่ไม่ผ่าน [ตรวจแล้ว: `read-list.db.test.ts:152-168`] ไม่มี direction param ทิศทางผูกกับแต่ละค่า

- **ลำดับต่อค่า** ทุกค่าปิดท้ายด้วย `lower(name)` แล้ว `id` ตามลำดับเดิมของ `STATE_QUERY` เพื่อให้ลำดับเป็น total order และ offset pagination คงที่ระหว่างคำขอที่ข้อมูลไม่เปลี่ยน:

  | `sort` | label (จาก `SortMockup`) | key หลัก | ค่า `null` |
  | --- | --- | --- | --- |
  | `problems` | ปัญหาก่อน | `HEALTH_ORDER` เดิม (ล่ม, ไม่ทราบสถานะ, ปกติ, หยุดชั่วคราว) ไม่แทรก SSL warning | ไม่มี |
  | `name` | ชื่อ A-Z | `lower(name)` | ไม่มี |
  | `uptime` | ความพร้อมใช้งานต่ำสุด | `uptime.h24.percent` น้อยไปมาก | ท้ายสุด |
  | `response_time` | ตอบกลับช้าสุด | `lastResponseTimeMs` มากไปน้อย | ท้ายสุด |
  | `newest` | เพิ่มล่าสุด | `created_at` ใหม่ไปเก่า | ไม่มี |

  การเรียงทำใน JS หลังคำนวณ health ก่อน `slice` เป็น stable sort บน key หลักเท่านั้น วางบนลำดับ `lower(m.name), m.id` ที่ฐานข้อมูลคืน (`read-service.ts:203`) `name` คือลำดับของฐานข้อมูลโดยไม่เรียงซ้ำ ห้ามเทียบชื่อใน JS (`toLowerCase`, `localeCompare`) เพราะผลต่างจาก `lower()` ของ Postgres ได้สำหรับชื่อไทย ตัวพิมพ์ผสม และเครื่องหมาย key มาจาก enum (allow-list ตาม DB-08) ไม่มี `ORDER BY` แบบ dynamic `summary` ไม่ขึ้นกับ `sort`

- **`monitorListItemSchema`** เพิ่ม (ทั้งหมด required):

  ```ts
  method: monitorMethodSchema,
  intervalSeconds: z.number().int(),
  ssl: sslListSchema.extend({ issuer: z.string().nullable(), notAfter: isoDateTime.nullable() }),
  responseSparkline: z.array(z.object({ hourStart: isoDateTime, avgMs: z.number().nullable() })).length(24),
  ```

  - `ssl.issuer`, `ssl.notAfter`: ค่าเดียวกับ Detail (`m.ssl_issuer`, `m.ssl_not_after`) ไม่ขึ้นกับ `level` monitor `http` ได้ `null`
  - `responseSparkline`: ส่งทุก request 24 จุดรายชั่วโมง จุดสุดท้ายคือชั่วโมง UTC ของ `now` (ชั่วโมงที่ยังไม่จบนับด้วย) จุดแรกคือ 23 ชั่วโมงก่อนหน้า ชั่วโมงเริ่มต้นคำนวณใน JS จาก `now` ของ `readInTenant` (`Math.floor(now / HOUR_MS) * HOUR_MS` แบบ `record-result.ts:483-485`) แล้วส่งเป็น parameter ไม่ใช้ `date_trunc` ใน SQL เพราะผลขึ้นกับ session `TimeZone` `avgMs` คำนวณใน JS แบบ bucket ของ `7d`: SQL คืน `response_ms_sum::text` แล้ว `Math.round((Number(sum) / responseChecks) * 100) / 100` (`read-service.ts:1002,1018-1021`) ห้ามหาร `bigint / integer` ใน SQL เพราะเป็นการหารจำนวนเต็ม `null` เมื่อชั่วโมงนั้นไม่มีแถวหรือ `response_checks = 0` (หยุดชั่วคราว, ยังไม่สร้าง, ไม่มีผลที่วัดเวลาได้) [ตรวจแล้ว: `hour_start` ของ rollup คือ `scheduled_for` ปัดลงเป็นชั่วโมง UTC (`record-result.ts:483-485`) จุดของ sparkline จึงจัดตามชั่วโมง UTC]
  - คำนวณเฉพาะแถวในหน้า ด้วย query เดียวแบบ `unnest($ids) cross join lateral` บน PK `(monitor_id, hour_start)` แบบ `loadUptime` (`read-service.ts:340-357`) ไม่เกิน 50 × 24 แถว

- **OpenAPI**: regenerate `apps/web/src/lib/api/openapi-types.gen.ts` ด้วย `bun run --cwd apps/web codegen` (WEB-01) ไม่แก้ด้วยมือ

### Data

ไม่มี migration ตารางหรือ column ใหม่ ค่าทั้งหมดอ่านจาก `monitors`, `monitor_check_results`, `monitor_check_hourly` และ `monitor_events` ที่มีอยู่ ภายใต้ RLS เดิมใน tenant transaction ของ `readInTenant` (DB-04)

### Web

- **Query key และ params** (`apps/web/src/lib/api/monitors.ts`): `MonitorListParams` เพิ่ม `sort?: MonitorListSort` `monitorQueryKeys.list` ใส่ `sort` ใน object ของ key เฉพาะเมื่อกำหนด `fetchMonitorList` ส่ง `sort` เฉพาะเมื่อกำหนด Overview แปลง state `problems` เป็น `sort` ที่ไม่กำหนด (undefined) ทั้งใน key และ query จึงได้ key ค่าเริ่มต้นเท่ากับ `monitorQueryKeys.list(org, { limit: 25, offset: 0 })` ที่ loader (`loaders.ts:228-232`) และ `useNavCounts` (`:23-25,30`) ใช้ร่วมกันวันนี้ `OVERVIEW_LIST_PARAMS` และ `FIRST_PAGE` ไม่ส่ง `sort`
- **Overview** (`OverviewPage.tsx`):
  - แทน `SortMockup` ด้วย `<select>` ที่มี `<label>` "เรียงตาม" option ห้ารายการตามลำดับนี้: ปัญหาก่อน, ชื่อ A-Z, ความพร้อมใช้งานต่ำสุด, ตอบกลับช้าสุด, เพิ่มล่าสุด (ค่าเริ่มต้นอยู่บนสุด ต่างจากลำดับใน `SortMockup` ที่วาง "ชื่อ A-Z" ก่อน) ค่าเริ่มต้น "ปัญหาก่อน" (`problems`) ทำงานทั้งสองมุมมอง
  - เปลี่ยน sort แล้วตั้ง `offset` เป็น 0 และประกาศผลผ่าน `role="status"` เดิม (กลไก `pendingAnnouncement`, region "ผลการกรอง") ด้วยข้อความ "เรียงตาม {label} · พบ N จาก M" ตัวกรองยังประกาศ "พบ N จาก M" แบบเดิม (`OverviewPage.tsx:184-187`) "ล้างตัวกรอง" ไม่รีเซ็ต sort (sort ไม่ใช่ตัวกรอง) sort อยู่ใน state ของหน้า ไม่จำค่า: ไม่เก็บใน `localStorage` ไม่อยู่ใน URL เปิดหน้าใหม่ได้ค่าเริ่มต้นเสมอ
  - view toggle คงเดิม: ค่าเริ่มต้น `table`, `localStorage` key `nightwatch:monitors-view`, label `การ์ด`/`ตาราง`, label กลุ่ม "รูปแบบการแสดงผล"
  - ลบ `CardEnrichmentMockup` และ `SortMockup` ลบ `list/MonitorListMockups.tsx` ทั้งไฟล์เมื่อไม่มีผู้ใช้
- **Cards** (`list/MonitorCards.tsx`):
  - แสดง method และ URL บรรทัดเดียวกันแบบ mockup (`GET https://...` monospace, TYP-04) method อยู่ใน element แยก URL คงอยู่ใน element ของตัวเองที่มี `break-all` ตามเดิม (`OverviewPage.test.tsx:262` ใช้ `getByText(url)` ตรวจ class นี้) และ pill รอบตรวจ "ทุก N นาที" จาก `intervalSeconds` (60, 300, 900) ด้วย component `IntervalText` (`detail/IntervalText.tsx`) ตัวเลขเป็น monospace ตาม TYP-04
  - Sparkline 24 แท่งจาก `responseSparkline` แท่ง `null` แสดงเป็นช่องว่างที่ต่างจากค่าต่ำ (ไม่วาดแท่งสูง 0) ความสูงปรับตามค่าสูงสุดของ monitor นั้น ไม่ใช่ทั้งหน้า กราฟเป็น `aria-hidden` และมีข้อความแทนผ่าน `sr-only` ที่บอกหน่วย ช่วงเวลา แหล่งข้อมูล และจำนวนชั่วโมงที่ไม่มีข้อมูล เช่น "เวลาตอบสนองเฉลี่ยรายชั่วโมงจากผลตรวจของมอนิเตอร์นี้ 24 ชม. ล่าสุด สูงสุด N ms ไม่มีข้อมูล K ชั่วโมง" (CMP-05) ไม่สื่อสถานะด้วยสีอย่างเดียว สีตาม `docs/design-system.md` monitor ที่ไม่มีจุดใดเลยแสดง "ไม่มีข้อมูล" (`NO_DATA`)
- **Table** (`MonitorTable.tsx`): เพิ่มสองคอลัมน์ ต่อจาก "URL": "เมธอด" (`method`, monospace ตาม `mono: true` แบบคอลัมน์ URL) และ "รอบตรวจ" ("ทุก N นาที" ด้วย `IntervalText` เดียวกับ card) คอลัมน์เดิมและลำดับคอลัมน์เดิมคงอยู่ ตารางเลื่อนแนวนอนใน container ของตัวเองบนจอแคบเหมือนเดิม (LAY-02) ไม่เพิ่ม sparkline ใน Table
- **Workspace section 01** (`workspace/IssuesSection.tsx`): แถวที่มี SSL warning (`hasSslWarning`) แสดง "ผู้ออก {issuer}" และ "หมดอายุ {วันที่}" ในคอลัมน์ขวาต่อจาก `sslDays` (`:104-106`) วันที่ใช้ `dateFormat` ของ `SslCard.tsx:7-11` ที่ย้ายเป็น export `formatDate` ใน `apps/web/src/pages/monitors/format.tsx` และ `SslCard.tsx` เปลี่ยนไปใช้ตัวเดียวกัน วันที่ใน Workspace จึงตรงกับ Detail ชื่อผู้ออกตัดบรรทัดด้วย `break-words` ในคอลัมน์กว้าง 170 px (`IssuesSection.tsx:48`) ไม่ทำให้หน้าเลื่อนแนวนอน (LAY-02) วันที่ที่มีชื่อเดือนไทยไม่ใส่ `font-mono` ทั้ง element (TYP-04) `SslCard.tsx:68-69` วางวันที่ใน `<time className="font-mono">` อยู่แล้ว ไม่คัดลอกรูปแบบนั้น และไม่แก้ใน `SslCard` (นอกขอบเขต) เมื่อ `issuer` หรือ `notAfter` เป็น `null` ไม่แสดงบรรทัดนั้น แถวที่ล่ม (รวมแถวที่ล่มและมี SSL warning พร้อมกัน) ไม่แสดงผู้ออกและวันหมดอายุ เพราะคอลัมน์ขวาของแถวล่มแสดงเวลาที่ล่ม และ `sslDays` ก็แสดงเฉพาะ `!down` อยู่แล้ว (`IssuesSection.tsx:93-106`) pill SSL ของแถวนั้นยังแสดงตามเดิม ลบ `MockupFrame` ที่ `:155-164`
- **Fixtures**: `monitorListItemSchema` เพิ่ม field แบบ required จึงต้องแก้ literal ของ list item สามไฟล์: `OverviewPage.test.tsx:71-92,583-634`, `DetailActions.test.tsx:360-383` (typecheck จับ) และ `WorkspacePage.test.tsx:103-123,139-143,602-606` (`as MonitorRow` typecheck ไม่จับ ต้องเพิ่ม field ด้วยมือ รวมแถวที่แทน `ssl` ทั้ง object) ไฟล์ที่ใช้ `monitors: []` ไม่ต้องแก้ typecheck ของ web ทั้ง project รันอีกครั้งใน Integrated verification

### Authorization and security

- สิทธิ์ `read` เดิม (ทุก role ที่เป็นสมาชิก) ไม่มี permission ใหม่ ไม่มี fresh-auth boundary
- ไม่มีข้อมูลใหม่ที่ role ใดไม่เคยเห็น: `method`, `intervalSeconds`, `ssl.issuer`, `ssl.notAfter` ทุก role ที่มี `read` อ่านได้แล้วจาก Detail (`monitorSchema`) ค่าเฉลี่ยเวลาตอบสนองรายชั่วโมงอ่านได้แล้วจาก `response-times?range=7d`
- `sort` ผ่าน zod enum ก่อนถึง service ไม่ต่อ string เข้า SQL
- log ไม่เพิ่ม field
- RLS: query sparkline อยู่ใน tenant transaction เดิมและกรอง `tenant_id` ชัดเจนแบบ `loadUptime` (DB-04)

### Concurrency

| Race | ผลที่ยอมรับ |
| --- | --- |
| health, uptime หรือ latency เปลี่ยนระหว่างการเปิดหน้า 1 กับหน้า 2 (refetch ทุก `MONITOR_REFETCH_INTERVAL_MS`) | แถวอาจย้ายหน้า ซ้ำหรือหายหนึ่งรอบ เป็นพฤติกรรมเดียวกับ health sort ของวันนี้ ไม่ใช้ cursor (ไม่เกิน 50 แถว 2 หน้า) พิสูจน์ด้วย DB test ของ NODE-59-01: เปลี่ยนค่า key ระหว่างสองคำขอแล้วหน้า 2 เป็นไปตามลำดับใหม่โดยไม่ error |
| ผลตรวจใหม่ commit ระหว่าง statement ของ request เดียวกัน | transaction เป็น READ COMMITTED (`tenant-context.ts:62`) แต่ละ statement เห็นข้อมูลที่ commit ล่าสุด `now()` เป็นค่าเดียว จุดสุดท้ายของ sparkline หรือ uptime อาจรวมผลที่ใหม่กว่า `lastResponseTimeMs` และ health ของ request เดียวกันหนึ่งผล ยอมรับได้เพราะ refetch รอบถัดไปตรงกัน ไม่เปลี่ยน isolation level ของ helper กลาง พิสูจน์ด้วยการอ่าน code (ลำดับ statement ใน `listMonitors`) ไม่มี test เฉพาะ |
| เปลี่ยน sort ระหว่าง refetch ค้าง | query key ต่างกัน ผลของ key เก่าไม่แทนผลของ key ใหม่ (`keepPreviousData` เดิม แสดง `aria-busy`) พิสูจน์ด้วย web test ของ NODE-59-02 |

## Design decisions

- **sort ใน JS ไม่ใช่ SQL**: health คำนวณใน JS (`computeHealth`) อยู่แล้ว และองค์กรมีไม่เกิน 50 monitor (`MONITOR_LIMIT_PER_ORGANIZATION`) การย้าย sort ไป SQL ต้องย้าย `computeHealth` ไป SQL ด้วย ไม่คุ้ม
- **uptime ทุกแถวเฉพาะเมื่อ `sort = uptime`**: sort อื่นคง `loadUptime` เฉพาะแถวในหน้าเหมือนเดิม เมื่อ `sort = uptime` เรียก `loadUptime` กับทุกแถวที่ผ่านตัวกรองครั้งเดียว แล้วใช้ผลเดิมสร้าง item ไม่เรียกซ้ำ ต้นทุนเพิ่มสูงสุด 50 lateral probe ต่อ request
- **sparkline ฝังใน list ทุก request ไม่ใช่ endpoint batch หรือ opt-in param**: หนึ่ง query ต่อหน้า ไม่มี route หรือ param ใหม่ และ cache ของ list refetch ตามรอบเดิม
- **rollup รายชั่วโมงไม่ใช่ผลดิบ**: 24 จุดตรงกับ "24 แท่ง" ของ mockup และครอบ 24 ชั่วโมงเท่ากันทุกรอบตรวจ อ่าน PK range ของ rollup ไม่อ่าน `monitor_check_results` สูงสุด 1,440 แถวต่อ monitor
- **Architecture drivers ที่แตะ**: latency ของ list (query เพิ่มหนึ่งตัวต่อ request และ uptime ทุกแถวเมื่อ sort ตาม uptime) ไม่มี target ด้าน performance (F-005 `feature.md:96` ผู้ใช้ตัดสินว่า MVP ไม่มี target) จึงไม่ตั้ง target ใหม่, accessibility (sparkline มีข้อความแทน, select มี label, คอลัมน์ใหม่มี header) ไม่แตะ authorization, audit, availability หรือ DR
- **Risks**:
  - fixture สามไฟล์ที่ขาด field ใหม่: สองไฟล์ทำ typecheck ของ web ล้มตั้งแต่ commit ของ NODE-59-01 จนกว่า NODE-59-02 จะเสร็จ อีกไฟล์ (`WorkspacePage.test.tsx`) typecheck ไม่จับ ระบุใน FILES แล้ว
  - payload ของ Workspace (50 แถว) โตขึ้นประมาณ 24 object ต่อแถว แม้ Workspace ไม่แสดง sparkline (ผู้ใช้ยอมรับ)
  - sort `uptime` ใช้ `h24` ขณะที่ card แสดง uptime 30 วัน ผู้ใช้มุมมอง Cards จึงไม่เห็นค่าที่ใช้เรียง (Table แสดงทั้งสองค่า)
  - Table มี 10 คอลัมน์ บนจอแคบต้องเลื่อนแนวนอนมากขึ้น
  - offset pagination กับ sort ที่ค่าเปลี่ยนตามเวลา ดู Concurrency
- **Assumptions**:
  - "admin", "owner", "viewer", "ผู้ใช้" ใน user stories หมายถึงทุก role ที่มี `read` ตาม F-005 ไม่มีสิทธิ์ใหม่
  - "ในรายการที่ต้องดู" ของ story SSL หมายถึง section 01 "ต้องดูตอนนี้" ของ `/workspace` ตาม Mockup ใน issue ไม่ใช่ Table หรือ Cards
- **Non-goals**: `TLS 1.3`, tags, region (issue), cursor pagination, sort หลายคีย์หรือเลือกทิศทาง, การจำ sort, sparkline ใน Table หรือ Detail, issuer ใน Table หรือ Cards, endpoint batch ของ response times, `alerts` ใน list, การเปลี่ยนนิยาม health, การแก้ไฟล์ของ F-005

## Acceptance

ไม่มี Feature doc แถวด้านล่างร่างโดย Technical Lead จาก user stories ของ issue และการยืนยันของผู้ใช้ 2026-10-05 ผู้ใช้รับเป็นเจ้าของแถวโดยตรงแทน Product Owner (แบบ `PO-60-02`) freeze เมื่อผู้ใช้อนุมัติ spec ทั้งฉบับ

| AC | หมวด | เกณฑ์ |
| --- | --- | --- |
| P59-01 | Behavior | Overview มี "เรียงตาม" ห้าตัวเลือก ค่าเริ่มต้น "ปัญหาก่อน" ให้ลำดับเดียวกับวันนี้ (ล่ม, ไม่ทราบสถานะ, ปกติ, หยุดชั่วคราว แล้วชื่อ) ไม่แทรก SSL warning |
| P59-02 | Behavior | แต่ละ sort ให้ลำดับตามตาราง API (`uptime` ใช้ uptime 24 ชม., `response_time` ใช้เวลาตอบสนองล่าสุด) ค่า `null` อยู่ท้าย ค่าเท่ากันเรียงตามชื่อแล้ว id หน้า 1 และหน้า 2 ไม่มีแถวซ้ำหรือหายเมื่อข้อมูลไม่เปลี่ยน เปลี่ยน sort แล้วกลับไปหน้าแรกและประกาศผล เปิดหน้าใหม่ได้ "ปัญหาก่อน" เสมอ |
| P59-03 | Behavior | card แสดง method, URL และรอบตรวจ "ทุก N นาที" ของแต่ละ monitor Table มีคอลัมน์ "เมธอด" และ "รอบตรวจ" ที่แสดงค่าเดียวกัน คอลัมน์เดิมคงอยู่ |
| P59-04 | Behavior | card แสดง sparkline 24 แท่งจากเวลาตอบสนองเฉลี่ยรายชั่วโมง 24 ชั่วโมงล่าสุด ชั่วโมงที่ไม่มีข้อมูลแสดงต่างจากค่าต่ำ และมีข้อความแทนสำหรับ screen reader |
| P59-05 | Behavior | section 01 ของ `/workspace` แสดงผู้ออกใบรับรองและวันหมดอายุในแถวที่มี SSL warning |
| P59-06 | Behavior | view toggle คงพฤติกรรมเดิม: ค่าเริ่มต้น "ตาราง", label `การ์ด`/`ตาราง`, จำค่าใน `localStorage` key `nightwatch:monitors-view` ต่อ browser, storage ที่ถูกบล็อกไม่ทำให้หน้าล้ม |
| P59-07 | Behavior | mockup ของ #59 ทั้งสามจุดถูกลบ |
| P59-08 | Concurrency | แถวในตาราง Concurrency ผ่านตามผลที่ยอมรับ |
| P59-09 | Security | ทุก role ที่มี `read` ได้ field ใหม่เท่ากัน non-member ได้ denied แบบเดิม `sort` นอก enum ได้ `400` ข้อมูล sparkline ขององค์กร A ไม่ปรากฏในองค์กร B |
| P59-10 | Verification | API DB test ของทุก sort รวม null, tie และสองหน้า, sparkline 24 จุดรวมชั่วโมงว่างและชั่วโมงปัจจุบัน, `method`/`intervalSeconds`/`ssl.issuer`/`ssl.notAfter` ใน list item ตรงกับ Detail ด้วยค่าที่ไม่ใช่ default, RLS A-only/B-only, web test ของ select, card, คอลัมน์ Table และ Workspace, e2e ตาม Integrated verification |

## Tasks

start authorization ได้รับแล้ว 2026-10-06 `READY` ของแต่ละ Task หมายถึง commit ของ Task ที่เป็น dependency อยู่บน branch `issue-59-monitor-list-sort-view` แล้วและ handoff ผ่าน review ของ Technical Lead integration owner ของ branch (push และ PR) คือผู้ถือ NODE-59-03

| Task | Depends on | Integration owner of shared files |
| ------ | ---------- | --------------------------------- |
| NODE-59-01 API และ contract | None | เจ้าของเดียวของ `packages/api-contract/src/monitor.ts`, `packages/api-contract/src/monitor.test.ts`, `apps/api/src/monitors/` และ generate `openapi-types.gen.ts` |
| NODE-59-02 Web: Overview, Cards, Table, Workspace SSL, query key | 01 | เจ้าของเดียวของ `apps/web/src/pages/monitors/`, `apps/web/src/pages/workspace/IssuesSection.tsx`, `apps/web/src/lib/api/monitors.ts`, `apps/web/src/lib/auth/loaders.ts` และ fixture ทุกไฟล์ที่ระบุ |
| NODE-59-03 Integration verification | 01, 02 | เจ้าของเดียวของไฟล์ใหม่ใน `e2e/` |

งาน web เป็น Task เดียว เพราะ field ใหม่เป็น required ทำให้ fixture ของ list item ใน `OverviewPage.test.tsx` และ `DetailActions.test.tsx` ล้ม typecheck พร้อมกัน การแยกเป็นสอง writer จะทำให้ typecheck ของ web แดงจนทั้งคู่เสร็จ Technical Lead รับ handoff ของ 01 ที่ typecheck ของ web แดงเฉพาะจาก fixture สองไฟล์นี้ (ไฟล์ใน FILES ของ 02) error อื่นใน web typecheck ทำให้ handoff ไม่ผ่าน ไม่มี dependency ใหม่หรือการแก้ `bun.lock` ถ้า Task ใดต้องแก้ไฟล์ของ Task อื่นให้หยุดและแจ้ง Technical Lead

### NODE-59-01 API และ contract

- **OWNER:** software-engineer
- **READY:** spec อนุมัติและมี start authorization
- **OUTCOME:** `sort` ใน query, ลำดับตามตาราง API, field ใหม่ใน list item และ sparkline ตาม Contracts → API
- **SOURCE:** Contracts → API, Data, Authorization and security, Concurrency, F-005 spec `:53,56`, DB-04, DB-08
- **INVARIANTS:** ไม่ส่ง `sort` ได้ลำดับเดิม test ที่ `read-list.db.test.ts:73,117` ผ่านโดยไม่แก้ expectation SSL test ที่ `:271-275,287-291,302-306,318` แก้ได้เฉพาะเพิ่ม `issuer`, `notAfter` (additive) ทุก sort เป็น stable JS sort บน key หลักเท่านั้นวางบนลำดับของฐานข้อมูล `name` ไม่เรียงซ้ำใน JS ห้ามเทียบชื่อด้วย `toLowerCase` หรือ `localeCompare` `summary` ไม่ขึ้นกับ `sort` sort อื่นที่ไม่ใช่ `uptime` คง `loadUptime` เฉพาะแถวในหน้า ไม่มี migration
- **FILES:** `packages/api-contract/src/monitor.ts`, `packages/api-contract/src/monitor.test.ts` (expectation ที่ `:622,635` เพิ่ม `sort: "problems"` และเพิ่มกรณี `sort` ผิดใน loop input ผิดที่ `:643-653`), `apps/api/src/monitors/read-service.ts`, `apps/api/src/monitors/read-list.db.test.ts`, `apps/api/src/monitors/read-test-support.ts` (เพิ่ม option `method`, `sslIssuer`), `apps/api/src/monitors/read-membership.db.test.ts` (literal `query` ที่ `:146` เพิ่ม `sort: "problems"` เพราะ `MonitorListQuery` เป็น `z.output` ทำให้ `sort` เป็น required), `apps/web/src/lib/api/openapi-types.gen.ts` (generate เท่านั้น) `read-routes.ts:75` ผูก `monitorListQuerySchema` ตรงอยู่แล้วจึงไม่ต้องแก้ ไฟล์ test อื่นใน `apps/api/src/monitors/` แก้ได้เฉพาะถ้า expectation ของ list item ล้ม และต้องระบุใน handoff
- **NON-GOALS:** UI, route ใหม่
- **CONTRACTS:** OpenAPI และ type `MonitorListSort`, `monitorListItemSchema` ที่ 02 ใช้
- **VERIFY:** `bun run --cwd packages/api-contract test`, `bun run --cwd apps/api test`, `bun run --cwd apps/api typecheck`, `bun run test:integration`, `bun run codegen:check` (web typecheck แดงจาก fixture สองไฟล์ของ 02 ได้ ดูกติกาใต้ตาราง Task)
- **PROOF:** DB test ต่อ sort: ลำดับ, `null` ท้าย, tie ตามชื่อแล้ว id, สองหน้าไม่ซ้ำไม่หาย, ร่วมกับ `health` และ `q`, ค่า key เปลี่ยนระหว่างคำขอหน้า 1 และหน้า 2 (Concurrency แถว 1); `sort` นอก enum ได้ `400`; sparkline: 24 จุด, `hourStart` ตรงชั่วโมง UTC, ชั่วโมงปัจจุบันนับด้วย, ชั่วโมงว่างเป็น `null`, monitor ใหม่ทั้งชุดเป็น `null`, ค่าเฉลี่ยไม่ลงตัว (sum 301, checks 2 ได้ 150.5); `method`, `intervalSeconds`, `ssl.issuer`, `ssl.notAfter` ตรงกับ Detail โดย seed method ที่ไม่ใช่ `GET` และ issuer ที่ไม่ใช่ `null`; Concurrency แถว 2: ระบุลำดับ statement ของ `listMonitors` ใน handoff เพื่อการอ่าน code; RLS A-only/B-only ของ sparkline; HTTP test ทุก role และ non-member
- **COVERS:** P59-01, P59-02, P59-08, P59-09, P59-10

### NODE-59-02 Web: Overview, Cards, Table, Workspace SSL, query key

- **OWNER:** software-engineer
- **READY:** commit และ handoff ของ 01 ผ่าน review ของ Technical Lead
- **OUTCOME:** select "เรียงตาม" จริง, card ที่มี method, รอบตรวจ และ sparkline, คอลัมน์ "เมธอด" และ "รอบตรวจ" ใน Table, query key ที่มี `sort`, แถว SSL warning ใน section 01 ของ Workspace แสดงผู้ออกและวันหมดอายุ, ลบ mockup ของ #59 ทั้งสามจุด
- **SOURCE:** Contracts → Web, Concurrency, `docs/design-system.md`, `docs/ref/shell-structure.md`
- **INVARIANTS:** view toggle, key `nightwatch:monitors-view` และ label `การ์ด`/`ตาราง` คงเดิม sort ไม่จำค่า `OVERVIEW_LIST_PARAMS` และ `useNavCounts` ไม่ส่ง `sort` คอลัมน์เดิมของ Table และลำดับคงอยู่ (คอลัมน์ใหม่แทรกต่อจาก "URL") `problemRows` และลำดับแถวของ Workspace คงเดิม ไม่แก้ `openapi-types.gen.ts` ด้วยมือ
- **FILES:** `apps/web/src/pages/monitors/OverviewPage.tsx`, `OverviewPage.test.tsx` (fixture `:71-92,583-634`, test ที่ยืนยัน mockup `:211,224,232`), `MonitorTable.tsx`, `list/MonitorCards.tsx`, `list/MonitorListMockups.tsx` (ลบ), `format.tsx` (export `formatDate`), `detail/SslCard.tsx` (ใช้ `formatDate`), `DetailActions.test.tsx` (fixture `:360-383`), `apps/web/src/pages/workspace/IssuesSection.tsx`, `apps/web/src/pages/WorkspacePage.test.tsx` (fixture `:103-123,139-143,602-606` เพิ่ม field ด้วยมือ, test mockup `:442-452` รวม assertion วันที่ `:452`), `apps/web/src/lib/api/monitors.ts`, `apps/web/src/lib/auth/loaders.ts` และ `loaders.test.tsx` (เฉพาะถ้า loader เปลี่ยน)
- **NON-GOALS:** sparkline ใน Table, issuer ใน Table หรือ Cards, เก็บ sort ใน URL หรือ storage
- **CONTRACTS:** none
- **VERIFY:** `bun run --cwd apps/web test`, `bun run --cwd apps/web typecheck`
- **PROOF:** test: select ห้า option ตามลำดับที่กำหนด, ส่ง `sort` และรีเซ็ต offset, ประกาศ "เรียงตาม {label} · พบ N จาก M", ค่าเริ่มต้นไม่ส่ง `sort`, key ค่าเริ่มต้นของ Overview เท่ากับ `monitorQueryKeys.list(org, { limit: 25, offset: 0 })` ของ loader และ `useNavCounts`, mount ใหม่กลับเป็น "ปัญหาก่อน", key ต่างกันต่อ sort, เปลี่ยน sort ขณะ request เก่าค้างแล้วผลเก่าไม่แทนผลใหม่ (Concurrency แถว 3), card แสดง method/URL/รอบตรวจ, Table มี header "เมธอด" และ "รอบตรวจ" พร้อมค่าต่อแถว, sparkline 24 แท่งกับชั่วโมง `null` และข้อความแทน, toggle test เดิมผ่าน, แถว Workspace caution/danger/expired ที่มีและไม่มี `issuer`/`notAfter`, แถวล่ม (รวมแถวที่ล่มและมี SSL warning) ไม่แสดงผู้ออกและวันหมดอายุ, ชื่อผู้ออกมี class `break-words`, วันที่ใน Workspace และ `SslCard` ตรงกัน, ข้อความแทนของ sparkline บอกแหล่งข้อมูลและจำนวนชั่วโมงที่ไม่มีข้อมูล, รอบตรวจใน card และ Table ตัวเลขเป็น monospace, URL ใน card ยังผ่าน test `:262`, mockup ไม่อยู่ในทั้งสองหน้า (layout จริงและ screenshot อยู่ใน NODE-59-03 เพราะ vitest บน happy-dom วัด layout ไม่ได้)
- **COVERS:** P59-01, P59-02, P59-03, P59-04, P59-05, P59-06, P59-07, P59-08, P59-10

### NODE-59-03 Integration verification

- **OWNER:** software-engineer
- **READY:** 01 และ 02 ผ่าน review ของ Technical Lead
- **OUTCOME:** e2e ตาม Integrated verification
- **SOURCE:** Integrated verification
- **INVARIANTS:** ไม่แก้ source ของ Task อื่น
- **FILES:** ไฟล์ใหม่ใน `e2e/`
- **NON-GOALS:** การแก้ e2e เดิม
- **CONTRACTS:** none
- **VERIFY:** e2e ที่เพิ่ม
- **PROOF:** log ของ e2e; screenshot ด้วย helper `shot` (`e2e/support/monitor-fixtures.ts:175`) ของ Cards, Table และ section 01 ของ Workspace ทั้ง light และ dark รวม Table และ section 01 ที่ 640 px โดยผู้ออกชื่อยาวตัดบรรทัดในคอลัมน์ 170 px และหน้าไม่เลื่อนแนวนอน (LAY-02)
- **COVERS:** P59-02, P59-03, P59-04, P59-05, P59-06, P59-10

## Integrated verification

- e2e: องค์กรที่มี monitor ล่มหนึ่งตัวและปกติสองตัว ชื่อของตัวที่ล่มไม่อยู่ลำดับแรกตามตัวอักษร (ลำดับ `problems` และ `name` จึงต่างกัน) และอย่างน้อยหนึ่ง monitor มีผลตรวจที่วัดเวลาได้ใน 24 ชั่วโมงล่าสุด (sparkline มีข้อมูล) เปิด Overview ตรวจลำดับค่าเริ่มต้นและคอลัมน์ "เมธอด" กับ "รอบตรวจ" ในตาราง เลือก "ชื่อ A-Z" ตรวจลำดับและประกาศผล สลับเป็น "การ์ด" ตรวจ method, รอบตรวจ และข้อความแทนของ sparkline reload แล้วมุมมองยังเป็น "การ์ด" และ sort กลับเป็น "ปัญหาก่อน" (P59-02, P59-03, P59-04, P59-06)
- screenshot และ layout ที่ 640 px ตาม PROOF ของ NODE-59-03 รวมแถว SSL warning ใน section 01 ที่ผู้ออกชื่อยาว (P59-03, P59-05)
- e2e เดิม (`e2e/tests/monitors-access.spec.ts:384` ที่ใช้ region "ตารางมอนิเตอร์") ต้องผ่านโดยไม่แก้ ค่าเริ่มต้นยังเป็นตาราง [ตรวจแล้วโดย reviewer รอบ R1: `monitors-access.spec.ts:374-421` ไม่ตรวจจำนวนหรือลำดับคอลัมน์ Tab order ใช้ `tabTo` ที่บันทึกเฉพาะ stop ที่ตรงชื่อ (`:351-364`) select ใหม่จึงไม่กระทบ]
- gate รันครั้งเดียวหลัง writer ทุกตัวหยุด ตาม `scripts/quality/README.md`
- ผลจริงและช่องว่างบันทึกแยก พร้อม commit ที่ตรวจ ยังไม่มีผล (ยังไม่ implement)

## Open decisions

None

## Revisions

| Date | Change | Approved by user | `acceptanceVersion` |
| ---- | ------ | ---------------- | ------------------- |
| 2026-10-05 | ร่างแรกจากเนื้อหา issue #59 โดยข้าม Feature doc | Not yet | none |
| 2026-10-05 | ผู้ใช้ยืนยัน decision ทั้ง 11 ข้อผ่าน AskUserQuestion โดยตรง (team-lead ส่งต่อ ไม่ผ่าน Product Owner): OD-59-01 (a) ค่าเริ่มต้น `problems`, OD-59-02 (a) health group เท่านั้น, OD-59-03 (a) `h24`, OD-59-04 (a) `lastResponseTimeMs`, OD-59-05 (a) sparkline ฝังทุก request จาก rollup, OD-59-06 (a) คง `localStorage`, OD-59-07 (a) คง `การ์ด`/`ตาราง`, OD-59-08 (a) sort ไม่จำค่า, OD-59-09 (b) เพิ่มคอลัมน์ method/interval ใน Table (ขยายเกิน issue ที่ระบุเฉพาะ card), OD-59-10 ใช้ตำแหน่ง mockup จาก code ไม่เปิด canvas, PO-59-01 (a) ผู้ใช้รับแถว P59-01 ถึง P59-10 โดยตรง แก้ Contracts → Web (Table), NODE-59-02, NODE-59-03, P59-03 และเพิ่มแถว F-005 AC-05 ในข้อขัด spec ยังเป็น Draft | Not yet (ยืนยัน decision เท่านั้น ยังไม่อนุมัติ spec ทั้งฉบับ) | none |
| 2026-10-06 | Review รอบ 1 (code-reviewer, R1-01 ถึง R1-15 รับทั้งหมด): sparkline คำนวณ `avgMs` และชั่วโมงเริ่มต้นใน JS, Concurrency แถว 2 แก้เป็น READ COMMITTED, key ค่าเริ่มต้นไม่มี `sort`, COVERS ของ 02 เพิ่ม P59-08/P59-10 และ 03 เพิ่ม P59-06, FILES ของ 02 เหลือ fixture จริงสามไฟล์, ลำดับ option และข้อความประกาศของ sort, แถว Workspace ที่ล่มไม่แสดงผู้ออก, `MonitorListSort`, กติกา handoff ของ 01, `intervalText`, เลขบรรทัด ไม่เปลี่ยน AC | Not yet | none |
| 2026-10-06 | Review รอบ 2 (code-reviewer, R2-01 ถึง R2-10 รับทั้งหมด): ใช้ component `IntervalText` แทนการย้าย `intervalText`, `read-test-support.ts` เข้า FILES ของ 01 พร้อม seed ที่ไม่ใช่ default, fixture เพิ่ม `OverviewPage.test.tsx:583-634` และ `WorkspacePage.test.tsx:139-143,602-606`, `formatDate` ย้ายจาก `SslCard.tsx` ไป `format.tsx`, ข้อความแทนของ sparkline อ้าง CMP-05 และบอกชั่วโมงที่ไม่มีข้อมูล, PROOF ของ Concurrency แถว 2, P59-10 เพิ่มการตรวจ field ใหม่, scenario e2e แยก `problems` กับ `name` ได้, VERIFY เป็นคำสั่งจริง, ผู้ออกชื่อยาวตัดบรรทัด | Not yet | none |
| 2026-10-06 | Review รอบ 3 (code-reviewer, R3-01 ถึง R3-05 รับทั้งหมด, ครบเพดาน 3 รอบ): `packages/api-contract/src/monitor.test.ts` และ `read-membership.db.test.ts` เข้า FILES ของ 01 พร้อม VERIFY `packages/api-contract test` และ `apps/api typecheck`, screenshot และ layout 640 px ย้ายไป PROOF ของ 03 (COVERS เพิ่ม P59-05), URL ใน card อยู่ใน element ของตัวเอง, ข้อความแทนของ sparkline บอกแหล่งข้อมูล, วันที่ใน Workspace ไม่คัดลอก `font-mono` ของ `SslCard.tsx:68-69` | Not yet | none |
| 2026-10-06 | ผู้ใช้อนุมัติ spec ทั้งฉบับและให้ start authorization ผ่าน `/implement-issue` (team-lead ส่งต่อ) freeze acceptance, `COMMIT_MODE` owned-slice, `STOP_AT` merge-ready, branch `issue-59-monitor-list-sort-view` จาก `main` `a7da371` | ผู้ใช้ | `issue-59-AC-1` |
