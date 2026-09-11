# Spec: code-review-remediation (CRR-01..CRR-13)

## Objective

Prepare a bounded implementation blueprint to remediate the 13 code-review findings before any product feature work:

1. Better Auth invitation raw-SQL/DB error leaks
2. Sessions current-session ambiguity under pending session snapshots
3. Onboarding verification/refetch rejection paths
4. Non-IANA timezone crash path
5. PKG-01/PKG-02 boundary-lint enforcement gap
6. Release-stage credentialed e2e silent skip
7. Unbounded Postgres pool/query/readiness path
8. Non-deterministic API Docker image
9. Verify-email cooldown that does not rerender
10. Mobile AppShell drawer focus/overlay accessibility gap
11. MFA server-side invalid code missing `aria-describedby`
12. Root document language mismatch
13. Denial telemetry on tenant-protection paths records `userId` and `organizationId`

The output is one authoritative remediation spec only; implementation is out of scope in this artifact.

## Tech Stack

- Web: React 19 + Vite + Tailwind in `apps/web`
- API: Hono + Bun in `apps/api`
- Data: PostgreSQL via `pg` + Drizzle + Better Auth in `packages/db` and `apps/api`
- Tooling: TypeScript, Vitest, Testing Library, Playwright, ESLint, Docker
- References: `AGENTS.md`, `docs/architecture.md`, `docs/design-system.md`, `scripts/quality/README.md`, `CAPABILITY-MAP.md`, `agent://WholeCodebaseReviewer`

## Source rules / constraints

- Follow all currently published architecture and design references.
- No product-code implementation happens in this slice.
- No API contract/schema changes.
- No OpenAPI churn unless a contract change is approved (none expected).
- No Redis/application limiting work in this slice (explicit scope exclusion).
- No format/lint/validation/build/test execution in this drafting step.
- Out-of-scope scope remains untouched: `.omp`, planning, production environment, unrelated dead code, optional findings.

## Shared assumptions

- Existing CI and development environment commands from `scripts/quality/README.md` remain the source of truth.
- One dedicated QA account is required for authenticated e2e scenarios.
- Denial logs must always respect redaction (`XC-02`/`ORG-05`) and **must not emit `userId` or `organizationId` on deny**; deny logging should be operationally useful via non-PII request/context correlation fields.
- The shared contracts reported by the Technical Lead are correct and stable for this remediations.
- All fixes preserve current public and API behavior unless explicitly listed.

## Commands and proof matrix

### Baseline commands (for implementation handoff; **not run during spec creation**)

- `bun run validate`
- `bun run lint`
- `bun run typecheck`
- `bun run test` / targeted slices via `bun run --cwd <pkg> vitest run ...`
- `bun run test:coverage`
- `bun run security`
- `bun run security:image`
- `bun run e2e`

### Environment-sensitive verification commands (repo-prescribed wrappers)

