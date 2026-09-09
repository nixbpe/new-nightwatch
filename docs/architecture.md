# Architecture Blueprint

## 1. Scope

Preserve component boundaries, tenant isolation, persistence, and asynchronous contracts across a Bun/Turbo monorepo: Hono modular-monolith API, React/Vite SPA, workers, PostgreSQL/Drizzle/RLS, Redis/BullMQ, independent Astro landing. Toolchain, environment, and verification policy live in `package.json`, `turbo.json`, CI, and `scripts/quality/README.md`.
Scaffold phase ships only SPA + API; sections 3–6 take effect when persistence and auth land. The auth and database foundation now exists: `packages/db` (PostgreSQL/Drizzle, ordered custom migrations) and the Better Auth boundary in `apps/api/src/auth` (invitation-only email/password, verification/reset SMTP, optional TOTP, organization plugin with custom roles). `queue`, `worker`, and `landing` remain approved deferrals; domain RLS lands with its own features. The organization-access `/me` context slice and operator first-organization provisioning are implemented (`apps/api/src/me`, `apps/api/src/operator`).

## 2. Boundaries and dependency direction

```text
Public visitor -> Astro landing (no internal auth/data)
Browser SPA -> HTTP JSON + host-only cookie -> API routes -> services
Services -> tenant SQL -> PostgreSQL; services -> typed producers -> Redis/BullMQ
Workers <- Redis/BullMQ; workers -> PostgreSQL + Prowler/SDK/HTTP/SMTP -> cloud/destinations
Schedulers -> SQL due-work lookup -> producers
Owner deployment/cron -> migrations + partition DDL -> PostgreSQL
```

| Placement | Responsibility and rule |
|---|---|
| `apps/api/src/<domain>` | `routes.ts` HTTP/context; `schemas.ts` inputs; `service.ts` transport-independent business logic. No frontend imports. |
| `apps/web` | Pages, components, auth/tenant contexts, typed clients. Browser-safe imports via `api-contract` only; never `shared`, `api`, PostgreSQL, or Redis. |
| `apps/worker` (deferred) | Consumers, schedulers, collection/evaluation, result writers, health, scan completion. No HTTP coupling. |
| `apps/landing` (deferred) | Independent build/deploy; no internal `workspace:*`, auth, or application API client. |
| `packages/api-contract` | Browser-safe Zod schemas, types, error contract; package-root exports only. |
| `packages/db` + `packages/queue` (queue deferred) | Drizzle schema/client, tenant helpers, ordered custom migrations, partitions; job payloads/options/producers + SQL `queue_jobs` ledger. `queue` may depend on `db`. |
| `packages/shared` | Server-only permissions, limits, encryption, logging, SSRF, email config. No app imports. |
| `packages/*-config` | Compiler/lint configuration only; no runtime code, no application imports. |

Direction: web -> `api-contract`; api -> `api-contract` + `shared`; queue -> `db`; config packages depend on nothing — enforced by ESLint boundary rules; never weaken rules to pass. Compose functions with explicit inputs; no circular imports or speculative repository layers, service splits, DI containers.

## 3. Request, authentication, tenant SQL

```text
POST /api/organizations/:orgId/projects/:projectId/scans
  -> request context + logs/metrics -> rate limiter -> credentialed CORS
  -> tenant middleware (session -> verified membership -> tenantId/userId/userRole) -> permission guard -> Zod parsing
  -> service(tenantId, ...) -> tenant transaction (scoped checks -> change -> COMMIT) -> enqueue + audit -> response
```

