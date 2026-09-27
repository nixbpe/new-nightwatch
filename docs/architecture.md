# Architecture Rules

NightWatch is one multi-tenant application (a modular monolith): many customer organizations share it, and each one's data must stay isolated from the others. This file lists the technical rules that keep it that way. The code shows how things are built; this file says what must always hold and what is forbidden. Feature and API contracts own product behavior, endpoint names and response codes. UX/UI rules are in `docs/design-system.md`.

How to use this file:

- Rule IDs name their section (e.g. `DB-01`). Add new rules at the end of their section and never reuse a number. Source code does not cite rule IDs; reviews and findings do.
- Status applies only to the part it names: `Implemented` means the code exists (not that it is verified), `Planned` and `Deferred` mean it does not exist yet. Anything without a status is not implemented. A `baseline` value is a starting default for unbuilt parts only; once built, the code owns the value.
- If code and this file disagree, report it to the Technical Lead. Do not quietly change either one.
- "Tenant" means an Organization, and `tenantId` is its organization id.

## System parts

Built today: the Web app (`apps/web`), the API (`apps/api`), PostgreSQL with migrations (`packages/db`), and a Worker using Redis/BullMQ for in-app notifications only (`apps/worker`). Not built yet (Deferred): other Worker roles and queues, the shared `packages/queue`, and a separate marketing site (`apps/landing`).

- SYS-01 The marketing site never receives login data, session cookies or internal data.
- SYS-02 Organization users reach data only through the Web app calling the API with a session cookie. There is no other client path.
- SYS-03 Platform-admin access needs an explicit check for each operation. It is never a general way around tenant isolation.
- SYS-04 Only the API and the Worker make outbound network calls, following OUT-01 and OUT-02 to OUT-04.
- SYS-05 PostgreSQL is the source of truth and Redis only carries jobs. Schedules, work totals and results, cancellations and dispatch claims live in the database, never only in Redis.
- SYS-06 The API stays one application, with each domain in `apps/api/src/<domain>`. Do not split it into services or add a DI container or a speculative repository layer.
- SYS-07 The Worker never calls the API over HTTP. They share code only through packages.
- SYS-08 Saving to the database and adding a job to the queue cannot happen as one step. Always commit to the database first, then enqueue, and if enqueueing fails, record that failure in the database with a short error summary.
- SYS-09 Containers run as non-root with pinned runtime dependencies, and build and runtime environments match.
- SYS-10 In each target environment, check TLS, allowed origins, secrets, replica counts, credentials and database permissions.

## Packages and imports

Keeping imports one-directional stops server code, secrets and database clients from leaking into the browser and keeps modules replaceable.

- PKG-01 Workspace packages may import only these (enforced by lint; outside libraries are not covered):
  - Web app → `api-contract`
  - API → `api-contract`, `shared`, `db`, and later `queue` (Deferred)
  - Worker → `db`, `shared`, and later `queue` (Deferred)
  - `queue` → `db` (Deferred)
  - `shared`, `db`, `api-contract` → nothing. `api-contract` is browser-safe and exports only from its root; `shared` and `db` are server-only.
  - Marketing site and config packages → nothing. The marketing site has no API client, and config packages contain no runtime code.
- PKG-02 Keep the import-boundary lint for PKG-01 switched on, and never weaken it to make a check pass. Report any gap in it as a finding.
- PKG-03 No circular imports. Pass inputs to functions explicitly.
- PKG-04 Each API domain has `routes.ts` (HTTP and request context), `schemas.ts` (input shapes) and `service.ts` (logic that does not know about HTTP). The API never imports frontend code.
- PKG-05 The Web app never imports a PostgreSQL or Redis client.

## Handling API requests

Every request must act for exactly one organization that the signed-in user really belongs to.

