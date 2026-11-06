# E-001 โครงสร้าง Project ภายใต้ Organization และสมาชิก Project

| Field          | Value                                                |
| -------------- | ---------------------------------------------------- |
| Direction      | `DIR-001 / v4`, `docs/product-direction.md`          |
| outcome_status | Not measured                                         |
| Owner          | Product Owner role; ยังไม่ยืนยันผู้รับผิดชอบรายบุคคล |

## Outcome

ผู้ใช้จัดงานเป็น Project ภายใต้ Organization เลือกสมาชิก Project จากสมาชิกของ Organization ได้ และกำหนดบทบาทใน Project เป็นผู้ดูแลหรือสมาชิก

Owner และ Admin ของ Organization มองเห็นและจัดการทุก Project ภายใน Organization ของตนโดยไม่ต้องเป็นสมาชิก Project ข้อยกเว้นนี้ไม่ให้สิทธิ์ข้าม Organization

ผู้ใช้สลับ Project ได้จาก sidebar และทุกหน้าที่ทำงานกับข้อมูลของ Project อยู่ใต้ Project ที่เลือก

## ขอบเขตและกฎสำคัญ

- Project เป็นโครงสร้างย่อยภายใต้ Organization และต้องสังกัด Organization เดียวตลอดอายุ
- Organization เป็น isolation boundary ตาม `DIR-001`; ผู้ใช้ที่เป็นสมาชิกหลาย Organization ไม่ได้รับสิทธิ์มองเห็นข้อมูลข้าม Organization
- สมาชิก Project ต้องเป็นสมาชิกของ Organization เดียวกันอยู่แล้ว
- รายชื่อสำหรับเพิ่มสมาชิกไม่รวมผู้ที่เป็นสมาชิก Project แล้ว โดยกรองก่อนจำกัดจำนวนผลลัพธ์ การเพิ่มสมาชิกคนเดิมซ้ำถือว่าสำเร็จโดยไม่สร้างสมาชิกซ้ำ
- บทบาทใน Project มีสองค่าเท่านั้น: ผู้ดูแล (`admin`) และสมาชิก (`member`)
- ผู้ดูแล Project เพิ่มและนำสมาชิกออก เปลี่ยนบทบาท และแก้ไขการตั้งค่า Project ได้ สมาชิก Project ดูและทำงานใน Project ได้แต่จัดการสมาชิกไม่ได้
- Project ต้องมีผู้ดูแลอย่างน้อย 1 คนเสมอ
- สมาชิกของ Organization ที่ไม่ได้เป็นสมาชิก Project และไม่ใช่ Owner หรือ Admin จะไม่เห็น Project นั้น
- Owner และ Admin สร้าง แก้ไข และลบ Project ได้ และมีสิทธิ์เท่าผู้ดูแลในทุก Project ของ Organization
- เมื่อ role ใน Organization เปลี่ยน สิทธิ์ที่ได้จาก Owner หรือ Admin มีผลหรือหมดผลทันที โดยบทบาทใน Project ที่มีอยู่ยังคงเดิม
- เมื่อนำ member ออกจาก Organization สมาชิกภาพในทุก Project ของ Organization นั้นถูกยกเลิกทันที
- Project ไม่สามารถย้ายข้าม Organization ได้
- ข้อมูลที่สังกัด Project ต้องอ้าง Project ในองค์กรเดียวกัน การลบ Project ต้องลบข้อมูลลูกด้วย หากต้องเก็บกวาดแบบที่ทำผ่าน cascade ไม่ได้ ต้องกำหนดขั้นตอนลบ Project ก่อนเพิ่มความสามารถนั้น
- การตั้งค่าทั่วไปของ Project ประกอบด้วยชื่อไม่เกิน 80 ตัวอักษร และคำอธิบาย optional ไม่เกิน 500 ตัวอักษร นับหลัง trim เป็น Unicode code points; slug ใช้ `^[a-z0-9-]{3,40}$` ไม่ซ้ำในองค์กรและเปลี่ยนไม่ได้หลังสร้าง
- องค์กรหนึ่งมี Project ได้ไม่เกิน 50 Project
- ผู้ใช้ทุก role ในองค์กร (รวมผู้ชมและผู้ตรวจสอบ) เป็นผู้ดูแลหรือสมาชิก Project ได้
- นำ member ที่เป็นผู้ดูแลคนสุดท้ายของ Project ใด ๆ ออกจากองค์กรไม่ได้ ต้องตั้งผู้ดูแลคนอื่นก่อน
- การสร้างและลบ Project สงวนให้ Owner และ Admin ขององค์กร ผู้ดูแล Project แก้ไข Project ได้แต่ลบไม่ได้จากบทบาท Project เพียงอย่างเดียว
- ผู้ที่ไม่ใช่สมาชิกองค์กรได้ `403 MEMBERSHIP_DENIED` ก่อนค้นหา Project; ภายในองค์กร Project ที่เข้าไม่ได้ตอบ `404 PROJECT_NOT_FOUND` เหมือนไม่มีอยู่ ผู้ที่อ่านได้แต่ไม่มีสิทธิ์ทำรายการนั้นได้ `403 PERMISSION_DENIED`
- การเขียนที่ล็อกทั้ง Organization และ Project ต้องล็อก Organization ก่อน Project และอ่านบทบาทที่ใช้ตัดสินสิทธิ์หลังได้ล็อกที่คุ้มครองบทบาทนั้น

