# Architecture Blueprint

## 1. Scope

Preserve component boundaries, tenant isolation, persistence, and asynchronous contracts. See [project instructions](../AGENTS.md), [technology](tech.md), and [design system](design-system.md).

Keep Bun/Turbo, Hono modular-monolith API, React/Vite SPA, workers, PostgreSQL/Drizzle/RLS, and Redis/BullMQ. Deploy the public Astro site independently. The scaffold phase delivers only the SPA + API: sections 3–6 (identity, tenant SQL, scans, persistence, queues) take effect when the persistence and auth features land; until then the API has no database, sessions, or tenant context.

## 2. System boundaries and dependency direction

```text
Public visitor -> Astro landing (no internal auth/data)
Browser SPA -> HTTP JSON + host-only cookie -> API routes -> services
Services -> tenant SQL -> PostgreSQL; services -> typed producers -> Redis/BullMQ
Workers <- Redis/BullMQ; workers -> PostgreSQL results + Prowler/SDK/HTTP/SMTP
Workers -> AWS / GCP / destinations
Schedulers -> SQL due-work lookup -> prod ucers
Owner deployment/cron -> migrations + partition DDL -> PostgreSQL
```

| Placement | Responsibility and dependency rule |
|---|---|
| `apps/api/src/<domain>` | `routes.ts`: HTTP/context; `schemas.ts`: inputs; `service.ts`: business operations. Import shared packages, not frontend modules. |
| `apps/web/src` | Pages, components, auth/tenant contexts, typed clients. No direct PostgreSQL/Redis access. |
| `apps/worker/src` | Consumers, schedulers, collection/evaluation, result writers, health, scan completion. No HTTP coupling. |
| `packages/db` | Drizzle schema/client, tenant helpers, migrations, credentials, partitions. |
| `packages/queue` | Job types/options/producers and SQL `queue_jobs` ledger; may depend on `db`. |
| `packages/shared` | Permissions, limits, encryption, logging, SSRF/IP, scheduling, email configuration. No app imports. |
| `packages/typescript-config` | Compiler configuration only. |
| `apps/landing` | Independent build/deploy; no internal `workspace:*`, auth, or application API client. |

Compose functions with explicit inputs. Avoid circular imports and unneeded repositories, service splits, or DI containers. Check API-to-worker imports and image inputs before changing shared behavior.

## 3. Request, authentication, authorization and tenant SQL

```text
POST /api/organizations/:orgId/projects/:projectId/scans
  -> request ID/context + logs/metrics -> rate limiter -> credentialed CORS
  -> tenant middleware: session -> verified membership -> tenantId/userId/userRole/session
  -> permission guard -> Zod parsing -> triggerScan(tenantId, projectId, input, userId)
  -> tenant transaction: scoped project/accounts/active-scan checks -> queued scan -> COMMIT
  -> enqueue scan-orchestrate -> audit/log -> 201 { scan }
```

- Use one organization boundary across URL `orgId`, service `tenantId`, SQL, and jobs. Trust verified membership, not browser selection or bodies.
- Resolve route `orgId` → `X-Org-ID` → earliest membership by `created_at`; verify membership before data access.
- Return 401 for invalid sessions, 403 for denied membership/permission. Audit denial without protected data.
- Guard each operation; use `project:manage` for scan trigger/cancel and assess reads separately. Keep `requirePlatformAdminOr(action)` explicit/local, never a global tenant-context bypass.
- Set Hono context in middleware and PostgreSQL context in service transactions.

### Identity and cookies

Use Better Auth/Drizzle PostgreSQL for users, sessions, provider accounts, verifications, memberships, and MFA (applies from the first auth feature). Disable self-service organization creation; use TOTP. Require Microsoft/Entra provider configuration, including `ENTRA_CLIENT_ID`, before enabling it.

Resolve sessions with `auth.api.getSession({ headers })`. Keep `nw`, `HttpOnly`, `SameSite=Lax`, production `Secure`, and host-only cookies; verify staging. Align `CORS_ORIGIN`, `APP_URL`, and `trustedOrigins`. Never widen cookie scope for CORS or authenticate the landing site.

### Tenant transactions and roles

| Caller | Helper |
|---|---|
| Drizzle queries | `withTenantContext(tenantId, async tx => ...)` |
| API raw SQL | `withTenantContextRaw(tenantId, async tx => ...)` |
| Worker raw SQL | `withWorkerTenantContext(tenantId, async tx => ...)` |

Open a transaction; set `set_config('app.tenant_id', tenantId, true)` locally. **Use the supplied `tx` for every query**, including `tx.unsafe`; never substitute a global/pooled handle.

Bind values; retain tenant/project predicates with RLS. Allowlist identifiers/sort columns/directions and check parent scope, not foreign keys alone.

