# E-004 การเชื่อมต่อบัญชี AWS ของ Project และ Organization

| Field          | Value                                    |
| -------------- | ---------------------------------------- |
| Direction      | `DIR-001 / v4`, `docs/product-direction.md` |
| Status         | Draft                                    |
| outcome_status | Not measured                             |
| Owner          | Product Owner role; ยังไม่ยืนยันผู้รับผิดชอบรายบุคคล |

## Outcome

ผู้ดูแล Project เชื่อม Project กับบัญชี AWS ที่ Project ดูแลได้ และรู้ว่าการเชื่อมต่อใช้งานได้จากผลทดสอบล่าสุด ซึ่งเป็น authorized cloud scope ที่ `DIR-001` ระบุว่า Project ถือ

## ขอบเขตและกฎสำคัญ

- Organization มีบัญชี AWS กลางได้หนึ่งบัญชี เชื่อมด้วยการให้ NightWatch assume role ในบัญชีนั้น
- Project หนึ่งเชื่อมบัญชี AWS ได้หนึ่งบัญชี ด้วยหนึ่งในสองวิธี:
  - Assume role ผ่านบัญชีกลางขององค์กร: เก็บ Role ARN และ External ID เท่านั้น
  - Access key ของบัญชี Project: เก็บแบบเข้ารหัสและ write-only ตาม `DIR-001` S3 v4
- External ID ถูกสร้างโดย NightWatch แยกต่อ Organization และต่อ Project
- บันทึกการเชื่อมต่อได้หลังทดสอบผ่านเท่านั้น
- ผู้แก้ไขการเชื่อมต่อของ Project คือผู้ดูแล Project; ของ Organization คือ Owner และ Admin
- สิทธิ์ใน AWS ที่แนะนำคืออ่านอย่างเดียว เช่น AWS managed policy `SecurityAudit`

## Features

| Feature | Summary | Status |
| ------- | ------- | ------ |
| `F-007` | การเชื่อมต่อบัญชี AWS กลางของ Organization | Candidate / Draft |
| `F-008` | การเชื่อมต่อ AWS ของ Project แบบ assume role ผ่านบัญชีกลาง | Candidate / Draft |
| `F-009` | การเชื่อมต่อ AWS ของ Project แบบ access key | Blocked: รอการอนุมัติ `DIR-001 / v4` S3 |

## Out of scope

- การเก็บข้อมูลหรือ findings จาก AWS หลังเชื่อมต่อ
- การสร้าง role อัตโนมัติด้วย CloudFormation StackSet หรือ AWS Organizations
- การเชื่อมหลายบัญชี AWS ต่อหนึ่ง Project
- cloud provider อื่นนอกจาก AWS (`DIR-001` S1)

## Risks and dependencies

- `R-01`: การเก็บ access key เพิ่ม blast radius ถ้าระบบถูกเจาะ; `F-009` เริ่มได้หลัง `DIR-001 / v4` ได้รับอนุมัติเท่านั้น
- `R-02`: การเรียก AWS STS เป็น protocol ใหม่ ต้องกำหนด SSRF boundary ตามหลัก "Calling outside systems" ใน `docs/architecture.md` ก่อนเพิ่ม
- `R-03`: ARN ของ principal ฝั่ง NightWatch ที่ assume role เข้าบัญชีกลางยังไม่ได้กำหนด
- ต้องมี `F-001` และ `F-002` ก่อน

## Traceability

| Source | Epic rule |
| ------ | --------- |
| คำขอของผู้ใช้เรื่องการเชื่อมต่อ AWS สองแนวทาง | Assume role ผ่านองค์กร และ credential ของบัญชี Project |
| คำตอบของผู้ใช้ 2026-10-11 | แก้ `DIR-001` S3 ให้รองรับ access key |
| Design canvas `Project Management`, แถว "การเชื่อมต่อ AWS" | หน้าการเชื่อมต่อ AWS ของ Project และของ Organization |
| `DIR-001` Scope and trust, S1, S3 | Project ถือ authorized cloud scope, AWS-first, ข้อจำกัดการเก็บ credential |

## Readiness

Epic อยู่ในสถานะ Draft `F-009` ถูก block จนกว่า `DIR-001 / v4` จะได้รับการอนุมัติ
