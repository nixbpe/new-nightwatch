# NightWatch — Technology Reference

Use this reference for tooling and runtime decisions. See [Architecture](architecture.md), [Design system](design-system.md) and [AGENTS.md](../AGENTS.md) for their respective boundaries.

## 1. Technology and versions

Treat these as documented targets, not installed-version evidence. Resolve exact versions from current manifests, lockfiles and runtime configuration; review upgrades explicitly.

| Concern | Technology target | Use |
| --- | --- | --- |
| Runtime/package manager | Bun 1.3.2 | Install, execute, build and test |
| Node tooling | Node 22.12.0 or compatible supported version | Toolchain compatibility |
| Workspace tasks | Turborepo 2.10.0 | Dependency graph and cache |
| Language | TypeScript 5.9.3 | Typed application/shared contracts |
| API | Hono 4.12.27; `@hono/node-server`; `@hono/zod-openapi` | HTTP routing, middleware and OpenAPI |
| Identity | Better Auth 1.6.25 (deferred to first auth feature) | Sessions, organizations and MFA |
| Validation | Zod 3.25.76 | Contracts and request schemas |
| Persistence | Drizzle ORM 0.45.2; postgres.js 3.4.x (deferred to first persistence feature) | Schema, typed queries and SQL |
| Database | PostgreSQL 17 (deferred) | Relational data, RLS and partitions |
| Jobs | BullMQ 5.79.1; ioredis 5.11.x; Redis 7 (deferred) | Queue transport and Redis operations |
| Internal web | React 19; Vite 8.1.0 | Operational SPA |
| Routing/data | React Router 7; TanStack Query 5.x | Routing and scoped server-state cache |
| Styling | Tailwind CSS/Vite plugin 4.2.2 | Tokens and utilities |
| Marketing | Astro 7.1.6 (deferred) | Static landing site |
| Cloud scanning | Prowler 5.20.0; AWS SDK v3 (deferred with worker) | Security collection and integrations |
| Unit/component tests | Vitest 5.x; Testing Library for web | Behavioral tests |
| Browser tests | Playwright 1.61.1 | Chromium E2E |
| Lint/format | ESLint 9 flat config + typescript-eslint; Prettier | Static checks and formatting |
| Security scanning | bun audit; Semgrep; Gitleaks; Trivy | Dependency, SAST, secret and container scans |

## 2. Workspace ownership

| Workspace | Responsibility |
| --- | --- |
| `@nightwatch/api` — `apps/api` | HTTP domains, identity, permissions and audit |
| `@nightwatch/web` — `apps/web` | Internal UI; browser-safe contracts only |
| `@nightwatch/landing` — `apps/landing` | **Deferred** — independent marketing; no internal `workspace:*` dependencies |
| `@nightwatch/worker` — `apps/worker` | **Deferred** — consumers, scans, reports, health and schedulers |
| `@nightwatch/api-contract` — `packages/api-contract` | Browser-safe Zod schemas, types and error contract; package-root exports only |
| `@nightwatch/db` — `packages/db` | **Deferred** — schema, tenant helpers, migrations and persistence |
| `@nightwatch/queue` — `packages/queue` | **Deferred** — jobs, producers and ledger; depends on DB and Redis |
| `@nightwatch/shared` — `packages/shared` | Server-only permissions, crypto, logging, env validation and utilities |
| `@nightwatch/eslint-config` — `packages/eslint-config` | Shared ESLint flat-config factory |
| `@nightwatch/typescript-config` — `packages/typescript-config` | Compiler configuration; no runtime service |

