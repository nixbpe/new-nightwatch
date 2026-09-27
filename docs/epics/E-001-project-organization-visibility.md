# E-001 โครงสร้าง Project ภายใต้ Organization และการมองเห็น Project ของ member

| Field          | Value                                    |
| -------------- | ---------------------------------------- |
| Direction      | `DIR-001 / v2`, `docs/product-direction.md` |
| Status         | Draft                                    |
| outcome_status | Not measured                             |
| Owner          | Product Owner role; ยังไม่ยืนยันผู้รับผิดชอบรายบุคคล |

## Outcome

ผู้ใช้สามารถจัด Project เป็นหน่วยย่อยภายใต้ Organization และกำหนดได้ว่า member แต่ละคนใน Organization มองเห็น Project ใดบ้าง

Owner และ Admin มองเห็นทุก Project ภายใน Organization ของตนโดยไม่ต้อง assign ราย Project ข้อยกเว้นนี้ครอบคลุมเฉพาะการมองเห็น Project และไม่ให้สิทธิ์ข้าม Organization

ระยะแรก Project มีเฉพาะการตั้งค่าชื่อและคำอธิบาย ยังไม่มีฟังก์ชันด้าน cloud security, findings หรือการดำเนินงานอื่นภายใน Project

## ขอบเขตและกฎสำคัญ

- Project เป็นโครงสร้างย่อยภายใต้ Organization และต้องสังกัด Organization เดียวตลอดอายุ
- Organization เป็น isolation boundary ตาม `DIR-001`; ผู้ใช้ที่เป็นสมาชิกหลาย Organization ไม่ได้รับสิทธิ์มองเห็นข้อมูลข้าม Organization
- member ทั่วไปมองเห็นเฉพาะ Project ที่ได้รับ assignment ภายใน Organization ของตน
- member ทั่วไปที่ยังไม่ได้รับ assignment จะไม่เห็น Project ใด
- Owner และ Admin มองเห็นทุก Project ภายใน Organization ของตนโดยไม่ต้อง assign ราย Project
- Owner และ Admin สร้าง แก้ไข และลบ Project รวมถึงกำหนด Project visibility ให้ member ได้
- เมื่อ member ได้รับ role Owner หรือ Admin สิทธิ์มองเห็นทุก Project มีผลทันที
- เมื่อลด role จาก Owner หรือ Admin เป็น member ทั่วไป ระบบใช้ Project assignments ที่มีอยู่ของ member นั้นทันที
- เมื่อนำ member ออกจาก Organization สิทธิ์และ Project assignments ภายใน Organization นั้นถูกยกเลิกทันที
- Project ไม่สามารถย้ายข้าม Organization ได้
- การตั้งค่าทั่วไปของ Project ระยะแรกประกอบด้วยชื่อและคำอธิบาย โดยคำอธิบายเป็น optional

## Features

| Feature | Summary | Status |
| ------- | ------- | ------ |
| `F-001` | สร้างและจัดการ Project ภายใต้ Organization โดยกำหนดชื่อและคำอธิบาย และห้ามย้ายข้าม Organization | Candidate / Draft |
| `F-002` | กำหนด Project visibility ราย member โดย deny by default และให้ Owner/Admin มองเห็นทุก Project ใน Organization | Candidate / Draft |
| `F-003` | ปรับสิทธิ์การมองเห็นทันทีเมื่อ role หรือ Organization membership เปลี่ยน | Candidate / Draft |

Feature ในตารางเป็น candidate scope ของ Epic ไม่ใช่ Feature specifications, Stories, ลำดับการส่งมอบ หรือการอนุญาตเริ่ม implementation

## Out of scope

- ฟังก์ชันภายใน Project นอกเหนือจากการตั้งค่าชื่อและคำอธิบาย
- การจัดการ findings, prioritization, reports, notifications หรือ remediation ภายใน Project
- การเปรียบเทียบหรือมองเห็น Projects ข้าม Organization
- การย้าย Project ข้าม Organization
- สิทธิ์ระดับ action ภายใน Project นอกเหนือจากการจัดการ Project และ Project visibility ที่ระบุใน Epic นี้
- access governance ในระดับที่กว้างกว่าการมองเห็น Project
- API, database schema, RLS policy และรูปแบบหน้าจอ
- การเชื่อมต่อ cloud account และการเก็บ credentials หรือ sensitive evidence

## Decisions confirmed for this draft

| Decision | Confirmed behavior |
| -------- | ------------------ |
| Project administration | Owner และ Admin สร้าง แก้ไข ลบ Project และ assign Project visibility ให้ member ได้ |
| Owner/Admin visibility | Owner และ Admin เห็นทุก Project ภายใน Organization โดยไม่ต้อง assign ราย Project |
| Default member visibility | member ทั่วไปที่ไม่มี assignment ไม่เห็น Project ใด |
| Permission lifecycle | การเปลี่ยน role มีผลทันที; การลด role ใช้ assignments เดิม; การออกจาก Organization ยกเลิกสิทธิ์และ assignments ทันที |
| General settings | Project มีชื่อและ optional description |
| Organization transfer | Project ไม่สามารถย้ายข้าม Organization ได้ |

## Risks and dependencies

- `R-01`: การบังคับใช้ visibility ไม่ครบทุกเส้นทางเข้าถึงอาจทำให้ member เห็นข้อมูลของ Project ที่ไม่ได้รับ assignment; `F-002` ต้องกำหนด acceptance criteria ครอบคลุมทุกการมองเห็น Project
- `R-02`: การเปลี่ยน role หรือ membership ที่ไม่ปรับสิทธิ์พร้อมกันอาจทำให้สิทธิ์ค้าง; `F-003` ต้องกำหนดพฤติกรรมแบบทันทีเป็น acceptance criterion
- `R-03`: การขยาย “การตั้งค่าทั่วไป” เกินชื่อและคำอธิบายจะเปลี่ยนขอบเขต Epic และต้องผ่านการตัดสินใจใหม่
- Feature specifications ต้องกำหนดพฤติกรรมการลบ Project, validation ของชื่อและคำอธิบาย และประสบการณ์เมื่อ member ไม่มี Project ที่มองเห็น โดยไม่เปลี่ยนกฎสิทธิ์ของ Epic นี้

## Traceability

| Source | Epic rule |
| ------ | --------- |
| คำขอและคำตอบของผู้ใช้สำหรับ Epic นี้ | Project อยู่ใต้ Organization, visibility ราย member, Owner/Admin exception, deny by default, permission lifecycle, general settings และข้อห้ามย้าย Project |
| `DIR-001` D7 | การเปรียบเทียบ Projects อยู่ภายในลูกค้าเดียว |
| `DIR-001` Scope and trust | Organization เป็น isolation boundary และ Project ถือ authorized cloud scope กับ observations |
| `DIR-001` S2 | access governance ในวงกว้างเป็นความสามารถที่อาจมีภายหลัง |
| `DIR-001` S3 | Direction ไม่อนุญาตให้เก็บ credentials หรือ sensitive evidence |

## Readiness

Epic อยู่ในสถานะ Draft ยังไม่มีหลักฐานการอนุมัติ Epic การยืนยันผู้รับผิดชอบรายบุคคล หรือการอนุญาตเริ่ม implementation การตัดสินใจระดับ Epic ที่ถามในรอบนี้ได้รับคำตอบแล้ว รายละเอียดพฤติกรรมและ acceptance criteria ต้องกำหนดใน Feature specifications ก่อน implementation
