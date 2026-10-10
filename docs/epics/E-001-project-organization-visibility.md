# E-001 โครงสร้าง Project ภายใต้ Organization และสมาชิก Project

| Field          | Value                                    |
| -------------- | ---------------------------------------- |
| Direction      | `DIR-001 / v4`, `docs/product-direction.md` |
| Status         | Draft                                    |
| outcome_status | Not measured                             |
| Owner          | Product Owner role; ยังไม่ยืนยันผู้รับผิดชอบรายบุคคล |

## Outcome

ผู้ใช้จัดงานเป็น Project ภายใต้ Organization เลือกสมาชิก Project จากสมาชิกของ Organization ได้ และกำหนดบทบาทใน Project เป็นผู้ดูแลหรือสมาชิก

Owner และ Admin ของ Organization มองเห็นและจัดการทุก Project ภายใน Organization ของตนโดยไม่ต้องเป็นสมาชิก Project ข้อยกเว้นนี้ไม่ให้สิทธิ์ข้าม Organization

ผู้ใช้สลับ Project ได้จาก sidebar และทุกหน้าที่ทำงานกับข้อมูลของ Project อยู่ใต้ Project ที่เลือก

## ขอบเขตและกฎสำคัญ

- Project เป็นโครงสร้างย่อยภายใต้ Organization และต้องสังกัด Organization เดียวตลอดอายุ
- Organization เป็น isolation boundary ตาม `DIR-001`; ผู้ใช้ที่เป็นสมาชิกหลาย Organization ไม่ได้รับสิทธิ์มองเห็นข้อมูลข้าม Organization
- สมาชิก Project ต้องเป็นสมาชิกของ Organization เดียวกันอยู่แล้ว
- บทบาทใน Project มีสองค่าเท่านั้น: ผู้ดูแล (`admin`) และสมาชิก (`member`)
- ผู้ดูแล Project เพิ่มและนำสมาชิกออก เปลี่ยนบทบาท และแก้ไขการตั้งค่า Project ได้ สมาชิก Project ดูและทำงานใน Project ได้แต่จัดการสมาชิกไม่ได้
- Project ต้องมีผู้ดูแลอย่างน้อย 1 คนเสมอ
- สมาชิกของ Organization ที่ไม่ได้เป็นสมาชิก Project และไม่ใช่ Owner หรือ Admin จะไม่เห็น Project นั้น
- Owner และ Admin สร้าง แก้ไข และลบ Project ได้ และมีสิทธิ์เท่าผู้ดูแลในทุก Project ของ Organization
- เมื่อ role ใน Organization เปลี่ยน สิทธิ์ที่ได้จาก Owner หรือ Admin มีผลหรือหมดผลทันที โดยบทบาทใน Project ที่มีอยู่ยังคงเดิม
- เมื่อนำ member ออกจาก Organization สมาชิกภาพในทุก Project ของ Organization นั้นถูกยกเลิกทันที
- Project ไม่สามารถย้ายข้าม Organization ได้
- การตั้งค่าทั่วไปของ Project ประกอบด้วยชื่อ slug และคำอธิบาย โดยคำอธิบายเป็น optional

## Features

| Feature | Summary | Status |
| ------- | ------- | ------ |
| `F-001` | สร้าง แก้ไข และลบ Project ภายใต้ Organization พร้อมหน้ารายการ Project ทั้งหมด | Candidate / Draft |
| `F-002` | สมาชิก Project จากสมาชิกของ Organization พร้อมบทบาทผู้ดูแลหรือสมาชิก และกฎผู้ดูแลอย่างน้อย 1 คน | Candidate / Draft |
| `F-003` | ปรับสิทธิ์ทันทีเมื่อ role หรือ Organization membership เปลี่ยน | Candidate / Draft |
| `F-004` | Sidebar ตาม Project และตัวสลับ Project | Candidate / Draft |

Feature ในตารางเป็น candidate scope ของ Epic ไม่ใช่ Feature specifications, Stories, ลำดับการส่งมอบ หรือการอนุญาตเริ่ม implementation งานในแต่ละ Project (ภาพรวมและการตรวจสถานะบริการ) อยู่ใน `E-003` และการเชื่อมต่อ AWS อยู่ใน `E-004`

## Out of scope

- การเปรียบเทียบหรือมองเห็น Projects ข้าม Organization
- การย้าย Project ข้าม Organization
- บทบาทใน Project นอกเหนือจากผู้ดูแลและสมาชิก
- การเชิญคนที่ยังไม่ได้เป็นสมาชิก Organization เข้า Project โดยตรง
- access governance ในระดับที่กว้างกว่าสมาชิก Project

## Decisions confirmed for this draft

| Decision | Confirmed behavior |
| -------- | ------------------ |
| Project administration | Owner และ Admin สร้าง แก้ไข ลบทุก Project; ผู้ดูแล Project แก้ไขการตั้งค่าและสมาชิกของ Project ตน |
| Project roles | ผู้ดูแลและสมาชิกเท่านั้น (คำตอบของผู้ใช้ 2026-10-11 แทนการ assign visibility อย่างเดียวใน draft ก่อนหน้า) |
| Owner/Admin visibility | Owner และ Admin เห็นทุก Project ภายใน Organization โดยไม่ต้องเป็นสมาชิก Project |
| Default member visibility | สมาชิก Organization ที่ไม่ได้เป็นสมาชิก Project ไม่เห็น Project นั้น |
| Permission lifecycle | การเปลี่ยน role มีผลทันที; การออกจาก Organization ยกเลิกสมาชิกภาพ Project ทันที |
| Organization transfer | Project ไม่สามารถย้ายข้าม Organization ได้ |

## Risks and dependencies

- `R-01`: การบังคับใช้สิทธิ์ Project ไม่ครบทุกเส้นทางเข้าถึงอาจทำให้ผู้ใช้เห็นข้อมูลของ Project ที่ไม่ได้เป็นสมาชิก; `F-002` และ Technical Spec ต้องกำหนด acceptance criteria ครอบคลุมทุก route ที่รับ Project
- `R-02`: การเปลี่ยน role หรือ membership ที่ไม่ปรับสิทธิ์พร้อมกันอาจทำให้สิทธิ์ค้าง; `F-003` ต้องกำหนดพฤติกรรมแบบทันทีเป็น acceptance criterion
- `R-03`: การนำผู้ดูแลคนสุดท้ายออกพร้อมกันสองคำขออาจทำให้ Project ไม่มีผู้ดูแล; Technical Spec ต้องกำหนดผลของ race นี้

## Traceability

| Source | Epic rule |
| ------ | --------- |
| คำขอและคำตอบของผู้ใช้สำหรับ Epic นี้ | Project อยู่ใต้ Organization, สมาชิกจาก Organization, บทบาทผู้ดูแลและสมาชิก, Owner/Admin exception, sidebar และตัวสลับ Project |
| Design canvas `Project Management` (https://claude.ai/artifact/HUGVYxVNVu4Td7ebbN4n9H) | หน้ารายการ Project, สมาชิก Project, dialog เพิ่มสมาชิก, sidebar และตัวสลับ Project |
| `DIR-001` D7 | การเปรียบเทียบ Projects อยู่ภายในลูกค้าเดียว |
| `DIR-001` Scope and trust | Organization เป็น isolation boundary และ Project ถือ authorized cloud scope กับ observations |

## Readiness

Epic อยู่ในสถานะ Draft ยังไม่มีหลักฐานการอนุมัติ Epic การยืนยันผู้รับผิดชอบรายบุคคล หรือการอนุญาตเริ่ม implementation