- REQ-01 Use the same organization throughout a request: the URL `orgId`, the service `tenantId`, the database context and any job it creates.
- REQ-02 Before building a route, decide which kind it is: needs an organization, runs before one is chosen, or narrow platform access.
- REQ-03 Work out the organization on the server, from the signed-in identity and a checked current membership (Planned). Values from the URL, headers, body or the browser are only hints. Check membership before touching any data.
- REQ-04 Reject a missing or invalid session before touching organization data, and reject bad membership or permissions using the `api-contract` error format. Record each rejection in the audit log without protected data.
- REQ-05 Every operation has its own explicit permission check. Contracts define what each permission means.
- REQ-06 Do network calls and heavy CPU work outside database transactions.
- REQ-07 Validate input with the Zod schemas in `api-contract` and the shared validators in `shared`.
- REQ-08 Raise errors as `AppError(status, code, message, details?)`, status first; they reach the client as `{ error: { code, message, details? } }`. Never bring back the old code-first form. In production-like environments, unknown errors show a generic message.
- REQ-09 Rate limiting uses a Redis sliding window, separate from login throttling, with a short timeout (baseline 2 s). Test what happens when the limiter fails; do not assume it blocks requests.
- REQ-10 When request validation fails, including checks that run before the handler, reply in the standard error format and never echo raw Zod issues, the submitted input, credentials, tokens or stack traces.

## Sign-in, sessions and choosing an organization

Login uses Better Auth on PostgreSQL. Contracts decide who may join, business permissions and MFA policy; these rules cover only how the app plugs into it.

- AUTH-01 Application code gets the session only through `auth.getSession(headers)`.
- AUTH-02 Session cookies are host-only, `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Never widen cookie scope to make CORS work.
- AUTH-03 `CORS_ORIGIN`, `APP_URL` and `trustedOrigins` must agree, and CORS with credentials for that exact origin runs before the auth handler.
- AUTH-04 The auth library's own endpoints keep its error format; application routes use the `api-contract` format (REQ-08).
- AUTH-05 A "return to" address after login is untrusted. Turn it into a same-site absolute path before saving it, before redirecting and when reading it back from browser storage. Anything that points to another site, starts with `//`, or contains a backslash or control character (plain or percent-encoded) falls back to `/workspace`.
- AUTH-06 Look up memberships with a parameterized query limited to the signed-in user's id, and never reveal organizations the user does not belong to.
- AUTH-07 A remembered organization (e.g. `last_active_tenant_id`) is only a hint and is rechecked against membership every time it is used.
- AUTH-08 Switching organization rechecks membership and updates anything that depends on it (such as a copy stored on the session) in the same transaction. A copied value is never proof of membership.
- AUTH-09 Record refused organization access in the audit log without organization or protected data.

## Background jobs

Only the in-app notification channel (`in-app-materialize`) is built. Any queue added later follows the same rules. The goal: no job is lost, run twice by mistake, or allowed to cross an organization boundary.

