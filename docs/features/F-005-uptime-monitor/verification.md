# F-005 Uptime Monitor: integrated verification

Result: 30 of 62 acceptance rows are **observed pass**, 32 are **source-complete**, 0 are **observed fail**, 0 rows are wholly **not verified**. Four rows (AC-20 to AC-23) have a screen reader part that was **not verified**; the list for a human is in "Not verified". Author evidence from `NODE-F005-15`, not an independent technical verdict.

Date: 2026-09-30. Branch `nixbpe/f005-uptime-monitor`. Evidence files sit in `docs/features/F-005-uptime-monitor/verification/`.

## Status words

- **observed pass**: the behavior ran in this verification and the named command, test or log shows it.
- **source-complete**: code and unit or database tests exist (named), but this verification did not exercise the whole behavior end to end. Parts that were observed are listed in the note.
- **observed fail**: none.
- **not verified**: nothing ran.

## Environment and commands

Stack: API, Worker with roles `consumer,scheduler,monitor-scheduler,monitor-checker`, PostgreSQL 17 and Redis 7 from the worktree stack `nw-dev-23`, Chromium through Playwright 1.61.1. The target of every monitor is a local HTTP server (`e2e/support/monitor-target.mjs`) on 127.0.0.1, reached through the hostname in `OUTBOUND_TEST_ALLOWED_HOSTS`.

- CI uses `target.nw-test.internal` (mapped in `/etc/hosts` by the job). That name does not resolve on this machine and `/etc/hosts` was not edited, so every run here used `OUTBOUND_TEST_ALLOWED_HOSTS=127.0.0.1.nip.io` (public wildcard DNS). This is documented in `scripts/quality/README.md`.
- For the stop-Redis scenarios a separate throwaway stack ran on compose project `nw-dev-91` (PostgreSQL 5491, Redis 6471, Mailpit 7491) with its own API (4091) and Worker. The shared Redis of `nw-dev-23` was never stopped or paused. The throwaway project is removed after the runs.
- The integrated scenarios ran against an API and Worker started by hand from the same code (`bun run src/index.ts` in `apps/api` and `apps/worker`) with stdout redirected to files, so logs could be scanned and processes signalled. Playwright starts its own stack when no server is listening (last `bun run e2e` run below).

| Command | Result | Evidence |
| --- | --- | --- |
| `bun run e2e` (all specs, no stack running, `OUTBOUND_TEST_ALLOWED_HOSTS=127.0.0.1.nip.io`) | passed: 56 passed, 4 skipped, 3.6 min | `verification/e2e.log` |
| `bun e2e/verification/api-matrix.ts` (scenarios matrix, ssrf, secrets, ratelimit, concurrency) | passed: 211 checks, 0 failed | `verification/api-matrix.log` |
| `bun e2e/verification/api-matrix.ts alerts` | passed: 6 checks | `verification/alerts.log` |
| `bun e2e/verification/worker-restart.ts` (main Worker stopped for the run) | passed: 15 checks | `verification/worker-restart.log` |
| `bun e2e/verification/redis-outage.ts` (throwaway stack) | passed: 15 checks | `verification/redis-outage.log` |
| `bun e2e/verification/rls-check.ts` | passed: 33 checks | `verification/rls.log` |
| `bun e2e/verification/purge-check.ts` (throwaway database) | passed: 5 checks | `verification/purge.log` |
| `bun e2e/verification/scan-logs.ts` over 55 captured files (API, Worker, run output, 4.4 MB) | passed: 0 hits for 37 known values and 7 prefix patterns | `verification/scan-logs.log` |
| `bun e2e/verification/scan-logs.ts` over the response bodies of the final runs (secrets only) | passed: 0 hits in 6 files. Two earlier files hit only on a redirect token that the script itself wrote (fixed before the final run); with that line removed they are clean | `verification/scan-responses.log` |
| Gates of `scripts/quality/README.md`: `bun run validate`, `COVERAGE_GATE=1 bun run test:coverage`, `bun run build`, `bun run security` | not run (Technical Lead owns them after the writers stop) | none |

