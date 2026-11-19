# Checklist ตรวจ comment ก่อนลบรอบสอง

ลบตามข้อเสนอ D001 ถึง D168 แล้ว. เก็บเหตุผลและข้อสงสัยตามรายการที่ให้เก็บ. เอกสารนี้บันทึกการตรวจก่อนลบและผลการดำเนินการ.

## ขอบเขตและผลตรวจ

ตรวจ source และ configuration ที่ Git ติดตาม 643 paths จาก working tree หลัง cleanup รอบแรก. มีสถานะ reviewed 614 paths, protected 28 paths, missing 1 paths และ blocked 0 paths. ไม่นับ Markdown 41 ไฟล์, lockfile 2 ไฟล์ และ cache ที่ Git ไม่ติดตาม.

ลบครบ 168 ช่วงใน 107 ไฟล์แล้ว. Checkbox D001 ถึง D168 แสดงรายการที่ดำเนินการแล้ว. การตรวจรายไฟล์ที่เสร็จแล้วใช้ checkbox ที่เลือกไว้และระบุช่วงบรรทัดที่อ่าน. สถานะ reviewed หมายถึงพิจารณา comment กับโค้ดรอบข้าง ไม่ได้หมายความว่าอ่านทุกบรรทัด executable ของไฟล์ยาว.

อ้างอิง HEAD `6ce4e0e47ec6cd8e20d9f5ef25cdd3e88e3a5916` ร่วมกับเนื้อหา working tree ขณะตรวจ. บรรทัดใน checklist อ้างอิงก่อนลบรอบสอง. หลังแก้ไฟล์หรือเริ่มลบแล้วให้ใช้ข้อความ comment และ symbol ประกอบ เพราะเลขบรรทัดจะเลื่อน.

## หลักการคัดแยก

เสนอให้ลบเฉพาะข้อความที่ชื่อ symbol, type, implementation หรือ assertion อธิบายอยู่แล้ว. รายการ coverage และรหัสงานเก่าที่ไม่ได้อธิบายข้อจำกัดเป็นส่วนที่ลบได้.

เก็บเหตุผลที่ไม่ชัดจากโค้ด ข้อจำกัดด้าน security, concurrency, fixture isolation, platform และ protocol. เก็บ public contract ที่ type บอกไม่ครบ, legal notice และ directive ที่เครื่องมือใช้จริง. Generated code และ migration เก่ามีสถานะ protected และไม่มีรายการลบโดยตรง.

ถ้า block มีทั้งส่วนซ้ำและเหตุผล รายการลบระบุเฉพาะส่วนที่ซ้ำ. Header ของ `e2e/tests/monitors-list-sort-view.spec.ts` จึงแยกรายการ coverage ออกจากเหตุผลที่ไม่สร้าง `monitor_schedule` และการ seed ใหม่.

## ลำดับงาน

- [x] Frame. บันทึก path และ SHA-256 ของแต่ละไฟล์ก่อนตรวจ.
- [x] Fan out. ตรวจทีละไฟล์ตาม manifest ในแต่ละกลุ่ม.
- [x] Aggregate. ตรวจ path ให้ครบและไม่ซ้ำ ตรวจ hash และข้อความที่เสนอให้ลบกับ source จริง.
- [x] Report. ตรวจข้อเสนอและบันทึกการลบตามรายการ D001 ถึง D168.

throughput checkpoint: n/a, read-only investigation.

## รายการที่เสนอให้ลบ

### API

