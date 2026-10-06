# Issue #57 execution evidence

OWNER: software-engineer, NODE-F005-57V. Author-produced evidence สำหรับ F-005-AC-2 AC-63 ถึง AC-74. Manual screen-reader proof ยังไม่ครบ; ผู้ใช้อนุญาต bypass AC-71 และ AC-74 เพื่อเปิด PR ตาม [PR publication exception](#pr-publication-exception). ไม่ใช่ independent acceptance หรือ release approval.

## Source state

- Approved source คือ [spec.md](spec.md), frozen criteria คือ [feature.md](feature.md#acceptance-matrix-57-delta). ไม่แก้สองไฟล์นี้หรือ implemented F-005 records.
- API commit `3934af23c689f6a54a0926caa0db3431e43f3d11`, Web commit `9fc331bfe75fccc30857f5c4de012e72b61eea53`.
- 57V fixture repair commits คือ `f4b3b84` และ `76af29b701d3637a997ca91edd59f78eaad4de3d`. ไม่แก้ application components, API query, contracts, generated client หรือ database schema.
- Final source runs ตรวจ HEAD `76af29b701d3637a997ca91edd59f78eaad4de3d` พร้อม owned E2E diff. E2E Git blob คือ `a0f2e5674ba8b21099c138a54f189f853acde5ec`. Checkpoint commit หลัง checks เก็บ bytes ชุดเดียวกันกับ report นี้. Commit SHA สุดท้ายอยู่ใน 57V handoff.
- Technical Lead ไม่ได้กำหนด binding triple. ไม่ตั้ง candidate binding หรือ independent verdict เอง. Full tracked diff against `292ce19` อยู่ `/tmp/nightwatch-issue57-run/candidate.diff` หลัง checkpoint commit.

## Commands and results

Artifact directory ทุกแถวคือ `/tmp/nightwatch-issue57-run/`. Safe runner `57V-safe-gate.mjs` อ่าน `scripts/dev-env.mjs`, ปฏิเสธ ambient database/Redis/CI/external-service variables และตรวจ exact worktree loopback ports กับ runtime/owner roles ก่อน spawn. Coverage runner ตั้ง `COVERAGE_GATE=1` จริง. Database packages รัน serial ด้วย `--concurrency=1`; `--force` ป้องกัน cache แทน runtime proof.

| Command actually run | Result | Artifact / exercised behavior |
| --- | --- | --- |
| `bun run validate` | observed pass หลัง repairs | `57V-validate-complete.log` รัน package lint/typechecks/tests จริง; `57V-validate-source-final.log` final rerun ผ่าน workflow, agent config, formatting และ codegen drift โดย 7 package tasks เป็น cache hit ของ unchanged application bytes |
| `bun run --cwd apps/api lint`, `bun run --cwd apps/api typecheck` | observed pass | `57V-fixture-lint.log`, `57V-fixture-type.log`; typed Proxy binding repair |
| `bun /tmp/nightwatch-issue57-run/57A-integration.mjs` | observed pass, 82 tests | `57V-fixture-db.log`; clock/statement/membership fixture callers ทั้งสาม files |
| `bun run --cwd apps/web lint`, `bun run --cwd apps/web typecheck` | observed pass | `57V-web-lint.log`, `57V-web-type.log`; callback repair |
| `bun run --cwd apps/web test src/pages/monitors/DetailPage.test.tsx` | observed pass, 90 tests | `57V-web-test.log`; state, selection, retries, tenant and identity-cache late completions |
| `bun run db:up` | observed pass | `57V-db-up.log`; task-owned Compose services |
| `bun /tmp/nightwatch-issue57-run/57V-safe-gate.mjs test:integration --concurrency=1 --force` | observed pass | `57V-integration-source-final.log`; API 684 pass/2 skip, DB 132 pass, Worker 149 pass, 0 cached tasks |
| `bun /tmp/nightwatch-issue57-run/57V-safe-gate.mjs test:coverage --force` | observed pass, gate enabled | `57V-coverage-source-final.log`; 6 packages executed serial, API statements/branches/functions/lines 92.70/88.39/95.90/94.79%, Web 92.77/88.21/92.85/94.00% |
| `bun run build` | observed pass | `57V-build-source-final.log`; API, Worker, Web builds. Web chunk warning remains, no new chunk tuning |
| `bun run security` | observed pass | `57V-security-source-final.log`; audit no vulnerabilities, gitleaks no leaks, semgrep 98 rules/632 tracked files/0 findings |
| `bun /tmp/nightwatch-issue57-run/57V-safe-gate.mjs db:migrate` | observed pass | `57V-migrate.log`; unchanged migration ledger, no #57 migration |
| `bun install --cwd e2e --frozen-lockfile`, `(cd e2e && bun x playwright install chromium)` | observed pass | `57V-e2e-setup.log`, `57V-chromium-setup.log`; pinned Playwright 1.61.1. `57V-e2e-lock-before.txt` equals `57V-e2e-lock-after.txt` |
| `bun /tmp/nightwatch-issue57-run/57V-safe-gate.mjs --cwd e2e test tests/monitors-states.spec.ts --reporter=list,json --output=/tmp/nightwatch-issue57-run/57V-e2e-source-final-results` | observed pass, 20 tests, 3.5 min | `57V-e2e-source-final.log`, `57V-e2e-source-final.json`. Run also set `VERIFY_SHOTS_DIR=/tmp/nightwatch-issue57-run/57V-shots` and `PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/nightwatch-issue57-run/57V-e2e-source-final.json` |
| `bun /tmp/nightwatch-issue57-run/57V-safe-gate.mjs --cwd apps/api test:integration src/monitors/read-response-times.db.test.ts src/monitors/read-membership.db.test.ts src/monitors/read-detail.db.test.ts --reporter=verbose` | observed pass, 82 tests | `57V-db-verbose.log`; named RLS/bounds/cap/concurrency/retention/uptime regression outcomes |
| `bun /tmp/nightwatch-issue57-run/57V-plans.mjs` | observed pass, diagnostic-only | `57V-plans.log`, `57V-plan-7d.json`, `57V-plan-30d.json`; actual endpoint SQL from source, scoped runtime role |
| `bun /tmp/nightwatch-issue57-run/57V-cleanup-check.mjs` | observed pass | `57V-cleanup-check.json`; catalog runtime privilege check and generated E2E database/Redis namespace remaining 0 |
| `bun run db:down` | observed pass | `57V-db-down.log`; owned containers/network removed, volume retained |
| `git diff --check`, staged diff check | observed pass | checkpoint handoff; owned paths only, no ambient `.pi/` staged |

Original root integration command passed but default Turbo fanout ran three DB packages together. `57V-integration.log` is non-qualifying for serial DB proof. First serial rerun was entirely cached (`57V-integration-serial.log`). Forced serial execution in `57V-integration-serial-executed.log` and final source run above supplies actual proof.

## AC results

`observed pass` ด้านล่างหมายถึง author-executed automated scope ที่ระบุ. ไม่ยก manual gaps เป็น pass.

| AC | Result | Actual proof / limits |
| --- | --- | --- |
| AC-63 | observed pass | Same raw fixture [10,20,30,40] reaches real API and browser, p50/p95/checks/failed = 20/40/4/1 in 24h/7d/30d. Four roles exercise direct requests for all ranges and browser 24h. No #57 link in KPI card; graph/table remain |
| AC-64 | observed pass | DB literal nearest-rank, N0/N1/zero/duplicates and unequal hourly weights. Full Web suite verifies adapter arithmetic. Browser repeats literal values, never fulfills invented API metrics |
| AC-65 | observed pass | DB mixed measured/null/classification fixtures and API/Worker integration regressions. Browser measured fail counts 1 even without incident; all-timeout keeps 4 failed with null percentiles |
| AC-66 | observed pass | DB check_error populations and Web component tests. Real browser changes four stored rows to measured check_error 0 ms, checks/failed 0/0, health displays system error rather than UP; timeout health remains unknown |
| AC-67 | observed pass, automated scope | Fixed-clock DB start/T ±1ms, scheduled/checked divergence, inclusive T, exact-hour169/721, non-UTC session and post-T events. Browser real response metadata matches window.to/dataAsOf, shows scheduled bounds and UTC-hour wording, table retains clipped current hour |
| AC-68 | observed pass | DB actual overflow/cap-before-filter/long uncapped and raw-retention cases. Browser stores 1,441 unique scheduled seconds in 24h, reads 1,440 with cap wording and 1,441 in 7d |
| AC-69 | observed pass, automated scope | DB four roles/non-member/malformed/foreign IDs/member removal lock ordering. Browser real membership removal waits for actual server403 then asserts hidden KPI. Second browser scenario holds real A response, confirms server active-org switch, displays B999 ms, then releases A10 ms and asserts B unchanged |
| AC-70 | observed pass, automated scope | Focused Web and full suites exercise all Feature states. Browser covers initial empty/loading, timeout/null, measured check_error, success, abort/error/retry, same-key refetch warning/time/retry and cached denial. Late 30d fixture has 1,442 results versus selected7d 1,441. Browser asserts selected7d radio/status after actual late completion; literal no-replacement assertion after completion is supplied by the component test, not repeated in this browser scenario. Pause-state rendering remains component/DB proof |
| AC-71 | not verified, mandatory manual gap | Browser Space/Enter range/table controls, retained focus, polite status text and visible labels both themes pass. Selection announcement ordering and no auto-refetch announcement have jsdom MutationObserver proof in DetailPage tests. Actual screen-reader speech, manual chart keyboard review and full announcement review have not been performed |
| AC-72 | observed pass | `57V-db-verbose.log` controls uncommitted insert/purge/delete/pause/resume, commits after statement, checks coherent before/after populations/events/status. Post-T pause/resume and same-millisecond microsecond event rewind pass. Authorized organization lock blocks removal; subsequent read denies. No shared isolation change |
| AC-73 | observed pass, automated scope | Direct runtime A/B/no-context SELECT and non-owner NOBYPASSRLS/FORCE RLS/grants tests pass. Separate catalog snapshot confirms both raw/hourly tables. Route non-disclosure tests pass; runtime E2E logs contain standard masked paths/codes, no added raw-sample/config/credential logging. Static security scanners pass |
| AC-74 | not verified in full | Source/commands/runtime security/codegen/full gates/diagnostic plans recorded here. Required AC-71 manual proof is open. No latency, production capacity, release or rolling-deployment claim |

Baseline AC-14/15/22/39/48/49 have automated regression proof from full suites and focused DB82. Uptime excludes pause/check_error, 2 fails/8 checks remains75%, chart gaps/pause/table behaviors remain tested, foreign/malformed IDs and non-member reads remain non-disclosing. Browser table keyboard and confirmed tenant-switch race pass. Full manual chart keyboard/screen-reader review is still open.

## Browser and API artifacts

Desktop viewport is 1440×900. Final JSON reporter contains actual API attachments, extracted under the artifact directory as `57-api-{owner|admin|viewer|auditor}-{24h|7d|30d}.json`. These are parsed real responses, not mock echoes. Delayed-response fixtures use `route.fetch()` then release the actual response; error fixtures abort transport and retry the real endpoint.

Images under `/tmp/nightwatch-issue57-run/57V-shots/` include:

- `57-empty-before-light.png`, `57-empty-before-dark.png` show the initial empty fixture. These are state-transition images, not pre-implementation baseline screenshots.
- `57-kpi-{24h|7d|30d}-{light|dark}.png` show known live KPI values with range focus. `57-known-{24h|7d|30d}-{light|dark}.png` show the expanded table and table-button focus.
- `57-timeout-{light|dark}.png`, `57-check-error-{light|dark}.png`, `57-error-{light|dark}.png` show real null/system-error states and request failure without success KPIs.
- `57-cap-dark.png`, `57-stale-{light|dark}.png`, `57-denied-dark.png`, `57-tenant-switch.png` supplement cap/stale/denial/switch tests. Stale screenshot framing shows the retained KPI; warning/time is asserted by E2E, its warning can be below the captured viewport.

Author visually inspected known light/dark KPI, rendered24h chart, timeout light/dark, error light/dark and denied dark artifacts. Text/units/bounds and focus are visible in inspected frames. This image inspection does not certify contrast measurements, screen-reader speech, every keyboard path, or uninspected screenshots. Denied light-theme review remains open.

Actual sign-in checks for four roles clear cookies and navigate through login. They do not prove a pending response across the full sign-out/sign-in SessionQueryProvider lifecycle. Identity-cache late completion is covered by the component epoch-boundary test, full browser identity lifecycle remains not run.

## Failures and bounded repairs

1. Initial `validate` failed formatting only for ambient untracked `.pi/settings.json` (`57V-validate.log`). Parent performed config-only Prettier formatting with unchanged JSON values and authorized rerun. 57V never staged or committed `.pi/`.
2. Next full lint found four unsafe `Function.bind` returns in 57A Proxy fixtures (`57V-validate-rerun.log`). `f4b3b84` retains the same runtime Proxy/interleavings and gives bound results an `unknown` boundary. Focused lint/typecheck/DB82 pass. No cast or suppression.
3. Next lint found17 new Web test callback issues (`57V-validate-final.log`). `76af29b` adds void callback blocks, explicit resolved Promises for act callbacks without asynchronous work, and removes unnecessary textContent fallback. Assertions and scheduling semantics stay unchanged. Focused lint/typecheck/90tests pass. Earlier57A/57B focused proof did not include full lint.
4. First E2E failed missing `e2e/node_modules/@playwright/test/cli.js` (`57V-e2e.log`). Parent authorized documented frozen install/Chromium setup. Lock hash stayed identical. Existing18-test E2E then passed (`57V-e2e-rerun.log`).
5. Own browser fixtures initially used nonexistent `monitors.next_check_at`, then attempted login while already signed in (`57V-browser.log`, `57V-browser-third.log`). Corrected fixtures use the actual schema without a schedule ledger and clear cookies before new login. No application repair.
6. Extended19-test run failed existing forbidden-address global target counter and own20s stale observation budget (`57V-e2e-final.log`). Background checker completed an unrelated persisted monitor at06:29:26.356 before blocked request422 at06:29:26.409. Target counter counted every request, expected2/received3. A task-owned due-schedule diagnostic reproduced counter growth without forbidden traffic (`57V-diagnostic.log`). Parent authorized a baseline fixture exception. Forbidden request now targets its own server/port, still asserts zero persisted rows and unchanged actual request count, and closes in finally. This defect predates #57; #57 test runs later.
7. Own stale/denial waits now observe the real30s poll/staleTime with bounded45s waits. Denial proof waits for actual403 before asserting hidden data, not for cache expiry. Own tenant-switch probe initially expected `/workspace`; actual existing switch routes to the new tenant monitor list. Corrected that new fixture to the observed source behavior (`57V-tenant.log`, `57V-tenant-second.log`). Temporary diagnostic test was removed. Focused2-test browser repair passed (`57V-browser-sixth.log`) and final20-test full E2E passed.

## Diagnostic query cost

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` uses endpoint SQL and a task-owned monitor with minute-spaced raw rows. Results are diagnostic-only:

| Window | Scoped raw rows | Execution time | Temp read/write blocks | Raw partitions scanned |
| --- | --- | --- | --- | --- |
| 7d | 10,048 | 8.474 ms | 0 / 0 | `monitor_check_results_p202609`, `monitor_check_results_p202610` |
| 30d | 43,168 | 31.395 ms | 0 / 0 | same two partitions |

Plan JSON records in-memory sorts and bound partition pruning. Synthetic organization was deleted in finally. These timings have no accepted latency target and do not prove production capacity or concurrent-poll performance.

## Resources, skipped checks and remaining risk

- 57V created `nw-dev-71-postgres-1`, `nw-dev-71-mailpit-1`, `nw-dev-71-redis-1` and `nw-dev-71_default`. Cleanup owner57V ran `bun run db:down`; containers/network removed, data volume retained. No shared volume destroyed.
- Final E2E owned database and Redis prefix were `nw_e2e_6625aa73ea30405d8389c6a2da214d03`. Runner finally owns namespace cleanup. `57V-cleanup-check.json` confirms database0 and keys0 afterward. Browser/API/Worker and isolated target servers ended. Local services are stopped.
- Actual screen-reader review, full manual chart keyboard review, denied light-theme review, pending full sign-out/sign-in browser identity lifecycle and pre-implementation baseline screenshots are not run. Parent owns follow-up and acceptance. Empty-before/live-after images cannot fill the baseline screenshot gap.
- Existing test skips remain visible in logs, workflow1 and API integration2. No new skip or weakened threshold was added.
- Image security scan is not run, no infra/image changes and not assigned by #57 spec. CI, push, PR, merge, deploy and release are not run.
- Required wire metadata and max721 remain a coordinated API/Web candidate. Rolling deployment and old browser-bundle compatibility require a separate release plan. Query cost evidence remains local diagnostic data.

Prove It Works shaped the real raw→API→browser checks and honest manual gap. Sequence Work into Verifiable Units shaped fixture repair/check/commit order and serial DB execution. Fix Root Causes shaped the isolated target fixture instead of changing expected counts. Type System Discipline shaped the unknown Proxy boundary without casts. Model the Domain kept actual response parsing in the discriminated schema and range/role tables. Decision trail is `/tmp/nightwatch-issue57-run/decisions.tsv`; parent owns independent review, no nested agents or self-approval.

## PR publication exception

ผู้ใช้สั่งใน session นี้: `bypass AC-71 และ AC-74 ได้เลย จากนั้นเปิด PR` ข้อยกเว้นนี้อนุญาตการเปิด PR ของ issue #57 โดยไม่รอหลักฐานที่ยังขาดในสอง criteria นี้ ไม่แก้ frozen definitions, ไม่แทน `not verified` ด้วย `observed pass` และไม่อนุญาต merge, deploy หรือ release.

AC-71 และ AC-74 ยังคง `not verified` ในส่วนที่ระบุด้านบน. Automated evidence ที่ตรวจแล้วคงเดิม. Manual screen-reader/chart review, historical baseline screenshots และ manual/browser scenarios ที่ยังไม่ตรวจต้องปรากฏเป็นข้อจำกัดใน PR. Local quality gates, security checks และ independent source review ยังต้องผ่านก่อน publication; PR CI ต้องรายงานตามผลจริง.

## Comment and test cleanup checkpoint

Cleanup against `2449df9b2901e70671627249bcf467f556d14df6` removes 7 comment lines and replaces 21 test titles in 6 files. The reviewed source delta has SHA256 `8e7d34c6f8d7d7086705165860f66897b7060f7e06f4158f23e5fb9ea61ffaf5`. No assertions, fixtures, scenarios, skips, contracts or generated output changed. Static redundancy review found no equivalent same-layer survivor that preserves every trigger and assertion, so no tests were deleted.

Fresh focused Web results are 147→147 pass; focused DB results are 82→82 pass; E2E discovery remains 20→20. Final independent static review found Blocker 0, Major 0, Minor 0 and Nit 0. These results cover the source delta before the checkpoint commit, not gates executed on a later head SHA.

| Cleanup gate | Author-produced result | Artifact under `/tmp/nightwatch-issue57-run/` |
| --- | --- | --- |
| validate | observed pass; test tasks 7 successful, 5 cached | `cleanup-validate.log` |
| integration | observed pass; forced serial, 0 cached; API684 pass/2 existing skips, DB132 pass, Worker149 pass | `cleanup-integration.log` |
| coverage | observed pass; `COVERAGE_GATE=1`, forced serial, 0 cached; API lines94.86/branches88.53%, Web lines94.00/branches88.21% | `cleanup-coverage.log` |
| build | observed pass; 3 successful, 1 cached | `cleanup-build.log` |
| security | observed pass; audit, Git-history secrets scan and SAST; 0 findings | `cleanup-security.log` |
| e2e | observed pass; real isolated browser run, 20 pass, 0 skipped/unexpected/flaky | `cleanup-e2e.log`, `cleanup-e2e.json` |

Current 1440×900 after screenshots show fixture p50/p95/checks/failed = 20/40/4/1:

- 7d: [light](screenshots/57-kpi-7d-light.png), [dark](screenshots/57-kpi-7d-dark.png).
- 30d: [light](screenshots/57-kpi-30d-light.png), [dark](screenshots/57-kpi-30d-dark.png).

The screenshots are current after evidence, not historical baseline images or screen-reader proof. AC-71 and the dependent manual portion of AC-74 remain not verified. Other manual/browser gaps listed above remain open. Owned E2E databases and Redis keys remaining are 0; task-owned Compose services are stopped. The user subsequently authorized the PR publication exception below.