The 4 skipped tests are the signed-in tests of `e2e/tests/settings.spec.ts`, which skip themselves when their fixture variables are unset. They are not part of this feature.

Evidence keys used in the table:

- **M**, **A**, **S**: `e2e/tests/monitors.spec.ts`, `monitors-access.spec.ts`, `monitors-states.spec.ts` (in `e2e.log`).
- **API**: `api-matrix.log`. Its matrix is 5 roles (owner, admin, viewer, auditor, non-member) x 17 operations (6 reads, 11 writes including Test and secret operations) = 85 direct requests, each with the status, the listener hit count, a state snapshot before and after, and the audit lines.
- **ALERTS**, **RESTART**, **REDIS**, **RLS**, **PURGE**, **SCAN**: the logs named above.
- Unit and database tests are cited by file. They were not run in this verification.

## AC-01 to AC-62

| AC | Status | Evidence | Not observed here |
| -- | ------ | -------- | ----------------- |
| AC-01 | observed pass | S "AC-01 leaf ..." for owner, admin, viewer, auditor: leaf visible, `aria-current` on Overview, `/new`, Detail, Edit, link target, found by the command palette | none |
| AC-02 | observed pass | A "role x screen table": four roles read Overview and Detail, non-member sees a denied state without name or host. API matrix: 6 read operations return 200 for four roles, 403 `MEMBERSHIP_DENIED` for the non-member with no name, URL or count in the body | none |
| AC-03 | observed pass | A: viewer and auditor have no buttons and get the denied message on `/new` and `/edit`. API matrix: create, create with secret, edit, edit with secret replace, Test (draft, with secret, in Edit), pause, resume, delete, alert toggle return 403 for viewer, auditor and non-member, snapshot unchanged, 0 listener hits, 0 audit lines; owner and admin succeed | none |
| AC-04 | observed pass | S "AC-04": first-run empty, filtered empty, error with retry (aborted list), stale warning with data kept (aborted refresh), loading (the route loader holds the page, so the shell shows its "กำลังเปิดหน้า…" status), denied (A non-member), success | the in-page skeleton (`OverviewLoading`) never shows on a direct load because the loader fetches first |
| AC-05 | source-complete | `apps/web/src/pages/monitors/OverviewPage.test.tsx`, `apps/api/src/monitors/read-list.db.test.ts`, `packages/shared/tests/monitor-check/ssl-level.test.ts` | totals seen in screenshots only; all SSL levels and the 30 and 7 day edges not seen in a browser |
| AC-06 | observed pass | S "AC-06 ...": radios 1, 5, 15 minutes with 5 selected, line "ถือว่าปกติเมื่อได้รหัส 200-299", Basic to Advanced and back keeps name, URL and interval | none |
| AC-07 | source-complete | unit: `apps/web/src/pages/monitors/MonitorFormPage.test.tsx`. Observed: S: empty save focuses the name field with a described error; a refused save keeps typed values; double click creates exactly one monitor | the pending label on the save button (`MonitorFormPage.test.tsx`) |
| AC-08 | source-complete | unit: `apps/web/src/pages/monitors/MonitorFormTest.test.tsx`, `test-route.db.test.ts`. Observed: M "owner tests a config before saving": Test pass and a failing target (503), monitor count unchanged, one request at the target per Test. API matrix: each Test sends exactly 1 request | assertion rows and SSL in the result panel (`MonitorFormTest.test.tsx`) |
| AC-09 | observed pass | S: `http://localhost:PORT` is refused beside the URL with "ที่อยู่นี้ไม่อนุญาตให้ตรวจสอบ", no monitor, 0 target hits. API ssrf: 16 forbidden forms (loopback, `0.0.0.0`, decimal and hex IPv4, `::1`, IPv4-mapped IPv6, link-local metadata, RFC 1918, CGNAT, `fe80::`, `fd00::`, a name resolving to 127.0.0.1) give 422 on save, no resolved IP in any body | none |
| AC-10 | source-complete | `apps/api/src/monitors/test-route.db.test.ts`, `packages/shared/tests/monitor-check/run-check.test.ts`, `MonitorFormTest.test.tsx` | observed: "หมดเวลารอ 1 วินาที" and "ไม่พบชื่อโดเมนนี้" in S; TLS text and the service-error case not seen |
| AC-11 | observed pass | API ratelimit: 10 Tests pass, 11th and 12th get 429 `MONITOR_TEST_RATE_LIMITED` with `retryAfterSeconds`; a 4th user is refused at the 31st Test of the Organization; exactly 30 requests reached the listener. S "AC-11": "ทดสอบบ่อยเกินไป", "ลองอีกครั้งใน N วินาที", button `aria-disabled` | none |
| AC-12 | source-complete | `apps/api/src/monitors/health.test.ts`, `read-list.db.test.ts`, `DetailPage.test.tsx` | observed: "ปกติ" after the first pass (M), "ไม่ทราบสถานะ" after Resume (M) and after a URL edit (S), "หยุดชั่วคราว" (M); stale and "ล่าสุดทราบว่าล่ม" not seen |
| AC-13 | source-complete | unit: `apps/worker/src/monitor/checker.db.test.ts`. Observed: M "goes down and comes back": two failures open one incident and one down notification, one pass closes it. REDIS: same sequence on the second stack | pass, fail, pass without a health change; the duration text |
| AC-14 | source-complete | `apps/api/src/monitors/uptime.test.ts`, `read-detail.db.test.ts` | Detail uptime figures not compared with a hand-built fixture in a browser |
| AC-15 | source-complete | `apps/web/src/components/ui/response-time-chart.test.tsx`, `read-response-times.db.test.ts` | gaps in the chart with labels; only the keyboard-opened table was seen (AC-22) |
| AC-16 | source-complete | `packages/api-contract/src/monitor.test.ts`, `MonitorFormAdvanced.test.tsx`, `packages/shared/tests/monitor-check/json-scan.test.ts` | Advanced mode boundaries |
| AC-17 | source-complete | `packages/shared/tests/monitor-check/assertions.test.ts`, `apps/worker/src/monitor/checker.db.test.ts`, `DetailPage.test.tsx` | assertion words and truncation in a browser |
| AC-18 | source-complete | unit: `apps/web/src/pages/monitors/MonitorFormEdit.test.tsx`, `write.db.test.ts`. Observed: S "AC-18": Edit loads the values and saves back to Detail; two sessions edit, the second sees the conflict text with typed values kept and the first value stored; another Organization's id and a malformed id read "ไม่พบมอนิเตอร์นี้" on Detail and Edit | the URL-change marker in chart and history |
| AC-19 | observed pass | M: pause, resume, delete with dialog; Resume shows "ไม่ทราบสถานะ" with the first check held back (M "Resume shows unknown"); ALERTS: Pause closes the open incident as `paused_by_user`; M "notification of a deleted monitor stays": inbox item stays after Delete | Delete cancel by the button (Escape was observed, A) |
| AC-20 | observed pass | A (light and dark): Tab order add, refresh, search, status filter, first row link; filter announcement "พบ N จาก M" in `role="status"`; health as a word; table inside a named region | screen reader; the label sits on the scroll region around the table (shared `DataTable`), not on `<table>` |
| AC-21 | observed pass | A (light and dark): first invalid field focused, error linked by `aria-describedby`, Test result in `role="status"` and focus stays on the button, arrow keys move the interval radio, row names "ลบ header แถวที่ N", focus after add and remove | screen reader |
| AC-22 | observed pass | A: one h1, at least six h2 sections, the chart alternative is a real `<table>` opened from the keyboard button "ดูข้อมูลกราฟเป็นตาราง" | screen reader; heading order is asserted as one h1 plus h2 sections only |
| AC-23 | observed pass | A: Delete dialog starts on "ยกเลิก", Tab stays inside, Escape closes and returns focus to "ลบมอนิเตอร์", confirm lands on the Overview h1, Pause and Resume keep focus | screen reader |
| AC-24 | source-complete | `apps/worker/src/monitor/notifications.db.test.ts`, `checker-ssl.db.test.ts`, `apps/api/src/notifications/monitor-items.db.test.ts` | observed: one down and one recovered item per incident (M), alerts off creates no new item while the old one stays, only owner and admin change the setting (ALERTS, API matrix); SSL levels and paused monitors not observed |
| AC-25 | observed pass | S secrets: Detail and Edit show "ตั้งค่าแล้ว" and "แทนที่", the value is absent from the DOM. API secrets: bearer, basic, apiKey and secret header pass Test, create, and scheduled checks against a credential-checking target; responses carry `secretSlots` only. SCAN: 0 hits in 55 files (API, Worker, run output). API `scanStores`: 20 needles (14 values, some also as hex) absent from 9 tables | none |
| AC-26 | observed pass | S: replace with nothing typed shows "กรอกค่าใหม่ หรือกดยกเลิกการแทนที่"; changing the type shows "ค่าลับของชนิดเดิมจะถูกลบ". API: keep uses the stored value, replace uses the new one, replace with an empty value is 400 `MONITOR_INVALID` | none |
| AC-27 | observed pass | Scope review of `git diff 9b1fc01..HEAD` (see "AC-27 scope review"): no other channel, status page, multi-region, project scope, maintenance window, other protocol, assignment, "check now" or other credential type | none |
| AC-28 | source-complete | `packages/api-contract/src/monitor.test.ts`, `test-route.db.test.ts`, `write.db.test.ts` | forms of invalid URL other than a forbidden address |
| AC-29 | source-complete | `packages/api-contract/src/monitor.test.ts`, `test-route.db.test.ts` | header and body validation in a browser |
| AC-30 | source-complete | `packages/api-contract/src/monitor.test.ts`, `apps/web/src/pages/monitors/form/model.test.ts` | boundary values |
| AC-31 | observed pass | S "AC-31": at 50 monitors with one shared name and URL the Overview shows "องค์กรนี้มีมอนิเตอร์ครบ 50 ตัวแล้ว" and a disabled add button; the API answers the 51st with 409 `MONITOR_LIMIT_REACHED`; all 50 stay active. API concurrency: 60 parallel creates made exactly 50 | none |
| AC-32 | source-complete | `packages/shared/tests/monitor-check/run-check.test.ts`, `evaluation-error.test.ts`, `test-route.db.test.ts` | "ไม่ได้ประเมิน" rows in a browser |
| AC-33 | source-complete | `packages/shared/tests/monitor-check/assertions.test.ts`, `json-scan.test.ts`, `MonitorFormTest.test.tsx` | each JSONPath outcome against a live target |
| AC-34 | source-complete | `packages/shared/tests/outbound-http/send.test.ts`, `test-route.db.test.ts`, `checker.db.test.ts` | observed: redirect to a forbidden host is refused with `redirect_blocked` and the second listener saw 0 hits (API ssrf); loop, `http` to `https` and `https` to `http` not run |
| AC-35 | source-complete | `apps/worker/src/monitor/checker-ssl.db.test.ts`, `packages/shared/tests/outbound-http/send.test.ts` | no HTTPS target was used; certificate cases not run |
| AC-36 | source-complete | `apps/worker/src/monitor/notifications.db.test.ts`, `checker-ssl.db.test.ts` | SSL sequences not run |
| AC-37 | observed pass | RESTART: two Workers over 200 s gave at most one result per 60 s round; a Worker restarted after SIGTERM produced exactly one new result and no back-fill, and after SIGKILL no duplicate result | a check slower than the interval cannot occur (timeout is capped at 30 s, interval starts at 60 s) |
| AC-38 | observed pass | API concurrency: a check in flight when the monitor was paused, edited, or deleted left 0 result rows | none |
| AC-39 | source-complete | `apps/worker/src/monitor/checker.db.test.ts`, `egress-canary.test.ts` | observed: a moved ciphertext gives `check_error` `secret_decrypt_failed` and no incident (API secrets); egress canary failure and database outage not run |
| AC-40 | source-complete | unit: `apps/worker/src/monitor/checker.db.test.ts`, `apps/api/src/monitors/write.db.test.ts`. Observed: S "AC-40": after a URL edit Detail shows "ไม่ทราบสถานะ" and no "ปกติ" while the first check of the new value is held back, then "ปกติ" | other fields, an open incident, name-only edit, interval change |
| AC-41 | source-complete | unit: `apps/api/src/monitors/read-list.db.test.ts`, `packages/db/tests/monitor.db.test.ts`. Observed: PURGE: results older than 30 days are removed in batches of 2, the 4 younger stay; the incident closed 44 days ago is removed, the one closed 5 days ago and an open incident older than 30 days stay | coverage figures of a young monitor |
| AC-42 | observed pass | API secrets: a monitor with a query value and a body value (`POST`) ran; the Test result and the stored result show `token=•••`, the target saw the POST, and 6 tables (results, incidents, events, schedule, notification intents, inbox) and all logs hold neither value. The result table has no header or body columns | log lines of notification and incident text at scale |
| AC-43 | source-complete | unit: `packages/shared/tests/monitor-check/redact.test.ts`, `secrets.db.test.ts`. Observed: API secrets: a reflecting endpoint returns the bearer token; the Test result shows "•••" and not the value | a scheduled check against the reflecting endpoint |
| AC-44 | observed pass | API: origin change with `keep` is 422 `MONITOR_SECRET_ORIGIN_CHANGED` in Edit and in Test. S: the note "เปลี่ยนที่อยู่ปลายทาง ต้องกรอกค่าลับใหม่หรือลบค่าลับเดิม" and a disabled save button | none |
| AC-45 | observed pass | API: Test in Edit with `keep` reaches the target with the stored value; with `replace` the new value is sent, the stored row is unchanged and a later `keep` Test fails | none |
| AC-46 | observed pass | API secrets: changing the auth type leaves 0 slots, deleting a monitor leaves 0 rows in `monitor_secrets` | none |
| AC-47 | observed pass | S "AC-47": the warning "ผู้ที่ดูมอนิเตอร์เห็นค่านี้ได้ ห้ามใส่ความลับ ใช้ header ลับแทน" is present in Advanced mode | none |
| AC-48 | observed pass | API: a missing UUID, a malformed id and an id of another Organization give 404 `MONITOR_NOT_FOUND` in 9 operations, and the other-Organization and missing bodies are byte-identical. S: Detail, Edit and a malformed id read "ไม่พบมอนิเตอร์นี้" | Test of a missing id in the UI |
| AC-49 | observed pass | A: a user demoted to viewer while a new-monitor form, a second form, a Detail and a Delete dialog were open sees "สิทธิ์ของคุณเปลี่ยนแล้ว" on Save, Test, Pause and Delete, typed values stay, monitor count and versions unchanged, 0 target hits; after removal a reload shows no monitor data. A second user removed with Detail and Edit open sees no data after reload. Organization switch on Overview, Detail, `/new` (M) and Edit (A) lands on the new Overview | none |
| AC-50 | source-complete | unit: `apps/api/src/monitors/write-lifecycle.db.test.ts`. Observed: S: Delete confirmed after another session deleted it goes to Overview with "มอนิเตอร์นี้ถูกลบแล้ว"; a Detail left open shows "ไม่พบมอนิเตอร์นี้" after deletion elsewhere. API concurrency: 8 of 8 parallel edits gave one 200 and one 409 | double click on Test in the UI; duplicate pause and resume from two sessions |
| AC-51 | source-complete | unit: `apps/worker/src/monitor/notifications.db.test.ts`. Observed: REDIS: one down item per incident across two Redis outages, one recovered item. ALERTS: an incident closed by Pause sends no recovered item | a flapping sequence fail, fail, pass, fail, fail |
| AC-52 | source-complete | unit: `apps/api/src/notifications/monitor-items.db.test.ts`. Observed: M "notification of a deleted monitor stays": after Delete the inbox item remains and its link shows "ไม่พบมอนิเตอร์นี้" | a recipient whose role dropped |
| AC-53 | observed pass | REDIS (throwaway stack): Redis stopped while the second failing check ran; the incident and 2 results were stored with Redis down, 0 items delivered; 12 s after Redis started exactly one `MONITOR_DOWN` arrived, and 90 s later still one incident and one intent. A second stop and start with the incident open left one incident and one item; recovery then produced one `MONITOR_RECOVERED` | none |
| AC-54 | observed pass | M: create after a failing Test; Detail shows "รอตรวจครั้งแรก" until the first result; the first result gives "ปกติ" (M "first result", ~31 s including the 30 s list refetch). S "AC-54": a first failing result shows "ล้มเหลว 1 ครั้ง" and not "ล่ม" | Resume as a first-check trigger in the UI (covered by AC-19 run) |
| AC-55 | source-complete | unit: `packages/shared/tests/outbound-http/address-policy.test.ts`, `send.test.ts`. Observed: API ssrf: 16 forbidden address forms refused in Test and save with 0 listener hits; redirect to a forbidden host refused and the second listener saw 0 hits; a redirect to another origin dropped `Authorization` | DNS rebinding between resolve and connect (`packages/shared/tests/outbound-http/send.test.ts`); each address range (`address-policy.test.ts`) |
| AC-56 | source-complete | unit: `packages/shared/tests/credentials.test.ts`, `packages/db/tests/monitor.db.test.ts`. Observed: API secrets: a ciphertext moved to another monitor's row gives `check_error` `secret_decrypt_failed` (AAD); known values absent from API responses, 9 tables, Redis keys (894 bytes) and every Redis command during the run (270 KB, 3124 monitor-check references), and from 55 log files | AES-256-GCM parameters and key versions (`packages/shared/tests/credentials.test.ts`, `packages/db/tests/monitor.db.test.ts`) |
| AC-57 | observed pass | API ratelimit: viewer and non-member get 403 while the limit is exhausted. REDIS: Redis stopped gives 503 `RATE_LIMIT_UNAVAILABLE` in 2.03 s, Redis frozen gives 503 in 2.02 s, 0 listener hits, viewer still 403; error bodies carry no input | create returned 201 while Redis was stopped: only Test uses the limiter (see "Notes for the Technical Lead") |
| AC-58 | observed pass | RLS: 7 tables have RLS enabled and forced with a restrictive guard policy; `claim_due_monitor_checks` and `purge_expired_monitor_data` are security definer with a fixed `search_path`, no PUBLIC execute, executable by the runtime role and owned by nologin roles; `ensure_monitor_partitions` is not executable by the runtime role; the runtime role has no superuser or BYPASSRLS; context A sees only A rows and B only B rows in 6 tables, cannot read, update or write B's rows. `grep DATABASE_OWNER_URL apps/worker/src` finds it only in a test file | none |
| AC-59 | observed pass | API concurrency: 60 parallel creates at the limit made exactly 50; 8 of 8 parallel edits with one version gave one 200 and one 409; no monitor has two open incidents; late results after Pause, Edit and Delete are dropped (AC-38); no deadlock in any run | lock order itself (`write.db.test.ts`, `write-lifecycle.db.test.ts`) |
| AC-60 | source-complete | unit: `apps/api/src/monitors/uptime.test.ts`, `apps/worker/src/monitor/scheduler.db.test.ts`. Observed: RESTART: SIGTERM during an 8 s check exits in 7.98 s with the result recorded once; SIGTERM during a 20 s check exits in 15.03 s, logs "monitor check abandoned on shutdown" and leaves no row or incident; SIGKILL leaves no row, the claim expires and a new Worker re-checks with no duplicate. PURGE: batches of the requested size, and the partition runner on a fresh database created the previous, current and 3 later months | fixtures with hand-computed uptime (`uptime.test.ts`) |
| AC-61 | source-complete | unit: `apps/api/src/monitors/audit.ts` behavior in `secrets.db.test.ts`. Observed: API matrix: create 1 line, create with secret 2 (create and `secret.set`), edit 1, edit with secret replace 2 (update and `secret.replace`), pause 1, resume 1, delete 1, alert toggle 1; denied operations write 0 "monitor mutation" lines; the audit lines of the secret scenario hold no secret, URL or host | a failing logger not breaking the mutation (unit test) |
| AC-62 | source-complete | `apps/api/src/monitors/test-route.db.test.ts`, `apps/worker/src/monitor/checker-process.db.test.ts`, `checker.db.test.ts`, `packages/shared/tests/outbound-http/send.test.ts` | a DNS answer that changes after save needs a resolver stub, which no live run here had |

