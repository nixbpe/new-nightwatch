# Quality gates

Root-level notes for the platform quality scripts. Scripts themselves live in
the root `package.json`; this file records where policies live and how the
scripts are meant to evolve.

## Agent workflow integrity

```sh
bun run workflow:test
bun run agent:check
bun run candidate:manifest -- --base HEAD
```

- `workflow:test` exercises the agent-reference, candidate-binding, and E2E runner scripts. Root `validate` runs it before other gates.
- `agent:check` validates agent model ids, tool allowlists, skill preloads and explicit references under `.claude`. Reference metadata uses `agent:<name>`, `skill:<name>`, `command:/<name>` and `file:<path>` with the value enclosed in backticks after the prefix. Fenced examples are ignored; referenced files and canonical `SKILL.md` files must resolve inside the repository.
- `candidate:manifest` binds the resolved base commit to all tracked changes, deletions and non-ignored untracked files. Each included file records its normalized repository-relative path, state, kind, mode and SHA-256 content or symlink-target digest; the output also includes a digest of the complete payload.
- Positional paths or `--from <newline-delimited-file>` may make the scope explicit, but every discovered path must be included. `--exclude path=reason` declares an ambient path outside the candidate under `nonCandidateExclusions`; it is not a scanner waiver or approval to omit candidate source. Repository escapes, control characters, undecodable paths, unchanged paths, unexplained exclusions and empty candidate scopes fail.

## Local development dependencies (PostgreSQL + Mailpit + Redis)

The auth/database features need real PostgreSQL, observable email, and the
Redis transport used by queued work. All run locally through Docker Compose —
no external resources or system installs:

```sh
bun run db:up      # start postgres + mailpit, wait until healthy
bun run db:down    # stop (bun run db:down -- -v also drops the data volume)
bun run db:logs    # follow container logs
bun run db:psql    # owner psql shell (DDL/migrations only)
bun run db:mail    # print the Mailpit web UI URL
bun run db:migrate # schema migrations (owned by @nightwatch/db)
bun run db:partitions # monitor and audit_events partitions (owner role), after db:migrate
bun run provision:organization -- \
  --name "Acme" --slug acme --owner-email admin@example.com
                   # first-org operator provisioning (invitation-only;
                   # owner invitation sent through configured SMTP)
```

- `db:migrate` and `provision:organization` are root wrappers
  (`scripts/migrate.mjs`, `scripts/provision.mjs`) that resolve the same
  environment as `bun run dev` via `scripts/dev-env.mjs`: generated
  `.env.compose.local` secrets plus computed local origins/SMTP, with
  explicitly exported shell variables always winning (blanks count as
  unset). Both fail fast when no database URL resolves instead of invoking
  the underlying CLI with an empty environment.
  Owner provisioning retries re-send only a live pending **owner**
  invitation for the same organization/email. A pending invitation with a
  different role is visibly refused, unchanged, without sending mail.

- `db:seed` is a local demo-only wrapper. It requires this worktree's generated
  `.env.compose.local` and refuses any owner or runtime URL other than its exact
  loopback Compose pair. Run `bun run db:migrate` first, then `bun run db:seed`.
  It converges two demo organizations, four verified `.invalid` users and their
  memberships: `owner@nightwatch.invalid` (owner), `admin@nightwatch.invalid`
  (admin), `viewer@nightwatch.invalid` (viewer), and `auditor@nightwatch.invalid`
  (auditor). The password is `nightwatch-demo-password`, public only for local
  Compose demos: never reuse it outside local Compose. It refreshes 16 notification
  intents, 28 inbox items, and 16 completed dispatch ledgers through runtime
  tenant/account RLS contexts plus a bounded owner-only fixture ledger insert.
  It does not enqueue work or mutate ambient notification ledgers.

