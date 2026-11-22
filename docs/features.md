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

## การเชื่อมต่อ AWS ขององค์กร

- API: [routes and service](../apps/api/src/aws-connection/) (`registerAwsConnectionRoutes`, `updateOrganizationAwsConnection`), STS seam `awsSts` ใน [app factory](../apps/api/src/app.ts), [STS helper](../packages/shared/src/aws/sts.ts) (`createStsVerifier`), quota [rate limit](../apps/api/src/rate-limit/limiter.ts) (`consumeAwsTestRateLimit`).
- Contract: [AWS connection shapes](../packages/api-contract/src/aws-connection.ts) (`organizationAwsConnectionResponseSchema`, `awsRoleArnSchema`).
- Data: [migration ของ Organization และ Project](../packages/db/migrations/0029_aws_connections_v2.sql) (`org_aws_connections`, `project_aws_connections`).
- Focused tests: [API](../apps/api/src/aws-connection/routes.db.test.ts), [DB/RLS](../packages/db/tests/aws-connections.db.test.ts), [STS helper](../packages/shared/tests/sts.test.ts).
- Web: [Organization AWS page](../apps/web/src/pages/organization-aws/OrganizationAwsPage.tsx) (`/organizations/:organizationId/aws`), [form and disconnect](../apps/web/src/pages/organization-aws/ConnectionCard.tsx), [client](../apps/web/src/lib/api/aws-connection.ts), [loader](../apps/web/src/lib/auth/loaders/awsConnection.ts), menu entry in [nav config](../apps/web/src/components/shell/nav-config.ts).
- Bootstrap: [API bootstrap](../apps/api/src/server.ts) (`startApi`) receives the verifier from [production entry](../apps/api/src/index.ts) or the test-only [e2e entry](../apps/api/src/testing/e2e-server.ts) (fakecloud); [entry isolation test](../apps/api/src/entry-isolation.test.ts).
- Browser: [page tests](../apps/web/src/pages/organization-aws/OrganizationAwsPage.test.tsx), [e2e](../e2e/tests/organization-aws.spec.ts) with [fakecloud helpers](../e2e/support/fakecloud.ts) (requires Docker).

## บันทึกกิจกรรมและส่งออก

[API audit](../apps/api/src/audit/), [Worker audit](../apps/worker/src/audit/), [Web audit](../apps/web/src/pages/audit-log/).

## การแจ้งเตือนในแอป

- API: [Inbox routes](../apps/api/src/notifications/routes.ts) (`registerNotificationInboxRoutes`), [service](../apps/api/src/notifications/service.ts) (`listInbox`, `countUnreadInbox`, `markAllInboxRead`), [runtime list plans](../apps/api/src/notifications/list-plan.db.test.ts).
- Worker: [materialize](../apps/worker/src/materialize.ts).
- Web: [Inbox](../apps/web/src/pages/NotificationsPage.tsx) (`NotificationsPage`), [client and query keys](../apps/web/src/lib/api/notifications.ts) (`fetchNotifications`, `notificationQueryKey`), [loader](../apps/web/src/lib/auth/loaders.ts) (`notificationsLoader`), [scope recovery](../apps/web/src/lib/tenant/bootstrap.ts) (`recoverInboxScope`).
- Contract: [Filter/count shapes](../packages/api-contract/src/notification.ts) (`notificationListResponseSchema`, `notificationCountResponseSchema`), [hostname snapshot migration](../packages/db/migrations/0027_notification_monitor_hostname.sql).
- Focused tests: [API service](../apps/api/src/notifications/service.db.test.ts), [Web inbox](../apps/web/src/pages/NotificationsPage.test.tsx), [loaders](../apps/web/src/lib/auth/loaders.test.tsx).

## Inventory ของ Project (E-005 F-017)

[API](../apps/api/src/inventory/), [parser](../apps/api/src/inventory/file.ts), [กฎรายแถว](../apps/api/src/inventory/rows.ts), [สัญญา](../packages/api-contract/src/inventory.ts), [Web](../apps/web/src/pages/inventory/), [migration](../packages/db/migrations/0030_project_inventory.sql), [browser test](../e2e/tests/inventory.spec.ts).

แก้แถวในระบบ (E-005 F-022 S7.1): [list, เพิ่ม, แก้, ลบรายแถว](../apps/api/src/inventory/row-edit.ts), [ตารางแถวและตัวกรองใน URL](../apps/web/src/pages/inventory/InventoryRowsSection.tsx), [dialog เพิ่มและแก้](../apps/web/src/pages/inventory/RowDialog.tsx), [tooltip และปุ่ม icon](../apps/web/src/components/ui/icon-button.tsx), [ที่มาของแถว, revision และ key ของแถว](../packages/db/migrations/0038_inventory_row_editing.sql), [integration test](../apps/api/src/inventory/row-edit.db.test.ts).

## ยืนยัน CPE/purl ของ inventory (E-005 F-018)