## Counts

| Status | Rows | Which |
| ------ | ---- | ----- |
| observed pass | 30 | AC-01 to AC-04, AC-06, AC-09, AC-11, AC-19 to AC-23, AC-25 to AC-27, AC-31, AC-37, AC-38, AC-42, AC-44 to AC-49, AC-53, AC-54, AC-57 to AC-59 |
| source-complete | 32 | AC-05, AC-07, AC-08, AC-10, AC-12 to AC-18, AC-24, AC-28 to AC-30, AC-32 to AC-36, AC-39 to AC-41, AC-43, AC-50 to AC-52, AC-55, AC-56, AC-60 to AC-62 |
| observed fail | 0 | none |
| not verified | 0 rows | the screen reader part of AC-20 to AC-23 (four rows carry a not-verified part) |

## Not verified

A screen reader (VoiceOver) cannot run in this environment. A human still has to do the following with the monitor pages open in Safari with VoiceOver, in both themes:

- AC-20: the filter result "พบ N จาก M" is spoken after typing in the search box and not on every 30 s refetch; the table region name "ตารางมอนิเตอร์" and the health words are read in row order.
- AC-21: on the form, the error text is read with its field, the Test result is read without moving focus, the interval radio group is read with its label and arrow keys change the value, the header rows are read as "ลบ header แถวที่ N".
- AC-22: Detail headings read in order (h1, then the h2 sections), the chart summary text is read, and the alternative table is reachable and readable.
- AC-23: the Delete dialog announces its title and description, the initial focus on "ยกเลิก" is read, and focus after Escape and after Delete is announced.

