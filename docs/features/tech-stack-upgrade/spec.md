# Tech Stack Upgrade Technical Spec

Owner: Technical Lead. The original tech stack review and read-only platform-engineer verification were recorded on 2026-09-29. The user approved NODE-1, NODE-2, NODE-3, NODE-8 and NODE-10 on 2026-09-29. Those tasks were delivered in `d37e760` (PR #48).

| Field | Value |
| --- | --- |
| Feature | None (platform chore; no Feature, Story or Acceptance matrix) |
| Epic | None |
| Status | Approved |
| Approved by user | 2026-09-29 (NODE-1, NODE-2, NODE-3, NODE-8, NODE-10) |
| Delivery | Implemented for NODE-1, NODE-2, NODE-3, NODE-8, NODE-10. |
| Start authorization | None for deferred NODE-4, NODE-5, NODE-6, NODE-7, NODE-9. |
| `COMMIT_MODE` | none for deferred work |
| `STOP_AT` | merge-ready |

The remaining work is `Deferred`. Each task requires separate start authorization. Its VERIFY and PROOF define the exit criteria; there is no `acceptanceVersion`.

The deferred plans retain the 2026-09-29 baseline. Versions, migration numbers and external release claims need rechecking before implementation. No new runtime or security scan is claimed here.

Delivered baseline for deferred dependencies:

| Task | Delivered scope |
| --- | --- |
| NODE-1 | CI action upgrades and the `ubuntu-24.04` runner pin |
| NODE-2 | Bun 1.3.14 across `package.json` `packageManager`, `.github/workflows/ci.yml` `BUN_VERSION` and both `FROM` lines of `apps/api/Dockerfile` |
| NODE-3 | ESLint 10 |
| NODE-8 | Node 24 engines and CI setup |
| NODE-10 | hono and nodemailer advisory updates |

## Evidence base

Historical observations from 2026-09-29 by platform-engineer (read-only, no file changed). These rows describe the pre-upgrade state. "Confirmed" means read at the primary source listed; "unconfirmed" means it comes only from the earlier WebSearch summary.

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

- Toolchain: one Bun version across `package.json` `packageManager`, `.github/workflows/ci.yml` `BUN_VERSION` and both `FROM` lines of `apps/api/Dockerfile`, which always use a sha256 digest. Runtime security fixes stay explicit apk pins, with no `apk upgrade`. Root `package.json` `engines.node` requires Node 24, and CI runs Node 24 through `actions/setup-node` (NODE-8).
- CI: job names, commands and gates in `.github/workflows/ci.yml` stay unchanged. Only action refs, versions, the `runs-on` label (pinned to `ubuntu-24.04` in every job), service images and one `actions/setup-node` step with `node-version: 24` in every job (NODE-8) change.
- Data (NODE-5 and NODE-6 only): schema changes land as new ordered SQL files in `packages/db/migrations/` run by the checksummed runner (DB-11), each with its constraints, RLS policies and grants (DB-12). Runtime role stays non-owner `NOBYPASSRLS` (DB-03). Login and membership tables keep membership-bound protection (DB-06) and minimal grants (DB-07). No `drizzle-kit push`/`migrate` or better-auth CLI migration.
- Authorization and security: the better-auth upgrade keeps `logger: { disabled: true }`, `trustedOrigins`, organization roles and `twoFactor` behavior unchanged. No product behavior changes in any Task.

## Design decisions

- Deferred: NODE-4, NODE-5, NODE-6, NODE-7, NODE-9. No confirmed deadline or vulnerability drove them in the original review. Each needs its own start authorization.
- `typescript-eslint` 8.69.0 caps TypeScript at `<6.1.0`, so NODE-4 targets 6.0.x. TypeScript 7 stays blocked by that peer range.
- Existing PG17 `pgdata` volumes do not start under a new major. NODE-6 must check the postgres:18 image volume and PGDATA layout at the primary source.
- The `ubuntu-24.04` support end date was not checked in the review.
- No task changes product behavior. Regression checks live in `scripts/quality/README.md`.
- Non-goals: new features, refactors, lowering coverage thresholds or deployment.

## Tasks

Order and ownership:

| Task | Scope | Depends on | Integration owner of shared files |
| --- | --- | --- | --- |
| NODE-4 TypeScript 6.0 | deferred | NODE-3 (delivered) | software-engineer |
| NODE-5 better-auth 1.7 | deferred | NODE-4 | software-engineer (`e2e/bun.lock`, `packages/db/migrations/`) |
| NODE-6 PostgreSQL 18 | deferred | NODE-2 (delivered) | platform-engineer (`compose.yaml`, `ci.yml`) |
| NODE-7 Bun 1.4 | deferred | NODE-2 (delivered), NODE-6 | platform-engineer |
| NODE-9 Playwright 1.62.1 | deferred | NODE-5 | software-engineer (`e2e/package.json`, `e2e/bun.lock`) |

Tasks sharing a file never run concurrently; each starts after its dependency's owner reports changed files and stops writing.

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
- **INVARIANTS:** owner and runtime roles from `scripts/db/init/001-roles.sh`; loopback-only ports; one primary NightWatch database per cluster, with local E2E schema-only snapshots permitted by DB-13; other worktrees' volumes untouched
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
- **INVARIANTS:** both `FROM` lines use the same digest-pinned Bun image; non-root user 1001; no `apk upgrade`; `dist/index.js` and `dist-migrate/migrate.js` still built; `HEALTHCHECK` unchanged
- **FILES:** `package.json` (`packageManager`, plus `@types/bun` via software-engineer), `.github/workflows/ci.yml` (`BUN_VERSION`), `apps/api/Dockerfile` (both `FROM` lines and apk pins), `bun.lock` via software-engineer if the lockfile format changes
- **NON-GOALS:** adopting new Bun APIs
- **CONTRACTS:** Toolchain contract
- **VERIFY:** `bun --version` matches the selected release; `bun install --frozen-lockfile`; `trivy image --severity HIGH,CRITICAL` on the new base to derive pins; `docker build -f apps/api/Dockerfile .`; `bun run test`
- **PROOF:** resolved digest and its source; alpine release of the new base; `bun run security:image` exit 0 on the built image; container starts and `/health` answers; PR CI green; `bun run validate`, `bun run build`, `COVERAGE_GATE=1 bun run test:coverage` and `bun run e2e` green
- **ROLLBACK:** restore the delivered NODE-2 Bun 1.3.14 pins, digest and apk pins together
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
- Deferred work runs `bun run validate`, `COVERAGE_GATE=1 bun run test:coverage`, `bun run build` and `bun run security` on the changed candidate under the current quality gates in `scripts/quality/README.md`.
- Image and E2E checks remain required where named in the deferred task's PROOF.

## Open decisions

| Decision | Owner |
| --- | --- |
| Start timing for deferred NODE-4, NODE-5, NODE-6, NODE-7, NODE-9, each needing its own authorization | User |
| PG17 local volume path for NODE-6 (dump/restore or fresh volume) | User |
| Closed 2026-09-29: the `ubuntu-24.04` image ships Node 22.23.2; user decided NODE-8 adds `actions/setup-node` with Node 24 to every `ci.yml` job | User (decided) |

## Revisions

| Date | Change | Approved by user | `acceptanceVersion` |
| --- | --- | --- | --- |
| 2026-09-29 | Initial draft | Not yet | None |
| 2026-09-29 | Recorded user decisions: platform chore with no Feature, Epic or Acceptance matrix; scope-now NODE-1, NODE-2, NODE-3, NODE-8, NODE-10 (NODE-10 confirmed, NODE-8 moved from deferred); `checkout` and `upload-artifact` v6 with `runs-on: ubuntu-24.04` in every job; `engines.node` on 24 now, ordered after NODE-3. Closed the matching open decisions and added the unverified runner Node check. Status set to Approved; Start authorization stays None | 2026-09-29 | n/a (no Feature matrix) |
| 2026-09-29 | Add `actions/setup-node` Node 24 to `ci.yml` because `ubuntu-24.04` ships Node 22.23.2 per actions/runner-images `Ubuntu2404-Readme.md` image 20260920.314.1. Updated Toolchain and CI contracts, NODE-8, the scope-now order note, the Node 24 risk, Integrated verification and the matching open decision | Yes | n/a (no Feature matrix) |