- One organization boundary across URL `orgId`, service `tenantId`, SQL, and job payloads. Resolve route `orgId` -> `X-Org-ID` -> earliest membership by `created_at`; trust verified membership, never browser selection or bodies; verify membership before data access. 401 invalid session; 403 denied membership/permission; audit denials without protected data. Guard each operation (`project:manage` for scan trigger/cancel); keep `requirePlatformAdminOr(action)` explicit and local — never a global tenant-context bypass.
- Identity (implemented, better-auth@1.6.23 on PostgreSQL/Drizzle): users, sessions, provider accounts, verifications, memberships, invitations and TOTP two-factor. Admission is invitation-only: the raw `POST /api/auth/sign-up/email` endpoint is gated server-side by a before-hook requiring an `X-Invitation-ID` header matching a pending, unexpired invitation for the signup email (case-insensitive); the public preview `GET /api/onboarding/invitations/:invitationId` answers one safe not-found for unknown, cancelled, accepted or expired IDs. Organization creation is disabled (`allowUserToCreateOrganization: false`) — organizations are provisioned by the operator (provisioning serializes concurrent retries per slug with a transaction-scoped PostgreSQL advisory lock, so re-runs create-or-resend exactly one pending owner invitation), and invitations create accounts only after the recipient proves email ownership (`requireEmailVerification: true`, `requireEmailVerificationOnInvitation: true`). Acceptance uses the native `organization.accept-invitation` flow; its pending→accepted transition is a guarded single-statement update and the membership `UNIQUE (organization_id, user_id)` constraint makes replayed/concurrent acceptance idempotent-safe; a losing concurrent accept's `member_organization_user_key` 23505 — matched after the Drizzle adapter rejects, on the nested error cause — is translated at the auth adapter's `create` boundary into the same deterministic native 400 denial an already-accepted invitation receives — no other database error, including any other 23505, is remapped, so unrelated failures stay visible. Roles are the custom set `owner`/`admin`/`viewer`/`auditor`; role escalation is constrained natively (only a member with the creator role `owner` can invite with role `owner`). Two-factor TOTP with encrypted backup codes is optional per user and challenges credential sign-in; recovery is via one-time backup codes. Session entry point for application code is `auth.getSession(headers)` (wrapping `auth.api.getSession`); cookies are host-only, `HttpOnly`, `SameSite=Lax`, production `Secure`. Align `CORS_ORIGIN`, `APP_URL`, `trustedOrigins`; credentialed CORS (exact `CORS_ORIGIN`, `X-Invitation-ID` allow-listed) runs before the auth handler; never widen cookie scope for CORS; never authenticate landing. Better Auth raw endpoints answer with the library's own error shape — upstream permission denials included (401 envelope) — while application routes use the api-contract envelope (401 unauthenticated, 403 denied membership/permission).

- Organization access (implemented, `apps/api/src/me`): `GET /api/me/context` and `PATCH /api/me/active-org` serve the tenant-selection contract (`meContextResponseSchema` from `api-contract`) over verified sessions only — 401 without a session, 403 with an unverified email; a pending TOTP challenge never yields a full session from `auth.getSession`, so it cannot bypass the boundary. Memberships are pre-tenant parameterized lookups filtered by the session's user id and ordered by membership `created_at`; responses never expose non-member organizations, and a stored `last_active_tenant_id` is only returned while it still resolves to a live membership. The active-org switch re-verifies membership inside a transaction with `FOR UPDATE` on the membership row (an in-flight revocation blocks and is re-checked; a revocation landing after commit is invisible to responses), updates `user.last_active_tenant_id`, mirrors `session.active_organization_id` in the same transaction — never trusted for membership — and audit-logs denials without tenant data or secrets. First-organization provisioning is operator-only via `bun run --filter @nightwatch/api provision-organization --name <name> --slug <slug> --owner-email <email>` against the OWNER connection: one transaction creates the organization and a pending owner invitation (unguessable id, 48 h TTL) attributed to the reserved internal provisioning principal (deterministic internal id, unverified `.invalid` email, no account/password/session — audit provenance only, never a login or backdoor); the standard invitation email is sent via real SMTP after commit, delivery failure exits non-zero with a retry path — re-running the same command re-sends the pending invitation instead of duplicating the organization or the invite. No HTTP organization-creation path exists.

### Tenant transactions (load-bearing)

| Caller | Helper |
|---|---|
| Drizzle queries | `withTenantContext(tenantId, async tx => ...)` |
| API raw SQL | `withTenantContextRaw(tenantId, async tx => ...)` |
| Worker raw SQL | `withWorkerTenantContext(tenantId, async tx => ...)` |