Also not covered by any run here: contrast of the status pills (design review), zoom beyond the 640 px viewport (1280 px at 200%) that was tested, and HTTPS certificate behavior (AC-35, AC-36, SSL rows of AC-05 and AC-24).

## AC-27 scope review

`git diff 9b1fc01..HEAD --stat` lists 202 files (before this task). Every file falls under a Task of `spec.md` except the ones below, which the spec does not name. Each is small and serves the feature; none adds a channel, protocol or scope listed in AC-27. A grep of the added non-test lines for slack, webhook, pagerduty, status page, region, maintenance, tcp, icmp, ping, "check now", "ตรวจทันที", assign and project id found only unrelated hits (`redis.ping()` in readiness, header id assignment, a `slack` parameter of the chart series).

| File | Change | Reason found |
| ---- | ------ | ------------ |
| `.gitleaksignore` | one fingerprint | fake test token in history (commit `59479c7`) |
| `apps/api/src/server-options.ts` | idle timeout 45 s | Test can run 30 s (spec revision 2026-09-30, Bun `idleTimeout`) |
| `apps/api/src/operator/seed.db.test.ts` | restore tracking row directly | test fix (commit `563c1e2`) |
| `turbo.json` | `globalPassThroughEnv` for four variables | P1 (env for turbo tasks) |
| `packages/db/package.json` | `test:integration` adds `tests/monitor.db.test.ts` | new DB test |
| `apps/web/src/components/shell/OrgSwitcher.tsx` | Organization switch keeps `/monitors` and its sub-routes | AC-49 |
| `apps/web/src/components/ui/segmented-control.tsx` | `disabled` prop | form locking while saving |
| `apps/web/src/lib/api/notifications.ts` | type of the settings update | `monitorAlertsEnabled` |
| `apps/web/src/components/ui/response-time-series.ts` | chart series helper | chart (Task 11), file not named |
| `docs/runbooks/uptime-monitor.md` | new runbook (120 lines) | P1 and P2 |