Use non-owner, `NOBYPASSRLS` runtime credentials; reserve owner access for DDL. Apply table-specific `USING`, `WITH CHECK`, restrictive context guards, and FORCE RLS. Allow shared-rule (`tenant_id IS NULL`) catalog reads with valid context, never tenant writes.

Verify intended roles for pre-tenant membership, scheduler discovery, cross-tenant maintenance, and ledger access. Scope privileged control-plane credentials narrowly; never grant runtime superuser.

## 4. Scan orchestration and completion gate

Keep SQL domain state separate from BullMQ transport: PostgreSQL commit and Redis enqueue are not atomic.

```text
API/scheduler -> queued scan -> COMMIT -> scan-orchestrate
  -> running + scan_tasks(account, region) + total_tasks -> COMMIT -> scan-collect
  -> AWS credentials/STS or GCP service account -> Prowler OCSF -> resources_current
  -> claim rule_evaluate_dispatched_at
  -> COMMIT whole total_rule_evaluate_jobs batch -> enqueue rule-evaluate(ruleSnapshot, output)
  -> finding_occurrences + finding_current -> independent notify-deliver

Collection terminal counters + evaluation terminal counters
  -> tryFinalizeScan: both gates -> CAS running -> terminal status
  -> reconcileStaleFindings -> refreshDailyAggregates
```

### Trigger, collection and fan-out

- Require connected accounts. Enforce one non-terminal scan per `(tenant_id, project_id)` via partial unique index; translate relevant `23505`, including wrapped causes, to 409.
- Commit queued state before enqueue; compensate reported enqueue failure to failed with an error summary.
- Poll schedules every 60 seconds, batch 10. Claim with `FOR UPDATE SKIP LOCKED`, calculate cron/timezone scheduling, commit, then enqueue with compensation.
- Scope accounts by tenant/project. Use configured AWS locations/regions, fallback `us-east-1`; one `global` GCP task. Carry scope/config snapshots.
- Reuse `(scan_id, cloud_account_id, region)` task identity on retry. Deduplicate with BullMQ `jobId`, not job names.

Run Prowler via `Bun.spawn` argument array: 10-minute timeout, `json-ocsf`, `/tmp/prowler-output`. Accept exits 0/2; classify others/exceptions as retryable or terminal consistently with SQL state. Resolve AWS organization credentials or STS AssumeRole by `auth_mode`. Write temporary GCP JSON as `0600`, remove in `finally`. Never put decrypted credentials in jobs/ledger summaries.

Load enabled project/provider rules and framework mappings; dispatch only check-ID matches. Preserve `effective_ruleset` and dispatch-time `ruleSnapshot`. Claim `rule_evaluate_dispatched_at IS NULL` atomically; commit all `total_rule_evaluate_jobs += batch.length` before first enqueue. Recover claim-before-enqueue and partial batches.

Insert occurrences retry-safely, unique on `(scan_id, rule_id, resource_uid, observed_month)`; upsert current findings on `(tenant_id, project_id, provider, rule_id, resource_uid)`. Handle retries between separately committed occurrence/current writes.

### Completion and recovery

Require both gates for normal finalization:

1. `total_tasks > 0` and `completed_tasks + failed_tasks >= total_tasks`; count cancelled collection tasks as failed for this gate.
2. `completed_rule_evaluate_jobs + failed_rule_evaluate_jobs >= total_rule_evaluate_jobs`.

Count evaluation completion or exhausted-attempt failure, never retryable failure. Handle duplicate terminal events and collection retries safely. Select one finalizer with `UPDATE ... WHERE status = 'running' RETURNING id`.

Prioritize requested cancellation → `cancelled`; else failed collection/evaluation → `completed_with_errors`; else `completed`. Handle pre-task cancellation, no-account failure, and orchestration errors outside the task-required gate.

Run `reconcileStaleFindings` and `refreshDailyAggregates` post-gate. Reconcile only effective rules and covered provider/account/region/service slices; account for evaluation failures and rule-to-slice coverage before passing stale failures. Build daily summaries from current findings/framework mappings; keep periodic maintenance separate.

Keep notifications independent. Terminal status does not establish notification, reconciliation, or aggregate success; expose failures and recovery separately.

Sweep every 5 minutes for 30-minute inactivity. Compare counters with waiting/active/delayed work before failing gaps. Cover missing/stale ledger, lost collection, partial fan-out, and status-before-refresh crashes; counter repair is not exactly-once recovery.

## 5. Domain persistence model