## Features

| Feature | Summary                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------- |
| `F-001` | สร้าง แก้ไข และลบ Project ภายใต้ Organization พร้อมหน้ารายการ Project ทั้งหมด                   |
| `F-002` | สมาชิก Project จากสมาชิกของ Organization พร้อมบทบาทผู้ดูแลหรือสมาชิก และกฎผู้ดูแลอย่างน้อย 1 คน |
| `F-003` | ปรับสิทธิ์ทันทีเมื่อ role หรือ Organization membership เปลี่ยน                                  |
| `F-010` | Sidebar ตาม Project และตัวสลับ Project                                                          |

ตารางนี้จัดกลุ่มขอบเขต ไม่รายงานสถานะส่งมอบหรืออนุญาตเริ่มงาน ขอบเขตงานใช้คำขอหรือ issue ปัจจุบัน ภาพรวมและการตรวจสถานะบริการอยู่ใน `E-003` และการเชื่อมต่อ AWS อยู่ใน `E-004`

## Out of scope

- การเปรียบเทียบหรือมองเห็น Projects ข้าม Organization
- การย้าย Project ข้าม Organization
- บทบาทใน Project นอกเหนือจากผู้ดูแลและสมาชิก
- การเชิญคนที่ยังไม่ได้เป็นสมาชิก Organization เข้า Project โดยตรง
- access governance ในระดับที่กว้างกว่าสมาชิก Project

## Risks and dependencies

- `R-01`: ต้องตรวจสิทธิ์ทุกเส้นทางที่รับ Project เพื่อไม่ให้เห็นข้อมูลของ Project ที่ไม่ได้เป็นสมาชิก
- `R-02`: การเปลี่ยน role หรือ membership ต้องมีผลต่อสิทธิ์ทันที
- `R-03`: คำขอแข่งกันต้องไม่ทำให้ Project ไม่มีผู้ดูแล

## Traceability

| Source                                                                                 | Epic rule                                                                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| คำขอและคำตอบของผู้ใช้สำหรับ Epic นี้                                                   | Project อยู่ใต้ Organization, สมาชิกจาก Organization, บทบาทผู้ดูแลและสมาชิก, Owner/Admin exception, sidebar และตัวสลับ Project |
| Design canvas `Project Management` (https://claude.ai/artifact/HUGVYxVNVu4Td7ebbN4n9H) | หน้ารายการ Project, สมาชิก Project, dialog เพิ่มสมาชิก, sidebar และตัวสลับ Project                                             |
| `DIR-001` D7                                                                           | การเปรียบเทียบ Projects อยู่ภายในลูกค้าเดียว                                                                                   |
| `DIR-001` Scope and trust                                                              | Organization เป็น isolation boundary และ Project ถือ authorized cloud scope กับ observations                                   |
