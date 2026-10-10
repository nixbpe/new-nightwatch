# Repository context index

This index locates contract sources and code entry points. It defines no additional product behavior or approval.

[Repository instructions](../AGENTS.md) route architecture, UI, quality, template and PR rules. [Claude Code instructions](../CLAUDE.md) describe the repository's agent wiring.

## Feature contracts

[Feature code index](features.md) maps capability names to source files without Feature or issue IDs. Detailed criteria and design belong to the current request or issue. Inspect API contracts, migrations and tests through the code entry points below when changing behavior.

[Product Direction](product-direction.md), [Projects and project members](epics/E-001-project-organization-visibility.md), [Member governance](epics/E-002-organization-member-governance.md), [Project workspace](epics/E-003-project-workspace.md) and [AWS account connection](epics/E-004-aws-account-connection.md) describe product intent and initiative scope. Historical approvals do not authorize new implementation or release.

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

Historical planning documents, verification logs and screenshots are recoverable from Git history. Read them only when the assignment needs that history.

## Large generated and evidence files

`apps/web/src/lib/api/openapi-types.gen.ts` is generated output. Its generator and drift policy are documented in Quality gates. `bun.lock` and `e2e/bun.lock` belong to their installation boundaries.

These files remain available for contract, dependency and evidence inspection. This index adds no ignore rules or scanner exclusions.
