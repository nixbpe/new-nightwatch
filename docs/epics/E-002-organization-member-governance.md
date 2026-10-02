# E-002 การกำกับสมาชิกและการเข้าถึง Organization

| Field | Value |
| ----- | ----- |
| Direction | `DIR-001/v3`, `docs/product-direction.md` ข้อ Scope and trust และ S2 |
| Status | Approved, 2026-09-27 |
| outcome_status | Not measured |
| Owner | Product Owner role; ยังไม่ยืนยันผู้รับผิดชอบรายบุคคล |

## Outcome

ผู้ดูแล Organization ทราบว่าใครเป็นสมาชิกของ Organization ที่เลือก และจัดการการเชิญ บทบาท และการพ้นสมาชิกได้ภายในขอบเขตสิทธิ์ของตน สมาชิกออกจาก Organization ของตนเองได้ เมื่อสมาชิกพ้นสภาพ การเข้าถึง Organization เดิมถูกปฏิเสธโดยไม่กระทบ membership ของ Organization อื่น และทุก Organization ยังมี `owner` อย่างน้อยหนึ่งคน

ขอบเขตผลลัพธ์นี้ตรวจได้ตามพฤติกรรมและหลักฐานของ `F-004-AC-3`; ยังไม่มีนิยาม metric, หน่วย ประชากร ช่วงเวลา แหล่งข้อมูล baseline หรือ guardrail สำหรับตัดสินผลลัพธ์เชิงปริมาณ จึงคง `outcome_status: Not measured` การผ่าน acceptance ของ Feature ไม่ใช่หลักฐานว่าผลลัพธ์ Epic เกิดขึ้นหรือได้รับอนุญาตให้ release

## ขอบเขตและกฎสำคัญ

- Organization เป็นขอบเขตการแยกข้อมูล ผู้ใช้ที่เป็นสมาชิกหลาย Organization ไม่ได้รับสิทธิ์ดูหรือจัดการสมาชิกข้าม Organization จาก membership ของอีกแห่ง
- การกำกับสมาชิกครอบคลุมรายชื่อสมาชิก การสร้างคำเชิญ การเปลี่ยน role การถอนสมาชิก และการออกจาก Organization ด้วยตนเอง ตาม permission และสถานะที่กำหนดใน `F-004` และการดู ส่งซ้ำ และยกเลิกคำเชิญที่ยังไม่ตอบรับตาม `F-006` การสร้างคำเชิญยังไม่ทำให้ผู้รับเป็นสมาชิก
- การเปลี่ยน role การถอน และการออกต้องรักษา owner อย่างน้อยหนึ่งคน คำขอที่อ้าง Organization เดิมหลังพ้นสมาชิกต้องไม่คงสิทธิ์ไว้
- Epic นี้กำกับ Organization membership lifecycle ส่วน Project visibility เป็น initiative แยกต่างหากและไม่เปลี่ยน Epic นี้เป็นสิทธิ์ระดับ Project

## Features

| Feature | Summary | Status |
| ------- | ------- | ------ |
| `F-004`, `docs/features/F-004-organization-member-management/feature.md` | จัดการสมาชิกของ Organization ที่เลือกผ่านรายชื่อ คำเชิญ role การถอน และการออกด้วยตนเอง โดยคง isolation และ last-owner invariant | Selected; `delivery_status: Refining`, `acceptanceVersion: F-004-AC-3` frozen |
| `F-006`, `docs/features/F-006-pending-invitation-management/feature.md` | ดู ส่งซ้ำ และยกเลิกคำเชิญที่ยังไม่ตอบรับของ Organization ที่เลือก | Selected; `delivery_status: Refining`, scope approved 2026-10-01, `acceptanceVersion: F-006-AC-1` draft |
| `F-007`, `docs/features/F-007-organization-audit-log/feature.md` | บันทึกกิจกรรมที่สำเร็จของ Organization ที่เลือก ให้ `owner`/`admin`/`auditor` อ่าน และ `owner`/`admin` ส่งออก | Selected; `delivery_status: Refining`, scope approved 2026-10-02, `acceptanceVersion: F-007-AC-2` frozen (2026-10-03) |

สถานะ frozen ของ acceptance ไม่อนุญาตให้เริ่ม implementation หรือ release

## Out of scope

- การสร้างหรือลบ Organization; การจัดการบัญชี รหัสผ่าน MFA หรือการลบบัญชีผู้ใช้
- การกำหนดสิทธิ์หรือการมองเห็นระดับ Project ซึ่งอยู่นอก Epic นี้
- Bulk member actions
- Cloud IAM/GRC, รายงาน compliance และการเก็บ customer credentials หรือ sensitive evidence
- API/schema/หน้าจอที่เลือกใช้ วิธี implement, วันส่งมอบ, การอนุมัติ release และ metric เป้าหมาย

## Risks and dependencies

