# Repository context index

This index locates contract sources and code entry points. It defines no additional product behavior or approval.

[Repository instructions](../AGENTS.md) route architecture, UI, quality, template and PR rules. [Claude Code instructions](../CLAUDE.md) describe the repository's agent wiring.

## Feature contracts

Detailed criteria and design belong to the current request or issue. The code index below locates API contracts, migrations and tests; it defines no additional acceptance criteria.

[Product Direction](product-direction.md), [Projects and project members](epics/E-001-project-organization-visibility.md), [Member governance](epics/E-002-organization-member-governance.md), [Project workspace](epics/E-003-project-workspace.md) and [AWS account connection](epics/E-004-aws-account-connection.md) describe product intent and initiative scope. Historical approvals do not authorize new implementation or release.

## Code entry points

[Feature code index](features.md) is the code-entry map. Find the capability, then its owning symbols, contracts and focused tests. Expand to consumers and shared state when the change requires them. Keep source links there rather than duplicating them in this index.

## Operational and UI references

- [Architecture: Sign-in and choosing an organization](architecture.md#sign-in-and-choosing-an-organization) owns session and auth error policies.
- [Design system: App shell](design-system.md#app-shell) owns shared navigation, overlay and settings UX constraints.
- [Quality check routing](../scripts/quality/README.md#check-routing) locates focused checks, database wrappers, E2E isolation and OpenAPI drift checks.
- [Uptime monitor operations](runbooks/uptime-monitor.md) records worker operation, partitions and credential-key rotation.

## Evidence and delivery history

Historical planning documents, verification logs and screenshots are recoverable from Git history. Read them only when the assignment needs that history.

## Large generated and evidence files

`apps/web/src/lib/api/openapi-types.gen.ts` is generated output. Its generator and drift policy are documented in Quality gates. `bun.lock` and `e2e/bun.lock` belong to their installation boundaries.

These files remain available for contract, dependency and evidence inspection. This index adds no ignore rules or scanner exclusions.