```text
users -- memberships(role) -- organizations (= tenants)
  +-- sessions/accounts/MFA      +-- teams -- team_memberships
                                +-- projects
                                |   +-- project_cloud_accounts
                                |   +-- project_frameworks -- frameworks -- framework_mappings -- rules
                                |   +-- scan_schedules -- scans -- scan_tasks
                                |   +-- finding_occurrences -> finding_current -> daily aggregates
                                |   +-- resources_current -- resource_edges
                                |   +-- services -- owners/resources/dependencies
                                |   +-- monitors -- targets/runs -- service_objectives
                                |   +-- reports
                                +-- org_credentials
                                +-- notification_destinations -- notification_deliveries
                                +-- employees / service_integrations -- integration_users
                                +-- audit_events / queue_jobs
```

- Use text user IDs, UUID organization/project IDs, and roles `owner`, `admin`, `viewer`, `auditor`. Enforce tenant-safe relationships and valid membership for `last_active_tenant_id`.
- Keep project teams, provider/auth/scope, and frameworks explicit. Persist schedules, task/evaluation totals/outcomes, cancellation, effective rulesets, and dispatch claims—not Redis-only progress.
- Separate monthly history, current findings, and daily summaries; not event sourcing. Separate resources/edges, service ownership/mappings/dependencies, infrastructure health, and synthetic monitors/targets/runs/objectives.
- Separate employee/provider inventory from login accounts and audit/`queue_jobs` from business state; the ledger is not the queue engine.
- Store XLSX/CSV/JSON bytes in PostgreSQL `reports.content`, not PDF/object storage. Read in tenant transaction, serialize outside, persist in scoped transaction.

### Schema, migrations and partitions

Maintain `packages/db/src/schema` and ordered `packages/db/src/migrations/NNNN_*.sql`. Use `bun run db:migrate` with `__nightwatch_migrations(id, filename, applied_at)`, advisory locking, and per-migration transactions; not `drizzle-kit migrate`/`push`.

Resolve `DATABASE_OWNER_URL` before `DATABASE_URL`; verify targets/fallbacks explicitly. Review generated SQL against ordered/applied migrations, including schema, indexes, uniqueness, foreign keys, RLS, grants, and partitions.

Bootstrap monthly `audit_events`, `monitor_runs`, and `finding_occurrences` partitions 12 months ahead; maintain via owner-role scheduled DDL. Verify parent/child policies and month boundaries. No request-time or DML-worker partition creation.

## 6. Queue topology and integrations

Use these per-worker-instance defaults:

| Queue | Concurrency | Attempts | Responsibility |
|---|---:|---:|---|
| `scan-orchestrate` | 2 | 3 | Plan tasks and fan-out |
| `scan-collect` | 3 | 3 | Prowler collection |
| `rule-evaluate` | 5 | 3 | Evaluate findings; request notifications |
| `report-generate` | 2 | 3 | Generate XLSX/CSV/JSON |
| `health-collect` | 5 | 3 | AWS infrastructure health |
| `notify-deliver` | 10 | 3 | Destination policy and delivery outcomes |
| `prowler-rule-sync` | 1 | 1 | Shared provider rule catalog |
| `health-check` | 10 | 3 | Synthetic monitors |
| `slo-recalculate` | 5 | 3 | Service objectives |

Back off exponentially from 5 seconds. Resolve `WORKER_CONCURRENCY_<QUEUE>` → `WORKER_DEFAULT_CONCURRENCY` → built-in. For `prowler-rule-sync`, allow only its explicit queue override, not the global override. Concurrency 1 is not a distributed singleton.

Carry `tenantId`; separately authorize shared-catalog jobs using `requestedByTenantId`. Payload identity is not SQL context. Observe ledger/reconciliation and enqueue-to-ledger failures; distinguish retryable, delayed, and exhausted states.

Scope notification destinations by tenant/project; apply policy/mute windows and record each outcome. Avoid repeating successful sends on bookkeeping retries.

Separate AWS/GCP Prowler security, AWS SDK health, and HTTP/DNS/TCP monitoring. Pin Prowler `5.20.0` until an approved, compatibility-verified change. Use adapters for Atlassian, GitLab, Datadog, Figma, AWS Identity Center, and Claude Teams CSV; distinguish import/credentials from live OAuth sync.

## 7. Cross-cutting concerns

- Use Zod/shared validation and `AppError(status, code, message, details?)` → `{ error: { code, message, details? } }`. Return generic unknown errors in production-like environments; exclude secrets.
- Carry request/actor context into audits; distinguish transactional from best-effort recording.
- Use AES-256-GCM: random 12-byte IV, 16-byte tag, 32-byte base64url-decoded key. Active: `CREDENTIAL_ENCRYPTION_KEY`; retained: `CREDENTIAL_ENCRYPTION_KEY_V<n>`. Not KMS envelope encryption.
- Apply SSRF helpers/wrappers to HTTP(S), embedded credentials, blocked headers, and private addresses. Cover redirects, DNS changes, and connection-time behavior.
- Separate Redis sliding-window and auth throttling. Exercise errors and the 2-second limiter timeout; do not assume fail-closed.
- Use Pino in production-like runtimes; redact each entrypoint. Never log whole jobs, credentials, or secret-bearing provider responses.
- Keep `/health` liveness; `/health/ready` runs database `SELECT 1` plus Redis ping, returning 200/503. During the scaffold phase without infrastructure, `/health/ready` is a self-check only; the full dependency check applies when persistence lands. Verify RLS, migrations, partitions, SMTP, providers, and workers separately.
- Validate config at consuming entrypoints. Check email before email-capable API/workers start; no SMTP requirement for scheduler/health-only processes.