- Integration DB smoke (must include setup + teardown):
  ```bash
  (
    set -e
    bun run db:up
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
- E2E/credentialed path (include cleanup):
  ```bash
  (
    set -e
    bun run db:up
    trap 'bun run db:down -- -v' EXIT
    bun -e '
      const { resolveDevEnv } = await import("./scripts/dev-env.mjs");
      const { env: resolvedEnv } = resolveDevEnv();
      const env = { ...resolvedEnv, E2E_REQUIRE_CREDENTIALS: "1" };
      for (const command of [
        ["bun", "run", "db:migrate"],
        ["bun", "run", "--cwd", "apps/api", "provision-e2e-fixture"],
        ["bun", "run", "e2e"],
      ]) {
        const child = Bun.spawn(command, { env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
        const exitCode = await child.exited;
        if (exitCode !== 0) process.exit(exitCode);
      }
    '
  )
  ```
  with non-empty `E2E_EMAIL=<dedicated_email> E2E_PASSWORD=<dedicated_password>` in the environment; the wrapper forces `E2E_REQUIRE_CREDENTIALS=1`.
- CI-aligned production gate:
  - `bun run security:image` (after Dockerfile/package changes)

## Project structure touched (exact implementation handoff)

- CRR-01: `apps/api/src/auth/index.ts`, `apps/api/src/auth/auth.db.test.ts`
- CRR-02: `apps/web/src/pages/settings/SessionsPage.tsx`, `apps/web/src/pages/settings/SessionsPage.test.tsx`
- CRR-03: `apps/web/src/pages/OnboardingPage.tsx`, `apps/web/src/pages/OnboardingPage.test.tsx`
- CRR-04: `apps/web/src/lib/preferences.ts`, `apps/web/src/lib/preferences.test.ts`
- CRR-05: `packages/eslint-config/index.js`, `packages/eslint-config/index.test.js`, `packages/eslint-config/package.json`, `apps/api/eslint.config.js`, `apps/web/eslint.config.js`, `packages/api-contract/eslint.config.js`, `packages/db/eslint.config.js`, `packages/shared/eslint.config.js`
- CRR-06: `.github/workflows/ci.yml`, `e2e/tests/settings.spec.ts`, `apps/api/package.json`, `apps/api/vitest.config.ts`, `apps/api/src/operator/provision-e2e-fixture.ts`, `apps/api/src/operator/provision-e2e-fixture.db.test.ts`
- CRR-07: `packages/db/src/client.ts`, `packages/db/src/index.ts`, `packages/db/tests/client.test.ts`, `apps/api/src/app.ts`, `apps/api/src/app.integration.test.ts`
- CRR-08: `apps/api/Dockerfile`
- CRR-09: `apps/web/src/pages/VerifyEmailPage.tsx`, `apps/web/src/pages/VerifyEmailPage.test.tsx`
- CRR-10: `apps/web/src/components/shell/AppShell.tsx`, `apps/web/src/components/shell/AppShell.test.tsx`
- CRR-11: `apps/web/src/pages/settings/MfaCard.tsx`, `apps/web/src/pages/settings/MfaCard.test.tsx`
- CRR-12: `apps/web/index.html`, `e2e/tests/auth-entry.spec.ts`
- CRR-13: `apps/api/src/me/service.ts`, `apps/api/src/me/routes.test.ts`

## Boundaries

### Always

- Remediation changes keep all existing acceptance criteria from module specs intact.
- Preserve user-facing copy language and current route contracts unless explicitly called out.
- Keep logging redaction rules from `XC-02`/`ORG-05` in place; no secret payloads in logs.

### Ask-first

- Any additional infrastructure dependency, script, or helper not currently used in the touched scope.
- Any change that expands contract scope beyond the listed 13 findings.

### Never

- API/schema/OpenAPI churn in this slice.
- Redis/application rate-limiting implementation (explicitly excluded by parent scope).
- UI behavior changes unrelated to the listed findings.

## Dependency/build ordering

1. `packages/eslint-config` (CRR-05) first to establish enforcement baseline.
2. API safety slice (`CRR-01`, `CRR-07`, `CRR-13`, `CRR-08`) together with `apps/api/src/app.ts` health behavior.
3. Web session/onboarding/date/drawers/accessibility slice (`CRR-02`, `CRR-03`, `CRR-04`, `CRR-09`, `CRR-10`, `CRR-11`, `CRR-12`).
4. CI/e2e/infrastructure slice (`CRR-06`, `CRR-08`) last, because acceptance criteria depend on all prior behavior slices.

## Parallel work-package table (disjoint handoff map)

| CRR    | Owned production/config files                                                                                                                                                                                                                    | Owned test files                                                                       | Dependencies                                                              | Contracts                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| CRR-01 | `apps/api/src/auth/index.ts`                                                                                                                                                                                                                     | `apps/api/src/auth/auth.db.test.ts`                                                    | Better Auth before hook, invitation repository                            | Lead shared contracts; refusal envelope contract                        |
| CRR-02 | `apps/web/src/pages/settings/SessionsPage.tsx`                                                                                                                                                                                                   | `apps/web/src/pages/settings/SessionsPage.test.tsx`                                    | Session hydration and identity resolution                                 | Session UI contract for current badge/revoke actions                    |
| CRR-03 | `apps/web/src/pages/OnboardingPage.tsx`                                                                                                                                                                                                          | `apps/web/src/pages/OnboardingPage.test.tsx`                                           | Better Auth session refresh contract                                      | Lead shared contracts + invitation/onboarding behavior                  |
| CRR-04 | `apps/web/src/lib/preferences.ts`                                                                                                                                                                                                                | `apps/web/src/lib/preferences.test.ts`                                                 | `Intl.DateTimeFormat` + timezone registry availability                    | Settings/time display contracts                                         |
| CRR-05 | `packages/eslint-config/index.js`, `packages/eslint-config/package.json`, `apps/api/eslint.config.js`, `apps/web/eslint.config.js`, `packages/api-contract/eslint.config.js`, `packages/db/eslint.config.js`, `packages/shared/eslint.config.js` | `packages/eslint-config/index.test.js`                                                 | `docs/architecture.md`, existing ESLint plugins                           | PKG-01/PKG-02 matrix                                                    |
| CRR-06 | `.github/workflows/ci.yml`, `apps/api/package.json`, `apps/api/vitest.config.ts`, `apps/api/src/operator/provision-e2e-fixture.ts`                                                                                                               | `apps/api/src/operator/provision-e2e-fixture.db.test.ts`, `e2e/tests/settings.spec.ts` | Playwright runner, full-job semantics, CRR06-R1 central bounded DB handle | CI contract and credential contract from Lead                           |
| CRR-07 | `packages/db/src/client.ts`, `packages/db/src/index.ts`, `apps/api/src/app.ts`                                                                                                                                                                   | `packages/db/tests/client.test.ts`, `apps/api/src/app.integration.test.ts`             | `pg` pool/query options and readiness probe                               | DB readiness and fail-fast contract                                     |
| CRR-08 | `apps/api/Dockerfile`                                                                                                                                                                                                                            | None (command-based image verification)                                                | Docker base-digest policy, Trivy invocation                               | Supply-chain reproducibility constraints                                |
| CRR-09 | `apps/web/src/pages/VerifyEmailPage.tsx`                                                                                                                                                                                                         | `apps/web/src/pages/VerifyEmailPage.test.tsx`                                          | Cooldown timer state machine / resend contract                            | MFA and verification UX contract                                        |
| CRR-10 | `apps/web/src/components/shell/AppShell.tsx`                                                                                                                                                                                                     | `apps/web/src/components/shell/AppShell.test.tsx`                                      | Focus trap and overlay/keyboard behavior                                  | Accessibility contract, mobile drawer semantics                         |
| CRR-11 | `apps/web/src/pages/settings/MfaCard.tsx`                                                                                                                                                                                                        | `apps/web/src/pages/settings/MfaCard.test.tsx`                                         | alert/prompt accessibility semantics                                      | MFA verification UI contract                                            |
| CRR-12 | `apps/web/index.html`                                                                                                                                                                                                                            | `e2e/tests/auth-entry.spec.ts`                                                         | Locale root semantics                                                     | TH-first documentation and accessibility contract                       |
| CRR-13 | `apps/api/src/me/service.ts`                                                                                                                                                                                                                     | `apps/api/src/me/routes.test.ts`                                                       | request/tenant/user context resolver middleware                           | Deny logging contract (existing identifier emission must be suppressed) |

## Required behavior packages

### CRR-01 — Better Auth raw SQL error leaks invitation bearer IDs

**Failure path:** `apps/api/src/auth/index.ts` delegates invitation gate in `before` hook; non-`AppError` failures can bubble and include raw DB details, potentially including invitation bearer identifiers in serialized Better Auth diagnostics.

**Required fix intent:**

- Preserve current gate intent (pending, unexpired invitation check) but sanitize non-business errors before they exit the public API boundary.
- On the API boundary, continue mapping known `AppError` to user-safe `FORBIDDEN` while ensuring unknown assertion/DB failures are converted to a generic diagnostic shape.
- **Do not serialize raw `error.cause`, SQL payload, stack text, query text, or invite bearer identifiers in response or diagnostic logs.**
- Keep internal debug logs strictly structured with non-PII fields (request correlation identifiers only).

**Acceptance criteria:**

- Raw-SQL failure path never emits DB exception body text or invite bearer IDs in either response or captured Better Auth logs.
- Unknown invitation-gate failures return a generic non-leaky payload (stable error code + user-safe message).
- Client-visible contract for invitation denial remains stable and does not expose internal IDs.
- Existing tests for missing/expired/unknown invitation continue to pass with stable non-leaky behavior.

### CRR-02 — Sessions current-session ambiguity when session atom is pending

**Failure path:** `apps/web/src/pages/settings/SessionsPage.tsx` resolves current token immediately from `authClient.useSession()` and treats unresolved sessions as `null`, causing current-row mismatch and removable controls on current session.

**Required fix intent:**

- Guard current-session classification until `useSession()` is resolved with a non-pending identity.
- While session identity is unknown/pending, render list in a deterministic non-destructive safe mode (no current badge; no current-session-revocation action until session identity confirms).
- Preserve action behavior after `isPending` clears; continue excluding only the real current row.

**Acceptance criteria:**

- No row can be revokable if it is the actual active session.
- During session hydration (`isPending === true`), UI never claims an incorrect current row.
- Existing sessions regressions still validate: current row badge, revoke-one/others behavior and no token exposure.

### CRR-03 — Onboarding verify/refetch spinner can hang on rejection

**Failure path:** `apps/web/src/pages/OnboardingPage.tsx` runs `verifyEmail()` + `refetchSession()` in an async IIFE without `catch`; thrown errors can leave `tokenPhase === "running"` indefinitely.

**Required fix intent:**

- Add explicit `try/catch/finally` around both operations.
- On verify/refetch failure, set `tokenPhase: "failed"`, show retry-safe messaging, and keep an explicit recovery path.
- Keep `setSearchParams` cleanup deterministic even on errors.

**Acceptance criteria:**

- Rejection in verify or refetch does not hang in loading state.
- Error page remains interactive with working recovery action.
- Existing onboarding success path unchanged.

### CRR-04 — Stored non-IANA timezone causes crash via `Intl.DateTimeFormat`

**Failure path:** `apps/web/src/lib/preferences.ts` accepts any non-empty `timeZone` string and `formatDateTime` passes it directly to `Intl.DateTimeFormat`, which throws on invalid zones.

**Required fix intent:**

- Validate `timeZone` as an allowed IANA zone at read/usage boundaries.
- If invalid or unavailable, fall back to safe defaults (same as `defaultPreferences`) and continue rendering.
- Keep storage schema strict where possible, but never throw on malformed runtime value.

**Acceptance criteria:**

- Corrupt localStorage zone value no longer crashes session display rendering.
- `formatDateTime` always returns string; no uncaught `RangeError` path.
- Existing locale/hours behavior continues for valid preferences.

### CRR-05 — PKG-01/PKG-02 enforcement is incomplete

**Failure path:** `packages/eslint-config/index.js` currently limits only two imports for web and does not complete full dependency matrix checks.

**Required fix intent:**

- Implement comprehensive boundary enforcement for PKG-01/PKG-02 according to architecture table in `docs/architecture.md`:
  - `apps/web` allowed runtime imports: `@nightwatch/api-contract` only.
  - `apps/api` allowed runtime imports: `@nightwatch/api-contract`, `@nightwatch/shared`, `@nightwatch/db` (and `@nightwatch/queue` only when feature enables).
  - `packages/*` boundaries similarly enforced and `shared`/`db` no workspace runtime imports.
- Enforce at lint level and keep enforcement active (must not be weakenable per PKG-02).

**Acceptance criteria:**

- A forbidden import from a disallowed package fails lint deterministically.
- Existing CI lint behavior remains effective across workspace apps/packages.

### CRR-06 — Release e2e settings suite can silently skip

**Failure path:** `e2e/tests/settings.spec.ts` unconditionally skips signed-in suite when `E2E_EMAIL/E2E_PASSWORD` absent.

**Required fix intent:**

- Replace skip-only behavior with hard failure when credentialed settings fixture is unavailable.
- Keep public unauthenticated cases always runnable.
- Add workflow-level fixture creation/provisioning path for a dedicated non-production QA account; no shared account usage.
- **CRR06-R1 integration decision:** `apps/api/src/operator/provision-e2e-fixture.ts` obtains its database handle through the central `createDatabase` export from `@nightwatch/db`, inheriting the bounded DB configuration established by CRR-07 rather than constructing a separate pool.

**Acceptance criteria:**

- In `workflow_dispatch` full job, signed-in settings/e2e tests run or fail explicitly with missing credentials/fixture.
- Unauthenticated coverage remains green.
- Signed-in path covers MFA enable/disable and password change/revert.
- Fixture provisioning refuses missing/non-disposable credentials, rejects identity conflicts, and rolls back failed transactions without modifying non-fixture records.
- Coverage keeps `src/operator/provision-e2e-fixture.ts` inside the measured `src/**` scope; thresholds are unchanged.

### CRR-07 — Bounded PostgreSQL acquisition/query/readiness

**Failure path:** `packages/db/src/client.ts` creates pool with defaults; `apps/api/src/app.ts` readiness runs plain `select 1` with unbounded latency.

**Required fix intent:**

- Add explicit bounded pool options in DB client using concrete constants:
  - `DB_POOL_MAX = 10`
  - `DB_POOL_CONNECTION_TIMEOUT_MS = 5000`
  - `DB_QUERY_TIMEOUT_MS = 10000`
- Add bounded query guard to readiness and request paths where relevant with explicit deadline semantics:
  - readiness probe timeout: `DB_READINESS_TIMEOUT_MS = 2000`
- Keep fail-closed for DB exhaustion and return explicit fail status in readiness.

**Acceptance criteria:**

- DB acquisition/query do not wait indefinitely under blackhole/overload conditions.
- `/ready` fails within bounded window (2s) when DB unreachable/hung.
- Existing integration tests and migration assumptions remain unchanged.

### CRR-08 — Non-deterministic API Docker image construction

**Failure path:** `apps/api/Dockerfile` uses mutable tag `oven/bun:1.3.2-alpine` and runs `apk upgrade`, yielding non-reproducible layer content.

**Required fix intent:**

- Pin base image(s) by digest and remove non-deterministic upgrade step unless digest-managed replacement is approved.
- Keep security patch policy explicit through periodic image bumps and rebuild cadence, not mutable runtime upgrade.
- Keep runtime minimality and non-root posture.

**Acceptance criteria:**

- Docker build from same commit + lockfile produces deterministic dependency tree given identical base digests.
- Runtime layer output is reproducible and auditable under CI image scans.

### CRR-09 — Verify-email cooldown does not auto-expire on UI

**Failure path:** `apps/web/src/pages/VerifyEmailPage.tsx` computes `coolingDown = Date.now() < cooldownUntil` but never re-renders at expiry.

**Required fix intent:**

- Track cooldown as state-backed timer/interval and clear on unmount.
- On expiry, transition button state and label from cooldown-disabled to ready state without additional user action.

**Acceptance criteria:**

- After one minute from successful send, resend button becomes re-enabled automatically.
- No manual refresh needed for cooldown expiry.

### CRR-10 — Mobile shell drawer lacks modal accessibility semantics

**Failure path:** `apps/web/src/components/shell/AppShell.tsx` opens a fixed overlay without `role="dialog"`, `aria-modal`, focus trapping, overlay inerting, or deterministic focus-return behavior.

**Required fix intent:**

- Convert mobile drawer layer into an accessible modal interaction:
  - `role="dialog"`, `aria-modal="true"`, labelled context.
  - Focus trap within drawer while open.
  - Inert or equivalent isolation for background content.
  - Restore focus to opener on close.
  - Close behavior on Escape remains deterministic.

**Acceptance criteria:**

- Tab traversal cannot leave drawer controls before close.
- Focus restore is deterministic across open/close.
- Keyboard-only path for close/re-open is stable at `< sm` viewport.

### CRR-11 — MFA server error path lacks `aria-describedby`

**Failure path:** `apps/web/src/pages/settings/MfaCard.tsx` sets `aria-invalid` for server invalid verify code path but `aria-describedby` only for field-level validation errors.

**Required fix intent:**

- Attach a stable ID to server-side verification error text and include it in `aria-describedby` when `error`/`codeInvalid` is true.
- Keep screen-reader semantics aligned for client-side and server-side validation messages.

**Acceptance criteria:**

- On server-side invalid code, input has `aria-invalid="true"` plus matching `aria-describedby` target with alert text.
- Existing successful verification flow remains unchanged.

### CRR-12 — Thai document language mismatch

**Failure path:** `apps/web/index.html` declares `<html lang="en">` while the application UI is Thai-first.

**Required fix intent:**

- Set document language to Thai locale root per implementation contract.

**Acceptance criteria:**

- Rendered root document language is Thai (`lang="th"`).
- Screen-reader language behavior matches Thai text content defaults.

### CRR-13 — Denial telemetry on tenant-protection paths records user/tenant identifiers

**Failure path:** Current denial telemetry sometimes emits `userId` and `organizationId`; denial behavior is currently over-attributed and can leak relational identity context in logs.

**Required fix intent:**

- Standardize denial/audit logging across auth and tenant-protection paths to **omit** user and tenant identifiers by default, while preserving enough request-level context for operations support.
- Keep debug for troubleshooting via non-PII stable metadata (`traceId`, route/method, actor role class, reason code).
- Preserve `ORG-05` style redaction and avoid logging tokens/emails/secrets.

**Acceptance criteria:**

- No deny event includes `userId` or `organizationId` fields (or their aliases).
- Existing deny paths consistently emit non-PII, machine-usable context fields.
- Denial event contract supports support triage without user/tenant identifiers.

## Test and verification targets

### Unit/integration unit targets (planned)

- `apps/api/src/auth/auth.db.test.ts`
  - invitation gate rejection and known/unknown inviter failures.
  - assert no raw SQL string/identifier detail in API test logs on failure.
- `apps/web/src/pages/settings/SessionsPage.test.tsx`
  - pending-session transition + correct current-row gating.
- `apps/web/src/pages/OnboardingPage.test.tsx`
  - verify/refetch rejection cases and no spinner lock.
- `apps/web/src/lib/preferences.test.ts`
  - malformed timezone fallback path.
- `packages/eslint-config/index.test.js`
  - PKG-01/PKG-02 boundary matrix enforcement across all five consumer configs.
- `packages/db/tests/client.test.ts` and `apps/api/src/app.integration.test.ts`
  - bounded pool/query exports and readiness deadline/fail-closed behavior.
- `apps/web/src/pages/VerifyEmailPage.test.tsx`
  - cooldown timer rerender + expiry transition.
- `apps/web/src/pages/settings/MfaCard.test.tsx`
  - `aria-invalid` + `aria-describedby` for server errors.
- `apps/web/src/components/shell/AppShell.test.tsx`
  - modal/drawer accessibility focus behavior on open-close and Escape.
- `apps/api/src/me/routes.test.ts`
  - membership denial path and log payload contract for existing identifier emission suppression.

### End-to-end and readiness targets

- `e2e/tests/settings.spec.ts` signed-in and unauthenticated suites must execute under dedicated credentials provisioned through `apps/api/src/operator/provision-e2e-fixture.ts`.
- `e2e/tests/auth-entry.spec.ts` verifies the Thai root document language.
- API readiness and startup stability smoke via `bun run e2e` + `bun run security:image` + `bun run security`.
- CI path in `.github/workflows/ci.yml` must enforce explicit credentialing and fail when unavailable.

## Risk and rollback notes

- CRR-08 and CRR-07 may affect build/perf baseline and should be applied with canary build checks before rollout.
- CRR-05 may create initial lint churn in legacy imports; treat as intentional gate-hardening and keep exceptions explicit only where contract-approved.
- CRR-06 requires operational fixture management; if unavailable, full job must fail loudly rather than silently skipping.

## Open questions

- Whether drawer focus trapping should use the app’s existing primitive (if introduced later) or manual focus-guard implementation; currently no dependency is introduced in this spec.

## Completion checklist (for implementation handoff)

- [ ] All 13 CRR findings mapped in implementation PRs.
- [ ] No product feature behavior outside CRR scope changed.
- [ ] OpenAPI, API contracts, and generated artifacts unchanged.
- [ ] CI-visible commands and checks for each CRR pass in implementation run.
- [ ] `CRR-01..13` identifiers preserved in final work references.
