# Issue #60 Technical Spec: ตั้งค่าการแจ้งเตือนราย monitor

Owner: Technical Lead spec นี้ได้รับอนุมัติแล้ว จึงเป็น source of truth ของ implementation และ review

| Field                | Value |
| -------------------- | ----- |
| Issue                | [#60](https://github.com/nixbpe/new-nightwatch/issues/60) ต่อยอด F-005 (`docs/features/F-005-uptime-monitor/`) |
| Feature              | None (ข้ามขั้นตอน Product Owner ตามคำสั่งผู้ใช้สำหรับ issue #60), `acceptanceVersion` `issue-60-AC-1` |
| Epic                 | None |
| Status               | Approved |
| Approved by user     | 2026-10-05 (ยืนยัน OD-60-01 ถึง 07 และอนุมัติ spec พร้อม freeze) |
| Start authorization  | 2026-10-05, `/implement-issue` ("issue 60 ตาม spec และให้ commit mode = owned-slice") |
| `COMMIT_MODE`        | owned-slice |
| `STOP_AT`            | merge-ready |

ป้ายในวงเล็บ: [ตรวจแล้ว] คือสิ่งที่อ่านใน code หรือเอกสาร ณ 2026-10-05 บน branch `nixbpe/feature-monitor` [สมมติฐาน] คือสิ่งที่ยังไม่ได้พิสูจน์ เนื้อหา issue มาจาก team-lead (Technical Lead ไม่ได้เปิด `gh` เอง) canvas ใน issue เป็นข้อมูลตัวอย่าง spec นี้ไม่ใช้ตัวเลข 14 และ 3 วันจาก canvas

contract ใน spec นี้ตรงกับ Decisions OD-60-01 ถึง OD-60-07 ที่ยืนยันแล้ว 2026-10-05 ส่วนที่ขึ้นกับ OD ระบุเลข OD กำกับไว้ ผู้ใช้อนุมัติ spec นี้ 2026-10-05 freeze ที่ `issue-60-AC-1` เหลือเฉพาะ `UX-60-01` และ `UX-60-02` เปิดอยู่แบบไม่บล็อก freeze (gate ไว้ที่ READY ของ `NODE-60-05`)

## ข้อขัดกับ contract เดิม

F-005 (`F-005-AC-1`) ตรึงค่าที่ issue นี้ต้องการให้ตั้งได้ งานนี้ไม่แก้ไฟล์ของ F-005 ตามแบบ #58 ผู้ใช้อนุมัติ spec นี้ (`issue-60-AC-1`) แล้ว จึง supersede AC เหล่านี้เฉพาะ monitor ที่ตั้งค่าต่างจากค่าเริ่มต้น

| ข้อขัด [ตรวจแล้ว] | OD ที่ตัดสิน |
| --- | --- |
| F-005 AC-13 (`feature.md:488`) health เป็น "ล่ม" และเปิด incident เมื่อล้มเหลวติดกัน 2 ครั้ง, Health model (`feature.md:69`) | OD-60-02, OD-60-03 |
| F-005 AC-51 (`feature.md:526`) incident ใหม่ตามเกณฑ์ล้มเหลวติดกัน 2 ครั้ง | OD-60-02 |
| F-005 AC-05 (`feature.md:480`) และ Health model (`feature.md:85`) ระดับ SSL ที่ 30 และ 7 วัน `feature.md:85` ระบุว่าตัวเลข threshold มาจากผู้ใช้ ห้ามตั้งเอง | OD-60-04, OD-60-05 |
| F-005 AC-36 (`feature.md:511`) notification SSL ใช้ขอบเดียวกับ AC-05 (30 และ 7 วัน) | OD-60-04, OD-60-05 |
| F-005 spec OD-16 (`spec.md:113,171,284`) toggle เดียว `monitorAlertsEnabled` ระดับองค์กร ค่าเริ่มต้นเปิด | OD-60-01 |
| F-007 `AuditChangeField` (`docs/features/F-007-organization-audit-log/spec.md:62`) และตารางป้าย (`F-007 feature.md:119`) | additive: เพิ่มสี่ field ตาม API ไม่เปลี่ยน field เดิม ผู้ใช้อนุมัติแล้วพร้อม spec นี้ |
| #58 ตาราง `changes[]` (`docs/features/issue-58-monitor-event-feed/spec.md`, Data) | additive: เพิ่มสี่แถวตาม Data ไม่เปลี่ยน shape ผู้ใช้อนุมัติแล้วพร้อม spec นี้ |

## สภาพ code ที่ spec นี้ต่อยอด [ตรวจแล้ว]

เลขบรรทัดใน issue บางจุดเลื่อนแล้ว ตารางนี้ใช้เลขบรรทัดปัจจุบัน

| เรื่อง | สภาพปัจจุบัน | ผลต่อ #60 |
| --- | --- | --- |
| เกณฑ์เปิด incident | `nextState` ใน `apps/worker/src/monitor/record-result.ts:438-444` เปิดเมื่อ `failures >= 2 && !incidentOpen` | อ่านเกณฑ์จาก monitor ที่ lock ไว้ (`LockedMonitor`, 67-76) |
| Health | `computeHealth` (`apps/api/src/monitors/health.ts:39-75`) "ล่ม" = มี incident เปิด (65) และ "ปกติ" เมื่อ `consecutiveFailures === 1 && passedInCurrentConfig` (70) | เงื่อนไขที่ 70 ต้องใช้เกณฑ์ของ monitor (OD-60-02) |
| ค่าคงที่ฝั่ง web | `DOWN_AFTER_FAILURES = 2` ที่ `apps/web/src/pages/monitors/detail/labels.ts:12` (issue อ้าง `:8`) ใช้ใน `StatusCard.tsx:172` | อ่านจาก record ของ monitor แทน |
| Notification ล่มและกลับมาปกติ | `writeMonitorNotification` (`apps/worker/src/monitor/notifications.ts:31-70`) `MONITOR_DOWN` ตอน `incident_opened` เมื่อ `monitorAlertsEnabled` และตั้ง `down_notified = true` (41-53) `MONITOR_RECOVERED` เฉพาะ `downNotified` และ `recovered` และ toggle เปิดตอนปิด (56-66) องค์กรที่ไม่มีแถว settings ถือว่าเปิด (72-83) | เพิ่ม toggle ราย monitor ในเงื่อนไขเดียวกัน |
| Notification SSL | `writeSslNotification` (`notifications.ts:85-122`) ส่งเมื่อระดับแย่ลงต่อใบรับรอง (host, `not_after`) และเลื่อน `ssl_notified_level` แม้ toggle ปิด (106-121) กัน replay เมื่อเปิดกลับ event มาจาก `nextSsl` (`record-result.ts:323-412`) ที่ใช้ `sslLevel` | เพิ่ม toggle และจำนวนวันราย monitor |
| สูตรระดับ SSL | `sslLevel` (`packages/shared/src/monitor-check/ssl-level.ts:10-21`) ตายตัว 7 และ 30 วัน ใช้ที่ Worker (`record-result.ts:338`), ระดับที่แสดง (`health.ts:105`) และ Test (`apps/api/src/monitors/test-route.ts:366`) | OD-60-05 กำหนดว่าตัวไหนเปลี่ยน |
| Recent events ของ SSL | `SSL_LEVEL_LEAD_DAYS` ที่ `apps/api/src/monitors/read-service.ts:639` (issue อ้าง `:614`) ย้อนเวลาเข้าระดับ (`sslEnteredAt`, 641-662) | คงเดิม (OD-60-05 (a)) |
| ข้อความ inbox | `apps/web/src/pages/NotificationsPage.tsx:62,64` เขียน "เหลือไม่เกิน 30 วัน" และ "เหลือไม่เกิน 7 วัน" ตายตัว item มีเพียง `sslNotAfter` (`packages/api-contract/src/notification.ts:77-86`) | ข้อความตายตัวจะผิดเมื่อจำนวนวันตั้งได้ |
| Toggle ระดับองค์กร | `organizationNotificationSettingsSchema.monitorAlertsEnabled` (`notification.ts:159-164`, issue อ้าง `148-153`) column `notification_org_settings.monitor_alerts_enabled` (`0017_monitor_notifications.sql:100`) | คงเดิม (OD-60-01 (a)) |
| Config contract | `monitorConfigBaseSchema` เป็น `z.strictObject` (`packages/api-contract/src/monitor.ts:340-366`) Create, Edit และ Test ทั้งสองแบบ extend จาก base (641-677) `monitorRecordSchema` (758-783) คือสิ่งที่ทุก role อ่าน | เพิ่ม object `alerts` พร้อม default |
| Edit | `editMonitor` (`apps/api/src/monitors/service.ts:426-579`) `sameConfig` เทียบทั้ง `StoredConfig` (`record.ts:163-165`) `affectsChecks` เป็น whitelist ของ field ที่กระทบการตรวจ (`record.ts:167-196`) `impacted` รีเซ็ต `consecutive_failures` (`service.ts:491-492`) เขียน `config_changed` พร้อม `diffConfig` (`config-changes.ts:150`) และ audit ผ่าน `monitorAuditChanges` (`audit.ts:172`) | field ใหม่เข้า `StoredConfig` แต่ไม่เข้า `affectsChecks` |
| Audit log | `AUDIT_CHANGE_FIELDS` (`packages/api-contract/src/audit-log.ts:71-89`) ป้ายใน `apps/web/src/pages/audit-log/labels.ts:51` migration `0020` และ `0021` ไม่มี CHECK ของชื่อ field (grep `apiKeyHeaderName`, `intervalSeconds` ไม่พบ) | เพิ่ม field ใน enum ไม่ต้องแก้ DB |
| Form | `AlertsSection.tsx` เป็น step การแจ้งเตือนอยู่แล้ว (`MonitorForm.tsx:472-473`, code `05` หรือ `02`) มี mockup ของ issue 60 ใน `MockupFrame` (48-71): select 1/2/3 ครั้ง และ checkbox สองตัว ที่ disabled | แทน mockup ด้วย control จริง (ตำแหน่ง select ดู UX-60-01) |
| Migration ล่าสุด | `0021_audit_exports.sql` | #60 จอง `0022` [สมมติฐาน: branch อื่นอาจจองเลขเดียวกัน ต้องตรวจตอน rebase] |

## Contracts

### API

ไม่มี route ใหม่ ทุกการเปลี่ยนอยู่ใน schema เดิมของ `packages/api-contract/src/monitor.ts` (REQ-02)

- **`alerts` ใน `monitorConfigBaseSchema`** (ข้อเสนอ):

  ```ts
  alerts: z.strictObject({
    failureThreshold: z.number().int().min(1).max(3).default(2),       // OD-60-02, OD-60-03
    downEnabled: z.boolean().default(true),                             // OD-60-01
    sslEnabled: z.boolean().default(true),                              // OD-60-01
    sslCautionDays: z.number().int().min(8).max(30).default(30),        // OD-60-04
  }).default({ failureThreshold: 2, downEnabled: true, sslEnabled: true, sslCautionDays: 30 })
  ```

  - ช่วง `failureThreshold` 1 ถึง 3 (OD-60-03) และ `sslCautionDays` 8 ถึง 30 (OD-60-04) ผู้ใช้กำหนดเมื่อ 2026-10-05 ตาม `F-005 feature.md:85`
  - `sslCautionDays` เป็น field เดียวแทนขอบ caution ขอบ danger 7 วันคงเดิม (OD-60-04 (a))
  - default ทั้งหมดเท่าพฤติกรรมวันนี้ Create และ Test ที่ไม่ส่ง `alerts` ได้ค่า default
  - **Edit ที่ไม่ส่ง `alerts` คงค่าที่บันทึกไว้**: `monitorEditSchema` ใช้ `alerts` แบบ optional ที่ไม่มี default (ส่งมาต้องครบทั้ง object) กันการรีเซ็ตค่าที่ตั้งไว้จาก client เก่า เช่น SPA tab ที่ค้างระหว่าง deploy field อื่นของ Edit คงแบบแทนทั้งชุดเดิม
  - ค่านอกช่วงคืน `400 MONITOR_INVALID` field `alerts.failureThreshold` หรือ `alerts.sslCautionDays` reason `out_of_range` ผ่าน `monitorIssueReason` เดิม (`too_small`/`too_big` ของ number เป็น `out_of_range`, `monitor.ts:137-141`) ชนิดผิดเป็น `invalid_format`
- **Test (`POST /monitors/test`)**: schema ของ Test extend base จึงรับ `alerts` และไม่ใช้ค่า (ผล Test ไม่เปิด incident และไม่ส่ง notification)
- **`monitorRecordSchema`**: เพิ่ม `alerts` แบบไม่ optional ทุก role ที่มี `read` เห็นค่า (story ของ viewer) Detail (`monitorSchema`) ได้ field นี้ผ่าน `extend` List ไม่เพิ่ม
- **Create และ Edit**: บันทึก `alerts` ใน transaction เดิม Edit ที่เปลี่ยนเฉพาะ `alerts` คืน `changed: true` เพิ่ม `version` และไม่เพิ่ม `check_config_version`
- **`monitorConfigChangeSchema`** ไม่เปลี่ยน shape `changes[]` เพิ่มแถวตาม Data
- **`AUDIT_CHANGE_FIELDS`**: เพิ่ม `alertFailureThreshold`, `alertDownEnabled`, `alertSslEnabled`, `alertSslCautionDays` ค่าเดิม/ค่าใหม่เป็น number หรือ boolean ตามชนิด (`monitorAlertsEnabled` เป็น boolean อยู่แล้ว)
- **Notification contract** (`notification.ts`) ไม่เปลี่ยน event type หรือ shape

### Data

Migration `0022_monitor_alert_settings.sql` ตาม DB-11, DB-12 Drizzle schema แก้ใน `packages/db/src/schema.ts`

| Table | การเปลี่ยน | RLS และ grants |
| --- | --- | --- |
| `monitors` | เพิ่ม `alert_failure_threshold smallint not null default 2 check (alert_failure_threshold between 1 and 3)`, `alert_down_enabled boolean not null default true`, `alert_ssl_enabled boolean not null default true`, `alert_ssl_caution_days smallint not null default 30 check (alert_ssl_caution_days between 8 and 30)` แถวเดิมได้ค่า default จึงทำงานเหมือนวันนี้ | policy เดิมของ `monitors` ครอบ column ใหม่ grant ของ `nightwatch` คงเดิม [สมมติฐาน: grant ของ `monitors` เป็นระดับตาราง ไม่ใช่ระดับ column ผู้ทำ NODE-60-01 ตรวจใน `0016` ก่อนเขียน migration] |

- **`changes[]` ของ `config_changed`** (ตารางใน `docs/features/issue-58-monitor-event-feed/spec.md`, Data) เพิ่ม:

| `field` | `kind` | ชนิดของ `before`, `after` |
| --- | --- | --- |
| `alerts.failureThreshold`, `alerts.sslCautionDays` | `value` | `number` |
| `alerts.downEnabled`, `alerts.sslEnabled` | `value` | `'enabled' \| 'disabled'` (schema เดิมรับ `string \| number` ไม่ต้องแก้ union ใน contract ของ #58) |

### Jobs

ไม่มี queue หรือ job ใหม่ งานอยู่ใน transaction B เดิม (`record-result.ts`) ตาม Decisions

- **Health** (OD-60-02 (a), แก้ตาม M-01 ด้านล่าง): `computeHealth` (`health.ts`) เป็น "ปกติ" เมื่อ `latest.outcome === 'pass'` หรือ `consecutiveFailures >= 1 && passedInCurrentConfig` ไม่มีขอบบนเทียบกับ `alertFailureThreshold` เพราะ Worker เปิด incident ในธุรกรรมเดียวกับที่ `consecutiveFailures` ถึงเกณฑ์เสมอ `hasOpenIncident` จึงครอบ "ล้มถึงเกณฑ์" ไว้แล้วทุกกรณีที่เกิดจากผลตรวจจริง การเทียบเกณฑ์ซ้ำในจุดนี้ทำให้ Edit ที่ลดเกณฑ์อย่างเดียวพลิกเป็น "ไม่ทราบสถานะ" ก่อนมีผลตรวจใหม่ ขัดกับ P60-06 "ล่ม" ยังเท่ากับมี incident เปิด ข้อความ "ล้มเหลว N ครั้ง" ใน web ใช้ค่าจริงอยู่แล้ว (`StatusCard.tsx:169`, `MonitorTable.tsx:61`)
- **เกณฑ์ล้มเหลว** (OD-60-02 (a)): `LockedMonitor` อ่าน `alert_failure_threshold` ใต้ `FOR UPDATE` เดิม `nextState` เปิด incident เมื่อ `failures >= alert_failure_threshold && !incidentOpen` เกณฑ์ 1 ทำให้ผล `fail` แรกเขียนทั้ง `check_failed` และ `incident_opened` ในผลเดียว (`check_failed` เขียนก่อน, 175-199) `check_error` ไม่นับ (AC-39 เดิม)
- **Toggle ล่ม/กลับมาปกติ** (OD-60-01 (a)): `incident_opened` ส่ง `MONITOR_DOWN` เมื่อ `monitorAlertsEnabled` และ `alert_down_enabled` เป็นจริงทั้งคู่ incident เปิดเสมอไม่ขึ้นกับ toggle `MONITOR_RECOVERED` ส่งเมื่อ `downNotified` และทั้งสอง toggle เป็นจริงตอนปิด ผลที่ยอมรับ: เปิด toggle ระหว่าง incident ที่ไม่เคยส่ง "ล่ม" จะไม่ได้ "กลับมาปกติ" ของ incident นั้น ค่า toggle ส่งเข้า hook ผ่าน `MonitorEvent` จากแถวที่ lock แล้ว ไม่ query ซ้ำ
- **Toggle SSL** (OD-60-01 (a)): ส่งเมื่อ `monitorAlertsEnabled` และ `alert_ssl_enabled` เป็นจริง `ssl_notified_level` และ `ssl_notified_not_after` เลื่อนเสมอแม้ toggle ปิด เหมือน `notifications.ts:106-121` เปิดกลับจึงไม่ replay ระดับเก่า
- **จำนวนวัน SSL** (OD-60-04 (a), OD-60-05 (a)): ระดับสำหรับ notification คำนวณด้วย helper ใหม่ใน `packages/shared/src/monitor-check/ssl-level.ts` เช่น `sslNotifyLevel(notAfter, now, cautionDays)` ที่ใช้ขอบ caution จาก monitor ขอบ danger 7 วันและ expired คงเดิม `sslLevel` และ `ssl_state` ที่แสดงคงเดิม (30 และ 7 วัน) `nextSsl` ใช้ helper ใหม่ตัดสิน event และใช้ `sslLevel` ตัดสิน `state` ต่อไป กติกาไม่ส่งซ้ำ, ข้ามระดับ และต่ออายุตาม AC-36 คงเดิม
- **`NeedsMembershipLock`** (`record-result.ts:150`): trigger คงเดิม (มี `next.event` หรือ `ssl.event`) toggle ที่ปิดไม่ลดการ lock เพราะ event ยังเกิดและต้องเลื่อน `ssl_notified_*`

### Web

- **Form** (`apps/web/src/pages/monitors/form/`): `AlertsSection.tsx` แทน `MockupFrame` ของ issue 60 ด้วย control จริงที่ผูกกับค่า form (ตำแหน่งยืนยันแล้ว `UX-60-01`: อยู่ใน `AlertsSection.tsx` ไม่ใช่ `BasicSection.tsx` เพราะเป็น object `alerts` เดียวกันและ `AlertsSection` render ทั้งสองโหมด basic/advanced อยู่แล้ว): select "แจ้งเมื่อล้มเหลวติดกัน" (option 1, 2, 3 ครั้ง ตาม OD-60-03, label เดิมตาม P60-01 ไม่เปลี่ยน) พร้อม `aria-describedby` ว่า "ค่านี้ใช้ตัดสินว่ามอนิเตอร์ล่มด้วย แม้ปิด 'แจ้งเมื่อล่มและกลับมาปกติ'" (เพราะ OD-60-02 (a) ผูกเกณฑ์นี้กับนิยาม "ล่ม" เสมอ ไม่ขึ้นกับ toggle การแจ้ง) select enable อิสระ ไม่ซ้อนใต้ checkbox ใด, checkbox "แจ้งเมื่อล่มและกลับมาปกติ", checkbox "แจ้งเมื่อ SSL ใกล้หมดอายุ" และช่องจำนวนวัน (8 ถึง 30) ที่ disabled เมื่อ checkbox SSL ปิด ข้อความเดิมเรื่อง `monitorAlertsEnabled` (41-47) คงไว้ และเมื่อ toggle องค์กรปิดแสดงข้อความยืนยันแล้ว (`UX-60-02` (ข)): "ปิด การแจ้งเตือนของมอนิเตอร์นี้จะไม่ทำงานจนกว่าจะเปิด ส่วนสถานะล่มและการนับเกณฑ์ล้มเหลวยังทำงานตามปกติ" error ของ field ใช้ `monitorIssueReason` เดิม
  - **`BasicSection.tsx`**: ลบการ import และแสดง `DOWN_AFTER_FAILURES` (`:7,104-106`) เปลี่ยนไปอ่าน `values.alerts.failureThreshold` ที่มีใน `FormValues`/`SectionProps` อยู่แล้ว ไฟล์นี้ต้องแก้เสมอ ไม่ขึ้นกับ `UX-60-01` (`DOWN_AFTER_FAILURES` ถูกลบออกจาก `detail/labels.ts` ไม่ว่ากรณีใด)
- **Detail**: Card ใหม่แยกต่างหากชื่อ "การแจ้งเตือน" ในคอลัมน์ aside (ไม่ต่อท้าย `StatusCard`) วางระหว่าง `ConfigCard` กับ `SslCard` ไม่มีเลข section code (เหมือน `ConfigCard`/`SslCard`) ตำแหน่งยืนยันแล้ว (`UX-60-02` (ก)) เหตุผล: `StatusCard` เป็น telemetry ที่มี meta "ข้อมูล ณ `<เวลา>`" ผสมกับค่า config จะขัด CMP-01 และจบด้วย `UptimeStripMockup` (mockup ของ #56) ซึ่งจะสร้างความสับสนเรื่องจริง/ตัวอย่างถ้าแปะต่อกัน โครงสร้างแถว (`dl`/`dt`/`dd` แบบ `ConfigCard.tsx:47-141`), เรียงบนลงล่าง: (1) การแจ้งเตือนระดับองค์กร: เปิด/ปิด เห็นเฉพาะ `owner`/`admin` (ใช้เงื่อนไข `canWrite` เดียวกับ `DetailPage.tsx:380-381`, fetch ด้วย `fetchOrganizationNotificationSettings`/`organizationNotificationSettingsQueryKey` ตัวเดียวกับที่ `AlertsSection.tsx` ใช้ เพื่อแชร์ cache ไม่ยิง query เลยถ้า role ไม่ผ่าน) states: loading (skeleton แบบ `LastResponseCard.tsx:220-228`), error (Alert + "ลองอีกครั้ง" แบบ `LastResponseCard.tsx:206-219`, ไม่แสดง "เปิด" เด็ดขาด), denied กลางคัน (หยุด poll แบบ `LastResponseCard.tsx:174-203`) (2) เกณฑ์ล้มเหลว: `monitor.alerts.failureThreshold` ครั้ง เห็นทุก role (3) แจ้งเมื่อล่มและกลับมาปกติ: เปิด/ปิด จาก `monitor.alerts.downEnabled` เห็นทุก role (4) แจ้งเมื่อ SSL ใกล้หมดอายุ: เปิด/ปิด (ล่วงหน้า N วัน) จาก `monitor.alerts.sslEnabled`/`sslCautionDays` เห็นทุก role มอนิเตอร์ที่ `monitor.ssl.state === "not_https"` ต่อท้ายด้วยข้อความเดียวกับ `SslCard.tsx:31` ("มอนิเตอร์นี้ใช้ http ไม่มีข้อมูลใบรับรอง") แทนการแสดง "เปิด (ล่วงหน้า 30 วัน)" เฉย ๆ แถวที่ (1) ปิดแสดงข้อความ `UX-60-02` (ข) เดียวกับในฟอร์ม `StatusCard.tsx:172` คงที่เดิม เปลี่ยนเฉพาะค่าเป็น `monitor.alerts.failureThreshold` (ไม่ย้ายไปการ์ดใหม่ เพราะเป็น telemetry ของ "ใกล้ล่มแค่ไหนตอนนี้" คนละหน้าที่กับการ์ดตั้งค่า) **Non-goal เพิ่ม**: ลิงก์จากแถว (1) ไปหน้า `/organizations/:organizationId/notification-settings` (ข้อเสนอของ UX ยังไม่ยืนยัน ไม่อยู่ใน scope นี้)
- **Inbox** (`NotificationsPage.tsx:62`): ข้อความ caution ไม่ระบุ "30 วัน" ตายตัว ใช้จำนวนวันที่เหลือคำนวณจาก `sslNotAfter` กับ `occurredAt` หรือข้อความที่ไม่มีตัวเลข [สมมติฐาน: เลือกตอน implement ตามที่ UX ตอบ] item เก่าจึงไม่แสดงตัวเลขผิด ข้อความ danger 7 วัน (64) คงเดิมภายใต้ OD-60-04 (a)
- **Audit log** (`apps/web/src/pages/audit-log/labels.ts`): ป้ายของสี่ field ใหม่
- **Event feed** (`detail/labels.ts`): ป้ายของสี่ `field` ใหม่ใน `changes[]` และ `enabled`/`disabled` เป็น "เปิด"/"ปิด"
- **Query keys** ไม่เพิ่ม mutation ของ monitor invalidate prefix `['tenant','monitors',orgId]` เดิม generated types ด้วย `bun run --cwd apps/web codegen` (WEB-01)
- **Accessibility** (CMP-01): select และช่องตัวเลขมี `<label>` ช่องจำนวนวันที่ disabled ประกาศเหตุผลผ่าน `aria-describedby` สถานะเปิด/ปิดในหน้า Detail เป็นข้อความ ไม่พึ่งสีอย่างเดียว

### Authorization and security

- เขียน `alerts` ได้เฉพาะ role ที่มี `write` (`owner`, `admin`) ผ่าน Create และ Edit เดิม อ่านได้ทุก role ที่มี `read` ไม่มี permission ใหม่
- `alerts` ไม่มีค่าลับ หรือข้อมูลส่วนบุคคล log ของ Worker และ API ไม่เพิ่ม field
- Audit (F-007): Edit ที่เปลี่ยน `alerts` เขียน `audit_events` ใน transaction เดียวกับ update ผ่าน `monitorAuditChanges` เดิม พร้อม before/after
- ไม่มี fresh-auth boundary ใหม่ (การแก้ monitor เดิมไม่ต้องใช้)
- RLS: column ใหม่อยู่ใต้ policy ของ `monitors` (DB-04) ไม่มีตารางใหม่

### Concurrency

| Race | ลำดับ lock และผลที่ยอมรับ |
| --- | --- |
| Edit เปลี่ยน `alerts` ระหว่างการตรวจ | ทั้ง Edit และ transaction B lock `monitors FOR UPDATE` ผลตรวจใช้ค่าเก่าทั้งชุดหรือค่าใหม่ทั้งชุด ไม่ผสม การแก้ `alerts` ไม่รีเซ็ต claim ผลที่กำลังรันจึงไม่ถูกทิ้ง |
| ลดเกณฑ์ขณะ streak ถึงเกณฑ์ใหม่แล้ว (เช่น streak 2 แล้วลดจาก 3 เป็น 2) | OD-60-06 (a): save ไม่เปิด incident ผล `fail` ถัดไปเปิดตามเกณฑ์ใหม่ ผล `pass` ถัดไปรีเซ็ต streak |
| เพิ่มเกณฑ์ขณะ incident เปิด | incident ยังเปิดจนมีผล `pass` (ไม่ปิดเพราะเปลี่ยนเกณฑ์) |
| ปิด toggle ล่มขณะ incident เปิดที่ส่ง "ล่ม" แล้ว | ตอนปิด incident อ่านค่าปัจจุบัน toggle ปิดจึงไม่ส่ง "กลับมาปกติ" |
| ลด `sslCautionDays` หลังส่ง caution ของใบรับรองนี้แล้ว | ไม่ส่งซ้ำ เพราะ `ssl_notified_level` เป็น `caution` อยู่แล้ว เพิ่มค่าจนใบรับรองเข้าเกณฑ์ใหม่ ส่ง caution ในผลตรวจถัดไป |
| Edit สองรายการพร้อมกัน | compare-and-swap `version` เดิม ฝั่งที่แพ้ได้ `409` ไม่เขียน event หรือ audit |
| เปลี่ยน `monitorAlertsEnabled` ระหว่างการตรวจ | ลำดับเดิมของ F-005 (settings อ่านใน transaction B หลัง advisory lock) |

## Design decisions

- **เก็บค่าบน `monitors`**: ค่าหนึ่งชุดต่อ monitor อ่านใต้ lock เดิมของ transaction B ไม่ต้อง join หรือเพิ่มลำดับ lock
- **`alerts` เป็น object ซ้อน**: แยกจาก field ของการตรวจ ทำให้ `affectsChecks` (whitelist) ไม่ต้องแก้ และ form map เป็น step เดียว
- **default เท่าพฤติกรรมวันนี้**: monitor เดิม, client เดิม และ e2e เดิมไม่เปลี่ยนผล
- **ระดับ SSL ที่แสดงไม่ผูกกับค่าราย monitor** (OD-60-05 (a)): `sslLevel` ใช้ที่ 4 จุด (Worker state, Detail/List, Test, recent events) การให้ระดับที่แสดงต่างกันต่อ monitor ทำให้ summary ของ Overview และสีตาม design system ไม่สม่ำเสมอ
- **Architecture drivers ที่แตะ**: authorization (สิทธิ์เดิม), audit (before/after ใน F-007), operability (feature toggle ราย monitor) ไม่แตะ latency, availability หรือ DR ไม่มี target ด้าน performance ใหม่ (ไม่มีใน issue)
- **Risks**:
  - เกณฑ์ที่สูงขึ้นทำให้ incident เปิดช้าลง และ uptime/incident history ต่างกันต่อ monitor (OD-60-02 (a)) หน้า Detail แสดงเกณฑ์ให้เห็น
  - migration `0022` ชนกับ branch อื่น: ตรวจเลขตอน rebase ห้ามแก้ migration ที่ apply แล้ว (DB-11)
  - ข้อความ inbox ของ item เก่าที่อ้าง 30 วัน: แก้ที่ฝั่ง render จึงครอบ item เก่า
  - `viewer`/`auditor` เห็นแถว (2) ถึง (4) ของการ์ด "การแจ้งเตือน" เป็น "เปิด" โดยไม่เห็นแถว (1) (องค์กร) เลย จึงไม่รู้ว่าการแจ้งจริงถูกปิดจากระดับองค์กรหรือไม่ เป็นผลของ `assertSettingsAdministrator` ที่ตัดสินใจแล้วในชั้น API ของ F-005 ยอมรับเป็นความเสี่ยง ไม่ใช่ blocker ของงานนี้ (`UX-60-02`)
- **Assumptions**:
  - "admin" และ "owner" ใน user stories หมายถึง role ที่มี `write` ตาม F-005 ทั้งคู่
  - story ของ viewer ต้องการเห็นค่า ไม่ต้องการแก้
  - การแจ้ง SSL ราย monitor ครอบทั้งสามระดับ (caution, danger, expired) ด้วย toggle เดียว ตาม mockup ใน `AlertsSection.tsx:66-69`
- **Non-goals**: ช่องทางส่งออก (`#ops-alerts`, "อีเมล owner") ตาม OD-60-07, ผู้รับราย monitor, การหน่วงหรือ re-notify, เกณฑ์กลับมาปกติหลายครั้ง, การเปลี่ยน `monitorAlertsEnabled` หรือหน้า notification settings, การแก้ไฟล์ของ F-005

## Acceptance

ไม่มี Feature doc แถว behavior ด้านล่างร่างโดย Technical Lead จาก user stories ใน issue ปกติ Product Owner เป็นเจ้าของ แต่ผู้ใช้อนุมัติแถวเหล่านี้โดยตรงพร้อม spec นี้ (`PO-60-02`) `acceptanceVersion` `issue-60-AC-1` ตั้งแต่ 2026-10-05 ตัวเลขในแถวมาจาก Decisions 2026-10-05 คอลัมน์ OD อ้าง Decisions

| AC | หมวด | เกณฑ์ | OD |
| --- | --- | --- | --- |
| P60-01 | Behavior | `owner`/`admin` ตั้ง "แจ้งเมื่อล้มเหลวติดกัน" ได้ในช่วง 1 ถึง 3 ครั้ง ตอน Create และ Edit ค่าเริ่มต้น 2 monitor ที่ตั้ง 3 เปิด incident และส่ง "ล่ม" เมื่อล้มเหลวติดกันครั้งที่ 3 ไม่ใช่ครั้งที่ 2 | 02, 03 |
| P60-02 | Behavior | ปิด "แจ้งเมื่อล่มและกลับมาปกติ" ของ monitor หนึ่งแล้ว monitor นั้นไม่สร้าง `MONITOR_DOWN`/`MONITOR_RECOVERED` monitor อื่นยังได้ตาม `monitorAlertsEnabled` incident และ health ยังเปลี่ยนตามปกติ | 01 |
| P60-03 | Behavior | ตั้งจำนวนวันก่อนหมดอายุได้ในช่วง 8 ถึง 30 วัน ค่าเริ่มต้น 30 notification SSL ระดับแรกส่งเมื่อเวลาที่เหลือไม่เกินจำนวนนั้น ปิด toggle SSL แล้วไม่ส่ง และเปิดกลับไม่ส่งระดับที่ผ่านไปแล้วซ้ำ | 04, 05 |
| P60-04 | Behavior | ทุก role เห็นเกณฑ์ล้มเหลว, toggle ทั้งสอง และจำนวนวัน SSL ในหน้า Detail ข้อความ "จะเปลี่ยนเป็นล่มเมื่อล้มเหลวติดกันครบ N ครั้ง" ใช้ค่าของ monitor สถานะ toggle องค์กรเห็นเฉพาะ `owner`/`admin` | 02 |
| P60-05 | Behavior | `monitorAlertsEnabled` ปิดแล้วไม่มี notification ของ monitor ใดแม้ toggle ราย monitor เปิด | 01 |
| P60-06 | Behavior | แก้เฉพาะ `alerts` ไม่รีเซ็ต streak ไม่เปลี่ยน health เป็น "ไม่ทราบสถานะ" และเขียน `config_changed` กับ audit event ที่มีค่าเดิม/ค่าใหม่ | 06 |
| P60-07 | Concurrency | แถวในตาราง Concurrency ข้างบน ผ่านตามผลที่ยอมรับ | 06 |
| P60-08 | Security | `viewer`/`auditor` แก้ `alerts` ไม่ได้ (`403 PERMISSION_DENIED`) ค่านอกช่วงได้ `400 MONITOR_INVALID` ไม่มี field ใหม่ใน log | none |
| P60-09 | Verification | DB test ของ CHECK และ default ของ column ใหม่, Worker DB test ของลำดับผลตรวจต่อเกณฑ์ 1, 2, 3 และ toggle ทุกชุด, API HTTP test ทุก role, web test ของ form และ Detail และ e2e หนึ่งเส้นทางตาม Integrated verification | none |

## Tasks

ร่างลำดับเท่านั้น ไม่มี start authorization ห้าม dispatch จนผู้ใช้อนุมัติ spec และอนุญาตเริ่มงานแยกกัน

| Task | Depends on | Integration owner of shared files |
| ------ | ---------- | --------------------------------- |
| NODE-60-01 Migration และ schema | None | เจ้าของเดียวของ `packages/db/migrations/0022_monitor_alert_settings.sql`, `packages/db/src/schema.ts` |
| NODE-60-02 Shared: ระดับ notification ของ SSL | None | เจ้าของเดียวของ `packages/shared/src/monitor-check/ssl-level.ts` และ `index.ts` |
| NODE-60-03 API และ contract | 01 | เจ้าของเดียวของ `packages/api-contract/src/monitor.ts`, `audit-log.ts`, `apps/api/src/monitors/` และ generate `openapi-types.gen.ts` ครั้งแรก |
| NODE-60-04 Worker | 01, 02 | เจ้าของเดียวของ `apps/worker/src/monitor/` |
| NODE-60-05 Web | 03 | เจ้าของเดียวของ `apps/web/src/pages/monitors/`, `apps/web/src/pages/NotificationsPage.tsx`, `apps/web/src/pages/audit-log/labels.ts` |
| NODE-60-06 Integration verification | 01 ถึง 05 | เจ้าของเดียวของไฟล์ใหม่ใน `e2e/` |

### NODE-60-01 Migration และ schema

- **OWNER:** software-engineer
- **READY:** spec อนุมัติและมี start authorization
- **OUTCOME:** `0022` เพิ่มสี่ column ตาม Data พร้อม CHECK และ default Drizzle schema ตรงกัน
- **SOURCE:** Contracts → Data, DB-04, DB-11, DB-12
- **INVARIANTS:** ไม่แก้ `0016` ถึง `0021` ไม่เปลี่ยน grant หรือ policy
- **FILES:** `packages/db/migrations/0022_monitor_alert_settings.sql`, `packages/db/src/schema.ts`, `packages/db/tests/monitor.db.test.ts`
- **NON-GOALS:** การอ่านหรือเขียนค่าจาก API หรือ Worker
- **CONTRACTS:** ชื่อ column และช่วงที่ 03 และ 04 ใช้
- **VERIFY:** `bun run test:integration` ของ `packages/db`
- **PROOF:** DB test ของ default บนแถวเดิม, CHECK ขอบล่างและบน, RLS A-only/B-only เดิมผ่าน
- **COVERS:** P60-09

### NODE-60-02 Shared: ระดับ notification ของ SSL

- **OWNER:** software-engineer
- **READY:** spec อนุมัติและมี start authorization
- **OUTCOME:** helper ระดับ notification ที่รับจำนวนวัน caution ตาม OD-60-04 และ OD-60-05 `sslLevel` คงเดิม
- **SOURCE:** Contracts → Jobs (จำนวนวัน SSL)
- **INVARIANTS:** ผลของ `sslLevel` ไม่เปลี่ยน การปัดวันขึ้นแบบเดิม
- **FILES:** `packages/shared/src/monitor-check/ssl-level.ts`, `packages/shared/src/monitor-check/index.ts`, `packages/shared/tests/monitor-check/ssl-level.test.ts`
- **NON-GOALS:** การเปลี่ยนระดับที่แสดง
- **CONTRACTS:** signature ของ helper ที่ 04 ใช้
- **VERIFY:** `bun run --cwd packages/shared test`
- **PROOF:** test ขอบ N วันพอดี, N วัน + 1 s, 7 วัน, หมดอายุ และ N = 30 ให้ผลเท่า `sslLevel`
- **COVERS:** P60-03

### NODE-60-03 API และ contract

- **OWNER:** software-engineer
- **READY:** commit และ handoff ของ 01 ผ่าน review ของ Technical Lead
- **OUTCOME:** `alerts` ใน config, record, Create, Edit, Test (รับและไม่ใช้), `StoredConfig`, `diffConfig`, `monitorAuditChanges`, `AUDIT_CHANGE_FIELDS` และ health ใช้เกณฑ์ของ monitor (OD-60-02 (a))
- **SOURCE:** Contracts → API, Data, Authorization and security, Concurrency
- **INVARIANTS:** `affectsChecks` ไม่รวม `alerts` `sameConfig` รวม `alerts` route และ permission เดิม
- **FILES:** `packages/api-contract/src/monitor.ts`, `packages/api-contract/src/audit-log.ts`, `apps/api/src/monitors/record.ts`, `service.ts`, `read-service.ts`, `health.ts`, `config-changes.ts`, `audit.ts`, tests, `apps/web/src/lib/api/openapi-types.gen.ts` (generate เท่านั้น)
- **NON-GOALS:** notification, ระดับ SSL ที่แสดง
- **CONTRACTS:** OpenAPI ที่ 05 generate
- **VERIFY:** `bun run --cwd apps/api test`, `bun run test:integration`, `bun run codegen:check`
- **PROOF:** HTTP test ทุก role, ค่านอกช่วงและชนิดผิด, Create ที่ไม่ส่ง `alerts` ได้ default, Edit ที่ไม่ส่ง `alerts` คงค่าที่ตั้งไว้ (เกณฑ์ 3 ยังเป็น 3), Edit เฉพาะ `alerts` คืน `changed: true` ไม่เพิ่ม `check_config_version` และไม่รีเซ็ต streak, `changes[]` และ audit before/after ของสี่ field, unit test ของ `computeHealth` ที่เกณฑ์ 1, 2, 3
- **COVERS:** P60-01, P60-04, P60-06, P60-08

### NODE-60-04 Worker

- **OWNER:** software-engineer
- **READY:** commit และ handoff ของ 01 และ 02 ผ่าน review ของ Technical Lead
- **OUTCOME:** เกณฑ์เปิด incident, toggle ล่ม/กลับมาปกติ, toggle SSL และจำนวนวัน SSL ตาม Jobs
- **SOURCE:** Contracts → Jobs, Concurrency, AC-36, AC-39, AC-51 ของ F-005 ส่วนที่ไม่ถูก supersede
- **INVARIANTS:** ลำดับ lock เดิม `ssl_notified_*` เลื่อนแม้ toggle ปิด `MONITOR_RECOVERED` เฉพาะ `downNotified` log ไม่มี field ใหม่
- **FILES:** `apps/worker/src/monitor/record-result.ts`, `apps/worker/src/monitor/notifications.ts`, `apps/worker/src/monitor/checker.db.test.ts`, tests
- **NON-GOALS:** การแก้ `insertMonitorNotificationIntent`
- **CONTRACTS:** แถวใน `monitor_incidents` และ `notification_inbox_items` ที่ 06 ตรวจ
- **VERIFY:** `bun run test:integration` ของ Worker
- **PROOF:** DB test ลำดับ ล้ม/ล้ม/ล้ม ที่เกณฑ์ 1, 2, 3, ทุกชุดของ toggle องค์กร × ราย monitor, toggle เปิดกลางคัน, ลดเกณฑ์ขณะ streak ค้าง, SSL ที่จำนวนวันไม่ใช่ 30 รวมข้ามระดับและต่ออายุ
- **COVERS:** P60-01, P60-02, P60-03, P60-05, P60-07

### NODE-60-05 Web

- **OWNER:** software-engineer
- **READY:** commit และ handoff ของ 03 ผ่าน review ของ Technical Lead (`UX-60-01`, `UX-60-02` ปิดแล้ว ดู Decisions)
- **OUTCOME:** control จริงใน form แทน mockup, ส่วนเกณฑ์ในหน้า Detail, ข้อความ inbox, ป้าย audit log และ event feed
- **SOURCE:** Contracts → Web, design system, `docs/ref/shell-structure.md`
- **INVARIANTS:** ไม่แก้ `openapi-types.gen.ts` ด้วยมือ ลบ `MockupFrame` ของ issue 60 ใน `AlertsSection.tsx`
- **FILES:** `apps/web/src/pages/monitors/form/AlertsSection.tsx`, `MonitorForm.tsx`, `BasicSection.tsx` (บังคับเสมอ ลบการใช้ `DOWN_AFTER_FAILURES`), `model.ts` (payload ของ Edit ต้องส่ง `alerts` ครบ object เสมอเมื่อส่ง ไม่ส่งเป็นบาง field), `apps/web/src/pages/monitors/detail/`, `apps/web/src/pages/monitors/DetailActions.test.tsx` (fixture ขาด `alerts` ตั้งแต่ `monitorRecordSchema` เปลี่ยนเป็น required), `apps/web/src/pages/NotificationsPage.tsx`, `apps/web/src/pages/audit-log/labels.ts`, tests
- **NON-GOALS:** หน้า notification settings ขององค์กร
- **CONTRACTS:** none
- **VERIFY:** `bun run --cwd apps/web test`, typecheck ของ web
- **PROOF:** test ของ form (default, ค่านอกช่วง, ช่องวัน disabled), Detail ทุก role, ข้อความ inbox ของ item caution, screenshot ของ form และ Detail
- **COVERS:** P60-01, P60-03, P60-04

### NODE-60-06 Integration verification

- **OWNER:** software-engineer
- **READY:** 01 ถึง 05 ผ่าน review ของ Technical Lead
- **OUTCOME:** e2e ตาม Integrated verification
- **SOURCE:** Integrated verification
- **INVARIANTS:** ไม่แก้ source ของ Task อื่น
- **FILES:** ไฟล์ใหม่ใน `e2e/`
- **NON-GOALS:** การแก้ e2e เดิมนอกจากจำเป็นต่อ default ใหม่
- **CONTRACTS:** none
- **VERIFY:** e2e ที่เพิ่ม
- **PROOF:** log ของ e2e
- **COVERS:** P60-01, P60-02, P60-09

## Integrated verification

- e2e: สร้าง monitor เกณฑ์ 3 ชี้เป้าที่ล้ม ตรวจว่า incident และ `MONITOR_DOWN` เกิดที่ผลที่ 3 แล้วปิด toggle ล่มของ monitor ที่สอง ตรวจว่าไม่มี `MONITOR_DOWN` ของ monitor นั้นแต่ incident เปิด (P60-01, P60-02)
- e2e เดิมที่นับ `MONITOR_DOWN` (`e2e/tests/monitors.spec.ts:320-326`, `e2e/verification/api-matrix.ts:1458-1512`) ต้องผ่านโดยไม่แก้ เพราะ default เท่าวันนี้
- gate รันครั้งเดียวหลัง writer ทุกตัวหยุด ตาม `scripts/quality/README.md`

## Decisions

OD-60-01 ถึง OD-60-06: ผู้ใช้ยืนยันตามข้อเสนอของ Technical Lead เมื่อ 2026-10-05 ผ่าน AskUserQuestion ของ session หลัก (team-lead ส่งต่อ) OD-60-07: ยืนยันจาก codebase ไม่ใช่จากผู้ใช้โดยตรง team-lead grep แล้วไม่พบโมเดล channel, webhook หรือ slack ในระบบ จึงยืนยันตามข้อเสนอ (a) Technical Lead ไม่ได้รัน grep นี้เอง PO-60-01 และ PO-60-02 ปิดโดยการอนุมัติ spec นี้ 2026-10-05 ไม่ใช่คำตอบแยกต่างหาก

| Decision | ผล |
| -------- | -- |
| `OD-60-01` | (a) ส่ง notification ของ monitor เมื่อ `monitorAlertsEnabled` ขององค์กรและ toggle ราย monitor เปิดทั้งคู่ องค์กรเป็น master ไม่แก้ contract ของ notification settings |
| `OD-60-02` | (a) เกณฑ์ราย monitor เปลี่ยนนิยาม "ล่ม": incident เปิดและ health เป็น "ล่ม" ที่เกณฑ์ (`record-result.ts:443`, `health.ts:70`) supersede F-005 AC-13 และ AC-51 เฉพาะ monitor ที่ตั้งค่าต่างจาก 2 |
| `OD-60-03` | ช่วงเกณฑ์ล้มเหลว 1 ถึง 3 ค่าเริ่มต้น 2 ผู้ใช้กำหนดตัวเลขเองตาม `F-005 feature.md:85` |
| `OD-60-04` | (a) ค่าเดียว `sslCautionDays` แทนขอบ caution ช่วง 8 ถึง 30 วัน ค่าเริ่มต้น 30 ขอบ danger 7 วันและ expired คงเดิม |
| `OD-60-05` | (a) จำนวนวัน SSL ราย monitor เปลี่ยนเฉพาะการแจ้ง ระดับ SSL ที่แสดง (AC-05), `sslLevel` และ `SSL_LEVEL_LEAD_DAYS` คงเดิม เพดาน 30 ของ OD-60-04 ทำให้ไม่มีกรณีแจ้ง "ใกล้หมดอายุ" ขณะ pill เป็น "ปกติ" |
| `OD-60-06` | (a) save ที่เปลี่ยนเกณฑ์ไม่เปิดหรือปิด incident และไม่รีเซ็ต streak ผลตรวจถัดไปตัดสินตามเกณฑ์ใหม่ |
| `OD-60-07` | (a) ช่องทาง `#ops-alerts` และ "อีเมล owner" นอกขอบเขต ไม่มี contract ของช่องทาง UI ไม่แสดงช่องทาง (ยืนยันจาก codebase) |
| `PO-60-01` | story ของ viewer ("เข้าใจว่าทำไมได้หรือไม่ได้รับการแจ้งเตือน") หมายถึง viewer เห็นเกณฑ์การแจ้งเท่านั้น ผู้รับ notification ของ monitor ยังเป็น `owner`/`admin` ตาม F-005 OD-16 เดิม ไม่เปลี่ยน ปิดโดยการอนุมัติ spec นี้ที่เขียน contract แบบนี้อยู่แล้ว ไม่ใช่คำตอบแยกจาก Product Owner |
| `PO-60-02` | แถว behavior P60-01 ถึง P60-09 ร่างโดย Technical Lead ผู้ใช้อนุมัติโดยตรงพร้อม spec นี้ แทนการให้ Product Owner รับเป็นเจ้าของแยก (ตามที่ข้ามขั้นตอน Product Owner มาตั้งแต่ต้น) |
| `UX-60-01` | select อยู่ใน `AlertsSection.tsx` ไม่ใช่ `BasicSection.tsx` เพราะเป็น object `alerts` เดียวกันและ section นี้ render ทั้งโหมด basic/advanced อยู่แล้ว `BasicSection.tsx` ยังต้องแก้เสมอเพื่อลบ `DOWN_AFTER_FAILURES` UX Designer เสนอ 2026-10-05 ไม่กระทบ contract |
| `UX-60-02` | (ก) Card ใหม่ "การแจ้งเตือน" แยกจาก `StatusCard` วางใน aside ระหว่าง `ConfigCard` กับ `SslCard` ไม่มี section code (ข) ข้อความ toggle องค์กรปิด: "ปิด การแจ้งเตือนของมอนิเตอร์นี้จะไม่ทำงานจนกว่าจะเปิด ส่วนสถานะล่มและการนับเกณฑ์ล้มเหลวยังทำงานตามปกติ" (แทนข้อความร่างเดิมใน spec ที่ผิดข้อเท็จจริง) UX Designer เสนอ 2026-10-05 ไม่กระทบ contract รายละเอียดแถวและ state อยู่ใน Contracts → Web |
| `M-01` | code review รอบสุดท้ายพบว่าสูตร Health เดิม (`consecutiveFailures < alertFailureThreshold`) ทำให้ Edit ที่ลดเกณฑ์อย่างเดียวพลิก health เป็น "ไม่ทราบสถานะ" ก่อนมีผลตรวจใหม่ ขัดกับ P60-06 ผู้ใช้ตัดสินให้แก้โค้ด `computeHealth` ให้ตรง P60-06 (ตัดขอบบนออก ใช้ `hasOpenIncident` อย่างเดียวตัดสิน "ล่ม") แทนการบันทึกเป็นข้อยกเว้น เพิ่ม unit test (`health.test.ts`) และ DB test (`read-detail.db.test.ts`) ของทิศทางลดเกณฑ์ |

## Open decisions

ไม่มี Open decisions เหลือ `UX-60-01` และ `UX-60-02` ปิดแล้ว (ดู Decisions) `NODE-60-05` เริ่มงานได้ตาม READY

## Revisions

| Date | Change | Approved by user | `acceptanceVersion` |
| ---- | ------ | ---------------- | ------------------- |
| 2026-10-05 | ร่างแรกจากเนื้อหา issue #60 โดยข้าม Feature doc ตามคำสั่งผู้ใช้ | Not yet | none |
| 2026-10-05 | ผู้ใช้ยืนยัน OD-60-01 ถึง 07 ตามข้อเสนอทุกข้อ เติม MIN/MAX | ผู้ใช้ (OD เท่านั้น ยังไม่ freeze เพราะ PO-60-01, PO-60-02, UX-60-01, UX-60-02 ยังเปิดอยู่) | none |
| 2026-10-05 | ผู้ใช้อนุมัติ spec ทั้งฉบับ freeze acceptance ปิด `PO-60-01` (viewer เห็นเกณฑ์เท่านั้น ตามที่ contract เขียนไว้) และ `PO-60-02` (ผู้ใช้รับแถว P60-01 ถึง P60-09 โดยตรง) เหลือ `UX-60-01`, `UX-60-02` เปิดแบบไม่บล็อก | ผู้ใช้ | `issue-60-AC-1` |
| 2026-10-05 | `/implement-issue` เริ่มงาน (`COMMIT_MODE` owned-slice, `STOP_AT` merge-ready) UX Designer ปิด `UX-60-01` และ `UX-60-02` ไม่มี Open decisions เหลือ แก้ Contracts → Web ให้ตรงกับคำตอบ, แก้ FILES/READY ของ `NODE-60-05`, เพิ่ม risk เรื่อง `viewer`/`auditor` ไม่เห็นสถานะ toggle องค์กร | ผู้ใช้ (ผ่านคำสั่ง `/implement-issue`), UX Designer | `issue-60-AC-1` (ไม่เปลี่ยน) |
| 2026-10-05 | `NODE-60-01` ถึง `06` merge ครบ final code review พบ `M-01` (Health formula ขัดกับ P60-06 ในทิศทางลดเกณฑ์) ผู้ใช้ตัดสินให้แก้โค้ด แก้ `computeHealth` และเพิ่ม test ตามที่ `M-01` บันทึกไว้ gate ทั้งหมด (`validate`, `test:coverage`, `build`, `security`) ผ่านหลังแก้ | ผู้ใช้ | `issue-60-AC-1` (ไม่เปลี่ยน) |