## Notes for the Technical Lead

- AC-57 wording: "Test and write operation" checks membership and permission first, and a limiter that is unavailable or slower than 2 s returns 503. Only Test uses the limiter, so with Redis stopped a create returned 201. If writes should also return 503 when Redis is down, that is a contract change; nothing was edited.
- The header Organization switcher showed the server-active Organization (B) while a deep link opened Organization A's Overview (screenshot `overview-dark.png`). The page content and breadcrumb follow the URL. This matches the note in `MonitorForm.tsx` that the route Organization can differ from the active one; no acceptance row covers it.
- `docs/architecture.md` was changed in status wording only (System parts, Background jobs). The rules OUT-01, REQ-04 and DB-14 carry no status word, so the `Implemented` statement for the SSRF helper, limiter, credential encryption and monthly partitions is in the System parts sentence. No code contradicting a rule was found.
- Two `redis-cli MONITOR` clients that my secret-scan runs left on the shared `nw-dev-23` Redis (ids 18376 and 17309, ages matching those runs) were removed with `CLIENT KILL ID`. `api-matrix.ts` now removes the MONITOR clients it starts; that cleanup was proven with a stand-alone run of the same logic, not by rerunning the whole scenario.
- A false defect report (Resume showing "ปกติ") was sent and withdrawn: the new pass arrived within seconds of Resume.

