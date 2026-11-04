# Test performance measurement

The host measurement wrapper uses Node and `ps` on macOS and Linux. It does not change the test stack or start Docker services.

```sh
mkdir -p /tmp/nightwatch-performance
node scripts/quality/measure-command.mjs \
  --output-dir /tmp/nightwatch-performance -- node -e 'console.log("sample")'
bun test scripts/quality/measure-command.test.mjs
```

`--output-dir` must name an existing directory outside the repository, including after symlink resolution. Every invocation creates a fresh `measurement-*` directory and prints its path. Each directory contains `measurement.json`, `stdout.log`, and `stderr.log`. Command arguments after `--` are passed directly, without shell expansion. Run shell syntax through an explicit shell command.

`MeasurementRun` records the command argument array, ISO `startedAt`, elapsed `durationMs`, `exitCode`, `signal`, `sampleCount`, `peakProcessTreeRssBytes`, `sampledCpuSeconds`, and `measurementScope`. Elapsed time ends when the command exits. Resource metrics are `null` when no process was observed or sampling failed. `sampleCount` counts snapshots that contained the command PID.

The wrapper returns the command's exit code. For signal termination, it records the signal and returns the shell-compatible status `128 + signal number` after writing artifacts. A missing executable returns 127. Other spawn failures return 126. Invalid arguments or artifact setup failures return 2. SIGINT, SIGTERM, and SIGHUP are forwarded to the command's process group. There is no command timeout. The caller controls cancellation. SIGKILL cannot write artifacts.

Samples run sequentially, with a 100 ms gap after each `ps` call. Each snapshot follows PID and PPID links from the command PID. The wrapper, its sampler, and unrelated processes are excluded. RSS is the peak simultaneous sum across the observed process tree, in bytes. Shared pages count once per process. This is sampled RSS, not an operating-system maximum or the largest child's maximum RSS.

CPU seconds sum the greatest observed cumulative CPU time for each PID. Linux `ps` can report whole seconds. Short-lived processes, activity between samples, exits before the next sample, and reparented descendants can be missed. PID reuse can distort totals. Measurements stop when the command exits, even if descendants remain. The sampling cost affects elapsed time.

Docker container memory and CPU are excluded. Measure containers separately. A host-side Docker client remains part of the command tree.

The wrapper does not record environment variables. Command arguments and child stdout/stderr are stored without redaction. Keep secrets out of command arguments and command output. Artifact files use mode 0600 inside a private run directory.

## Suite commands

E2E resolves this worktree's environment and creates its own database and Redis namespace.

```sh
node scripts/quality/measure-command.mjs \
  --output-dir /tmp/nightwatch-performance -- \
  bun run e2e --workers=2 --reporter=json
```

Integration requires both generated worktree database URLs. `--force` prevents Turbo cache hits from replacing execution.

```sh
node scripts/quality/measure-command.mjs \
  --output-dir /tmp/nightwatch-performance -- bun -e '
    const { resolveDevEnv } = await import("./scripts/dev-env.mjs");
    const { env } = resolveDevEnv();
    const child = Bun.spawn(["bun", "run", "test:integration", "--force"], {
      env, stdin: "inherit", stdout: "inherit", stderr: "inherit",
    });
    process.exit(await child.exited);
  '
```

## Observed local results

Measurements used macOS arm64, 10 logical CPUs, 16 GiB RAM, Bun 1.4.3, Node v26.13.0, and Playwright 1.61.1. The starting commit was `21a18f2a46a57c619425157bc1fb25018c002fe5`. Dependencies and browsers were already installed. These runs exclude install and download time. Each E2E run started fresh servers and browsers. Raw artifacts and the decision trail are under `/tmp/nightwatch-test-optimization` on the author machine.

### Integration concurrency

Complete comparisons used Turbo `--continue=always` and `--force`. Every run reported 1,256 passed, 2 failed, and 2 skipped. The failures were the existing MFA re-enrollment cases in `apps/api/src/auth/auth.db.test.ts`. The skips were the Bun-listener cases documented in the quality guide.

| Run                             | Wall seconds | Sampled peak host RSS, MiB | Sampled CPU seconds |
| ------------------------------- | -----------: | -------------------------: | ------------------: |
| Original Vitest worker defaults |        77.44 |                     3545.6 |               91.43 |
| Explicit 2 workers per package  |        71.05 |                     1601.8 |               62.91 |
| Configured 2-worker defaults    |        72.42 |                     1512.7 |               73.01 |

The configured run used 57.3% less sampled peak host RSS and 6.5% less wall time than the original-worker sample. These are local observations, not a CI guarantee. The first fail-fast baseline took 32.14 seconds and interrupted Worker tests. It is excluded from performance comparisons because it executed less work. The complete runs left no test containers behind. API-package duration increased from 34.09 to 67.05 seconds in these complete comparisons, while the root command finished earlier because the Worker remained the critical path. The cap prioritizes peak resource use across packages.