[API mapping](../apps/api/src/inventory/mappings.ts), [routes](../apps/api/src/inventory/mapping-routes.ts), [ค้น NVD CPE dictionary](../apps/api/src/inventory/cpe.ts), [คำสั่ง operator ของตารางกลาง](../apps/api/src/operator/catalog-product-mapping.ts), [สัญญา](../packages/api-contract/src/inventory-mapping.ts), [Web](../apps/web/src/pages/inventory/MappingQueuePage.tsx), [migration](../packages/db/migrations/0031_identifier_mappings.sql), [browser test](../e2e/tests/inventory-mappings.spec.ts).

## ช่องโหว่ของ Project (E-005 F-019)

[API](../apps/api/src/vulnerability/), [client ดึง feed](../packages/shared/src/vulnerability/feeds.ts), [match ราย product](../packages/shared/src/vulnerability/matcher.ts), [SQL ของ run](../packages/db/src/vulnerability-run.ts), [สัญญา](../packages/api-contract/src/vulnerability.ts), [Web](../apps/web/src/pages/vulnerabilities/VulnerabilitiesPage.tsx), [migration](../packages/db/migrations/0032_vulnerability_matching.sql), [browser test](../e2e/tests/vulnerabilities.spec.ts).

## ตรวจ CVE ต่อเนื่อง (E-005 F-020)

[scanner ใน worker](../apps/worker/src/vulnerability/scanner.ts) (role `vulnerability-scanner`, ดู [runbook](runbooks/uptime-monitor.md#run-the-worker-roles)), [SQL ของ run และ schedule](../packages/db/src/vulnerability-run.ts), [loop ประมวลผล unit และ KEV](../packages/shared/src/vulnerability/process.ts), [limiter ของ NVD](../packages/shared/src/rate-limit.ts), [API CVE ใหม่](../apps/api/src/vulnerability/service.ts), [Web](../apps/web/src/pages/vulnerabilities/NewVulnerabilitiesPage.tsx), [migration](../packages/db/migrations/0033_vulnerability_monitoring.sql), [browser test](../e2e/tests/vulnerabilities.spec.ts).

แจ้งเตือน CVE ใหม่ (S4.3 in-app): [สร้าง intent ตอน run จบ](../packages/db/src/vulnerability-run.ts), [intent และผู้รับ](../packages/db/src/notification.ts), [migration](../packages/db/migrations/0034_vulnerability_notifications.sql), [inbox API](../apps/api/src/notifications/service.ts), [Web](../apps/web/src/pages/NotificationsPage.tsx).

Email ของแจ้งเตือน CVE ใหม่ (S4.3): [worker ส่งอีเมล](../apps/worker/src/vulnerability/email.ts) (role `notification-email`, ดู [runbook](runbooks/uptime-monitor.md#run-the-worker-roles)), [คิวและฟังก์ชัน claim](../packages/db/migrations/0035_notification_email_jobs.sql), [mailer ที่ใช้ร่วมกับ API](../packages/shared/src/mailer.ts).

## ลำดับที่ต้องแก้และส่งออก Excel (E-005 F-021)

[ลำดับ KEV, Exposure, EPSS, CVSS](../apps/api/src/vulnerability/priority.ts), [แถวของไฟล์ Excel ราย System](../apps/api/src/vulnerability/export.ts), [service และ route](../apps/api/src/vulnerability/service.ts), [สัญญา](../packages/api-contract/src/vulnerability.ts), [Web](../apps/web/src/pages/vulnerabilities/PriorityPage.tsx), [คำเตือนเกณฑ์ false positive](../apps/web/src/pages/vulnerabilities/SamplePanel.tsx), [browser test](../e2e/tests/vulnerabilities.spec.ts).

VEX triage (S5.3): [บันทึกสถานะ](../apps/api/src/vulnerability/service.ts) (`setTriage`), [ตารางสถานะและ log](../packages/db/migrations/0036_vulnerability_triage.sql), [ลบเมื่อคู่ component กับ CVE หายไป](../packages/db/src/vulnerability-run.ts), [ปุ่มและแสดงสถานะ](../apps/web/src/pages/vulnerabilities/TriageControl.tsx).

## สัญญา API

[Shared contracts](../packages/api-contract/src/).

## ฐานข้อมูลและ migrations

[Database package](../packages/db/), [Auth models](../packages/db/src/schema.ts), [raw SQL contexts](../packages/db/src/tenant-context.ts), [SQL migrations](../packages/db/migrations/), [PostgreSQL test fixture](../packages/db/tests/support/postgres.ts), [fixture integration proofs](../packages/db/tests/postgres-fixture.db.test.ts).

## Toolchain และ CI

[Package scripts](../package.json), [CI workflow](../.github/workflows/ci.yml), [Local services](../compose.yaml), [Worker runtime](../apps/worker/src/index.ts), [Worker commands](../apps/worker/package.json).

## การตรวจพฤติกรรม

[Browser tests](../e2e/tests/), [Playwright configuration](../e2e/playwright.config.ts), [Monitor check fixtures](../e2e/support/monitor-checks.ts), [Quality check routing](../scripts/quality/README.md#check-routing).
