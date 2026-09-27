# Architecture Rules

NightWatch is one multi-tenant application (a modular monolith) whose organizations must stay isolated from each other. Each section gives its principle, then only the requirements that are easy to get wrong. This file names no code; the code shows how each rule is met. Feature and API contracts own product behavior. UX/UI rules are in `docs/design-system.md`.

- Findings cite a numbered rule (e.g. `DB-01`) or a section's principle by its heading. Add rules at the end of their section; never reuse a number. Source code does not cite rule IDs.
- `Implemented` means the code exists (not that it is verified); `Planned` and `Deferred` mean it does not. A `baseline` value is a default for unbuilt parts; once built, code owns it.
- If code and this file disagree, report it to the Technical Lead instead of changing either.
- Tenant = Organization.

## System parts

Built: Web app, API, PostgreSQL, and a Worker using Redis/BullMQ for in-app notifications only. Deferred: other Worker roles and queues, a shared queue package, and a marketing site.

**Principle.** PostgreSQL holds all state; Redis only carries jobs. Users reach data only through the Web app calling the API with a session cookie, and only the API and Worker call outside systems. The marketing site gets no login data, cookies or internal data. Platform-admin access is checked per operation and never bypasses tenant isolation. Commit to the database before enqueueing, and record enqueue failures in the database. Check TLS, origins, secrets, credentials and database permissions in each environment.

- SYS-01 Keep one API application split into domain modules: no service split, DI container or speculative repository layer. The Worker never calls the API over HTTP; they share code through packages.
- SYS-02 Containers run as non-root with pinned runtime dependencies and matching build/runtime environments.

## Packages and imports

**Principle.** Imports flow one way, so server code and database clients never reach the browser. Each API domain keeps HTTP handling, input shapes and HTTP-free logic in separate modules. No circular imports.

- PKG-01 Allowed workspace imports (lint-enforced):
  - Web app → contract package
  - API → contract, shared-server and database packages (later queue)
  - Worker → shared-server and database packages (later queue)
  - Queue package → database package
  - Contract, shared-server and database packages, the marketing site and config packages → nothing. The contract package is browser-safe; config packages hold no runtime code.
- PKG-02 Never disable or weaken the PKG-01 lint to pass a check.

## Handling API requests

**Principle.** A request acts for exactly one organization, chosen on the server from the signed-in identity and a checked membership (Planned); URL, header, body and browser values are hints. That organization runs through the URL, service, database context and any job. Decide each route's kind first (organization, pre-organization or narrow platform access). Check membership and a per-operation permission before touching data, and audit rejections without protected data.

- REQ-01 Keep network calls and heavy CPU work outside database transactions.
- REQ-02 Validate input with shared Zod schemas from the contract package.
- REQ-03 All application errors use one envelope (status, code, message, optional details). Unknown errors show a generic message in production-like environments.
- REQ-04 Rate limiting uses a Redis sliding window separate from login throttling, with a short timeout (baseline 2 s). Test limiter failure; do not assume it blocks.
- REQ-05 Validation failures, including pre-handler checks, use the standard error envelope and never echo Zod issues, input, credentials, tokens or stack traces.

## Sign-in and choosing an organization

**Principle.** Better Auth handles login; contracts own admission and MFA policy. A remembered organization or a copy on the session is a hint, rechecked against membership on every use and updated with it in the same transaction. Membership lookups are limited to the signed-in user and never reveal other organizations. Audit refused access without protected data.

- AUTH-01 Application code reads the session through the auth library's single session call.
- AUTH-02 Session cookies are host-only, `HttpOnly`, `SameSite=Lax`, and `Secure` in production; never widen their scope for CORS.
- AUTH-03 The allowed CORS origin, app URL and auth trusted origins agree, and exact-origin credentialed CORS runs before the auth handler.
- AUTH-04 Auth library endpoints keep their own error format; application routes use REQ-03.
- AUTH-05 Normalize a post-login "return to" address to a same-site absolute path before saving, redirecting and reading it from browser storage. Another site, `//`, a backslash or a control character (plain or percent-encoded) falls back to the default signed-in page.

## Background jobs

Only the in-app notification channel is built; later queues follow the same rules.

**Principle.** A job may run twice, stop halfway or never arrive, so running it twice must equal running it once (a unique work key plus an upsert). Jobs point at committed data, and only a committed database claim grants access. Concurrency 1 is not a singleton; enforce "only one" in the database. Keep retry, waiting and gave-up states distinct, let follow-up work report its own failures, fail stuck work, and test shutdown and interrupted jobs. Choose Worker roles explicitly before adding replicas.

