# Issue #66 แสดงเพดานจำนวนสมาชิกองค์กร

Owner: Product Owner UI flow เขียนจากหน้าสมาชิกปัจจุบัน ยังไม่ผ่านการทบทวนของ UX Designer

| Field                  | Value |
| ---------------------- | ----- |
| Issue                  | [#66](https://github.com/nixbpe/new-nightwatch/issues/66) |
| Epic                   | None |
| Related Features       | #11 (`membershipLimit` ของ Better Auth) |
| outcome_status         | Not measured |
| Scope approved by user | 2026-10-03 (ผู้ใช้อนุมัติ issue เป็น scope และให้ใช้ค่าแนะนำของ Technical Lead ทุก open question) |
| acceptanceVersion      | `issue-66-AC-1` |
| Acceptance status      | frozen (2026-10-03, spec อนุมัติ) |

## Problem and scope

เพดานสมาชิกต่อองค์กรอยู่เฉพาะใน server config `membershipLimit: 1000` (`apps/api/src/auth/index.ts:159`) และในข้อความ error "องค์กรมีสมาชิกครบ 1,000 คนแล้ว" owner และ admin ไม่เห็นเพดานก่อนเชิญ หน้าสมาชิกมีเพียง mockup `<MockupFrame label="เพดานจำนวนสมาชิก" issue={66}>`

### User stories จาก issue

1. owner เห็นจำนวนสมาชิกเทียบกับเพดาน เพื่อวางแผนก่อนเชิญ
2. admin รู้เพดานก่อนส่งคำเชิญ
3. viewer เห็นขนาดองค์กรใน status line

- In scope:
  - Response ของรายการสมาชิก (`organizationMemberListResponseSchema` ใน `packages/api-contract/src/auth.ts`) มีเพดานจาก server และ `openapi-types.gen.ts` ถูก regenerate (`OD-66-01`)
  - Status line ของ header หน้า `/organizations/:organizationId/members` แสดงจำนวนสมาชิกเทียบกับเพดาน
  - ลบ mockup ของ #66 ออกจากหน้า
- Non-goals:
  - เปิดหน้าสมาชิกให้ `viewer` หรือ role อื่นนอกจาก `owner`, `admin` (`OD-66-03`)
  - นับคำเชิญที่รอตอบรวมในจำนวนที่แสดง (`OD-66-02`)
  - เพดานต่างกันต่อองค์กร หรือ UI แก้เพดาน
  - แก้ข้อความ error เดิมที่มี "1,000"
  - เปลี่ยนการบังคับเพดานตอนรับคำเชิญ (คงตาม #11)

## Outcome

`owner` และ `admin` เห็นจำนวนสมาชิกและเพดานใน header ก่อนเชิญ งานนี้ไม่วัด outcome metric ผลที่สังเกตได้คือ P66-01..P66-04

## UI flow

1. `owner` หรือ `admin` เปิดหน้าสมาชิก header แสดง slug เหมือนเดิม
2. เมื่อรายการสมาชิกโหลดสำเร็จ status line แสดง "สมาชิกทั้งหมด 12 / 1,000 คน" (ตัวเลขเป็น `font-mono`) แทน "สมาชิกทั้งหมด 12 คน" เดิม
3. ใต้ header ไม่มี mockup "เพดานจำนวนสมาชิก" แล้ว

| Screen | Loading | Empty | Error | Denied | Success |
| ------ | ------- | ----- | ----- | ------ | ------- |
| Status line ของหน้าสมาชิก | แสดงเฉพาะ slug | ไม่มี (องค์กรมีสมาชิกอย่างน้อยหนึ่งคน) | แสดงเฉพาะ slug ส่วน error ของรายการคงเดิม | role ที่อ่านหน้าไม่ได้: พฤติกรรม redirect เดิม | slug และ "สมาชิกทั้งหมด {total} / {limit} คน" |

หน้า offset เกินจำนวน (invalid page) แสดงเฉพาะ slug เหมือน loading

```text
+--------------------------------------------------+
| สมาชิก                                            |
| slug acme · สมาชิกทั้งหมด 12 / 1,000 คน           |
+--------------------------------------------------+
```

## Stories

- `issue-66-S01` ในฐานะ owner ฉันต้องการเห็นจำนวนสมาชิกเทียบกับเพดาน เพื่อวางแผนก่อนเชิญ ครอบคลุม P66-01, P66-02, P66-03, P66-04
- `issue-66-S02` ในฐานะ admin ฉันต้องการรู้เพดานก่อนส่งคำเชิญ ครอบคลุม P66-01, P66-02, P66-03, P66-04
- `issue-66-S03` ในฐานะ viewer ฉันต้องการเห็นขนาดองค์กรใน status line: Not delivered ใน issue นี้ เพราะหน้าสมาชิกอ่านได้เฉพาะ `owner`, `admin` (`OD-66-03`) เป็น follow-up

## Acceptance matrix

AC ID ใช้เลข `P66-NN` Technical Lead เพิ่มแถว Security, Concurrency และ Verification

| AC | Category | Observable behavior | Verification |
| -- | -------- | ------------------- | ------------ |
| P66-01 | Scope | Response ของรายการสมาชิกมีเพดานจำนวนสมาชิกที่ server กำหนด (ค่าเดียวกับ `membershipLimit`) web แสดงค่าจาก response ไม่ hardcode 1000 | Contract test ของ response, เปลี่ยนค่า config แล้ว status line แสดงค่าใหม่ |
| P66-02 | State | เมื่อรายการโหลดสำเร็จ status line แสดง "สมาชิกทั้งหมด {total} / {limit} คน" โดย {total} นับเฉพาะสมาชิก ไม่รวมคำเชิญที่รอตอบ ตัวเลขทั้งสองจัดรูปแบบหลักพันด้วยจุลภาคแบบเดียวกับข้อความ error เดิม (เช่น "1,000") ระหว่าง loading, fetching, error หรือ invalid page ส่วนนี้ไม่แสดง เหลือเฉพาะ slug | องค์กรที่มีสมาชิก 3 คนและคำเชิญรอตอบ 2 รายการแสดง "สมาชิกทั้งหมด 3 / 1,000 คน", จำลอง loading, error และ offset เกินจำนวน |
| P66-03 | Scope | หน้าสมาชิกไม่มี `MockupFrame` "เพดานจำนวนสมาชิก" ของ #66 | Render test ของหน้า |
| P66-04 | Authorization | สิทธิ์อ่านหน้าและรายการสมาชิกคงเดิม: `owner`, `admin` เห็นเพดาน role อื่นไม่ได้รายการสมาชิกหรือเพดานจาก API และหน้าใช้พฤติกรรมเดิม | Request ตรงและ UI ด้วยทุก role |
| P66-05 | Out of scope | ข้อความ error "องค์กรมีสมาชิกครบ 1,000 คนแล้ว" และการบังคับเพดานตอนรับคำเชิญไม่เปลี่ยน | Test เดิมของ #11 ผ่าน |
| P66-06 | Security | `memberLimit` เป็นค่าคงที่ของผลิตภัณฑ์ response ไม่เปิดเผยข้อมูลขององค์กรอื่น และ endpoint ยังรันใน tenant context เดิม | DB route test เดิมของ member list (สิทธิ์และ tenant isolation) ผ่าน |
| P66-07 | Verification | ค่าที่ Better Auth บังคับ (`membershipLimit`) กับ `memberLimit` ใน response มาจาก constant เดียว `ORGANIZATION_MEMBER_LIMIT` | DB route test ว่า response มี `memberLimit: 1000`, review ว่า `apps/api/src/auth/index.ts` ใช้ constant |

## Decisions

ผู้ใช้ให้ใช้ค่าแนะนำของ Technical Lead ทุกข้อเมื่อ 2026-10-03

| Decision | ผล |
| -------- | -- |
| `OD-66-01` | Response ของรายการสมาชิกมี field เพดานจาก server web ไม่ hardcode (แบบเดียวกับ `summary.limit` ของ monitors) |
| `OD-66-02` | เพดานนับเฉพาะสมาชิก ตาม `membershipLimit` ที่ตรวจตอนรับคำเชิญ (#11) จำนวนที่แสดงไม่รวมคำเชิญที่รอตอบ |
| `OD-66-03` | ไม่ขยายสิทธิ์ `viewer` ใน issue นี้ story ของ viewer เป็น Not delivered / follow-up |
| `OD-66-04` | ข้อความ error เดิมที่มี "1,000" คงเดิม |
| `Q-01` | Technical Lead ใช้ข้อเสนอของ Product Owner: "สมาชิกทั้งหมด {total} / {limit} คน" ตัวเลขทั้งสองมีจุลภาคหลักพัน (2026-10-03) |

## Open decisions

| Decision | Owner |
| -------- | ----- |
| `Q-02` Follow-up สำหรับ story ของ viewer (issue ใหม่หรือไม่) | ผู้ใช้ |

## Revisions

| Date | Change | Approved by user | `acceptanceVersion` |
| ---- | ------ | ---------------- | ------------------- |
| 2026-10-03 | ร่างแรกจาก issue #66 และค่าแนะนำของ Technical Lead | ไม่มี (ร่าง) | `issue-66-AC-1` (ร่าง) |
| 2026-10-03 | Technical Lead เพิ่ม P66-06, P66-07, ปิด `Q-01`, freeze พร้อม spec | 2026-10-03 | `issue-66-AC-1` |