## Screenshots

`overview-light.png`, `overview-dark.png`, `detail-light.png`, `detail-dark.png`, `form-test-result-light.png`, `form-test-result-dark.png`, `edit-secret-set.png` (Edit before Replace), `edit-secret-replace-open.png` (Edit after pressing "แทนที่"), and the 640 px reflow set `reflow-640-light-overview.png`, `reflow-640-light-detail.png`, `reflow-640-light-new.png`, `reflow-640-light-edit.png`, `reflow-640-dark-detail.png`. All sit in `docs/features/F-005-uptime-monitor/verification/`. They were taken by the spec runs with `VERIFY_SHOTS_DIR` set.

## Reproduce

```sh
export OUTBOUND_TEST_ALLOWED_HOSTS=127.0.0.1.nip.io   # or target.nw-test.internal where /etc/hosts maps it
bun run e2e                                          # Playwright starts the Worker, API and web
# integrated scenarios need a running API and Worker with stdout in files:
API_LOG=... WORKER_LOG=... EVIDENCE_OUT=... RESPONSES_OUT=... bun e2e/verification/api-matrix.ts [matrix|ssrf|secrets|ratelimit|concurrency|alerts]
bun e2e/verification/rls-check.ts                    # EVIDENCE_OUT=...
# worker-restart.ts (stop the stack Worker first), redis-outage.ts and purge-check.ts (throwaway stack only)
bun e2e/verification/scan-logs.ts <secrets.json>... @@ <log file>...
```