- JOB-01 Every job carries its scope, either one organization or one user account. The Worker runs inside the checked context of its database claim (DB-01, DB-10) and never invents an organization for account work.
- JOB-02 Schedulers poll in bounded batches (baseline 60 s, 10), claim with `FOR UPDATE SKIP LOCKED` and commit before enqueueing.
- JOB-03 Deduplicate with a BullMQ job id, never the job name; payloads snapshot scope and settings at enqueue time.
- JOB-04 External programs run with argument arrays, a time limit (baseline 10 min) and a temp folder; classify exits as retryable or final in line with database state.
- JOB-05 Temporary credential files are mode `0600` and deleted in a `finally` block; decrypted credentials never enter jobs or ledgers.
- JOB-06 Claim pending work in one atomic update and save the full total before the first enqueue; recovery covers claimed-but-unsent and partly sent batches.
- JOB-07 One process finishes a piece of work, by a conditional update that only succeeds while the work is still running.

## Web app

**Principle.** The browser is untrusted: it caches data for one identity and one organization, and the API decides access. Switch organization only after the server confirms, then clear the old organization's data. Refresh running work by polling. Protected pages prefetch their main data.

- WEB-01 The API client sends credentials, and its paths, parameters, bodies and success types are generated from the real API's OpenAPI, never handwritten.
- WEB-02 Validate responses at runtime with contract schemas matching the generated types; expose server error codes and details only when mapped.
- WEB-03 Cache keys include the organization, Project, filters and selected ids; each identity has its own query cache, and in-flight responses never reach another organization's view.
- WEB-04 Route loaders share their page's query cache; if loader and session identities differ, stop before prefetching or rendering.

## Calling outside systems

**Principle.** Outbound calls are an SSRF risk. Each protocol uses its own shared helper, and HTTP(S) checks prove nothing for other protocols, so define a new protocol's validation and SSRF boundary before adding it. Credentials are encrypted at rest and decrypted only in credential helpers or JOB-05 files.

- OUT-01 Every outbound HTTP(S) call uses the shared SSRF helper (embedded credentials, blocked headers, private addresses, redirects, DNS changes, connection-time checks).
- OUT-02 Email uses a real SMTP server verified at startup; never a fake mailer.

## Database and isolation

**Principle.** The database enforces isolation with row-level security (RLS) using a per-transaction context, and runtime roles can never bypass it. Queries still add organization and Project conditions and check parent scope; RLS or a foreign key alone is not enough. Review the database role of every pre-organization, scheduler, cross-organization and ledger path. Only migrations change the schema, and time-growing tables use monthly partitions created ahead by owner-role jobs on every deployment.

- DB-01 Organization context is set transaction-locally (`set_config(..., true)`) inside a transaction, and every query in that unit of work uses the same transaction handle.
- DB-02 Bind every value; never build SQL strings.
- DB-03 Runtime roles are non-owner, `NOBYPASSRLS` and never superuser.
- DB-04 Organization-owned tables have their own `USING` and `WITH CHECK` policies, a restrictive context guard and `FORCE ROW LEVEL SECURITY`.
- DB-05 Shared-catalog rows (no organization) are readable only with a valid context and never writable from one.
- DB-06 Login and membership tables have no organization RLS because they are used before an organization is chosen; protect them with membership-bound queries, never the organization context.
- DB-07 Grant the runtime role only the login-table permissions it needs, through migrations.
- DB-08 Identifiers and sort columns/directions come from an allow-list.
- DB-09 The owner role is only for migrations and partition maintenance, never inside a request or a data-writing Worker.
- DB-10 Per-user tables need their own `USING`/`WITH CHECK` policies, a restrictive user-context guard, `FORCE ROW LEVEL SECURITY`, user-id conditions and minimal grants. The user context is set per transaction from a checked session or a dispatch-ledger claim; a setting, request field or payload alone grants nothing. Discovery claims from that ledger, which holds only routing data tied to committed records and has its own RLS, grants and recovery. A claim function has restricted `EXECUTE`, a fixed `search_path` and a non-login owner limited to the ledger.
- DB-11 Migrations are ordered SQL files run by our checksummed, advisory-locked runner, one transaction each. Never use `drizzle-kit push`/`migrate` or edit an applied migration.
- DB-12 Each migration includes its constraints, RLS policies, grants and partitions.
- DB-13 A migration that creates cluster-wide roles limits one PostgreSQL cluster to one NightWatch database. The migration owner needs `CREATEROLE` or superuser the first time; runtime roles never do. Clean-install tests need a fresh cluster.
- DB-14 Encrypt at rest with AES-256-GCM and versioned keys (not KMS envelope encryption).

## Logging, audit and health

**Principle.** Logs and audit records never hold secrets, personal data, whole jobs or one-time links/tokens. Audit events record the request, the actor and whether they were saved in-transaction or best-effort. Health checks claim only what they test.

- OPS-01 Production-like environments use structured Pino logs with per-entry-point redaction.
- OPS-02 Liveness shows the process is up; readiness requires a database query and, when queues are on, a Redis ping.