Use shared TypeScript settings: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: bundler`, `noEmit`. Check each package's scripts; root tasks need not discover every shared test.
Dependency direction: web → `api-contract` only; api → `api-contract` + `shared`; config packages depend on no application code. ESLint boundary rules enforce these directions.

## 3. Supporting libraries

| Concern | Reuse |
| --- | --- |
| UI primitives | Local web components; Radix Dropdown Menu, Slot and Switch |
| Classes | `clsx`, `tailwind-merge`, project `cn`; preserve custom text-size recognition |
| Icons/feedback | Lucide React, Sonner |
| Charts/content | Recharts, react-markdown, qrcode.react |
| Cloud identity | AWS SDK STS, Identity Store and SSO Admin; server-side only |
| Email | Nodemailer; Mailpit for local SMTP, not production |
| Reports | ExcelJS for XLSX; separate CSV/JSON serializers |
| Logging | Pino for structured logs; pino-pretty for development |
| Observability | OpenTelemetry and prom-client; configure collection/export separately |
| Scheduling | Croner and worker schedulers; avoid duplicate dispatchers |

Inspect existing use before adding dependencies. Do not connect landing to internal UI/auth packages or expose server-only utilities to the browser.

## 4. Commands and working directory

Run from the workspace root unless `--cwd` selects a package. Confirm scripts, prerequisites and side effects before execution; do not invent missing commands.

| Command | Scope |
| --- | --- |
| `bun install --frozen-lockfile` | Locked dependencies |
| `bun run dev` | Workspace development |
| `bun run --cwd apps/api dev` | API development |
| `bun run --cwd apps/web dev` | Web development |
| `bun run --cwd apps/landing dev` | Landing development (deferred) |
| `bun run --cwd apps/worker dev` | Worker development (deferred) |
| `bun run --cwd apps/api test` | API Vitest suite |
| `bun run --cwd apps/worker test` | Worker Vitest suite (deferred) |
| `bun run --cwd apps/web test` | Web Vitest suite |
| `bun run typecheck` | Workspace type checks |
| `bun run lint` | Package-specific ESLint checks and guards |
| `bun run format:check` | Prettier check |
| `bun run test` | Workspace suites; inspect discovery |
| `bun run test:coverage` | Coverage run; thresholds 80% lines/statements/functions, 70% branches are configured in each app's Vitest config |
| `bun run audit` | Dependency audit |
| `bun run security` | audit + Gitleaks + Semgrep; Trivy joins when images exist; scanner errors fail |
| `bun run validate` | Local quality gate: format:check + lint + typecheck + test; reproduces blocking CI jobs |
| `bun run build` | Build graph |
| `bun run e2e` | Dedicated browser test environment |

Keep dev tasks persistent/uncached and data-mutating tasks uncached. Express build prerequisites through the workspace graph.
Coverage thresholds are wired and measured but do not block `validate` until the first domain feature; CI turns them blocking then. Set `COVERAGE_GATE=1` to make thresholds fail the run (see `scripts/quality/README.md`).

### Database operations (apply when persistence lands)

| Command | Safety boundary |
| --- | --- |
| `bun run db:migrate` | Confirm target, owner credentials and scope |
| `bun run db:generate` | Candidate SQL only; review before applying |
| `bun run --cwd packages/db db:partition-maintenance` | Authorized owner-role DDL |
| `bun run setup` | Authorized application bootstrap |
| `bun run setup:status` | Inspect behavior before assuming read-only execution |
| `bun run db:seed` | Demo data in a dedicated environment |

Use the custom runner, ordered `NNNN_*.sql` and `__nightwatch_migrations` tracking. Review generated metadata against applied SQL; never rewrite applied migrations or bypass the runner with `drizzle-kit push`/`migrate`. Select the database explicitly; runtime credentials remain restricted.

## 5. Local runtime and deployment

### Local modes

- Scaffold phase runs only the API (4000) and web (3000). PostgreSQL, Redis and Mailpit join with the first persistence feature.

- When infrastructure lands: inspect services/profiles before `docker compose up -d` or `docker compose --profile full up -d`; avoid duplicate host/container schedulers.
- Use host URLs for native processes and service DNS for containers. Proxy web `/api` to the local API; align CORS and auth origins.
- Keep development ports and credentials within a trusted local boundary; do not expose them on public/shared hosts.

| Service | Local endpoint |
| --- | --- |
| Web / API | `http://localhost:3000` / `http://localhost:4000` |
| Landing | `http://localhost:3100` (deferred) |
| PostgreSQL / Redis | Ports 5432 / 6379 (deferred) |
| SMTP / Mailpit UI | Port 1025 / `http://localhost:8025` (deferred) |

### Environment groups

| Group | Variables |
| --- | --- |
| Persistence | `DATABASE_URL`, `DATABASE_OWNER_URL`, `DB_POOL_SIZE`, `REDIS_URL` (deferred) |
| Identity/browser | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_URL`, `CORS_ORIGIN` (auth deferred) |
| Encryption | `CREDENTIAL_ENCRYPTION_KEY`, `CREDENTIAL_ENCRYPTION_KEY_VERSION`, `CREDENTIAL_ENCRYPTION_KEY_VN` (deferred) |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL`, `SUPPORT_EMAIL` (deferred) |
| Runtime | `NODE_ENV`, `LOG_LEVEL`, `API_PORT` |
| Concurrency | `WORKER_DEFAULT_CONCURRENCY`, `WORKER_CONCURRENCY_<QUEUE>` (deferred) |

Keep secrets out of documentation, logs and source control. Verify consumers/startup validation when changing configuration. Retain historical encryption keys while records depend on them; inspect catalog concurrency exceptions before changing worker limits.

### Deployment

- Keep API, workers, web and landing deployment responsibilities explicit. Use owner credentials for migrations/partitions and restricted application credentials at runtime.
- Include pinned Prowler/Python dependencies in reproducible, non-root worker images. Align build-time and runtime environment settings.
- Choose combined or split worker entrypoints deliberately; check consumers/schedulers before scaling replicas.
- Verify TLS, origins, secrets, monitoring exporters and resource ownership in the target environment. Readiness is not proof of RLS, partitions, SMTP or worker execution.

## 6. Verification and tooling

### Lint and format

- All packages: ESLint 9 flat config via `@nightwatch/eslint-config` (`createConfig`; `react: true` for web) with typescript-eslint strict-type-checked; Prettier for formatting.
- The config blocks `apps/web` from importing `@nightwatch/shared`; respect package ownership and do not weaken rules to pass.
- Do not suppress diagnostics to conceal incompatibility.

### Tests and CI

- Vitest in both apps; Testing Library for web components. Mock module boundaries, not globals.
- Verify RLS through restricted `TEST_APP_DATABASE_URL` when persistence lands; owner connections are for authorized fixtures/DDL.
- Inspect Playwright discovery and setup hooks. Redis `FLUSHDB`, partition bootstrap and seeds require disposable targets.
- Keep guards, types, tests, audit, coverage and build evidence distinct. Inspect actual CI requirements; advisory checks are not release gates.
- Security policy: critical/high vulnerabilities = 0, secrets = 0, scanner execution errors fail the pipeline. Do not hide failures with audit ignores or broad coverage exclusions. Report executed checks, results and skipped coverage accurately.

## 7. Compatibility checks

- Distinguish version ranges, lockfile resolutions, runtime binaries and image tags. Keep upgrades coordinated across manifests, lockfiles and deployment configuration.
- Align React runtime/types and lint config schema versions. Test supported database majors in the relevant environments when persistence lands.
- Check shared-package test discovery and generated SQL against the actual migration sequence.
- Verify affected integrations after dependency changes. Do not provision infrastructure or run migrations as incidental cleanup.
