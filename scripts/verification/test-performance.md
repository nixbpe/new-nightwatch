# Test performance measurement

Historical measurements started at `21a18f2a46a57c619425157bc1fb25018c002fe5` on macOS arm64,
with 10 logical CPUs, 16 GiB RAM, Bun 1.4.3, Node v26.13.0, and Playwright 1.61.1.
Dependencies and browsers were already installed, so install and download time
are excluded. Each E2E run started fresh servers and browsers.

## Integration concurrency

Complete comparisons used Turbo `--continue=always` and `--force`.
Both runs reported 1,256 passed, 2 failed, and 2 skipped. The failures were the
existing MFA re-enrollment cases in `apps/api/src/auth/auth.db.test.ts`.
The skips were the Bun-listener cases documented in the quality guide.

| Run                             | Wall seconds | Sampled peak host RSS, MiB | Sampled CPU seconds |
| ------------------------------- | -----------: | -------------------------: | ------------------: |
| Original Vitest worker defaults |        77.44 |                     3545.6 |               91.43 |
| Configured 2-worker defaults    |        72.42 |                     1512.7 |               73.01 |

The accepted cap of 2 workers per package prioritizes peak resource use across
packages. The Worker remained the critical path. The configured run used 57.3%
less sampled peak host RSS and 6.5% less wall time than the original sample.
These historical local observations are not a CI or performance guarantee.

## Full E2E verification

| Run                                    | Wall seconds | Passed | Skipped | Failed | Sampled peak host RSS, MiB |
| -------------------------------------- | -----------: | -----: | ------: | -----: | -------------------------: |
| Original suite, default 5 workers      |       228.72 |    119 |       5 |      3 |               Not measured |
| Final scoped overlap and page teardown |       215.57 |    124 |       1 |      3 |                     3644.2 |

The final run added one natural-cadence test and preserved the original assertions.
Its failures were the two existing MFA QR cases in `login-active-organization.spec.ts`
and `settings.spec.ts`, and the membership fixture-cleanup deadlock.
Closing browser pages before fixture deletion did not eliminate that deadlock.
Transaction-lifecycle or lock-order work remained unresolved.
The single baseline, filesystem caches, and different failure-induced skips limit
comparison. The original largest-process RSS is not comparable with sampled
process-tree RSS. These results establish no comparative RAM improvement.
E2E worker defaults remain unchanged. The partial 40-test selection does not
establish a full-suite concurrency setting.

## Metric and verification limits

Host `ps` samples followed the command PID and its current PPID descendants.
Peak RSS is the largest simultaneous process-tree sum, with shared pages counted
per process. It is not an operating-system maximum or the largest child's maximum.
CPU seconds sum each observed PID's greatest cumulative CPU time, limited by `ps`
clock precision. Short-lived processes, between-sample activity, and reparented
descendants can be missed. PID reuse can distort totals. Sampling stopped at
command exit, even if descendants remained. Sampling cost affects elapsed time.
The wrapper, sampler, unrelated processes, and Docker container resources were
excluded. Host-side Docker clients remained part of the command tree.
Linux sampling and GitHub CI execution were not run locally.
These historical results do not establish current green CI or release readiness.