- JOB-01 Concurrency 1 does not mean only one copy runs across machines. Enforce "only one" in the database.
- JOB-02 Every job states its scope: `{ kind: 'tenant', tenantId }` or `{ kind: 'account', userId }`. Shared-catalog jobs use tenant scope and also check `requestedByTenantId`. A job's payload never grants database access: the Worker claims a committed database record for that scope and runs inside its checked context (DB-01, DB-13). Account jobs never invent or reuse a tenant id.
- JOB-03 "Will retry", "waiting for later" and "gave up" are separate states. Reconciliation catches jobs that failed between enqueueing and being recorded.
- JOB-04 Deliveries to external systems stay within one organization, record every attempt in the database, and never repeat a delivery that succeeded (bookkeeping writes may retry).
- JOB-05 Schedulers check for due work at a fixed interval in limited batches (baseline every 60 s, 10 at a time), claim rows with `FOR UPDATE SKIP LOCKED`, and enqueue per SYS-08.
- JOB-06 Prevent duplicate jobs with BullMQ `jobId`, not the job name. A job's payload captures its scope and settings at the moment it was queued.
- JOB-07 External programs run with argument arrays (no shell string), a time limit (baseline 10 min) and a temporary output folder. Decide whether each exit is worth retrying in a way that matches the database state.
- JOB-08 Temporary credential files have mode `0600` and are deleted in a `finally` block. Decrypted credentials never appear in jobs or ledger summaries.
- JOB-09 Claim pending work in one atomic update that marks it as taken, and save the full total before sending the first job. Recovery handles work that was claimed but never sent, and batches that were only partly sent.
- JOB-10 Running a job twice must have the same effect as once: use a unique key based on what the work is, and upsert the current state. This must stay safe when a retry happens between two separate commits.
- JOB-11 Only one process may finish a piece of work. It wins with a conditional update (`UPDATE ... WHERE status = 'running' RETURNING id`), so duplicate "done" events and child retries are harmless.
- JOB-12 Follow-up work after a job finishes reports its own failures. "Finished" does not mean the follow-up succeeded.
- JOB-13 A cleanup sweep marks work as failed after it has been inactive for the configured time (baseline: sweep every 5 min, 30 min inactive), after comparing counts with waiting, active and delayed jobs. Fixing counts this way is not a guarantee of exactly-once processing.
- JOB-14 Choose which Worker roles run explicitly; the default starts only the main consumers. Check which consumers and schedulers are running before adding replicas.
- JOB-15 Test shutdown, interrupted or stuck jobs and retry-safe side effects. Never assume the queue drains fully.

## Web app

The browser is never trusted: it shows and caches data, but the API decides access.

- WEB-01 The typed client in `apps/web/src/lib/api` calls `/api` with credentials and handles JSON, empty and error responses. Paths, methods, parameters, request bodies and success types are generated from the OpenAPI that the real API produces, never written by hand.
- WEB-02 Check responses at runtime with `api-contract` schemas that match the generated types. `ApiError` exposes the server's `error.code` and `details` only when explicitly mapped.
- WEB-03 Cache keys include `organizationId`, `projectId`, filters and selected ids. A response still in flight never lands in another organization's view, and each signed-in identity gets its own QueryClient.
- WEB-04 Refresh running work by polling, not WebSocket or SSE.
- WEB-05 Role and router helpers only shape the UI; the API does the authorization.
- WEB-06 An organization picked in the browser is only a hint (REQ-03): switch in the UI only after the server confirms it, then clear the old organization's data and stop in-flight results from reaching the new one.
- WEB-07 A route's data loader and its page share the same QueryClient for the signed-in identity. If the loader and the session disagree about who is signed in, stop before prefetching or showing the route.
- WEB-08 Protected pages prefetch their main data before they are shown. This only improves the UI; the API still enforces access (WEB-05).

## Calling outside systems

Outbound calls are an attack surface: a crafted address can make the server reach internal systems (SSRF).

- OUT-01 Every outbound HTTP(S) call goes through the shared SSRF helper, which handles embedded credentials, blocked headers, private addresses, redirects, DNS changes and checks at connection time.
- OUT-02 Email uses a real SMTP server checked with `verify()` at startup. No environment falls back to a fake mailer.
- OUT-03 Each protocol uses its own shared helper; passing HTTP(S) checks proves nothing about another protocol. Before adding a non-HTTP protocol, define how its destinations are validated, how connections behave and its SSRF boundary. A protocol without written rules is not exempt.
- OUT-04 Integration credentials are stored encrypted (DB-19) and decrypted only inside credential helpers or JOB-08 temporary files, never in job payloads or the ledger.

## Database and isolation

PostgreSQL row-level security (RLS) is the main isolation guard: every query runs with the current organization or user set for that transaction, and the database itself hides other organizations' rows.