Three fresh Worker test-cluster setups had a median duration of 1.140 seconds, including roles and all 27 migrations. Checksummed no-op migration replay had a median duration of 12.474 ms. Fresh-cluster replay and per-suite migration verification remain in place.

### E2E worker exploration

The unchanged selection was `auth-entry`, `hello`, `monitors-list-sort-view`, `monitors-access`, and `notifications`. Each run passed 40 tests with no skips, failures, or retries. Each row is the median of 2 runs. Run order was 1, 2, default, 1, 2, default. Default resolved to 5 workers on this machine.

| Workers | Wall seconds | Sampled peak host RSS, MiB | Sampled CPU seconds |
| ------- | -----------: | -------------------------: | ------------------: |
| 1       |        85.91 |                     2292.2 |              135.65 |
| 2       |        85.61 |                     2640.6 |              169.67 |
| 5       |        85.78 |                     3252.4 |              182.35 |

This selection contains natural notification dispatch waits. Its nearly equal wall times do not establish the fastest worker count for the full suite. Docker resource use is excluded from every RSS and CPU figure above.

### Full E2E verification

| Run                                       | Wall seconds | Passed | Skipped | Failed | Sampled peak host RSS, MiB |
| ----------------------------------------- | -----------: | -----: | ------: | -----: | -------------------------: |
| Original suite, default 5 workers         |       228.72 |    119 |       5 |      3 |               Not measured |
| Experimental global dispatcher, 5 workers |       192.77 |    125 |       1 |      2 |                     3581.9 |
| Experimental global dispatcher, repeat    |       200.85 |    124 |       1 |      3 |                     3911.7 |
| Scoped eligibility before wait overlap    |       230.01 |    124 |       1 |      3 |                     3842.4 |
| Final scoped overlap and page teardown    |       215.57 |    124 |       1 |      3 |                     3644.2 |

The experiments added one natural-cadence test and preserved the original assertions. The first experimental run passed all 19 tests in the four modified specs and used 15.7% less wall time. The repeat encountered an additional teardown deadlock at `e2e/support/monitor-fixtures.ts:130`. The cause is unresolved. The database-wide dispatch trigger was removed after this result. A scoped-only run still took 230.01 seconds and reproduced the same fixture-cleanup deadlock. The final approach completes the owned monitor's down and recovery transitions before waiting for the existing natural notification dispatch tick. Unknown external-service environments retain the original down-then-recovery sequencing. The three intermediate rows describe earlier experiments. The final scoped-overlap run took 215.57 seconds, 5.7% below the original observation, and passed all 19 tests in the four monitor specs. Its 3 failures were the two MFA cases and the membership fixture-cleanup deadlock. The cleanup change did not eliminate that deadlock. There is one original baseline, not a statistically controlled speedup claim. Filesystem caches and different failure-induced skips limit the comparison. The original `/usr/bin/time` maximum RSS is a largest-process value and must not be compared with sampled process-tree RSS.

Both failures in the first experimental run were the existing MFA QR cases in `login-active-organization.spec.ts` and `settings.spec.ts`. The remaining skip was the password-change case after the serial MFA failure. The unchanged Project-membership notice case failed in the original baseline and passed in this candidate. That variability is not a claimed bug fix.

A full 3-worker experiment was stopped after 479.11 seconds because it had already missed the default-worker wall-time goal. It also recorded additional UI/routing failures before interruption in event-feed, monitor states, monitor viewer, and notification-response cases. Their cause is unresolved. This partial run is `INCONCLUSIVE` for correctness and full-run peak resources. E2E worker defaults remain unchanged. Do not extrapolate the 40-test selection into a full-suite concurrency setting.

### Browser fixture teardown

PostgreSQL logs recorded fixture `delete from "user"` cascading into `member` while another transaction waited on `select last_active_tenant_id ... from "user" ... for update`. The membership tests still had their browser page open while deleting those fixtures. Both cleanup paths now close that page first. The membership spec passed all 9 cases across 3 targeted repeats after the change. The final full run still reproduced the cleanup deadlock. The logs identify the competing SQL statements, not the browser actor. Closing a page does not establish that its server transactions have finished. Further transaction-lifecycle or lock-order work remains unresolved. Production lock ordering and database cleanup queries are unchanged. The author log is `/tmp/nightwatch-test-optimization/postgres-deadlock.log`.

## Verification limits

`workflow:test` passed 62 tests and skipped the documented APFS-only case. The helper passed focused strict TypeScript checking, and repository lint passed. Root typecheck remains blocked by the unchanged `apps/web/src/pages/settings/MfaCard.tsx:181`, which reads `data.method` from a response typed as `{ totpURI: string; backupCodes: string[] }`. No application, dependency, or lockfile repair is included in this task.

Linux sampler execution and the GitHub CI install path were not run locally. The Playwright `--only-shell` installation command was checked with `--dry-run`. These observations do not establish release readiness.