- Every worktree gets an isolated compose project (`nw-dev-<slot>`) and
  loopback-only ports from `scripts/ports.mjs`: PostgreSQL `127.0.0.1:5400+slot`,
  Mailpit SMTP `127.0.0.1:7400+slot`, Mailpit UI `127.0.0.1:7500+slot`, and
  Redis transport `127.0.0.1:6380+slot`. The Redis port follows the same stable
  worktree slot; runtime code receives it only through `REDIS_URL`, resolved by
  `scripts/dev-env.mjs`. The bases deliberately avoid fixed service ports so the
  stack never shadows system services.
- Two database roles: `nightwatch_owner` (container superuser — DDL,
  migrations, provisioning only) and `nightwatch` (runtime: `LOGIN NOSUPERUSER
NOCREATEDB NOCREATEROLE NOBYPASSRLS`). The runtime role is created by
  `scripts/db/init/001-roles.sh` (also used by CI); table grants are applied by
  migrations. `DATABASE_URL` must use the runtime role, `DATABASE_OWNER_URL`
  the owner; the migration runner resolves owner before app URL.
- Notification migration `0008_notification_function_owners.sql` creates cluster-global NOLOGIN function-owner roles. Clean migration replay requires a fresh PostgreSQL cluster. Local E2E can restore a schema-only snapshot and its migration ledger into a separate database on the dev cluster without recreating roles (architecture DB-13). The DDL owner needs `CREATEROLE` or superuser privileges for initial creation; runtime stays unprivileged. The isolated Worker scheduler integration test still provisions its own cluster to verify clean migrations. Deployment requires a separate approval gate.
- Development secrets (role passwords, `BETTER_AUTH_SECRET`) are generated on
  first `bun run db:up` into `.env.compose.local` — gitignored, mode 0600,
  never committed. `scripts/dev.mjs` forwards them with the computed
  `APP_URL` / `BETTER_AUTH_URL` / `CORS_ORIGIN` / `SMTP_*` / `REDIS_URL`
  values; explicitly exported shell variables always win. `bun run db:up` must
  precede `bun run dev`. Redis uses no development secret, has no volume, and is
  an ephemeral transport only; durable work state remains in PostgreSQL.
- Mailpit captures verification/reset/invitation mail in memory (messages reset
  on container restart); open the UI from `bun run db:mail`. Production requires
  real configured SMTP — there is no fallback sender (see `.env.example`).
- Cleanup scope: `db:down` removes only this worktree's `nw-dev-<slot>`
  containers/network; the `pgdata` volume survives until an explicit
  `db:down -- -v`. Do not remove other worktrees' projects or volumes.

## Coverage policy

- Thresholds (80% lines / statements / functions, 70% branches) live in **each
  app's `vitest.config`** (`apps/api`, `apps/web`). Do not duplicate them at
  the root, and never lower them to make the gate pass.
- Root `test:coverage` is `turbo run test:coverage --concurrency=1`: it passes
  through to the app-level coverage runs and collects their reports; the root
  sets no thresholds of its own. Packages run one at a time because the DB
  suites share one Postgres, and parallel runs hit timeouts under load (a claim
  test at 5 s, a lock wait of 5 s). CI splits the `test` job into a matrix
  (`web`, `worker`, `api`, `packages`) with one Postgres per job, so groups run
  in parallel and packages inside a group still run one at a time.
- Coverage is always measured and reported. Thresholds **fail the run only
  when `COVERAGE_GATE=1`** is set in the app's environment. The gate is **on**
  in the CI `test` job (`COVERAGE_GATE: "1"`) since the first domain feature
  (auth/onboarding); removing it requires an explicit release decision.

## Integration tests (real database)

`apps/api` splits its suite into two explicit vitest projects:

- **unit** — `bun run test`; no database required, ever.
- **integration** — `bun run test:integration` (root alias) runs
  `*.db.test.ts` against an explicitly supplied database. **Both URLs are
  required** before any database work: `DATABASE_URL` (runtime role,
  non-owner NOBYPASSRLS) and `DATABASE_OWNER_URL` (owner role for
  self-applied idempotent migrations and the privilege-denial case; the
  runtime role is never borrowed for owner work, so there is no fallback).
  A missing database URL throws a refusal — the suite never silently
  skips. Root `test:coverage` intentionally runs **both** projects, so the
  coverage gate also needs the integration environment.

