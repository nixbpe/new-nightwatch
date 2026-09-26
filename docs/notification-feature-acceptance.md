# Feature Acceptance: In-app Notification

**Feature:** `draft:F-002` (provisional; not a published tracker ID)  
**Candidate:** `notification-tech-spec/2026-09-25-consolidated` + `notification-api/1` + criteria AC-01–AC-37 below  
**acceptanceVersion:** `draft:F-002-AC-1`  
**acceptanceStatus:** frozen — PO-authored AC-01–AC-37, scope owner approved via asking tool in this conversation, Technical Lead co-approved exact `draft:F-002-AC-1`; implementation acceptance not yet assessed  
**delivery_status:** Refining · **outcome_status:** Not measured  
**Parent Epic:** Unknown; no approved Epic reference was supplied. This does not change user-authorized build scope.

Product Owner authored these criteria from user decisions in [implementation spec](notification-implementation-spec.md) and [API contract](notification-api-contract.md). Each row describes observable acceptance, not an executed result. All criteria are **not demonstrated** until evidence records environment, fixture, steps, expected/actual result, and candidate version. The same frozen version must be used by implementation, review, and acceptance; new behavior requires a separate Product Owner scope decision and a new version.

| ID | Given / action | Expected observable result | Verification |
| --- | --- | --- | --- |
| AC-01 | Verified client calls notification/settings routes | Seven method/path pairs, bounds and success shapes match `notification-api/1`; account/org discriminants are valid | API/OpenAPI/Zod contract integration |
| AC-02 | Missing/unverified session or membership changes | 401 `UNAUTHENTICATED`/403 `EMAIL_NOT_VERIFIED`; membership is checked at each scoped operation; no protected data leaks | Session/role authorization matrix |
| AC-03 | GET/PATCH settings for active or inactive Organization | Current Owner/Admin succeeds; other member 403 `PERMISSION_DENIED`, nonmember 403 `MEMBERSHIP_DENIED`; URL scope is verified | Two-Organization API integration |
| AC-04 | Open/read foreign, expired or nonexistent item; invalid input | Foreign/expired/nonexistent all 404 `NOTIFICATION_NOT_FOUND`; malformed input 400 `INVALID_INPUT`; caller cannot override user/org scope | Cross-user/org item and input tests |
| AC-05 | Native `change-password` or trusted direct call commits credential change | Owner receives one durable `PASSWORD_CHANGED` intent; failed/nonqualifying write emits none; original auth behavior remains | Real-DB auth-origin/rollback test |
| AC-06 | Native reset updates or first inserts credential | Owner receives `PASSWORD_CHANGED`; spent token without credential change, signup or OAuth update emits none | Reset/signup/OAuth integration |
| AC-07 | Auth state commits then endpoint fails in later session/cookie step | Intent survives non-2xx and can deliver once; failure before state commit has no intent | Fault injection around commit |
| AC-08 | MFA pending, verified enable/disable, re-enrollment, re-verification | Only committed effective verified-state transitions produce `MFA_ENABLED`/`MFA_DISABLED` for account owner | Transition/rollback integration |
| AC-09 | Intent insert fails at qualifying credential/MFA/settings write | Originating state and intent roll back together, including outer adapter transaction | Transaction-bound failure injection |
| AC-10 | Settings row absent; PATCH with matching/stale version | Default enabled/version 0; stale version 409 `SETTINGS_VERSION_CONFLICT` even for same value; valid no-op does not emit; actual change increments version | CAS and concurrent-writer integration |
| AC-11 | Owner/Admin toggles org setting on→off or off→on | Prior value decides intent: on→off notifies others, off→on does not for that write; actor receives no item | Sequence + Worker integration |
| AC-12 | Settings notification is materialized | Item shows actor display name at event time, timestamp and `notification-settings` category; no before/after values or credentials | API/browser content inspection |
| AC-13 | Promotion races with settings change | Other Owners/Admins eligible at originating commit are snapshotted under shared lock; later promotion has no backfill; Worker rechecks eligibility | Deterministic DB race |
| AC-14 | Revocation/demotion races with origin or delivery | Revoked/demoted candidate is not delivered; last-owner and active-org mirror rules hold; role/revoke does not produce inbox event | Deterministic race + route tests |
| AC-15 | Origin commits then enqueue/dispatcher fails | Committed intent and SQL ledger remain recoverable, including partial enqueue; no pending/failed visible item | Enqueue/crash/reconcile integration |
| AC-16 | Worker retries/crashes/attempts exhaust | At most one visible item per origin/recipient; `readAt` is preserved; exhausted work remains durably diagnosable/recoverable | Worker crash/replay tests |
| AC-17 | Typed tenant/account job or forged payload | `in-app-materialize` processes only committed claimed scope; no fake tenant or trust in payload; `notify-deliver` is not used | Worker/DB role scope tests |
| AC-18 | SQL executes with missing/wrong context | Tenant/account cross-scope reads/writes are denied by FORCE RLS; separate restricted ledger claim permits only claimed work; contexts clear after transaction | Runtime-role SQL tests |
| AC-19 | Intent/job/item/audit/error/log handling | No password/hash/reset token/MFA secret/backup code/session cookie; ledger holds only routing/claim metadata; errors do not leak internals | Sensitive-marker inspection |
| AC-20 | User has personal and Org A/B items while A active | List/count/UI show personal + A only; switch to B retains personal but not A; no other user sees either | Multi-user/org API and browser |
| AC-21 | No active Org or stale active-org mirror | List/count/mark-all remain personal-only after revalidation and mirror cleanup; old Org cursor fails; old Org item stays hidden | Revocation/context integration |
| AC-22 | Items share timestamp or arrive/expire during paging | `occurredAt DESC,id DESC` keyset has no duplicate/expired items; `nextCursor` null at end; count reflects each request | Pagination/concurrency tests |
| AC-23 | Cursor tampered, expired (>24h), or bound to another user/org/limit | 400 `INVALID_CURSOR`; token contains no credentials or content and cannot change scope | Cursor security tests |
| AC-24 | Read/unread/expired mix spans personal and Orgs | Badge/count include only current visible unread personal+active Org rows and update on read/expiry/switch | API and browser badge tests |
| AC-25 | User opens accessible item | `POST /open` atomically marks read and returns detail; repeated open keeps original `readAt`; no mutating GET detail | Open/detail integration/browser |
| AC-26 | User explicitly marks one item read twice | `PATCH /read` is idempotent and preserves first `readAt`; cannot mutate other user's or inaccessible item | API repeated/cross-scope tests |
| AC-27 | Mark-all races with insert or org switch | Only personal + bound active Org rows at operation are changed; other Org/new later rows untouched; repeated call reports 0 changed | Concurrent SQL/API test |
| AC-28 | Event age crosses 30 days before/after delivery | Expired items absent from list/count and cannot be opened/read even before cleanup | Frozen-clock expiry boundary |
| AC-29 | Authenticated user navigates shell | Top-right icon → popover → center → detail; server-backed badge/read controls and Owner/Admin settings work across reload | Browser end-to-end smoke |
| AC-30 | Loading, empty, content, denied and failure occur | UI distinguishes states; failure not empty; no fake sample item or denied content shown | Browser state matrix |
| AC-31 | Identity/org switches while older response remains inflight | Previous identity/tenant data cannot render or populate new context; cache/loaders follow confirmed boundary | Deferred-response browser race |
| AC-32 | Keyboard-only use of controls and overlays | Accessible names, visible/returned focus and operable actions; overlay focus follows design system | Keyboard/accessibility browser pass |
| AC-33 | Narrow viewport, 200% text zoom, light/dark themes | Popover/center/detail/settings content and actions remain visible and usable | Responsive/theme browser pass |
| AC-34 | Notification/settings API success and errors | Zod schemas, Hono OpenAPI, generated Web types and runtime parsing match `notification-api/1`; native Better Auth error shape unchanged | Contract/codegen/API integration |
| AC-35 | Origin/dispatch/Worker replays same business mutation | Stable identity/SQL uniqueness yield no duplicate item; no-op origin emits none; retry preserves `readAt` | Concurrent replay integration |
| AC-36 | Role/revoke route called via old or cutover entrypoint | No native bypass of shared lock/recheck; original permissions, last-owner and security events preserved; no notification generated by role/revoke | Route and concurrency tests |
| AC-37 | Organization/account domain rows are created/read | Tenant rows have verified `tenant_id` and FORCE RLS; account rows have verified `user_id` context, not TSQL-06 exemption; forged fields cannot alter scope | Migration/grants/runtime-role tests |

**Freeze binding:** All AC-01–AC-37 are frozen together as `draft:F-002-AC-1`, linked to the two candidate specs on line 4. Product Owner authored the criteria; the user explicitly selected “อนุมัติ freeze” for this candidate in the conversation; Technical Lead reviewed the same file and co-approved without changes. A new criterion or material scope change requires a new acceptanceVersion and Product Owner decision. Freeze is not implementation acceptance, release authorization, or outcome evidence.
