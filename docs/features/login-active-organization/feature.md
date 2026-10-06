# issue-82 Assign active organization ก่อนใช้งาน tenant app

| Field | Value |
| --- | --- |
| Identity / revision | issue-82 / 1 |
| Epic | None |
| Direction | ไม่ระบุใน assignment, parent requirement คือ issue #82 |
| Scope approved by user | 2026-10-06 ตาม assignment ของ Technical Lead |
| Spec / start approval | ผู้ใช้อนุมัติ spec และเริ่ม implementation 2026-10-06 ตาม assignment |
| acceptanceVersion | issue-82-AC-1 |
| Acceptance status | frozen, Technical Lead ยืนยัน freeze 2026-10-06 ตาม user approval |
| outcome_status | Not measured |

## Problem and scope

บัญชีที่มี membership อาจเห็นองค์กรจาก browser fallback แต่ server ยังไม่มี active organization ทำให้ header และ notification scope ต่างกัน Feature นี้ให้ server ตรวจและบันทึก active organization ก่อน tenant app usable โดยไม่สร้างสิทธิ์เพิ่ม

- In scope: valid last-active, deterministic fallback, account-global user/session mirrors, existing-session recovery, verified bootstrap, MFA safety และ server-confirmed scope ตาม P1–P8 ใน [spec.md](spec.md)
- Non-goals: เปลี่ยน membership/admission policy, สร้าง organization หรือ membership, auto-accept invitation, เปลี่ยน session lifetime/trust-device, widen notification scope, notification replay, Worker/monitor changes, bulk backfill, schema NOT NULL, redesign shell, merge/deploy/release
- เอกสารนี้กำหนด behavior เท่านั้น API, locking, technical verification และ task breakdown เป็นความรับผิดชอบ Technical Lead

## Outcome

ผู้ใช้ที่มี valid membership เข้า tenant app ด้วย active organization ที่ server ยืนยัน และ header กับ notifications ใช้ scope เดียวกัน ผู้ใช้ที่ไม่มี membership คง authenticated account/admission และไปต่อ invitation flow ได้โดยไม่เปิด tenant app

การสังเกต outcome ใช้ scenario AC-01–AC-08 ของ candidate โดย Technical Lead; ยังไม่มี runtime evidence หรือ baseline จาก production ไม่เสนอ numeric target, latency commitment หรืออ้างผลวัดแล้ว

## UI flow

ใช้ states และ components เดิม ไม่เสนอ UI redesign: [WorkspacePage.tsx](../../../apps/web/src/pages/WorkspacePage.tsx) (`WorkspacePage`, `AccessNeeded`), [AcceptInvitationPage.tsx](../../../apps/web/src/pages/AcceptInvitationPage.tsx) และ [Authentication behavior](../../ref/authentication.md) รายละเอียด technical bootstrap อยู่ใน spec

1. ผู้ใช้ผ่าน final authentication/verification ตาม flow เดิม รวม MFA completion เมื่อจำเป็น; pending/failed MFA ไม่ initialize selection
2. Verified bootstrap ตรวจ active organization ฝั่ง server ก่อน tenant prefetch/render คง valid last-active; null/stale เลือก membership ตาม `created_at ASC, organization.id ASC` และ sync account-global mirrors
3. มี valid membership: แสดง tenant app โดย header, badge, popover และ inbox ใช้ server-confirmed scope เดียวกัน องค์กรเดียวไม่ต้องกด switch เพื่อ initialize
4. ไม่มี valid membership: คง authenticated account/admission, ไม่ assign org ปลอม, ไม่เปิด tenant app ใช้ `AccessNeeded` และทางออกจากระบบเดิม; pending invitation ไป acceptance flow เดิมได้
5. โหลด/resolve ไม่สำเร็จ: แสดง error แยกจาก zero membership และลองใหม่ได้ ไม่แสดง empty tenant inbox แทนความล้มเหลว
6. รับ invitation สำเร็จ: คง explicit switch ไปองค์กรที่รับเชิญตาม flow เดิม แล้ว bootstrap อีกครั้ง; login fallback ไม่ override การเลือกนี้
7. Reload existing session หรือ context invalidation หลัง revoke/self-leave: resolve ใหม่โดยไม่บังคับ logout, เลือก membership ที่เหลือหรือกลับ admission ห้าม republish stale tenant data หลัง identity/scope change