- Open a transaction; set `set_config('app.tenant_id', tenantId, true)` locally. Use the supplied `tx` for every query including `tx.unsafe`; never substitute a global/pooled handle.
- Bind values; retain tenant/project predicates alongside RLS; allowlist identifiers and sort columns/directions; check parent scope, not foreign keys alone.
- Runtime roles are non-owner, `NOBYPASSRLS`; owner access is reserved for DDL (migrations resolve `DATABASE_OWNER_URL` before `DATABASE_URL`). Apply table-specific `USING`/`WITH CHECK`, restrictive context guards, FORCE RLS. Shared-catalog (`tenant_id IS NULL`) reads allowed with valid context; never tenant writes. Verify intended roles for pre-tenant membership lookup, scheduler discovery, cross-tenant maintenance, and ledger access; never grant runtime superuser.
- Pre-tenant limit (explicit): the global auth tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `twoFactor`) cannot be tenant-scoped by RLS — login, signup-gate and membership resolution must work before any tenant context exists, and users legitimately span multiple organizations. Isolation for auth data therefore comes from verified-membership lookups and Better Auth's organization-bound queries, never from `app.tenant_id`; `withTenantContext`/`withTenantContextRaw` are for future domain tables that carry `tenant_id`. The runtime role receives least-privilege DML grants on the auth tables from the migration and stays non-owner `NOBYPASSRLS` so future RLS on domain tables actually binds.

## 4. Scan orchestration and completion gate

SQL domain state and BullMQ transport are separate: PostgreSQL commit and Redis enqueue are not atomic; commit first, then compensate failures.

```text
API/scheduler -> queued scan -> COMMIT -> scan-orchestrate
  -> running + scan_tasks + total_tasks -> COMMIT -> scan-collect -> Prowler OCSF -> resources_current
  -> claim rule_evaluate_dispatched_at -> COMMIT total_rule_evaluate_jobs -> enqueue rule-evaluate
  -> finding_occurrences + finding_current -> independent notify-deliver
terminal counters -> tryFinalizeScan (both gates, CAS from running) -> terminal status
  -> reconcileStaleFindings -> refreshDailyAggregates
```

- Enforce one non-terminal scan per `(tenant_id, project_id)` via partial unique index; translate `23505` (including wrapped causes) to 409.
- Commit queued state before enqueue; compensate reported enqueue failure to failed with an error summary. Schedulers poll every 60 s in batches of 10, claim `FOR UPDATE SKIP LOCKED`, commit, then enqueue with compensation.
- Task identity `(scan_id, cloud_account_id, region)`; deduplicate with BullMQ `jobId`, not job names. Fallback region `us-east-1`; one `global` GCP task; carry scope/config snapshots.
- Run Prowler via `Bun.spawn` argument array: 10-minute timeout, `json-ocsf`, `/tmp` output; accept exits 0/2; classify other exits/exceptions as retryable or terminal consistently with SQL state. Resolve credentials by `auth_mode`; write temporary GCP JSON as `0600`, remove in `finally`; never put decrypted credentials in jobs or ledger summaries.
- Dispatch only check-ID matches of enabled project/provider rules; preserve `effective_ruleset` and dispatch-time `ruleSnapshot`. Claim `rule_evaluate_dispatched_at IS NULL` atomically; commit all `total_rule_evaluate_jobs += batch.length` before the first enqueue; recover claim-before-enqueue and partial batches. Insert occurrences retry-safely, unique `(scan_id, rule_id, resource_uid, observed_month)`; upsert current findings on `(tenant_id, project_id, provider, rule_id, resource_uid)`; handle retries between separately committed occurrence/current writes.

Completion gate — both conditions required for normal finalization:

1. `total_tasks > 0` and `completed_tasks + failed_tasks >= total_tasks`; cancelled collection tasks count as failed for this gate.
2. `completed_rule_evaluate_jobs + failed_rule_evaluate_jobs >= total_rule_evaluate_jobs`; count evaluation completion or exhausted-attempt failure, never retryable failure.
3. Select one finalizer with `UPDATE ... WHERE status = 'running' RETURNING id`; duplicate terminal events and collection retries must be safe. Status precedence: requested cancellation -> `cancelled`; else failed collection/evaluation -> `completed_with_errors`; else `completed`. Handle pre-task cancellation, no-account failure, and orchestration errors outside the task-required gate.