- DB-01 The tenant helpers (`withTenantContext`, `withTenantContextRaw`, and the Deferred `withWorkerTenantContext`) open a transaction and set `app.tenant_id` for that transaction only (`set_config(..., true)`). Every query, including `tx.unsafe`, uses the given `tx`, never a global or pooled connection.
- DB-02 Pass every value as a bound parameter, never by building SQL strings.
- DB-03 The roles the application runs as are not owners, have `NOBYPASSRLS`, and are never superuser.
- DB-04 Every table with `tenant_id` has its own `USING` and `WITH CHECK` policies, a restrictive guard that requires the context to be set, and `FORCE ROW LEVEL SECURITY`.
- DB-05 Shared-catalog rows (`tenant_id IS NULL`) can be read only with a valid organization context and never written from one.
- DB-06 The login tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `twoFactor`) have no tenant RLS, because they are used before an organization is chosen and a user can belong to several. Protect them with checked membership lookups and organization-bound queries, never `app.tenant_id`.
- DB-07 Give the runtime role only the login-table permissions it needs, and only through migrations.
- DB-08 For every lookup before an organization is chosen, scheduler discovery, cross-organization maintenance and ledger access, review which database role it runs as.
- DB-09 Write the organization and Project conditions into queries as well, not only in RLS.
- DB-10 Table names, sort columns and sort directions come from an allow-list.
- DB-11 Check that a parent record belongs to the same scope; a foreign key alone is not enough.
- DB-12 The owner role is only for schema changes, migrations and partition maintenance. HTTP handlers and Workers that write data never hold it.
- DB-13 Tables that belong to one user (e.g. personal notifications and inbox items) are not covered by the DB-06 exception. Each needs its own `USING`/`WITH CHECK` policies, a restrictive guard requiring a user context, `FORCE ROW LEVEL SECURITY`, explicit user-id conditions and minimal grants. `withAccountContext` sets `app.user_id` for the transaction only, taken from a checked session or a claim on a separate dispatch ledger, and account queries use only its `tx`. A session setting, request field or job payload on its own never grants access. Background discovery claims work from that ledger rather than the user tables. The ledger holds only small routing data tied to committed records, and has its own RLS, grants and claim/recovery rules. If a claim function is used, it has restricted `EXECUTE`, a fixed `search_path` and its own non-login owner that can reach only the ledger (no superuser, `BYPASSRLS`, database-owner or user-table access). The runtime roles still follow DB-03, DB-08 and DB-12.
- DB-14 `audit_events` and `queue_jobs` are operational records, not business data, and the ledger is not a job queue.
- DB-15 Migrations are numbered `NNNN_*.sql` files run by our own runner (`__nightwatch_migrations` table, advisory lock, one transaction each). Never use `drizzle-kit push` or `migrate`, and never edit a migration that has already run. Review generated SQL against the migrations already applied.
- DB-16 Each migration includes the constraints, RLS policies, grants and partitions for what it adds.
- DB-17 Tables that grow over time (e.g. `audit_events`) use monthly partitions created 12 months ahead by a scheduled job with the owner role, never during a request or by a Worker that writes data. Partition maintenance runs on every deployment.
- DB-18 Migration `0008_notification_function_owners.sql` creates `NOLOGIN` roles that apply to the whole PostgreSQL cluster, so one cluster can host only one NightWatch database until provisioning is redesigned. The migration owner needs `CREATEROLE` or superuser the first time; the application and Worker roles must not have it. Testing a clean install needs a fresh cluster of its own.
- DB-19 Data encrypted at rest uses AES-256-GCM (random 12-byte IV, 16-byte tag, 32-byte base64url key), with one active key and older keys kept by version. This is not KMS envelope encryption.

## Logging, audit and health

- OPS-01 Audit events record the request and who acted, say whether they were saved in the same transaction or best-effort, and never contain secrets or protected data.
- OPS-02 Production-like environments write structured Pino logs with redaction set per entry point. Never log personal data, whole jobs, credentials, provider responses with secrets, or one-time links or tokens for login, recovery or invitations.
- OPS-03 `/health` shows the process is alive. `/ready` is ready only when the database answers `SELECT 1` and, if queues are on, Redis answers a ping. Being ready does not prove RLS, partitions, SMTP or the Worker are working.