| Screen | State | Behavior and recovery |
| --- | --- | --- |
| Account/bootstrap | Loading / unresolved | ใช้ loading state เดิม เช่น “กำลังโหลดข้อมูลองค์กร…”; ไม่ prefetch/render tenant; ไม่มี dialog ใหม่ |
| Account/bootstrap | Error | ใช้ error state เดิม “โหลดข้อมูลองค์กรไม่สำเร็จ” และ action “ลองใหม่”; retry bootstrap, คงทาง logout ตาม account flow; ไม่ตีความเป็น zero membership |
| Account/admission | Empty / Denied | ใช้ `AccessNeeded`: “ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร”, คำแนะนำให้เปิดลิงก์คำเชิญจากอีเมล และ “ออกจากระบบ”; คง account access และ invitation continuation, ไม่ให้ tenant access |
| Invitation | Pending / Denied / Error | คง verification, email-match, expiry, error และ logout recovery ของ `AcceptInvitationPage`; pending invitation ไม่ใช่ membership และไม่ auto-accept |
| Tenant | Success | แสดงองค์กรจาก server result เดียวกันใน header และ notifications; คง explicit switch เดิม |
| Tenant/bootstrap | Revoked / scope changed | ระงับการใช้ข้อมูล tenant เก่า, resolve ใหม่หรือ admission; ไม่คืนสิทธิ์องค์กรที่ถูกถอน |

Copy, focus และ keyboard ใช้ behavior ของ components/flows เดิม ไม่เพิ่มเกณฑ์นอก P1–P8: `AccessNeeded` มี heading focus หลัง self-leave, invitation error มี focus recovery เดิม, retry/logout/continuation ใช้ native button/link keyboard behavior ไม่มี dialog ใหม่ หากต้องออกแบบ admission flow ใหม่ให้ Technical Lead ส่ง UX Designer ก่อนเพิ่ม scope; เอกสารนี้ไม่อ้าง UX approval ใหม่

## Stories

- issue-82-S01 ผู้ใช้ที่ authenticated และมี membership เข้า tenant app ด้วย server-confirmed organization ทั้ง login ใหม่และ existing session, ตาม UI flow 1–3, 7; covers AC-01, AC-03, AC-04
- issue-82-S02 ผู้ใช้ที่ไม่มี membership อยู่ account/admission และรับ invitation ผ่านข้อจำกัดเดิมได้, ตาม UI flow 4–6; covers AC-02, AC-08
- issue-82-S03 ผู้ใช้ใช้ tenant และ notifications ใน scope ที่ยืนยัน แม้มี switch, session ใหม่ หรือ membership change พร้อมกัน และ recover จาก bootstrap error ได้, ตาม UI flow 3, 5, 7; covers AC-05, AC-06, AC-07

## Acceptance matrix

`acceptanceVersion: issue-82-AC-1`, status `frozen` ทุกแถว แปล P1–P8 แบบ 1:1 โดยไม่เพิ่ม requirements แถว Concurrency/Security และ Verification ถ่ายทอดจาก spec เดิมเพื่อ trace เท่านั้น Technical Lead เป็นเจ้าของ technical contracts และวิธีตรวจ ไม่ใช่ผล verification ของ Product Owner

| AC | Source | Category | Observable behavior | Verification จาก spec (ยังไม่รันในงานนี้) |
| --- | --- | --- | --- | --- |
| AC-01 | P1 | Scope / State | Login ที่มี valid remembered membership คง id; null/stale เลือก deterministic fallback และ persist user + sessions ก่อน tenant usable | Auth/me DB tests, cold login E2E |
| AC-02 | P2 | Authorization / State | ไม่มี valid membership ไม่ assign org ปลอม; คง authenticated account/admission และ pending invitation ไป acceptance ได้ตาม UI flow | Admission/signup/acceptance tests |
| AC-03 | P3 | State | Existing null session และ mirror drift converge โดยไม่ logout; GET context คง read-only | Me integration tests, reload E2E |
| AC-04 | P4 | Authorization / State | MFA pending/failed/expired ไม่เปลี่ยน selection ของบัญชีหรือ session อื่น; TOTP/recovery/trusted-device สำเร็จ resolve ได้ | Real Better Auth DB integration tests |
| AC-05 | P5 | Concurrency (Technical Lead) | Concurrent login/switch/new-session/revoke/leave ไม่มี deadlock, stale overwrite หรือ removed-org authorization | Barrier-controlled DB races, final user/session assertions |
| AC-06 | P6 | Authorization / Security (Technical Lead) | Badge/popover/inbox scope ตรง header; null/account-only ไม่ widen; foreign recipient/tenant deny ภายใต้ runtime RLS | Notification service/routes DB tests, negative role/RLS tests |
| AC-07 | P7 | State | Unresolved/error/admission ไม่ prefetch/render tenant; stale response ไม่ republish หลัง identity/scope change | TenantProvider/loaders tests, switch/multi-tab E2E |
| AC-08 | P8 | Out of scope | Session duration, fresh-auth, cookie, return-to และ invitation restrictions คงเดิม | Existing auth regression suites, security/codegen gates |

