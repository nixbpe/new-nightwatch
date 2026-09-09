# Quality gates

Root-level notes for the platform quality scripts. Scripts themselves live in
the root `package.json`; this file records where policies live and how the
scripts are meant to evolve.

## Local development dependencies (PostgreSQL + Mailpit)

The auth/database features need real PostgreSQL and observable email. Both run
locally through Docker Compose — no external resources, no system installs:

```sh
bun run db:up      # start postgres + mailpit, wait until healthy
bun run db:down    # stop (bun run db:down -- -v also drops the data volume)
bun run db:logs    # follow container logs
bun run db:psql    # owner psql shell (DDL/migrations only)
bun run db:mail    # print the Mailpit web UI URL
bun run db:migrate # schema migrations (owned by @nightwatch/db)
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

- Every worktree gets an isolated compose project (`nw-dev-<slot>`) and
  loopback-only ports from `scripts/ports.mjs`: PostgreSQL `127.0.0.1:5400+slot`,
  Mailpit SMTP `127.0.0.1:7400+slot`, Mailpit UI `127.0.0.1:7500+slot`. Override
  with `NW_DB_PORT` / `NW_MAIL_SMTP_PORT` / `NW_MAIL_UI_PORT` (same rule as
  `WEB_PORT` / `API_PORT`). The bases deliberately avoid the fixed service ports
  5432/1025/8025 so the stack never shadows system services.
- Two database roles: `nightwatch_owner` (container superuser — DDL,
  migrations, provisioning only) and `nightwatch` (runtime: `LOGIN NOSUPERUSER
NOCREATEDB NOCREATEROLE NOBYPASSRLS`). The runtime role is created by
  `scripts/db/init/001-roles.sh` (also used by CI); table grants are applied by
  migrations. `DATABASE_URL` must use the runtime role, `DATABASE_OWNER_URL`
  the owner; the migration runner resolves owner before app URL.
- Development secrets (role passwords, `BETTER_AUTH_SECRET`) are generated on
  first `bun run db:up` into `.env.compose.local` — gitignored, mode 0600,
  never committed. `scripts/dev.mjs` forwards them with the computed
  `APP_URL` / `BETTER_AUTH_URL` / `CORS_ORIGIN` / `SMTP_*` values; explicitly
  exported shell variables always win. `bun run db:up` must precede
  `bun run dev`.
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
bun run db:up   # generates .env.compose.local (gitignored, 0600)
eval "$(bun -e 'const { resolveDevEnv } = await import("./scripts/dev-env.mjs"); const { env } = resolveDevEnv(); for (const k of ["DATABASE_URL", "DATABASE_OWNER_URL"]) if (env[k]) console.log(`export ${k}=${JSON.stringify(env[k])}`);')"
bun run test:integration
```

CI needs no extra wiring: the `test` job already exports both database URLs
from its disposable PostgreSQL service and runs `bun run db:migrate` before
`bun run test:coverage`, so the gate measures real factory/adapter paths.

## CI database-backed checks

- The CI `test` job (and the dispatch-only `full` job) run PostgreSQL +
  Mailpit service containers and bootstrap the least-privilege runtime role by
  executing `scripts/db/init/001-roles.sh` in a one-off Postgres container —
  the same script compose uses locally. `bun run db:migrate` applies schema
  migrations before tests/e2e (in CI there is no generated secrets file, so
  the wrapper uses the exported job environment unchanged), so DB-backed
  tests run against a real, role-separated database (mocks cannot prove RLS
  or role denial).
- CI database values (`nightwatch_ci` / `nightwatch_owner_ci` passwords) are
  disposable, localhost-only development credentials; `BETTER_AUTH_SECRET` is
  generated per run. Never promote them to any real environment.
- New DB-backed jobs must reuse the same service block and role bootstrap
  instead of inventing parallel database setup.

## Security script shape

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
