# Issue #58 ฟีดเหตุการณ์ต่อ monitor และการตอบกลับล่าสุด

Owner: Product Owner UI flow เขียนจากหัวข้อ Web ของ Technical Spec ยังไม่ผ่านการทบทวนของ UX Designer

| Field                  | Value |
| ---------------------- | ----- |
| Issue                  | [#58](https://github.com/nixbpe/new-nightwatch/issues/58) |
| Epic                   | None |
| Direction              | `DIR-001/v3` S2 (ต่อยอด `F-005`) |
| Related Features       | `F-005` (`F-005-AC-1`), `F-004` (`F-004-AC-2` frozen) |
| Technical Spec         | `docs/features/issue-58-monitor-event-feed/spec.md` |
| outcome_status         | Not measured |
| Scope approved by user | 2026-10-02 (โดยผู้ใช้: "ยืนยัน OD ตามค่าแนะนำได้หมดเลย และให้เริ่ม implement ได้เลย") |
| acceptanceVersion      | `issue-58-AC-1` |
| Acceptance status      | frozen (2026-10-02, ผู้ใช้อนุมัติ Technical Spec) |

## Problem and scope

Detail ของ monitor ใน `F-005` แสดงตาราง incident หนึ่งแถวต่อ incident และ mockup ของฟีดเหตุการณ์กับการตอบกลับล่าสุด (CMP-06) ผู้ใช้ไม่เห็นว่า monitor ล้มครั้งเดียวเมื่อใด ใครแก้การตั้งค่าอะไร หรือเป้าหมายตอบอะไรกลับมาในการตรวจล่าสุด recent events ระดับองค์กรไม่แสดง HTTP status

### User stories จาก issue

ข้อความจาก issue (verbatim):

1. ในฐานะ admin ฉันต้องการเห็นการตรวจล้มเหลวครั้งเดียวในฟีดเดียวกับ incident เพื่อจับอาการก่อนเกิดล่มจริง
2. ในฐานะ viewer ฉันต้องการเห็น HTTP status และเวลาตอบสนองตอนที่ monitor กลับมาปกติ เพื่อยืนยันว่าบริการฟื้นเต็มที่
3. ในฐานะ auditor ฉันต้องการเห็นว่าใครแก้การตั้งค่า monitor เมื่อไรและเปลี่ยนจากค่าอะไรเป็นค่าอะไร เพื่อตรวจสอบย้อนหลังได้
4. ในฐานะ admin ฉันต้องการเห็น response headers และ body ของการตรวจล่าสุด เพื่อวิเคราะห์สาเหตุโดยไม่ต้องยิง request เอง

"สิ่งที่ขาด" ตาม issue: API ฟีดต่อ monitor ที่รวม failed check, recovered (HTTP status + ms) และ config change; ที่เก็บประวัติแก้ config พร้อม actor และค่าเดิม/ใหม่; HTTP status บนเหตุการณ์ใน recent-events; การเก็บ response headers และ body ของการตรวจล่าสุด

Decision ทำให้ story สองข้อแคบลง:

- Story 3: auditor เห็นผู้แก้เป็น "สมาชิก" ไม่เห็นชื่อ (`OD-58-08`) auditor ยังเห็นเวลาและค่าเดิม/ค่าใหม่ ค่า query เป็น "•••" ส่วนค่าลับ body และ assertions ไม่แสดงค่า
- Story 4: monitor ที่ URL หลังต่อ query มี query หรือคำขอส่ง body จริง แสดงเฉพาะ HTTP version และรหัสสถานะ ไม่มี headers หรือ body (`OD-58-11` (d))

### Permission matrix

| Operation | owner | admin | viewer / auditor | non-member |
| --------- | ----- | ----- | ---------------- | ---------- |
| ดูฟีดเหตุการณ์ต่อ monitor | อนุญาต | อนุญาต | อนุญาต | ไม่อนุญาต ("ไม่พบมอนิเตอร์นี้" ตาม `AC-48` ของ `F-005`) |
| เห็นชื่อผู้แก้ในฟีด | อนุญาต | อนุญาต | ไม่อนุญาต เห็น "สมาชิก" | ไม่อนุญาต |
| ดู status line ของการตอบกลับล่าสุด | อนุญาต | อนุญาต | ไม่อนุญาต | ไม่อนุญาต |
| ดู headers และ body ของการตอบกลับล่าสุด | อนุญาต | อนุญาต | ไม่อนุญาต เห็น "เฉพาะเจ้าของและผู้ดูแลเห็น headers และเนื้อหา" | ไม่อนุญาต |
| ดู HTTP status ใน recent events | อนุญาต | อนุญาต | อนุญาต | ไม่อนุญาต |

แถว status line ใช้สิทธิ์เดียวกับ headers และ body เพราะ spec กำหนด panel ทั้งหมดไว้หลัง `readResponse` (`OD-58-04`) ทุก role ยังเห็น HTTP status, response time และสาเหตุจาก `lastResult` เดิมของ `F-005`

- In scope:
  - ฟีดเหตุการณ์ต่อ monitor บน Detail: ตรวจล้มเหลว (หนึ่งแถวต่อ streak), เริ่มล่ม, กลับมาปกติพร้อม HTTP status และ response time, หยุดชั่วคราว, เริ่มตรวจต่อ, แก้ไขการตั้งค่าพร้อมผู้แก้และค่าเดิม/ค่าใหม่ ภายใน 30 วันล่าสุด แทน mockup เดิม
  - ตาราง incident หนึ่งแถวต่อ incident ของ `F-005` คงอยู่คู่กับฟีด (`OD-58-03`)
  - Panel การตอบกลับล่าสุดบน Detail แทน mockup เดิม เก็บแถวเดียวต่อ monitor ซึ่งถูกเขียนทับทุกผลตรวจ
  - HTTP status ของการเริ่มล่มและการกลับมาปกติใน recent events บน Overview และ Workspace
  - ลบ mockup ของ #58 สามจุด (mockup ของ #56, #57, #59, #63 คงอยู่)
- Non-goals:
  - `HTTP/2` บน status line (`OD-58-06`)
  - Audit log ระดับองค์กรที่อยู่ต่อหลังลบ monitor เป็น Feature แยก (`OD-58-02`)
  - เก็บ response ต่อผลตรวจหรือประวัติการตอบกลับย้อนหลัง
  - Response snapshot ของปุ่มทดสอบ (`POST /monitors/test`)
  - Event ของ SSL ในฟีดต่อ monitor
  - ปุ่ม copy หรือ download body
  - แก้ `AC-61` ของ `F-005` (audit เป็น Pino info log เดิม)
  - Field ใหม่ใน incidents API และ response time ใน recent events
  - แทนตาราง incident ด้วยฟีด
  - แสดงรายละเอียดการแก้ไขของ event ที่เกิดก่อน Feature นี้

### ความสัมพันธ์กับ F-004 และ F-005

| Feature | AC ที่เกี่ยว | ผลของ Feature นี้ |
| ------- | ------------ | ----------------- |
| `F-005` | `AC-42` (ไม่เก็บ response header, body เต็ม, ค่า query และ body ของคำขอ) และ Non-goal "เก็บ response body เต็ม" | ผู้ใช้เปลี่ยน `AC-42` สำหรับ issue นี้ (`OD-58-01`): เก็บ last response แถวเดียวต่อ monitor ที่ redact และตัดแล้ว purge เมื่อ `scheduled_for` เก่ากว่า 30 วัน ค่า query และ body ของคำขอยังไม่ถูกเก็บ: monitor ที่ URL หลังต่อ query มี query หรือคำขอส่ง body จริง เก็บเฉพาะ HTTP version และรหัสสถานะ (`OD-58-11` (d)) ประวัติผลตรวจ, incident, notification, ผลทดสอบ และ log คง `AC-42` เดิม |
| `F-005` | `AC-61` และการตัดสิน "ไม่มีตาราง audit" (2026-09-29) | คงเดิม ฟีดเป็นข้อมูลแสดงผลของ monitor ลบตาม monitor และ purge ที่ 30 วัน (`OD-58-02`) |
| `F-005` | `AC-48` | ใช้กับ operation ใหม่ทั้งสอง (ฟีดและการตอบกลับล่าสุด) |
| `F-005` | ตาราง incident และ recent events สองแถวต่อ incident | คงจำนวนแถวเดิม recent events เพิ่มเฉพาะ HTTP status |
| `F-004` | `AC-02` (`viewer`, `auditor` ไม่เห็นข้อมูลสมาชิก) | คงเดิม ชื่อผู้แก้เห็นเฉพาะ `owner`, `admin` role อื่นเห็น "สมาชิก" (`OD-58-08`) |

ไฟล์นี้ supersede `AC-42` ของ `F-005` เฉพาะ last response และไม่แก้ `F-004` หรือ `F-005` (`Q-02`)

## Outcome

ผู้ใช้วิเคราะห์ปัญหาของ monitor จาก Detail ได้โดยไม่ต้องเรียกเป้าหมายเอง: เห็นลำดับเหตุการณ์ 30 วัน ผู้แก้และสิ่งที่แก้ และสิ่งที่เป้าหมายตอบกลับในการตรวจล่าสุด

งานนี้ไม่วัด outcome metric (`Q-04`) ผลที่สังเกตได้คือ P58-01..P58-10 Guardrail: ไม่มีค่าลับ ค่า query หรือ request body ปรากฏใน panel, API หรือ log (P58-05)

## UI flow

1. สมาชิกเปิด Detail ของ monitor หน้าแสดง card "ฟีดเหตุการณ์" (section ที่มี `h2`; ตาราง incident เดิมใช้ h2 "เหตุการณ์" อยู่แล้ว) คู่กับตารางเหตุการณ์ incident เดิม และ card "การตอบกลับล่าสุด" ใน aside
2. Card "ฟีดเหตุการณ์" แสดงรายการเรียงใหม่ไปเก่า แต่ละแถวมีประเภทเป็นคำ เวลาพร้อม timezone และรายละเอียด:
   - "ตรวจล้มเหลว" พร้อมสาเหตุ, HTTP status และ response time เมื่อมี
   - "เริ่มล่ม" พร้อมสาเหตุและ HTTP status เมื่อมี
   - "กลับมาปกติ · HTTP 200 · 182 ms" (HTTP และ response time มีเฉพาะการกลับมาปกติจากผลตรวจหลัง Feature นี้)
   - "หยุดชั่วคราว" และ "เริ่มตรวจต่อ" พร้อมผู้กระทำ
   - "แก้ไขการตั้งค่า … โดย {ผู้แก้}" พร้อมรายการ field ที่มีคำ "ก่อน" และ "หลัง"
3. ผู้แก้แสดงเป็นชื่อ (`owner`, `admin` และผู้แก้ยังเป็นสมาชิก), "สมาชิก" (role อื่น), "อดีตสมาชิก" (ผู้แก้พ้น Organization), "ผู้ใช้ที่ถูกลบ" (บัญชีถูกลบ) หรือไม่แสดงผู้แก้ (event ก่อน Feature นี้)
4. รายการเกินหนึ่งหน้า ผู้ใช้เลื่อนหน้าด้วย pagination เดิมของตาราง
5. `owner` หรือ `admin` เห็น card "การตอบกลับล่าสุด": status line (`HTTP/1.1 200 OK`), "ตรวจเมื่อ", URL แบบ mask, ตาราง headers ที่มี caption และ body ในกล่องที่ wrap ภายในตัวเอง พร้อมป้าย "เนื้อหานี้มาจากเป้าหมายโดยตรง" ป้าย "ตัดแล้ว" แสดงเมื่อ header หรือ body ถูกตัด และ "ค่าถูกซ่อน" แทนค่าที่ซ่อน
6. Monitor ที่ URL หลังต่อ query มี query หรือคำขอส่ง body จริง: card แสดงเฉพาะ HTTP version และรหัสสถานะ พร้อมป้าย "ไม่เก็บ headers และเนื้อหา เพราะคำขอมี query หรือ body ซึ่งเป้าหมายอาจสะท้อนกลับ"
7. ผลตรวจล่าสุดไม่มี response (DNS, TLS, timeout, ถูกบล็อก, `redirect_limit`, `redirect_blocked`): card แสดง "ไม่มี response" พร้อมสาเหตุ
8. `viewer` หรือ `auditor` เห็น card "การตอบกลับล่าสุด" พร้อมข้อความ "เฉพาะเจ้าของและผู้ดูแลเห็น headers และเนื้อหา" หน้าไม่ขอข้อมูล panel
9. Overview และ Workspace แสดง recent events แถวเริ่มล่มและกลับมาปกติพร้อม "HTTP {status}" เมื่อมีค่า แถวที่ไม่มีค่าแสดงเหมือนเดิม

| Screen | Loading | Empty | Error | Denied | Success |
| ------ | ------- | ----- | ----- | ------ | ------- |
| Card "ฟีดเหตุการณ์" | skeleton ตามแบบ `IncidentsCard` | "ยังไม่มีเหตุการณ์ใน 30 วันล่าสุด" (ข้อความสุดท้ายรอ UX Designer) | ข้อความล้มเหลวพร้อม "ลองอีกครั้ง" refetch ล้มหลังมีข้อมูลแล้วคงข้อมูลเดิมพร้อมแจ้ง | non-member หรือ monitor ของ Organization อื่น: "ไม่พบมอนิเตอร์นี้" | รายการตามขั้น 2-4 |
| Card "การตอบกลับล่าสุด" | skeleton | "ยังไม่มีผลตรวจ" เมื่อยังไม่มีผลตรวจหลัง Feature นี้ (ข้อความสุดท้ายรอ UX Designer) | ข้อความล้มเหลวพร้อม "ลองอีกครั้ง" | `viewer`, `auditor`: "เฉพาะเจ้าของและผู้ดูแลเห็น headers และเนื้อหา" | ขั้น 5, 6 หรือ 7 |
| Recent events (Overview, Workspace) | ตามเดิมของ `F-005` | ตามเดิม | ตามเดิม | ตามเดิม | แถวพร้อม "HTTP {status}" เมื่อมีค่า |

```text
+------------------------------------------+  +---------------------------+
| เหตุการณ์                         (h2)    |  | การตอบกลับล่าสุด      (h2) |
| 10:42 กลับมาปกติ · HTTP 200 · 182 ms     |  | HTTP/1.1 200 OK           |
| 10:30 เริ่มล่ม · HTTP 503                 |  | ตรวจเมื่อ 10:42            |
| 10:29 ตรวจล้มเหลว · HTTP 503              |  | https://api.example/•••   |
| 09:00 แก้ไขการตั้งค่า โดย สมาชิก           |  | Headers (table, caption)  |
|       timeoutSeconds ก่อน 10 หลัง 30      |  | Body <pre> (wrap)  ตัดแล้ว |
| [< 1 2 >]                                |  | เนื้อหานี้มาจากเป้าหมายโดยตรง |
+------------------------------------------+  +---------------------------+
```

## Stories

- `issue-58-S01` ในฐานะ admin ฉันต้องการเห็นการตรวจล้มเหลวครั้งเดียวในฟีดเดียวกับ incident เพื่อจับอาการก่อนเกิดล่มจริง ครอบคลุม P58-01, P58-06, P58-07, P58-08, P58-09, P58-10
- `issue-58-S02` ในฐานะ viewer ฉันต้องการเห็น HTTP status และเวลาตอบสนองตอนที่ monitor กลับมาปกติ เพื่อยืนยันว่าบริการฟื้นเต็มที่ ครอบคลุม P58-01, P58-03, P58-06, P58-10
- `issue-58-S03` ในฐานะ auditor ฉันต้องการเห็นว่าใครแก้การตั้งค่า monitor เมื่อไรและเปลี่ยนจากค่าอะไรเป็นค่าอะไร เพื่อตรวจสอบย้อนหลังได้ (auditor เห็นผู้แก้เป็น "สมาชิก", `OD-58-08`) ครอบคลุม P58-02, P58-06, P58-07, P58-08, P58-09, P58-10
- `issue-58-S04` ในฐานะ admin ฉันต้องการเห็น response headers และ body ของการตรวจล่าสุด เพื่อวิเคราะห์สาเหตุโดยไม่ต้องยิง request เอง (monitor ที่มี query หรือ body เห็นเฉพาะ version และรหัสสถานะ, `OD-58-11` (d)) ครอบคลุม P58-04, P58-05, P58-06, P58-07, P58-08, P58-09, P58-10

## Acceptance matrix

AC ID ใช้เลข `P58-NN` จาก Technical Spec คงเลขเดิม แถว Security, Concurrency และ Data มาจาก Technical Lead Product Owner เขียนเป็นพฤติกรรมที่ตรวจได้

| AC | Category | Observable behavior | Verification |
| -- | -------- | ------------------- | ------------ |
| P58-01 | State | ฟีดต่อ monitor แสดงแถว "ตรวจล้มเหลว" หนึ่งแถวต่อชุดการล้มติดกัน (ไม่แสดงขณะ monitor มี incident เปิดอยู่), "เริ่มล่ม", "กลับมาปกติ" พร้อม HTTP status และ response time, "หยุดชั่วคราว", "เริ่มตรวจต่อ" และ "แก้ไขการตั้งค่า" เรียงใหม่ไปเก่า ข้อผิดพลาดฝั่งระบบ (`check_error`) ไม่สร้างแถว ฟีดแสดงเฉพาะ 30 วันล่าสุด state loading, empty, error และ success ตรงกับตาราง UI flow | ลำดับผล ผ่าน/ล้ม/ผ่าน (หนึ่งแถวตรวจล้มเหลว), ผ่าน/ล้ม/ล้ม/ผ่าน (ตรวจล้มเหลว, เริ่มล่ม, กลับมาปกติ), `check_error`, Edit ระหว่าง incident เปิดแล้วล้ม (ไม่มีแถวตรวจล้มเหลวใหม่) |
| P58-02 | State | แถว "แก้ไขการตั้งค่า" แสดงค่าเดิมและค่าใหม่ของแต่ละ field ที่เปลี่ยน ค่า query param แสดง "•••" body และ assertions แสดง "เปลี่ยน" ไม่มีค่า ค่าลับและ header ที่ป้ายลับเปลี่ยนแสดงเฉพาะการกระทำ (ตั้ง, แทนที่, ลบ) ไม่มีค่า ผู้แก้แสดงเป็นชื่อสำหรับ `owner`, `admin`, "สมาชิก" สำหรับ role อื่น, "อดีตสมาชิก" เมื่อผู้แก้พ้น Organization, "ผู้ใช้ที่ถูกลบ" เมื่อบัญชีถูกลบ event ก่อน Feature นี้แสดง "แก้ไขการตั้งค่า" โดยไม่มีผู้แก้และรายละเอียด Save ที่ไม่เปลี่ยนค่าไม่สร้างแถว | Edit แต่ละ field รวมค่าลับที่รู้ค่าและ header ที่เปลี่ยนเป็นลับ, ดูด้วยทุก role, ผู้แก้ที่ถูกถอดจาก Organization และที่ลบบัญชี |
| P58-03 | State | Recent events ระดับองค์กร (Overview, Workspace) แสดง "HTTP {status}" ในแถวเริ่มล่มและกลับมาปกติเมื่อมีค่า แถวที่ไม่มีค่าและแถว SSL แสดงเหมือนเดิม จำนวนแถวต่อ incident คงเดิม | incident ที่มีและไม่มี HTTP status, incident ที่ปิดด้วยการหยุดชั่วคราว |
| P58-04 | State | `owner`, `admin` เห็น panel การตอบกลับล่าสุด: status line (เช่น `HTTP/1.1 200 OK`), เวลาตรวจ, URL แบบ mask, headers และ body ที่ตัดพร้อมป้าย "ตัดแล้ว" body ที่ไม่ใช่ข้อความแสดง "เนื้อหาไม่ใช่ข้อความ" เมื่อไม่มี response (DNS, TLS, timeout, ถูกบล็อก, `redirect_limit`, `redirect_blocked`) แสดง "ไม่มี response" พร้อมสาเหตุ monitor ที่ URL หลังต่อ query มี query หรือคำขอส่ง body จริง แสดงเฉพาะ HTTP version และรหัสสถานะ ไม่มี reason phrase, headers หรือ body พร้อมป้าย "ไม่เก็บ headers และเนื้อหา เพราะคำขอมี query หรือ body ซึ่งเป้าหมายอาจสะท้อนกลับ" ยังไม่มีผลตรวจแสดง empty | เป้าหมาย 200 JSON, 204, binary, timeout, redirect เกินกำหนด, monitor GET ที่มี query, monitor POST ที่มี body, monitor GET ไม่มี query (แสดงครบ) |
| P58-05 | Security | ค่าลับของ monitor (รวมค่าที่ไม่ใช่ ASCII) และค่าของ header ใน denylist (`set-cookie`, `cookie`, `authorization`, `proxy-authorization`, `www-authenticate`, `proxy-authenticate`, ชื่อ header ลับ, ชื่อ API key header) ไม่ปรากฏใน panel, API response, ข้อมูลที่เก็บ หรือ log แม้เป้าหมายสะท้อนกลับในรูปดิบ, JSON-escaped, URL-encoded หรือ latin1 ของ UTF-8 ค่า query และ request body ไม่ปรากฏ เพราะ monitor ที่มีค่าเหล่านั้นเก็บเฉพาะ HTTP version และรหัสสถานะ (P58-04) | endpoint ที่สะท้อน header, query และ body ด้วยค่าที่รู้ค่า สแกน response, ข้อมูลที่เก็บ และ log |
| P58-06 | Authorization | `viewer`, `auditor` ไม่ได้ข้อมูลการตอบกลับล่าสุด: API ตอบ `403 PERMISSION_DENIED` "คุณไม่มีสิทธิ์ดูการตอบกลับของมอนิเตอร์นี้" และหน้าไม่ขอข้อมูล panel แต่แสดง "เฉพาะเจ้าของและผู้ดูแลเห็น headers และเนื้อหา" `viewer`, `auditor` เห็นผู้แก้เป็น "สมาชิก" ไม่มีชื่อหรือ user id non-member และ monitor ของ Organization อื่นได้ "ไม่พบมอนิเตอร์นี้" ตาม `AC-48` ของ `F-005` | UI และ request ตรงด้วยทุก role และ non-member ต่อฟีดและการตอบกลับล่าสุด |
| P58-07 | Security | ข้อมูลการตอบกลับล่าสุดและฟีดของ Organization A ไม่ปรากฏหรือถูกเขียนจาก context ของ Organization B ฟีดแสดงชื่อเฉพาะผู้ใช้ที่ยังเป็นสมาชิกของ Organization นั้น | DB test แบบ A-only, B-only, A+B และการตั้ง `FORCE ROW LEVEL SECURITY` |
| P58-08 | Concurrency | ผลตรวจที่มาช้าไม่แทนที่การตอบกลับล่าสุดที่ใหม่กว่า Edit ที่ได้ `409` ไม่สร้างแถวแก้ไขการตั้งค่า ผลตรวจที่ถูกทิ้งตาม `AC-38` ของ `F-005` ไม่สร้างแถวในฟีดหรือเปลี่ยนการตอบกลับล่าสุด | DB test ที่บังคับ interleaving |
| P58-09 | Data | แถวในฟีดหายเมื่อเก่ากว่า 30 วัน การตอบกลับล่าสุดหายเมื่อผลตรวจนั้นมีเวลานัดตรวจ (`scheduled_for`) เก่ากว่า 30 วัน (เช่น monitor ที่หยุดชั่วคราวนาน) การลบ monitor ลบฟีดและการตอบกลับล่าสุดพร้อมกัน | DB test ของ purge และ cascade |
| P58-10 | Accessibility | ฟีดเป็นรายการลำดับ (`<ol>`) เวลาเป็น `<time dateTime>` พร้อม timezone ค่าเดิมและค่าใหม่มีคำ "ก่อน" และ "หลัง" ประเภท event เป็นคำ ไม่พึ่งสีหรือลูกศร (CMP-01) card ใหม่ทั้งสองเป็น section ที่มี `h2` ตามลำดับ heading ตาราง headers มี caption body wrap ภายใน container ไม่ทำให้หน้าเลื่อนแนวนอน (LAY-02) | keyboard และ screen reader review, test ของลำดับ heading |

## Decisions

ผู้ใช้ยืนยันทุก OD ตามข้อเสนอของ Technical Lead เมื่อ 2026-10-02

| Decision | ผล |
| -------- | -- |
| `OD-58-01` | (b) เก็บ last response header/body แถวเดียวต่อ monitor purge เมื่อ `scheduled_for` เก่ากว่า 30 วัน Feature นี้ supersede `AC-42` ของ `F-005` เฉพาะ last response |
| `OD-58-02` | Config audit ต่อ monitor ในฟีด audit ระดับองค์กรเป็น Feature แยก |
| `OD-58-03` | เพิ่มฟีดใหม่ คงตาราง incident เดิม |
| `OD-58-04` | Header/body อ่านได้เฉพาะ `owner`, `admin` |
| `OD-58-05` | ผู้แก้ที่พ้น Organization แสดง "อดีตสมาชิก" ลบบัญชีแสดง "ผู้ใช้ที่ถูกลบ" |
| `OD-58-06` | `HTTP/2` นอกขอบเขต |
| `OD-58-07` | Feature doc ใหม่ (ไฟล์นี้) ไม่แก้ `F-005` |
| `OD-58-08` | ชื่อผู้แก้เห็นเฉพาะ `owner`, `admin` role อื่นเห็น "สมาชิก" |
| `OD-58-09` | ถูกครอบด้วย `OD-58-11` (d) |
| `OD-58-10` | `redirect_limit`, `redirect_blocked` แสดง "ไม่มี response" |
| `OD-58-11` | (d) เมื่อ URL หลังต่อ query มี query หรือคำขอส่ง body จริง เก็บเฉพาะ HTTP version และรหัสสถานะ |

`OD-58-07` ผู้ใช้ไม่ได้ตัดสินแยก Product Owner อนุมานจากคำสั่งให้เขียนไฟล์นี้และไม่แก้ `F-005`

Decision ที่ derive จากการยืนยัน OD ของผู้ใช้ (บันทึกใน `spec.md`):

| Decision | ผล |
| -------- | -- |
| `Q-01` | `DIR-001` S3 ถือว่าครอบโดย `OD-58-01` (body ที่ redact และตัดแล้ว) ไม่แก้ Direction |
| `Q-02` | ไม่แก้ `F-005` ในงานนี้ Feature นี้บันทึกการ supersede `AC-42` เฉพาะ last response |
| `Q-04` | ไม่วัด outcome metric ในงานนี้ |

## Assumptions

- `A-02` "failed check ครั้งเดียว" ใน issue หมายถึงการล้มที่ยังไม่ถึงเกณฑ์ล่ม แสดงหนึ่งแถวต่อชุดการล้มติดกัน (จาก spec)
- `A-03` Incident ที่ยังเปิดและเริ่มก่อน 30 วันไม่มีแถว "เริ่มล่ม" ในฟีด สถานะล่มยังแสดงใน banner, status card และตาราง incident

## Open decisions

| Decision | Owner |
| -------- | ----- |
| `Q-03` ข้อความ empty state ของสอง card | UX Designer กับ Product Owner |

## Revisions

| Date | Change | Approved by user | `acceptanceVersion` |
| ---- | ------ | ---------------- | ------------------- |
| 2026-10-02 | ร่างแรกจาก Technical Spec | ไม่มี (ร่าง) | `issue-58-AC-1` (ร่าง) |
| 2026-10-02 | Freeze ตามการอนุมัติ Technical Spec และ OD ทุกข้อ, user stories ตามข้อความ issue, ลบ `A-01`, ปิด `Q-01`, `Q-02`, `Q-04` ด้วย decision ที่ derive ตาม `spec.md` | ผู้ใช้, 2026-10-02 | `issue-58-AC-1` |