Local invocation never uses an ambient or production database — load this
worktree's generated URLs through `scripts/dev-env.mjs` (shell env still
wins):

```sh
(
  set -e
  bun run db:up # generates .env.compose.local (gitignored, 0600)
  trap 'bun run db:down' EXIT
  bun -e '
    const { resolveDevEnv } = await import("./scripts/dev-env.mjs");
    const { env } = resolveDevEnv();
    const child = Bun.spawn(["bun", "run", "test:integration"], {
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exit(await child.exited);
  '
)
```

CI needs no extra wiring: the `test` job already exports both database URLs
from its disposable PostgreSQL service and runs `bun run db:migrate` before
`bun run test:coverage`, so the gate measures real factory/adapter paths.

## CI database-backed checks

- The CI `test` job (and the dispatch-only `full` job) run PostgreSQL, Mailpit,
  and a health-checked Redis transport service, then bootstrap the
  least-privilege runtime role by executing `scripts/db/init/001-roles.sh` in a
  one-off Postgres container — the same script compose uses locally. `bun run
db:migrate` applies schema migrations before tests/e2e (in CI there is no
  generated secrets file, so the wrapper uses the exported job environment
  unchanged), so DB-backed tests run against real, role-separated database
  paths. Redis is exposed only as `REDIS_URL=redis://localhost:6379`; it has no
  durable volume or application state.
- CI database values (`nightwatch_ci` / `nightwatch_owner_ci` passwords) are
  disposable, localhost-only development credentials; `BETTER_AUTH_SECRET` is
  generated per run. Never promote them to any real environment.
- Regular app DB-backed checks reuse the CI service block and
  `scripts/db/init/001-roles.sh` rather than inventing parallel setup. The
  isolated Worker clean-migration test is an exception: it provisions a
  task-owned fresh PostgreSQL cluster, reuses the same role bootstrap, and
  removes only its own cluster. Migration `0008_notification_function_owners.sql`
  cannot be clean-applied to a second database on the shared cluster (architecture DB-13).

## Monitor environment and partitions

- `bun run db:partitions` (`scripts/partitions.mjs`) calls
  `ensure_monitor_partitions(3)` with `DATABASE_OWNER_URL` only; the runtime role
  has no `EXECUTE`. It creates the previous, current and next 3 month partitions
  of `monitor_check_results` and `monitor_check_hourly`, drops partitions whose
  whole range is older than 31 days, and is safe to rerun. Run it after
  `db:migrate` in every environment and at least monthly. It sets a
  transaction-local `lock_timeout` (`PARTITION_LOCK_TIMEOUT_MS`, 1..30000, default 5000)
  because a create or drop needs a lock on the parent table (inferred); on timeout the transaction rolls back,
  the script prints the reason and exits 1. `PARTITION_MONTHS_AHEAD` (0..12,
  default 3) overrides the horizon.
- The same call, in the same transaction, runs `ensure_audit_event_partitions(3)`
  for `audit_events` (F-007): previous, current and next 3 monthly partitions,
  dropping partitions whose whole range ended more than 366 days ago. There is
  no DEFAULT partition, so if no partition covers the current month every
  audited mutation (members, invitations, notification settings) fails with an
  insert error. Run `db:partitions` on every deploy and at least monthly.
- Env names (validated by `loadMonitorEnv()` in `packages/shared/src/env.ts`):
  `CREDENTIAL_ENCRYPTION_KEYS` (JSON map of key version to base64 32-byte key),
  `CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION`, `REDIS_URL`,
  `MONITOR_EGRESS_CANARY_URLS` (optional), `OUTBOUND_TEST_ALLOWED_HOSTS`
  (optional, hostnames, CI and e2e only; startup fails when set with
  `NODE_ENV=production`).
