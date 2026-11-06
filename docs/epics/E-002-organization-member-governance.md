# E-002 การกำกับสมาชิกและการเข้าถึง Organization

| Field          | Value                                                             |
| -------------- | ----------------------------------------------------------------- |
| Direction      | `DIR-001`, `docs/product-direction.md` ข้อ Scope and trust และ S2 |
| outcome_status | Not measured                                                      |
| Owner          | Product Owner role; ยังไม่ยืนยันผู้รับผิดชอบรายบุคคล              |

## Outcome

ผู้ดูแล Organization ทราบว่าใครเป็นสมาชิกของ Organization ที่เลือก และจัดการการเชิญ บทบาท และการพ้นสมาชิกได้ภายในขอบเขตสิทธิ์ของตน สมาชิกออกจาก Organization ของตนเองได้ เมื่อสมาชิกพ้นสภาพ การเข้าถึง Organization เดิมถูกปฏิเสธโดยไม่กระทบ membership ของ Organization อื่น และทุก Organization ยังมี `owner` อย่างน้อยหนึ่งคน

ยังไม่มีนิยามและหลักฐานวัด outcome เชิงปริมาณ จึงคง `outcome_status: Not measured` การผ่าน acceptance ของ Feature ไม่ใช่หลักฐานว่าผลลัพธ์ Epic เกิดขึ้นหรือได้รับอนุญาตให้ release

## ขอบเขตและกฎสำคัญ

- Organization เป็นขอบเขตการแยกข้อมูล ผู้ใช้ที่เป็นสมาชิกหลาย Organization ไม่ได้รับสิทธิ์ดูหรือจัดการสมาชิกข้าม Organization จาก membership ของอีกแห่ง
- การกำกับสมาชิกครอบคลุมรายชื่อสมาชิก การสร้างคำเชิญ การเปลี่ยน role การถอนสมาชิก และการออกจาก Organization ด้วยตนเอง ตาม permission และสถานะที่กำหนดใน `F-004` และการดู ส่งซ้ำ และยกเลิกคำเชิญที่ยังไม่ตอบรับตาม `F-006` การสร้างคำเชิญยังไม่ทำให้ผู้รับเป็นสมาชิก
- การเปลี่ยน role การถอน และการออกต้องรักษา owner อย่างน้อยหนึ่งคน คำขอที่อ้าง Organization เดิมหลังพ้นสมาชิกต้องไม่คงสิทธิ์ไว้
- Epic นี้กำกับ Organization membership lifecycle ส่วน Project visibility เป็น initiative แยกต่างหากและไม่เปลี่ยน Epic นี้เป็นสิทธิ์ระดับ Project

## Features

| Feature | Summary                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `F-004` | จัดการสมาชิกของ Organization ที่เลือกผ่านรายชื่อ คำเชิญ role การถอน และการออกด้วยตนเอง โดยคง isolation และ last-owner invariant |
| `F-006` | ดู ส่งซ้ำ และยกเลิกคำเชิญที่ยังไม่ตอบรับของ Organization ที่เลือก                                                               |
| `F-007` | บันทึกกิจกรรมที่สำเร็จของ Organization ที่เลือก ให้ `owner`/`admin`/`auditor` อ่าน และ `owner`/`admin` ส่งออก                   |

ตารางนี้จัดกลุ่มขอบเขต ไม่รายงานสถานะส่งมอบหรืออนุญาตเริ่มงาน ขอบเขตงานใช้คำขอหรือ issue ปัจจุบัน

## Out of scope

- การสร้างหรือลบ Organization; การจัดการบัญชี รหัสผ่าน MFA หรือการลบบัญชีผู้ใช้
- การกำหนดสิทธิ์หรือการมองเห็นระดับ Project ซึ่งอยู่นอก Epic นี้
- Bulk member actions
- Cloud IAM/GRC, รายงาน compliance และการเก็บ customer credentials หรือ sensitive evidence
- API/schema/หน้าจอที่เลือกใช้ วิธี implement, วันส่งมอบ, การอนุมัติ release และ metric เป้าหมาย

## Risks and dependencies

| ID          | ความเสี่ยงที่ต้องป้องกัน                                                               |
| ----------- | -------------------------------------------------------------------------------------- |
| `E-002-R01` | การอ่านหรือแสดงข้อมูลสมาชิกผิด Organization อาจเปิดเผยชื่อและอีเมลข้าม tenant          |
| `E-002-R02` | สิทธิ์ actor/target ที่เปลี่ยนหรือคำขอแข่งกันอาจเพิ่มสิทธิ์ผิดกฎหรือทำให้ไม่มี `owner` |
| `E-002-R03` | สิทธิ์หรือข้อมูลเดิมอาจค้างหลังพ้นสมาชิกหรือสลับ Organization                          |

## Traceability

| Source                                                 | Epic rule / boundary                                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `docs/product-direction.md`, `DIR-001` Scope and trust | หนึ่งลูกค้าเป็นหนึ่ง Organization และเป็น isolation boundary                                             |
| `docs/product-direction.md`, `DIR-001` S2, S3          | ขอบเขต access governance และการเก็บ credentials หรือ sensitive evidence ใช้ข้อกำหนดปัจจุบันของ Direction |
