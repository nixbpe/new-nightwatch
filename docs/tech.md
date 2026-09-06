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
| API | Hono 4.12.27; `@hono/node-server` | HTTP routing and middleware |
| Identity | Better Auth 1.6.25 | Sessions, organizations and MFA |
| Validation | Zod 3.25.76 | Request schemas |
| Persistence | Drizzle ORM 0.45.2; postgres.js 3.4.x | Schema, typed queries and SQL |
| Database | PostgreSQL 17 | Relational data, RLS and partitions |
| Jobs | BullMQ 5.79.1; ioredis 5.11.x; Redis 7 | Queue transport and Redis operations |
| Internal web | React/React DOM 18.3.1; Vite 8.1.0 | Operational SPA |
| Routing/data | TanStack Router 1.x; Query 5.x | Routing and scoped server-state cache |
| Styling | Tailwind CSS/Vite plugin 4.2.2 | Tokens and utilities |
| Marketing | Astro 7.1.6 | Static landing site |
| Cloud scanning | Prowler 5.20.0; AWS SDK v3 | Security collection and integrations |
| Unit tests | `bun:test` | Behavioral tests |
| Browser tests | Playwright 1.61.1 | Chromium E2E |

## 2. Workspace ownership

| Workspace | Responsibility |
| --- | --- |
| `@nightwatch/api` — `apps/api` | HTTP domains, identity, permissions and audit |
| `@nightwatch/web` — `apps/web` | Internal UI; browser-safe contracts only |
| `@nightwatch/landing` — `apps/landing` | Independent marketing; no internal `workspace:*` dependencies |
| `@nightwatch/worker` — `apps/worker` | Consumers, scans, reports, health and schedulers |
| `@nightwatch/db` — `packages/db` | Schema, tenant helpers, migrations and persistence |
| `@nightwatch/queue` — `packages/queue` | Jobs, producers and ledger; depends on DB and Redis |
| `@nightwatch/shared` — `packages/shared` | Permissions, crypto, logging and utilities |
| `@nightwatch/typescript-config` | Compiler configuration; no runtime service |

Use shared TypeScript settings: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: bundler`, `noEmit`. Check each package's scripts; root tasks need not discover every shared test.

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
| `bun run --cwd apps/landing dev` | Landing development |
| `bun run --cwd apps/worker dev` | Worker development |
| `bun run --cwd apps/api test` | Per-file isolated API suite |
| `bun run --cwd apps/worker test` | Per-file isolated worker suite |
| `bun run --cwd apps/web test` | Web tests |
| `bun run typecheck` | Workspace type checks |
| `bun run lint` | Package-specific checks and guards |
| `bun run check:tenant-context` | Tenant transaction guard |
| `bun run check:tenant-coverage` | Tenant middleware guard |
| `bun run test` | Workspace suites; inspect discovery |
| `bun run test:coverage` | Explicit coverage run |
| `bun run audit` | Dependency audit |
| `bun run build` | Build graph |
| `bun run e2e` | Dedicated browser test environment |

Keep dev tasks persistent/uncached and data-mutating tasks uncached. Express build prerequisites through the workspace graph.

### Database operations

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

- Infrastructure: PostgreSQL, Redis, Mailpit. Inspect services/profiles before `docker compose up -d` or `docker compose --profile full up -d`.
- Run Vite on the host; keep infrastructure-only and full-backend startup distinct. Avoid duplicate host/container schedulers.
- Use host URLs for native processes and service DNS for containers. Proxy web `/api` to the local API; align CORS and auth origins.
- Keep development ports and credentials within a trusted local boundary; do not expose them on public/shared hosts.

| Service | Local endpoint |
| --- | --- |
| Web / API / Landing | `http://localhost:3000` / `http://localhost:4000` / `http://localhost:3100` |
| PostgreSQL / Redis | Ports 5432 / 6379 |
| SMTP / Mailpit UI | Port 1025 / `http://localhost:8025` |

### Environment groups

| Group | Variables |
| --- | --- |
| Persistence | `DATABASE_URL`, `DATABASE_OWNER_URL`, `DB_POOL_SIZE`, `REDIS_URL` |
| Identity/browser | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_URL`, `CORS_ORIGIN` |
| Encryption | `CREDENTIAL_ENCRYPTION_KEY`, `CREDENTIAL_ENCRYPTION_KEY_VERSION`, `CREDENTIAL_ENCRYPTION_KEY_VN` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL`, `SUPPORT_EMAIL` |
| Runtime | `NODE_ENV`, `LOG_LEVEL`, `API_PORT` |
| Concurrency | `WORKER_DEFAULT_CONCURRENCY`, `WORKER_CONCURRENCY_<QUEUE>` |

Keep secrets out of documentation, logs and source control. Verify consumers/startup validation when changing configuration. Retain historical encryption keys while records depend on them; inspect catalog concurrency exceptions before changing worker limits.

### Deployment

- Keep API, workers, web and landing deployment responsibilities explicit. Use owner credentials for migrations/partitions and restricted application credentials at runtime.
- Include pinned Prowler/Python dependencies in reproducible, non-root worker images. Align build-time and runtime environment settings.
- Choose combined or split worker entrypoints deliberately; check consumers/schedulers before scaling replicas.
- Verify TLS, origins, secrets, monitoring exporters and resource ownership in the target environment. Readiness is not proof of RLS, partitions, SMTP or worker execution.

## 6. Verification and tooling

### Lint and format

- API/worker/landing: Biome; two spaces, single-quoted JavaScript, no explicit `any`.
- Web: type-aware Oxlint, Oxfmt and typography/button/navigation/table guards.
- Respect package ownership; do not blanket-format across different configurations or suppress diagnostics to conceal incompatibility.

### Tests and CI

- Preserve per-file processes for API/worker module mocks. Do not replace isolation with one broad `bun test apps packages` invocation.
- Verify RLS through restricted `TEST_APP_DATABASE_URL`; owner connections are for authorized fixtures/DDL.
- Inspect Playwright discovery and setup hooks. Redis `FLUSHDB`, partition bootstrap and seeds require disposable targets.
- Keep guards, types, tests, audit, coverage and build evidence distinct. Inspect actual CI requirements; advisory checks are not release gates.
- Do not hide failures with audit ignores or broad coverage exclusions. Report executed checks, results and skipped coverage accurately.

## 7. Compatibility checks

- Distinguish version ranges, lockfile resolutions, runtime binaries and image tags. Keep upgrades coordinated across manifests, lockfiles and deployment configuration.
- Align React runtime/types and formatter/config schemas. Test supported database majors in the relevant environments.
- Check shared-package test discovery and generated SQL against the actual migration sequence.
- Verify affected integrations after dependency changes. Do not provision infrastructure or run migrations as incidental cleanup.
