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

- `workflow:test` exercises the agent-reference and candidate-binding scripts. Root `validate` runs it before other gates.
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
bun run db:partitions # monitor result partitions (owner role), after db:migrate
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
- Notification migration `0008_notification_function_owners.sql` creates cluster-global NOLOGIN function-owner roles. A clean migration must use a fresh dedicated PostgreSQL cluster, not a second database on a cluster where NightWatch migrations already ran; only one NightWatch database per cluster is supported by this migration. The DDL owner needs `CREATEROLE` or superuser privileges for initial creation; runtime stays unprivileged. The isolated Worker scheduler integration test must provision and remove only its own ephemeral cluster. Deployment still requires a separate approval gate (architecture DB-13).
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
- Root `test:coverage` is `turbo run test:coverage`: it passes through to the
  app-level coverage runs and collects their reports; the root sets no
  thresholds of its own.
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
  transaction-local `lock_timeout` (`PARTITION_LOCK_TIMEOUT_MS`, default 5000)
  because a drop locks the parent table; on timeout the transaction rolls back,
  the script prints the reason and exits 1. `PARTITION_MONTHS_AHEAD` (0..12,
  default 3) overrides the horizon.
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
  `OUTBOUND_TEST_ALLOWED_HOSTS=localhost`, and runs `bun run db:partitions` after
  `db:migrate`. Job `build` gets none of these. `MONITOR_EGRESS_CANARY_URLS` is
  unset in CI because runners may lack internet; tests inject the canary.
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

Playwright is already configured in `e2e/playwright.config.ts`. It starts the
Worker, API, and Web servers itself and runs `e2e/tests` in Chromium. Install
isolated E2E dependencies and Chromium once:

The caller supplies runtime configuration; Playwright forwards `DATABASE_URL`
and `REDIS_URL` to the Worker and `REDIS_URL` to the API without fabricating
either service. The Worker must log `in-app materialize worker ready` after its
Redis queue/consumer is ready; Playwright waits for that bounded readiness
signal before browser tests begin. A notification E2E can therefore exercise
real materialization only when the caller has started local PostgreSQL and
Redis and applied the required schema migrations.

```sh
(
  set -e
  bun run db:up
  trap 'bun run db:down' EXIT
  bun -e '
    const { resolveDevEnv } = await import("./scripts/dev-env.mjs");
    const { env } = resolveDevEnv();
    for (const script of ["db:migrate", "e2e"]) {
      const child = Bun.spawn(["bun", "run", script], {
        env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await child.exited;
      if (exitCode !== 0) process.exit(exitCode);
    }
  '
)
```

Resolved values pass directly in `env`, never through shell source. The `EXIT`
trap cleans up after success, migration/E2E failure, or interruption. Cleanup affects only
the current worktree's containers and network. It keeps the database volume
unless `db:down -- -v` is used.

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
- `security:image` → docker build + trivy `--severity HIGH,CRITICAL
--exit-code 1` once `apps/api/Dockerfile` exists; skips with a message
  otherwise. Scanner execution errors must fail — never swallow a scanner
  non-zero exit as a pass.