- Post-gate: `reconcileStaleFindings` covers only effective rules and covered provider/account/region/service slices (account for evaluation failures and rule-to-slice coverage); `refreshDailyAggregates` builds from current findings/framework mappings; keep periodic maintenance separate. Notifications are independent: terminal status does not establish notification, reconciliation, or aggregate success; expose failures and recovery separately. Sweep every 5 minutes for 30-minute inactivity; compare counters with waiting/active/delayed work before failing gaps; counter repair is not exactly-once recovery.

## 5. Persistence model

```text
organizations (= tenants) -- memberships(role) -- users -- sessions/accounts/MFA
  +-- teams -- team_memberships; projects -- project_cloud_accounts / project_frameworks
  +-- frameworks -- framework_mappings -- rules; scan_schedules -- scans -- scan_tasks
  +-- finding_occurrences -> finding_current -> daily aggregates
  +-- resources_current -- resource_edges; services -- owners/dependencies
  +-- monitors -- targets/runs -- service_objectives; reports / org_credentials
  +-- notification_destinations -- notification_deliveries; employees / service_integrations; audit_events / queue_jobs
```

- Text user IDs; UUID organization/project IDs; roles `owner`, `admin`, `viewer`, `auditor`. Enforce tenant-safe relationships and valid membership for `last_active_tenant_id`. Persist schedules, task/evaluation totals/outcomes, cancellation, effective rulesets, and dispatch claims — not Redis-only progress.
- Separate monthly occurrence history, current findings, and daily summaries (not event sourcing); separate employee/provider inventory from login accounts; audit/`queue_jobs` are operational, not business state; the ledger is not the queue engine.
- Store XLSX/CSV/JSON bytes in `reports.content` (no PDF/object storage); read in tenant transaction, serialize outside, persist in scoped transaction.
- Migrations: ordered `NNNN_*.sql` via the custom runner with `__nightwatch_migrations` tracking, advisory locking, per-migration transactions; never `drizzle-kit push`/`migrate`; never rewrite applied migrations. Resolve owner URL before application URL; review generated SQL against ordered/applied migrations.
- Bootstrap monthly `audit_events`, `monitor_runs`, `finding_occurrences` partitions 12 months ahead via owner-role scheduled DDL; no request-time or DML-worker partition creation.

## 6. Queue topology

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

- Per-worker-instance defaults; back off exponentially from 5 s. Resolve per-queue override -> worker default -> built-in; `prowler-rule-sync` accepts only its explicit queue override, never the global one. Concurrency 1 is not a distributed singleton. Carry `tenantId` in every job; authorize shared-catalog jobs separately via `requestedByTenantId`; payload identity is not SQL context. Distinguish retryable, delayed, and exhausted states; observe ledger/reconciliation and enqueue-to-ledger failures.
- Scope notification destinations by tenant/project; apply policy/mute windows; record each outcome; never repeat successful sends on bookkeeping retries. Pin Prowler until an approved, compatibility-verified change; separate Prowler security collection, AWS SDK health, and HTTP/DNS/TCP monitoring; distinguish integration imports/credentials from live OAuth sync.

## 7. Cross-cutting contracts