| ID | ความเสี่ยง: เหตุ / ผลกระทบ | หลักฐาน | เจ้าของ | การลดความเสี่ยง / trigger / ทบทวนครั้งถัดไป |
| -- | -------------------------- | -------- | ------- | ------------------------------------------ |
| `E-002-R01` | การอ่านหรือแสดงข้อมูลสมาชิกผิด Organization อาจเปิดเผยชื่อและอีเมลข้าม tenant | `DIR-001/v3` Scope and trust; `F-004` ขอบเขตและ `AC-01`, `AC-04`, `AC-16` | ยังไม่ยืนยัน | ยึดขอบเขต isolation และตรวจหลักฐานตาม AC ที่ frozen; ทบทวนจาก implementation evidence ก่อน release |
| `E-002-R02` | สิทธิ์ actor/target ที่เปลี่ยนหรือคำขอแข่งกันอาจเพิ่มสิทธิ์ผิดกฎหรือทำให้ไม่มี `owner` | `F-004` permission matrix และ `AC-05`, `AC-08`, `AC-10`, `AC-12`, `AC-14` | ยังไม่ยืนยัน | ตรวจสิทธิ์ปัจจุบันและ last-owner invariant ตาม Feature; ทบทวนจาก concurrency evidence ก่อน release |
| `E-002-R03` | สิทธิ์หรือข้อมูลเดิมอาจค้างหลังพ้นสมาชิกหรือสลับ Organization | `F-004` UI flow และ `AC-15`–`AC-16` | ยังไม่ยืนยัน | ตรวจการปฏิเสธคำขอหลังพ้นสมาชิกและ scope transition ตาม Feature; ทบทวนจาก browser/API evidence ก่อน release |

ไม่มี `blocked_by` ที่ยืนยันสำหรับการร่าง Epic นี้ Epic ได้รับอนุมัติแล้ว แต่ยังขาดผู้รับผิดชอบรายบุคคล นิยามและแหล่งข้อมูลสำหรับวัด outcome และ start authorization Project visibility เป็น initiative แยกที่ต้องรักษาขอบเขต interface เมื่อวางแผนร่วมกัน แต่ไม่ใช่ prerequisite หรือ Feature ของ `E-002`

## Traceability

| Source | Epic rule / boundary |
| ------ | -------------------- |
| `docs/product-direction.md`, `DIR-001/v3` Scope and trust | หนึ่งลูกค้าเป็นหนึ่ง Organization และเป็น isolation boundary |
| `docs/product-direction.md`, `DIR-001/v3` S2, S3 | Access governance เป็นความสามารถที่อาจมีภายหลัง; Direction ไม่อนุญาตการเก็บ credentials หรือ sensitive evidence |
| `docs/features/F-006-pending-invitation-management/feature.md`, scope approval 2026-10-01 และ `F-006-AC-1` draft | การดู ส่งซ้ำ และยกเลิกคำเชิญที่ยังไม่ตอบรับเป็นสัญญาของ Feature ที่เลือก |
| `docs/features/F-004-organization-member-management/feature.md`, scope approval 2026-09-27 และ `F-004-AC-3` frozen (2026-10-03) | ขอบเขตห้า operation, pagination, member hard cap, permission, owner invariant, การพ้นสมาชิก และการสลับ scope เป็นสัญญาของ Feature ที่เลือก ไม่ได้ถูกนิยาม AC ซ้ำใน Epic |

## Readiness

ผู้ใช้อนุมัติ `E-002` เป็น initiative สำหรับ `F-004` เมื่อ 2026-09-27 โดย `F-004-AC-2` frozen และ Technical Spec ได้รับอนุมัติแล้ว ยังไม่มีผู้รับผิดชอบรายบุคคล นิยามและแหล่งข้อมูลสำหรับวัด outcome หรือ start authorization การอนุมัติ Epic ไม่กำหนดวันที่ส่งมอบหรืออนุญาต release

## Change log

| Date | Change | Approval |
| ---- | ------ | -------- |
| 2026-10-01 | นำ "การแสดง ยกเลิก หรือส่งคำเชิญค้างซ้ำ" ออกจาก Out of scope (คง bulk member actions), เพิ่ม `F-006` เป็น candidate Feature และเปลี่ยนการอ้าง Direction จาก `DIR-001/v2` เป็น `DIR-001/v3` | ผู้ใช้อนุมัติการเปลี่ยน scope ผ่าน AskUserQuestion เมื่อ 2026-10-01 |
| 2026-10-01 | เปลี่ยน `F-006` จาก Candidate เป็น Selected หลังผู้ใช้อนุมัติ scope ของ Feature | ผู้ใช้สั่ง "Approve feature" เมื่อ 2026-10-01 |
| 2026-10-02 | นำ "audit report UI" ออกจาก Out of scope และเพิ่ม `F-007` เป็น candidate Feature (`F-007` `OD-01`) | ผู้ใช้ตัดสินผ่าน coordinator เมื่อ 2026-10-02 |
| 2026-10-03 | อ้าง `F-004-AC-3` แทน `F-004-AC-2` (Outcome, Features, Traceability) และเปลี่ยน `F-007-AC-1` เป็น frozen ส่วน Readiness คงข้อความเดิมเพราะบันทึกการอนุมัติเมื่อ 2026-09-27 | ผู้ใช้ออก `F-004-AC-3` และอนุมัติ Technical Spec ของ `F-007` ผ่าน coordinator เมื่อ 2026-10-03 |
| 2026-10-03 | อ้าง `F-007-AC-2` แทน `F-007-AC-1` (แถว "หมดอายุ" มี `ขอใหม่` ใน `AC-16`) | ผู้ใช้ตัดสิน UX `M-9` ผ่าน coordinator (AskUserQuestion) เมื่อ 2026-10-03 |
| 2026-10-02 | เปลี่ยน `F-007` จาก Candidate เป็น Selected หลังผู้ใช้อนุมัติ scope ของ Feature | ผู้ใช้สั่ง "approve E-002" เมื่อ 2026-10-02 |
