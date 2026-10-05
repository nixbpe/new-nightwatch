# Repository context index

This index locates contract sources and code entry points. It defines no additional product behavior or approval.

[Repository instructions](../AGENTS.md) route architecture, UI, quality, template and PR rules. [Claude Code instructions](../CLAUDE.md) describe the repository's agent wiring.

## Feature contracts

`feature.md` owns scope, user flows and acceptance. `spec.md` owns technical contracts and revisions. Delivery, acceptance approval and measured product outcomes are separate records.

| Scope | Requirements | Technical contract |
| --- | --- | --- |
| Organization member directory, invitations, roles, revoke and self-leave | [F-004 Feature](features/F-004-organization-member-management/feature.md) | [F-004 Spec](features/F-004-organization-member-management/spec.md) |
| Uptime monitor baseline | [F-005 Feature](features/F-005-uptime-monitor/feature.md) | [F-005 Spec](features/F-005-uptime-monitor/spec.md) |
| Pending invitation list, resend, cancel and operator provisioning | [F-006 Feature](features/F-006-pending-invitation-management/feature.md) | [F-006 Spec](features/F-006-pending-invitation-management/spec.md) |
| Organization audit events and exports | [F-007 Feature](features/F-007-organization-audit-log/feature.md) | [F-007 Spec](features/F-007-organization-audit-log/spec.md) |
| Monitor event feed and last response, extending F-005 | [Issue #58 Feature](features/issue-58-monitor-event-feed/feature.md) | [Issue #58 Spec](features/issue-58-monitor-event-feed/spec.md) |
| Per-monitor alert settings, extending F-005 | None (see spec) | [Issue #60 Spec](features/issue-60-monitor-alert-settings/spec.md) |
| Member-count limit display | [Issue #66 Feature](features/issue-66-member-limit/feature.md) | [Issue #66 Spec](features/issue-66-member-limit/spec.md) |

The [deferred toolchain upgrades](features/tech-stack-upgrade/spec.md) retain their own authorization gates. [Product Direction](product-direction.md), [Project visibility](epics/E-001-project-organization-visibility.md) and [Member governance](epics/E-002-organization-member-governance.md) describe product intent and initiative scope.

## Code entry points

| Area | Paths |
| --- | --- |
| Auth, admission and organization selection | [API auth](../apps/api/src/auth/), [session and selection](../apps/api/src/me/service.ts), [Web loaders](../apps/web/src/lib/auth/loaders.ts) |
| Members and invitations | [API organization module](../apps/api/src/organization-notifications/), [Web members](../apps/web/src/pages/organization-members/), [member page](../apps/web/src/pages/OrganizationMembersPage.tsx), [operator provisioning](../apps/api/src/operator/) |
| Monitors and event feed | [API monitors](../apps/api/src/monitors/), [Worker monitors](../apps/worker/src/monitor/), [Web monitors](../apps/web/src/pages/monitors/) |
| Audit events and exports | [API audit](../apps/api/src/audit/), [Worker audit](../apps/worker/src/audit/), [Web audit](../apps/web/src/pages/audit-log/) |
| Browser-safe API shapes | [API contracts](../packages/api-contract/src/) |
| Schema, RLS and migration history | [Database package](../packages/db/), [SQL migrations](../packages/db/migrations/) |
| Shell and account settings | [Shell components](../apps/web/src/components/shell/), [settings pages](../apps/web/src/pages/settings/) |

## Operational and UI references

- [Authentication behavior](ref/authentication.md) records browser error mapping and session policy.
- [App shell](ref/shell-structure.md) records navigation, overlays and settings reflow.
- [Quality gates](../scripts/quality/README.md) records focused checks, database wrappers, E2E isolation and OpenAPI drift checks.
- [Uptime monitor operations](runbooks/uptime-monitor.md) records worker operation, partitions and credential-key rotation.

## Evidence and delivery history

- [F-005 verification](features/F-005-uptime-monitor/verification.md) records author evidence and unverified paths.
- [F-005 delivery history](features/F-005-uptime-monitor/history.md) and [F-007 delivery history](features/F-007-organization-audit-log/history.md) preserve completed task plans and historical verification instructions. They are read for delivery investigations, not used as new implementation authority.
- [F-004 task specifications](features/F-004-organization-member-management/specs/) preserve delivered node contracts under their recorded acceptance versions.

## Large generated and evidence files

`apps/web/src/lib/api/openapi-types.gen.ts` is generated output. Its generator and drift policy are documented in Quality gates. `bun.lock` and `e2e/bun.lock` belong to their installation boundaries. Logs and screenshots under Feature verification directories are historical evidence for their named runs.

These files remain available for contract, dependency and evidence inspection. This index adds no ignore rules or scanner exclusions.