- Dev: nothing is generated. When `CREDENTIAL_ENCRYPTION_KEYS` is unset outside
  production, `loadMonitorEnv()` uses a public development key with version
  `dev`; production refuses that key and version.
- CI (jobs `test` and `full`): the job generates a random key per run into
  `CREDENTIAL_ENCRYPTION_KEYS` (version `ci`, masked), sets
  `OUTBOUND_TEST_ALLOWED_HOSTS=target.nw-test.internal` (mapped to 127.0.0.1 in
  `/etc/hosts` by a job step, because the SSRF helper blocks `localhost`), and runs `bun run db:partitions` after
  `db:migrate`. Job `build` gets none of these. `MONITOR_EGRESS_CANARY_URLS` is
  unset in CI because runners may lack internet; tests are intended to inject
  the canary (not yet exercised).
- e2e (`e2e/tests/monitors.spec.ts`): `playwright.config.ts` starts the Worker
  with roles `consumer,scheduler,monitor-scheduler,monitor-checker,audit-exporter`
  and forwards the four monitor variables above to the Worker
  and API. The spec needs `OUTBOUND_TEST_ALLOWED_HOSTS` to name a hostname that
  resolves to 127.0.0.1; it starts its own target server on 127.0.0.1 (from
  `e2e/support/monitor-target.mjs`) and reaches it through that hostname. CI
  provides `target.nw-test.internal`. The local runner defaults to
  `OUTBOUND_TEST_ALLOWED_HOSTS=127.0.0.1.nip.io` (public wildcard DNS, needs
  internet). Override it with a loopback hostname already mapped in `/etc/hosts`
  to avoid public DNS. The credential keys stay unset outside
  production (development key). `REDIS_KEY_PREFIX` is optional and defaults to
  the existing queue and rate-limit namespaces when unset. The down and recovered flow waits for real
  schedule rounds (1 minute interval), so the spec takes about 5 minutes.
- `turbo.json` `globalPassThroughEnv` forwards the four monitor variables to
  turbo-run tasks without putting key values in the cache hash.
- Bun runtime: `test` and `test:coverage` run vitest on Node. Job `test` also
  runs `bun run --cwd packages/shared test:bun` (`bun --bun vitest run`) so the
  SSRF helper is exercised on the pinned Bun.
- Runbook: [uptime monitor operations](../../docs/runbooks/uptime-monitor.md).

## OpenAPI client drift

Web operation types come from OpenAPI emitted by the real API composition.
Generation runs in-process; no API, database, or SMTP server is needed.

```sh
bun run --cwd apps/web codegen # regenerate and commit the client types
bun run codegen:check          # check committed output without changing it
```

- `apps/api/src/operator/emit-openapi.ts` composes the API and emits OpenAPI.
  `apps/web/scripts/codegen-openapi.mjs` converts it. Output:
  `apps/web/src/lib/api/openapi-types.gen.ts`.
- API route or schema changes MUST run Web `codegen` and commit its output.
  Never edit or format it directly. Prettier ignores it; drift checks compare bytes.
- Root `validate` runs `codegen:check` before lint, typecheck, and tests. CI
  `typecheck` runs the same command after a frozen install, so stale output
  blocks pull requests.
- Turbo caching is off because Web reads API sources outside its package. A
  cache could miss API-only changes. Architecture requirements remain in WEB-01
  and WEB-02. This section defines only drift checks.

## Playwright E2E

Install E2E dependencies and Chromium once, then run the suite with Docker
available:

```sh
bun install --cwd e2e --frozen-lockfile
(cd e2e && bun x playwright install chromium)
bun run db:up
bun run db:migrate
bun run e2e
bun run --cwd e2e test tests/monitors-states.spec.ts
```