## 8. Frontend data integration

Put typed clients in `apps/web/src/lib/api`; use `/api` with credentials. Handle JSON, empty 204, and non-OK responses. Validate responses against `@nightwatch/api-contract` schemas; TypeScript generics alone do not validate payloads, and `ApiError(message, status)` does not automatically expose server `error.code`/`details`.

Routing uses React Router 7; server state uses TanStack Query. Load `/me/context`; select valid in-memory organization → valid `lastActiveTenantId` → first membership. Require `PATCH /me/active-org` success before switching; update the router-facing active-tenant snapshot, reset project, clear tenant-sensitive queries. (Tenant context applies from the first auth feature.)

Key queries by `organizationId`, `projectId`, filters, and selected IDs; await resolved scope. Keep `staleTime: 30_000`, `retry: 1`. Block in-flight responses from repopulating another tenant's view.

Poll active scans every 5 seconds; stop at terminal state via the shared active-scan predicate. This is polling, not WebSocket/SSE. Keep role/router helpers as UX only. Follow [design system](design-system.md) loading, empty, error, and permission states.

## 9. Deployment topology

Use [technology](tech.md) commands/configuration. Develop with PostgreSQL 17, Redis 7, Mailpit. Full Compose separates API, main worker, scheduler, health dispatcher, health worker, monitor dispatcher; run Vite on host. Keep dev credentials/ports local-only.

```text
SPA / Astro landing: independent builds and deployments
API image: owner-role pre-deploy migrations + partition bootstrap
           application-role Hono runtime -> /health/ready
Worker image: combined consumers + health worker + scheduler/dispatcher loops
              OR explicitly configured separate process roles
PostgreSQL + Redis; owner-role monthly partition-maintenance cron
```

Use `dist/all.js` for Railway combined workers; `index.js` starts main consumers, not every role. Run non-root UID 1001 with Bun/Prowler dependencies.

Exercise shutdown, interrupted/stalled jobs, and retry-safe effects; do not assume full drain. Maintain partitions between deploys. Verify DNS/TLS, secrets, replicas, credentials, and DB privileges. Require authorization for production credentials, migrations, deployment, and release.

## 10. Implementation guidelines and testing boundaries

Reuse domain patterns and explicit tenant/project/actor inputs. Keep network/CPU work outside SQL transactions. Enforce concurrent invariants in SQL; compensate external effects.

### API operations

Add domain schemas/routes/services; mount in `apps/api/src/app.ts`. Classify tenant-protected, pre-tenant, or narrow platform access. Keep HTTP translation in routes; apply permissions, validation, errors, audits, and tenant helpers. Update clients/consumers.

### Persistence

Update schema/exports and next ordered migration with scoped constraints, RLS, grants, partitions, and custom-runner compatibility. Bind values; reuse pagination/filter helpers. Verify isolation/missing context under non-owner roles on a dedicated DB.

### Jobs

Define `packages/queue/src/jobs.ts` payloads, `metadata.ts`/`queues.ts` options, producers/exports. Specify scope, identity, snapshots, retries, deduplication; register consumers/ledger monitoring in the correct entrypoint. Preserve scan claims, total-before-enqueue, exhausted counters, CAS, and process-specific dependencies.

### Frontend features

Extend domain clients and pages/components with scoped query keys/guards. Authorize on the API; update tenant snapshots/cache invalidation on selection changes. Exercise loading, empty, error, denied, and success states.

## 11. Risks and verification

- Verify real-role denial, tenant A/B, cross-project not-found, and missing context; mocks cannot prove RLS. Check pre-tenant lookup, schedulers, and ledger separately.
- Cover active-scan races, partial writes/enqueues, dispatch-claim crashes, exhausted retries, cancellation, duplicates, and concurrent finalizers. SQL/Redis and send/bookkeeping remain non-atomic.
- Verify independent delivery, report formats/content, reconciliation coverage, and post-status aggregate recovery. Distinguish stale/delayed ledger work.
- Check month boundaries and owner/runtime privileges on dedicated databases. Inspect migration/seed/partition/Redis-flush hooks; use disposable destructive-setup targets.
- Exercise browsers and actual process roles. Health 200/typechecking do not verify integrations, recovery, or delivery.