- Errors: Zod/shared validation; `AppError(status, code, message, details?)` -> `{ error: { code, message, details? } }`; generic unknown errors in production-like environments; audits carry request/actor context (transactional vs best-effort); never secrets in payloads.
- AppError constructor order is **status-first** per the user decision F001-ERR1 in [F-001](planning/F-001-workspace-onboarding.md): `AppError(status, code, message, details?)`, where `status` is the HTTP status, `code` is machine-readable, `message` is display-safe, and `details` is optional and display-safe. The implementation in [packages/shared/src/errors.ts](../packages/shared/src/errors.ts) and all owned callers/tests are migrated to status-first; do not reintroduce a code-first overload.
- Encryption: AES-256-GCM, random 12-byte IV, 16-byte tag, 32-byte base64url key; one active key plus retained versioned keys; not KMS envelope encryption.
- SSRF: apply helpers to all outbound HTTP(S); cover embedded credentials, blocked headers, private addresses, redirects, DNS changes, connection-time behavior. Rate limiting: Redis sliding window separate from auth throttling; exercise errors and the 2-second limiter timeout; never assume fail-closed.
- Logging: structured Pino in production-like runtimes; redact per entrypoint; never log whole jobs, credentials, or secret-bearing provider responses. Health: `/health` liveness; `/ready` = database `SELECT 1` -> 200/503 (Redis ping joins only when the queue lands). Auth mail delivery uses real SMTP with startup `verify()`; there is no fake transport fallback, and verification/reset/invitation links are never logged. Readiness is not proof of RLS, partitions, SMTP, or worker execution.

## 8. Frontend data integration

- Typed clients in `apps/web/src/lib/api` against `/api` with credentials; handle JSON, empty 204, and non-OK responses. Validate responses against `api-contract` schemas; TypeScript generics do not validate payloads, and `ApiError` does not automatically expose server `error.code`/`details`.
- Tenant selection: load `/me/context`; select valid in-memory organization -> valid `lastActiveTenantId` -> first membership. Require `PATCH /me/active-org` success before switching; update the router-facing snapshot, reset project, clear tenant-sensitive queries. Key queries by `organizationId`, `projectId`, filters, selected IDs; `staleTime: 30_000`, `retry: 1`; block in-flight responses from repopulating another tenant's view.
- Poll active scans every 5 s; stop at terminal state via the shared active-scan predicate; polling, not WebSocket/SSE. Role/router helpers are UX only — authorization lives in the API.

## 9. Deployment topology

```text
SPA and Astro landing: independent builds and deployments
API image: owner-role pre-deploy migrations + partition bootstrap; application-role runtime -> /health/ready
Worker image: combined consumers + scheduler/dispatcher loops, OR explicitly configured separate roles
PostgreSQL + Redis; owner-role monthly partition-maintenance cron
```

- Choose combined or split worker entrypoints deliberately; check consumers/schedulers before scaling replicas; the default entrypoint starts main consumers, not every role. Run containers non-root with pinned runtime dependencies; align build-time and runtime environment.
- Exercise shutdown, interrupted/stalled jobs, and retry-safe effects; do not assume full drain. Maintain partitions between deploys. Verify TLS/origins, secrets, replicas, credentials, DB privileges in the target environment; require authorization for production credentials, migrations, deployment, release.

## 10. Implementation and verification guidelines

- API: add domain schemas/routes/services; mount in `app.ts`; classify tenant-protected, pre-tenant, or narrow platform access; keep HTTP translation in routes; apply permissions, validation, errors, audits, tenant helpers; update clients/consumers.
- Persistence: update schema/exports plus the next ordered migration with scoped constraints, RLS, grants, partitions; keep network/CPU work outside SQL transactions; enforce concurrent invariants in SQL; verify isolation and missing-context behavior under non-owner roles on a dedicated database.
- Jobs: define payloads, options, producers in `packages/queue`; specify scope, identity, snapshots, retries, deduplication; register consumers and ledger monitoring in the correct entrypoint; preserve scan claims, total-before-enqueue, exhausted counters, CAS; compensate external effects.
- Frontend: extend domain clients and pages with scoped query keys/guards; update tenant snapshots and cache invalidation on selection change; exercise loading, empty, error, denied, success states.
- Verify real-role denial, tenant A/B isolation, cross-project not-found, missing tenant context — mocks cannot prove RLS; check pre-tenant lookup, schedulers, ledger separately. Cover active-scan races, partial writes/enqueues, dispatch-claim crashes, exhausted retries, cancellation, duplicates, concurrent finalizers; SQL/Redis and send/bookkeeping remain non-atomic. Verify independent notification delivery, report content, reconciliation coverage, post-status aggregate recovery, month boundaries, owner/runtime privileges on dedicated/disposable databases. Exercise real browsers and actual process roles; health 200 and typechecking do not verify integrations, recovery, or delivery.
