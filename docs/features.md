# Feature code index

ใช้ชื่อความสามารถเพื่อหาไฟล์ที่เกี่ยวข้อง. รายละเอียดพฤติกรรมดูจากโค้ดและ tests; ขอบเขตงานใช้คำขอหรือ issue ปัจจุบัน.

| ความสามารถ | ไฟล์ที่อ่าน |
| --- | --- |
| เข้าสู่ระบบและเลือกองค์กร | [API auth](../apps/api/src/auth/), [session และ selection](../apps/api/src/me/service.ts), [Web loaders](../apps/web/src/lib/auth/loaders.ts) |
| สมาชิกและคำเชิญ | [API members/invitations](../apps/api/src/organization-notifications/), [accept invitation](../apps/api/src/onboarding/), [Web members](../apps/web/src/pages/organization-members/), [operator provisioning](../apps/api/src/operator/) |
| Project ภายใต้องค์กร | [API projects](../apps/api/src/projects/), [Project contract](../packages/api-contract/src/project.ts), [Web projects](../apps/web/src/pages/projects/), [Web Project members](../apps/web/src/pages/projects/members/), [Web projects client](../apps/web/src/lib/api/projects.ts) |
| Sidebar ตาม Project และตัวสลับ Project | [Shell](../apps/web/src/components/shell/) ([Project switcher](../apps/web/src/components/shell/ProjectSwitcher.tsx), [nav-config](../apps/web/src/components/shell/nav-config.ts)), [API last Project](../apps/api/src/projects/service.ts), [Project ล่าสุด migration](../packages/db/migrations/0025_member_last_project.sql), [พฤติกรรม shell](ref/shell-structure.md) |
| มอนิเตอร์ สถิติ ประวัติ และการแจ้งเตือนรายมอนิเตอร์ | [API monitors](../apps/api/src/monitors/), [Worker monitors](../apps/worker/src/monitor/), [Web monitors](../apps/web/src/pages/monitors/) |
| บันทึกกิจกรรมและส่งออก | [API audit](../apps/api/src/audit/), [Worker audit](../apps/worker/src/audit/), [Web audit](../apps/web/src/pages/audit-log/) |
| การแจ้งเตือนในแอป | [API notifications](../apps/api/src/notifications/), [Worker materialize](../apps/worker/src/materialize.ts), [Web inbox](../apps/web/src/pages/NotificationsPage.tsx) |
| สัญญา API | [Shared contracts](../packages/api-contract/src/) |
| ฐานข้อมูลและ migrations | [Database package](../packages/db/), [SQL migrations](../packages/db/migrations/) |
| Toolchain และ CI | [Package scripts](../package.json), [CI workflow](../.github/workflows/ci.yml), [Local services](../compose.yaml) |
| การตรวจพฤติกรรม | [Browser tests](../e2e/tests/), [Quality commands](../scripts/quality/README.md) |
