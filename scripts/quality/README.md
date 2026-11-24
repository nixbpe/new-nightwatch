# Quality gates

Root-level notes for the platform quality scripts. Scripts themselves live in
the root `package.json`; this file records where policies live and how the
scripts are meant to evolve.

## Check routing

Use these links to find the relevant sections before reading command recipes. This routing does not reduce required gates, coverage thresholds or evidence obligations. Combine rows when a change crosses boundaries; follow linked prerequisites before execution.

- Verification reports and agent files: [Agent workflow integrity](#agent-workflow-integrity), [Test changes and execution stages](#test-changes-and-execution-stages), and [Platform- and runtime-dependent skips](#platform--and-runtime-dependent-skips).
- Tests: [Test ownership and retained proof](#test-ownership-and-retained-proof), [Coverage policy](#coverage-policy), and [Test changes and execution stages](#test-changes-and-execution-stages); for Web assertions also read [UI logic tests](#ui-logic-tests).
- Database, RLS or queued work: [Local development dependencies](#local-development-dependencies-postgresql--mailpit--redis), [Integration tests](#integration-tests-real-database), and [CI database-backed checks](#ci-database-backed-checks). For monitor configuration or partition maintenance, add [Monitor environment and partitions](#monitor-environment-and-partitions).
- API routes, schemas or Web operation types: [OpenAPI client drift](#openapi-client-drift).
- Browser flows and E2E isolation: [Playwright E2E](#playwright-e2e) and [Local development dependencies](#local-development-dependencies-postgresql--mailpit--redis).
- Runtime images or entrypoints: [Container runtime verification](#container-runtime-verification).
- Dependency or lockfile changes: [Dependency lifecycle scripts](#dependency-lifecycle-scripts).

## Agent workflow integrity

```sh
bun run workflow:test
```

- [Workflow tests](./) cover quality tooling, E2E runners and the Worker launcher.

## ESLint configuration tests

```sh
bun run --cwd packages/eslint-config test
```

[Source and tests](../../packages/eslint-config/) own import-policy coverage.
Virtual snippets do not replace `bun run lint` against real TypeScript projects.

## Local development dependencies (PostgreSQL + Mailpit + Redis)

Use this worktree's Docker Compose services, never an ambient or production
database. Start services before `bun run dev`:

```sh
bun run db:up
bun run db:migrate
bun run db:partitions
bun run db:logs
bun run db:psql # owner role, DDL/migrations only
bun run db:mail
bun run db:down # preserves pgdata; -- -v explicitly deletes it
```

[Environment resolver](../dev-env.mjs), [port allocation](../ports.mjs) and
[database commands](../db.mjs) own generated credentials, ports and service
configuration. Exported shell variables override generated values; inspect
overrides before running checks. Never commit `.env.compose.local`.

- `DATABASE_URL` uses the unprivileged runtime role; `DATABASE_OWNER_URL`
  is for migrations, provisioning and fixture setup. Never substitute owner
  access for runtime assertions. [Role bootstrap](../db/init/001-roles.sh)
  owns role creation.
- `db:down` affects only this worktree's Compose project. Do not remove
  another worktree's containers or volumes.
- [Provisioning wrapper](../provision.mjs) creates the first Organization
  through an owner invitation. [Demo seed](../seed.mjs) is local Compose only;
  run migrations first and never reuse demo credentials elsewhere.
- Production requires configured SMTP; Mailpit is a local test service.
- Fresh migration replay requires a fresh PostgreSQL cluster because migrations
  create cluster-global roles. Local E2E schema snapshots do not prove clean
  replay. See [DB-13](../../docs/architecture.md#database-and-isolation).

## UI logic tests

Web component tests and Playwright specs locate application components with
stable `data-testid` hooks named for domain fields, actions and states. Scope
repeated controls by their entity container or public entity ID. Never include
secrets, translated labels, CSS classes or ordinal positions in identifiers.
Keep helpers flat and reuse existing hooks.

Assert domain data, literal request payloads, persisted values, routing,
validation, admission, pending and disabled states, keyboard behavior and focus.
Fixed UI prose, classes, styles, colors, typography, layout and snapshots must
not determine functional results. Replacing a selector must preserve its
business assertion. Role queries without exact copy may assert accessibility
semantics. Browser-native operations, document preferences and intrinsic
label/error relationships remain valid when explicitly classified.

## Coverage policy

[API configuration](../../apps/api/vitest.config.ts) and
[Web configuration](../../apps/web/vitest.config.ts) own thresholds. Do not
duplicate or lower them to pass a gate.

Coverage is always measured. Threshold enforcement requires `COVERAGE_GATE=1`,
which CI enables; removing that gate requires an explicit release decision.
Root coverage runs packages serially because DB suites share PostgreSQL.
Command wiring belongs to [package.json](../../package.json) and
[CI](../../.github/workflows/ci.yml).

## Integration tests (real database)

- `bun run test`: unit tests, no database required.
- `bun run test:integration`: real-database suites. Service-backed suites
  require both runtime and owner URLs and refuse missing configuration.
- `bun run test:coverage`: includes integration tests and needs their environment.
- Canonical migration and Worker fixtures use
  [database test support](../../packages/db/tests/support/postgres.ts), which
  provisions and cleans up fresh Docker clusters independently of supplied URLs.

Use this wrapper for local commands that touch PostgreSQL or Redis. Replace
the trailing command for focused integration, coverage or Bun-runtime checks:

```sh
(
  set -e
  bun run db:up
  trap 'bun run db:down' EXIT
  bun -e '
    const { resolveDevEnv } = await import("./scripts/dev-env.mjs");
    const { env } = resolveDevEnv();
    const child = Bun.spawn(process.argv.slice(1), {
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exit(await child.exited);
  ' -- bun run test:integration
)
```

Package commands own worker limits. Root integration execution lets sibling
suites finish teardown after a failure and still returns failure. Performance
comparisons must pass `--force` to avoid cached database results.

### Monitor RLS coverage

The database integration suites replace `e2e/verification/rls-check.ts`:

| Check                                                                                          | Retained source                                                                  |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Enabled/forced RLS, restrictive guards, function owners, fixed search paths and EXECUTE grants | [`monitor catalog invariants`](../../packages/db/tests/monitor.db.test.ts)       |
| Populated A/B isolation, absent context, cross-tenant reads/writes and Project foreign keys    | [`monitor tenant isolation`](../../packages/db/tests/monitor.db.test.ts)         |
| The connected runtime role is neither superuser nor BYPASSRLS                                  | [`hostname migration`](../../packages/db/tests/notification-hostname.db.test.ts) |
| Monitor creation through API routes with real PostgreSQL                                       | [`monitor writes`](../../apps/api/src/monitors/write.db.test.ts)                 |

Run the DB package's `test:integration` plus the API integration project with
`src/monitors/write.db.test.ts`, using the isolated environment above. The remaining
manual harnesses retain stack-level outage, restart, SSRF and secret/log checks.

## CI database-backed checks

[CI workflow](../../.github/workflows/ci.yml) owns service setup, environment
and job commands. Reuse its role bootstrap for service-backed checks; never
promote disposable CI credentials to another environment.

Fresh-cluster fixtures remain necessary for clean migration replay. See
[local dependency constraints](#local-development-dependencies-postgresql--mailpit--redis).

## Monitor environment and partitions

The [uptime monitor runbook](../../docs/runbooks/uptime-monitor.md) owns
environment setup, credential rotation, Worker operation and partition maintenance.
[Environment validation](../../packages/shared/src/env.ts) owns accepted values
and defaults.

- Run `bun run db:partitions` after migrations on every deployment and at least
  monthly, using the owner URL. Missing audit partitions can block audited writes.
- Never set `OUTBOUND_TEST_ALLOWED_HOSTS` in production. For local E2E, use
  a loopback-resolving test hostname; the runner's public-DNS default requires
  internet and can be overridden with a hostname mapped in `/etc/hosts`.
- API and Worker must share the E2E monitor environment and Redis namespace.
  See [Playwright E2E](#playwright-e2e).
- Node tests do not replace Bun-runtime checks; see
  [runtime-dependent skips](#platform--and-runtime-dependent-skips).

## OpenAPI client drift

```sh
bun run --cwd apps/web codegen
bun run codegen:check
```

API route or schema changes require regeneration and committing
[generated types](../../apps/web/src/lib/api/openapi-types.gen.ts). Never edit
or format that output directly. Generation needs no running API, database or SMTP.

The [generator](../../apps/web/scripts/codegen-openapi.mjs) owns the pipeline.
Drift checks compare bytes, not semantic correctness; preserve the separate
contract proofs described in [Test ownership and retained proof](#test-ownership-and-retained-proof).
Architecture requirements remain WEB-01 and WEB-02.

## Playwright E2E

```sh
bun install --cwd e2e --frozen-lockfile
(cd e2e && bun x playwright install chromium)
bun run db:up
bun run db:migrate
bun run e2e
bun run --cwd e2e test tests/monitors-states.spec.ts
```

The [runner](../e2e.mjs) and [database helper](../e2e-database.mjs) own bootstrap
and provisioning. Local runs reuse this worktree's services with a separate
database, Redis prefix and generated credentials. The dev migration ledger must
match the repository. No application data or cluster roles are copied or changed;
schema-snapshot bootstrap does not prove clean migration replay.

Cleanup removes only the run's database and prefixed Redis keys, never dev
containers or unprefixed keys. SIGKILL cannot run cleanup. Keep namespace
isolation intact; longer timeouts do not fix jobs consumed by the wrong Worker.

Every run needs Docker: Playwright starts the fakecloud STS/IAM emulator
(`ghcr.io/faiscadev/fakecloud@sha256:9be41fb9274d792dcd1de6914177021edb5d5fea168ceceb28793543ffeede2a`,
the image from `packages/shared/tests/sts-fakecloud.integration.sh`) on
`127.0.0.1:${FAKECLOUD_PORT}` (default 4600 + worktree slot) as container
`nw-e2e-fakecloud-<port>`, removing a leftover container of that name first.
The API under test boots from the test-only entry
[`src/testing/e2e-server.ts`](../../apps/api/src/testing/e2e-server.ts), which
injects the fakecloud STS verifier into the production bootstrap; the production
entry cannot reach it. Two runs in one worktree need different `FAKECLOUD_PORT`
values.

Verify isolation against running local services:

```sh
bun test scripts/verification/e2e-isolation.test.mjs
```

With `CI` or `E2E_EXTERNAL_SERVICES=1`, the caller owns service setup,
migrations, fixtures and cleanup. Use dedicated services without a competing
dev Worker. Settings tests change MFA and passwords; never supply real-user
credentials. Local isolated runs provision their own account. Playwright must
not reuse existing API/Web servers or start tests before Worker readiness.

[Monitor fixture helpers](../../e2e/support/monitor-checks.ts) may accelerate
eligibility only in verified test namespaces. Preserve natural first-result,
cadence and Resume pending-window tests. Never use accelerated monitors for
uptime, chart or elapsed-duration assertions; notification dispatch keeps its
normal cadence.

The test-only API entry supplies a deterministic DNS failure for
`dns-not-found.nw-e2e.invalid` through the outbound resolver dependency. The
monitor form case exercises the real API, executor classification and UI with
that synthetic low-level failure; it does not prove external DNS availability
or OS NXDOMAIN timing. Other hostnames retain the real resolver.

E2E supplements unit and integration tests. Execution stages are listed
[below](#test-changes-and-execution-stages).

Security commands live in [package.json](../../package.json):
`bun run security` checks dependencies, secrets and source;
`bun run security:image` builds and scans API/Worker images.
Scanner errors must fail the check, never count as a pass.

## Container runtime verification

For runtime base-image or entrypoint changes, run the real-image checks in
[Distroless runtime verification](../verification/distroless-runtime.md).
The manual suite uses its own PostgreSQL, Redis, SMTP, and TLS fixtures, checks
both Worker build flavors, and removes only its own resources. It does not build
or pull images and is separate from the Trivy image scan. Launcher subprocess
regressions run automatically through `workflow:test`.

## Test changes and execution stages

### Test ownership and retained proof

Test the NightWatch contract at the smallest layer that can prove it. Use unit
tests for pure logic, integration tests for boundaries, and E2E for critical
user flows. Use real implementations when their configuration or integration is
the subject; mock slow or non-deterministic external boundaries.

- Keep proof of our policies, dependency configuration, adapters, protocol
  compatibility and regression workarounds. Leave general dependency algorithms
  and option combinations we do not use to upstream tests. Using a library does
  not make a test redundant.
- Assert observable results against independently chosen expectations. Avoid
  vendor diagnostic wording, automatic tick sequences and private structures
  unless they are an owned public contract or an explicit compatibility guard.
  Prefer a guard that checks the resulting NightWatch behavior.
- Before deleting a case, cite the retained file, case and assertions for the
  same obligation. Compare inputs, identity and role, runtime, side effects,
  failure modes and asynchronous ordering. A flow executing the code, a passing
  E2E, or unchanged coverage alone does not establish equivalent proof. Transfer
  unique assertions before deleting their source case; retain distinct security,
  rollback, race and cancellation obligations.
- Runtime schema validation, serialized OpenAPI and generated client types are
  separate boundaries. Check the actual export or generated type when that is
  the contract. A codegen drift check establishes byte equality with committed
  output, not semantic correctness. Preserve type compatibility through compiler
  assertions, not a runtime equality check between aliases of the same object.

Review additions and deletions as coherent behavior batches. Count fixtures,
helpers, data and replacement assertions when judging simplification. Upstream
examples and testing articles inform test selection; they do not prove that a
NightWatch obligation is covered.

For each added or deleted test, answer these questions in the PR Evidence section:

1. Which requirement does the test assert, and what independently chosen result proves it?
2. Which distinct boundary or scenario does it cover beyond retained tests?
3. Which meaningful fault makes it fail, or what before/after evidence supports deleting it?

There is no test-count target or repository-wide automatic test generation.
Existing coverage thresholds remain unchanged. These rules follow the narrow
research findings about [generated regression oracles](https://arxiv.org/abs/2610.11835),
[reference passes versus fault discrimination](https://arxiv.org/abs/2610.13065),
and [reduction with retained fault identities](https://arxiv.org/abs/2610.14808).
[Reviewed agent test PRs](https://www.atlassian.com/blog/development/using-agentic-pipelines-to-turn-test-coverage-into-daily-habit)
do not establish defect reduction from coverage gains alone.

| Stage       | Execution                                                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Local `bun run test` runs app/package unit suites. Local `workflow:test`, root `validate`, and CI `lint` run the quality-script unit suites, including launcher tests. CI `test` runs app/package coverage. |
| Integration | Local `test:integration` needs explicit isolated service URLs. CI `test` runs database-backed projects through `test:coverage` with disposable services.                                                    |
| Real image  | The manual distroless suite checks built images. Dispatch-only CI `full` runs browser E2E and `security:image` build/Trivy checks, not that runtime proof.                                                  |
| Nightly     | No scheduled nightly workflow exists. Manual runtime proof and dispatch-only workloads remain `not run` until executed.                                                                                     |

## Dependency lifecycle scripts

No dependency lifecycle hook is authorized. Keep fail-closed install policy in
[root bunfig](../../bunfig.toml) and [E2E bunfig](../../e2e/bunfig.toml).
An empty `trustedDependencies` list alone did not block hooks during Bun 1.4.3
verification; do not substitute it for `install.ignoreScripts = true`.

After lockfile changes, inventory `preinstall`, `install` and `postinstall`
in resolved packages and verify a fresh frozen install with verbose logs.
Registry tarball `prepare` scripts do not execute for consumers. Exceptions
require a separately reviewed policy change naming package, hook, reason and
review date.

## Platform- and runtime-dependent skips

A skip is never a pass. A gate report names every skipped test, the condition,
the reason and where the same behavior executes. Use three results: `passed`
(observed in a log), `skipped` (reason plus the command or CI job that executes
the test) and `not run` (the command or job did not execute; name the policy,
environment or blocker).

| Test or job                                                                                                                                                                                                                  | Skip condition                                                                   | Reason                                                                        | Executes in                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `on a real Bun listener` in `apps/api/src/monitors/test-route.db.test.ts`: `returns the timeout result of a Test that waits past Bun's 10 s default` and `aborts the outbound request when the client closes its connection` | `describe.runIf(typeof Bun !== "undefined")`; vitest on Node reports `2 skipped` | Bun's idle HTTP timeout is observable only on a real `Bun.serve` listener     | CI job `unit tests + coverage (api)` step `Tests on Bun` (`bun run --cwd apps/api test:bun`). Locally through the integration environment wrapper                                                                                                                                                                                                                                       |
| CI job `release-stage (e2e + container)`                                                                                                                                                                                     | `if: github.event_name == 'workflow_dispatch'`                                   | The e2e suite plus container build and trivy scan run only on manual dispatch | On a pull request report the job as `skipped` (by policy) and each workload as `not run` until it executes. `bun run e2e` executes the browser suite locally; `bun run security:image` executes the container build and trivy scan locally (Docker and trivy required). A workload stays `not run` until that local command or the manual `full` job ran, then report its actual result |

Keep two levels apart in a report: the CI job result as GitHub shows it
(`skipped`) and the workload result (`not run`). Never replace one with the
other.

Run local Bun checks through the [integration environment wrapper](#integration-tests-real-database),
using `bun run --cwd apps/api test:bun` as the trailing command.
To list Node-side skips, use
`bun run --cwd apps/api test:integration src/monitors/test-route.db.test.ts --reporter=verbose`.
