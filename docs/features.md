# Feature code index

ใช้ชื่อความสามารถเพื่อหาไฟล์ที่เกี่ยวข้อง. รายละเอียดพฤติกรรมดูจากโค้ดและ tests; ขอบเขตงานใช้คำขอหรือ issue ปัจจุบัน.

| ความสามารถ | ไฟล์ที่อ่าน |
| --- | --- |
| เข้าสู่ระบบและเลือกองค์กร | [API auth](../apps/api/src/auth/), [session และ selection](../apps/api/src/me/service.ts), [Web loaders](../apps/web/src/lib/auth/loaders.ts) |
| สมาชิกและคำเชิญ | [API members/invitations](../apps/api/src/organization-notifications/), [accept invitation](../apps/api/src/onboarding/), [Web members](../apps/web/src/pages/organization-members/), [operator provisioning](../apps/api/src/operator/) |
| Project ภายใต้องค์กร | [API projects](../apps/api/src/projects/), [Project contract](../packages/api-contract/src/project.ts), [Web projects](../apps/web/src/pages/projects/), [Web Project members](../apps/web/src/pages/projects/members/), [Web projects client](../apps/web/src/lib/api/projects.ts) |
| Sidebar ตาม Project และตัวสลับ Project | [Shell](../apps/web/src/components/shell/) ([Project switcher](../apps/web/src/components/shell/ProjectSwitcher.tsx), [nav-config](../apps/web/src/components/shell/nav-config.ts)), [API last Project](../apps/api/src/projects/service.ts), [Project ล่าสุด migration](../packages/db/migrations/0025_member_last_project.sql), [พฤติกรรม shell](ref/shell-structure.md) |
| ภาพรวมของ Project | [Web overview](../apps/web/src/pages/projects/overview/), [Workspace entry fallback](../apps/web/src/pages/WorkspaceEntryFallback.tsx) |
| มอนิเตอร์ สถิติ ประวัติ และการแจ้งเตือนรายมอนิเตอร์ (ภายใต้ Project) | [API monitors](../apps/api/src/monitors/), [สิทธิ์ใน Project](../apps/api/src/projects/access.ts), [Worker monitors](../apps/worker/src/monitor/), [ผู้รับการแจ้งเตือนมอนิเตอร์](../packages/db/src/notification.ts), [Web monitors](../apps/web/src/pages/monitors/), [migration มอนิเตอร์ใต้ Project](../packages/db/migrations/0026_project_monitors.sql), [runbook](runbooks/uptime-monitor.md) |
| ผลทดสอบการเชื่อมต่อมอนิเตอร์ | [Outbound helper](../packages/shared/src/outbound-http/send.ts), [Check executor](../packages/shared/src/monitor-check/run-check.ts), [Test API](../apps/api/src/monitors/test-route.ts), [Test contract](../packages/api-contract/src/monitor.ts), [Test panel](../apps/web/src/pages/monitors/form/TestPanel.tsx) |
| บันทึกกิจกรรมและส่งออก | [API audit](../apps/api/src/audit/), [Worker audit](../apps/worker/src/audit/), [Web audit](../apps/web/src/pages/audit-log/) |
| การแจ้งเตือนในแอป | [API notifications](../apps/api/src/notifications/), [Worker materialize](../apps/worker/src/materialize.ts), [Web inbox](../apps/web/src/pages/NotificationsPage.tsx), [filter/count contract](../packages/api-contract/src/notification.ts), [hostname snapshot migration](../packages/db/migrations/0027_notification_monitor_hostname.sql), [runtime list plans](../apps/api/src/notifications/list-plan.db.test.ts) |
| สัญญา API | [Shared contracts](../packages/api-contract/src/) |
| ฐานข้อมูลและ migrations | [Database package](../packages/db/), [SQL migrations](../packages/db/migrations/) |
| Toolchain และ CI | [Package scripts](../package.json), [CI workflow](../.github/workflows/ci.yml), [Local services](../compose.yaml) |
| การตรวจพฤติกรรม | [Browser tests](../e2e/tests/), [Quality commands](../scripts/quality/README.md) |