`scripts/e2e.mjs` reuses this worktree's PostgreSQL, Redis, and Mailpit
containers. Each local run owns a `nw_e2e_<uuid>` database and Redis prefix,
a fresh auth secret, and dynamically allocated API and Web ports. It creates
no containers or volumes. Playwright refuses to reuse an existing API or Web
server.

`scripts/e2e-database.mjs` checks that the caller's database and Redis URLs
match the generated local Compose configuration. The dev migration ledger must
match the repository's migration names and checksums exactly. The helper
exports a read-only PostgreSQL snapshot, restores schema only, and copies the
migration ledger from that same snapshot. It copies no application data and
changes no cluster roles. The regular migration runner then checks the copied
ledger, and `db:partitions` prepares current monitor and audit partitions in the
E2E database. This E2E bootstrap does not replace fresh-cluster migration tests.

`REDIS_KEY_PREFIX` isolates both BullMQ queues and consumers, and the API's
rate-limit keys, including Lua script keys. Cleanup drops only the generated
database and scans and unlinks only keys under that run's prefix after success,
failure, SIGINT, or SIGTERM. It never uses `FLUSHDB` or stops dev containers.
SIGKILL cannot run cleanup.

Keep `bun run dev` running if needed. Separate databases prevent dev schedulers
from claiming E2E monitor rows. Redis prefixes prevent dev consumers from
receiving E2E jobs without `OUTBOUND_TEST_ALLOWED_HOSTS`. Increasing assertion
timeouts does not correct a `blocked_address` result from those consumers.

Verify logical isolation against the running local services:

```sh
bun test scripts/verification/e2e-isolation.test.mjs
```

This check creates two E2E databases and prefixes. It verifies empty application
tables, copied migration checksums, runtime role and RLS flags, delivery through
both queues, independent Lua rate limits, and cleanup that preserves an
unprefixed Redis sentinel.

With `CI` set or `E2E_EXTERNAL_SERVICES=1`, the runner uses caller-supplied
services through `resolveDevEnv()` and does not create, migrate, or remove a
database or Redis namespace. Apply migrations and provision any `E2E_EMAIL`/`E2E_PASSWORD`
fixture before this mode. Use dedicated services with no competing dev Worker.
Local isolated runs generate `E2E_EMAIL` and `E2E_PASSWORD` and invoke
`apps/api/src/operator/provision-e2e-fixture.ts` inside the E2E database. They set
`E2E_REQUIRE_CREDENTIALS=1`, so all four signed-in settings tests run without
using a dev account. The tests enable and disable MFA and change and restore
the password. `--list` and `--help` bypass database bootstrap and provisioning.

The Worker must log `in-app materialize worker ready` after its Redis consumer
is ready. Playwright waits for that signal before browser tests begin.

The suite covers observable browser/API contracts. These include public auth
entry and client-side validation without an invalid boundary request. They also
include data-router redirects, safe invitation failure, and the typed API
greeting. It supplements, but does not replace, unit and database integration
tests.

CI runs Playwright only in the dispatch-only `full` release-stage job. It reuses
the shared PostgreSQL, Mailpit, and Redis services, applies migrations, and
starts the Worker with the same runtime database/Redis URLs before the browser
suite. It then runs the same root `e2e` command.

- `security` chains `security:audit` → `security:secrets` → `security:sast`
  (sequential, fail-fast).
  - `security:audit` → `bun audit --audit-level=high` (critical/high fail)
  - `security:secrets` → gitleaks with `.gitleaks.toml`
  - `security:sast` → semgrep registry packs `p/typescript` +
    `p/security-audit` with `--error`
- `security:image` → for `api` then `worker`: docker build of
  `apps/<app>/Dockerfile` (tags `nightwatch-<app>:trivy-scan`) and trivy
  `--severity HIGH,CRITICAL --exit-code 1`. Fail-fast: an API image failure
  stops before the Worker image. Scanner execution errors must fail, never
  swallow a scanner non-zero exit as a pass.
