# Feature code index

ใช้ชื่อความสามารถเพื่อหาเจ้าของโค้ด แล้วอ่าน symbol, contract และ tests ที่เกี่ยวข้องก่อนขยายไปยัง consumers หรือ shared state ขอบเขตงานและเกณฑ์ยอมรับใช้คำขอหรือ issue ปัจจุบัน ข้อกำหนดร่วมอยู่ในเอกสารอ้างอิงตาม [Repository instructions](../AGENTS.md) รายละเอียด implementation และ configuration อยู่ในโค้ด รายการ tests เป็นจุดเริ่มค้นหา ไม่ใช่ชุด verification ทั้งหมด

## เข้าสู่ระบบและเลือกองค์กร

- API: [Auth](../apps/api/src/auth/index.ts) (`createAuth`), [session และ selection](../apps/api/src/me/service.ts) (`getMeContext`, `resolveActiveOrganization`, `setActiveOrganization`).
- Web: [loaders](../apps/web/src/lib/auth/loaders.ts) (`workspaceLoader`), [tenant state](../apps/web/src/lib/tenant/TenantProvider.tsx) (`TenantProvider`), [active organization](../apps/web/src/lib/tenant/activeOrganization.ts) (`selectActiveOrganization`).
- Browser auth: [client and error mapping](../apps/web/src/lib/auth-client.ts) (`authClient`, `authErrorMessage`), [focused tests](../apps/web/src/lib/auth-client.test.ts).
- Contract: [Auth shapes](../packages/api-contract/src/auth.ts) (`meContextResponseSchema`).
- Focused tests ตามส่วนที่แก้: [Auth boundary](../apps/api/src/auth/auth.db.test.ts), [selection service](../apps/api/src/me/service.db.test.ts), [loaders](../apps/web/src/lib/auth/loaders.test.tsx), [tenant state](../apps/web/src/lib/tenant/TenantProvider.test.tsx), [selector](../apps/web/src/lib/tenant/activeOrganization.test.ts).

## สมาชิกและคำเชิญ

[API members/invitations](../apps/api/src/organization-notifications/), [accept invitation](../apps/api/src/onboarding/), [Web member page](../apps/web/src/pages/OrganizationMembersPage.tsx), [member components](../apps/web/src/pages/organization-members/), [operator provisioning](../apps/api/src/operator/).

## Project ภายใต้องค์กร

[API projects](../apps/api/src/projects/), [Project contract](../packages/api-contract/src/project.ts), [Web projects](../apps/web/src/pages/projects/), [Web Project members](../apps/web/src/pages/projects/members/), [Web projects client](../apps/web/src/lib/api/projects.ts).

## Sidebar ตาม Project และตัวสลับ Project

[Shell](../apps/web/src/components/shell/), [Project switcher](../apps/web/src/components/shell/ProjectSwitcher.tsx), [nav-config](../apps/web/src/components/shell/nav-config.ts), [API last Project](../apps/api/src/projects/service.ts), [Project ล่าสุด migration](../packages/db/migrations/0025_member_last_project.sql).

## Shell และการตั้งค่าบัญชี

[Shell components](../apps/web/src/components/shell/), [settings pages](../apps/web/src/pages/settings/), [Shell tests](../apps/web/src/components/shell/AppShell.test.tsx), [navigation tests](../apps/web/src/components/shell/nav-config.test.ts), [Project switcher tests](../apps/web/src/components/shell/ProjectSwitcher.test.tsx), [settings reflow tests](../e2e/tests/settings.spec.ts).

## ภาพรวมของ Project

[Web overview](../apps/web/src/pages/projects/overview/), [Workspace entry fallback](../apps/web/src/pages/WorkspaceEntryFallback.tsx).

## มอนิเตอร์ สถิติ ประวัติ และการแจ้งเตือนรายมอนิเตอร์ (ภายใต้ Project)

[API monitors](../apps/api/src/monitors/), [สิทธิ์ใน Project](../apps/api/src/projects/access.ts), [Worker monitors](../apps/worker/src/monitor/), [ผู้รับการแจ้งเตือนมอนิเตอร์](../packages/db/src/notification.ts), [Web monitors](../apps/web/src/pages/monitors/), [migration มอนิเตอร์ใต้ Project](../packages/db/migrations/0026_project_monitors.sql), [runbook](runbooks/uptime-monitor.md).

