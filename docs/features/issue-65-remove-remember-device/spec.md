# Issue #65 Technical Spec

| Field | Value |
| --- | --- |
| Issue | [#65](https://github.com/nixbpe/new-nightwatch/issues/65), ยกเลิก checkbox จดจำอุปกรณ์ 30 วันในหน้าเข้าสู่ระบบ |
| Epic | None |
| Status | Approved |
| Approved by user | 2026-10-03, ผู้ใช้สั่งยกเลิก checkbox และคง default session 7 วัน |
| Start authorization | 2026-10-03, ผู้ใช้สั่งเขียน spec, implement และเปิด PR เพื่อปิด #65 |
| `COMMIT_MODE` | owned-slice |
| `STOP_AT` | review-ready, เปิด PR โดยไม่ merge |

## Contracts

### Web

- `/login` ไม่มี mockup checkbox “จดจำอุปกรณ์นี้ 30 วัน”, notice และลิงก์ #65 ของ mockup นี้
- ฟอร์มเข้าสู่ระบบยังส่งเฉพาะ `email` และ `password` ผ่าน `authClient.signIn.email`, ไม่เพิ่ม `rememberMe`
- ข้อความติดต่อผู้ดูแลองค์กร, ลิงก์ลืมรหัสผ่าน, validation, pending state และการ redirect คงเดิม
- ลบ assertions ที่ยืนยัน mockup ของ #65, คง assertions ของการยกเลิกลิงก์ช่วยเหลือ #67 และ login payload

### Authorization and security

- `apps/api/src/auth/index.ts` ไม่เปลี่ยน, ไม่เพิ่ม `session.expiresIn` หรือการตั้งค่า cookie
- Better Auth `1.6.23` ใช้ session default 7 วันและ refresh ตาม default เดิม, ไม่กำหนดอายุสูงสุดแบบตายตัวจากวัน login
- การไม่ส่ง `rememberMe` ยังคง default `true`, ไม่มีข้อกำหนดใหม่ให้ logout เมื่อปิด browser
- Checkbox `trustDevice` ใน `/two-factor`, การ verify TOTP/recovery code และ trusted-device default 30 วันคงเดิม

## Design decisions

- สมมติฐาน: “ลบหน้า mockup” หมายถึงลบกรอบ mockup ของ #65 ใน `/login`, คงหน้าเข้าสู่ระบบจริง
- ยกเลิกข้อเสนอเพิ่ม checkbox ตามคำสั่งผู้ใช้, PR ปิด issue ด้วยเหตุผลนี้
- ลบ import `MockupFrame` และ `within` ที่การเปลี่ยนนี้ทำให้ไม่ถูกใช้
- คง shared `MockupFrame`/`MockupNotice` เพราะหน้าอื่นยังใช้งาน
- Non-goals: API, DB/RLS, queues, dependencies, session policy และ 2FA

## Acceptance

| ID | Requirement | Verification |
| --- | --- | --- |
| AC-01 | ลบ mockup checkbox 30 วันและลิงก์ #65 จาก `/login` | ตรวจ diff และหน้า login ในทั้งสอง theme |
| AC-02 | ลบ test assertions ที่ผูกกับ mockup #65, คง regression ของ #67 และ login payload | `LoginPage.test.tsx` ผ่าน |
| AC-03 | คง session default 7 วันและ trusted device ของ 2FA | ตรวจว่า API auth, auth client และ `TwoFactorPage.tsx` ไม่มี diff, tests ของ login และ 2FA ผ่าน |

## Tasks

### NODE-65-1 Remove cancelled login mockup

- **OWNER:** Technical Lead
- **READY:** ผู้ใช้อนุมัติ scope และสั่งเริ่มงานแล้ว
- **OUTCOME:** `/login` ไม่มีข้อเสนอ checkbox 30 วัน
- **SOURCE:** Contracts และ AC-01 ถึง AC-03
- **INVARIANTS:** login payload, session default และ 2FA คงเดิม
- **FILES:** `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/pages/LoginPage.test.tsx`, spec นี้
- **NON-GOALS:** ลบหน้า login หรือ shared mockup component, เพิ่ม checkbox หรือ session configuration
- **CONTRACTS:** ไม่มี task ร่วมที่ต้องเปลี่ยน API
- **VERIFY:** focused login/2FA tests, Web lint และ typecheck
- **PROOF:** diff, test results และสถานะ gates ใน PR
- **COVERS:** AC-01, AC-02, AC-03

## Integrated verification

- รัน `bun run validate` และ `bun run build`, รายงาน gates ที่ไม่ได้รันใน PR ตาม `.github/PULL_REQUEST_TEMPLATE.md`
- ตรวจ UI desktop `1440×900` ทั้ง light/dark, บันทึกข้อจำกัดหากยังไม่มี screenshot evidence
- เปิด PR ที่ระบุ `Closes #65`, ไม่ merge และไม่เปลี่ยนสถานะ issue ก่อน PR merge

## Open decisions

None.