- [x] D001 [`apps/api/src/app.integration.test.ts:516-518`](../apps/api/src/app.integration.test.ts#L516-L518).
  ข้อความเริ่มต้น `// The schema's own boundaries (safe integer, decimal only) are covered by // packages/api-contract/src/auth.test.ts; this proves the route never`.
  เหตุผลที่เสนอให้ลบ ชื่อเทสต์ rejects an invalid member offset before opening a database connection และ connect/query spies บอกเงื่อนไขเดียวกันอยู่แล้ว ส่วนการชี้ coverage ไปอีกชุดไม่ใช่ข้อจำกัดของ runtime
  หลักฐาน apps/api/src/app.integration.test.ts:515-545, expect(connect).not.toHaveBeenCalled() และ expect(query).not.toHaveBeenCalled()

- [x] D002 [`apps/api/src/audit/events.db.test.ts:68`](../apps/api/src/audit/events.db.test.ts#L68-L68).
  ข้อความเริ่มต้น `// Whatever the services wrote must be readable by the read API contract.`.
  เหตุผลที่เสนอให้ลบ events อ่าน rows แล้ว parse ด้วย auditChangeSchema.array() ชัดเจน ประโยคนี้เพียงบรรยาย statement ถัดไป
  หลักฐาน apps/api/src/audit/events.db.test.ts:59-71, events และ auditChangeSchema.array().parse(row.changes)

- [x] D003 [`apps/api/src/audit/export-parity.db.test.ts:13-15`](../apps/api/src/audit/export-parity.db.test.ts#L13-L15).
  ข้อความเริ่มต้น `// The export reads events through readAuditEventBatch; the page through the // list API. Both build their filter from packages/db, and this proves that for`.
  เหตุผลที่เสนอให้ลบ header เป็นคำบรรยาย coverage ของ parity ที่ชื่อ describe และการเทียบผล viaExport/viaList ระบุแล้ว ไม่อธิบายข้อจำกัด fixture หรือ security
  หลักฐาน apps/api/src/audit/export-parity.db.test.ts:49-63, viaList; :182-289, describe the export selects the events the list shows และ expect(fromExport).toEqual(fromList)

- [x] D004 [`apps/api/src/audit/export.db.test.ts:82`](../apps/api/src/audit/export.db.test.ts#L82-L82).
  ข้อความเริ่มต้น `/** An export of the user in the given state, written as the owner role. */`.
  เหตุผลที่เสนอให้ลบ seedExport รับ organizationId/userId/state เป็น parameters และเขียนด้วย ctx.owner.sql.query อยู่แล้ว JSDoc เพียงทวน signature กับ body
  หลักฐาน apps/api/src/audit/export.db.test.ts:83-130, seedExport และ ctx.owner.sql.query สำหรับ audit_exports/audit_export_jobs

- [x] D005 [`apps/api/src/audit/read.db.test.ts:592`](../apps/api/src/audit/read.db.test.ts#L592-L592).
  ข้อความเริ่มต้น `// The list carries the same target shape for the export event.`.
  เหตุผลที่เสนอให้ลบ page.events.find(...).target ถูกเทียบกับ exportEvent.target โดยตรง ประโยคนี้เป็นป้ายบรรยาย assertion
  หลักฐาน apps/api/src/audit/read.db.test.ts:593-596, expect(page.events.find((e) => e.id === exported)?.target).toEqual(exportEvent.target)

- [x] D006 [`apps/api/src/auth/auth.db.test.ts:2206-2209`](../apps/api/src/auth/auth.db.test.ts#L2206-L2209).
  ข้อความเริ่มต้น `// Role PATCH, revoke, leave and the LAST_OWNER guard through the // first-party routes are covered by organization-notifications/routes.db.test.ts`.
  เหตุผลที่เสนอให้ลบ เป็น inventory ว่าชุดอื่นครอบคลุม first-party mutations ใดบ้าง ไม่อธิบายเหตุผลของ denial/race fixture และไม่ใช่ constraint ของ security logic
  หลักฐาน apps/api/src/auth/auth.db.test.ts:2170-2210, directResponses ทุกตัวต้องเป็น 403 และ memberMutationSnapshot ต้องเท่ากับ before; apps/api/src/organization-notifications/routes.db.test.ts:631-688 และ :1238-1397 แสดง first-party denial/session contracts

- [x] D007 [`apps/api/src/monitors/project-scope.db.test.ts:79`](../apps/api/src/monitors/project-scope.db.test.ts#L79-L79).
  ข้อความเริ่มต้น `/** Needs a monitor in the path. */`.
  เหตุผลที่เสนอให้ลบ Route.monitor ถูกใช้เลือกเติม monitorId ใน pathOf โดยตรง ป้ายนี้ทวน ternary โดยไม่เพิ่มข้อจำกัด
  หลักฐาน apps/api/src/monitors/project-scope.db.test.ts:144-149, route.monitor ? `/${monitorId}${route.suffix}` : route.suffix

- [x] D008 [`apps/api/src/monitors/read-detail.db.test.ts:386-387`](../apps/api/src/monitors/read-detail.db.test.ts#L386-L387).
  ข้อความเริ่มต้น `// The full boundary matrix is the unit source of truth (health.test.ts, // computeSsl); these two rows only prove the route wires it through.`.
  เหตุผลที่เสนอให้ลบ เป็น coverage inventory ของ SSL matrix ส่วน table และ assertions ในเทสต์ระบุ route wiring ที่ตรวจอยู่แล้ว ไม่มี timing rationale ในสองบรรทัดนี้
  หลักฐาน apps/api/src/monitors/read-detail.db.test.ts:384-407, it.each สองแถว และ expect(view.ssl).toMatchObject({ state: level, daysRemaining: days, host: "ssl.example" })

- [x] D009 [`apps/api/src/monitors/read-event-feed.db.test.ts:101-104`](../apps/api/src/monitors/read-event-feed.db.test.ts#L101-L104).
  ข้อความเริ่มต้น `// Every role can read, a non-member is denied, and a missing/malformed/ // foreign id answers 404: read-detail.db.test.ts's "Detail, Checks and`.
  เหตุผลที่เสนอให้ลบ เป็นรายการ coverage ข้ามชุดและคำบอกให้เก็บเทสต์ ไม่ใช่เหตุผลของ runtime behavior ตัว suffix loop และ no-session test เป็นหลักฐานโดยตรงอยู่แล้ว
  หลักฐาน apps/api/src/monitors/read-detail.db.test.ts:832-920, suffixes มี /events และ access assertions; apps/api/src/monitors/read-event-feed.db.test.ts:106-109, answers 401 without a session

- [x] D010 [`apps/api/src/monitors/read-list.db.test.ts:259-260`](../apps/api/src/monitors/read-list.db.test.ts#L259-L260).
  ข้อความเริ่มต้น `// The full boundary matrix is the unit source of truth (health.test.ts, // computeSsl); these two rows only prove the route wires it through.`.
  เหตุผลที่เสนอให้ลบ เป็น coverage inventory ซ้ำกับ SSL table/route assertions ลบเฉพาะสองบรรทัดนี้โดยเก็บ fixture expiry/ceil rationale ที่บรรทัด 265-266
  หลักฐาน apps/api/src/monitors/read-list.db.test.ts:257-283, it.each และ expect(item?.ssl).toEqual({ level, daysRemaining: days, ... })

- [x] D011 [`apps/api/src/monitors/read-list.db.test.ts:368`](../apps/api/src/monitors/read-list.db.test.ts#L368-L368).
  ข้อความเริ่มต้น `// ---- sort (#59) -------------------------------------------------------------`.
  เหตุผลที่เสนอให้ลบ เป็น section banner พร้อม Issue #59 เท่านั้น describe List: sort และ seedSortOrganization ทำให้ค้นพบส่วนนี้อยู่แล้ว
  หลักฐาน apps/api/src/monitors/read-list.db.test.ts:383-433, seedSortOrganization, SORT_ORDERS และ describe("List: sort")

- [x] D012 [`apps/api/src/monitors/read-list.db.test.ts:370-382`](../apps/api/src/monitors/read-list.db.test.ts#L370-L382).
  ข้อความเริ่มต้น `/** * Six monitors with distinct values per sort key, a null on both the uptime and`.
  เหตุผลที่เสนอให้ลบ ตารางเป็นสำเนาค่าจาก seedSortOrganization และคำบรรยายว่ามี null/tie ซึ่ง ids, seedResults และ SORT_ORDERS แสดงโดยตรง ไม่ใช่ timing หรือ isolation rationale
  หลักฐาน apps/api/src/monitors/read-list.db.test.ts:383-422, ids ของ Alpha/bravo/Charlie/delta/echo/foxtrot, update created_at ให้ echo/foxtrot เท่ากัน, seedResults และ SORT_ORDERS

- [x] D013 [`apps/api/src/monitors/read-response-times.db.test.ts:323-325`](../apps/api/src/monitors/read-response-times.db.test.ts#L323-L325).
  ข้อความเริ่มต้น `// Every role can read, a non-member is denied like a missing Organization, // and a missing/malformed/foreign id answers 404: read-detail.db.test.ts's`.
  เหตุผลที่เสนอให้ลบ เป็น inventory ของ access coverage ข้ามชุด ไม่เพิ่มข้อจำกัดนอก suffixes และ assertions ที่มีอยู่
  หลักฐาน apps/api/src/monitors/read-detail.db.test.ts:832-920, suffixes มี /response-times, ?range=7d, ?range=30d พร้อม role/nonmember/malformed/foreign assertions; apps/api/src/monitors/read-response-times.db.test.ts:327-335, unknown-range test

- [x] D014 [`apps/api/src/monitors/secrets.db.test.ts:928`](../apps/api/src/monitors/secrets.db.test.ts#L928-L928).
  ข้อความเริ่มต้น `// The first hop carried the value.`.
  เหตุผลที่เสนอให้ลบ เป็นประโยคทวนว่า first hop มีค่า ซึ่ง target.seen[0].headers.authorization assertion ระบุอยู่แล้ว ไม่ลบข้อกำหนดไม่ส่ง secrets ไป host/port อื่น
  หลักฐาน apps/api/src/monitors/secrets.db.test.ts:917-931, not forward secrets test, authorization ของ hops เป็น undefined และ first hop เท่ากับ Bearer TOKEN

- [x] D015 [`apps/api/src/monitors/test-route.db.test.ts:443`](../apps/api/src/monitors/test-route.db.test.ts#L443-L443).
  ข้อความเริ่มต้น `// Strict: fields outside the Test contract fail the parse.`.
  เหตุผลที่เสนอให้ลบ resultOf เรียก monitorTestResultSchema.strict().parse อย่างชัดเจน คำบรรยาย strict parsing ไม่เพิ่มเหตุผลที่โค้ดแสดงไม่ได้
  หลักฐาน apps/api/src/monitors/test-route.db.test.ts:439-445, resultOf และ monitorTestResultSchema.strict().parse(body.result)

- [x] D016 [`apps/api/src/operator/provision-organization.db.test.ts:116`](../apps/api/src/operator/provision-organization.db.test.ts#L116-L116).
  ข้อความเริ่มต้น `// One transaction created, the other re-sent with a rotated id.`.
  เหตุผลที่เสนอให้ลบ ประโยคทวน resent-count และ invitationId inequality assertions ถัดไป โดยไม่ได้อธิบายการจัดคิวหรือ race barrier
  หลักฐาน apps/api/src/operator/provision-organization.db.test.ts:103-122, serializes concurrent retries และ resent filter ต้องมีหนึ่งรายการ พร้อม invitationId ไม่เท่ากัน

- [x] D017 [`apps/api/src/operator/provision-organization.db.test.ts:137`](../apps/api/src/operator/provision-organization.db.test.ts#L137-L137).
  ข้อความเริ่มต้น `// Concurrent retries while it is live re-send it, never add another.`.
  เหตุผลที่เสนอให้ลบ Promise.all(provision(args), provision(args)) พร้อม resent=true ทั้งสองและ live invitation เหลือหนึ่งอธิบาย retry behavior ครบแล้ว เป็นคำบรรยายขั้นตอน
  หลักฐาน apps/api/src/operator/provision-organization.db.test.ts:138-149, retryA/retryB resent และ afterRetries มีหนึ่งรายการ


### Web foundation และ configuration

- [x] D018 [`apps/web/scripts/codegen-openapi.mjs:4-5`](../apps/web/scripts/codegen-openapi.mjs#L4-L5).
  ข้อความเริ่มต้น ``* Regenerate src/lib/api/openapi-types.gen.ts from the API's OpenAPI * document. Run via `bun run codegen` in apps/web.``.
  เหตุผลที่เสนอให้ลบ package.json ระบุ codegen และ outFile ระบุไฟล์ปลายทางอยู่แล้ว
  หลักฐาน apps/web/package.json:8; apps/web/scripts/codegen-openapi.mjs:21-24,43-50

- [x] D019 [`apps/web/src/components/shell/AppShell.test.tsx:415`](../apps/web/src/components/shell/AppShell.test.tsx#L415-L415).
  ข้อความเริ่มต้น `// A labelled section, not an accordion: no expandable control.`.
  เหตุผลที่เสนอให้ลบ queryByRole button และ aria-current assertions บอกลักษณะ navigation อยู่แล้ว
  หลักฐาน apps/web/src/components/shell/AppShell.test.tsx:416-438

- [x] D020 [`apps/web/src/components/shell/AppShell.test.tsx:434`](../apps/web/src/components/shell/AppShell.test.tsx#L434-L434).
  ข้อความเริ่มต้น `// Palette-only sub-destinations never become sidebar rows.`.
  เหตุผลที่เสนอให้ลบ queryByTestId settings/sessions เป็น null ระบุสิ่งที่ไม่แสดงอยู่แล้ว
  หลักฐาน apps/web/src/components/shell/AppShell.test.tsx:435-438

- [x] D021 [`apps/web/src/components/shell/AppShell.test.tsx:479-480`](../apps/web/src/components/shell/AppShell.test.tsx#L479-L480).
  ข้อความเริ่มต้น `// A bookmarked URL for Org B while Org A is active: the page acts on B, so the crumb says B // and the sidebar's org leaf (linking to A) is not current.`.
  เหตุผลที่เสนอให้ลบ ชื่อเทสต์และ renderShell กับ assertions ระบุ Org B ใน URL ขณะ Org A active ครบแล้ว
  หลักฐาน apps/web/src/components/shell/AppShell.test.tsx:478-519

- [x] D022 [`apps/web/src/components/shell/Page.tsx:40-41`](../apps/web/src/components/shell/Page.tsx#L40-L41).
  ข้อความเริ่มต้น `// Same marks as the sidebar: an organization is solid Primary with On primary // initials; a person is the inset avatar with a strong edge.`.
  เหตุผลที่เสนอให้ลบ ScopeMark ระบุ class ของ org และ person ตรงตัวอยู่แล้ว
  หลักฐาน apps/web/src/components/shell/Page.tsx:42-57

- [x] D023 [`apps/web/src/components/shell/Page.tsx:60`](../apps/web/src/components/shell/Page.tsx#L60-L60).
  ข้อความเริ่มต้น ``// TYP-04: eyebrow is a Latin route code such as `// overview`.``.
  เหตุผลที่เสนอให้ลบ eyebrow prop มีสัญญา Latin route code ที่บรรทัด 80 อยู่แล้ว เก็บบรรทัด 61 ที่บอกหน้าที่ caller เรื่อง font
  หลักฐาน apps/web/src/components/shell/Page.tsx:80-81,112-120

- [x] D024 [`apps/web/src/components/shell/ProjectSwitcher.test.tsx:158`](../apps/web/src/components/shell/ProjectSwitcher.test.tsx#L158-L158).
  ข้อความเริ่มต้น `/** Holds every Project list fetch until it resolves. */`.
  เหตุผลที่เสนอให้ลบ listGate เป็น Promise และ fetchProjectListMock await ตัวแปรนี้โดยตรง
  หลักฐาน apps/web/src/components/shell/ProjectSwitcher.test.tsx:149-164

- [x] D025 [`apps/web/src/components/shell/ProjectSwitcher.test.tsx:451`](../apps/web/src/components/shell/ProjectSwitcher.test.tsx#L451-L451).
  ข้อความเริ่มต้น `// Opening and closing the menu re-renders the shell; nothing is sent again.`.
  เหตุผลที่เสนอให้ลบ ชื่อเทสต์ระบุ once และคำสั่ง openMenu, Escape, toHaveBeenCalledTimes(1) ครบแล้ว
  หลักฐาน apps/web/src/components/shell/ProjectSwitcher.test.tsx:441-454

- [x] D026 [`apps/web/src/components/shell/ProjectSwitcher.test.tsx:815`](../apps/web/src/components/shell/ProjectSwitcher.test.tsx#L815-L815).
  ข้อความเริ่มต้น `// Still the fetched "nothing remembered"; the retired instance wrote nothing.`.
  เหตุผลที่เสนอให้ลบ ชื่อเทสต์ระบุ retired instance ไม่เขียน cache และ assertion ระบุ projectId null ชัดเจน
  หลักฐาน apps/web/src/components/shell/ProjectSwitcher.test.tsx:797-816

- [x] D027 [`apps/web/src/components/ui/confirm-dialog.test.tsx:112`](../apps/web/src/components/ui/confirm-dialog.test.tsx#L112-L112).
  ข้อความเริ่มต้น `// DOM order is link, input, Cancel, confirm; initial focus is Cancel.`.
  เหตุผลที่เสนอให้ลบ StaticDialog วาง link/input ก่อนปุ่ม และเทสต์ assert Cancel ก่อน Tab ไป confirm/link/input อยู่แล้ว
  หลักฐาน apps/web/src/components/ui/confirm-dialog.test.tsx:23-29,106-122

- [x] D028 [`apps/web/src/components/ui/mockup-frame.tsx:9`](../apps/web/src/components/ui/mockup-frame.tsx#L9-L9).
  ข้อความเริ่มต้น `/** The CMP-06 notice line: what the region is, and the issue that will back it. */`.
  เหตุผลที่เสนอให้ลบ MOCKUP_NOTICE และ anchor แสดง notice กับ issue อยู่แล้ว ไม่มีข้อจำกัดเพิ่มในหัวข้อนี้
  หลักฐาน apps/web/src/components/ui/mockup-frame.tsx:5-7,22-42

- [x] D029 [`apps/web/src/components/ui/response-time-chart.test.tsx:25`](../apps/web/src/components/ui/response-time-chart.test.tsx#L25-L25).
  ข้อความเริ่มต้น `/** Three checks, a gap, a pause, then one more check: six selectable steps. */`.
  เหตุผลที่เสนอให้ลบ props24h ระบุทุก point, gap และ pause โดยตรง จำนวนขั้นเป็น inventory ของ fixture
  หลักฐาน apps/web/src/components/ui/response-time-chart.test.tsx:26-45

- [x] D030 [`apps/web/src/components/ui/response-time-chart.test.tsx:627`](../apps/web/src/components/ui/response-time-chart.test.tsx#L627-L627).
  ข้อความเริ่มต้น `// Without a creation time the same results leave a long leading gap.`.
  เหตุผลที่เสนอให้ลบ buildSeries ที่ส่ง createdAt undefined และ expected gap,value,value ระบุผลนี้ชัดเจนแล้ว
  หลักฐาน apps/web/src/components/ui/response-time-chart.test.tsx:628-630

- [x] D031 [`apps/web/src/components/ui/response-time-series.ts:46`](../apps/web/src/components/ui/response-time-series.ts#L46-L46).
  ข้อความเริ่มต้น `/** Maps the API's two shapes (24 h points and gaps, 7 d and 30 d hourly buckets) to chart props. */`.
  เหตุผลที่เสนอให้ลบ toChartProps ระบุ response type และ map points/gaps หรือ hourly buckets ชัดเจนอยู่แล้ว
  หลักฐาน apps/web/src/components/ui/response-time-series.ts:47-100

- [x] D032 [`apps/web/src/components/ui/response-time-series.ts:103`](../apps/web/src/components/ui/response-time-series.ts#L103-L103).
  ข้อความเริ่มต้น `/** The window the chart spans: the range, but never earlier than the monitor's creation. */`.
  เหตุผลที่เสนอให้ลบ createdAt prop มีสัญญาเริ่มที่ creation อยู่แล้ว และ chartWindow ใช้ Math.max โดยตรง
  หลักฐาน apps/web/src/components/ui/response-time-series.ts:41-42,104-111

- [x] D033 [`apps/web/src/components/ui/response-time-series.ts:328`](../apps/web/src/components/ui/response-time-series.ts#L328-L328).
  ข้อความเริ่มต้น `// A change belongs to the last step that started at or before it.`.
  เหตุผลที่เสนอให้ลบ ลูป configChanges ตั้ง owner เป็น entry สุดท้ายที่ at ไม่เกิน change โดยตรง
  หลักฐาน apps/web/src/components/ui/response-time-series.ts:329-335

- [x] D034 [`apps/web/src/components/ui/response-time-series.ts:360`](../apps/web/src/components/ui/response-time-series.ts#L360-L360).
  ข้อความเริ่มต้น `// Only a sliver at the window's edge is tolerated; an uncovered stretch between pauses is real activity.`.
  เหตุผลที่เสนอให้ลบ pausedThroughout JSDoc ระบุ tolerate เฉพาะขอบและไม่ tolerate ระหว่าง pauses ครบแล้ว
  หลักฐาน apps/web/src/components/ui/response-time-series.ts:340-345,361-365

- [x] D035 [`apps/web/src/index.css:94-99`](../apps/web/src/index.css#L94-L99).
  ข้อความเริ่มต้น `* After the ten roles each block adds the derived values the doc defines: * On danger (COL-05), Primary tint (Tokens), Danger tint (COL-06), the`.
  เหตุผลที่เสนอให้ลบ เป็นรายการชื่อ derived tokens และ texture ที่ declarations, @theme และ @utility ระบุอยู่แล้ว ไม่ใช่เหตุผลของค่า
  หลักฐาน apps/web/src/index.css:117-126,143-150,204-250,345-371

- [x] D036 [`apps/web/src/lib/api/client.ts:235`](../apps/web/src/lib/api/client.ts#L235-L235).
  ข้อความเริ่มต้น ``// Only GET paths whose success body is a file (`text/csv`) qualify.``.
  เหตุผลที่เสนอให้ลบ FilePaths เลือก GET ผ่าน FileOperation และตรวจ 200 text/csv string ตรงตัวอยู่แล้ว
  หลักฐาน apps/web/src/lib/api/client.ts:230-242

- [x] D037 [`apps/web/src/lib/auth-client.ts:69`](../apps/web/src/lib/auth-client.ts#L69-L69).
  ข้อความเริ่มต้น ``// Resolves better-auth errors to Thai copy by `code`, then rate-limit status, else the caller's fallback.``.
  เหตุผลที่เสนอให้ลบ authErrorMessage ใช้ mapped ตาม code แล้ว status 429 แล้ว fallback อยู่แล้ว เก็บบรรทัด 70 ที่อธิบายเหตุผลไม่ใช้ error.message
  หลักฐาน apps/web/src/lib/auth-client.ts:80-90

- [x] D038 [`apps/web/src/lib/auth/identityLifecycle.test.tsx:178`](../apps/web/src/lib/auth/identityLifecycle.test.tsx#L178-L178).
  ข้อความเริ่มต้น `// Real gate loaders and RootLayout wiring; only the page bodies are probes.`.
  เหตุผลที่เสนอให้ลบ lifecycleRoutes ระบุ RootLayout, workspaceLoader, projectOverviewLoader และ ContextProbe ตรงตัวอยู่แล้ว
  หลักฐาน apps/web/src/lib/auth/identityLifecycle.test.tsx:179-201

- [x] D039 [`apps/web/src/test/pendingInvitations.ts:3`](../apps/web/src/test/pendingInvitations.ts#L3-L3).
  ข้อความเริ่มต้น `/** Default list stub for page tests that do not exercise the invitation section. */`.
  เหตุผลที่เสนอให้ลบ emptyPendingInvitationList คืน invitations ว่างกับ activeCount/total เป็นศูนย์โดยตรง เป็นเพียงคำบรรยาย helper
  หลักฐาน apps/web/src/test/pendingInvitations.ts:4-13


### Web pages

- [x] D040 [`apps/web/src/pages/AcceptInvitationPage.test.tsx:202`](../apps/web/src/pages/AcceptInvitationPage.test.tsx#L202-L202).
  ข้อความเริ่มต้น `// Signup routes to the resend hub with the invitation remembered for post-verification acceptance.`.
  เหตุผลที่เสนอให้ลบ assertions ตรวจ /verify-email, readInvitation และ callbackURL ครบแล้ว
  หลักฐาน apps/web/src/pages/AcceptInvitationPage.test.tsx:203-215 expect(location), readInvitation(), signUpEmailMock

- [x] D041 [`apps/web/src/pages/LoginPage.test.tsx:234`](../apps/web/src/pages/LoginPage.test.tsx#L234-L234).
  ข้อความเริ่มต้น `// Each of these is recoverable: the error links to the anonymous-safe resend hub.`.
  เหตุผลที่เสนอให้ลบ ชื่อ offers the resend page และ assertions ตรวจ error/link ระบุผลแต่ละกรณีอยู่แล้ว
  หลักฐาน apps/web/src/pages/LoginPage.test.tsx:235-250 it.each offers the resend page; login-verify-email

- [x] D042 [`apps/web/src/pages/NotificationsPage.tsx:90`](../apps/web/src/pages/NotificationsPage.tsx#L90-L90).
  ข้อความเริ่มต้น `// Scope and category, rendered as two parts rather than one dotted string.`.
  เหตุผลที่เสนอให้ลบ itemContext คืน tuple [scope, category] ตรงตามชนิดและทุก branch โดยไม่อธิบายเหตุผลเพิ่มเติม
  หลักฐาน apps/web/src/pages/NotificationsPage.tsx:91-99 itemContext(): [string, string]

- [x] D043 [`apps/web/src/pages/NotificationsPage.tsx:169`](../apps/web/src/pages/NotificationsPage.tsx#L169-L169).
  ข้อความเริ่มต้น `// Absolute times follow the time zone and hour cycle chosen on /settings/display.`.
  เหตุผลที่เสนอให้ลบ itemTime ส่ง preferences เข้า formatDateTime ตรง ๆ ไม่เพิ่มข้อจำกัดนอกโค้ด
  หลักฐาน apps/web/src/pages/NotificationsPage.tsx:170-172 itemTime; formatDateTime(new Date(value), preferences)

- [x] D044 [`apps/web/src/pages/OrganizationMembersPage.test.tsx:229-233`](../apps/web/src/pages/OrganizationMembersPage.test.tsx#L229-L233).
  ข้อความเริ่มต้น `// The outcome messages (pre-insert failure, SMTP accepted, SMTP failed) are // each asserted by InvitationPanel.test.tsx; this page-level test only`.
  เหตุผลที่เสนอให้ลบ เป็น coverage inventory ชี้ชุดทดสอบอื่น ส่วนชื่อเคสปัจจุบันระบุการรักษา draft ขณะ refetch/pagination แล้ว
  หลักฐาน apps/web/src/pages/OrganizationMembersPage.test.tsx:234-245 it keeps the organization invitation mounted across refetch and pagination

- [x] D045 [`apps/web/src/pages/OrganizationMembersPage.test.tsx:1225-1226`](../apps/web/src/pages/OrganizationMembersPage.test.tsx#L1225-L1226).
  ข้อความเริ่มต้น `// The retry after a confirmed, unchanged membership requests the same // organization and page, not a reset.`.
  เหตุผลที่เสนอให้ลบ assertions ถัดไปตรวจสองคำขอด้วย organizationId, limit และ offset เดิมครบแล้ว
  หลักฐาน apps/web/src/pages/OrganizationMembersPage.test.tsx:1227-1239 toHaveBeenCalledTimes(2), toHaveBeenNthCalledWith

- [x] D046 [`apps/web/src/pages/VerifyEmailPage.test.tsx:140`](../apps/web/src/pages/VerifyEmailPage.test.tsx#L140-L140).
  ข้อความเริ่มต้น `// Generic confirmation; the invitation stays stored for the post-verification continuation.`.
  เหตุผลที่เสนอให้ลบ assertions ระบุ sent confirmation และ readInvitation เดิมอยู่แล้ว ไม่ได้เพิ่มเหตุผล enumeration
  หลักฐาน apps/web/src/pages/VerifyEmailPage.test.tsx:141-142 verify-email-sent; readInvitation()

- [x] D047 [`apps/web/src/pages/audit-log/AuditExport.test.tsx:554`](../apps/web/src/pages/audit-log/AuditExport.test.tsx#L554-L554).
  ข้อความเริ่มต้น `// C6-02: the page's live region is there before the request, empty.`.
  เหตุผลที่เสนอให้ลบ getByTestId ตามด้วย role status และ toBeEmptyDOMElement ระบุสถานะก่อน request แล้ว
  หลักฐาน apps/web/src/pages/audit-log/AuditExport.test.tsx:555-560 audit-export-announcement; toBeEmptyDOMElement()

- [x] D048 [`apps/web/src/pages/audit-log/AuditExport.test.tsx:861`](../apps/web/src/pages/audit-log/AuditExport.test.tsx#L861-L861).
  ข้อความเริ่มต้น `// N-1: no dialog and no second notice; focus stays on the (now aria-disabled) button.`.
  เหตุผลที่เสนอให้ลบ บอกลำดับ assertions ของ dialog, notice, aria-disabled และ focus ซ้ำทั้งหมด
  หลักฐาน apps/web/src/pages/audit-log/AuditExport.test.tsx:862-867 queryByTestId; aria-disabled; toHaveFocus

- [x] D049 [`apps/web/src/pages/audit-log/AuditLogPage.test.tsx:803-804`](../apps/web/src/pages/audit-log/AuditLogPage.test.tsx#L803-L804).
  ข้อความเริ่มต้น `// An auditor's read access and the absence of export controls are covered // by AuditExport.test.tsx's "does not render the button..." case.`.
  เหตุผลที่เสนอให้ลบ เป็น coverage-only note ชี้ชื่อเคสใน AuditExport ไม่ใช่ข้อจำกัดของโค้ดหรือ fixture
  หลักฐาน apps/web/src/pages/audit-log/AuditLogPage.test.tsx:795-805 จบ describe ของ denial ก่อน describe Organization scope

- [x] D050 [`apps/web/src/pages/audit-log/AuditLogPage.tsx:262`](../apps/web/src/pages/audit-log/AuditLogPage.tsx#L262-L262).
  ข้อความเริ่มต้น `// Coming back from a detail page puts focus on that row's link, else on the table heading.`.
  เหตุผลที่เสนอให้ลบ effect ตรวจ returnedTo แล้ว focus rowLinks หรือ tableHeadingRef โดยตรง
  หลักฐาน apps/web/src/pages/audit-log/AuditLogPage.tsx:263-275 returnedTo; restoredFocus; rowLinks.current.get

- [x] D051 [`apps/web/src/pages/audit-log/ExportDialog.tsx:80`](../apps/web/src/pages/audit-log/ExportDialog.tsx#L80-L80).
  ข้อความเริ่มต้น `// Pressing again while a request is out changes nothing (M-3).`.
  เหตุผลที่เสนอให้ลบ เป็นการอ่านเงื่อนไข inFlight.current ซ้ำ ไม่มีเหตุผลเรื่อง focus หรือ protocol
  หลักฐาน apps/web/src/pages/audit-log/ExportDialog.tsx:79-85 submit; if (inFlight.current || tooLarge) return

- [x] D052 [`apps/web/src/pages/monitors/ChecksHistoryPage.test.tsx:151`](../apps/web/src/pages/monitors/ChecksHistoryPage.test.tsx#L151-L151).
  ข้อความเริ่มต้น ``/** One response of the checks API: the results numbered `numbers`, read at `offset` of `total`. */``.
  เหตุผลที่เสนอให้ลบ ชื่อ chunk และชนิด MonitorChecksResponse รวมกับ object return ระบุ numbers/offset/total แล้ว
  หลักฐาน apps/web/src/pages/monitors/ChecksHistoryPage.test.tsx:152-162 chunk; checks: numbers.map; page: { limit: 50, offset, total }

- [x] D053 [`apps/web/src/pages/monitors/ChecksHistoryPage.test.tsx:532`](../apps/web/src/pages/monitors/ChecksHistoryPage.test.tsx#L532-L532).
  ข้อความเริ่มต้น `// Newer rows are left out: the order stays newest first and the count stays honest.`.
  เหตุผลที่เสนอให้ลบ expected times และ count ระบุการตัด newer rows พร้อมลำดับชัดแล้ว
  หลักฐาน apps/web/src/pages/monitors/ChecksHistoryPage.test.tsx:533-534 timesOf().toEqual(span(0, 50).map(scheduled)); waitCount

- [x] D054 [`apps/web/src/pages/monitors/ChecksHistoryPage.tsx:48`](../apps/web/src/pages/monitors/ChecksHistoryPage.tsx#L48-L48).
  ข้อความเริ่มต้น `// Same outline as the page titles of the audit log (AuditLogPage.tsx).`.
  เหตุผลที่เสนอให้ลบ เป็น provenance ว่า style เหมือนอีกไฟล์ ไม่มี WHY หรือข้อจำกัด
  หลักฐาน apps/web/src/pages/monitors/ChecksHistoryPage.tsx:49-50 TITLE_FOCUS_CLASS

- [x] D055 [`apps/web/src/pages/monitors/DetailEventFeed.test.tsx:751`](../apps/web/src/pages/monitors/DetailEventFeed.test.tsx#L751-L751).
  ข้อความเริ่มต้น `// The pager shows only when there is another page to reach or a page to return from.`.
  เหตุผลที่เสนอให้ลบ เป็น header บอก coverage ที่ describe และตาราง cases ระบุแล้ว
  หลักฐาน apps/web/src/pages/monitors/DetailEventFeed.test.tsx:752-765 Pagination threshold; cases [1,1,false], [20,20,false], [21,20,true]

- [x] D056 [`apps/web/src/pages/monitors/DetailPage.test.tsx:1974`](../apps/web/src/pages/monitors/DetailPage.test.tsx#L1974-L1974).
  ข้อความเริ่มต้น `// Two results, then the gap from the last one to now (and one before the first).`.
  เหตุผลที่เสนอให้ลบ expected record gap/value ระบุสองผลกับช่องว่างก่อนและหลังครบแล้ว
  หลักฐาน apps/web/src/pages/monitors/DetailPage.test.tsx:1975-1980 rows.toEqual record(gap), record(value)

- [x] D057 [`apps/web/src/pages/monitors/DetailPage.test.tsx:2030`](../apps/web/src/pages/monitors/DetailPage.test.tsx#L2030-L2030).
  ข้อความเริ่มต้น `// The keyboard hint stays off the accessibility tree and the polite region stays.`.
  เหตุผลที่เสนอให้ลบ assertions ถัดไปตรวจ aria-hidden และ aria-live polite ชัดเจนแล้ว
  หลักฐาน apps/web/src/pages/monitors/DetailPage.test.tsx:2031-2038 monitor-response-readout; monitor-response-live

- [x] D058 [`apps/web/src/pages/monitors/DetailPage.tsx:498`](../apps/web/src/pages/monitors/DetailPage.tsx#L498-L498).
  ข้อความเริ่มต้น ``// COL-08: a static glow in the badge's own Danger role while the incident is active and the data is fresh (`useDataFresh`).``.
  เหตุผลที่เสนอให้ลบ บอกเงื่อนไข bannerShown && fresh และ glow-danger ซ้ำ ไม่มีเหตุผลเพิ่มเติม
  หลักฐาน apps/web/src/pages/monitors/DetailPage.tsx:495-509 bannerShown; badgeGlow; className glow-danger

- [x] D059 [`apps/web/src/pages/monitors/MonitorFormAdvanced.test.tsx:454`](../apps/web/src/pages/monitors/MonitorFormAdvanced.test.tsx#L454-L454).
  ข้อความเริ่มต้น `// The former row 3 is now row 2 and takes the focus.`.
  เหตุผลที่เสนอให้ลบ ตัวแปร thirdHeader และ assertions name/focus ระบุ row ที่เหลือและรับ focus อยู่แล้ว
  หลักฐาน apps/web/src/pages/monitors/MonitorFormAdvanced.test.tsx:449-464 remove secondHeader; thirdHeader X-Third; toHaveFocus

- [x] D060 [`apps/web/src/pages/monitors/MonitorFormSecrets.test.tsx:925-928`](../apps/web/src/pages/monitors/MonitorFormSecrets.test.tsx#L925-L928).
  ข้อความเริ่มต้น `// Path, query and default-port equivalence are unit-tested directly against // secretOriginChanged in form/secrets.test.tsx's "treats %s as %s" it.each;`.
  เหตุผลที่เสนอให้ลบ เป็น coverage inventory ชี้ unit tests อื่นและสรุป assertions ของเคสถัดไป ไม่มีเหตุผล race/security เพิ่ม
  หลักฐาน apps/web/src/pages/monitors/MonitorFormSecrets.test.tsx:929-946 it keeps Save and Test on with a kept secret when only a path changes; secret action keep

- [x] D061 [`apps/web/src/pages/monitors/MonitorFormSecrets.test.tsx:1263`](../apps/web/src/pages/monitors/MonitorFormSecrets.test.tsx#L1263-L1263).
  ข้อความเริ่มต้น `/** Every place a value could linger: markup, query cache, storage and the console. */`.
  เหตุผลที่เสนอให้ลบ findSecrets ประกาศ places ด้วยชื่อ markup/queryCache/localStorage/sessionStorage/console ครบแล้ว
  หลักฐาน apps/web/src/pages/monitors/MonitorFormSecrets.test.tsx:1264-1288 findSecrets; const places; Object.entries(places)

- [x] D062 [`apps/web/src/pages/monitors/MonitorFormSecrets.test.tsx:1486`](../apps/web/src/pages/monitors/MonitorFormSecrets.test.tsx#L1486-L1486).
  ข้อความเริ่มต้น `// The switch leaves for the Projects of B; the form is then opened again in one of them.`.
  เหตุผลที่เสนอให้ลบ บรรยายเส้นทางที่ assertion และ openedRouter.navigate ระบุชัดแล้ว
  หลักฐาน apps/web/src/pages/monitors/MonitorFormSecrets.test.tsx:1478-1494 location /projects; navigate(newPath(B)); empty secret input

- [x] D063 [`apps/web/src/pages/monitors/MonitorTable.tsx:102`](../apps/web/src/pages/monitors/MonitorTable.tsx#L102-L102).
  ข้อความเริ่มต้น `// The dash is the visible mark of a missing value; the sentence is for screen readers.`.
  เหตุผลที่เสนอให้ลบ NoData ใช้ aria-hidden กับ dash และ sr-only กับ NO_DATA ชัดเจน ไม่มี WHY เพิ่ม
  หลักฐาน apps/web/src/pages/monitors/MonitorTable.tsx:103-109 NoData span aria-hidden / sr-only

- [x] D064 [`apps/web/src/pages/monitors/OverviewPage.test.tsx:2029`](../apps/web/src/pages/monitors/OverviewPage.test.tsx#L2029-L2029).
  ข้อความเริ่มต้น `// The history entry no longer carries it, so a reload or a back navigation shows nothing.`.
  เหตุผลที่เสนอให้ลบ ชื่อเคสระบุ reload/back และ assertion router state null ตรง ๆ
  หลักฐาน apps/web/src/pages/monitors/OverviewPage.test.tsx:2023-2032 clears the state; state /^null$/

- [x] D065 [`apps/web/src/pages/monitors/OverviewPage.test.tsx:2146`](../apps/web/src/pages/monitors/OverviewPage.test.tsx#L2146-L2146).
  ข้อความเริ่มต้น `// Mixed intervals: the shortest one is named as the fastest pace.`.
  เหตุผลที่เสนอให้ลบ assertion ตรวจข้อความ ตรวจถี่สุดทุก 1 นาที ชัดแล้ว
  หลักฐาน apps/web/src/pages/monitors/OverviewPage.test.tsx:2147-2149 monitor-overview-interval

- [x] D066 [`apps/web/src/pages/monitors/OverviewPage.tsx:45`](../apps/web/src/pages/monitors/OverviewPage.tsx#L45-L45).
  ข้อความเริ่มต้น `// The status filter reads down first, as the design does; "unknown" follows the states the design names.`.
  เหตุผลที่เสนอให้ลบ ลำดับ down/up/paused/unknown อยู่ใน FILTER_ORDER ตรง ๆ ไม่ได้ให้เหตุผลว่าทำไมต้องเรียงเช่นนั้น
  หลักฐาน apps/web/src/pages/monitors/OverviewPage.tsx:46 FILTER_ORDER = [down, up, paused, unknown]

- [x] D067 [`apps/web/src/pages/monitors/SslLabel.tsx:24`](../apps/web/src/pages/monitors/SslLabel.tsx#L24-L24).
  ข้อความเริ่มต้น `/** Days as the certificate view words them: 21 days left, expires in 5 days, expired 2 days ago. */`.
  เหตุผลที่เสนอให้ลบ ข้อความตัวอย่างและกรณี expired/danger/remaining อยู่ใน return branches ทั้งหมดแล้ว
  หลักฐาน apps/web/src/pages/monitors/SslLabel.tsx:25-37 sslDaysText

- [x] D068 [`apps/web/src/pages/monitors/detail-test-support.tsx:206`](../apps/web/src/pages/monitors/detail-test-support.tsx#L206-L206).
  ข้อความเริ่มต้น `/** A healthy, checked, https monitor; tests override only what they exercise. */`.
  เหตุผลที่เสนอให้ลบ detail มี https URL, health up, lastCheckAt และ ...overrides ชัดเจน ไม่ต้องมี fixture inventory
  หลักฐาน apps/web/src/pages/monitors/detail-test-support.tsx:207-254 detail overrides; health up; lastCheckAt; ...overrides

- [x] D069 [`apps/web/src/pages/monitors/detail/labels.ts:104`](../apps/web/src/pages/monitors/detail/labels.ts#L104-L104).
  ข้อความเริ่มต้น `/** Row wording for a whole check: "ไม่ผ่าน 1/3", "ไม่ได้ประเมิน 3/3" or "ผ่าน 3/3". */`.
  เหตุผลที่เสนอให้ลบ assertionSummary มีข้อความไทยและรูปเศษส่วนตรงตามตัวอย่างทุก branch แล้ว
  หลักฐาน apps/web/src/pages/monitors/detail/labels.ts:105-116 assertionSummary; failed/skipped; ผ่าน total/total

- [x] D070 [`apps/web/src/pages/monitors/form/BasicSection.tsx:24`](../apps/web/src/pages/monitors/form/BasicSection.tsx#L24-L24).
  ข้อความเริ่มต้น `/** Advanced mode shows the timeout field; basic mode states the values that apply. */`.
  เหตุผลที่เสนอให้ลบ advanced condition แสดง TextControl timeout หรือ timeout-summary ชัดเจน
  หลักฐาน apps/web/src/pages/monitors/form/BasicSection.tsx:94-108 advanced TextControl; 123-130 timeout-summary

- [x] D071 [`apps/web/src/pages/monitors/form/RequestSection.tsx:49`](../apps/web/src/pages/monitors/form/RequestSection.tsx#L49-L49).
  ข้อความเริ่มต้น `// Set when Add is pressed at the row limit; cleared when a row is removed.`.
  เหตุผลที่เสนอให้ลบ addRow ตั้ง limit เมื่อ rows.length >= max และ removeRow เรียก setLimit(null) ตรง ๆ
  หลักฐาน apps/web/src/pages/monitors/form/RequestSection.tsx:50-63 limit state and addRow; 79 setLimit(null)

- [x] D072 [`apps/web/src/pages/monitors/form/RequestSection.tsx:80`](../apps/web/src/pages/monitors/form/RequestSection.tsx#L80-L80).
  ข้อความเริ่มต้น `// The row that moved into this position, else the Add button.`.
  เหตุผลที่เสนอให้ลบ ternary เลือก rows[index] หรือ ADD_HEADER_ID/ADD_QUERY_ID โดยตรง
  หลักฐาน apps/web/src/pages/monitors/form/RequestSection.tsx:81-87 focusAfterRender

- [x] D073 [`apps/web/src/pages/monitors/form/model.ts:500`](../apps/web/src/pages/monitors/form/model.ts#L500-L500).
  ข้อความเริ่มต้น `/** What the secret checks read: the stored slots and the values typed so far. */`.
  เหตุผลที่เสนอให้ลบ SecretContext ระบุ base: EditBase|null และ get(slot) อยู่แล้ว คอมเมนต์เพียงแปลชื่อ type/fields
  หลักฐาน apps/web/src/pages/monitors/form/model.ts:501-504 SecretContext

- [x] D074 [`apps/web/src/pages/monitors/form/secrets.test.tsx:40`](../apps/web/src/pages/monitors/form/secrets.test.tsx#L40-L40).
  ข้อความเริ่มต้น `// The only additions to the plain config are the shape string.`.
  เหตุผลที่เสนอให้ลบ assertions ถัดไประบุ secretShape มีอยู่และ secrets ไม่มีอยู่แล้ว
  หลักฐาน apps/web/src/pages/monitors/form/secrets.test.tsx:41-42 Object.keys(snapshot)

- [x] D075 [`apps/web/src/pages/monitors/form/secrets.ts:112`](../apps/web/src/pages/monitors/form/secrets.ts#L112-L112).
  ข้อความเริ่มต้น `/** Slots the current configuration needs a value for: the auth type's and every secret header's. */`.
  เหตุผลที่เสนอให้ลบ requiredSlots รวม AUTH_SLOTS และ headers ที่ secret โดยตรง ไม่เพิ่ม server contract
  หลักฐาน apps/web/src/pages/monitors/form/secrets.ts:113-130 requiredSlots

- [x] D076 [`apps/web/src/pages/monitors/form/secrets.ts:138`](../apps/web/src/pages/monitors/form/secrets.ts#L138-L138).
  ข้อความเริ่มต้น `/** A slot takes a typed value when nothing is stored for it or the user chose to replace it. */`.
  เหตุผลที่เสนอให้ลบ slotTakesValue return แปลเงื่อนไขไม่มี stored หรือ replacing โดยตรง
  หลักฐาน apps/web/src/pages/monitors/form/secrets.ts:139-144 slotTakesValue

- [x] D077 [`apps/web/src/pages/monitors/form/secrets.ts:147`](../apps/web/src/pages/monitors/form/secrets.ts#L147-L147).
  ข้อความเริ่มต้น `/** Stored slots the current configuration still uses and the user is not replacing. */`.
  เหตุผลที่เสนอให้ลบ keptSlots filter stored.has และ !values.replacing.includes ตรงตามชื่อและคอมเมนต์แล้ว
  หลักฐาน apps/web/src/pages/monitors/form/secrets.ts:148-155 keptSlots

- [x] D078 [`apps/web/src/pages/monitors/format.tsx:43`](../apps/web/src/pages/monitors/format.tsx#L43-L43).
  ข้อความเริ่มต้น `/** Day, short month and year, for dates such as a certificate expiry. */`.
  เหตุผลที่เสนอให้ลบ dateFormat options ระบุ day/month/year และ formatDate เรียก formatter ตรง ๆ
  หลักฐาน apps/web/src/pages/monitors/format.tsx:26-30 dateFormat; 44-45 formatDate

- [x] D079 [`apps/web/src/pages/monitors/list/MonitorCards.tsx:75`](../apps/web/src/pages/monitors/list/MonitorCards.tsx#L75-L75).
  ข้อความเริ่มต้น `// Cards view of the same list page as the table: two columns on a hairline grid.`.
  เหตุผลที่เสนอให้ลบ เป็น layout label ซ้ำ MonitorCards และ HairlineGrid/grid-cols-2 ไม่ใช่เหตุผลเรื่อง accessible name ในบรรทัดถัดไป
  หลักฐาน apps/web/src/pages/monitors/list/MonitorCards.tsx:77-90 MonitorCards; HairlineGrid className

- [x] D080 [`apps/web/src/pages/monitors/useDataFresh.test.ts:155`](../apps/web/src/pages/monitors/useDataFresh.test.ts#L155-L155).
  ข้อความเริ่มต้น `// The snapshot itself never clears it, however long the toggling went on.`.
  เหตุผลที่เสนอให้ลบ ชื่อเคส keeps the first pause through several toggles และ assertion false หลัง loop ระบุผลอยู่แล้ว
  หลักฐาน apps/web/src/pages/monitors/useDataFresh.test.ts:144-159 snapshot loop; expect(result.current).toBe(false)

- [x] D081 [`apps/web/src/pages/monitors/useDataFresh.test.ts:219`](../apps/web/src/pages/monitors/useDataFresh.test.ts#L219-L219).
  ข้อความเริ่มต้น `// Accepted: a remount during a pending resumed fetch loses the pause history.`.
  เหตุผลที่เสนอให้ลบ Accepted เป็น provenance และเนื้อหาซ้ำชื่อเคสที่ระบุ remount ลืม pause/fallback age พร้อม assertion true
  หลักฐาน apps/web/src/pages/monitors/useDataFresh.test.ts:218-223 it forgets the pause on a remount; unmount/setup; result true

- [x] D082 [`apps/web/src/pages/organization-members/InvitationCancelAction.test.tsx:194`](../apps/web/src/pages/organization-members/InvitationCancelAction.test.tsx#L194-L194).
  ข้อความเริ่มต้น `// One announcement while the dialog is open: the dialog's own region.`.
  เหตุผลที่เสนอให้ลบ textStatusCount ตรวจเฉพาะ region และ assertion =1 ระบุจำนวน announcement ชัดแล้ว
  หลักฐาน apps/web/src/pages/organization-members/InvitationCancelAction.test.tsx:186-195 confirmation-pending; textStatusCount().toBe(1)

- [x] D083 [`apps/web/src/pages/organization-members/MemberRoleActions.test.tsx:92`](../apps/web/src/pages/organization-members/MemberRoleActions.test.tsx#L92-L92).
  ข้อความเริ่มต้น `// The submit finishes after its refresh branch: pending text gone, control enabled.`.
  เหตุผลที่เสนอให้ลบ submitSettled เรียก waitFor ตรวจ pending null และ roleSelect enabled ตรงตามคอมเมนต์แล้ว
  หลักฐาน apps/web/src/pages/organization-members/MemberRoleActions.test.tsx:93-97 submitSettled

- [x] D084 [`apps/web/src/pages/organization-members/MemberRoleActions.test.tsx:240`](../apps/web/src/pages/organization-members/MemberRoleActions.test.tsx#L240-L240).
  ข้อความเริ่มต้น `// Focus stays on the member's own controls (opener or its select).`.
  เหตุผลที่เสนอให้ลบ assertion contains(document.activeElement) ภายใน member-row-member-boss ระบุเป้าหมาย focus อยู่แล้ว
  หลักฐาน apps/web/src/pages/organization-members/MemberRoleActions.test.tsx:241-246 member-row-member-boss contains activeElement

- [x] D085 [`apps/web/src/pages/projects/ProjectFormDialog.tsx:79`](../apps/web/src/pages/projects/ProjectFormDialog.tsx#L79-L79).
  ข้อความเริ่มต้น `/** Present when editing. */`.
  เหตุผลที่เสนอให้ลบ optional project และ const editing = project !== undefined บอกเงื่อนไข edit โดยตรง
  หลักฐาน apps/web/src/pages/projects/ProjectFormDialog.tsx:80 project?: ProjectSummary; 97 editing

- [x] D086 [`apps/web/src/pages/projects/ProjectsPage.test.tsx:1062`](../apps/web/src/pages/projects/ProjectsPage.test.tsx#L1062-L1062).
  ข้อความเริ่มต้น `// A later reload that succeeds must not bring back the old notice.`.
  เหตุผลที่เสนอให้ลบ mockResolvedValue/invalidateQueries ตามด้วย fresh row, stale warning null และ saved notice null ระบุผล reload แล้ว
  หลักฐาน apps/web/src/pages/projects/ProjectsPage.test.tsx:1063-1069 fetchListMock; projects-notice-saved null


### Worker และ E2E

- [x] D087 [`apps/worker/src/audit/exporter.db.test.ts:323-324`](../apps/worker/src/audit/exporter.db.test.ts#L323-L324).
  ข้อความเริ่มต้น `// The preamble and header row layout is covered by file.test.ts:79; here // only the two event rows that follow it matter.`.
  เหตุผลที่เสนอให้ลบ เป็นคำบอก coverage ของไฟล์อื่นและบรรยายการเลือก event rows ที่โค้ดระบุแล้ว
  หลักฐาน apps/worker/src/audit/exporter.db.test.ts:325-328 parseCsv และ rows[6], rows[7]

- [x] D088 [`apps/worker/src/audit/exporter.db.test.ts:352`](../apps/worker/src/audit/exporter.db.test.ts#L352-L352).
  ข้อความเริ่มต้น `// The formula never starts a cell.`.
  เหตุผลที่เสนอให้ลบ assertion ถัดไประบุชัดว่า formula ต้องไม่อยู่ต้น cell
  หลักฐาน apps/worker/src/audit/exporter.db.test.ts:353 expect(text).not.toMatch(/(^|,)=HYPERLINK/m)

- [x] D089 [`apps/worker/src/audit/exporter.db.test.ts:454`](../apps/worker/src/audit/exporter.db.test.ts#L454-L454).
  ข้อความเริ่มต้น ``// A recording start newer than the events hides them, whatever `from` says.``.
  เหตุผลที่เสนอให้ลบ ชื่อ test ระบุ clamp recording start แล้ว และ SQL กับ assertion แสดงเงื่อนไขครบ
  หลักฐาน apps/worker/src/audit/exporter.db.test.ts:432,455-463 audit_recording_started_at และ toEqual([])

- [x] D090 [`apps/worker/src/audit/file.test.ts:56`](../apps/worker/src/audit/file.test.ts#L56-L56).
  ข้อความเริ่มต้น `// A Project role change reads the same way: the export keeps role codes.`.
  เหตุผลที่เสนอให้ลบ expected string ระบุ role code member และ admin ครบ ไม่ได้อธิบายเหตุผล fixture
  หลักฐาน apps/worker/src/audit/file.test.ts:57-63 changeText(...).toBe("role: member → admin")

- [x] D091 [`apps/worker/src/audit/file.ts:67`](../apps/worker/src/audit/file.ts#L67-L67).
  ข้อความเริ่มต้น ``/** `field: ก่อน → หลัง`, with the name of a header, query parameter or secret slot. */``.
  เหตุผลที่เสนอให้ลบ return expression แสดงรูปแบบ field/key ก่อนและหลังอยู่แล้ว
  หลักฐาน apps/worker/src/audit/file.ts:68-70 changeText label และ template return

- [x] D092 [`apps/worker/src/audit/maintenance.ts:16`](../apps/worker/src/audit/maintenance.ts#L16-L16).
  ข้อความเริ่มต้น `/** Batches one run may drain before it stops and leaves the rest to the next hour. */`.
  เหตุผลที่เสนอให้ลบ ชื่อ AUDIT_PURGE_MAX_BATCHES_PER_RUN กับ warning ระบุ guard และการเหลืองานรอบถัดไปแล้ว
  หลักฐาน apps/worker/src/audit/maintenance.ts:17,25-30 drain และ audit purge stopped at the batch guard

- [x] D093 [`apps/worker/src/monitor/checker-process.db.test.ts:580`](../apps/worker/src/monitor/checker-process.db.test.ts#L580-L580).
  ข้อความเริ่มต้น `// The failed record left the monitor exactly as the claim left it.`.
  เหตุผลที่เสนอให้ลบ expected state ถัดไประบุ claim token, failure streak, last_check_at และ hourly ครบแล้ว
  หลักฐาน apps/worker/src/monitor/checker-process.db.test.ts:581-599 rows และ expect(state).toEqual

- [x] D094 [`apps/worker/src/monitor/checker.db.test.ts:365`](../apps/worker/src/monitor/checker.db.test.ts#L365-L365).
  ข้อความเริ่มต้น `// Only the monitor nobody touched reaches the event hook and opens an incident.`.
  เหตุผลที่เสนอให้ลบ assertion ระบุ untouched.monitorId และ incident_opened พร้อม count incident อยู่แล้ว
  หลักฐาน apps/worker/src/monitor/checker.db.test.ts:366-367 expect(emitted) และ countAll(untouched).incidents

- [x] D095 [`apps/worker/src/monitor/checker.db.test.ts:840`](../apps/worker/src/monitor/checker.db.test.ts#L840-L840).
  ข้อความเริ่มต้น `// Next hour: a single failure.`.
  เหตุผลที่เสนอให้ลบ runSteps ระบุ ["fail"] และ offset หนึ่งชั่วโมงโดยตรงแล้ว
  หลักฐาน apps/worker/src/monitor/checker.db.test.ts:841 runSteps(...,["fail"],hour + 3_600_000 + 60_000)

- [x] D096 [`apps/worker/src/monitor/checker.db.test.ts:1206`](../apps/worker/src/monitor/checker.db.test.ts#L1206-L1206).
  ข้อความเริ่มต้น `// The reflected value did reach storage, as the mask.`.
  เหตุผลที่เสนอให้ลบ literal assertion ระบุ masked Bearer value อยู่แล้ว ไม่ได้บอกเหตุผล fixture
  หลักฐาน apps/worker/src/monitor/checker.db.test.ts:1207 expect(haystack).toContain("Bearer •••")

- [x] D097 [`apps/worker/src/monitor/scheduler.db.test.ts:131`](../apps/worker/src/monitor/scheduler.db.test.ts#L131-L131).
  ข้อความเริ่มต้น `/** Runtime database whose queries are counted and can be failed by SQL text. */`.
  เหตุผลที่เสนอให้ลบ hooks.failWhen และ count ระบุการ fail/count query ชัด และ body ไม่มี constraint เพิ่ม
  หลักฐาน apps/worker/src/monitor/scheduler.db.test.ts:132-156 spyDatabase failWhen, seen.push และ count

- [x] D098 [`apps/worker/src/monitor/test-harness.ts:182`](../apps/worker/src/monitor/test-harness.ts#L182-L182).
  ข้อความเริ่มต้น `/** Replaces the response behavior for later requests. */`.
  เหตุผลที่เสนอให้ลบ ชื่อ setHandler กับ TargetHandler signature ระบุการแทน handler และ implementation แค่ assign handler
  หลักฐาน apps/worker/src/monitor/test-harness.ts:183,192-195,229-231 setHandler(next) assigns handler = next

- [x] D099 [`e2e/support/monitor-target.mjs:8-16`](../e2e/support/monitor-target.mjs#L8-L16).
  ข้อความเริ่มต้น ``* Routes (any method): *   /health          200 JSON while `mode` is "up", 503 while "down", after `delayMs```.
  เหตุผลที่เสนอให้ลบ route inventory ซ้ำ pathname branches และ response constants ทั้งหมด; ไม่แตะ SSRF หรือ secret-memory rationale และ typedef
  หลักฐาน e2e/support/monitor-target.mjs:53-78 /health,/status/,/slow,/creds,/reflect,/redirect,/json handlers

- [x] D100 [`e2e/support/response-target.mjs:9-16`](../e2e/support/response-target.mjs#L9-L16).
  ข้อความเริ่มต้น `* Routes (any method): *   /probe    answers by the script entry for this hit (the last entry repeats):`.
  เหตุผลที่เสนอให้ลบ route inventory ซ้ำ handler โดยไม่มี constraint เพิ่ม; เก็บ per-monitor isolation และ Latin-1 rationale ที่แยกอยู่
  หลักฐาน e2e/support/response-target.mjs:49-93 /probe,/json,/long,/reflect branches

- [x] D101 [`e2e/tests/monitor-event-feed.spec.ts:277`](../e2e/tests/monitor-event-feed.spec.ts#L277-L277).
  ข้อความเริ่มต้น `// A viewer sees the role note and the browser never asks for the response.`.
  เหตุผลที่เสนอให้ลบ viewer role note, missing response UI, no request และ API403 มี assertions โดยตรงแล้ว
  หลักฐาน e2e/tests/monitor-event-feed.spec.ts:281-297 asked tracking และ expect(...).toBe(0), denied.status403

- [x] D102 [`e2e/tests/monitor-event-feed.spec.ts:428`](../e2e/tests/monitor-event-feed.spec.ts#L428-L428).
  ข้อความเริ่มต้น `// Header secrets on a GET without query: stored, masked.`.
  เหตุผลที่เสนอให้ลบ ชื่อ echoHeader และ assertions ระบุ stored masked response แล้ว
  หลักฐาน e2e/tests/monitor-event-feed.spec.ts:429-437 detailOmitted null, status200, redacted true และ body mask

- [x] D103 [`e2e/tests/monitor-event-feed.spec.ts:439`](../e2e/tests/monitor-event-feed.spec.ts#L439-L439).
  ข้อความเริ่มต้น `// Request values echoed back: nothing but version and status stored.`.
  เหตุผลที่เสนอให้ลบ echoQuery/echoBody loop ระบุ detailOmitted request_values, empty headers และ omitted body อยู่แล้ว
  หลักฐาน e2e/tests/monitor-event-feed.spec.ts:440-450 request_values assertions

- [x] D104 [`e2e/tests/monitor-event-feed.spec.ts:471`](../e2e/tests/monitor-event-feed.spec.ts#L471-L471).
  ข้อความเริ่มต้น `// Scan every API reply and table row for every form a secret can take.`.
  เหตุผลที่เสนอให้ลบ เป็นคำบรรยาย scan loop; เก็บ 472-473 ที่อธิบายเหตุผลไม่ scan plain config values ในบาง response
  หลักฐาน e2e/tests/monitor-event-feed.spec.ts:474-479 needleForms, needles และ configSurface

- [x] D105 [`e2e/tests/monitors-access.spec.ts:29-31`](../e2e/tests/monitors-access.spec.ts#L29-L31).
  ข้อความเริ่มต้น `// UI coverage of the role x screen table, // two sessions changing a role, keyboard flows in both themes, and reflow at a`.
  เหตุผลที่เสนอให้ลบ เป็น coverage inventory ไม่ใช่เหตุผล fixture หรือ isolation; ชื่อ tests และคำสั่ง keyboard/theme/viewport เป็น coverage ต้นทาง
  หลักฐาน e2e/tests/monitors-access.spec.ts:128-154 role screen tests;453-478 keyboard Overview;610-614 keyboard chart alternative

- [x] D106 [`e2e/tests/monitors-access.spec.ts:610`](../e2e/tests/monitors-access.spec.ts#L610-L610).
  ข้อความเริ่มต้น `// The chart's alternative is a real table opened from the keyboard.`.
  เหตุผลที่เสนอให้ลบ focus, Enter และ visible table assertion ระบุ keyboard alternative ชัดแล้ว
  หลักฐาน e2e/tests/monitors-access.spec.ts:611-614 monitor-response-toggle focus, keyboard.press และ table visible

- [x] D107 [`e2e/tests/monitors-list-sort-view.spec.ts:20-22`](../e2e/tests/monitors-list-sort-view.spec.ts#L20-L22).
  ข้อความเริ่มต้น `// Issue #59 browser evidence: server-side sort, method / interval columns, the // Cards sparkline, the Detail SSL issuer, and the layout at 640 px.`.
  เหตุผลที่เสนอให้ลบ เป็น Issue provenance และ coverage inventory ที่ test names และ assertions เป็นเจ้าของ; เก็บ 24-26 เรื่องไม่สร้าง schedule และ reseed
  หลักฐาน e2e/tests/monitors-list-sort-view.spec.ts:230-240,283-309 default/name sort;318-323 method/interval cards;325-367 sparkline;448-452 SSL;508-547 640px layout

- [x] D108 [`e2e/tests/monitors-states.spec.ts:647`](../e2e/tests/monitors-states.spec.ts#L647-L647).
  ข้อความเริ่มต้น `// Replace with nothing typed is refused beside the field.`.
  เหตุผลที่เสนอให้ลบ replace click, empty field และ aria-invalid assertions บอก flow อยู่แล้ว
  หลักฐาน e2e/tests/monitors-states.spec.ts:648-659 secret replace empty-field validation

- [x] D109 [`e2e/tests/monitors-states.spec.ts:662`](../e2e/tests/monitors-states.spec.ts#L662-L662).
  ข้อความเริ่มต้น `// Changing the type says the old value is dropped before saving.`.
  เหตุผลที่เสนอให้ลบ select basic และ data-dropped true assertion ระบุการเตือน old secret แล้ว
  หลักฐาน e2e/tests/monitors-states.spec.ts:663-670 auth type selection และ monitor-auth-secret-dropped

- [x] D110 [`e2e/tests/monitors.spec.ts:179`](../e2e/tests/monitors.spec.ts#L179-L179).
  ข้อความเริ่มต้น `// A Test never creates a monitor and does not block saving.`.
  เหตุผลที่เสนอให้ลบ monitorCount assertion และ save201 flow ระบุ Test ไม่สร้าง record และยัง save ได้แล้ว
  หลักฐาน e2e/tests/monitors.spec.ts:180,185-193 expect monitorCount before และ created.status201

- [x] D111 [`e2e/tests/monitors.spec.ts:333`](../e2e/tests/monitors.spec.ts#L333-L333).
  ข้อความเริ่มต้น `// Direct routes and requests are refused, and nothing reaches the target.`.
  เหตุผลที่เสนอให้ลบ POST create/test status403 และ hit count ที่ไม่เพิ่ม ระบุ expected behavior ครบ
  หลักฐาน e2e/tests/monitors.spec.ts:334-348 forbidden requests และ unchanged flapTarget.hits

- [x] D112 [`e2e/tests/monitors.spec.ts:506`](../e2e/tests/monitors.spec.ts#L506-L506).
  ข้อความเริ่มต้น `// The Organization's Owner and the Project's member each get one item per event, never two.`.
  เหตุผลที่เสนอให้ลบ perPerson assertions ระบุ Owner/Project member ได้ MONITOR_DOWN และ MONITOR_RECOVERED อย่างละ1 แล้ว
  หลักฐาน e2e/tests/monitors.spec.ts:517-530 perPerson(owner.userId), perPerson(viewer.userId)

- [x] D113 [`e2e/tests/project-members.spec.ts:250`](../e2e/tests/project-members.spec.ts#L250-L250).
  ข้อความเริ่มต้น `// The lost Project is neither in the list nor anywhere on the page.`.
  เหตุผลที่เสนอให้ลบ project-row และ getByText absence assertions ระบุว่ารายการและชื่อหายแล้ว
  หลักฐาน e2e/tests/project-members.spec.ts:251-252 toHaveCount(0) ของ project row และ Payments name

- [x] D114 [`e2e/tests/project-overview.spec.ts:56`](../e2e/tests/project-overview.spec.ts#L56-L56).
  ข้อความเริ่มต้น `// Document preference proof: the app applies the user's explicit theme.`.
  เหตุผลที่เสนอให้ลบ data-theme assertion ถัดไประบุ root element และ theme ที่เลือกตรงๆ
  หลักฐาน e2e/tests/project-overview.spec.ts:47-57 theme selection และ expect(html).toHaveAttribute("data-theme", theme)

- [x] D115 [`e2e/tests/project-switcher.spec.ts:237`](../e2e/tests/project-switcher.spec.ts#L237-L237).
  ข้อความเริ่มต้น `// The Project in the URL is current, in its own Organization, and saved there.`.
  เหตุผลที่เสนอให้ลบ breadcrumb, button และ last-project API assertions ระบุ scope/current/persist ครบแล้ว
  หลักฐาน e2e/tests/project-switcher.spec.ts:238-251 button Many01, breadcrumb Organization และ last-project organizationId

- [x] D116 [`e2e/tests/project-switcher.spec.ts:268`](../e2e/tests/project-switcher.spec.ts#L268-L268).
  ข้อความเริ่มต้น `// From the search field, Up wraps through both links to the last Project, which scrolls into view.`.
  เหตุผลที่เสนอให้ลบ ArrowUp สามครั้งและ focus/viewport assertions ระบุ flow ชัดอยู่แล้ว
  หลักฐาน e2e/tests/project-switcher.spec.ts:269-276 shell-project-create, shell-project-all และ last Project focus

- [x] D117 [`e2e/tests/projects.spec.ts:213`](../e2e/tests/projects.spec.ts#L213-L213).
  ข้อความเริ่มต้น `// Fixture name: no trace of the project may reach a non-member.`.
  เหตุผลที่เสนอให้ลบ getByText fixture Secret toHaveCount(0) ระบุ absence ที่ต้องการโดยตรง
  หลักฐาน e2e/tests/projects.spec.ts:200-214 non-member test และ Secret name assertion

- [x] D118 [`e2e/tests/projects.spec.ts:229`](../e2e/tests/projects.spec.ts#L229-L229).
  ข้อความเริ่มต้น `// Document preference: the stored theme reaches the root element.`.
  เหตุผลที่เสนอให้ลบ context init script ตั้ง theme และ root data-theme assertion ระบุ contract เดียวกันอยู่แล้ว
  หลักฐาน e2e/tests/projects.spec.ts:220-230 localStorage nightwatch-theme และ expect(html).toHaveAttribute

- [x] D119 [`e2e/tests/settings.spec.ts:6-7`](../e2e/tests/settings.spec.ts#L6-L7).
  ข้อความเริ่มต้น `* Personal settings (/settings/*). *`.
  เหตุผลที่เสนอให้ลบ เป็น section label ซ้ำชื่อไฟล์และ /settings route tests; เก็บ dedicated-account mutation warning บรรทัด 8-12
  หลักฐาน e2e/tests/settings.spec.ts:26-38 public /settings tests;392 password change test

- [x] D120 [`e2e/verification/api-matrix.ts:515`](../e2e/verification/api-matrix.ts#L515-L515).
  ข้อความเริ่มต้น `// Non-member answers must not reveal names, URLs or counts.`.
  เหตุผลที่เสนอให้ลบ check log ระบุ no name/URL/host/count ตรงกับเงื่อนไขแล้ว
  หลักฐาน e2e/verification/api-matrix.ts:516-524 non-member list check

- [x] D121 [`e2e/verification/api-matrix.ts:527`](../e2e/verification/api-matrix.ts#L527-L527).
  ข้อความเริ่มต้น `// Three kinds of bad id answer alike, in every operation.`.
  เหตุผลที่เสนอให้ลบ idKinds ระบุทั้งสามประเภท และ check log ระบุ all404 with one code แล้ว
  หลักฐาน e2e/verification/api-matrix.ts:528-553 idKinds และ AC-48 check

- [x] D122 [`e2e/verification/api-matrix.ts:637`](../e2e/verification/api-matrix.ts#L637-L637).
  ข้อความเริ่มต้น `// Redirect to a blocked address never reaches the second listener.`.
  เหตุผลที่เสนอให้ลบ redirect-blocked และ zero second-listener hits มีชื่อ check ชัดอยู่แล้ว
  หลักฐาน e2e/verification/api-matrix.ts:638-653 second target, redirect_blocked และ second.hits.length===0

- [x] D123 [`e2e/verification/api-matrix.ts:834`](../e2e/verification/api-matrix.ts#L834-L834).
  ข้อความเริ่มต้น `// Scheduled checks decrypt and send the stored values.`.
  เหตุผลที่เสนอให้ลบ เป็น phase narration ที่ check log ระบุ scheduled check authenticated และ outcome pass แล้ว
  หลักฐาน e2e/verification/api-matrix.ts:835-850 scheduled check with secret authenticated check

- [x] D124 [`e2e/verification/api-matrix.ts:865`](../e2e/verification/api-matrix.ts#L865-L865).
  ข้อความเริ่มต้น `// Edit: keep uses stored value; replace uses the new one; changing origin is refused.`.
  เหตุผลที่เสนอให้ลบ check logs ระบุ keep/replace/origin rejection เป็นแต่ละกรณีครบแล้ว
  หลักฐาน e2e/verification/api-matrix.ts:879-883 keep check;905-910 replace check;931-936 origin change422 check

- [x] D125 [`e2e/verification/api-matrix.ts:973`](../e2e/verification/api-matrix.ts#L973-L973).
  ข้อความเริ่มต้น `// Reflecting endpoint: the secret is redacted from assertion actuals and errors.`.
  เหตุผลที่เสนอให้ลบ reflect endpoint config และ log check ระบุ secret redaction to bullets อยู่แล้ว
  หลักฐาน e2e/verification/api-matrix.ts:974-993 reflectToken, /reflect และ AC-43 check

- [x] D126 [`e2e/verification/api-matrix.ts:1047`](../e2e/verification/api-matrix.ts#L1047-L1047).
  ข้อความเริ่มต้น `// Query and body values never reach results, incidents, notifications or logs.`.
  เหตุผลที่เสนอให้ลบ ซ้ำ HIDDEN_VALUES privacy contract ที่52-53 และ AC-42 check log ของ table scan ไม่ใช่เหตุผล fixture เพิ่ม
  หลักฐาน e2e/verification/api-matrix.ts:52-54 HIDDEN_VALUES;1048-1050 query/body values;1118-1120 no stored query/body value check

- [x] D127 [`e2e/verification/api-matrix.ts:1136-1137`](../e2e/verification/api-matrix.ts#L1136-L1137).
  ข้อความเริ่มต้น `// Audit events for the whole secret scenario keep // the masked URL and secret slot names, never a value.`.
  เหตุผลที่เสนอให้ลบ ชื่อ check และ KNOWN_SECRETS/HIDDEN_VALUES scan ระบุ audit redaction โดยตรงแล้ว
  หลักฐาน e2e/verification/api-matrix.ts:1138-1149 audit events mutation scan และ AC-61 check

- [x] D128 [`e2e/verification/api-matrix.ts:1176`](../e2e/verification/api-matrix.ts#L1176-L1176).
  ข้อความเริ่มต้น `/** Known values must not sit in any monitor or notification table, nor in Redis. */`.
  เหตุผลที่เสนอให้ลบ scanStores tables, needles และ log checks ระบุ DB/Redis scan ครบ ไม่มีสัญญา API เพิ่ม
  หลักฐาน e2e/verification/api-matrix.ts:1177-1206 tables/needles scan;1208-1235 Redis keys/commands scan

- [x] D129 [`e2e/verification/api-matrix.ts:1513`](../e2e/verification/api-matrix.ts#L1513-L1513).
  ข้อความเริ่มต้น `// Pause closes the open incident as paused_by_user and sends no recovery.`.
  เหตุผลที่เสนอให้ลบ เป็น phase narration ที่ check log paused_by_user และ no recovery ระบุแล้ว
  หลักฐาน e2e/verification/api-matrix.ts:1514-1524 pause/end_reason check;1562-1564 no MONITOR_RECOVERED check

- [x] D130 [`e2e/verification/api-matrix.ts:1527`](../e2e/verification/api-matrix.ts#L1527-L1527).
  ข้อความเริ่มต้น `// Alerts off: an incident still opens but no notification is created.`.
  เหตุผลที่เสนอให้ลบ ชื่อ check ระบุ alerts off ยังเปิด incident แต่ไม่มี MONITOR_DOWN ตรงกันแล้ว
  หลักฐาน e2e/verification/api-matrix.ts:1528-1554 alerts toggle, incidentB และ notification count check

- [x] D131 [`e2e/verification/worker-restart.ts:188`](../e2e/verification/worker-restart.ts#L188-L188).
  ข้อความเริ่มต้น `// A restarted Worker resumes without back-filling or duplicating.`.
  เหตุผลที่เสนอให้ลบ ชื่อ check ระบุ new Worker หลัง SIGTERM และ exactly one/no backfill อยู่แล้ว ไม่มี timing rationale เพิ่ม
  หลักฐาน e2e/verification/worker-restart.ts:189-201 startWorker resume และ resumed-round check


### Packages

- [x] D132 [`packages/api-contract/src/audit-log.ts:459`](../packages/api-contract/src/audit-log.ts#L459-L459).
  ข้อความเริ่มต้น `/** The note on the page, in the export dialog and in every file. */`.
  เหตุผลที่เสนอให้ลบ เป็นป้ายบอกจุดใช้งานของข้อความ scope ไม่ได้เพิ่มเงื่อนไขให้ auditScopeNote ชื่อฟังก์ชันและข้อความที่คืนระบุหน้าที่อยู่แล้ว
  หลักฐาน packages/api-contract/src/audit-log.ts:460-462 auditScopeNote คืนข้อความขอบเขต audit โดยตรง

- [x] D133 [`packages/api-contract/src/auth.ts:173-176`](../packages/api-contract/src/auth.ts#L173-L176).
  ข้อความเริ่มต้น `/** * Authenticated context for tenant selection (served by the OrgAccess`.
  เหตุผลที่เสนอให้ลบ เป็นคำบอกเจ้าของ slice และการแชร์ schema ไม่ใช่เงื่อนไข authentication เพิ่มเติม meContextResponseSchema แสดง user/organizations/lastActiveTenantId อยู่แล้ว
  หลักฐาน packages/api-contract/src/auth.ts:177-187 meContextResponseSchema

- [x] D134 [`packages/api-contract/src/auth.ts:191`](../packages/api-contract/src/auth.ts#L191-L191).
  ข้อความเริ่มต้น `/** Input for switching the active organization. */`.
  เหตุผลที่เสนอให้ลบ บรรยายชื่อ activeOrganizationInputSchema ซ้ำ โดย input มี organizationId เพียงฟิลด์เดียว
  หลักฐาน packages/api-contract/src/auth.ts:192-194 activeOrganizationInputSchema

- [x] D135 [`packages/api-contract/src/monitor.ts:398`](../packages/api-contract/src/monitor.ts#L398-L398).
  ข้อความเริ่มต้น `// Every free-text field passes through here before the field's own rules.`.
  เหตุผลที่เสนอให้ลบ บรรยาย badText และลำดับการเรียกซ้ำจากโค้ด ไม่เพิ่มเหตุผลของ Unicode/storage ซึ่งเก็บอยู่บรรทัด 69-70
  หลักฐาน packages/api-contract/src/monitor.ts:399-407 badText ตรวจ isStorableText และ add invalid_format

- [x] D136 [`packages/api-contract/src/monitor.ts:551`](../packages/api-contract/src/monitor.ts#L551-L551).
  ข้อความเริ่มต้น `/** The slot name as stored: the header id part is lowercase. */`.
  เหตุผลที่เสนอให้ลบ ซ้ำสัญญา header UUID lowercase ในบล็อก SECRET_SLOT_INPUT ที่ยังเก็บไว้ ไม่จำเป็นต้องมีคำอธิบายเดิมสองจุด
  หลักฐาน packages/api-contract/src/monitor.ts:544-549 และ 552-554 canonicalSecretSlot ใช้ startsWith header. แล้ว toLowerCase

- [x] D137 [`packages/api-contract/src/monitor.ts:1042`](../packages/api-contract/src/monitor.ts#L1042-L1042).
  ข้อความเริ่มต้น `/** Check history and incidents. */`.
  เหตุผลที่เสนอให้ลบ เป็นป้ายหมวด history ซึ่งชื่อ monitorHistoryQuerySchema และ fields limit/offset บอกอยู่แล้ว ไม่ได้กำหนดความหมาย pagination เพิ่ม
  หลักฐาน packages/api-contract/src/monitor.ts:1043-1052 monitorHistoryQuerySchema

- [x] D138 [`packages/api-contract/src/project.ts:158`](../packages/api-contract/src/project.ts#L158-L158).
  ข้อความเริ่มต้น ``/** `role` is required: the API never guesses between admin and member. */``.
  เหตุผลที่เสนอให้ลบ role เป็น required และไม่มี default ใน strictObject อยู่แล้ว คำว่า API never guesses แค่เล่าเงื่อนไขเดียวกัน
  หลักฐาน packages/api-contract/src/project.ts:159-165 addProjectMembersRequestSchema มี role: projectRoleSchema โดยไม่ optional/default

- [x] D139 [`packages/db/src/migrate.ts:31-33`](../packages/db/src/migrate.ts#L31-L33).
  ข้อความเริ่มต้น `// The bundled build (build:migrate) cannot resolve ../migrations via // import.meta.url, so the image/operator may point at the directory`.
  เหตุผลที่เสนอให้ลบ เหตุผล import.meta.url ใน bundle และ MIGRATIONS_DIR ซ้ำ header บรรทัด 14-18 ทั้งหมด เก็บ operator contract ไว้จุดเดียว
  หลักฐาน packages/db/src/migrate.ts:14-18 และ 34-36 การเลือก MIGRATIONS_DIR หรือ source-relative directory

- [x] D140 [`packages/db/tests/monitor.db.test.ts:83`](../packages/db/tests/monitor.db.test.ts#L83-L83).
  ข้อความเริ่มต้น `/** One row in every monitor table for the tenant, through the runtime role. */`.
  เหตุผลที่เสนอให้ลบ เป็น inventory ของ seedTenant ไม่ใช่เหตุผลของ fixture การเรียก withTenantContextRaw และ INSERT แต่ละตารางบอกวิธี seed ครบแล้ว
  หลักฐาน packages/db/tests/monitor.db.test.ts:84-130 seedTenant เรียก withTenantContextRaw(database, tenantId) และ INSERT monitor tables

- [x] D141 [`packages/eslint-config/index.js:125-126`](../packages/eslint-config/index.js#L125-L126).
  ข้อความเริ่มต้น `* NightWatch flat-config factory. *`.
  เหตุผลที่เสนอให้ลบ ชื่อ NightWatch flat-config factory ซ้ำ createConfig และ tseslint.config เก็บย่อหน้า kind/framework policy บรรทัด 127-129 แยกไว้
  หลักฐาน packages/eslint-config/index.js:131-142 createConfig เรียก workspaceBoundaryPattern และ tseslint.config

- [x] D142 [`packages/shared/src/audit-export.ts:107`](../packages/shared/src/audit-export.ts#L107-L107).
  ข้อความเริ่มต้น `/** The note in every file and on the page. */`.
  เหตุผลที่เสนอให้ลบ เป็นป้ายบอกที่ใช้ข้อความ ไม่เพิ่มความหมาย scope เหนือ auditScopeNote และข้อความที่คืน
  หลักฐาน packages/shared/src/audit-export.ts:108-110 auditScopeNote คืนข้อความขอบเขต audit

- [x] D143 [`packages/shared/src/audit-export.ts:112`](../packages/shared/src/audit-export.ts#L112-L112).
  ข้อความเริ่มต้น ``/** Action codes whose code or Thai label contains `q` (the `q` search of the list and the export). */``.
  เหตุผลที่เสนอให้ลบ บรรยาย filter แบบ contains ของ auditActionCodesMatching ซ้ำ predicate ตรงๆ ไม่เพิ่ม search contract ที่ซ่อนอยู่
  หลักฐาน packages/shared/src/audit-export.ts:113-119 auditActionCodesMatching ใช้ lowercase includes กับ code และ AUDIT_ACTION_LABELS

- [x] D144 [`packages/shared/src/errors.ts:5-7`](../packages/shared/src/errors.ts#L5-L7).
  ข้อความเริ่มต้น `* * Constructor order is status-first per user decision F001-ERR1:`.
  เหตุผลที่เสนอให้ลบ แยก provenance F001-ERR1 กับตัวอย่าง constructor ซึ่ง signature ระบุ statusCode/code/message/details อยู่แล้ว เก็บ display-safe message และ generic-500 mapping บรรทัด 2-4
  หลักฐาน packages/shared/src/errors.ts:14-19 AppError constructor รับ statusCode, code, message, details ตามลำดับ

- [x] D145 [`packages/shared/src/monitor-check/json-scan.ts:189`](../packages/shared/src/monitor-check/json-scan.ts#L189-L189).
  ข้อความเริ่มต้น `// A prefix can end inside a container: it "ends" past the text so callers see it is cut.`.
  เหตุผลที่เสนอให้ลบ ซ้ำ sentinel ของ cut container ที่ contract indexContainers บรรทัด 171-173 อธิบายไว้แล้ว ไม่ลบความหมายของ text.length + 1 ออกจากไฟล์
  หลักฐาน packages/shared/src/monitor-check/json-scan.ts:170-175 และ 190 for start of open ตั้ง ends[start] = text.length + 1

- [x] D146 [`packages/shared/src/outbound-http/headers.ts:15`](../packages/shared/src/outbound-http/headers.ts#L15-L15).
  ข้อความเริ่มต้น `/** Returns the offending header name, or null when every header is allowed. */`.
  เหตุผลที่เสนอให้ลบ แปล return branches ของ findInvalidHeader ซ้ำ ชื่อ helper กับชนิด string|null และ return name/null สื่อครบแล้ว ไม่แตะ policy checks
  หลักฐาน packages/shared/src/outbound-http/headers.ts:16-30 findInvalidHeader คืน name เมื่อ check ไม่ผ่าน แล้วคืน null

- [x] D147 [`packages/shared/src/outbound-http/send.ts:481-482`](../packages/shared/src/outbound-http/send.ts#L481-L482).
  ข้อความเริ่มต้น `* Sends one request through the SSRF policy. *`.
  เหตุผลที่เสนอให้ลบ เป็นประโยคเปิดบอกหน้าที่ซ้ำชื่อ sendOutboundRequest เก็บ failure, pre-validation และ redirect contracts บรรทัด 483-487 ครบ
  หลักฐาน packages/shared/src/outbound-http/send.ts:489-492 sendOutboundRequest และ 509-519 URL/method/header validation

- [x] D148 [`packages/shared/tests/monitor-check/snapshot.test.ts:1033`](../packages/shared/tests/monitor-check/snapshot.test.ts#L1033-L1033).
  ข้อความเริ่มต้น `// surrogate pair`.
  เหตุผลที่เสนอให้ลบ เป็น label ที่แปลคู่ literal emoji กับ escaped surrogate pair ตรงๆ ไม่ได้บอกเหตุผล fixture เพิ่ม
  หลักฐาน packages/shared/tests/monitor-check/snapshot.test.ts:1034 cases มี x😀y และ x\ud83d\ude00y; 1050-1075 it.each ตรวจ masking

- [x] D149 [`packages/shared/tests/monitor-check/snapshot.test.ts:1039`](../packages/shared/tests/monitor-check/snapshot.test.ts#L1039-L1039).
  ข้อความเริ่มต้น `// JSON-escaped quote and backslash`.
  เหตุผลที่เสนอให้ลบ เป็น label บอก quote/backslash ที่คู่ literal แสดงอยู่แล้ว ไม่ได้ระบุ platform encoder หรือ safety constraint
  หลักฐาน packages/shared/tests/monitor-check/snapshot.test.ts:1040 คู่ secret/echo ของ quote และ backslash; 1050-1075 it.each ตรวจ masking

- [x] D150 [`packages/shared/tests/monitor-check/snapshot.test.ts:1158`](../packages/shared/tests/monitor-check/snapshot.test.ts#L1158-L1158).
  ข้อความเริ่มต้น `// Earlier headers were scanned; once the budget ran out the rest are masked whole.`.
  เหตุผลที่เสนอให้ลบ บรรยาย earlier/later header assertions ซ้ำชื่อ test ว่า later headers fail closed และ expected values ถัดไป
  หลักฐาน packages/shared/tests/monitor-check/snapshot.test.ts:1140 และ 1159-1165 ตรวจ header แรกไม่ใช่ mask, header สุดท้ายเป็น mask และ body ถูก mask ทั้งก้อน


### Root และ tooling

- [x] D151 [`.env.example:15`](../.env.example#L15-L15).
  ข้อความเริ่มต้น `# --- Database (packages/db) ---`.
  เหตุผลที่เสนอให้ลบ ป้าย Database ซ้ำกับ DATABASE_URL และ DATABASE_OWNER_URL ถัดไป; เก็บคำอธิบายสิทธิ์ทั้งสอง role
  หลักฐาน .env.example:16-20 DATABASE_URL และ DATABASE_OWNER_URL

- [x] D152 [`.env.example:22`](../.env.example#L22-L22).
  ข้อความเริ่มต้น `# --- Redis transport (queue workers) ---`.
  เหตุผลที่เสนอให้ลบ ป้าย Redis transport ซ้ำกับ REDIS_URL และคำอธิบาย transport/durable state ที่เก็บไว้
  หลักฐาน .env.example:23-25 REDIS_URL

- [x] D153 [`.env.example:33`](../.env.example#L33-L33).
  ข้อความเริ่มต้น `# --- Auth (Better Auth) ---`.
  เหตุผลที่เสนอให้ลบ ป้าย Auth ซ้ำชื่อ BETTER_AUTH_SECRET; เก็บข้อกำหนดความยาวและการสร้าง secret
  หลักฐาน .env.example:34-36 BETTER_AUTH_SECRET

- [x] D154 [`.env.example:38`](../.env.example#L38-L38).
  ข้อความเริ่มต้น `# --- Origins ---`.
  เหตุผลที่เสนอให้ลบ ป้าย Origins ซ้ำกับ APP_URL, BETTER_AUTH_URL และ CORS_ORIGIN ที่มีคำอธิบายแต่ละค่าแล้ว
  หลักฐาน .env.example:39-47 APP_URL, BETTER_AUTH_URL, CORS_ORIGIN

- [x] D155 [`.env.example:49`](../.env.example#L49-L49).
  ข้อความเริ่มต้น `# --- SMTP ---`.
  เหตุผลที่เสนอให้ลบ ป้าย SMTP ซ้ำกับกลุ่ม SMTP_*; เก็บคำเตือน production และเงื่อนไข TLS/credentials
  หลักฐาน .env.example:50-60 SMTP_HOST, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM

- [x] D156 [`.github/workflows/ci.yml:67-68`](../.github/workflows/ci.yml#L67-L68).
  ข้อความเริ่มต้น `# Coverage is measured and uploaded on every run; thresholds fail the build # because COVERAGE_GATE=1 is set (first domain feature: auth/onboarding).`.
  เหตุผลที่เสนอให้ลบ คำบรรยาย coverage/upload/gate ซ้ำชื่อ job, COVERAGE_GATE และ calls; provenance auth/onboarding ไม่อธิบายข้อจำกัดปัจจุบัน แยกออกจากบริบท least-privilege และฐานข้อมูลจริงที่ต้องเก็บ
  หลักฐาน .github/workflows/ci.yml:74-75 test/unit tests + coverage; 92-93 COVERAGE_GATE; 168 test:coverage; 175-180 upload-artifact

- [x] D157 [`.gitleaks.toml:1`](../.gitleaks.toml#L1-L1).
  ข้อความเริ่มต้น `# NightWatch gitleaks baseline.`.
  เหตุผลที่เสนอให้ลบ ชื่อ NightWatch gitleaks baseline ซ้ำค่า title โดยตรง; ไม่ลบบรรทัดอธิบาย fail-closed ถัดไป
  หลักฐาน .gitleaks.toml:5 title = "NightWatch gitleaks baseline"

- [x] D158 [`scripts/db.mjs:12`](../scripts/db.mjs#L12-L12).
  ข้อความเริ่มต้น `* Root aliases (package.json): db:up / db:down / db:logs / db:psql / db:mail.`.
  เหตุผลที่เสนอให้ลบ รายการ root aliases ซ้ำ mapping scripts ใน package.json และ case labels ในไฟล์นี้ ไม่ใช่คำเตือน secrets หรือข้อกำหนด role
  หลักฐาน package.json:22-26 db:up/db:down/db:logs/db:psql/db:mail; scripts/db.mjs:78-104 switch (command)

- [x] D159 [`scripts/dev-env.mjs:8-11`](../scripts/dev-env.mjs#L8-L11).
  ข้อความเริ่มต้น ``* Shared development-environment resolution for the root workflow commands * (`dev`, `db:migrate`, operator provisioning). Every consumer gets the same``.
  เหตุผลที่เสนอให้ลบ เกริ่นว่าเป็น shared resolver สำหรับ wrappers ซ้ำชื่อ resolveDevEnv และ imports/calls ของ consumers; เก็บรายการ precedence และ production constraints ตั้งแต่บรรทัด 12
  หลักฐาน scripts/dev-env.mjs:54-89 resolveDevEnv; scripts/dev.mjs:12-14; scripts/migrate.mjs:10-12; scripts/provision.mjs:18-22

- [x] D160 [`scripts/dev.mjs:3-7`](../scripts/dev.mjs#L3-L7).
  ข้อความเริ่มต้น ``* Root `dev` entrypoint: computes this worktree's ports and runs the turbo * dev graph with WEB_PORT/API_PORT injected, so every worktree gets an``.
  เหตุผลที่เสนอให้ลบ เกริ่นการคำนวณ ports, เรียก turbo dev และตำแหน่ง resolver ซ้ำ import, assignments และ spawn; เก็บบรรทัด 8 เรื่อง db:up และคำอธิบาย PORT convention
  หลักฐาน scripts/dev.mjs:12-14 resolveDevEnv; 24-26 WEB_PORT/API_PORT/PORT; 32-35 spawn("turbo", ["run", "dev"])

- [x] D161 [`scripts/migrate.mjs:3`](../scripts/migrate.mjs#L3-L3).
  ข้อความเริ่มต้น ``* Root `db:migrate` wrapper; environment resolution lives in scripts/dev-env.mjs.``.
  เหตุผลที่เสนอให้ลบ ชื่อ root db:migrate wrapper และตำแหน่ง resolver ซ้ำ package script, import และ spawn; เก็บ owner-before-app contract ของ CLI
  หลักฐาน package.json:27 db:migrate; scripts/migrate.mjs:10-12 resolveDevEnv; 22-25 spawn @nightwatch/db migrate

- [x] D162 [`scripts/partitions.mjs:19-21`](../scripts/partitions.mjs#L19-L21).
  ข้อความเริ่มต้น ``* Environment: same resolution as `db:migrate` (scripts/dev-env.mjs). *   PARTITION_MONTHS_AHEAD  optional, integer 0..12, default 3``.
  เหตุผลที่เสนอให้ลบ ตำแหน่ง resolver และรายการ optional defaults/bounds ซ้ำ import กับ intFromEnv calls โดยตรง; ไม่แตะ ownership, retention หรือ lock rationale
  หลักฐาน scripts/partitions.mjs:25-27 resolveDevEnv; 29-41 intFromEnv, PARTITION_MONTHS_AHEAD=3/0..12, PARTITION_LOCK_TIMEOUT_MS=5000/1..30000

- [x] D163 [`scripts/partitions.mjs:75`](../scripts/partitions.mjs#L75-L75).
  ข้อความเริ่มต้น `// Partitions are already committed; only the listing failed.`.
  เหตุผลที่เสนอให้ลบ คำบรรยายว่า commit แล้วและ listing ล้มเหลวซ้ำข้อความ warning ใน catch เดียวกัน
  หลักฐาน scripts/partitions.mjs:55-60 await sql.begin; 63-77 listing query และ "partitions committed; listing skipped"

- [x] D164 [`scripts/ports.mjs:2-5`](../scripts/ports.mjs#L2-L5).
  ข้อความเริ่มต้น `* Per-worktree port allocation. Single source of truth for the API and web * dev servers and the e2e suite, giving each git worktree a stable default`.
  เหตุผลที่เสนอให้ลบ เกริ่นเรื่อง port allocation และผู้ใช้ dev/e2e ซ้ำชื่อไฟล์, resolvePorts และ callers; เก็บรายละเอียด collision, override ตอน collision และเหตุผลหลบ system services
  หลักฐาน scripts/ports.mjs:38-55 worktreeSlot/resolvePorts; scripts/dev.mjs:14,24-26; scripts/db.mjs:51-62; scripts/e2e.mjs:11

- [x] D165 [`scripts/ports.mjs:12-13`](../scripts/ports.mjs#L12-L13).
  ข้อความเริ่มต้น ``* - `WEB_PORT` / `API_PORT` always win (CI, containers, manual override). *``.
  เหตุผลที่เสนอให้ลบ ข้อความ WEB_PORT/API_PORT ชนะค่า default ซ้ำการอ่าน env ผ่าน parsePort ก่อนใช้ fallback โดยตรง
  หลักฐาน scripts/ports.mjs:49-50 webPort: parsePort(env.WEB_PORT) ?? BASE_WEB_PORT + slot; apiPort: parsePort(env.API_PORT) ?? BASE_API_PORT + slot

- [x] D166 [`scripts/provision.mjs:8-10`](../scripts/provision.mjs#L8-L10).
  ข้อความเริ่มต้น `*   bun run provision:organization -- \ *     --name "Acme" --slug acme --owner-email admin@example.com`.
  เหตุผลที่เสนอให้ลบ ตัวอย่างชื่อคำสั่งและ flags ซ้ำ usage ที่แสดงเมื่อไม่ส่ง args; ไม่ลบ invitation-only และ no-password contract
  หลักฐาน scripts/provision.mjs:32-36 usage provision:organization -- --name --slug --owner-email; package.json:30 provision:organization

- [x] D167 [`scripts/provision.mjs:14`](../scripts/provision.mjs#L14-L14).
  ข้อความเริ่มต้น `* All arguments are forwarded explicitly to the CLI; nothing is fabricated.`.
  เหตุผลที่เสนอให้ลบ คำบรรยายส่งทุก argument ต่อซ้ำ process.argv.slice(2) และ ...args ใน spawn ไม่มีข้อจำกัด SMTP หรือ owner role เพิ่มเติม
  หลักฐาน scripts/provision.mjs:20 const args = process.argv.slice(2); 39-43 spawn @nightwatch/api provision-organization ...args

- [x] D168 [`scripts/quality/check-agent-config.mjs:216`](../scripts/quality/check-agent-config.mjs#L216-L216).
  ข้อความเริ่มต้น `// Flows wire agents and skills together; worker agents and leaf skills name neither.`.
  เหตุผลที่เสนอให้ลบ ประโยคนโยบาย flow/worker/leaf ซ้ำเงื่อนไข worker/leaf และ error messages ที่ตั้งชื่อข้อห้ามตรงตัว รวมถึงชื่อ tests
  หลักฐาน scripts/quality/check-agent-config.mjs:217-225 flowSkills; 240-250 worker/leaf checks; scripts/quality/check-agent-config.test.mjs:229-265 "keeps worker agents and leaf skills free of skill and agent references" และ "lets commands and the lead wire agents and skills together"

## ผลตรวจรายไฟล์

บรรทัดที่อ่านเป็นหลักฐานการอ่าน source ระหว่างตรวจ. Generated code และ migration ตรวจเพื่อจัดสถานะ protected ไม่ใช่อนุญาตให้ลบ comment. ไฟล์ missing ไม่มีเนื้อหาให้ตรวจ.

### API

- [x] `apps/api/Dockerfile`. reviewed. อ่าน 1-65. เสนอให้ลบ 0 ช่วง. เก็บ syntax directive, เงื่อนไข build context, dependency cache, bundling และวิธีใช้ migration image รวมทั้งข้อห้ามนำ owner credentials เข้า app runtime ซึ่ง Docker instructions อย่างเดียวอธิบายไม่ครบ
- [x] `apps/api/eslint.config.js`. reviewed. อ่าน 1-3. เสนอให้ลบ 0 ช่วง. อ่าน eslint.config.js ครบ พบเพียง createConfig api export ไม่มี comment
- [x] `apps/api/package.json`. reviewed. อ่าน 1-38. เสนอให้ลบ 0 ช่วง. อ่าน package.json ครบ มี scripts/dependencies ไม่มี comment
- [x] `apps/api/src/app.integration.test.ts`. reviewed. อ่าน 435-548. เสนอให้ลบ 1 ช่วง. ลบย่อหน้าแจ้ง coverage ของ schema และบรรยายการไม่เปิด DB ซึ่งชื่อเทสต์และ spies ยืนยันอยู่แล้ว เก็บเหตุผลที่ search term เป็นข้อมูลส่วนบุคคล
- [x] `apps/api/src/app.ts`. reviewed. อ่าน 26-88, 99-139, 403-443, 508-583. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล optional dependencies สำหรับ spec/tests, การปิดบัง path, Hono encoded slash และ client error, ลำดับ CORS ก่อน auth และเหตุผล parallel readiness
- [x] `apps/api/src/audit/contract-parity.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน contract-parity.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/audit/denials.ts`. reviewed. อ่าน 1-24. เสนอให้ลบ 0 ช่วง. เก็บขอบเขตข้อมูลใน auditDenials ว่าไม่บันทึก target organization หรือข้อมูลสมาชิก
- [x] `apps/api/src/audit/events.db.test.ts`. reviewed. อ่าน 1-40, 48-88, 409-449, 698-738. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย parse auditChangeSchema ใน events ส่วนเหตุผลฐานข้อมูลแยกเพื่อหลีกเลี่ยง trigger deadlock, bearer-id privacy และ sequential rollback attempts ต้องเก็บ
- [x] `apps/api/src/audit/export-parity.db.test.ts`. reviewed. อ่าน 1-96, 140-300. เสนอให้ลบ 1 ช่วง. ลบ header อธิบาย coverage list/export parity เพราะ viaList, viaExport และ expect(fromExport).toEqual(fromList) บอกอยู่แล้ว เก็บ retention fixture, ข้อจำกัด partition และที่มาของจำนวน 18 แถว
- [x] `apps/api/src/audit/export-service.ts`. reviewed. อ่าน 23-68, 107-203, 218-258, 266-307, 313-405. เสนอให้ลบ 0 ช่วง. เก็บ lock order ของ requireExporter, สิทธิ์ก่อน count/download, cancellation commit window, การไม่บันทึก search text และการใช้ snapshot เดียวป้องกันข้อมูลรั่ว
- [x] `apps/api/src/audit/export.db.test.ts`. reviewed. อ่าน 62-133, 293-333, 593-634, 643-684, 693-734, 793-879. เสนอให้ลบ 1 ช่วง. ลบ JSDoc ของ seedExport ที่ทวน parameters และ ctx.owner.sql.query เก็บ stale-export rollback, ตัวกรอง session รอ lock, demotion barriers และ download isolation
- [x] `apps/api/src/audit/path-logging.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน path-logging.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ env, authEnv, organizationId; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/audit/read-retention.db.test.ts`. reviewed. อ่าน 1-35, 116-151. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลที่ต้องสร้าง partition ในฐานข้อมูลแยกและข้อกำหนดไม่แสดงเหตุการณ์ก่อน recording start
- [x] `apps/api/src/audit/read-service.ts`. reviewed. อ่าน 15-59, 117-157, 190-233, 318-359, 402-446. เสนอให้ลบ 0 ช่วง. เก็บ SQL/TypeScript role normalization ใน snapshot เดียว, เหตุการณ์ monitor รุ่นก่อน Project, filter parameter contract และการตรวจสิทธิ์ก่อน malformed-id lookup/export count
- [x] `apps/api/src/audit/read.db.test.ts`. reviewed. อ่าน 17-57, 352-392, 572-647, 658-698. เสนอให้ลบ 1 ช่วง. ลบป้ายบอกว่าหน้า list ใช้ target shape เดียวกับ export ซึ่ง assertion เทียบให้แล้ว เก็บ email privacy และ authorization order; uncertain ที่ Seed.at ระบุ default now() แต่ seed ใช้ clock_timestamp() จึงไม่เสนอให้ลบคำนิยาม SQL expression
- [x] `apps/api/src/audit/record.ts`. reviewed. อ่าน 17-100. เสนอให้ลบ 0 ช่วง. เก็บ writer/read target distinction, public invitation id, การห้าม attributes มีข้อมูลส่วนบุคคล, normalized role และ redaction/transaction obligations ของ recordAuditEvent
- [x] `apps/api/src/audit/routes.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน routes.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ jsonError, readErrors, base; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/audit/shared-parity.test.ts`. reviewed. อ่าน 5-46. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลที่ Worker ใช้ shared แต่ API/web ใช้ contract ทำให้ต้องมี parity ระหว่างสำเนาค่าคงที่
- [x] `apps/api/src/audit/store-migration.db.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน store-migration.db.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ isolated, run, legacyTenant; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/audit/store.db.test.ts`. reviewed. อ่าน 23-64, 92-132, 202-242. เสนอให้ลบ 0 ช่วง. เก็บความสัมพันธ์ age กับ partition, เหตุผล -130 days ทำให้ insert ล้มเหลว และข้อกำหนด isolation แม้ query ใช้ id ของ tenant อื่น
- [x] `apps/api/src/audit/test-support.ts`. reviewed. อ่าน 1-62, 89-151. เสนอให้ลบ 0 ช่วง. เก็บข้อกำหนด owner connection, drop เฉพาะ partition ที่สร้างเอง, DDL parent-table locks และ database isolation รวมทั้ง simple-query atomicity ของ trigger DDL
- [x] `apps/api/src/auth/auth-origin-intents.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน auth-origin-intents.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ Write, FakeAdapter, FakeTransaction; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/auth/auth-origin-intents.ts`. reviewed. อ่าน 16-32, 61-78, 173-191. เสนอให้ลบ 0 ช่วง. เก็บ same-transaction origin writes, เหตุผลใช้ WeakSet แทนเพิ่มคอลัมน์ใน auth payload และการใช้ transaction-bound adapter แทน pool
- [x] `apps/api/src/auth/auth.db.test.ts`. reviewed. อ่าน 17-34, 55-71, 90-121, 194-211, 330-347, 508-525, 542-572, 725-742, 973-989, 1003-1020, 1038-1054, 1076-1092, 1111-1128, 1265-1282, 1457-1474, 1506-1534, 1879-1896, 1909-1926, 2013-2030, 2170-2217, 2266-2283, 2299-2316, 2321-2337. เสนอให้ลบ 1 ช่วง. ลบ inventory ของ first-party route coverage ท้าย native-route denial test เก็บทุกเหตุผลเกี่ยวกับ TOTP/secret digests, enumeration safety, lock scheduling, replay consumption, upstream refusal และ fixture isolation
- [x] `apps/api/src/auth/callback-continuation.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน callback-continuation.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ authEnv, verifyUrlWithCallback; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/auth/emails.test.ts`. reviewed. อ่าน 40-56. เสนอให้ลบ 0 ช่วง. เก็บข้อกำหนด escape ชื่อองค์กรที่ผู้ใช้ป้อนเพื่อไม่ให้หลุดออกจาก HTML body
- [x] `apps/api/src/auth/emails.ts`. reviewed. อ่าน 1-50. เสนอให้ลบ 0 ช่วง. เก็บ token lifetime ที่ต้องตรง auth, เหตุผล duplicate role labels ข้าม app, light theme/flattened colors สำหรับ mail clients และ escaped introHtml contract
- [x] `apps/api/src/auth/index.ts`. reviewed. อ่าน 31-47, 50-67, 93-109, 147-164, 175-200, 218-234, 243-259. เสนอให้ลบ 0 ช่วง. เก็บ blocked native paths, same-origin continuation ป้องกัน open redirect, session entry point, Better Auth AC type limitation, sanitized logging และ asynchronous reset mail ป้องกัน enumeration
- [x] `apps/api/src/auth/invitations.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน invitations.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ stubDatabase, VALID_ROW; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/auth/invitations.ts`. reviewed. อ่าน 1-12, 32-48. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล raw SQL เพื่อทดสอบผ่าน sql seam และ generic signup denial ที่ไม่เปิดเผยเหตุผล
- [x] `apps/api/src/auth/mailer.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน mailer.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/auth/mailer.ts`. reviewed. อ่าน 3-25. เสนอให้ลบ 0 ช่วง. เก็บข้อห้าม log ผู้รับหรือ body เพราะมี single-use links และเหตุผลแสดงชื่อ NightWatch เมื่อ sender เป็น bare address
- [x] `apps/api/src/auth/member-race.test.ts`. reviewed. อ่าน 8-24, 35-63, 129-145. เสนอให้ลบ 0 ช่วง. เก็บรูปแบบ drizzle wrapped error, ความแตกต่าง SQLSTATE/constraint และเหตุผลต้องทดสอบ transaction-scoped adapter
- [x] `apps/api/src/auth/member-race.ts`. reviewed. อ่าน 1-15, 30-46, 51-69, 90-106. เสนอให้ลบ 0 ช่วง. เก็บ uniqueness-only translation และ stale-id race rationale; uncertain ที่ comment อ้าง Better Auth 1.6.23 แต่ package.json ระบุ 1.7.7 จึงไม่เสนอให้ลบเหตุผล concurrency โดยเดาว่าแก้แล้ว
- [x] `apps/api/src/auth/permissions.ts`. reviewed. อ่าน 3-19. เสนอให้ลบ 0 ช่วง. เก็บข้อเท็จจริงว่า viewer/auditor เป็น domain labels ต่างกันแต่ไม่ให้สิทธิ์จัดการองค์กรทั้งคู่
- [x] `apps/api/src/hello/routes.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน routes.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ helloRoute, registerHelloRoutes; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/hello/service.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน service.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ HELLO_MESSAGE, getHello; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/index.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน index.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ env, authEnv, logger; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/me/routes.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน routes.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ ORG_A, ORG_B, ORG_C; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/me/routes.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน routes.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ meContextRoute, activeOrgRoute, resolveActiveOrgRoute; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/me/service-rollback.db.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน service-rollback.db.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/me/service.db.test.ts`. reviewed. อ่าน 210-227, 314-331, 350-367. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลที่ต้องใช้ live pg_blocking_pids คู่กับ activity snapshot, typed promise-only pg seam และการ restore scheduling spy ก่อน client กลับไปใช้ callback overload
- [x] `apps/api/src/me/service.ts`. reviewed. อ่าน 4-21, 23-39, 55-71, 113-129, 146-163, 249-288. เสนอให้ลบ 0 ช่วง. เก็บ isolation ของ auth tables ที่ไม่มี RLS, composite role projection, TOTP session boundary, stale selection, lock graph/retry และการไม่แย่ง org lock ของ nonmember รวมทั้ง broken-connection cleanup
- [x] `apps/api/src/monitors/audit.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน audit.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ QUERY_VALUE, QUERY_VALUE_2, BODY_VALUE; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/monitors/audit.ts`. reviewed. อ่าน 10-33, 70-94, 106-124, 126-143, 170-190, 250-266, 373-389, 399-415. เสนอให้ลบ 0 ช่วง. เก็บ secret slot names-only contract, query masking, duplicate entry ordinals, reorder/value-only diffs และหนึ่ง action ต่อ Edit ซึ่งเป็น domain/privacy rules ไม่ใช่ป้ายส่วน
- [x] `apps/api/src/monitors/config-changes.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน config-changes.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ base, noSecrets, diff; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/monitors/config-changes.ts`. reviewed. อ่าน 5-21, 32-49, 68-110, 140-160, 169-185. เสนอให้ลบ 0 ช่วง. เก็บ jsonb surrogate constraint, secret header identity, case-sensitive rename, การไม่เก็บค่าที่เพิ่งกลายเป็น secret และ redacted event-feed diff contract
- [x] `apps/api/src/monitors/contract-parity.test.ts`. reviewed. อ่าน 18-35, 50-66, 116-132. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล browser-safe contract import shared ไม่ได้, CR/LF/NUL reason differences และ StoredAssertion ที่ executor รับได้โดยไม่แปลง
- [x] `apps/api/src/monitors/contract.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน contract.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ jsonError, invalidResponse, mediaTypeResponse; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/monitors/health.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน health.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ INTERVAL, facts, latest; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/monitors/health.ts`. reviewed. อ่าน 6-46, 50-67, 72-108. เสนอให้ลบ 0 ช่วง. เก็บ database precision, resume/freshness boundary, incident state และเหตุผลห้ามใช้ expiry เก่าตัดสิน unreadable/non-https certificate
- [x] `apps/api/src/monitors/invalid-input.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน invalid-input.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ fieldsOf; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/monitors/invalid-input.ts`. reviewed. อ่าน 1-16, 19-37. เสนอให้ลบ 0 ช่วง. เก็บ allow-list field paths ที่ไม่สะท้อน input และ invalid-input hook ที่ไม่ส่ง Zod message รวมถึงลำดับก่อน auth
- [x] `apps/api/src/monitors/params.ts`. reviewed. อ่าน 1-17. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลยอมรับ raw malformed id ใน schema แล้วคืน 404 ใน handler แทน validation 400
- [x] `apps/api/src/monitors/path-logging.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน path-logging.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ env, authEnv, organizationId; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/monitors/project-scope.db.test.ts`. reviewed. อ่าน 18-41, 71-95, 143-182, 218-235, 514-530, 547-564. เสนอให้ลบ 1 ช่วง. ลบ JSDoc ของ Route.monitor ซึ่ง pathOf ใช้เลือก monitorId ชัดเจน เก็บบทบาท fixture, cross-Project IDOR และการเทียบ p95 กับ response-times route
- [x] `apps/api/src/monitors/read-detail.db.test.ts`. reviewed. อ่าน 301-317, 361-412, 554-570, 572-589, 618-634, 643-681, 702-730, 740-758, 832-921. เสนอให้ลบ 1 ช่วง. ลบ coverage inventory ของ SSL unit matrix เก็บทุก fixture-time/coverage arithmetic, resume clock skew, rounding, URL-change pagination และ access isolation rationale
- [x] `apps/api/src/monitors/read-event-feed.db.test.ts`. reviewed. อ่าน 93-123. เสนอให้ลบ 1 ช่วง. ลบ coverage inventory ที่อ้าง suffix loop ใน read-detail และบอกเหตุผลเก็บ no-session case เพราะเป็นรายการเทสต์ ไม่ใช่ runtime constraint เก็บการทำ timestamps ให้เสมอกันเพื่อพิสูจน์ rank/id tie-break
- [x] `apps/api/src/monitors/read-list.db.test.ts`. reviewed. อ่าน 69-85, 251-289, 336-352, 360-433, 490-506, 525-541, 619-636, 645-705, 903-919. เสนอให้ลบ 3 ช่วง. ลบ SSL coverage inventory, sort issue banner และตารางสำเนา seedSortOrganization เก็บ scrambled order rationale, SSL ceil timing, uptime arithmetic, wildcard search fixtures, p95 fixtures และ hour-boundary sparkline logic รวมถึง inline fixture annotations
- [x] `apps/api/src/monitors/read-membership.db.test.ts`. reviewed. อ่าน 23-41, 114-130, 156-172. เสนอให้ลบ 0 ช่วง. เก็บตำแหน่ง race ระหว่าง precheck กับ transaction, เหตุผลใช้ owner เพื่อผ่าน last-response precheck และ Project membership ที่ยังอ่านได้หลัง demotion
- [x] `apps/api/src/monitors/read-response-times.db.test.ts`. reviewed. อ่าน 43-72, 98-114, 315-348. เสนอให้ลบ 1 ช่วง. ลบ coverage inventory ที่อ้าง read-detail suffix loop เก็บ database-hour clock และ pause/gap fixture timing
- [x] `apps/api/src/monitors/read-routes.ts`. reviewed. อ่าน 212-229. เสนอให้ลบ 0 ช่วง. เก็บ registration order ของ static recent-events ก่อน plain-string monitorId เพื่อไม่ให้ route ถูกจับผิด
- [x] `apps/api/src/monitors/read-service.ts`. reviewed. อ่าน 44-89, 129-156, 189-205, 292-326, 434-455, 503-523, 548-566, 571-587, 603-621, 624-652, 735-753, 766-785, 848-881, 959-975, 996-1013, 1019-1036, 1208-1224, 1300-1318, 1335-1352, 1391-1427, 1516-1533. เสนอให้ลบ 0 ช่วง. เก็บ Project authorization/locks, transaction-time consistency, indexed lateral probes, database microseconds, UTC/bigint sparkline handling, p95/null sorting, URL-change page bounds และ actor/response privacy
- [x] `apps/api/src/monitors/read-test-support.ts`. reviewed. อ่าน 1-16, 84-100, 130-146, 150-176. เสนอให้ลบ 0 ช่วง. เก็บ owner/database-clock fixture semantics, default Project, scheduled/checked instant equality, Worker rollup parity และความหมาย responseChecks/defaults
- [x] `apps/api/src/monitors/record.ts`. reviewed. อ่าน 64-84, 86-119, 162-195. เสนอให้ลบ 0 ช่วง. เก็บ secret-header slot identity/reuse/casing, ข้อห้าม secrets เข้า headers column, jsonb canonical ordering และ normalized assertion equality
- [x] `apps/api/src/monitors/routes.ts`. reviewed. อ่าน 17-43. เสนอให้ลบ 0 ช่วง. เก็บ optional outbound/Redis/credential behavior และ static test/recent-events route precedence แม้มี Task provenance เพราะอยู่ร่วมกับเหตุผล routing ที่ต้องรักษา
- [x] `apps/api/src/monitors/secrets.db.test.ts`. reviewed. อ่าน 37-54, 110-127, 199-215, 253-269, 345-362, 414-430, 677-693, 763-779, 812-828, 912-936, 949-976, 989-1017, 1050-1066, 1449-1466. เสนอให้ลบ 1 ช่วง. ลบประโยคทวน first-hop authorization assertion เก็บ run-unique secret markers, isolated trigger DB, leak scan, Basic slot rule, save/test DNS order, one-statement origin/secret snapshot และ demotion/removal race barriers
- [x] `apps/api/src/monitors/secrets.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน secrets.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ at, origins, HEADER; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/monitors/secrets.ts`. reviewed. อ่าน 10-29, 39-72, 76-92, 110-139. เสนอให้ลบ 0 ช่วง. เก็บ requiredSlots error field, canonical writes/deleted stored slots, save/test missing-secret differences และ origin handling ของ forbidden/unparseable URL
- [x] `apps/api/src/monitors/service.ts`. reviewed. อ่าน 40-67, 79-96, 100-123, 126-171, 188-205, 257-275, 300-317, 323-341, 351-372, 420-529, 505-541, 548-564, 595-624, 650-668. เสนอให้ลบ 0 ช่วง. เก็บ idempotent changed flag, malformed-id policy, DNS deadline/saveability, lock order, encryption AAD, replay precedence, secret-origin check, schedule NULL/GREATEST semantics และ late-result/notification lifecycle. Parent อ่านเพิ่ม 420-529 และเก็บ SQL comment 487-488 ซึ่งอธิบายเหตุผลที่ certificate เดิมใช้กับ destination ใหม่ไม่ได้.
- [x] `apps/api/src/monitors/test-route.db.test.ts`. reviewed. อ่าน 39-76, 252-269, 310-326, 416-432, 435-451, 804-820, 851-867, 873-889, 954-970, 1002-1035, 1166-1194, 1431-1448. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย strict().parse ใน resultOf เก็บ listener counters, redirect-hop fixture, clock seam, validated-peer disclosure, rate-limit timing, no-response assertions, isolation และ Bun real-listener rationale
- [x] `apps/api/src/monitors/test-route.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน test-route.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ DAY, NOW, check; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/monitors/test-route.ts`. reviewed. อ่าน 155-180, 200-256, 309-326, 340-434, 458-474, 485-502, 529-546. เสนอให้ลบ 0 ช่วง. เก็บ validation-before-quota, kept-secret atomic snapshot, release-before-outbound, decrypt failure parity และ route/signal constraints; uncertain ที่ certificate JSDoc อยู่เหนือ diagnosticsOf ซึ่งคืน timing/peer facts แต่เนื้อหาตรงกับ sslOfCheck ด้านล่าง ไม่เสนอ deletion แทนแก้ตำแหน่ง
- [x] `apps/api/src/monitors/test-support.db.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน test-support.db.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ ctx; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/monitors/test-support.ts`. reviewed. อ่าน 18-58, 73-103, 112-128. เสนอให้ลบ 0 ช่วง. เก็บ fixture Project/defaultProject semantics, JSON/raw body distinctions, DNS stub contract, per-suite database/credential options และเหตุผลแยก pg callback connect จาก promise recording
- [x] `apps/api/src/monitors/uptime.test.ts`. reviewed. อ่าน 119-135, 139-155, 203-228. เสนอให้ลบ 0 ช่วง. เก็บที่มาของ expected seconds/check coverage และการตัด pause ออกจาก gap รวมทั้ง interval-increase timing rationale
- [x] `apps/api/src/monitors/uptime.ts`. reviewed. อ่าน 9-41, 66-105, 115-136. เสนอให้ลบ 0 ช่วง. เก็บ retention-driven window rounding, pause inference เมื่อประวัติถูก purge, pass/fail-only checks, การไม่ปัด failure เป็น 100% และ larger-interval gap definition
- [x] `apps/api/src/monitors/write-event-feed.db.test.ts`. reviewed. อ่าน 148-164. เสนอให้ลบ 0 ช่วง. เก็บข้อจำกัดไม่ให้ feed หรือ stored changes มี secret, query value หรือ body
- [x] `apps/api/src/monitors/write-lifecycle.db.test.ts`. reviewed. อ่าน 14-48, 80-96, 110-174, 159-176, 335-351, 1180-1196. เสนอให้ลบ 0 ช่วง. เก็บ isolated trigger DB, partition setup, fresh Project เพื่อไม่ชน limit 20, keep-secret Edit shape, DB-time semantics และ redacted mutation audit rules. Parent อ่านเพิ่ม 110-174 และเก็บ SQL comment 146 ที่ระบุว่าต้องใช้ predicate เดียวกับ claim_due_monitor_checks.
- [x] `apps/api/src/monitors/write.db.test.ts`. reviewed. อ่าน 15-32, 125-142, 197-213, 308-324, 422-438, 748-764. เสนอให้ลบ 0 ช่วง. เก็บ fresh Project quota rationale, target/resume setup, cross-Organization mutation isolation, final URL limit และ listener ที่ต้องไม่ได้รับ SSRF requests
- [x] `apps/api/src/notifications/audit-export-items.db.test.ts`. reviewed. อ่าน 70-86, 119-135. เสนอให้ลบ 0 ช่วง. เก็บความสัมพันธ์ fixture materialization กับ Worker dispatch และ audit-export notification ถึง requester ที่ถูกลดสิทธิ์แล้ว
- [x] `apps/api/src/notifications/contract.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน contract.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ invalidInputResponse, unauthenticatedResponse, emailNotVerifiedResponse; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/notifications/cursor.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน cursor.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ secret, scope, anchor; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/notifications/cursor.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน cursor.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ CURSOR_TTL_MS, CursorScope, CursorAnchor; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/notifications/invalid-input.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน invalid-input.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ invalidInputHook; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/notifications/list-plan.db.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน list-plan.db.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ database, owner, migrationsDir; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/notifications/monitor-items.db.test.ts`. reviewed. อ่าน 57-73, 121-137, 307-323, 429-445. เสนอให้ลบ 0 ช่วง. เก็บ completed-dispatch recipient snapshot, การไม่มี monitor/project rows เพื่อพิสูจน์ snapshot lifetime, non-monitor item visibility และ mark-all state ที่ส่งผลต่อ unreadCount
- [x] `apps/api/src/notifications/routes.db.test.ts`. reviewed. อ่าน 20-37, 399-415, 459-477. เสนอให้ลบ 0 ช่วง. เก็บ expiry-relative fixtures และเหตุผล stale active-org mirror ต้อง fallback ได้แม้ org row ถูก transaction อื่นล็อก
- [x] `apps/api/src/notifications/routes.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน routes.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ registerNotificationInboxRoutes; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/notifications/service.db.test.ts`. reviewed. อ่าน 27-44, 110-126, 342-358, 390-407, 868-884, 897-914. เสนอให้ลบ 0 ช่วง. เก็บ expiry fixtures, live lock polling, PostgreSQL microsecond text bounds, committed-but-hidden dispatch row และ dedicated-pool barriers ที่ไม่รั่วไปชุดทดสอบอื่น
- [x] `apps/api/src/notifications/service.ts`. reviewed. อ่าน 164-180, 206-223, 257-277, 310-326. เสนอให้ลบ 0 ช่วง. เก็บ nonmember precheck, scope lock ตลอด callback, monitor Project visibility ที่ตรวจใหม่ได้ และ query seam ที่ EXPLAIN ต้องวัด statement ที่ให้บริการจริง
- [x] `apps/api/src/onboarding/routes.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน routes.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ invitationPreviewRoute, invitationAcceptRoute, registerOnboardingRoutes; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/onboarding/service.ts`. reviewed. อ่าน 3-19, 40-56. เสนอให้ลบ 0 ช่วง. เก็บ not-found ที่ไม่เปิดช่อง enumeration และข้อจำกัด bearer lookup ใช้หาองค์กรแต่ไม่ให้ membership
- [x] `apps/api/src/operator/emit-openapi.ts`. reviewed. อ่าน 1-23. เสนอให้ลบ 0 ช่วง. เก็บ offline spec emission usage และคำอธิบาย placeholder URL ที่ไม่มี connection เพื่อไม่เข้าใจว่า codegen ต้องมีฐานข้อมูลจริง
- [x] `apps/api/src/operator/provision-e2e-fixture.db.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน provision-e2e-fixture.db.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ MIGRATIONS_DIR, database, runId; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/operator/provision-e2e-fixture.ts`. reviewed. อ่าน 102-118, 146-162. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล recreate fixture เพื่อล้าง sessions/MFA/password และ broken-connection cleanup
- [x] `apps/api/src/operator/provision-organization.cli.db.test.ts`. reviewed. อ่าน 1-47, 49-66, 92-115, 128-144. เสนอให้ลบ 0 ช่วง. เก็บ real CLI subprocess rationale, separate-session commit-before-mail observation, SMTP minimal protocol, quoted-printable parsing, duplicate links และ hung-child connection cleanup
- [x] `apps/api/src/operator/provision-organization.db.test.ts`. reviewed. อ่าน 4-39, 57-97, 100-152. เสนอให้ลบ 2 ช่วง. ลบประโยคทวน created/resent assertions และ concurrent retry assertions เก็บ run-unique fixture safety, inferred type, lazy pool, caller commit/rollback และ cascade cleanup
- [x] `apps/api/src/operator/provision-organization.race.db.test.ts`. reviewed. อ่าน 16-35, 161-178, 203-220, 452-468, 804-820. เสนอให้ลบ 0 ช่วง. เก็บ deterministic lock queue, provision transaction ownership, recursive blockers, operator no-cooldown policy และเหตุผลทดสอบ queue order เดียวเมื่อ requests interchangeable
- [x] `apps/api/src/operator/provision-organization.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน provision-organization.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ ARGS; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/operator/provision-organization.ts`. reviewed. อ่าน 7-33, 90-134, 160-176, 186-202, 252-268, 286-309. เสนอให้ลบ 0 ช่วง. เก็บ internal inviter FK/provenance, invitation TTL, caller commit-before-mail, advisory/row lock order, post-lock clock, operator resend policy, case-preserving email และ persisted invitation retry หลังส่งเมลล้มเหลว
- [x] `apps/api/src/operator/seed.db.test.ts`. reviewed. อ่าน 445-461, 515-531. เสนอให้ลบ 0 ช่วง. เก็บ migration advisory key coupling และการ restore checksum tracking row ก่อนปล่อย migration runner ที่กำลังรอ
- [x] `apps/api/src/operator/seed.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน seed.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ ownerUrl, runtimeUrl; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/operator/seed.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน seed.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ SEED_LOCK, ORIGIN, PASSWORD; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/organization-notifications/invitation-cancel.db.test.ts`. reviewed. อ่าน 135-151, 227-243. เสนอให้ลบ 0 ช่วง. เก็บ afterEach lock cleanup และ cross-organization membership boundary ของ cancel
- [x] `apps/api/src/organization-notifications/invitation-list.db.test.ts`. reviewed. อ่าน 74-90, 149-165, 261-277. เสนอให้ลบ 0 ช่วง. เก็บ SQL interval fixture semantics, cross-Organization list isolation และ sent_at tie fixture ที่ให้ public_id ตัดสินลำดับ
- [x] `apps/api/src/organization-notifications/invitation-migration.db.test.ts`. reviewed. อ่าน 22-39. เสนอให้ลบ 0 ช่วง. เก็บ temp table shadowing เพื่อรัน migration จริงบน pre-0018 shape โดยไม่ล็อก shared invitation table
- [x] `apps/api/src/organization-notifications/invitation-resend.db.test.ts`. reviewed. อ่าน 32-49, 191-207, 222-239, 288-304, 528-544, 794-810. เสนอให้ลบ 0 ช่วง. เก็บ commit-before-mail observation, afterEach lock cleanup, deterministic race order, role-matrix send count, cooldown และ case-insensitive expired/create fixture
- [x] `apps/api/src/organization-notifications/invitation-test-app.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน invitation-test-app.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ InvitationTestAppInput, createInvitationTestApp; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/organization-notifications/invitation-test-support.ts`. reviewed. อ่าน 61-78, 111-127, 134-151. เสนอให้ลบ 0 ช่วง. เก็บ clock-expression/undefined-expiry distinction, caller-owned rollback list และ recursive tuple-lock waiter detection
- [x] `apps/api/src/organization-notifications/invitations.db.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน invitations.db.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ orgA, orgB, absentOrg; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/organization-notifications/invitations.ts`. reviewed. อ่าน 75-92, 117-135, 226-246, 339-356. เสนอให้ลบ 0 ช่วง. เก็บ rejected-create mutation order, invitation-manager locks/anti-probing, rotating bearer id lifetime/clock contract และ activeCount ของ expired resend
- [x] `apps/api/src/organization-notifications/leave.db.test.ts`. reviewed. อ่าน 10-33, 106-123, 161-196, 251-267, 331-347, 385-401. เสนอให้ลบ 0 ช่วง. เก็บ opaque member IDs, distinct peers, multi-org session fixtures, holder-specific blocking, scheduled race changes และ self-leave/last-owner isolation rules
- [x] `apps/api/src/organization-notifications/members.db.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน members.db.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ run, organizationId, otherOrganizationId; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/organization-notifications/members.ts`. reviewed. อ่าน 7-23, 30-55, 63-79, 206-222, 261-280, 318-334, 336-353, 404-420, 444-460. เสนอให้ลบ 0 ช่วง. เก็บ composite stored role, non-enumerating denial, in-transaction role validation, hidden owner targets, last Project admin locks, composite no-op rewrite semantics และ leave permission contract
- [x] `apps/api/src/organization-notifications/revoke.db.test.ts`. reviewed. อ่าน 6-29, 94-111, 149-184, 253-269. เสนอให้ลบ 0 ช่วง. เก็บ opaque IDs/peer fixtures, A/B session mirrors, holder-specific blocking, concurrent revocation schedule และการรักษา B membership/session
- [x] `apps/api/src/organization-notifications/role.db.test.ts`. reviewed. อ่าน 5-21, 47-82, 196-212. เสนอให้ลบ 0 ช่วง. เก็บ opaque IDs, holder-specific lock barriers, concurrent role changes และข้อเท็จจริง reassert owner ไม่ใช่ demotion
- [x] `apps/api/src/organization-notifications/routes.db.test.ts`. reviewed. อ่าน 340-356, 548-564, 623-653, 675-692, 864-891, 1046-1062, 1077-1093, 1232-1264, 1310-1327, 1343-1370, 1382-1398, 1476-1492, 1503-1520, 1535-1551, 1735-1751. เสนอให้ลบ 0 ช่วง. เก็บ audit actor-only logs, composite role projection, live-session revoke/leave behavior, anti-enumeration response equality, legacy settings compatibility และ native-path spelling variants
- [x] `apps/api/src/organization-notifications/routes.ts`. reviewed. อ่าน 37-69, 90-109. เสนอให้ลบ 0 ช่วง. เก็บ native-path normalization/ordering และข้อจำกัด opaque member IDs สำหรับ demo seed; uncertain ที่ catch comment บอก malformed encoding matches nothing แต่ยัง lower-case/normalize path ต่อ จึงไม่เสนอ deletion โดยคาดเดา
- [x] `apps/api/src/organization-notifications/service.db.test.ts`. reviewed. อ่าน 637-653. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลต้อง poll PostgreSQL lock state จริงแทน fake timers
- [ ] `apps/api/src/organization-notifications/service.test.ts`. missing. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบไฟล์ตาม manifest ซึ่งระบุ exists=false อยู่แล้ว ไม่ restore และไม่มีข้อเสนอให้ลบ
- [x] `apps/api/src/organization-notifications/service.ts`. reviewed. อ่าน 77-94, 135-152, 304-320. เสนอให้ลบ 0 ช่วง. เก็บ membership-before-tenant-context, lock-bound notification recipient snapshot และหนึ่ง audit event ที่เลือก action ตาม settings field
- [x] `apps/api/src/projects/access.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน access.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ Outcome, outcome, table; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/projects/access.ts`. reviewed. อ่าน 1-30, 46-78, 91-108. เสนอให้ลบ 0 ช่วง. เก็บ Project access precedence, read-versus-management denial, email/last-response privacy และ hidden-Project 404 policy
- [x] `apps/api/src/projects/contract.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน contract.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ jsonError, invalidResponse, mediaTypeResponse; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/projects/last-project.db.test.ts`. reviewed. อ่าน 17-34, 112-128, 154-171, 222-238, 343-359. เสนอให้ลบ 0 ช่วง. เก็บ exact Project membership fixture, selectedAt arrival order, READ COMMITTED snapshot race, cascade deletion และ account-specific fallback selection
- [x] `apps/api/src/projects/members.ts`. reviewed. อ่าน 25-116, 198-225, 236-255. เสนอให้ลบ 0 ช่วง. เก็บ parameter/sort contract ของ member query, least-privileged display role, personal-data search binding, add-only membership, FK race และ last-admin serialization
- [x] `apps/api/src/projects/organization-membership.db.test.ts`. reviewed. อ่าน 22-39, 255-272, 349-386. เสนอให้ลบ 0 ช่วง. เก็บ exact membership fixture, owner/admin ที่ไม่นับเป็น Project admin และ deterministic org-lock queue พร้อม separate-connection activity snapshot
- [x] `apps/api/src/projects/project-members.db.test.ts`. reviewed. อ่าน 49-66, 441-457, 497-517, 665-683, 715-731. เสนอให้ลบ 0 ช่วง. เก็บ exact membership/last-admin fixtures, race actors ที่ยังมีสิทธิ์หลัง request แรก, hidden/foreign ID cases และ candidates ที่เป็น management action แม้ใช้ read lock
- [x] `apps/api/src/projects/projects.db.test.ts`. reviewed. อ่าน 302-318, 665-696. เสนอให้ลบ 0 ช่วง. เก็บ demotion lock ที่จำลอง member mutation และ table/advisory lock barriers ของ quota race รวมถึง pg_stat_activity lag
- [x] `apps/api/src/projects/routes.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน routes.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ ProjectRouteDeps, registerProjectRoutes; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/projects/service.ts`. reviewed. อ่าน 42-70, 94-127, 141-163, 291-308, 345-361, 397-417, 461-494, 504-534, 543-560. เสนอให้ลบ 0 ช่วง. เก็บ tenant filters, membership/Project lock order, text redaction, idempotent PATCH และ selectedAt/read-back visibility/clock-skew contract ของ remembered Project
- [x] `apps/api/src/rate-limit/index.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน index.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/rate-limit/limiter.db.test.ts`. reviewed. อ่าน 8-24, 58-111, 118-134, 232-248, 256-272, 392-408. เสนอให้ลบ 0 ช่วง. เก็บ unavailable-Redis fixture, sliding-window arithmetic, independent budgets, longest wait, proxy direction และ refused-connection setup; uncertain ที่บรรทัด 103 บอกเหลือ 30 s แต่ assertion เป็น 29 หลัง clock += 1000 จึงไม่เสนอ deletion แทนแก้ข้อความ
- [x] `apps/api/src/rate-limit/limiter.test-d.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน limiter.test-d.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์ รวมบริเวณ Group, Assert, GroupRequiresWindow; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/rate-limit/limiter.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน limiter.test.ts ตรวจด้วย TypeScript parser และเดิน AST พร้อม syntax tokens ตลอดไฟล์; ไม่ถือ URL/ข้อความ fixture เป็น comment
- [x] `apps/api/src/rate-limit/limiter.ts`. reviewed. อ่าน 6-54, 56-73, 85-101, 143-159, 165-189. เสนอให้ลบ 0 ช่วง. เก็บ grouped-window type contract, atomic quota/fail-closed behavior, sanitized failure causes, Lua argument layout, outage log throttling, ioredis timeout classification และ 10/30 quotas ของ Test
- [x] `apps/api/src/rate-limit/redis.ts`. reviewed. อ่าน 1-30. เสนอให้ลบ 0 ช่วง. เก็บ command timeout/reconnect logging policy และเหตุผลต้องมี error listener ไม่ให้ ioredis พิมพ์ reconnect errors เอง
- [x] `apps/api/src/server-options.ts`. reviewed. อ่าน 1-10. เสนอให้ลบ 0 ช่วง. เก็บ Bun idle-timeout gotcha, monitor/limiter/DNS budget และ version-specific POST behavior ซึ่งค่าคงที่ 45 อย่างเดียวอธิบายไม่ได้
- [x] `apps/api/src/testing/db-integration.ts`. reviewed. อ่าน 1-9. เสนอให้ลบ 0 ช่วง. เก็บ fail-instead-of-skip rationale เพื่อไม่ให้ integration gate ผ่านโดยไม่ได้รันจริง
- [x] `apps/api/src/testing/self-signed-certificates.ts`. reviewed. อ่าน 9-28. เสนอให้ลบ 0 ช่วง. เก็บ self-signed valid/expired certificate fixture contract และการ trust ผ่าน outbound ca
- [x] `apps/api/tsconfig.json`. reviewed. อ่าน 1-8. เสนอให้ลบ 0 ช่วง. อ่าน tsconfig.json ครบ มี $schema/extends/compilerOptions/include ไม่มี comment
- [x] `apps/api/vitest.config.ts`. reviewed. อ่าน 1-46. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล coverage ต้องมี integration database และ bootstrap exclusion ที่อาศัย dev-server smoke ไม่ใช่ลบเพียงเพราะกล่าวถึง coverage

### Web foundation และ configuration

- [x] `apps/web/components.json`. reviewed. อ่าน 1-20. เสนอให้ลบ 0 ช่วง. JSON ตั้งค่า shadcn และ alias ไม่มีคอมเมนต์ ตรวจข้อความทั้งไฟล์
- [x] `apps/web/eslint.config.js`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน eslint.config.js
- [x] `apps/web/index.html`. reviewed. อ่าน 1-36. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลป้องกัน theme flash และ fallback เมื่อ storage ใช้ไม่ได้ รวมถึงความสัมพันธ์ theme-color กับ Canvas
- [x] `apps/web/package.json`. reviewed. อ่าน 1-63. เสนอให้ลบ 0 ช่วง. JSON scripts และ dependencies ไม่มีคอมเมนต์ ตรวจข้อความทั้งไฟล์
- [x] `apps/web/scripts/codegen-openapi.mjs`. reviewed. อ่าน 1-69. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย output และคำสั่งที่ package.json ระบุแล้ว เก็บ global directive และเหตุผล emit spec โดยไม่พึ่งบริการภายนอก ไม่แตะ HEADER template ที่เป็นผลลัพธ์ generated
- [x] `apps/web/src/components/ErrorBoundary.test.tsx`. reviewed. อ่าน 1-84. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล mock console.error เพราะ React ส่ง error ที่ boundary จับแล้วออก console
- [x] `apps/web/src/components/ErrorBoundary.tsx`. reviewed. อ่าน 1-66. เสนอให้ลบ 0 ช่วง. เก็บสัญญา landmark=false เพื่อไม่ซ้อน main ซึ่ง boolean type ไม่อธิบาย
- [x] `apps/web/src/components/PostAuthRedirect.tsx`. reviewed. อ่าน 1-21. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลอ่าน continuation ตอน render แต่ล้างหลัง commit เพื่อไม่ให้ StrictMode render ที่ทิ้งไป consume ข้อมูล
- [x] `apps/web/src/components/shell/AccountMenu.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน AccountMenu, Avatar, THEME_OPTIONS, ThemeSegmentedControl
- [x] `apps/web/src/components/shell/AppShell.test.tsx`. reviewed. อ่าน 41-66, 108-170, 316-341, 393-451, 478-520, 769-812. เสนอให้ลบ 3 ช่วง. ลบคำบรรยาย assertion และสถานการณ์ที่ชื่อเทสต์ระบุแล้ว เก็บเหตุผล re-query หลัง admission, fixture และข้อจำกัด route ข้ามองค์กร
- [x] `apps/web/src/components/shell/AppShell.tsx`. reviewed. อ่าน 1-305. เสนอให้ลบ 0 ช่วง. เก็บข้อจำกัด containing block, route matching, breakpoint lifetime และลำดับ Escape ของเมนูซ้อน drawer ซึ่งมีผลต่อ focus
- [x] `apps/web/src/components/shell/AuthFrame.tsx`. reviewed. อ่าน 1-71. เสนอให้ลบ 0 ช่วง. เก็บข้อจำกัด AuthEyebrow เป็น Latin route code ไม่เป็นชื่อ heading
- [x] `apps/web/src/components/shell/AuthLayout.tsx`. reviewed. อ่าน 1-7. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลไม่ใช้ generic session guard เพราะขัดกับ challenge ของ two-factor
- [x] `apps/web/src/components/shell/BrandMark.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน BrandMark
- [x] `apps/web/src/components/shell/CommandPalette.tsx`. reviewed. อ่าน 1-221. เสนอให้ลบ 0 ช่วง. เก็บสัญญา mount เฉพาะเมื่อเปิดเพื่อ reset state และเหตุผลดัก Tab ใน modal ที่ input เป็น tab stop เดียว
- [x] `apps/web/src/components/shell/EmptyState.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน EmptyState
- [x] `apps/web/src/components/shell/Header.tsx`. reviewed. อ่าน 1-175. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล tenant ของ breadcrumb, ข้อจำกัด display utility และ contrast ของ control border
- [x] `apps/web/src/components/shell/Kbd.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน Kbd
- [x] `apps/web/src/components/shell/NotificationsPopover.tsx`. reviewed. อ่าน 1-295. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลใช้สีข้อความกับ counter เพราะเป็นจำนวน ไม่ใช่สถานะ
- [x] `apps/web/src/components/shell/OrgSwitcher.tsx`. reviewed. อ่าน 1-194. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล fallback ไม่แย่งแสดง error จากหน้า, เจ้าของ redirect, สิทธิ์ audit log และความหมาย system-object ของ mark
- [x] `apps/web/src/components/shell/Page.tsx`. reviewed. อ่าน 1-157. เสนอให้ลบ 2 ช่วง. ลบคำบรรยายสีและรูปแบบซ้ำกับ ScopeMark และ route-code ซ้ำกับ eyebrow prop เก็บสัญญา font, mark, accessible description และเหตุผลจำกัดความกว้างฟอร์ม
- [x] `apps/web/src/components/shell/PageState.tsx`. reviewed. อ่าน 1-146. เสนอให้ลบ 0 ช่วง. เก็บสัญญาการประกาศ loading ให้ assistive technology และเหตุผลไม่สร้าง main region ซ้อน app frame
- [x] `apps/web/src/components/shell/ProjectSwitcher.test.tsx`. reviewed. อ่าน 123-230, 441-503, 637-659, 661-696, 698-723, 768-795, 797-817, 819-860, 1005-1030, 1098-1130, 1254-1272. เสนอให้ลบ 3 ช่วง. ลบคำบรรยาย await listGate, เปิดปิดเมนู และค่า cache ที่ assertion ระบุแล้ว เก็บ fixture, race timing, identity retirement และ isolation ขององค์กร
- [x] `apps/web/src/components/shell/ProjectSwitcher.tsx`. reviewed. อ่าน 1-352. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลวางนอก scroll nav, การคืน focus หลัง admission remount, สิทธิ์แสดง project ที่ไม่ joined และความหมาย mark
- [x] `apps/web/src/components/shell/Sidebar.tsx`. reviewed. อ่าน 1-189. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลไม่เดาจำนวน, route scope ข้ามองค์กร, เลือก current row เดียว, ข้อยกเว้น heading ของ project, ตำแหน่งแถบ และ accessible name
- [x] `apps/web/src/components/shell/Skeleton.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน Skeleton
- [x] `apps/web/src/components/shell/breadcrumb.ts`. reviewed. อ่าน 1-17. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล derive จาก nav เดียวกันและไม่นำ section labels หรือ raw id มาเป็น breadcrumb
- [x] `apps/web/src/components/shell/icons.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน iconProps, GridIcon, ShieldIcon, SlidersIcon, ChevronsUpDownIcon, CheckIcon, ChevronRightIcon, ChevronLeftIcon, PanelLeftIcon, MenuIcon, XIcon, SearchIcon, BellIcon, UserIcon, MonitorIcon, ActivityIcon, LogOutIcon, SmartphoneIcon, KeyIcon, CopyIcon, DownloadIcon, RefreshIcon, ArrowLeftIcon, ArrowRightIcon, EyeIcon, EyeOffIcon, UsersIcon, LaptopIcon, InboxIcon, LockIcon, HistoryIcon, NAV_ICONS, NavIconName
- [x] `apps/web/src/components/shell/initials.ts`. reviewed. อ่าน 1-21. เสนอให้ลบ 0 ช่วง. เก็บข้อเท็จจริงเกี่ยวกับ code point ของภาษาไทยและ JetBrains Mono ไม่มี Thai glyphs
- [x] `apps/web/src/components/shell/nav-config.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน ORG, P1, P2
- [x] `apps/web/src/components/shell/nav-config.ts`. reviewed. อ่าน 1-281. เสนอให้ลบ 0 ช่วง. เก็บสัญญา placeholder, role, palette, count, scope, fallback เมื่อ switch project, lowercase API ID และองค์กรของ URL ที่ต่างจาก active
- [x] `apps/web/src/components/shell/useCurrentProject.ts`. reviewed. อ่าน 1-124. เสนอให้ลบ 0 ช่วง. เก็บสัญญา scope และ fallback รวมถึงเหตุผลไม่แสดง cached project ที่ถูก revoke และไม่ fetch ข้อมูลเมื่อไม่มี membership
- [x] `apps/web/src/components/shell/useMediaQuery.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน useMediaQuery
- [x] `apps/web/src/components/shell/useNavCounts.ts`. reviewed. อ่าน 1-47. เสนอให้ลบ 0 ช่วง. ลบคำบรรยาย useUnreadCount ที่ชื่อและ query ระบุอยู่แล้ว เก็บเหตุผลแชร์ first-page cache กับ list loader และสัญญา unknown หรือ failed
- [x] `apps/web/src/components/shell/usePopover.ts`. reviewed. อ่าน 1-82. เสนอให้ลบ 0 ช่วง. เก็บสัญญาคืน focus ให้ trigger ทุกช่องทาง dismiss ซึ่งเป็นข้อกำหนด accessibility สำหรับ caller
- [x] `apps/web/src/components/shell/useRememberLastProject.ts`. reviewed. อ่าน 1-156. เสนอให้ลบ 0 ช่วง. เก็บสัญญา queue, monotonic landing timestamp, retry, retirement และขอบเขตยกเลิก request ที่ส่งแล้ว
- [x] `apps/web/src/components/ui.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน ui.test.tsx
- [x] `apps/web/src/components/ui.tsx`. reviewed. อ่าน 1-159. เสนอให้ลบ 0 ช่วง. เก็บสัญญา styling สำหรับ non-Input, aria-describedby, accessible label และการใช้ status ไม่ interrupt ผู้อ่าน
- [x] `apps/web/src/components/ui/action-notice.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน action-notice.test.tsx
- [x] `apps/web/src/components/ui/action-notice.tsx`. reviewed. อ่าน 1-76. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลแยก message live region, หน่วงข้อความหนึ่ง commit และ pending ไม่ใช้ success tone รวมถึงสัญญา focusable/live
- [x] `apps/web/src/components/ui/button.tsx`. reviewed. อ่าน 1-78. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล focus outline, บริบทเลือก destructive และ sm, disabled tone และการตัดบรรทัดภาษาไทย
- [x] `apps/web/src/components/ui/card.tsx`. reviewed. อ่าน 1-118. เสนอให้ลบ 0 ช่วง. เก็บข้อจำกัดไม่มี shadow สำหรับ card และบริบทใช้ CardSection ภายในกรอบเดียวกัน
- [x] `apps/web/src/components/ui/confirm-dialog.test.tsx`. reviewed. อ่าน 1-156. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย DOM order ที่ fixture และลำดับ Tab assertion บอกแล้ว เก็บเหตุผล fixture ครอบคลุม focusable types, cleanup และ focus เมื่อปุ่ม disabled
- [x] `apps/web/src/components/ui/confirm-dialog.tsx`. reviewed. อ่าน 1-178. เสนอให้ลบ 0 ช่วง. เก็บสัญญา caller/dialog ownership, cancel wording, consequence text และเหตุผลรักษา focus ระหว่าง pending กับ theme tokens
- [x] `apps/web/src/components/ui/data-table.tsx`. reviewed. อ่าน 1-197. เสนอให้ลบ 0 ช่วง. เก็บสัญญา width, การเลือก mono, rowActions และ caller เป็นเจ้าของ sorting/filtering/selection ใน mixed block
- [x] `apps/web/src/components/ui/hairline-grid.tsx`. reviewed. อ่าน 1-27. เสนอให้ลบ 0 ช่วง. เก็บสัญญา caller กำหนด columns และ direct child ทุกตัวเป็น cell
- [x] `apps/web/src/components/ui/icon-tile.tsx`. reviewed. อ่าน 1-27. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล icon เป็น decorative และข้อความของ row เป็นผู้สื่อความหมาย
- [x] `apps/web/src/components/ui/input.tsx`. reviewed. อ่าน 1-24. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลกำหนด typography เองเพื่อไม่รับ styling ของ Label ที่ครอบ
- [x] `apps/web/src/components/ui/label.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน Label
- [x] `apps/web/src/components/ui/mockup-frame.tsx`. reviewed. อ่าน 1-83. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย MockupNotice ที่ตรงกับ JSX เก็บ default issue URL และข้อห้าม status/live/freshness ของ sample children
- [x] `apps/web/src/components/ui/notice.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน Notice
- [x] `apps/web/src/components/ui/response-time-chart.test.tsx`. reviewed. อ่าน 14-65, 294-316, 340-388, 397-453, 463-493, 510-523, 525-547, 553-566, 613-631, 645-655, 863-898, 900-917, 998-1026. เสนอให้ลบ 2 ช่วง. ลบ inventory ของ fixture และคำบรรยาย assertion ที่ไม่มี creation time เก็บเหตุผล boundary/race/structural sharing และความหมาย path segments; uncertain บรรทัด 889 กล่าวช่วง 10:00 ถึง now ว่า fresh แต่ fixture มีจุด 11:55 ด้วย จึงไม่เสนอ deletion จากความคลาดเคลื่อนนี้
- [x] `apps/web/src/components/ui/response-time-chart.tsx`. reviewed. อ่าน 1-583. เสนอให้ลบ 0 ช่วง. เก็บข้อจำกัด React 19, theme และ non-colour cues รวมถึง structural sharing, live region ไม่ประกาศตอน refetch/pointer และ tick ของ monitor อายุสั้น
- [x] `apps/web/src/components/ui/response-time-series.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน common, short, point
- [x] `apps/web/src/components/ui/response-time-series.ts`. reviewed. อ่าน 1-537. เสนอให้ลบ 4 ช่วง. ลบคำบรรยาย mapping, window, owner loop และ edge tolerance ที่ซ้ำกับ types/โค้ดหรือสัญญาด้านบน เก็บ non-obvious domain, pause slack, weighted average และ hourly limitation
- [x] `apps/web/src/components/ui/response-time-table.tsx`. reviewed. อ่าน 1-137. เสนอให้ลบ 0 ช่วง. เก็บสัญญาให้ตารางเป็นข้อมูลชุดเดียวกับเส้นกราฟและใช้ semantic table จริงสำหรับการเข้าถึง
- [x] `apps/web/src/components/ui/section-header.tsx`. reviewed. อ่าน 1-77. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล aria-hidden ของ section code, หน้าที่ caller เลือก font และสัญญา aria-labelledby/programmatic focus
- [x] `apps/web/src/components/ui/segmented-control.tsx`. reviewed. อ่าน 1-90. เสนอให้ลบ 0 ช่วง. เก็บสัญญา radio navigation และ disabled ที่ยังรักษา focus ต่างจาก native disabled
- [x] `apps/web/src/components/ui/status-pill.tsx`. reviewed. อ่าน 1-73. เสนอให้ลบ 0 ช่วง. เก็บข้อจำกัด tone ไม่ลง fill และสัญญา neutralLabel implies dot โดยชื่อ boolean ไม่บอกเอง
- [x] `apps/web/src/components/ui/useDialogFocusReturn.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน roots, fixture
- [x] `apps/web/src/components/ui/useDialogFocusReturn.ts`. reviewed. อ่าน 1-50. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล snapshot fallback ตั้งแต่ mount เพราะ React อาจล้างหรือแทน ref ก่อน cleanup
- [x] `apps/web/src/index.css`. reviewed. อ่าน 1-372. เสนอให้ลบ 1 ช่วง. ลบรายการ derived token inventory ใน mixed header เก็บเหตุผล font unicode-range, theme precedence, token mapping, contrast roles, reduced motion และข้อจำกัด canvas-only/ไม่ซ้อน texture
- [x] `apps/web/src/lib/api/audit-log.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน parse
- [x] `apps/web/src/lib/api/audit-log.ts`. reviewed. อ่าน 1-331. เสนอให้ลบ 0 ช่วง. เก็บสัญญา row offset/page/date, tenant cancellation, schema narrowing, URL semantics, loader/page minute anchoring และ retainedDay ตาม preference zone รวมถึง eslint directive
- [x] `apps/web/src/lib/api/client.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน jsonResponse, stubFetch, issuedRequest, meContextFixture
- [x] `apps/web/src/lib/api/client.ts`. reviewed. อ่าน 1-295. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย FilePaths ที่ conditional type ระบุเอง เก็บ generated-type gotcha, abort/204 contract, fetch mocking, raw text parsing และ UTF-8 BOM ของ Excel
- [x] `apps/web/src/lib/api/invitations.ts`. reviewed. อ่าน 1-103. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล tenant prefix ต้องถูก cancel/remove เมื่อสลับองค์กร
- [x] `apps/web/src/lib/api/me.ts`. reviewed. อ่าน 1-29. เสนอให้ลบ 0 ช่วง. เก็บข้อจำกัด bootstrap ต้องยืนยัน active org ไม่ reuse read-only context เป็น admission
- [x] `apps/web/src/lib/api/members.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน organizationId, response
- [x] `apps/web/src/lib/api/members.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน MEMBER_LIST_QUERY_PREFIX, memberListQueryKey, fetchOrganizationMembers, updateOrganizationMemberRole, organizationMemberRevokeResponseSchema, revokeOrganizationMember, leaveOrganization
- [x] `apps/web/src/lib/api/monitors.ts`. reviewed. อ่าน 1-382. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล schema input ให้ server ใช้ defaults, cache key ของ default sort, tenant isolation/infinite-query shape และสัญญาสิทธิ์หรือ secret ของ test endpoint
- [x] `apps/web/src/lib/api/notifications.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน ORG_A, ORG_B, stubFetch
- [x] `apps/web/src/lib/api/notifications.ts`. reviewed. อ่าน 1-143. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล scope อาจเปลี่ยนจาก session อื่นและต้องปฏิเสธก่อน cache แล้ว refresh context
- [x] `apps/web/src/lib/api/openapi-types.gen.ts`. protected. อ่าน 1-10. เสนอให้ลบ 0 ช่วง. header บรรทัด 1-6 ระบุ GENERATED FILE และ DO NOT EDIT; apps/web/scripts/codegen-openapi.mjs:26-33,48-65 เป็นเจ้าของ output และตรวจเทียบทั้งไฟล์แบบ byte-identical จึงไม่เสนอแก้ generated comments ด้วยมือ
- [x] `apps/web/src/lib/api/projects.ts`. reviewed. อ่าน 1-201. เสนอให้ลบ 0 ช่วง. เก็บสัญญา schema input, last-project และขอบเขต invalidation; uncertain บรรทัด 37 กล่าว filters/search ไม่อยู่ใน keys แต่ candidates มี q ใน key ที่ 56-57 อาจหมายเฉพาะ list จึงไม่เสนอ deletion ด้วยการเดา
- [x] `apps/web/src/lib/auth-client.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน FALLBACK
- [x] `apps/web/src/lib/auth-client.ts`. reviewed. อ่าน 1-91. เสนอให้ลบ 1 ช่วง. ลบคำบรรยายลำดับ fallback ที่ expression ระบุแล้ว เก็บ variance gotcha, proxy context, two-factor navigation, account-enumeration และเหตุผลไม่ส่ง server English ให้ผู้ใช้
- [x] `apps/web/src/lib/auth/SessionQueryProvider.test.tsx`. reviewed. อ่าน 1-206. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล commit observer จับ cache leak ชั่วคราว, fixture แทน TenantProvider และลำดับ staged loader/hydration/logout races
- [x] `apps/web/src/lib/auth/SessionQueryProvider.tsx`. reviewed. อ่าน 1-107. เสนอให้ลบ 0 ช่วง. เก็บความต่าง unresolved/anonymous, hydration epoch, render-phase swap, registry หลัง commit และลำดับ publish ก่อน revalidation เพื่อป้องกัน data leak/race
- [x] `apps/web/src/lib/auth/continuation.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน RETURN_TO_KEY
- [x] `apps/web/src/lib/auth/continuation.ts`. reviewed. อ่าน 1-76. เสนอให้ลบ 0 ช่วง. เก็บสัญญา session-scoped continuation, การป้องกัน origin escape และอ่านแบบไม่ consume จน commit
- [x] `apps/web/src/lib/auth/identityLifecycle.test.tsx`. reviewed. อ่าน 1-571. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย wiring ที่ imports และ lifecycleRoutes บอกอยู่แล้ว เก็บเหตุผล reactive/hoisting/commit observer, anonymous epoch และ loader/session races
- [x] `apps/web/src/lib/auth/loaders-settings.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน { getSessionMock, listSessionsMock }, session
- [x] `apps/web/src/lib/auth/loaders.test.tsx`. reviewed. อ่าน 287-302, 336-342, 372-385, 907-935. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล continuation consume ครั้งเดียว, ป้องกัน login loop, identity-staged cache และ minute-aligned key ของ loader/page
- [x] `apps/web/src/lib/auth/loaders.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน loaders.ts
- [x] `apps/web/src/lib/auth/loaders/auditLog.ts`. reviewed. อ่าน 1-118. เสนอให้ลบ 0 ช่วง. เก็บข้อจำกัด membership/role ก่อน prefetch, retainedDay ที่ cache/page ใช้ร่วมกัน และ uniform not-found สำหรับ foreign event
- [x] `apps/web/src/lib/auth/loaders/entry.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน rootLoader, requireAnonLoader, verifyEmailLoader
- [x] `apps/web/src/lib/auth/loaders/monitors.ts`. reviewed. อ่าน 1-130. เสนอให้ลบ 0 ช่วง. เก็บ membership/privacy gate, หน้าที่หน้าแสดง denied/not-found, fresh edit version และเหตุผลไม่ retry missing monitor
- [x] `apps/web/src/lib/auth/loaders/notifications.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน notificationsLoader, notificationSettingsLoader
- [x] `apps/web/src/lib/auth/loaders/organizationMembers.ts`. reviewed. อ่าน 1-205. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลอ่าน AbortSignal ใหม่หลัง await ไม่เก็บผล snapshot ข้าม asynchronous boundary
- [x] `apps/web/src/lib/auth/loaders/projects.ts`. reviewed. อ่าน 1-120. เสนอให้ลบ 0 ช่วง. เก็บ membership gate และเหตุผลให้หน้าเป็นเจ้าของ uniform not-found สำหรับ project ที่เข้าไม่ได้
- [x] `apps/web/src/lib/auth/loaders/session.ts`. reviewed. อ่าน 1-49. เสนอให้ลบ 0 ช่วง. เก็บสัญญา server session แทน cached atom และ document reload เมื่อ cache เป็นของคนอื่น
- [x] `apps/web/src/lib/auth/loaders/settings.ts`. reviewed. อ่าน 1-35. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล sessionsLoader ไม่ redirect เองเพราะ settingsLoader รันคู่ขนานและเป็นเจ้าของ redirect
- [x] `apps/web/src/lib/auth/loaders/workspace.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน workspaceLoader
- [x] `apps/web/src/lib/env.ts`. reviewed. อ่าน 1-10. เสนอให้ลบ 0 ช่วง. เก็บความหมาย empty VITE_API_BASE_URL และการใช้ dev proxy ซึ่ง zod type ไม่บอก
- [x] `apps/web/src/lib/lastProjectSave.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน ORG
- [x] `apps/web/src/lib/lastProjectSave.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน LandingSaves, saves, getLastProjectLandingRevision, trackLastProjectSave, waitForLastProjectSaves
- [x] `apps/web/src/lib/preferences.test.ts`. reviewed. อ่าน 1-232. เสนอให้ลบ 0 ช่วง. เก็บข้อเท็จจริง timezone/Buddhist year, fixture DST ที่ข้ามหรือซ้ำเที่ยงคืน และเหตุผล oracle ใช้ Intl ไม่เรียก helper ของเรา
- [x] `apps/web/src/lib/preferences.ts`. reviewed. อ่าน 1-245. เสนอให้ลบ 0 ช่วง. เก็บสัญญา per-device storage, fallback, stable external-store snapshot, audit format ที่ไม่ตาม display preferences และเหตุผลค้นหา local-day boundary แทน offset เมื่อ DST เปลี่ยนเที่ยงคืน
- [x] `apps/web/src/lib/queryClient.ts`. reviewed. อ่าน 1-310. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล per-identity client, staged adoption, ไม่ retry scope change, ห้าม stage ก่อน gate และ pure peek ใน render ที่อาจถูกทิ้ง
- [x] `apps/web/src/lib/roles.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน ROLE_LABELS, ADMIN_INVITABLE_ROLES, INVITABLE_ROLES, InvitableRole
- [x] `apps/web/src/lib/sessions/device-label.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน CASES
- [x] `apps/web/src/lib/sessions/device-label.ts`. reviewed. อ่าน 1-58. เสนอให้ลบ 0 ช่วง. เก็บข้อเท็จจริง UA token ซ้อนกันที่บังคับลำดับ browser matching และขอบเขตตั้งใจรองรับเฉพาะระบบทั่วไป
- [x] `apps/web/src/lib/sessions/sessions.ts`. reviewed. อ่าน 1-22. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล query key เป็น personal ไม่ผูก tenant
- [x] `apps/web/src/lib/tenant/TenantProvider.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน { getSessionMock }, fetchMeContextMock, updateActiveOrganizationMock, me, Probe, queryClients, createQueryClient, renderProvider
- [x] `apps/web/src/lib/tenant/TenantProvider.tsx`. reviewed. อ่าน 295-355. เสนอให้ลบ 0 ช่วง. เก็บข้อแตกต่าง self-leave ต้อง retire origin ทันที แต่ ordinary confirmation ยังรักษา private observers
- [x] `apps/web/src/lib/tenant/activeOrganization.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน context
- [x] `apps/web/src/lib/tenant/activeOrganization.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน selectActiveOrganization
- [x] `apps/web/src/lib/tenant/admission.test.tsx`. reviewed. อ่าน 101-131. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล fixture ไม่มี project เพื่อไม่ให้ last-project save ของ AppShell รบกวน admission tests
- [x] `apps/web/src/lib/tenant/bootstrap.ts`. reviewed. อ่าน 1-165. เสนอให้ลบ 0 ช่วง. เก็บข้อจำกัด mounted history observer เป็นเจ้าของ chunks และต้อง resolve context ใหม่ทุก navigation ไม่ใช้ static cache เป็น admission
- [x] `apps/web/src/lib/tenant/selfLeave.ts`. reviewed. อ่าน 1-22. เสนอให้ลบ 0 ช่วง. เก็บสัญญา message เป็น server text ของ last-project-admin ซึ่งมีชื่อ project ไม่ใช่ข้อความทั่วไป
- [x] `apps/web/src/lib/tenant/useLeaveOnOrganizationSwitch.ts`. reviewed. อ่าน 1-65. เสนอให้ลบ 0 ช่วง. เก็บกติกา deep-link anchor, retire แบบไม่คืนชีพ, drop data ตั้งแต่ render เพื่อไม่แสดง record เก่า และไม่ supersede pending loader เดิม
- [x] `apps/web/src/lib/theme.ts`. reviewed. อ่าน 1-69. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล shared store, pre-paint theme, fallback storage ที่ไม่ persist และ Canvas token สำหรับ browser chrome
- [x] `apps/web/src/lib/utils.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน cn
- [x] `apps/web/src/main.tsx`. reviewed. อ่าน 1-20. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล router อยู่ module scope เพื่อไม่เสีย navigation state เมื่อ auth remount
- [x] `apps/web/src/router.test.tsx`. reviewed. อ่าน 1-81. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลทดสอบ shouldRevalidate จาก route จริง และรอ loader commit ก่อนวัดการข้าม revalidation
- [x] `apps/web/src/router.tsx`. reviewed. อ่าน 1-267. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล identity boundary, standalone 404, revalidation exception, challenge/onboarding gate และ TenantProvider ownership; uncertain บรรทัด 152 บอก No loader gate แต่ 155 มี verifyEmailLoader อาจหมายไม่มี generic auth gate จึงไม่เสนอ deletion จากถ้อยคำคลุมเครือ
- [x] `apps/web/src/test/guard-network.ts`. reviewed. อ่าน 1-45. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล cleanup ก่อน cancel/clear ไม่ให้ observers ที่ยัง mounted เริ่ม request ใหม่
- [x] `apps/web/src/test/pendingInvitations.ts`. reviewed. อ่าน 1-14. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย stub ที่ชื่อ emptyPendingInvitationList และ literal response บอกชัดอยู่แล้ว
- [x] `apps/web/src/test/setup.ts`. reviewed. อ่าน 1-14. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล mock better-auth plugin factories เพราะ real plugin ต้องใช้ live client
- [x] `apps/web/src/vite-env.d.ts`. reviewed. อ่าน 1-9. เสนอให้ลบ 0 ช่วง. เก็บ triple-slash reference types=vite/client เป็น TypeScript directive ไม่ใช่ prose
- [x] `apps/web/tsconfig.json`. reviewed. อ่าน 1-11. เสนอให้ลบ 0 ช่วง. JSON compilerOptions และ include ไม่มีคอมเมนต์ ตรวจข้อความทั้งไฟล์
- [x] `apps/web/vite.config.ts`. reviewed. อ่าน 1-33. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล per-worktree ports และไม่ prebundle workspace TypeScript; uncertain บรรทัด 12 บอกไม่มี manual useMemo/useCallback แต่ ResponseTimeChart และ usePopover ใช้อยู่ ไม่เสนอ deletion เพียงเพราะถ้อยคำคลาดเคลื่อน
- [x] `apps/web/vitest.config.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ตรวจ AST ด้วย TypeScript ทั้งไฟล์แล้วไม่พบ comment ranges ใน gate

### Web pages

- [x] `apps/web/src/pages/AcceptInvitationPage.test.tsx`. reviewed. อ่าน 29-88, 122-156, 190-224, 231-265. เสนอให้ลบ 1 ช่วง. ลบบรรทัดบรรยายผล signup ที่ assertions ระบุแล้ว คง mock hoisting และลำดับ session ที่เปลี่ยนระหว่างคำขอ
- [x] `apps/web/src/pages/AcceptInvitationPage.tsx`. reviewed. อ่าน 360-397. เสนอให้ลบ 0 ช่วง. คงเหตุผล callbackURL สำหรับลิงก์ข้ามแท็บและ header ของ invitation gate
- [x] `apps/web/src/pages/ForgotPasswordPage.test.tsx`. reviewed. อ่าน 40-74. เสนอให้ลบ 0 ช่วง. คงเหตุผลป้องกัน account enumeration แม้ชื่อเคสระบุ generic confirmation
- [x] `apps/web/src/pages/ForgotPasswordPage.tsx`. reviewed. อ่าน 18-52. เสนอให้ลบ 0 ช่วง. uncertain: คำว่า Always show the same confirmation อยู่หน้า requestError ที่แสดง error จึงไม่เสนอให้ลบเหตุผลป้องกัน enumeration จากการคาดเดา
- [x] `apps/web/src/pages/LoginPage.test.tsx`. reviewed. อ่าน 15-97, 222-256, 295-365. เสนอให้ลบ 1 ช่วง. ลบคำบรรยายตารางเคส resend ที่ชื่อ it และ assertions ระบุแล้ว คง session remount, hoisting และ plugin redirect
- [x] `apps/web/src/pages/LoginPage.tsx`. reviewed. อ่าน 7-41, 54-88, 148-182, 189-223, 241-276. เสนอให้ลบ 0 ช่วง. คงข้อจำกัด same-origin, label ของปุ่มแสดงรหัสผ่าน และชั้นพื้นหลัง radar; // sign in เป็น JSX text ไม่ใช่คอมเมนต์
- [x] `apps/web/src/pages/NotificationsPage.test.tsx`. reviewed. อ่าน 1050-1084, 1103-1183. เสนอให้ลบ 0 ช่วง. คงคำแปลงเวลาใน fixtures และวัน DST 25 ชั่วโมงเพื่ออธิบายขอบเขต local midnight
- [x] `apps/web/src/pages/NotificationsPage.tsx`. reviewed. อ่าน 78-112, 124-200, 233-267, 384-421, 483-517, 553-587. เสนอให้ลบ 2 ช่วง. ลบคำบรรยาย itemContext และ wrapper itemTime ที่โค้ดแสดงตรง ๆ คง calendar DST, cursor chain และ callback/grouping contracts
- [x] `apps/web/src/pages/OnboardingPage.test.tsx`. reviewed. อ่าน 82-116, 136-170. เสนอให้ลบ 0 ช่วง. คงข้อจำกัด disabled query และเหตุผลรอ router ลบ token หลัง failure render
- [x] `apps/web/src/pages/OnboardingPage.tsx`. reviewed. อ่าน 6-68, 78-112. เสนอให้ลบ 0 ช่วง. คง explicit acceptance, precedence ลิงก์กับ storage และเหตุผลไม่ unmount verification ที่ยังทำงาน
- [x] `apps/web/src/pages/OrganizationMembersPage.tenant.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน OrganizationMembersPage.tenant.test.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/OrganizationMembersPage.test.tsx`. reviewed. อ่าน 205-247, 292-315, 1217-1240. เสนอให้ลบ 2 ช่วง. ลบ coverage inventory ของ InvitationPanel และคำบรรยายจำนวนคำขอซ้ำ assertions คงเหตุผล status region และการรอ list reload
- [x] `apps/web/src/pages/OrganizationMembersPage.tsx`. reviewed. อ่าน 205-228, 331-353. เสนอให้ลบ 0 ช่วง. คงเหตุผล loading ระหว่าง refresh แทน restricted และสิทธิ์ leave ของ viewer/auditor
- [x] `apps/web/src/pages/OrganizationNotificationSettingsPage.test.tsx`. reviewed. อ่าน 13-35. เสนอให้ลบ 0 ช่วง. คงเหตุผล mock Project switcher เพื่อแยกการโหลด shell ออกจาก settings
- [x] `apps/web/src/pages/OrganizationNotificationSettingsPage.tsx`. reviewed. อ่าน 18-75. เสนอให้ลบ 0 ช่วง. คงการแยก draft ข้ามองค์กร ความหมาย null และเหตุผลใช้ scope จาก bookmarked URL
- [x] `apps/web/src/pages/ResetPasswordPage.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน ResetPasswordPage.test.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/ResetPasswordPage.tsx`. reviewed. อ่าน 8-75. เสนอให้ลบ 0 ช่วง. คงข้อจำกัด server consume token แบบ atomic และการปฏิเสธ replay
- [x] `apps/web/src/pages/TwoFactorPage.test.tsx`. reviewed. อ่าน 86-108. เสนอให้ลบ 0 ช่วง. คงข้อเท็จจริง pending challenge ยังไม่มี session ซึ่งเป็นขอบเขต authentication
- [x] `apps/web/src/pages/TwoFactorPage.tsx`. reviewed. อ่าน 18-92. เสนอให้ลบ 0 ช่วง. คงข้อจำกัดไม่แสดง workspace ก่อน verification และไม่เดา mode จากรูปรหัส
- [x] `apps/web/src/pages/VerifyEmailPage.test.tsx`. reviewed. อ่าน 73-95, 132-154. เสนอให้ลบ 1 ช่วง. ลบคำบรรยายผล sent และ invitation storage ที่ assertions ระบุแล้ว คงเหตุผล anonymous signup
- [x] `apps/web/src/pages/VerifyEmailPage.tsx`. reviewed. อ่าน 13-46. เสนอให้ลบ 0 ช่วง. คง enumeration-safe confirmation และการ refresh stale session หลัง verification
- [x] `apps/web/src/pages/WorkspaceEntryFallback.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน WorkspaceEntryFallback.test.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/WorkspaceEntryFallback.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน WorkspaceEntryFallback.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/audit-log/AuditDenied.tsx`. reviewed. อ่าน 1-19. เสนอให้ลบ 0 ช่วง. คงเหตุผล focus heading เพื่อประกาศการหายไปของ rows แม้บรรทัดมี Step 15 ปะปน
- [x] `apps/web/src/pages/audit-log/AuditEventPage.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน AuditEventPage.test.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/audit-log/AuditEventPage.tsx`. reviewed. อ่าน 364-399, 549-571. เสนอให้ลบ 0 ช่วง. คงสิทธิ์ link เป้าหมาย เหตุการณ์ก่อนมี Project และข้อจำกัดไม่เก็บ search text
- [x] `apps/web/src/pages/audit-log/AuditExport.test.tsx`. reviewed. อ่าน 265-287, 311-333, 546-589, 683-726, 804-826, 853-875. เสนอให้ลบ 2 ช่วง. ลบ narration ของ live region ว่างและ N-1 ที่ assertions ระบุครบ คงเหตุผลป้องกันประกาศซ้ำและ timezone fixtures
- [x] `apps/web/src/pages/audit-log/AuditFilterBar.tsx`. reviewed. อ่าน 49-72. เสนอให้ลบ 0 ช่วง. คงเหตุผล aria-disabled รักษา focus ผ่าน skeleton; Step 4 อยู่บรรทัดเดียวกับเหตุผล
- [x] `apps/web/src/pages/audit-log/AuditLogPage.test.tsx`. reviewed. อ่าน 215-237, 425-447, 454-476, 688-710, 795-818. เสนอให้ลบ 1 ช่วง. ลบ coverage-only note ที่ชี้ AuditExport คงความหมาย custom open range และ fixtures timezone/อดีตสมาชิก
- [x] `apps/web/src/pages/audit-log/AuditLogPage.tsx`. reviewed. อ่าน 57-129, 200-302, 342-372. เสนอให้ลบ 1 ช่วง. ลบ narration คืน focus จาก detail ที่ effect ระบุตรง ๆ คง snapshot pin, same-tick params และ pagination race
- [x] `apps/web/src/pages/audit-log/AuditTable.tsx`. reviewed. อ่าน 2-138. เสนอให้ลบ 0 ช่วง. ลบเหตุผลแยก table ที่กล่าวเพียง caption และ th scope คง router state และ snapshot contracts
- [x] `apps/web/src/pages/audit-log/ExportDialog.tsx`. reviewed. อ่าน 26-94. เสนอให้ลบ 1 ช่วง. ลบ narration pending guard ที่เงื่อนไข inFlight ระบุแล้ว คง loadedAt format และเหตุผลไม่ใช้ ConfirmDialog
- [x] `apps/web/src/pages/audit-log/MyExportsSection.tsx`. reviewed. อ่าน 13-36, 38-78. เสนอให้ลบ 0 ช่วง. คงข้อกำหนด live region เดียว aria-disabled และเหตุผล focus ปลายทาง hash เมื่อ section ปรากฏ
- [x] `apps/web/src/pages/audit-log/RecordingScopeNote.tsx`. reviewed. อ่าน 1-14. เสนอให้ลบ 0 ช่วง. คงเหตุผลใช้ contract text ให้ page/dialog/export files เปิดเผยขอบเขตตรงกัน
- [x] `apps/web/src/pages/audit-log/access.ts`. reviewed. อ่าน 14-51, 58-94. เสนอให้ลบ 0 ช่วง. คง retry policy และเหตุผล latch denial/ลบ cache หลังปิด observer เพื่อไม่ fetch กลับ
- [x] `apps/web/src/pages/audit-log/exports.ts`. reviewed. อ่าน 22-71, 87-117, 142-207. เสนอให้ลบ 0 ช่วง. คง absolute export scope, timeout/scope abort และการไม่แสดง search text; uncertain: failureText ระบุ Any other code แต่ชนิดรับเฉพาะ known code หรือ null
- [x] `apps/web/src/pages/audit-log/filters.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน filters.test.ts จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/audit-log/filters.ts`. reviewed. อ่าน 7-27. เสนอให้ลบ 0 ช่วง. คงความหมาย active filters ต่อข้อความ no match กับ no data ที่ชื่อฟังก์ชันอย่างเดียวไม่บอก
- [x] `apps/web/src/pages/audit-log/labels.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน labels.test.ts จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/audit-log/labels.ts`. reviewed. อ่าน 3-49, 81-103. เสนอให้ลบ 0 ช่วง. คง privacy ของอดีตสมาชิก domain Project role และการแสดง masked/secret value
- [x] `apps/web/src/pages/audit-log/test-support.tsx`. reviewed. อ่าน 25-47. เสนอให้ลบ 0 ช่วง. คงขอบเขต mock confirmed useTenant โดยไม่ทดสอบ shell provider
- [x] `apps/web/src/pages/audit-log/useAuditExport.ts`. reviewed. อ่าน 38-64, 69-92, 97-149, 154-193, 196-218. เสนอให้ลบ 0 ช่วง. คง scope abort, สิทธิ์แยก export/list, cache timing, nullable row message และ eslint directives
- [x] `apps/web/src/pages/monitors/ChecksHistoryPage.test.tsx`. reviewed. อ่าน 55-77, 96-165, 222-244, 444-466, 479-501, 510-546, 561-583, 586-624, 650-672, 691-713, 1363-1408. เสนอให้ลบ 2 ช่วง. ลบคำบรรยาย chunk helper และผล newer rows ซ้ำ assertions คง moving-offset fixtures, interval, cleanup และ macrotask GC
- [x] `apps/web/src/pages/monitors/ChecksHistoryPage.tsx`. reviewed. อ่าน 40-101, 110-136, 236-258, 267-293, 295-337, 400-422, 480-525. เสนอให้ลบ 1 ช่วง. ลบคำเทียบ outline กับ AuditLog ที่ไม่มีข้อจำกัด คง moving-offset accumulation, URL boundary และ focus/refresh policy
- [x] `apps/web/src/pages/monitors/DetailActions.test.tsx`. reviewed. อ่าน 109-131, 147-169, 257-279, 389-411. เสนอให้ลบ 0 ช่วง. คง computed-state contract, focus ที่ node เดิม และเหตุผลตรึง Overview refetch
- [x] `apps/web/src/pages/monitors/DetailEventFeed.test.tsx`. reviewed. อ่าน 51-73, 743-765, 813-835. เสนอให้ลบ 1 ช่วง. ลบ header บอก coverage pager ที่ cases และ describe ระบุแล้ว คง interval และ fixture rows ที่ถูกลบระหว่างอ่าน
- [x] `apps/web/src/pages/monitors/DetailPage.test.tsx`. reviewed. อ่าน 61-83, 149-171, 224-246, 249-271, 920-961, 1491-1513, 1655-1677, 1966-1988, 2022-2044, 3272-3294. เสนอให้ลบ 2 ช่วง. ลบ narration แถว gap และ aria assertions คง permission, polling, secretSlots และ chart-note ownership rationale
- [x] `apps/web/src/pages/monitors/DetailPage.tsx`. reviewed. อ่าน 60-82, 147-169, 194-216, 237-300, 369-391, 441-463, 490-512. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย badgeGlow ที่ predicate และ class ระบุแล้ว คง tenant isolation, refetch pending และสิทธิ์ last response
- [x] `apps/web/src/pages/monitors/HealthPill.tsx`. reviewed. อ่าน 15-37. เสนอให้ลบ 0 ช่วง. คงกติกา design ว่า up เท่านั้นได้ primary/check และทุกสถานะต้องมีข้อความ
- [x] `apps/web/src/pages/monitors/HttpStatus.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน HttpStatus.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/monitors/MonitorFormAdvanced.test.tsx`. reviewed. อ่าน 402-424, 446-468. เสนอให้ลบ 1 ช่วง. ลบ narration ย้าย row 3 เป็น row 2 ที่ assertions ระบุแล้ว คงเหตุผลลำดับ invalid field ในหน้า
- [x] `apps/web/src/pages/monitors/MonitorFormEdit.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน MonitorFormEdit.test.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/monitors/MonitorFormFocus.test.tsx`. reviewed. อ่าน 77-99, 202-224, 385-407. เสนอให้ลบ 0 ช่วง. คง shell switcher fixture, disclosure-only scan และ resolver ที่ค้างเพื่อจับ duplicate navigation
- [x] `apps/web/src/pages/monitors/MonitorFormPage.test.tsx`. reviewed. อ่าน 465-487. เสนอให้ลบ 0 ช่วง. คงข้อจำกัด first paint ต้องไม่มี monitor ก่อน edit ไม่ใช่เพียงผล refetch ภายหลัง
- [x] `apps/web/src/pages/monitors/MonitorFormPage.tsx`. reviewed. อ่าน 20-42, 51-111, 149-171. เสนอให้ลบ 0 ช่วง. คง tenant key, latest role ใน async reload, pinned form และ generation หลัง conflict
- [x] `apps/web/src/pages/monitors/MonitorFormRepair.test.tsx`. reviewed. อ่าน 186-208. เสนอให้ลบ 0 ช่วง. คงเหตุผลรอ switcher กลับมาก่อนตรวจ form ที่ยังไม่เสีย draft
- [x] `apps/web/src/pages/monitors/MonitorFormSecrets.test.tsx`. reviewed. อ่าน 82-104, 202-224, 418-440, 865-887, 899-955, 1092-1114, 1248-1308, 1407-1429, 1478-1500. เสนอให้ลบ 3 ช่วง. ลบ coverage inventory ของ secretOriginChanged, รายการ places ที่ object ระบุแล้ว และ narration navigate กลับ form คง secret hygiene, stable id, mutation-cache proof และ positive control
- [x] `apps/web/src/pages/monitors/MonitorFormTest.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน MonitorFormTest.test.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/monitors/MonitorTable.tsx`. reviewed. อ่าน 16-38, 94-116. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย dash/sr-only ที่ JSX แสดงตรง ๆ คงความหมาย failure warning ที่ไม่เปลี่ยน health
- [x] `apps/web/src/pages/monitors/OverviewPage.test.tsx`. reviewed. อ่าน 153-175, 633-655, 855-896, 1156-1178, 1231-1253, 1690-1712, 1747-1769, 1929-1952, 1965-1987, 2021-2043, 2138-2160. เสนอให้ลบ 2 ช่วง. ลบ narration ล้าง notice history และ interval ที่ assertion ระบุแล้ว คงเวลา, isolation, refresh timing; uncertain: คำว่า visible count follows data ที่ 1755 มี assertion ตรวจเพียง existence
- [x] `apps/web/src/pages/monitors/OverviewPage.tsx`. reviewed. อ่าน 37-96, 107-200, 263-322, 479-523, 588-610. เสนอให้ลบ 1 ช่วง. ลบคำบรรยายลำดับ FILTER_ORDER ที่ array ระบุชัด คง storage failure, query-key equality, tenant isolation และการประกาศเฉพาะ filter
- [x] `apps/web/src/pages/monitors/RecentEventsCard.tsx`. reviewed. อ่าน 119-141. เสนอให้ลบ 0 ช่วง. คงข้อจำกัดความล้มเหลว recent events ต้องไม่ปิดกั้น monitor table
- [x] `apps/web/src/pages/monitors/SslLabel.tsx`. reviewed. อ่าน 16-38, 55-77. เสนอให้ลบ 1 ช่วง. ลบตัวอย่างข้อความวันจาก sslDaysText ที่ branches แสดงแล้ว คงข้อกำหนดสีและข้อความสถานะ
- [x] `apps/web/src/pages/monitors/detail-test-support.tsx`. reviewed. อ่าน 40-62, 80-102, 198-280. เสนอให้ลบ 1 ช่วง. ลบ header fixture detail ที่ return defaults และ overrides ระบุครบ คงสิทธิ์ Project member กับความหมาย hourly/null sparkline
- [x] `apps/web/src/pages/monitors/detail/AlertsCard.tsx`. reviewed. อ่าน 82-104. เสนอให้ลบ 0 ช่วง. คงสิทธิ์ Organization settings ที่ Project admin ไม่มี
- [x] `apps/web/src/pages/monitors/detail/AssertionTable.tsx`. reviewed. อ่าน 13-35. เสนอให้ลบ 0 ช่วง. คงข้อกำหนด accessibility ทุก assertion ต้องมีข้อความไม่พึ่งไอคอน
- [x] `apps/web/src/pages/monitors/detail/ConfigCard.tsx`. reviewed. อ่าน 23-46. เสนอให้ลบ 0 ช่วง. คงข้อจำกัด secret value ไม่ถึง client และ query/body เปิดให้ reader ทุกคน
- [x] `apps/web/src/pages/monitors/detail/IncidentsCard.tsx`. reviewed. อ่าน 79-101, 104-126. เสนอให้ลบ 0 ช่วง. คง error isolation ของ card และเหตุผลมีทางกลับเมื่อ total ลดขณะอยู่หน้าหลัง
- [x] `apps/web/src/pages/monitors/detail/IntervalText.tsx`. reviewed. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. คงกติกาฟอนต์ตัวเลข mono กับหน่วยไทย sans ซึ่งอธิบายเหตุผลแยก span
- [x] `apps/web/src/pages/monitors/detail/LastResponseCard.tsx`. reviewed. อ่าน 248-270, 313-335. เสนอให้ลบ 0 ช่วง. คงเงื่อนไขหยุด polling หลัง 403 และสิทธิ์ไม่ส่ง last-response request สำหรับ reader
- [x] `apps/web/src/pages/monitors/detail/MonitorDetailMockups.tsx`. reviewed. อ่าน 1-31. เสนอให้ลบ 0 ช่วง. คงข้อจำกัด mockup ไม่อ้างข้อมูลจริงหรือ freshness และเหตุผลต้องรอ per-day uptime series ไม่ใช่เก็บเพียง Issue #56
- [x] `apps/web/src/pages/monitors/detail/MonitorEventsCard.tsx`. reviewed. อ่าน 30-52, 178-200, 205-227. เสนอให้ลบ 0 ช่วง. คง typography ภาษาไทย error isolation และ pager เมื่อ total ลด
- [x] `apps/web/src/pages/monitors/detail/ResponseTimeCard.tsx`. reviewed. อ่าน 81-117, 174-196. เสนอให้ลบ 0 ช่วง. คง caption design, card error isolation และเหตุผลให้ chart/table ใช้ window notes ร่วมกัน
- [x] `apps/web/src/pages/monitors/detail/SslCard.tsx`. reviewed. อ่าน 4-26. เสนอให้ลบ 0 ช่วง. คง domain fact ว่า certificate ที่อ่านได้แต่ invalid ยังต้องแสดงวันและ level
- [x] `apps/web/src/pages/monitors/detail/StatusCard.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน StatusCard.test.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/monitors/detail/StatusCard.tsx`. reviewed. อ่าน 16-38, 97-119, 149-185. เสนอให้ลบ 0 ช่วง. คงความต่าง status/pill, เหตุผลไม่มี live region ของ duration และข้อจำกัด inbox ของ server-active org
- [x] `apps/web/src/pages/monitors/detail/labels.ts`. reviewed. อ่าน 20-47, 66-88, 96-118, 124-157, 196-222. เสนอให้ลบ 1 ช่วง. ลบ header ตัวอย่าง assertionSummary ที่ return strings ระบุครบ คง TLS distinction, unknown wire code, actor ก่อนบันทึก และ secret-header naming
- [x] `apps/web/src/pages/monitors/flash.ts`. reviewed. อ่าน 5-91. เสนอให้ลบ 0 ช่วง. คง fixed notice key และสัญญา one-time focus/clear history ซึ่งชนิด state อย่างเดียวไม่บอก
- [x] `apps/web/src/pages/monitors/form-test-support.tsx`. reviewed. อ่าน 71-93. เสนอให้ลบ 0 ช่วง. คง contract ว่า write record ไม่มี computed state ของ Detail fixture
- [x] `apps/web/src/pages/monitors/form/AlertsSection.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน AlertsSection.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/monitors/form/AssertionsSection.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน AssertionsSection.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/monitors/form/BasicSection.tsx`. reviewed. อ่าน 16-135. เสนอให้ลบ 1 ช่วง. ลบ JSDoc advanced ที่ JSX condition และ summary ระบุชัด คง urlNote ที่อธิบาย secret-origin block
- [x] `apps/web/src/pages/monitors/form/MonitorForm.tsx`. reviewed. อ่าน 68-93, 95-123, 147-185, 198-246, 258-307, 314-336, 341-363, 381-434. เสนอให้ลบ 0 ช่วง. คง idempotency refusals, scope/role guards และ first-paint cache constraints; uncertain: 206 กล่าวเพียง page/switch แต่ predicate รวม membership/role และ 228 กล่าวว่า every render ทั้งที่ใช้ useMemo
- [x] `apps/web/src/pages/monitors/form/RequestSection.tsx`. reviewed. อ่าน 22-63, 72-106. เสนอให้ลบ 2 ช่วง. ลบ narration limit state และ fallback focus ที่ branches ระบุครบ คง disclosure warning และการไม่ย้าย value ระหว่าง visible/secret
- [x] `apps/web/src/pages/monitors/form/SecretSlot.tsx`. reviewed. อ่าน 4-119. เสนอให้ลบ 0 ช่วง. คง secret-replace contract ว่า stored value ไม่อ่านกลับและเปิด replacement ว่าง
- [x] `apps/web/src/pages/monitors/form/SecretsSection.tsx`. reviewed. อ่าน 12-34, 81-103, 140-177. เสนอให้ลบ 0 ช่วง. คง auth header collision, live region ตั้งแต่ render แรก และ focus เมื่อปุ่ม unmount
- [x] `apps/web/src/pages/monitors/form/TestPanel.tsx`. reviewed. อ่าน 15-38, 93-149, 254-276. เสนอให้ลบ 0 ช่วง. คง TestPanel contracts เรื่อง state owner, value-free snapshot, callback boolean, accessibility focus และ service-vs-target result
- [x] `apps/web/src/pages/monitors/form/controls.tsx`. reviewed. อ่าน 4-53, 64-140, 157-179, 234-256. เสนอให้ลบ 0 ช่วง. คง server-error prefix contract, secret store, uncontrolled input และ accessible-name constraints; uncertain: onType doc บอกส่ง path แต่ type และ call ไม่มี argument
- [x] `apps/web/src/pages/monitors/form/model.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน model.test.ts จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/monitors/form/model.ts`. reviewed. อ่าน 32-105, 189-222, 232-254, 304-336, 351-373, 445-467, 482-584. เสนอให้ลบ 1 ช่วง. ลบ SecretContext header ที่ชนิด base/get ระบุแล้ว คง UI key vs payload id, string numeric draft, origin restriction และ error-path contracts
- [x] `apps/web/src/pages/monitors/form/secrets.test.tsx`. reviewed. อ่าน 32-54. เสนอให้ลบ 1 ช่วง. ลบ narration secretShape ที่ assertions keys ระบุแล้ว ไม่แตะการพิสูจน์ไม่มี secret value
- [x] `apps/web/src/pages/monitors/form/secrets.ts`. reviewed. อ่าน 5-41, 60-96, 104-190, 197-270. เสนอให้ลบ 3 ช่วง. ลบคำบรรยาย requiredSlots, slotTakesValue และ keptSlots ที่ computation ระบุครบ คง canonical slots, secret-only memory, server entry protocol และ error mapping
- [x] `apps/web/src/pages/monitors/format.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน format.test.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/monitors/format.tsx`. reviewed. อ่าน 1-109, 133-155, 158-172. เสนอให้ลบ 1 ช่วง. ลบ header formatDate ที่ options ระบุชัด คง two-decimal rounding rationale, timezone/date ambiguity, domain fact แยก incident start/end reasons และ wire fallback
- [x] `apps/web/src/pages/monitors/list/MonitorCards.tsx`. reviewed. อ่าน 10-34, 67-90. เสนอให้ลบ 1 ช่วง. ลบบรรทัด card-layout label ที่ grid classes ระบุแล้ว คง null-hour semantics, chart description และ accessible-name เหตุผล
- [x] `apps/web/src/pages/monitors/useDataFresh.test.ts`. reviewed. อ่าน 1-21, 81-103, 105-193, 211-225. เสนอให้ลบ 2 ช่วง. ลบ narration snapshot false และ Accepted remount ที่ชื่อเคส/ผลระบุแล้ว คงเหตุผล pause/fetching, timestamp rule และ fake-clock fixture
- [x] `apps/web/src/pages/monitors/useDataFresh.ts`. reviewed. อ่าน 1-56. เสนอให้ลบ 0 ช่วง. คง freshness contract กับ pause history, เหตุผล set state ระหว่าง render และ timer ที่ recheck เมื่อยิงเร็ว
- [x] `apps/web/src/pages/monitors/useMonitorAccess.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน useMonitorAccess.test.ts จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/monitors/useMonitorAccess.ts`. reviewed. อ่าน 10-108. เสนอให้ลบ 0 ช่วง. คงการแยก missing/unreadable, role precedence และ failed/pending ที่ไม่เท่ากับ denied
- [x] `apps/web/src/pages/organization-members/InvitationCancelAction.test.tsx`. reviewed. อ่าน 47-69, 87-109, 186-217, 497-519. เสนอให้ลบ 1 ช่วง. ลบ narration จำนวน announcement ที่ assertion ระบุแล้ว คง fixture 1-based, status scopes และ server/list timing
- [x] `apps/web/src/pages/organization-members/InvitationCancelAction.tsx`. reviewed. อ่าน 19-60, 85-133, 141-188. เสนอให้ลบ 0 ช่วง. คง cancel success หลัง refetch, stale-scope, publicId focus และเหตุผลเลือก manageable neighbour หลังแถวถูกลบ
- [x] `apps/web/src/pages/organization-members/InvitationPanel.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน InvitationPanel.test.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/organization-members/InvitationPanel.tsx`. reviewed. อ่าน 43-66. เสนอให้ลบ 0 ช่วง. คงการ retire เฉพาะ confirmed switch เพื่อให้ bookmarked B ใช้ได้ตอน active A
- [x] `apps/web/src/pages/organization-members/InvitationResendAction.test.tsx`. reviewed. อ่าน 55-77, 222-244, 285-307, 660-682. เสนอให้ลบ 0 ช่วง. คง fixture ordering/cooldown, held refetch และเหตุผลลำดับ resend/cancel เพื่อทดสอบ notice ปัจจุบัน
- [x] `apps/web/src/pages/organization-members/InvitationResendAction.tsx`. reviewed. อ่าน 24-52, 112-149, 165-208. เสนอให้ลบ 0 ช่วง. คง reload page 1 หลัง confirmed resend, failed-refetch focus, browser clock ไม่แทน server และ aria-disabled
- [x] `apps/web/src/pages/organization-members/MemberRevokeAction.test.tsx`. reviewed. อ่าน 117-140, 296-326, 394-417. เสนอให้ลบ 0 ช่วง. คงขอบเขต actor context หลังลบคนอื่น race ที่สมาชิกถูกถอน และ harness status-region rationale
- [x] `apps/web/src/pages/organization-members/MemberRevokeAction.tsx`. reviewed. อ่าน 17-87, 115-144, 147-170. เสนอให้ลบ 0 ช่วง. คงข้อแตกต่าง revoke/self-leave, success จาก persisted list, focus เมื่อ row หาย และ actor denial refresh
- [x] `apps/web/src/pages/organization-members/MemberRoleActions.test.tsx`. reviewed. อ่าน 84-106, 164-186, 232-273, 357-380, 532-554, 601-623. เสนอให้ลบ 2 ช่วง. ลบคำบรรยาย submitSettled และ member-row contains focus ที่ assertions ระบุครบ คง table remount, competing PATCH และ actor-role fixtures
- [x] `apps/web/src/pages/organization-members/MemberRoleActions.tsx`. reviewed. อ่าน 27-89, 123-152, 156-181, 196-218. เสนอให้ลบ 0 ช่วง. คง persisted-role check, stale scope, focus recovery และข้อเท็จจริง actor อาจอยู่คนละหน้าจึงห้ามตีความ absence เป็นเสียสิทธิ์
- [x] `apps/web/src/pages/organization-members/PendingInvitationsSection.test.tsx`. reviewed. อ่าน 42-64, 235-258, 374-396. เสนอให้ลบ 0 ช่วง. คง fixture slicing, bearer UUID disclosure scan และ offset เลยท้ายเมื่ออีก session ยกเลิก rows
- [x] `apps/web/src/pages/organization-members/PendingInvitationsSection.tsx`. reviewed. อ่าน 23-51, 54-167. เสนอให้ลบ 0 ช่วง. คง focus target contract, cooldown rearm, publicId-only hooks, cursor/page refetch timing และ focus หลัง rows remount
- [x] `apps/web/src/pages/organization-members/SelfLeaveAction.test.tsx`. reviewed. อ่าน 243-265. เสนอให้ลบ 0 ช่วง. คงเหตุผลลบ cached member lists เมื่อ membership สิ้นสุด เป็น isolation constraint
- [x] `apps/web/src/pages/organization-members/SelfLeaveAction.tsx`. reviewed. อ่าน 57-79, 103-160, 196-219. เสนอให้ลบ 0 ช่วง. คง StrictMode cleanup, destination-heading focus และเหตุผล failed DELETE อาจ commit จึงต้องอ่าน confirmed context
- [x] `apps/web/src/pages/organization-members/member-action-test-support.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน member-action-test-support.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/organization-members/useOrganizationScope.ts`. reviewed. อ่าน 3-65. เสนอให้ลบ 0 ช่วง. คง stale-scope contract ว่า completion ห้ามเขียน notices/dialog/cache หลัง server-confirmed switch หรือ unmount
- [x] `apps/web/src/pages/projects/ProjectFormDialog.tsx`. reviewed. อ่าน 60-99, 159-181. เสนอให้ลบ 1 ช่วง. ลบ Present when editing ที่ editing = project !== undefined ระบุแล้ว คง slug immutable และ async list-reload contract
- [x] `apps/web/src/pages/projects/ProjectsPage.test.tsx`. reviewed. อ่าน 186-215, 425-447, 849-871, 1054-1076, 1123-1145. เสนอให้ลบ 1 ช่วง. ลบ narration ของ reload ภายหลังไม่คืน notice ที่ assertions ระบุแล้ว คง same-URL revalidation, held fetch และ leak/focus rationale
- [x] `apps/web/src/pages/projects/ProjectsPage.tsx`. reviewed. อ่าน 41-81, 112-134, 136-160, 173-294, 393-415. เสนอให้ลบ 0 ช่วง. คง keyed isolation, one-time notice, create-param navigation race และ cache cancellation ordering; uncertain: 219 บอก refetch ไม่เปลี่ยน announcement แต่ effect ขึ้นกับ projects/visible.length
- [x] `apps/web/src/pages/projects/members/AddMemberDialog.tsx`. reviewed. อ่าน 32-83, 93-115, 126-184. เสนอให้ลบ 0 ช่วง. คง insert-only count contract, selection ข้าม search, cap, roving tabindex และ invalid selection เมื่อพ้นองค์กร
- [x] `apps/web/src/pages/projects/members/ProjectMembersPage.test.tsx`. reviewed. อ่าน 100-122, 176-198, 410-432, 773-797, 991-1013, 1056-1078, 1116-1138. เสนอให้ลบ 0 ช่วง. คง fake persisted roster, staleTime, plain-refetch isolation, ON CONFLICT race และเหตุผล debounce/focus/reload
- [x] `apps/web/src/pages/projects/members/ProjectMembersPage.tsx`. reviewed. อ่าน 33-55, 57-79, 86-167, 179-202, 206-248, 281-321, 366-388, 414-436, 774-796. เสนอให้ลบ 0 ช่วง. คง 404 privacy, redirect ที่ยอมให้ user navigation ชนะ, role remount focus และ insert-only counts
- [x] `apps/web/src/pages/projects/members/roles.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน roles.ts จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/projects/overview/EventsSection.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน EventsSection.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/projects/overview/ProjectOverviewPage.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน ProjectOverviewPage.test.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/projects/overview/ProjectOverviewPage.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน ProjectOverviewPage.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/settings/DisplayPage.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน DisplayPage.test.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/settings/DisplayPage.tsx`. reviewed. อ่าน 23-45, 69-100. เสนอให้ลบ 0 ช่วง. คงเหตุผลปัดเวลาเป็นนาทีเพื่อ offset ถูกต้อง unknown runtime zone และ language singleton
- [x] `apps/web/src/pages/settings/MfaCard.test.tsx`. reviewed. อ่าน 97-119. เสนอให้ลบ 0 ช่วง. คงเหตุผลย้อน step ต้องทิ้ง secret เพราะ enable ใหม่จะ mint อีกค่า
- [x] `apps/web/src/pages/settings/MfaCard.tsx`. reviewed. อ่าน 55-78, 85-126, 172-194, 756-778, 844-866. เสนอให้ลบ 0 ช่วง. คง server-confirmed enabled, draft isolation, remount focus, Better Auth discriminator และ QR scanner contrast; uncertain: 112 กล่าวว่า QR never stored แต่มี setQr เก็บใน component state น่าจะหมายถึงไม่ persist
- [x] `apps/web/src/pages/settings/PasswordCard.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน PasswordCard.test.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/settings/PasswordCard.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน PasswordCard.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/settings/ProfilePage.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน ProfilePage.test.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/settings/ProfilePage.tsx`. reviewed. อ่าน 20-42. เสนอให้ลบ 0 ช่วง. คง no-upload product decision และ avatar ที่ derive จาก name ไม่ใช่ provenance ของ task
- [x] `apps/web/src/pages/settings/SecurityPage.test.tsx`. reviewed. อ่าน 37-59, 80-102, 189-211. เสนอให้ลบ 0 ช่วง. คง dynamic twoFactor flag, ขอบเขต MFA field labels และ failed lookup ไม่ใช่ known disabled
- [x] `apps/web/src/pages/settings/SecurityPage.tsx`. reviewed. อ่าน 70-92. เสนอให้ลบ 0 ช่วง. คงข้อจำกัด mockup fields ยังไม่มี API ไม่เสนอให้ลบเพียงเพราะมี issue 64
- [x] `apps/web/src/pages/settings/SessionsPage.test.tsx`. reviewed. อ่าน 60-82, 105-150. เสนอให้ลบ 0 ช่วง. คง empty-string localhost gotcha ของ better-auth และเหตุผล fixture ว่า UNKNOWN เก่ากว่า 1 ชั่วโมงจึงมาก่อน PHONE ที่เก่ากว่า 3 วัน
- [x] `apps/web/src/pages/settings/SessionsPage.tsx`. reviewed. อ่าน 21-43. เสนอให้ลบ 0 ช่วง. คงข้อจำกัด session token ใช้ revoke เท่านั้นและห้าม render
- [x] `apps/web/src/pages/settings/SettingsLayout.test.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน SettingsLayout.test.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/settings/SettingsLayout.tsx`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน SettingsLayout.tsx จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก
- [x] `apps/web/src/pages/settings/settings-tabs.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. ไม่พบ source comment ใน settings-tabs.ts จาก TypeScript AST trivia ครบทุก node/token โดยตัด string/template/regex/JSX text ออก

### Worker และ E2E

- [x] `apps/worker/Dockerfile`. reviewed. อ่าน 1-72. เสนอให้ลบ 0 ช่วง. เก็บ syntax directive, build context, เหตุผล dependency cache และข้อจำกัด Bun/credential/runtime entrypoint; ลบคำบรรยาย bundle ที่ build script ระบุแล้ว
- [x] `apps/worker/docker/worker-entrypoint.mjs`. reviewed. อ่าน 1-23. เสนอให้ลบ 0 ช่วง. ไม่มี source comment จากการอ่าน worker-entrypoint.mjs ทั้งไฟล์
- [x] `apps/worker/eslint.config.js`. reviewed. อ่าน 1-3. เสนอให้ลบ 0 ช่วง. ไม่มี source comment จากการอ่าน eslint.config.js ทั้งไฟล์
- [x] `apps/worker/package.json`. reviewed. อ่าน 1-28. เสนอให้ลบ 0 ช่วง. ไม่มี comment จากการอ่าน JSON ทั้งไฟล์
- [x] `apps/worker/src/audit/events.test.ts`. reviewed. อ่าน 1-118. เสนอให้ลบ 0 ช่วง. ไม่มี source comment จากการอ่าน events.test.ts ทั้งไฟล์
- [x] `apps/worker/src/audit/events.ts`. reviewed. อ่าน 1-126. เสนอให้ลบ 0 ช่วง. เก็บ CHECK constraint, แหล่งข้อมูลที่ redact แล้ว และสัญญาว่า export ใช้ filter เดียวกับ list API
- [x] `apps/worker/src/audit/exporter.db.test.ts`. reviewed. อ่าน 1-40, 174-226, 301-382, 432-509, 673-791, 831-977, 1128-1180. เสนอให้ลบ 3 ช่วง. ลบ coverage cross-reference และคำบรรยาย assertion; เก็บ RFC CSV, fixture clock, lease/deadline race, PostgreSQL lock และ queue-double rationale
- [x] `apps/worker/src/audit/exporter.ts`. reviewed. อ่าน 1-410. เสนอให้ลบ 0 ช่วง. เก็บ result/lease/shutdown contract, callback transaction timing, privacy ของ search และ lock order; ไม่ลบ failure policy ที่อยู่อีกชั้น DB
- [x] `apps/worker/src/audit/file.test.ts`. reviewed. อ่าน 1-181. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย role code assertion ที่ literal expected value ระบุแล้ว
- [x] `apps/worker/src/audit/file.ts`. reviewed. อ่าน 1-172. เสนอให้ลบ 1 ช่วง. เก็บ ISO UTC, display-label/export schema, CSV injection rationale และขอบเขต byte limit; ลบคำบรรยาย changeText ที่ซ้ำ return expression
- [x] `apps/worker/src/audit/maintenance.test.ts`. reviewed. อ่าน 1-166. เสนอให้ลบ 0 ช่วง. ไม่มี source comment จากการอ่าน maintenance.test.ts ทั้งไฟล์
- [x] `apps/worker/src/audit/maintenance.ts`. reviewed. อ่าน 1-80. เสนอให้ลบ 1 ช่วง. เก็บนิยาม horizon หลังเดือนปัจจุบันและ retention 365 วัน; ลบคำอธิบาย batch guard ที่ชื่อ constant กับ warning ระบุแล้ว
- [x] `apps/worker/src/audit/test-support.ts`. reviewed. อ่าน 1-35. เสนอให้ลบ 0 ช่วง. ไม่มี source comment จากการอ่าน test-support.ts ทั้งไฟล์
- [x] `apps/worker/src/dispatch.db.test.ts`. reviewed. อ่าน 1-35. เสนอให้ลบ 0 ช่วง. ไม่มี source comment จาก TypeScript AST leading/trailing comment-range traversal ทั้งไฟล์; อ่าน import และการตั้งค่า integration เพิ่ม
- [x] `apps/worker/src/dispatch.ts`. reviewed. อ่าน 1-255. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล sweep เมื่อ audit-exporter หยุด และสัญญา transaction/notification/error ของ sweep
- [x] `apps/worker/src/index.ts`. reviewed. อ่าน 1-277. เสนอให้ลบ 0 ช่วง. เก็บ shutdown budgets, drain/gap, ready signal ordering, recovery และ log privacy; uncertain บรรทัด 211 ผูก attempts กับ stalled recovery แต่ตัวควบคุมจริงคือ maxStalledCount จึงไม่เสนอให้ลบทิ้ง
- [x] `apps/worker/src/materialize.db.test.ts`. reviewed. อ่าน 1-35, 322-369. เสนอให้ลบ 0 ช่วง. เก็บข้อจำกัด BullMQ retry timing ผ่าน Redis ซึ่งเป็นเหตุผลของ delay จริงใน fixture
- [x] `apps/worker/src/materialize.test.ts`. reviewed. อ่าน 1-41. เสนอให้ลบ 0 ช่วง. ไม่มี source comment จากการอ่าน materialize.test.ts ทั้งไฟล์
- [x] `apps/worker/src/materialize.ts`. reviewed. อ่าน 1-216. เสนอให้ลบ 0 ช่วง. เก็บ trust boundary ว่า ledger claim เป็น authoritative; ข้อความ -- ภายใน SQL template ไม่ใช่ source comment ที่เสนอให้ลบ
- [x] `apps/worker/src/monitor/checker-process.db.test.ts`. reviewed. อ่าน 1-454, 508-609. เสนอให้ลบ 1 ช่วง. header บรรทัด 1-4 ปน coverage, injected poll timing, isolated services และ DNS preload rationale ข้ามบรรทัด จึงเก็บแทนการลบที่เหลือข้อความขาดตอน; เก็บ scheduling/lease/race/shutdown และ missing-partition fixture; ลบคำบรรยาย state assertion; uncertain บรรทัด 327 กล่าวถึง paused slot แต่ assertion ใกล้กันวัด latency
- [x] `apps/worker/src/monitor/checker-ssl.db.test.ts`. reviewed. อ่าน 1-82, 205-253, 383-432, 469-518, 529-613. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล advance SSL level, fresh claims, ClientHello reset timing, boundary clock และ untrusted CA fixture
- [x] `apps/worker/src/monitor/checker.db.test.ts`. reviewed. อ่าน 1-35, 178-480, 746-794, 821-869, 889-937, 1023-1139, 1174-1235, 1280-1328, 1341-1417, 1480-1577, 1585-1633, 1689-1737, 1750-1805, 2082-2130, 2147-2195. เสนอให้ลบ 3 ช่วง. ลบ narration ของ event/rollup/mask assertion; เก็บ snapshot/AAD/encoding/non-vacuous/race/isolation rationale; uncertain บรรทัด 1548 กล่าวถึง matched text แต่ assertion ใกล้กันตรวจ outcome และบรรทัด 1769 อ้าง startAt ที่ไม่มีใน helper นี้ จึงไม่เสนอ deletion
- [x] `apps/worker/src/monitor/checker.ts`. reviewed. อ่าน 1-391. เสนอให้ลบ 0 ช่วง. เก็บ SSRF seams, egress classification, hex/json_agg, READ COMMITTED snapshot, decrypt-failure mapping และ abort-as-gap contract; ไม่มี coverage inventory
- [x] `apps/worker/src/monitor/egress-canary.test.ts`. reviewed. อ่าน 1-153. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล dead redirect target ที่ทำให้ test แยกการ follow redirect ได้; uncertain บรรทัด 113 กล่าว never contacted แต่ assertion ที่นี่ตรวจ failed เท่านั้น ไม่เสนอ deletion
- [x] `apps/worker/src/monitor/egress-canary.ts`. reviewed. อ่าน 1-75. เสนอให้ลบ 0 ช่วง. เก็บความหมาย unknown/failed, probe contract, shutdown cache และเหตุผลรับทุก HTTP status โดยไม่ follow redirect
- [x] `apps/worker/src/monitor/notifications.db.test.ts`. reviewed. อ่าน 1-35, 39-92, 124-236, 460-514, 623-682, 855-976. เสนอให้ลบ 0 ช่วง. เก็บ composite admin, fresh-claim writer, missing organization settings, overlapping recipients/other Project, SSL boundary และ Redis outage isolation/timing rationale
- [x] `apps/worker/src/monitor/notifications.ts`. reviewed. อ่าน 1-132. เสนอให้ลบ 0 ช่วง. เก็บ transactional outbox/membership-lock ordering, default true เมื่อไม่มี settings row และ certificate notification identity
- [x] `apps/worker/src/monitor/queue.ts`. reviewed. อ่าน 1-51. เสนอให้ลบ 0 ช่วง. เก็บ routing-only secret boundary, scheduled-slot ISO contract และเหตุผลไม่ retry stale check
- [x] `apps/worker/src/monitor/record-result.ts`. reviewed. อ่าน 1-228, 251-617. เสนอให้ลบ 0 ช่วง. เก็บ event transaction, lock retry/order, certificate identity/expiry, check_error uptime และ newer-slot snapshot contract; Task 09 อยู่บรรทัดเดียวกับกฎ new identity จึงไม่ลบทั้งบรรทัด
- [x] `apps/worker/src/monitor/scheduler.db.test.ts`. reviewed. อ่าน 1-35, 53-95, 116-158, 173-229, 325-367, 385-439, 552-595, 599-651. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย spyDatabase ที่ชื่อ hook/count และ implementation ระบุแล้ว; เก็บ next เป็น SQL, per-case Redis/DB isolation, disconnect gotcha, claim timing และ relay shutdown rationale
- [x] `apps/worker/src/monitor/scheduler.test.ts`. reviewed. อ่าน 1-35, 56-98, 260-302. เสนอให้ลบ 0 ช่วง. เก็บ role validation ก่อน connect ที่ทำให้ใช้ dead address ได้ และ full-batch fixture เพื่อพิสูจน์ stop ไม่ claim ต่อ
- [x] `apps/worker/src/monitor/scheduler.ts`. reviewed. อ่าน 1-190, 191-230. เสนอให้ลบ 0 ช่วง. เก็บ shutdown slot preservation, TypeScript narrowing ข้าม await, error-log privacy, DB/Redis boundary และ lease recovery; uncertain บรรทัด 163 บอก lease expiry แต่ caller พยายาม release ทันที ไม่เสนอ deletion
- [x] `apps/worker/src/monitor/test-dns-preload.ts`. reviewed. อ่าน 1-33. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล Bun preload patch lookup import และ host-map ที่แก้ระหว่าง child process ทำงานได้; เป็น test-only seam constraint
- [x] `apps/worker/src/monitor/test-harness.ts`. reviewed. อ่าน 1-43, 79-253, 254-309. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย setHandler ที่ signature/implementation ระบุแล้ว; เก็บ cross-tenant DB isolation, loopback SSRF allowlist, claimed seed state, TCP counters และ throwaway Redis rationale
- [x] `apps/worker/src/monitor/test-pki.ts`. reviewed. อ่าน 1-35, 109-180. เสนอให้ลบ 0 ช่วง. เก็บความต่างระหว่าง loopback listener กับ host ที่ URL ใช้ ซึ่งจำเป็นต่อ TLS/SNI fixture
- [x] `apps/worker/src/partition-horizon.test.ts`. reviewed. อ่าน 1-100. เสนอให้ลบ 0 ช่วง. ไม่มี source comment จากการอ่าน partition-horizon.test.ts ทั้งไฟล์
- [x] `apps/worker/src/partition-horizon.ts`. reviewed. อ่าน 1-40. เสนอให้ลบ 0 ช่วง. เก็บ UTC และการไม่นับเดือนปัจจุบันใน YYYYMM contract ของ partitionSuffixesAhead
- [x] `apps/worker/src/shutdown.test.ts`. reviewed. อ่าน 1-30. เสนอให้ลบ 0 ช่วง. ไม่มี source comment จากการอ่าน shutdown.test.ts ทั้งไฟล์
- [x] `apps/worker/src/shutdown.ts`. reviewed. อ่าน 1-43. เสนอให้ลบ 0 ช่วง. เก็บข้อจำกัด ioredis ที่ close และ disconnect อาจค้าง รวมถึง hard shutdown deadline ที่ต้อง exit non-zero
- [x] `apps/worker/tsconfig.json`. reviewed. อ่าน 1-5. เสนอให้ลบ 0 ช่วง. ไม่มี comment จากการอ่าน tsconfig JSON ทั้งไฟล์; // อยู่ใน schema URL string
- [x] `e2e/bunfig.toml`. reviewed. อ่าน 1-3. เสนอให้ลบ 0 ช่วง. เก็บ fail-closed dependency script policy ที่อธิบาย security setting ignoreScripts
- [x] `e2e/package.json`. reviewed. อ่าน 1-13. เสนอให้ลบ 0 ช่วง. ไม่มี comment จากการอ่าน e2e package JSON ทั้งไฟล์
- [x] `e2e/playwright.config.ts`. reviewed. อ่าน 1-100. เสนอให้ลบ 0 ช่วง. เก็บ per-worktree ports, caller-only credentials/loopback allowlist และ stdout เพื่อ scan secret ซึ่งเป็น isolation/security rationale
- [x] `e2e/support/monitor-checks.ts`. reviewed. อ่าน 1-183. เสนอให้ลบ 0 ช่วง. เก็บข้อจำกัด driveMonitorChecks ใช้เฉพาะ transition/response fixtures ไม่ใช้พิสูจน์ interval-weighted uptime/duration/cadence
- [x] `e2e/support/monitor-fixtures.ts`. reviewed. อ่าน 1-229. เสนอให้ลบ 0 ช่วง. ลบคำบรรยาย raw-text fallback ใน catch; เก็บ hostname mapping, lowercase sign-in, slug constraints, membership prerequisite, cascade cleanup และ viewport contract
- [x] `e2e/support/monitor-target.mjs`. reviewed. อ่าน 1-121. เสนอให้ลบ 1 ช่วง. แยก route inventory ที่ซ้ำ handler ออกจาก loopback/SSRF และ in-memory-secret rationale; เก็บ JSDoc typedef/type/param ทุกจุดเพราะ JavaScript ใช้เป็น static types ได้
- [x] `e2e/support/response-target.mjs`. reviewed. อ่าน 1-132. เสนอให้ลบ 1 ช่วง. ลบ route inventory ที่ handler ระบุแล้ว; เก็บ one-target-per-monitor isolation, memory-only values, Latin-1 protocol และ JSDoc static types; issue #58 ปนบรรทัดเดียวกับ loopback constraint จึงไม่ลบทั้งบรรทัด
- [x] `e2e/tests/auth-entry.spec.ts`. reviewed. อ่าน 1-72. เสนอให้ลบ 0 ช่วง. ไม่มี source comment จากการอ่าน auth-entry.spec.ts ทั้งไฟล์
- [x] `e2e/tests/hello.spec.ts`. reviewed. อ่าน 1-28. เสนอให้ลบ 0 ช่วง. header มี coverage/provenance ปนเหตุผล same-origin ผ่าน dev proxy ในบรรทัดเดียวกัน จึงไม่เสนอ whole-line deletion ที่ทำให้ protocol context หาย
- [x] `e2e/tests/login-active-organization.spec.ts`. reviewed. อ่าน 1-35, 539-562. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลเลือก organization-level Projects route แทน Monitor ซึ่งอยู่ใต้ Project สำหรับ scope assertion
- [x] `e2e/tests/monitor-alert-settings.spec.ts`. reviewed. อ่าน 1-35. เสนอให้ลบ 0 ช่วง. ไม่มี source comment จาก TypeScript AST leading/trailing comment-range traversal ทั้งไฟล์; อ่าน imports และ fixture declarations เพิ่ม
- [x] `e2e/tests/monitor-event-feed.spec.ts`. reviewed. อ่าน 1-73, 104-146, 264-301, 376-413, 415-497, 516-553. เสนอให้ลบ 4 ช่วง. ลบ narration ของ viewer/masked/request_values assertions และบรรทัดนำ scan; เก็บ log-scan prefixes, Latin-1, positive controls, transition threshold, Project membership และข้อยกเว้น plain query/body configuration
- [x] `e2e/tests/monitors-access.spec.ts`. reviewed. อ่าน 1-55, 71-108, 116-154, 206-243, 256-293, 315-352, 361-398, 450-487, 597-634. เสนอให้ลบ 2 ช่วง. ลบ coverage header และ keyboard-table narration; เก็บ Project/Organization role setup, denied-state synchronization, second-session revocation timing, background refresh race และ accessible label ownership
- [x] `e2e/tests/monitors-list-sort-view.spec.ts`. reviewed. อ่าน 1-551. เสนอให้ลบ 1 ช่วง. ลบเฉพาะ Issue #59/coverage/P59/NODE header บรรทัด 20-22; เก็บไม่มี monitor_schedule เพื่อกัน Worker, reseed เพื่อไม่ stale, seed ที่แยก sort orders, tuple units และ month-partition boundary
- [x] `e2e/tests/monitors-states.spec.ts`. reviewed. อ่าน 1-105, 210-252, 605-698, 729-798, 851-890, 1086-1129, 1132-1182. เสนอให้ลบ 2 ช่วง. ลบ UI action narration สองจุด; เก็บ cleanup, Project membership, dev-server loading timing, duplicate fixture, per-Project cap, pending cross-tenant response และ client-navigation proof; uncertain บรรทัด 618 กล่าว viewers แต่ช่วงนี้ signIn owner และ 864 กล่าวชื่อปุ่มแต่ใช้ test ID คงที่
- [x] `e2e/tests/monitors.spec.ts`. reviewed. อ่าน 1-56, 76-159, 166-209, 230-269, 320-414, 452-532, 595-637. เสนอให้ลบ 3 ช่วง. ลบ narration ของ Test/no-create, forbidden requests และ recipient counts; เก็บ per-run isolation, flap startup order, probe query isolation, delay/poll timing, Project scope, inbox refresh/active org และ resume stale-result rationale
- [x] `e2e/tests/notifications.spec.ts`. reviewed. อ่าน 1-35, 715-755, 928-968. เสนอให้ลบ 0 ช่วง. เก็บ browser-realm dynamic import rationale ทั้งสองจุด เพราะ Node static import ไม่เข้าถึง reactive auth client ของหน้าเดียวกัน
- [x] `e2e/tests/project-members.spec.ts`. reviewed. อ่าน 1-35, 47-93, 237-345. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย absence assertions; เก็บ outsider/admin role setup, cached-before-revocation, write404 redirect และ overlay animation timing; uncertain บรรทัด 319 อ้าง internal table scroll แต่โค้ดนี้ตรวจ page overflow เท่านั้น ไม่เสนอ deletion
- [x] `e2e/tests/project-organization-membership.spec.ts`. reviewed. อ่าน 1-35. เสนอให้ลบ 0 ช่วง. ไม่มี source comment จาก TypeScript AST leading/trailing comment-range traversal ทั้งไฟล์; อ่าน imports และเริ่ม fixture เพิ่ม
- [x] `e2e/tests/project-overview.spec.ts`. reviewed. อ่าน 1-35, 43-82, 129-158. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย data-theme assertion; เก็บเหตุผล reduced-motion proof ใช้ browser-native state/animation แทน CSS values
- [x] `e2e/tests/project-switcher.spec.ts`. reviewed. อ่าน 1-35, 51-103, 152-191, 205-297. เสนอให้ลบ 2 ช่วง. ลบ narration ของ current Project persistence และ ArrowUp flow; เก็บ joined/hidden membership setup, cascade cleanup, consume create query, inactive Organization fixture และ responsive breakpoint constraints
- [x] `e2e/tests/projects.spec.ts`. reviewed. อ่าน 1-35, 57-96, 200-253. เสนอให้ลบ 2 ช่วง. ลบ narration ของ hidden fixture name และ root theme assertion; เก็บ ON DELETE CASCADE, overlay delay และการ scroll table region เพื่อเข้าถึง row action
- [x] `e2e/tests/settings.spec.ts`. reviewed. อ่าน 1-39, 45-84, 372-411, 425-445. เสนอให้ลบ 1 ช่วง. แยก personal-settings label ออกจาก dedicated-account safety; เก็บ credential requirement, MFA/password mutation/restore, RFC6238 และการ revert จาก session ที่ยัง active
- [x] `e2e/verification/api-matrix.ts`. reviewed. อ่าน 1-123, 156-193, 396-433, 502-568, 589-699, 821-1020, 1034-1071, 1111-1161, 1163-1248, 1296-1344, 1500-1611. เสนอให้ลบ 11 ช่วง. ลบ assertion/phase narration ที่ check log ระบุแล้ว; เก็บ running-stack/log prerequisites, pacing, role/fixture isolation, caller-input IP exclusion, cross-port origin, Redis MONITOR capture และ AAD rationale; header บรรทัด 9-11 เป็น coverage inventory แต่บรรทัด 11 ปน response capture ที่จำเป็นกับบรรทัด 12 จึงไม่เสนอ whole-line deletion ที่เหลือข้อความขาดตอน; uncertain บรรทัด 1124 กล่าว same transaction แต่ check ใกล้กันตรวจเพียง final count ไม่เสนอ deletion
- [x] `e2e/verification/redis-outage.ts`. reviewed. อ่าน 1-98, 309-336. เสนอให้ลบ 0 ช่วง. เก็บ warning ว่าต้อง throwaway Redis เพราะ script stop/pause/start จริง และ invocation contract; uncertain catch comments Not paused/Already running อธิบาย error เพียงชนิดเดียวทั้งที่ docker wrapper โยนทุก nonzero จึงไม่เสนอ deletion จากข้อสันนิษฐาน
- [x] `e2e/verification/scan-logs.ts`. reviewed. อ่าน 1-68. เสนอให้ลบ 0 ช่วง. เก็บ CLI input contract, prefix patterns เพื่อครอบคลุมค่าที่ scenario ไม่ save และข้อห้ามพิมพ์ matched secret; ไม่มี coverage-only inventory
- [x] `e2e/verification/worker-restart.ts`. reviewed. อ่าน 1-170, 175-214, 253-275. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย resumed-round assertion; เก็บ caller ต้องหยุด Worker เดิม, short/long drain timing และ invocation contract; uncertain catch Already gone อาจไม่ครอบคลุมทุก rejection จึงไม่เสนอ deletion

### Packages

- [x] `packages/api-contract/eslint.config.js`. reviewed. อ่าน 1-3. เสนอให้ลบ 0 ช่วง. โปรไฟล์ createConfig ชนิด api-contract ไม่มี comment จาก AST/trivia ของ TypeScript ทั้งไฟล์
- [x] `packages/api-contract/package.json`. reviewed. อ่าน 1-23. เสนอให้ลบ 0 ช่วง. อ่าน exports, scripts และ dependencies ทั้ง JSON ไม่มี comment
- [x] `packages/api-contract/src/audit-log.test.ts`. reviewed. อ่าน 1-65. เสนอให้ลบ 0 ช่วง. อ่าน assertions ของ auditChangeSchema และ OpenAPI ทั้งไฟล์ ไม่มี comment จาก AST/trivia
- [x] `packages/api-contract/src/audit-log.ts`. reviewed. อ่าน 1-462. เสนอให้ลบ 1 ช่วง. ลบคำบอกตำแหน่งใช้งาน auditScopeNote ได้ เก็บ browser boundary, event-time Project, privacy ของ export, OpenAPI nullable workaround และ eslint directives
- [x] `packages/api-contract/src/auth.test.ts`. reviewed. อ่าน 1-73. เสนอให้ลบ 0 ช่วง. อ่านการทดสอบ decimalInteger และ memberLimit ทั้งไฟล์ ไม่มี comment จาก AST/trivia
- [x] `packages/api-contract/src/auth.ts`. reviewed. อ่าน 1-198. เสนอให้ลบ 2 ช่วง. ลบป้ายบอกเจ้าของ meContextResponseSchema และคำบรรยาย activeOrganizationInputSchema ได้ เก็บ browser boundary, Better Auth membershipLimit และ bearer capability ของ invitation
- [x] `packages/api-contract/src/error.ts`. reviewed. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. เก็บสัญญา non-2xx envelope และ message ที่แสดงต่อผู้ใช้ได้ ห้ามเผย internals ซึ่ง z.string ไม่ได้สื่อ
- [x] `packages/api-contract/src/health.ts`. reviewed. อ่าน 1-18. เสนอให้ลบ 0 ช่วง. เก็บความต่าง liveness/readiness และความหมาย self เมื่อไม่มี dependency ซึ่ง record<string,...> ไม่ได้บอก
- [x] `packages/api-contract/src/hello.ts`. reviewed. อ่าน 1-10. เสนอให้ลบ 0 ช่วง. เก็บ endpoint GET /api/v1/hello และ timestamp ว่าเป็นเวลาสร้างคำทักทาย ไม่ใช่เวลาที่ client รับ
- [x] `packages/api-contract/src/index.ts`. reviewed. อ่าน 1-88. เสนอให้ลบ 0 ช่วง. อ่านรายการ re-export contracts ทั้งไฟล์ ไม่มี comment จาก AST/trivia
- [x] `packages/api-contract/src/monitor.test.ts`. reviewed. อ่าน 200-275. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลที่ é จำนวน 2049 ตัวเกินขอบเขตไบต์ แม้จำนวนตัวอักษรไม่เกินขอบเขต schema ตรวจ comment ทั้งไฟล์ด้วย AST แล้วอ่าน test ที่มี comment
- [x] `packages/api-contract/src/monitor.ts`. reviewed. อ่าน 1-1396. เสนอให้ลบ 3 ช่วง. ลบคำบรรยาย badText, คำอธิบาย canonicalSecretSlot ที่ซ้ำบล็อก SECRET_SLOT_INPUT และป้าย history ได้ เก็บ protocol/security/domain contracts และ reported ใน empty branches เพราะ no-empty ต้องมี comment ตาม packages/eslint-config/index.js:154 กับกฎ ESLint no-empty เก็บ catch fallback ด้วยเหตุผลเดียวกัน uncertain ที่บรรทัด 115 อ้าง refinements above ทั้งที่ refinement อยู่ด้านล่าง
- [x] `packages/api-contract/src/notification.ts`. reviewed. อ่าน 1-288. เสนอให้ลบ 0 ช่วง. เก็บ event-time subject, hostname null ของข้อมูลเก่า/IP, อายุ export, account-global scope race และการรองรับ settings client เก่า ทั้งหมดเพิ่มความหมายเหนือ Zod types
- [x] `packages/api-contract/src/project.test.ts`. reviewed. อ่าน 1-249. เสนอให้ลบ 0 ช่วง. อ่านการทดสอบ create/update/member/candidate/detail ทั้งไฟล์ ไม่มี comment จาก AST/trivia
- [x] `packages/api-contract/src/project.ts`. reviewed. อ่าน 1-228. เสนอให้ลบ 1 ช่วง. ลบคำบอกว่า role จำเป็นซึ่ง schema บังคับอยู่แล้วได้ เก็บ code-point storage, slug/tenant immutability, visibility, selectedAt ordering, member sorting และ service-level 404
- [x] `packages/api-contract/src/version.ts`. reviewed. อ่าน 1-9. เสนอให้ลบ 0 ช่วง. เก็บแหล่งข้อมูล name/version จาก package.json ซึ่ง types ไม่บอก
- [x] `packages/api-contract/tests/auth-contract.test.ts`. reviewed. อ่าน 1-112. เสนอให้ลบ 0 ช่วง. อ่าน invitation, context และ active-organization assertions ทั้งไฟล์ ไม่มี comment จาก AST/trivia
- [x] `packages/api-contract/tests/contract.test.ts`. reviewed. อ่าน 1-66. เสนอให้ลบ 0 ช่วง. อ่าน hello/error/readiness/version assertions ทั้งไฟล์ ไม่มี comment จาก AST/trivia
- [x] `packages/api-contract/tests/notification-contract.test.ts`. reviewed. อ่าน 1-96. เสนอให้ลบ 0 ช่วง. อ่าน discriminants, bounds และ status error schemas ทั้งไฟล์ ไม่มี comment จาก AST/trivia
- [x] `packages/api-contract/tsconfig.json`. reviewed. อ่าน 1-5. เสนอให้ลบ 0 ช่วง. อ่าน bun config inheritance และ include ของ contract ทั้ง JSON ไม่มี comment
- [x] `packages/db/eslint.config.js`. reviewed. อ่าน 1-3. เสนอให้ลบ 0 ช่วง. โปรไฟล์ createConfig ชนิด db ไม่มี comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/db/migrations/0001_auth_foundation.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ auth foundation และ pre-tenant privilege policy แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0002_notification_foundation.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ notification account FORCE RLS foundation แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0003_notification_dispatch_write.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ dispatch-origin write-only ledger contract แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0004_fix_notification_dispatch_requeue.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ stale-requeue SQLSTATE 42P01 repair แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0005_notification_dispatch_visibility.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ completed dispatch visibility policies แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0006_notification_account_mfa_backfill.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ verified-MFA backfill และ lock ordering แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0007_notification_dispatch_failure_summary.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ bounded allowlisted failure summaries แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0008_notification_function_owners.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ purpose-specific SECURITY DEFINER owners แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0009_notification_dispatch_origin_ledger_select.sql`. protected. อ่าน 1-4. เสนอให้ลบ 0 ช่วง. อ่าน header ของ ON CONFLICT index SELECT grant แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0010_notification_dispatch_origin_ledger_select_policy.sql`. protected. อ่าน 1-13. เสนอให้ลบ 0 ช่วง. อ่าน header ของ caller-scope dispatch-origin SELECT policy แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0011_notification_expiry_purge_lock_grant.sql`. protected. อ่าน 1-4. เสนอให้ลบ 0 ช่วง. อ่าน header ของ SKIP LOCKED UPDATE privilege แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0012_notification_expiry_purge_lock_policy.sql`. protected. อ่าน 1-7. เสนอให้ลบ 0 ช่วง. อ่าน header ของ expired-row locking RLS policy แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0013_notification_dispatch_exhausted_not_reclaimed.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ terminal failure recovery hold แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0014_notification_inbox_read_state_update_grant.sql`. protected. อ่าน 1-6. เสนอให้ลบ 0 ช่วง. อ่าน header ของ read_at-only UPDATE grant แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0015_notification_dispatch_exhausted_requires_ack.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ pre-ack exhaustion recovery distinction แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0016_uptime_monitors.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ Organization-owned monitor composite-key isolation แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0017_monitor_notifications.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ monitor notification event constraints แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0018_invitation_management.sql`. protected. อ่าน 1-13. เสนอให้ลบ 0 ช่วง. อ่าน header ของ public invitation ID และ resend cooldown แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0019_monitor_event_feed.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ monitor event feed/last-response additions แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0020_organization_audit_log.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ append-only organization audit log แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0021_audit_exports.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ audit export routing/notification/retention แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0022_monitor_alert_settings.sql`. protected. อ่าน 1-14. เสนอให้ลบ 0 ช่วง. อ่าน header ของ per-monitor alert defaults และ inherited RLS grants แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0023_projects.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ Project ownership และ FORCE RLS แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0024_project_members.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ immutable project-member identity grants แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0025_member_last_project.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ per-user last-Project hint ไม่ใช่ access grant แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0026_project_monitors.sql`. protected. อ่าน 1-15. เสนอให้ลบ 0 ช่วง. อ่าน header ของ explicit no-CASCADE monitor-data wipe แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/migrations/0027_notification_monitor_hostname.sql`. protected. อ่าน 1-14. เสนอให้ลบ 0 ช่วง. อ่าน header ของ event-time DNS hostname พร้อม null legacy rows แล้ว เป็น historical SQL migration ที่ต้องคงข้อความเดิม packages/db/src/migrator.ts:39-47 hash SQL ทั้งข้อความ และ 82-90 ปฏิเสธ applied hash ที่เปลี่ยน จึงไม่เสนอ deletion
- [x] `packages/db/package.json`. reviewed. อ่าน 1-29. เสนอให้ลบ 0 ช่วง. อ่าน exports, migration CLI/bundle scripts และการแยก integration tests ทั้ง JSON ไม่มี comment
- [x] `packages/db/src/audit-events.ts`. reviewed. อ่าน 1-191. เสนอให้ลบ 0 ช่วง. เก็บ shared filter ownership, current-member-only names, SQL placeholder ordering, fixed export window และ tenant transaction contract uncertain ที่ retainedFrom บรรทัด 149 อ้าง see below แต่คำอธิบายอยู่บรรทัด 134-142
- [x] `packages/db/src/audit.ts`. reviewed. อ่าน 1-114. เสนอให้ลบ 0 ช่วง. เก็บ exhaustion/deadline, lease, caller tenant/user context, atomic notification และ retention ซึ่งซ่อนอยู่หลัง SQL functions
- [x] `packages/db/src/client.ts`. reviewed. อ่าน 1-32. เสนอให้ลบ 0 ช่วง. เก็บ comment ของ Database ไว้ก่อน uncertain ว่า Process-wide เป็น lifecycle contract ของ caller หรือถ้อยคำเก่า เพราะ createDatabase สร้าง Pool ใหม่ต่อการเรียก
- [x] `packages/db/src/index.ts`. reviewed. อ่าน 1-51. เสนอให้ลบ 0 ช่วง. อ่าน re-exports ของ database, contexts, notification, audit และ migrator ทั้งไฟล์ ไม่มี comment จาก AST/trivia
- [x] `packages/db/src/migrate.ts`. reviewed. อ่าน 1-53. เสนอให้ลบ 1 ช่วง. ลบบล็อก bundling rationale ที่ซ้ำ header ได้ เก็บ operator environment contract และความต่าง owner/runtime role ใน header
- [x] `packages/db/src/migrator.ts`. reviewed. อ่าน 1-119. เสนอให้ลบ 0 ช่วง. เก็บ checksum prohibition, shared advisory key, concurrent runner serialization และ atomic migration/tracking transaction อ่าน listMigrations และ runMigrations ยืนยันว่ารวม comment ใน SHA-256 แล้วปฏิเสธ hash ที่เปลี่ยน
- [x] `packages/db/src/monitor.ts`. reviewed. อ่าน 1-57. เสนอให้ลบ 0 ช่วง. เก็บขอบเขต cross-Organization claim และ retention 30 วัน ซึ่ง wrapper types ไม่เปิดเผย
- [x] `packages/db/src/notification.ts`. reviewed. อ่าน 1-492. เสนอให้ลบ 0 ช่วง. เก็บ existing-transaction requirement, RLS context, stable origin, MFA lock order, recipient snapshot, replay/read_at และ ledger-discovery constraints ไม่มีป้ายหรือ provenance ล้วนที่แยกออกได้อย่างปลอดภัย
- [x] `packages/db/src/raw-transaction.ts`. reviewed. อ่าน 1-22. เสนอให้ลบ 0 ช่วง. เก็บหน้าที่ caller ในการ validate/set scope เพราะ helper นี้เปิด transaction แต่ไม่ตั้ง RLS context
- [x] `packages/db/src/schema.ts`. reviewed. อ่าน 1-210. เสนอให้ลบ 0 ช่วง. เป็น schema เขียนเอง ไม่ใช่ generated เก็บ Better Auth exact model/field names, text UUID policy, identity/index invariants, invitation history และ encryption/no-log constraint
- [x] `packages/db/src/tenant-context.ts`. reviewed. อ่าน 1-53. เสนอให้ลบ 0 ช่วง. เก็บ supplied-client requirement, transaction-local cleanup และความต่าง pre-tenant auth กับ tenant/user-scoped data
- [x] `packages/db/tests/audit-export.db.test.ts`. reviewed. อ่าน 22-80, 256-288, 735-779. เสนอให้ลบ 0 ช่วง. เก็บ SQL interval ความหมายของ seed, owner/RLS context, isolation ของผู้ขอ export และ fixture ที่ cleared rows ต้องไม่บัง expired row ตรวจ comment ทุกจุดด้วย AST และอ่าน containing helper/test
- [x] `packages/db/tests/client.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ database client ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/db/tests/member-last-project.db.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ member_last_project isolation/ordering ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/db/tests/migrator.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ migration discovery/hash ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/db/tests/monitor.db.test.ts`. reviewed. อ่าน 25-130, 216-242, 338-359, 495-549, 635-672, 949-1011, 1070-1092, 1190-1260, 1319-1360, 1367-1401, 1453-1471, 1493-1516, 1746-1786. เสนอให้ลบ 1 ช่วง. ลบ inventory ของ seedTenant ได้ เก็บเหตุผลแยก RLS/FK/grants, response-less checks, calendar partitions, claim/lease timing, retention fixture และ FK SET NULL uncertain ที่บรรทัด 668 บอก timeout at or above interval แต่ assertion ถัดไปส่ง 0
- [x] `packages/db/tests/notification-hostname.db.test.ts`. reviewed. อ่าน 5-119. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลว่า INSERT grants เดิมครอบคลุมคอลัมน์ใหม่ ไม่ต้องขยายสิทธิ์ อ่าน migration-upgrade test ที่มี comment ทั้งก้อน
- [x] `packages/db/tests/notification-mfa-backfill.db.test.ts`. reviewed. อ่าน 71-370. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล polling ของ PostgreSQL lock manager เพื่อทดสอบ race จริง ไม่ใช่ delay สมมติ SQL query ที่มี -- Backfill เป็น string matcher ไม่ใช่ source comment
- [x] `packages/db/tests/notification.db.test.ts`. reviewed. อ่าน 378-491, 695-749, 827-876. เสนอให้ลบ 0 ช่วง. เก็บ pre-ack exhaustion, scheduler crash window, recipient overlap และ Project fixture rationale ตรวจ source comments ด้วย AST และอ่าน test/setup ที่เกี่ยวข้อง
- [x] `packages/db/tests/postgres-fixture.db.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ lifecycle ของ isolated PostgreSQL fixture ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/db/tests/projects.db.test.ts`. reviewed. อ่าน 349-377. เสนอให้ลบ 0 ช่วง. เก็บ runtime deletion โดยไม่มี app.tenant_id เพื่อยืนยัน FORCE RLS cascade ไม่ใช่แค่บรรยาย DELETE
- [x] `packages/db/tests/raw-transaction.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ commit/rollback/release ของ raw transaction ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/db/tests/support/postgres.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ PostgreSQL support helper ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/db/tests/support/postgres.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. handwritten PostgreSQL fixture helper ไม่มี source comment จาก AST/trivia ทั้งไฟล์ จึงไม่ใช่ generated/protected
- [x] `packages/db/tsconfig.json`. reviewed. อ่าน 1-5. เสนอให้ลบ 0 ช่วง. อ่าน config inheritance และ include ของ database ทั้ง JSON ไม่มี comment
- [x] `packages/eslint-config/index.js`. reviewed. อ่าน 1-223. เสนอให้ลบ 1 ช่วง. ลบชื่อ factory ที่ซ้ำ createConfig ได้ เก็บ kind/framework import-policy contract, nearest tsconfig behavior และเหตุผลใช้ untyped rules กับ JS ไม่พบ JSDoc @type/@param/@returns ที่ขับ static analysis
- [x] `packages/eslint-config/index.test.js`. reviewed. อ่าน 1-180. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลปิด type-aware lint ใน virtual import snippets เพราะไม่ได้ทดสอบ project discovery ไม่ใช่คำบรรยาย assertion
- [x] `packages/eslint-config/package.json`. reviewed. อ่าน 1-21. เสนอให้ลบ 0 ช่วง. อ่าน exports และ ESLint/TypeScript dependency contract ทั้ง JSON ไม่มี comment
- [x] `packages/shared/eslint.config.js`. reviewed. อ่าน 1-3. เสนอให้ลบ 0 ช่วง. โปรไฟล์ createConfig ชนิด shared ไม่มี comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/shared/package.json`. reviewed. อ่าน 1-25. เสนอให้ลบ 0 ช่วง. อ่าน shared exports, Bun test profile และ server dependencies ทั้ง JSON ไม่มี comment
- [x] `packages/shared/src/audit-export.ts`. reviewed. อ่าน 1-120. เสนอให้ลบ 2 ช่วง. ลบป้าย auditScopeNote และคำแปล filter ของ auditActionCodesMatching ได้ เก็บเหตุผลคัดลอก constants เนื่องจาก Worker import boundary กับ parity-test ownership
- [x] `packages/shared/src/credentials.ts`. reviewed. อ่าน 1-104. เสนอให้ลบ 0 ช่วง. เก็บ AAD row identity, encrypted column mapping, safe errors, random IV/key rotation และ tamper/mis-binding failure contract
- [x] `packages/shared/src/env.ts`. reviewed. อ่าน 1-351. เสนอให้ลบ 0 ช่วง. เก็บ production fail-fast/default boundaries, strict boolean coercion gotcha, runtime/owner roles, secret-key validation, __proto__ rejection, static error messages และ named-host-only test exemption
- [x] `packages/shared/src/errors.ts`. reviewed. อ่าน 1-26. เสนอให้ลบ 1 ช่วง. ลบ provenance และตัวอย่างลำดับ constructor ที่ signature บอกอยู่แล้วได้ แยกเก็บ display-safe message และ generic-500 mapping
- [x] `packages/shared/src/index.ts`. reviewed. อ่าน 1-30. เสนอให้ลบ 0 ช่วง. อ่าน server exports ทั้งไฟล์ ไม่มี comment จาก AST/trivia
- [x] `packages/shared/src/logger.ts`. reviewed. อ่าน 1-63. เสนอให้ลบ 0 ช่วง. เก็บข้อห้าม credential-bearing fields ออก log ซึ่งเป็น security contract ของ REDACT_PATHS
- [x] `packages/shared/src/monitor-check/assertions.ts`. reviewed. อ่าน 1-198. เสนอให้ลบ 0 ช่วง. เก็บ charset/cut-tail behavior, JSON display disambiguation, shared parse, prefix semantics และการไม่โชว์ raw deep subtree ที่อาจมี secret
- [x] `packages/shared/src/monitor-check/check-url.ts`. reviewed. อ่าน 1-25. เสนอให้ลบ 0 ช่วง. เก็บ exact saved-query bytes, normalized-length validation และ save/run parity เพราะ URLSearchParams อาจเปลี่ยน bytes ได้
- [x] `packages/shared/src/monitor-check/index.ts`. reviewed. อ่าน 1-34. เสนอให้ลบ 0 ช่วง. อ่าน exports ของ executor/assertion/snapshot types ทั้งไฟล์ ไม่มี comment จาก AST/trivia
- [x] `packages/shared/src/monitor-check/json-scan.ts`. reviewed. อ่าน 1-322. เสนอให้ลบ 1 ช่วง. ลบคำอธิบาย cut-container sentinel ที่ซ้ำ indexContainers contract ได้ เก็บ valid-prefix precondition, NDJSON rejection, boolean stack encoding, malformed-loop progress และ duplicate-key semantics
- [x] `packages/shared/src/monitor-check/mask-secrets.ts`. reviewed. อ่าน 1-386. เสนอให้ลบ 0 ช่วง. เก็บ fail-closed shared work budget, encoded-span bounds, UTF-16 offset mapping, UTF-8/latin1/BOM behavior, decoding order และ surrogate safety ไม่มีการเสนอปรับ algorithm
- [x] `packages/shared/src/monitor-check/redact.ts`. reviewed. อ่าน 1-167. เสนอให้ลบ 0 ช่วง. เก็บ bounded-prefix contract, shared scan budget, overlapping-secret merge, lone-surrogate behavior, heap/group reasoning, cache rationale และ code-point truncation
- [x] `packages/shared/src/monitor-check/run-check.ts`. reviewed. อ่าน 1-263. เสนอให้ลบ 0 ช่วง. เก็บ body method policy, failure classification, masking/omission rationale และ target-error boundary uncertain ที่ header บรรทัด 127 บอก keeps no body ขณะที่ responseSnapshot เก็บ redacted body ได้ ไม่เสนอให้ลบ security rationale
- [x] `packages/shared/src/monitor-check/snapshot.ts`. reviewed. อ่าน 1-224. เสนอให้ลบ 0 ช่วง. เก็บ always-masked headers, request-values omission, mask-before-cut/NUL handling, maxSpan safety, raw content-type และ shared display-order budget
- [x] `packages/shared/src/monitor-check/ssl-level.ts`. reviewed. อ่าน 1-47. เสนอให้ลบ 0 ช่วง. เก็บ invalid Date precondition, ceil/-0 semantics และแยก notification-only threshold จาก displayed SSL state แม้มี issue IDs เพราะบล็อกอธิบาย domain constraint จริง
- [x] `packages/shared/src/monitor-check/types.ts`. reviewed. อ่าน 1-191. เสนอให้ลบ 0 ช่วง. เก็บ normalized-input boundary, secret-slot naming, caller abort, redacted fields, snapshot omission, transient diagnostics และ check_error exclusion จาก incidents/uptime
- [x] `packages/shared/src/outbound-http/address-policy.ts`. reviewed. อ่าน 1-152. เสนอให้ลบ 0 ช่วง. เก็บ IP byte shape, IPv4-compatible/translated/NAT64 labels, embedded-v4 exception, fail-closed parsing และ mapped-address equality ทั้งหมดช่วยอธิบาย SSRF boundary
- [x] `packages/shared/src/outbound-http/headers.ts`. reviewed. อ่าน 1-31. เสนอให้ลบ 1 ช่วง. ลบคำบรรยาย return name/null ของ findInvalidHeader ได้ โดยไม่แตะ forbidden headers, proxy prefix หรือ CR/LF/NUL checks
- [x] `packages/shared/src/outbound-http/http1.ts`. reviewed. อ่าน 1-276. เสนอให้ลบ 0 ช่วง. เก็บ latin1 reason phrase, redirect skipBody contract, restricted HTTP/1 behavior และเหตุผลทิ้ง trailers เมื่อ Connection close
- [x] `packages/shared/src/outbound-http/index.ts`. reviewed. อ่าน 1-23. เสนอให้ลบ 0 ช่วง. อ่าน outbound helper/type exports ทั้งไฟล์ ไม่มี comment จาก AST/trivia
- [x] `packages/shared/src/outbound-http/send.ts`. reviewed. อ่าน 1-710. เสนอให้ลบ 1 ช่วง. ลบประโยคเปิดที่บอกเพียงชื่อหน้าที่ sendOutboundRequest ได้ เก็บ secret forwarding, abort/diagnostics privacy, TLS/Bun gotchas, DNS/peer pinning, handshake checks, equal-share deadlines และ redirect/error contracts
- [x] `packages/shared/src/outbound-http/url.ts`. reviewed. อ่าน 1-98. เสนอให้ลบ 0 ช่วง. เก็บ WHATWG default/numeric-IP normalization, DNS-only event snapshot และ query/bare-pair/userinfo masking เพราะเป็น protocol/privacy constraints
- [x] `packages/shared/tests/auth-env.test.ts`. reviewed. อ่าน 1-105. เสนอให้ลบ 0 ช่วง. เก็บ regression rationale ของ z.coerce.boolean กับ Mailpit TLS ไม่ใช่เพียงหมายเลข INT-AUTH-2
- [x] `packages/shared/tests/credentials.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ encryption/AAD/tamper ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/shared/tests/env.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ base environment ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/shared/tests/errors.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ AppError ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/shared/tests/logger.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ redacted log output ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/shared/tests/monitor-check/assertions.test.ts`. reviewed. อ่าน 395-422. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลที่ input 198 ตัวแสดง JSON ยาว 200 เพราะมี quotes เพิ่ม ไม่ใช่เลข magic ที่อ่านจากชื่อ test ได้
- [x] `packages/shared/tests/monitor-check/check-url.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ query-byte preservation ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/shared/tests/monitor-check/evaluation-error.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ unexpected evaluation error ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/shared/tests/monitor-check/fixtures.ts`. reviewed. อ่าน 1-73. เสนอให้ลบ 0 ช่วง. เก็บ Content-Length framing contract ของ serveReplies ที่ callback signature ไม่บอก
- [x] `packages/shared/tests/monitor-check/invalid-request.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ invalid executor requests ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/shared/tests/monitor-check/json-scan.test.ts`. reviewed. อ่าน 91-97, 190-373. เสนอให้ลบ 0 ช่วง. เก็บ duplicate-key possibility หลัง cut, deterministic LCG และเหตุผล timeout ยาวของ deep-body correctness tests
- [x] `packages/shared/tests/monitor-check/redact.test.ts`. reviewed. อ่าน 115-154, 169-211, 219-273. เสนอให้ลบ 0 ช่วง. เก็บเหตุผล work-bound arithmetic, encoding forms, periodic-needle fixture และ independent oracle ที่ใช้ตรวจ secret masking
- [x] `packages/shared/tests/monitor-check/run-check.test.ts`. reviewed. อ่าน 339-370. เสนอให้ลบ 0 ช่วง. เก็บ silent TCP กับ completed-TLS fixture behavior เพื่อแยก timeout phase และ certificate retention
- [x] `packages/shared/tests/monitor-check/snapshot.test.ts`. reviewed. อ่าน 13-24, 328-342, 888-906, 958-1106, 1108-1127, 1138-1167. เสนอให้ลบ 3 ช่วง. ลบ encoding labels สองจุดที่ literal บอกตรงๆ และคำบรรยาย earlier/later header assertions ได้ เก็บ exact-wire/latin1, cut-straddling fixture math, tuple meanings, platform encoders และ fail-closed work-budget rationale
- [x] `packages/shared/tests/monitor-check/ssl-level.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ SSL threshold/rounding ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/shared/tests/monitor-env.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ monitor credential/test-host environment ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/shared/tests/outbound-http/abort.test.ts`. reviewed. อ่าน 1-277. เสนอให้ลบ 0 ช่วง. เก็บ server-side counter meanings, phase-ready abort, test-timeout margin และ ClientHello proof ของ handshake phase
- [x] `packages/shared/tests/outbound-http/address-policy.test.ts`. reviewed. อ่าน 1-151. เสนอให้ลบ 0 ช่วง. เก็บ tuple-column meanings และเหตุผลเลือก addresses นอก CIDR edges เพื่อให้ boundary fixture ตรวจสอบได้
- [x] `packages/shared/tests/outbound-http/fixtures.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ byte-level HTTP fixtures ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/shared/tests/outbound-http/fixtures.ts`. reviewed. อ่าน 1-284. เสนอให้ลบ 0 ช่วง. เก็บ openssl fixture dependency, null-before-complete body, byte/connection counters และ framing-control purpose
- [x] `packages/shared/tests/outbound-http/monitor-hostname.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ event-time DNS hostname ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/shared/tests/outbound-http/send.test.ts`. reviewed. อ่าน 1084-1110, 1247-1268, 1281-1302. เสนอให้ลบ 0 ช่วง. เก็บ Node overload narrowing, request-head proof ของ handshake completion และ blackhole/equal-share timing slack
- [x] `packages/shared/tests/outbound-http/url.test.ts`. reviewed. อ่าน ไม่มี. เสนอให้ลบ 0 ช่วง. การทดสอบ static URL policy/masking ไม่มี source comment จาก AST/trivia ทั้งไฟล์
- [x] `packages/shared/tsconfig.json`. reviewed. อ่าน 1-5. เสนอให้ลบ 0 ช่วง. อ่าน bun config inheritance และ include ของ shared ทั้ง JSON ไม่มี comment
- [x] `packages/typescript-config/base.json`. reviewed. อ่าน 1-16. เสนอให้ลบ 0 ช่วง. อ่าน strict compiler options ทั้ง JSON ไม่มี comment URL $schema เป็น string
- [x] `packages/typescript-config/bun.json`. reviewed. อ่าน 1-8. เสนอให้ลบ 0 ช่วง. อ่าน Bun type/lib override ทั้ง JSON ไม่มี comment
- [x] `packages/typescript-config/package.json`. reviewed. อ่าน 1-11. เสนอให้ลบ 0 ช่วง. อ่าน exports ของ compiler config ทั้ง JSON ไม่มี comment
- [x] `packages/typescript-config/react.json`. reviewed. อ่าน 1-8. เสนอให้ลบ 0 ช่วง. อ่าน React JSX และ DOM lib override ทั้ง JSON ไม่มี comment

### Root และ tooling

- [x] `.claude/settings.json`. reviewed. อ่าน 1-10. เสนอให้ลบ 0 ช่วง. อ่าน JSON ทั้งไฟล์แล้ว ไม่มีคอมเมนต์; deny และ ask เป็นค่ากำหนดสิทธิ์จริง
- [x] `.dockerignore`. reviewed. อ่าน 1-25. เสนอให้ลบ 0 ช่วง. เก็บคำเตือนเรื่อง build context และการกัน secrets ออกจาก image; รูปแบบ ignore เป็นคำสั่งของ Docker ไม่ใช่คอมเมนต์
- [x] `.editorconfig`. reviewed. อ่าน 1-12. เสนอให้ลบ 0 ช่วง. อ่านทั้งไฟล์แล้ว ไม่มีคอมเมนต์; root, wildcard และข้อยกเว้น Markdown เป็นค่าตั้งจริง
- [x] `.env.example`. reviewed. อ่าน 1-60. เสนอให้ลบ 5 ช่วง. ลบเฉพาะป้ายหมวดที่ชื่อ environment variables บอกอยู่แล้ว; เก็บคำเตือน production, secrets, RLS, SMTP, CORS, ค่าเริ่มต้นและวิธี override รวมถึงตัวอย่าง REDIS_KEY_PREFIX
- [x] `.github/workflows/ci.yml`. reviewed. อ่าน 1-312. เสนอให้ลบ 1 ช่วง. ลบสองบรรทัดที่บรรยาย coverage gate และ provenance; เก็บเหตุผล Linux/APFS, scanner version sync, การแยกฐานข้อมูลต่อ matrix, least-privilege และ Bun runtime รวมถึงคำเตือน OUTBOUND_TEST_ALLOWED_HOSTS ทั้งสองจุด
- [x] `.gitignore`. reviewed. อ่าน 1-9. เสนอให้ลบ 0 ช่วง. เก็บเหตุผลยกเว้น .env.example เพราะอธิบายความปลอดภัยของไฟล์ที่อนุญาตให้ติดตาม
- [x] `.gitleaks.toml`. reviewed. อ่าน 1-40. เสนอให้ลบ 1 ช่วง. ลบชื่อ baseline ที่ซ้ำ title; เก็บเงื่อนไข fail-closed และเหตุผลจำกัด allowlist ระดับ rule ด้วย path AND fixture line เพื่อไม่ยกเว้นทั้งไฟล์
- [x] `.gitleaksignore`. reviewed. อ่าน 1-21. เสนอให้ลบ 0 ช่วง. เก็บคำอธิบายทุก fingerprint เพราะระบุ false positive ในประวัติที่ไม่เขียนใหม่และห้ามยกเว้นทั้ง rule; commit references ผูกกับ fingerprint จริง
- [x] `.pi/settings.json`. reviewed. อ่าน 1-59. เสนอให้ลบ 0 ช่วง. อ่าน JSON ทั้งไฟล์แล้ว ไม่มีคอมเมนต์; tool allowlists, agent overrides และ skill paths เป็นค่าตั้งจริง
- [x] `.prettierignore`. reviewed. อ่าน 1-14. เสนอให้ลบ 0 ช่วง. เก็บข้อจำกัดภายนอกว่า Prettier ไม่มี parser สำหรับ shell scripts; รายการ path เป็นคำสั่ง ignore
- [x] `.semgrepignore`. reviewed. อ่าน 1-10. เสนอให้ลบ 0 ช่วง. เก็บที่มาของ registry packs จาก root security:sast ซึ่งอธิบายหน้าที่ของ ignore file เทียบกับแหล่ง ruleset
- [x] `bunfig.toml`. reviewed. อ่าน 1-3. เสนอให้ลบ 0 ช่วง. เก็บคำอธิบาย fail-closed dependency script policy และจุดอ้างอิงนโยบาย; ignoreScripts เป็นค่าตั้งจริง
- [x] `compose.worker.yaml`. reviewed. อ่าน 1-64. เสนอให้ลบ 0 ช่วง. เก็บขั้นตอนเข้าร่วม Compose project เดิมและคำเตือน NW_SLOT ผิด, dev image/key ห้ามใช้ร่วมกันหรือ production, เหตุผล init ส่ง signal ช่วง startup และ prerequisite ของ audit-exporter
- [x] `compose.yaml`. reviewed. อ่าน 1-56. เสนอให้ลบ 0 ช่วง. เก็บข้อจำกัด local-only, owner/runtime privilege, buffer memory, Mailpit loopback access control และ ephemeral Redis/tmpfs ที่สัมพันธ์กับ VOLUME ของ image
- [x] `package.json`. reviewed. อ่าน 1-55. เสนอให้ลบ 0 ช่วง. อ่าน JSON ทั้งไฟล์แล้ว ไม่มีคอมเมนต์; scripts, engines, workspaces และ overrides เป็นข้อมูลที่ใช้งานจริง
- [x] `scripts/db.mjs`. reviewed. อ่าน 1-116. เสนอให้ลบ 1 ช่วง. ลบเฉพาะรายการ root aliases ที่ package.json ประกาศอยู่แล้ว; เก็บ shebang, worktree isolation, สิทธิ์ runtime/owner, migration ownership และข้อห้าม commit development secrets; ข้อความ # ภายใน content เป็นข้อมูลที่เขียนลงไฟล์ ไม่ใช่คอมเมนต์ต้นฉบับ
- [x] `scripts/db/init/001-roles.sh`. reviewed. อ่าน 1-25. เสนอให้ลบ 0 ช่วง. เก็บ shebang, ข้อจำกัด NOBYPASSRLS/owner, lifecycle ของ docker-entrypoint-initdb.d และเหตุผลส่งค่าเป็น psql variables เพื่อรองรับ quote อย่างปลอดภัย
- [x] `scripts/dev-env.mjs`. reviewed. อ่าน 1-90. เสนอให้ลบ 1 ช่วง. ลบเกริ่นรายการ consumers และการแชร์ convention; เก็บกติกา precedence, blank values, เงื่อนไขไม่สร้าง production config, เหตุผลไม่สร้าง monitor keys/canary และ JSDoc @param/@returns/@type ทั้งหมด
- [x] `scripts/dev.mjs`. reviewed. อ่าน 1-43. เสนอให้ลบ 1 ช่วง. ลบเกริ่นที่ซ้ำ resolveDevEnv และ spawn turbo; เก็บคำสั่งเตรียม db:up และข้อจำกัด platform PORT เทียบกับ API_PORT ของ web proxy รวมถึง shebang
- [x] `scripts/e2e-database.mjs`. reviewed. อ่าน 1-184. เสนอให้ลบ 0 ช่วง. อ่านทั้งไฟล์แล้ว ไม่มี source comments; URL literals, SQL และ template strings ไม่ใช่คอมเมนต์ และ guard prepare/cleanup เป็นโค้ดจริง
- [x] `scripts/e2e.mjs`. reviewed. อ่าน 1-132. เสนอให้ลบ 0 ช่วง. อ่านทั้งไฟล์แล้ว มีเฉพาะ shebang ที่เป็น executable directive; URL strings และชื่อ stages ไม่ใช่คอมเมนต์
- [x] `scripts/env-file.mjs`. reviewed. อ่าน 1-32. เสนอให้ลบ 0 ช่วง. เก็บสัญญาของ parser ว่าไม่แก้ process.env และไม่รองรับ multiline รวมถึงรูปแบบ quoted values; # ที่ startsWith ตรวจเป็นข้อมูล input ไม่ใช่ source comment
- [x] `scripts/migrate.mjs`. reviewed. อ่าน 1-33. เสนอให้ลบ 1 ช่วง. ลบบรรทัดที่เรียกตัวเองว่า root wrapper และบอก import เดิม; เก็บ owner-before-app contract ของ CLI, เงื่อนไขขาด URL, วิธีเตรียม local database และ shebang
- [x] `scripts/partitions.mjs`. reviewed. อ่าน 1-95. เสนอให้ลบ 2 ช่วง. ลบรายการ environment/defaults ที่ซ้ำ intFromEnv/import และคำบรรยาย listing failure ที่ log บอกอยู่แล้ว; เก็บ DB-09, owner-only, retention/schedule, lock/rollback rationale และข้อจำกัด SET ไม่รับ parameters
- [x] `scripts/ports.d.mts`. reviewed. อ่าน 1-16. เสนอให้ลบ 0 ช่วง. อ่าน declaration ทั้งไฟล์แล้ว ไม่มีคอมเมนต์; WorktreePorts และ signatures เป็น type contract จริง
- [x] `scripts/ports.mjs`. reviewed. อ่าน 1-73. เสนอให้ลบ 2 ช่วง. ลบเกริ่นเรื่องผู้ใช้ port allocator และข้อความ override ที่ resolvePorts แสดงชัด; เก็บ hash collision/strict ports, เหตุผลหลบ system service ports และวิธีใช้ CLI
- [x] `scripts/provision.mjs`. reviewed. อ่าน 1-51. เสนอให้ลบ 2 ช่วง. ลบตัวอย่าง invocation ที่ซ้ำ usage และคำบรรยาย forwarding ที่ซ้ำ spread args; เก็บ OrgAccess ownership, invitation-only/no-password contract, pre-tenant owner role และ SMTP prerequisites รวมถึง shebang
- [x] `scripts/quality/candidate-manifest.mjs`. reviewed. อ่าน 1-211. เสนอให้ลบ 0 ช่วง. อ่านทั้งไฟล์แล้ว ไม่มี source comments; regexp ของ path normalization และ Git command arrays เป็นโค้ดจริง
- [x] `scripts/quality/candidate-manifest.test.mjs`. reviewed. อ่าน 1-254. เสนอให้ลบ 0 ช่วง. อ่านทั้งไฟล์แล้ว ไม่มี source comments; ข้อจำกัด APFS อยู่ใน skip reason ที่ใช้งานจริง และ fixture paths/strings เป็นข้อมูลทดสอบ
- [x] `scripts/quality/check-agent-config.mjs`. reviewed. อ่าน 1-325. เสนอให้ลบ 1 ช่วง. ลบคำบรรยายนโยบาย flow/worker/leaf ที่เงื่อนไขและข้อความ error ระบุอยู่แล้ว; regexp, fenced-code markers และรูปแบบ agent:/skill: เป็นโค้ดหรือข้อมูล ไม่ใช่คอมเมนต์
- [x] `scripts/quality/check-agent-config.test.mjs`. reviewed. อ่าน 1-355. เสนอให้ลบ 0 ช่วง. อ่านทั้งไฟล์แล้ว ไม่มี source comments; Markdown headings, frontmatter และ fenced examples ทั้งหมดอยู่ใน fixture strings ไม่ใช่คอมเมนต์ที่ลบได้
- [x] `scripts/quality/dev-env.test.mjs`. reviewed. อ่าน 1-352. เสนอให้ลบ 0 ช่วง. เก็บสองบรรทัดเรื่อง private dependency copies เพราะกำหนดขอบเขต fixture ว่าหยุดก่อน driver/service/application writes; URL และโค้ด sentinel ใน template strings เป็นข้อมูลทดสอบ
- [x] `scripts/quality/e2e-runner.test.mjs`. reviewed. อ่าน 1-158. เสนอให้ลบ 0 ช่วง. อ่านทั้งไฟล์แล้ว ไม่มี source comments; shebang ใน fake executable template เป็นข้อมูล fixture และ URL literals ไม่ใช่คอมเมนต์
- [x] `scripts/quality/monitor-checks.test.mjs`. reviewed. อ่าน 1-113. เสนอให้ลบ 0 ช่วง. อ่านทั้งไฟล์แล้ว ไม่มี source comments; matrix labels, URLs และ child program ใน template string เป็นข้อมูลทดสอบ
- [x] `scripts/quality/verification-scripts.test.mjs`. reviewed. อ่าน 1-90. เสนอให้ลบ 0 ช่วง. อ่านทั้งไฟล์แล้ว ไม่มี source comments; secret-like fixture values และ log contents เป็นข้อมูล assertions ไม่ใช่คอมเมนต์
- [x] `scripts/quality/worker-container-entrypoint.test.mjs`. reviewed. อ่าน 1-84. เสนอให้ลบ 0 ช่วง. อ่านทั้งไฟล์แล้ว ไม่มี source comments; bundle fixture กับ refusal messages เป็นข้อมูลทดสอบ production entrypoint
- [x] `scripts/seed.mjs`. reviewed. อ่าน 1-40. เสนอให้ลบ 0 ช่วง. อ่านทั้งไฟล์แล้ว มีเฉพาะ shebang ที่ต้องเก็บเป็น executable directive; ข้อจำกัด local Compose และสรุป seed เป็นโค้ด/ข้อความ runtime
- [x] `scripts/verification/distroless-runtime.test.mjs`. reviewed. อ่าน 1-516. เสนอให้ลบ 0 ช่วง. เก็บ JSDoc @typedef ImageSet และ @type ที่กำหนดชนิดใน JavaScript; อ่านส่วน fixtures และ assertions ทั้งไฟล์แล้ว ไม่มี prose comments อื่นให้ลบ
- [x] `scripts/verification/e2e-isolation.test.mjs`. reviewed. อ่าน 1-194. เสนอให้ลบ 0 ช่วง. อ่านทั้งไฟล์แล้ว ไม่มี source comments; SQL, Redis keys และ URL strings เป็นข้อมูลทดสอบ isolation ไม่ใช่คอมเมนต์
- [x] `turbo.json`. reviewed. อ่าน 1-52. เสนอให้ลบ 0 ช่วง. อ่าน JSON ทั้งไฟล์แล้ว ไม่มีคอมเมนต์; $schema URL และ task/env declarations เป็นค่าตั้งจริง

## ยังไม่เสนอให้ลบเพราะต้องยืนยันความหมาย

พบ 21 ข้อสังเกตที่ถ้อยคำอาจไม่ตรงกับ implementation หรืออาจมีความหมายเฉพาะ. รายการนี้ไม่ใช่คำอนุญาตให้ลบหรือแก้ logic. เก็บ comment เหล่านี้ไว้ก่อน.

- [ ] ยืนยันความหมายก่อนแก้. apps/api/src/audit/read.db.test.ts:37 ระบุ default now() แต่ seed ที่บรรทัด 46 ใช้ clock_timestamp(); uncertain ด้านความถูกต้องของข้อความ จึงไม่อยู่ใน deletion checklist
- [ ] ยืนยันความหมายก่อนแก้. apps/api/src/auth/member-race.ts:59-61 อ้าง Better Auth 1.6.23 แต่ apps/api/package.json:24 ใช้ 1.7.7; ยังไม่มีหลักฐานว่า race constraint หมดไป ต้องเก็บ rationale
- [ ] ยืนยันความหมายก่อนแก้. apps/api/src/monitors/test-route.ts:348-352 เป็น certificate JSDoc เหนือ diagnosticsOf:353-365 แต่ sslOfCheck:367-397 เป็นผู้คืน certificate facts; uncertain ด้านตำแหน่ง ไม่แนะนำลบ platform rationale
- [ ] ยืนยันความหมายก่อนแก้. apps/api/src/organization-notifications/routes.ts:52 อ้าง malformed encoding matches nothing แต่ :54-58 ยัง normalize path ต่อ; uncertain ด้านถ้อยคำ ไม่ใช่ deletion candidate
- [ ] ยืนยันความหมายก่อนแก้. apps/api/src/rate-limit/limiter.db.test.ts:103 บอกเหลือ 30 s แต่ :98-105 เลื่อนเวลาเพิ่มและ assert retryAfterSeconds:29; uncertain ด้านเลขอธิบาย ไม่แนะนำลบแทนการแก้ข้อความ
- [ ] ยืนยันความหมายก่อนแก้. apps/web/src/components/ui/response-time-chart.test.tsx:889 uncertain ถ้อยคำช่วง fresh ไม่ตรงกับ fixture ที่มีจุด 11:55 ไม่เสนอ deletion
- [ ] ยืนยันความหมายก่อนแก้. apps/web/src/lib/api/projects.ts:37 uncertain คำว่า search ไม่อยู่ใน key อาจหมายเฉพาะ list เพราะ candidates key ที่ 56-57 มี q ไม่เสนอ deletion
- [ ] ยืนยันความหมายก่อนแก้. apps/web/src/router.tsx:152 uncertain No loader gate อาจหมายไม่มี generic gate แต่ route มี verifyEmailLoader ที่ 155 ไม่เสนอ deletion
- [ ] ยืนยันความหมายก่อนแก้. apps/web/vite.config.ts:12 uncertain ข้ออ้างไม่มี manual useMemo/useCallback ไม่ตรงกับ apps/web/src/components/ui/response-time-chart.tsx:78 และ shell/usePopover.ts:73 ไม่เสนอ deletion
- [ ] ยืนยันความหมายก่อนแก้. apps/web/src/pages/ForgotPasswordPage.tsx uncertain: คำว่า Always show the same confirmation อยู่หน้า requestError ที่แสดง error จึงไม่เสนอให้ลบเหตุผลป้องกัน enumeration จากการคาดเดา
- [ ] ยืนยันความหมายก่อนแก้. apps/web/src/pages/audit-log/exports.ts uncertain: failureText ระบุ Any other code แต่ชนิดรับเฉพาะ known code หรือ null
- [ ] ยืนยันความหมายก่อนแก้. apps/web/src/pages/monitors/OverviewPage.test.tsx uncertain: คำว่า visible count follows data ที่ 1755 มี assertion ตรวจเพียง existence
- [ ] ยืนยันความหมายก่อนแก้. apps/web/src/pages/monitors/form/MonitorForm.tsx uncertain: 206 กล่าวเพียง page/switch แต่ predicate รวม membership/role และ 228 กล่าวว่า every render ทั้งที่ใช้ useMemo
- [ ] ยืนยันความหมายก่อนแก้. apps/web/src/pages/monitors/form/controls.tsx uncertain: onType doc บอกส่ง path แต่ type และ call ไม่มี argument
- [ ] ยืนยันความหมายก่อนแก้. apps/web/src/pages/projects/ProjectsPage.tsx uncertain: 219 บอก refetch ไม่เปลี่ยน announcement แต่ effect ขึ้นกับ projects/visible.length
- [ ] ยืนยันความหมายก่อนแก้. apps/web/src/pages/settings/MfaCard.tsx uncertain: 112 กล่าวว่า QR never stored แต่มี setQr เก็บใน component state น่าจะหมายถึงไม่ persist
- [ ] ยืนยันความหมายก่อนแก้. uncertain packages/api-contract/src/monitor.ts:115 อ้าง refinements above แต่ refineMonitorConfig/refineSecretEntries อยู่ด้านล่าง ไม่ใช่ deletion candidate
- [ ] ยืนยันความหมายก่อนแก้. uncertain packages/db/src/audit-events.ts:149 อ้าง see below แต่ fixed-window rationale อยู่บรรทัด 134-142 ไม่เสนอแก้ wording ในงานนี้
- [ ] ยืนยันความหมายก่อนแก้. uncertain packages/db/src/client.ts:11 Process-wide อาจเป็น lifecycle convention ของ caller แต่ createDatabase สร้าง Pool ใหม่ทุกครั้ง เก็บไว้จนตรวจ caller contract
- [ ] ยืนยันความหมายก่อนแก้. uncertain packages/db/tests/monitor.db.test.ts:668 rationale timeout at or above interval ไม่ตรงกับ assertion timeout_seconds=0 ที่บรรทัด 669-670 ไม่ลบบนสมมติฐาน
- [ ] ยืนยันความหมายก่อนแก้. uncertain packages/shared/src/monitor-check/run-check.ts:127 keeps no body อาจหมายถึง raw body แต่ CheckResult.responseSnapshot เก็บ redacted body ได้ที่ packages/shared/src/monitor-check/snapshot.ts:138-161 และ packages/shared/src/monitor-check/run-check.ts:234-252 เก็บ security rationale ไว้

## ข้อเสนอที่ตรวจแล้วให้เก็บ

- `apps/web/src/components/shell/useNavCounts.ts:14-14`. เก็บสัญญาการแชร์ query ระหว่าง bell badge และ inbox nav row. ชื่อ useUnreadCount กับ useQuery ภายในบอกการดึง count แต่ไม่บอกเจตนาให้สอง consumer ใช้ query เดียวกัน.
- `apps/web/src/pages/audit-log/AuditTable.tsx:24-24`. เก็บเหตุผลที่ทำตารางเฉพาะแทน DataTable กลาง. AuditTable มี caption ที่ 57-59 แต่ DataTable ไม่มี caption prop ใน signature ที่ apps/web/src/components/ui/data-table.tsx:32-47. การเห็น caption ใน markup เพียงอย่างเดียวไม่อธิบายการเลือก component.
- `apps/worker/Dockerfile:20-20`. เก็บข้อกำหนดของ bundle ว่าไม่ต้องมี dependency imports ยกเว้น node builtins ใน runtime. คำสั่ง bun run build ไม่ได้แสดงรูป import ที่เหลือใน artifact โดยตรง และ runtime stage copy เฉพาะ dist.
- `e2e/support/monitor-fixtures.ts:173-173`. เก็บคำอธิบายการกลืน JSON parse failure โดยตั้งใจและคืน raw text. นี่เป็นข้อความเดียวใน catch ของ E2E API fixture ที่รองรับ response ที่ไม่ใช่ JSON ไม่ใช่เพียง phase label.

## ผลการดำเนินการตาม checklist

- [x] ลบ D001 ถึง D168 รวม 258 บรรทัด comment ใน 107 ไฟล์. เก็บ 21 ข้อสงสัยและ 4 ข้อเสนอที่ตรวจแล้วให้เก็บ.
- [x] ตรวจรวมกับ cleanup รอบแรก 164 ไฟล์. Syntax tree, JavaScript ที่ emit และ directives ของเครื่องมือไม่เปลี่ยนจาก HEAD `6ce4e0e47ec6cd8e20d9f5ef25cdd3e88e3a5916`.
- [x] Prettier ผ่านสำหรับไฟล์ที่แก้ทั้งหมด. ลบบรรทัดว่างที่เหลือหลัง comment ใน `apps/api/src/monitors/read-event-feed.db.test.ts` ให้ตรงรูปแบบเดิม.
- [x] ตรวจ `git diff --check` และ checkbox D001 ถึง D168.
- ขอบเขต commit รวม cleanup รอบแรก รอบสอง และ checklist นี้. ไม่รวมการลบ test จากภายนอกหรือ cache ใน `.vitest`.

## ข้อจำกัดและการตรวจยืนยัน

- ตรวจ manifest ครบทุก path และไม่มีรายการซ้ำ.
- ตรวจ SHA-256 กับ working tree และตรวจข้อความทุกช่วงที่เสนอให้ลบกับบรรทัดจริง.
- ตรวจช่วงที่อ่านกับ TypeScript parser ใน source 573 ไฟล์ รวม comment ranges 2843 ช่วง. ไม่มี comment range อยู่นอกช่วงที่บันทึกว่าอ่าน.
- ตรวจบรรทัดลักษณะ comment ใน configuration และ source อื่นด้วย. Parent อ่าน SQL comments ใน template strings ของ `apps/api/src/monitors/service.ts` และ `apps/api/src/monitors/write-lifecycle.db.test.ts` เพิ่มแล้วและให้เก็บ.
- ไม่รัน tests, build หรือ runtime เพราะไม่มีการเปลี่ยน executable code ในงานนี้.
- ไม่แตะการลบ `apps/api/src/organization-notifications/service.test.ts` ที่เกิดจากภายนอก.

## หลักการที่ใช้ตัดสินใจ

- Laziness Protocol จำกัดข้อเสนอเป็นการลบ comment โดยไม่เสนอ refactor เพิ่ม.
- Guard the Context Window แยกการอ่านตาม owning module แล้วรวมหลักฐานรายไฟล์ไว้ใน checklist นี้.
- Model the Domain ใช้ทะเบียน path, hash, สถานะ และช่วงที่อ่าน เพื่อตรวจไฟล์ตกหล่นและขอบเขตข้อเสนอ.
- Prove It Works ตรวจข้อความ บรรทัด ขอบเขตไฟล์ และ hash จริงก่อนยอมรับรายการ.