## Approved decisions

แหล่ง approval คือ assignment ของ Technical Lead ซึ่งยืนยันผู้ใช้อนุมัติ 2026-10-06 ไม่ใช่สถานะเก่าใน issue/spec

| Decision | Approved behavior | AC |
| --- | --- | --- |
| ไม่มี membership | คง authenticated account/admission และ invitation continuation ไม่ปฏิเสธ login เพราะไม่มี membership | AC-02, AC-07 |
| Assignment boundary | Verified bootstrap ก่อน tenant usable; raw auth success ไม่จำเป็นต้อง persist selection ก่อน response | AC-01, AC-04, AC-07 |
| Fallback | คง valid last-active; fallback ตาม membership `created_at ASC`, `organization.id ASC` | AC-01 |
| Selection scope | คง account-global user/session mirrors | AC-01, AC-03, AC-05 |
| Invitation acceptance | คง explicit switch ไปองค์กรที่รับเชิญตาม behavior เดิม | AC-02, AC-05, AC-08 |
| UI boundary | ใช้ account/admission states เดิมถ้าเป็นไปได้ พร้อม retry/logout/invitation continuation; ไม่ redesign | AC-02, AC-07 |

## Open decisions

None สำหรับ product decisions ที่ assignment ยืนยันแล้ว Direction reference ไม่ได้ระบุและไม่ถือเป็น approval ที่สร้างขึ้นใหม่

## Dependencies and readiness

| Predecessor | Dependent item | Required input | Owner | Ready condition |
| --- | --- | --- | --- | --- |
| User approval 2026-10-06 (confirmed by assignment) | Feature handoff | Approved scope/spec/start และ decisions ข้างต้น | ผู้ใช้ | ได้รับตาม assignment; ไม่ใช่ release approval |
| Frozen matrix issue-82-AC-1 | Spec trace / acceptance freeze | P1→AC-01 ถึง P8→AC-08 และ approval ที่ยืนยัน | Technical Lead | Parent freeze และ reconcile metadata/spec trace แล้ว 2026-10-06; Product Owner ไม่แก้ spec |
| Existing UI states (inspected evidence) | Bootstrap UI integration | Reuse loading/error/AccessNeeded/invitation continuation | Technical Lead | ยืนยัน reuse ใน implementation; UX Designer ร่วมออกแบบเฉพาะเมื่อมี flow ใหม่ |

Product behavior frozen โดย parent 2026-10-06; ไม่ใช่ implementation verification หรือ release approval ความเสี่ยงทางเทคนิคเรื่อง final-auth hook ordering, session races, lock graph, RLS และ cache publication ต้องตรวจตาม spec โดย Technical Lead ไม่เพิ่ม product blocker หรือ estimate ใหม่

## Evidence and revisions

- อ่าน issue [#82](https://github.com/nixbpe/new-nightwatch/issues/82) ผ่าน `gh issue view`: requirement, proposed scope, non-goals และ P1–P8 reference; issue body ณ historical inspection ยังระบุ Draft proposal
- Historical snapshot ก่อน parent freeze: อ่าน [spec.md](spec.md) P1–P8 และ contracts เมื่อ metadata/Open decisions ยังเป็น Draft/Not yet; ไม่ใช่สถานะ approval ปัจจุบัน
- อ่าน UI sources และ authentication reference ที่ลิงก์ข้างต้น: พบ loading/error/retry, `AccessNeeded` logout/invitation guidance และ invitation verification/email-match behavior เดิม ไม่อ้างว่า runtime ผ่านแล้ว
- 2026-10-06: revision 1, แปล P1–P8 เป็น draft AC-01–AC-08 ตาม assignment, scope/spec/start approval ตามการยืนยันของ parent; historical snapshot ก่อน parent freeze

- 2026-10-06: Technical Lead ACCEPTED และ FROZEN `issue-82-AC-1`, metadata/readiness reconciled; ไม่เปลี่ยน AC behavior
