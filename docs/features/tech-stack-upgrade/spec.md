# Tech Stack Upgrade Technical Spec

Owner: Technical Lead. Written from the tech stack review and a read-only platform-engineer verification on 2026-09-29. The user approved this spec and the scope-now set NODE-1, NODE-2, NODE-3, NODE-8, NODE-10 on 2026-09-29. No work is authorized to start.

| Field               | Value                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Feature             | None (platform chore; no Feature, Story or Acceptance matrix; exit criteria live in each Task's VERIFY/PROOF) |
| Epic                | None                                                                                           |
| Status              | Approved                                                                                       |
| Approved by user    | 2026-09-29 (covers this spec and the scope-now set NODE-1, NODE-2, NODE-3, NODE-8, NODE-10)    |
| Start authorization | None                                                                                           |
| `COMMIT_MODE`       | none                                                                                           |
| `STOP_AT`           | merge-ready                                                                                    |

Tracking: the user decided on 2026-09-29 to track this work as a platform chore under this spec. No Feature or Epic will be created. There is no Acceptance matrix and no `acceptanceVersion`, so approval freezes no matrix; exit criteria stay in each Task's VERIFY and PROOF and in Integrated verification.

## Evidence base

Observed on 2026-09-29 by platform-engineer (read-only, no file changed). "Confirmed" means read at the primary source listed; "unconfirmed" means it comes only from the earlier WebSearch summary.

| Item | Finding | Status | Source |
| --- | --- | --- | --- |
| Node 20 on runners | Removed 2026-09-23 (the review said 2026-09-16). Latest 5 `ci.yml` runs pass (run 36573604373, 2026-09-29); every job warns that `actions/checkout@v4` / `actions/upload-artifact@v4` (`node20`) are forced to run on Node 24 | confirmed | https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/, `gh run list`, run annotations |
| Action runtimes | `checkout@v4` `node20`, `upload-artifact@v4` `node20`, `setup-bun@v2` `node24`, `checkout@v6` `node24`, `upload-artifact@v6` `node24`; `upload-artifact` v7.0.1 also exists (runtime not read) | confirmed | `action.yml` at each ref via `gh api` |
| ubuntu-latest | Label migrates to Ubuntu 26 from 2026-10-19 | confirmed (run notice) | https://github.com/actions/runner-images/issues/14748 |
| CVE-2026-24910 | Bun before 1.3.5, trusted dependencies list spoofable by a non-npm package; repo pins 1.3.2. Exploitability in this repo (trustedDependencies, file/link/git deps) not checked | confirmed (range from description text, NVD has no CPE config) | NVD CVE-2026-24910, GHSA-xp39-vp6q-phvj, https://bun.com/blog/bun-v1.3.5 |
| Bun versions | Local `bun --version` 1.3.2; latest 1.3.x is 1.3.14; latest overall 1.4.2 (2026-09-05) | confirmed | `gh api repos/oven-sh/bun/releases` |
| Base image | `oven/bun:1.3.2-alpine@sha256:adda30fd...` is alpine 3.22.2 with 1 CRITICAL and 10 HIGH OS CVE IDs (libcrypto3/libssl3, musl, zlib). Runtime apk pins in `apps/api/Dockerfile` match the highest fixed version of each. The built image was not scanned | base scan observed; built image unknown | `trivy image` 0.74.0 on the local base image |
| `bun audit` | `--audit-level=high` exit 0. Full audit: 4 moderate, `hono <4.13.5` (GHSA-gqvv-2mrq-wpjv, GHSA-g6gw-c38x-mqfc, GHSA-crvj-82cr-hjcx) and `nodemailer <10.0.2` (GHSA-6vj9-mwq6-2f5v) | observed | `bun audit` |
| ESLint 9 | v9.0.0-v9.39.5 EOL since 2026-08-06; v10 is Current | confirmed | https://eslint.org/version-support/ |
| Plugin peers | `typescript-eslint@8.69.0` peers `eslint ^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0` and `typescript >=4.8.4 <6.1.0`; `eslint-plugin-react-hooks@7.1.1` accepts `^10.0.0` | confirmed | `npm view` |
| Compose | Configured and running (`nw-dev-*` stacks): `postgres:17.11-alpine`, `redis:7.4.7-alpine`, `axllent/mailpit:v1.31.1`. Rendered `docker compose config` unknown (needs `NW_SLOT`) | observed | `compose.yaml`, `docker ps` |
| Environments | No cloud environment defined in repo (no IaC; `.env.example` URLs empty) | observed | repo search |
| better-auth 1.7, Playwright 1.62.1, PG18, TypeScript 6/7 details | Not checked at a primary source | unconfirmed | earlier WebSearch summary |
| `oidcProvider` | Not used: `apps/api/src/auth/index.ts` registers only `organization` and `twoFactor` | observed (grep of `apps/`) | source |
| Node in repo | Root `package.json` `engines.node` is `>=22.12.0`; `ci.yml` has no `actions/setup-node` step, so CI uses the runner image's Node; `packages/eslint-config` `test` runs `node --test index.test.js`. Node version on the `ubuntu-24.04` image not checked | observed (read by Technical Lead 2026-09-29) | `package.json`, `.github/workflows/ci.yml`, `packages/eslint-config/package.json` |

## Contracts

- Toolchain: one Bun version across `package.json` `packageManager`, `.github/workflows/ci.yml` `BUN_VERSION` and both `FROM` lines of `apps/api/Dockerfile`, which always use a sha256 digest. Runtime security fixes stay explicit apk pins, with no `apk upgrade`. Root `package.json` `engines.node` requires Node 24 (NODE-8).
- CI: job names, commands and gates in `.github/workflows/ci.yml` stay unchanged. Only action refs, versions, the `runs-on` label (pinned to `ubuntu-24.04` in every job) and service images change.
- Data (NODE-5 and NODE-6 only): schema changes land as new ordered SQL files in `packages/db/migrations/` run by the checksummed runner (DB-11), each with its constraints, RLS policies and grants (DB-12). Runtime role stays non-owner `NOBYPASSRLS` (DB-03). Login and membership tables keep membership-bound protection (DB-06) and minimal grants (DB-07). No `drizzle-kit push`/`migrate` or better-auth CLI migration.
- Authorization and security: the better-auth upgrade keeps `logger: { disabled: true }`, `trustedOrigins`, organization roles and `twoFactor` behavior unchanged. No product behavior changes in any Task.

## Design decisions

- Architecture drivers touched:
  - Security: CVE-2026-24910 (Bun), base image OS CVEs, moderate advisories in `hono` and `nodemailer`, ESLint 9 EOL (no further fixes).
  - Maintainability: actions on a supported runtime, one Bun pin across four places, ESLint and TypeScript on supported lines, `packages/eslint-config` peers widened in step with the toolchain, `engines.node` on 24.
  - Operability: CI keeps passing without deprecation warnings on a pinned runner image; image rebuild and migration runner (`dist-migrate`) keep working; local Compose volumes survive or have a documented path.
- Scope now (user decision 2026-09-29): NODE-1, NODE-2, NODE-3, NODE-8, NODE-10. NODE-1, NODE-2, NODE-3 and NODE-10 rest on confirmed or observed evidence (Node 20 removed and v4 forced to Node 24; CVE-2026-24910; ESLint 9 EOL; observed `bun audit` advisories). NODE-8 is in scope by user decision to move `engines` to Node 24 now.
- CI actions (user decision 2026-09-29): `actions/checkout` v6 and `actions/upload-artifact` v6 (`node24` verified); v7.0.1 is not used. Every job's `runs-on` is pinned to `ubuntu-24.04` so the 2026-10-19 `ubuntu-latest` move to Ubuntu 26 does not change CI.
- Scope-now order: NODE-1, NODE-2, NODE-3, then NODE-8 and NODE-10. NODE-8 follows NODE-1 because NODE-1 pins the runner image that supplies CI's Node (no `setup-node` step). It follows NODE-2 and NODE-3 because both write root `package.json` (`packageManager`, `eslint`) and NODE-3 writes `bun.lock`; NODE-8 edits only `engines` in the same file. NODE-8 and NODE-10 share no file and have the same owner, so they run one after the other in that order.
- Deferred: NODE-4, NODE-5, NODE-6, NODE-7, NODE-9. No confirmed deadline or vulnerability drives them. Each needs its own start authorization.
- Bun ownership: platform-engineer owns all four Bun pins in NODE-2 as one toolchain change, including the `packageManager` line of root `package.json`. software-engineer is the integration owner of root `package.json` and `bun.lock` for every other Task; NODE-2 edits only the `packageManager` line and finishes before NODE-3 starts.
- Risks:
  - v4 actions work today only because the runner forces Node 24; GitHub may stop that at any time (unknown). NODE-1 removes the dependency on it.
  - A newer Bun base image may be on another alpine branch, so the current apk pins may not resolve. NODE-2 re-derives pins from a scan of the new base.
  - ESLint 10 config and rule changes are unverified; lint output may change. NODE-3 fixes only what breaks and records new warnings.
  - `typescript-eslint` 8.69.0 caps TypeScript at `<6.1.0`, so NODE-4 can target 6.0.x only; TypeScript 7 stays blocked.
  - PG18: existing `pgdata` volumes created by PG17 do not start under a new major. A change in the postgres:18 image PGDATA or mount layout is an unverified recollection that NODE-6 must check.
  - `ubuntu-24.04` pin: the label's own support end date is not checked; the pin must be revisited before it ends.
  - Node 24 floor: developers on Node 22 fail the `engines` check after NODE-8. The Node version on the `ubuntu-24.04` image is unverified (see Open decisions).
- Assumptions: none of these upgrades changes product behavior; the test suites in `scripts/quality/README.md` are the regression proof.
- Non-goals: new features, refactors, lowering coverage thresholds, deployment (no cloud environment exists in the repo), upgrading packages marked keep in the review (except `hono` via NODE-10).

## Tasks

Order and ownership:

| Task | Scope | Depends on | Integration owner of shared files |
| --- | --- | --- | --- |
| NODE-1 CI actions to v6 and runner pin | now | None | platform-engineer (`.github/workflows/ci.yml`) |
| NODE-2 Bun 1.3.14 | now | NODE-1 | platform-engineer (`ci.yml`, `apps/api/Dockerfile`, `packageManager` line) |
| NODE-3 ESLint 10 | now | NODE-2 | software-engineer (root `package.json`, `bun.lock`) |
| NODE-8 Node engines 24 | now | NODE-3 | software-engineer (root `package.json` `engines`) |
| NODE-10 hono and nodemailer advisories | now | NODE-3 (runs after NODE-8, same owner) | software-engineer (`apps/api/package.json`, `bun.lock`) |
| NODE-4 TypeScript 6.0 | deferred | NODE-3 | software-engineer |
| NODE-5 better-auth 1.7 | deferred | NODE-4 | software-engineer (`e2e/bun.lock`, `packages/db/migrations/`) |
| NODE-6 PostgreSQL 18 | deferred | NODE-2 | platform-engineer (`compose.yaml`, `ci.yml`) |
| NODE-7 Bun 1.4 | deferred | NODE-2, NODE-6 | platform-engineer |
| NODE-9 Playwright 1.62.1 | deferred | NODE-5 | software-engineer (`e2e/package.json`, `e2e/bun.lock`) |

Tasks sharing a file never run concurrently; each starts after its dependency's owner reports changed files and stops writing.

### NODE-1 CI actions to v6

- **OWNER:** platform-engineer
- **READY:** start authorized (spec approved 2026-09-29; upload-artifact v6 and `ubuntu-24.04` decided)
- **OUTCOME:** every `actions/checkout` ref in `ci.yml` is v6 and every `actions/upload-artifact` ref is v6, both declaring `node24`; every job has `runs-on: ubuntu-24.04`; CI runs with no Node 20 deprecation annotation
- **SOURCE:** Evidence base rows "Node 20 on runners", "Action runtimes" and "ubuntu-latest"; user decision 2026-09-29
- **INVARIANTS:** job names, steps, `permissions: contents: read`, `fetch-depth: 0` on `secrets`, artifact name `coverage-report` and path
- **FILES:** `.github/workflows/ci.yml` (action refs and the `runs-on` line of every job)
- **NON-GOALS:** Bun version, service images, new jobs, `upload-artifact` v7
- **CONTRACTS:** CI contract above
- **VERIFY:** `bun run workflow:test`; `gh api` read of `action.yml` `runs.using` at each new ref; no `ubuntu-latest` left in `ci.yml`
- **PROOF:** PR CI run with all jobs green on `ubuntu-24.04` and no "Node.js 20 is deprecated" annotation; `coverage-report` artifact present
- **ROLLBACK:** revert the ref and `runs-on` changes in `ci.yml` (v4 still runs on forced Node 24 as of 2026-09-29; `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19)
- **COVERS:** none (no Feature Acceptance matrix)

### NODE-2 Bun 1.3.14 across the four pins

- **OWNER:** platform-engineer
- **READY:** NODE-1 merged or its owner stopped writing `ci.yml`; start authorized
- **OUTCOME:** Bun 1.3.14 (outside the CVE-2026-24910 range) in all four places; API image built on the new digest with apk pins that clear HIGH/CRITICAL
- **SOURCE:** Evidence base rows "CVE-2026-24910", "Bun versions", "Base image"; Toolchain contract
- **INVARIANTS:** both `FROM` lines use the same `oven/bun:1.3.14-alpine@sha256:<digest>`; non-root user 1001; no `apk upgrade`; `dist/index.js` and `dist-migrate/migrate.js` still built; `HEALTHCHECK` unchanged
- **FILES:** `package.json` (`packageManager` line only), `.github/workflows/ci.yml` (`BUN_VERSION`), `apps/api/Dockerfile` (lines 12 and 61, apk pin block lines 65-70)
- **NON-GOALS:** Bun 1.4; `@types/bun` (already `~1.3.14`); lockfile regeneration unless `--frozen-lockfile` fails
- **CONTRACTS:** NODE-3 and NODE-7 start from this pin
- **VERIFY:** `bun --version` 1.3.14; `bun install --frozen-lockfile`; `trivy image --severity HIGH,CRITICAL` on the new base to derive pins; `docker build -f apps/api/Dockerfile .`
- **PROOF:** resolved digest and its source; alpine release of the new base; `bun run security:image` exit 0 on the built image; container starts and `/health` answers; PR CI green on 1.3.14
- **ROLLBACK:** restore the four 1.3.2 pins, digest `sha256:adda30fd4db7d8ef9a2113cb935c6f751de3daad39373713b56eefe49db78471` and the current apk pins together
- **COVERS:** none (no Feature Acceptance matrix)

### NODE-3 ESLint 10

- **OWNER:** software-engineer
- **READY:** NODE-2 owner stopped writing root `package.json`; start authorized
- **OUTCOME:** all packages lint with ESLint 10 through `@nightwatch/eslint-config`
- **SOURCE:** Evidence base rows "ESLint 9" and "Plugin peers"
- **INVARIANTS:** rule set and severity unchanged except where ESLint 10 removes or renames a rule (recorded); `typescript-eslint` stays on 8.x; no new lint disables
- **FILES:** `package.json` (`eslint`), `packages/eslint-config/package.json` (`@eslint/js`, peer `eslint`), `packages/eslint-config/index.js` and `index.test.js` if the config API changed, `apps/api/eslint.config.js`, `apps/web/eslint.config.js`, `apps/worker/eslint.config.js` only if they break, `bun.lock`
- **NON-GOALS:** TypeScript peer change (NODE-4), `engines` change (NODE-8), fixing unrelated existing warnings
- **CONTRACTS:** peer `eslint` becomes `^10.0.0`
- **VERIFY:** `bun run lint`; `bun run --cwd packages/eslint-config test`; `bun install --frozen-lockfile` after the lockfile update
- **PROOF:** `bun run validate` green; list of ESLint 10 breaking changes that applied, from the ESLint 10 migration guide (currently unverified), including ESLint 10's Node requirement for NODE-8
- **ROLLBACK:** revert the three manifests, config edits and `bun.lock`
- **COVERS:** none (no Feature Acceptance matrix)

### NODE-8 Node engines 24

- **OWNER:** software-engineer
- **READY:** NODE-1 merged (runner pinned); NODE-3 owner stopped writing root `package.json`; start authorized
- **OUTCOME:** `engines.node` requires Node 24; Node-run scripts pass on Node 24
- **SOURCE:** user decision 2026-09-29; Evidence base row "Node in repo"
- **INVARIANTS:** runtime for the API image stays Bun; `bun.lock` unchanged
- **FILES:** `package.json` (`engines`)
- **NON-GOALS:** switching any runtime from Bun to Node; adding `actions/setup-node` to `ci.yml` (needs a user decision, see Open decisions)
- **CONTRACTS:** Toolchain contract (`engines.node` on 24)
- **VERIFY:** `bun run --cwd packages/eslint-config test` under Node 24; `bun run validate`; `bun install --frozen-lockfile`
- **PROOF:** `bun run validate` green; Node version used in CI on `ubuntu-24.04` named from the PR CI log
- **ROLLBACK:** revert `engines` to `>=22.12.0`
- **COVERS:** none (no Feature Acceptance matrix)

### NODE-10 hono and nodemailer moderate advisories

- **OWNER:** software-engineer
- **READY:** NODE-3 owner stopped writing `bun.lock`; NODE-8 done (same owner); start authorized
- **OUTCOME:** `bun audit` reports no advisory for `hono` or `nodemailer`
- **SOURCE:** Evidence base row "`bun audit`"; user decision 2026-09-29
- **INVARIANTS:** API routes, OpenAPI output and mail sending unchanged; `@hono/zod-openapi` stays compatible
- **FILES:** `apps/api/package.json` (`hono` range `~4.12.0` to a range allowing `>=4.13.5`; `nodemailer` already allows 10.0.2), `bun.lock`
- **NON-GOALS:** other API dependencies
- **CONTRACTS:** `bun run codegen:check` shows no OpenAPI drift
- **VERIFY:** `bun run --cwd apps/api test`; `bun run codegen:check`; `bun audit`
- **PROOF:** full `bun audit` output without the 4 moderate findings; `COVERAGE_GATE=1 bun run test:coverage` green with the integration environment
- **ROLLBACK:** revert `apps/api/package.json` and `bun.lock`
- **COVERS:** none (no Feature Acceptance matrix)

### NODE-4 TypeScript 6.0 (deferred)

- **OWNER:** software-engineer
- **READY:** NODE-3 merged; start authorized; TypeScript 6.0 changes read at the primary source
- **OUTCOME:** repo typechecks and builds on TypeScript 6.0.x
- **SOURCE:** Evidence base row "Plugin peers" (`typescript <6.1.0`)
- **INVARIANTS:** `packages/typescript-config` strictness unchanged; no new `any` or suppressions
- **FILES:** `package.json` (`typescript`), `packages/eslint-config/package.json` (peer `typescript`), `packages/typescript-config/base.json`, `packages/typescript-config/bun.json`, `packages/typescript-config/react.json` only if options were removed, `bun.lock`
- **NON-GOALS:** TypeScript 7 (blocked by `typescript-eslint` peer)
- **CONTRACTS:** peer `typescript` widened to include 6.0.x and stay inside `typescript-eslint`'s range
- **VERIFY:** `bun run typecheck`; `bun run lint`; `bun run codegen:check`
- **PROOF:** `bun run validate` and `bun run build` green
- **ROLLBACK:** revert manifests, tsconfig edits and `bun.lock`
- **COVERS:** none (no Feature Acceptance matrix)

### NODE-5 better-auth 1.7 (deferred)

- **OWNER:** software-engineer (load security-and-hardening: touches authentication)
- **READY:** NODE-4 merged; start authorized; better-auth 1.7 changelog and schema diff read at the primary source (currently unconfirmed)
- **OUTCOME:** api, web and e2e run better-auth 1.7 with sign-in, organization, invitation and `twoFactor` behavior unchanged
- **SOURCE:** Data and Authorization contracts; DB-03, DB-06, DB-07, DB-11, DB-12
- **INVARIANTS:** one better-auth version in all three manifests; `logger: { disabled: true }`; `trustedOrigins`; organization access control in `apps/api/src/auth/permissions.ts`; member race handling in `apps/api/src/auth/member-race.ts`; no applied migration edited
- **FILES:** `apps/api/package.json`, `apps/web/package.json`, `e2e/package.json`, `bun.lock`, `e2e/bun.lock`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/auth-origin-intents.ts`, `apps/web/src/lib/auth-client.ts`, `packages/db/src/schema.ts` (auth tables `user` to `twoFactor`) if columns change, new `packages/db/migrations/0016_<slug>.sql` if the schema changes
- **NON-GOALS:** new auth plugins or flows; `oidcProvider` (not used)
- **CONTRACTS:** any new or altered auth column ships in `0016_<slug>.sql` with its grants to the runtime role and no organization RLS on login tables
- **VERIFY:** `bun run --cwd apps/api test`; `bun run test:integration` against this worktree's Compose database; `bun run codegen:check`
- **PROOF:** migration applies on a fresh cluster (DB-13) and on a database migrated to `0015`; `auth.db.test.ts` and `seed.db.test.ts` pass as the runtime role; privilege-denial case still fails for the runtime role; `bun run e2e` sign-in, invitation and MFA pass; `bun run security` green
- **ROLLBACK:** revert manifests, lockfiles and code; a shipped `0016` is never edited or dropped in place, so rollback after it lands needs a new forward migration (plan it before merge)
- **COVERS:** none (no Feature Acceptance matrix)

### NODE-6 PostgreSQL 18 (deferred)

- **OWNER:** platform-engineer (DB/RLS test run by software-engineer as a sibling check)
- **READY:** NODE-2 merged; start authorized; postgres:18 image volume/PGDATA layout checked at the primary source
- **OUTCOME:** Compose and CI run `postgres:18.x-alpine`; all migrations and RLS tests pass on it
- **SOURCE:** Data contract; DB-01, DB-03, DB-04, DB-10, DB-13
- **INVARIANTS:** owner and runtime roles from `scripts/db/init/001-roles.sh`; loopback-only ports; one NightWatch database per cluster; other worktrees' volumes untouched
- **FILES:** `compose.yaml`, `.github/workflows/ci.yml` (service image and the two `docker run postgres:` role steps), `scripts/quality/README.md` for the local volume upgrade note
- **NON-GOALS:** production data migration (no cloud environment defined in repo); Redis upgrade
- **CONTRACTS:** CI and Compose use the same Postgres tag
- **VERIFY:** `bun run db:up` on a fresh project volume; `bun run db:migrate`; `bun run test:integration`
- **PROOF:** clean migration `0001`-`0015` on a fresh PG18 cluster including `0008_notification_function_owners.sql`; RLS isolation and runtime-role denial tests pass; `COVERAGE_GATE=1 bun run test:coverage` green in CI; documented path for existing PG17 `pgdata` volumes (dump/restore or new volume)
- **ROLLBACK:** revert image tags; local PG18 volumes are not readable by 17, so keep the PG17 volume until rollback is no longer needed
- **COVERS:** none (no Feature Acceptance matrix)

### NODE-7 Bun 1.4 (deferred)

- **OWNER:** platform-engineer
- **READY:** NODE-2 and NODE-6 merged; Bun 1.4 breaking changes read at the primary source
- **OUTCOME:** four pins on a Bun 1.4.x release with a digest-pinned base and re-derived apk pins
- **SOURCE:** Evidence base row "Bun versions" (1.4.2 released 2026-09-05)
- **INVARIANTS:** same as NODE-2
- **FILES:** as NODE-2, plus `package.json` `@types/bun` and `bun.lock` via software-engineer if the lockfile format changes
- **NON-GOALS:** adopting new Bun APIs
- **CONTRACTS:** Toolchain contract
- **VERIFY:** as NODE-2 plus `bun run test`
- **PROOF:** as NODE-2 plus `bun run validate`, `bun run build`, `COVERAGE_GATE=1 bun run test:coverage` and `bun run e2e` green
- **ROLLBACK:** restore NODE-2 pins, digest and apk pins
- **COVERS:** none (no Feature Acceptance matrix)

### NODE-9 Playwright 1.62.1 (deferred)

- **OWNER:** software-engineer
- **READY:** NODE-5 merged; Playwright 1.62.1 release notes read (unconfirmed)
- **OUTCOME:** E2E suite passes on Playwright 1.62.1
- **SOURCE:** tech stack review (unconfirmed)
- **INVARIANTS:** tests in `e2e/tests` and `e2e/playwright.config.ts` server startup unchanged
- **FILES:** `e2e/package.json`, `e2e/bun.lock`
- **NON-GOALS:** new E2E tests
- **CONTRACTS:** none
- **VERIFY:** `bun run e2e:setup`; `bun run e2e` against this worktree's Compose stack
- **PROOF:** `bun run e2e` green locally and in the dispatch-only `full` job
- **ROLLBACK:** revert `e2e/package.json` and `e2e/bun.lock`
- **COVERS:** none (no Feature Acceptance matrix)

## Integrated verification

- Exit criteria per Task are their VERIFY and PROOF; there is no Acceptance matrix, so no AC is covered here.
- After all scope-now writers (NODE-1, NODE-2, NODE-3, NODE-8, NODE-10) stop, run once on `ubuntu-24.04` CI and locally on Node 24: `bun run validate`, `COVERAGE_GATE=1 bun run test:coverage`, `bun run build`, `bun run security` (see `scripts/quality/README.md`), then code-reviewer final review of the combined diff.
- `bun run security:image` and `bun run e2e` belong to the NODE-2 and NODE-5/NODE-9 PROOF and to the dispatch-only `full` job.

## Open decisions

| Decision | Owner |
| --- | --- |
| Check whether CVE-2026-24910 is exploitable here (trustedDependencies, non-npm deps); affects urgency only, NODE-2 still fixes it | Technical Lead |
| Start timing for deferred NODE-4, NODE-5, NODE-6, NODE-7, NODE-9, each needing its own authorization | User |
| PG17 local volume path for NODE-6 (dump/restore or fresh volume) | User |
| Start authorization and `COMMIT_MODE` for scope-now NODE-1, NODE-2, NODE-3, NODE-8, NODE-10 | User |
| Unverified: Node version on the `ubuntu-24.04` runner image. If it is below 24, decide whether NODE-8 adds `actions/setup-node` with Node 24 to `ci.yml` (a new `ci.yml` change) | Technical Lead to check; User decides any `ci.yml` addition |

## Revisions

| Date | Change | Approved by user | `acceptanceVersion` |
| --- | --- | --- | --- |
| 2026-09-29 | Initial draft | Not yet | None |
| 2026-09-29 | Recorded user decisions: platform chore with no Feature, Epic or Acceptance matrix; scope-now NODE-1, NODE-2, NODE-3, NODE-8, NODE-10 (NODE-10 confirmed, NODE-8 moved from deferred); `checkout` and `upload-artifact` v6 with `runs-on: ubuntu-24.04` in every job; `engines.node` on 24 now, ordered after NODE-3. Closed the matching open decisions and added the unverified runner Node check. Status set to Approved; Start authorization stays None | 2026-09-29 | n/a (no Feature matrix) |