### Response times

- API: [read routes](../apps/api/src/monitors/read-routes.ts) (`registerMonitorReadRoutes`), [read service](../apps/api/src/monitors/read-service.ts) (`getResponseTimes`).
- Web: [Response time card](../apps/web/src/pages/monitors/detail/ResponseTimeCard.tsx) (`ResponseTimeCard`).
- Contract: [Monitor shapes](../packages/api-contract/src/monitor.ts) (`monitorResponseTimesQuerySchema`, `monitorResponseTimesResponseSchema`).
- Focused tests: [API response times](../apps/api/src/monitors/read-response-times.db.test.ts), [Web Detail](../apps/web/src/pages/monitors/DetailPage.test.tsx), เริ่มที่ suites `Detail response-time chart` และ `response-time state and selection`.

## ผลทดสอบการเชื่อมต่อมอนิเตอร์

[Outbound helper](../packages/shared/src/outbound-http/send.ts), [Check executor](../packages/shared/src/monitor-check/run-check.ts), [Test API](../apps/api/src/monitors/test-route.ts), [Test contract](../packages/api-contract/src/monitor.ts), [Test panel](../apps/web/src/pages/monitors/form/TestPanel.tsx).

## บันทึกกิจกรรมและส่งออก

[API audit](../apps/api/src/audit/), [Worker audit](../apps/worker/src/audit/), [Web audit](../apps/web/src/pages/audit-log/).

## การแจ้งเตือนในแอป

- API: [Inbox routes](../apps/api/src/notifications/routes.ts) (`registerNotificationInboxRoutes`), [service](../apps/api/src/notifications/service.ts) (`listInbox`, `countUnreadInbox`, `markAllInboxRead`), [runtime list plans](../apps/api/src/notifications/list-plan.db.test.ts).
- Worker: [materialize](../apps/worker/src/materialize.ts).
- Web: [Inbox](../apps/web/src/pages/NotificationsPage.tsx) (`NotificationsPage`), [client and query keys](../apps/web/src/lib/api/notifications.ts) (`fetchNotifications`, `notificationQueryKey`), [loader](../apps/web/src/lib/auth/loaders.ts) (`notificationsLoader`), [scope recovery](../apps/web/src/lib/tenant/bootstrap.ts) (`recoverInboxScope`).
- Contract: [Filter/count shapes](../packages/api-contract/src/notification.ts) (`notificationListResponseSchema`, `notificationCountResponseSchema`), [hostname snapshot migration](../packages/db/migrations/0027_notification_monitor_hostname.sql).
- Focused tests: [API service](../apps/api/src/notifications/service.db.test.ts), [Web inbox](../apps/web/src/pages/NotificationsPage.test.tsx), [loaders](../apps/web/src/lib/auth/loaders.test.tsx).

## การเชื่อมต่อบัญชี AWS ของ Organization และ Project

[API](../apps/api/src/aws/), [Web](../apps/web/src/pages/aws/), [สัญญา](../packages/api-contract/src/aws-connection.ts), [AWS STS](../packages/shared/src/aws/sts.ts), [migration](../packages/db/migrations/0028_aws_connections.sql), [browser test](../e2e/tests/aws-connections.spec.ts).

## สัญญา API

[Shared contracts](../packages/api-contract/src/).

## ฐานข้อมูลและ migrations

[Database package](../packages/db/), [Auth models](../packages/db/src/schema.ts), [raw SQL contexts](../packages/db/src/tenant-context.ts), [SQL migrations](../packages/db/migrations/), [PostgreSQL test fixture](../packages/db/tests/support/postgres.ts), [fixture integration proofs](../packages/db/tests/postgres-fixture.db.test.ts).

## Toolchain และ CI

[Package scripts](../package.json), [CI workflow](../.github/workflows/ci.yml), [Local services](../compose.yaml), [Worker runtime](../apps/worker/src/index.ts), [Worker commands](../apps/worker/package.json).

## การตรวจพฤติกรรม

[Browser tests](../e2e/tests/), [Playwright configuration](../e2e/playwright.config.ts), [Monitor check fixtures](../e2e/support/monitor-checks.ts), [Quality check routing](../scripts/quality/README.md#check-routing).
