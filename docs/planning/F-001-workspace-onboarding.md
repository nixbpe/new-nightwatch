# F-001: Authorized workspace onboarding

## 1. Current state

| Field | Value |
| --- | --- |
| id | F-001 |
| parent | [E-001](E-001-authentication-authorization-onboarding.md) |
| product_direction | [DIR-001](../product-direction.md) — Direction Approved เฉพาะ unchanged direction scope; historical approval provenance อยู่ใน Direction §1 |
| product_design | ยังไม่มี standalone Product Design Document (PDD); current design inputs อยู่ใน §5/§7 โดยคง Accepted และ U2 Proposed ตามเดิม การ migration นี้ไม่ได้สร้างหรืออนุมัติ design candidate และไม่เพิ่ม blanket prerequisite |
| delivery_status | Refining |
| outcome_status | Not measured |
| spec_acceptance | Not demonstrated |
| delivery_owner | Unknown |
| acceptance_execution | AC1–AC16: Not exercised |
| execution_authorization | ไม่มีการอนุญาต implementation หรือ release |

เอกสารนี้เป็น requirements source ของ Feature. `Accepted` คือข้อกำหนดที่ต้องรักษา; `Proposed` ยังไม่ใช่ implementation contract ที่ยอมรับแล้ว. ข้อกำหนดใช้ semantic IDs; R/FL/AC ระบุกฎ flows และ acceptance criteria.

References: [Architecture](../architecture.md) §3/§5/§7/§8/§10 และ [Design system](../design-system.md). ข้อกำหนดที่ไม่ได้ระบุซ้ำให้ใช้ references เหล่านี้; T1/U2 ไม่แทนที่ accepted contracts.

## 2. Outcome and scope

**ผู้ใช้:** provider Platform/SRE operator, platform admin และผู้ปฏิบัติการที่ได้รับ recovery CLI access.

**ผลลัพธ์:** ผู้รับเชิญ activate/sign-in เข้า Organization และ Projects ที่มีสิทธิ์ เข้าใจ active scope และทำ operation ตาม role โดยไม่เปิด protected data ข้าม scope หรือใช้ recovery ข้าม MFA.

**In scope:** Organization provisioning, invitations/activation, password/Entra sign-in/linking, sessions/sign-out, MFA enrollment/challenge/policy/recovery, password reset, Project CRUD/grants, scoped UI, persistence/RLS และ audit ที่จำเป็น. Transactional invitation/recovery email อยู่ใน scope.

**Out of scope:** self-service Organization creation, public signup ที่ให้ access อัตโนมัติ, Organization-owner invitation UI, membership/team-management suite, implicit all-project access, remembered devices, Project restore, account deletion/email-change suite, AWS connection/collection/ranking, notifications/report suite, assignment/tickets และ autonomous cloud actions. ไม่มี lost-mailbox recovery bypass. ไม่เพิ่ม generic queue/worker scaffolding เพื่อ transactional email.

## 3. Requirements — Accepted

### Identity and access

| ID | Requirement |
| --- | --- |
| ORG-PROVISION | Organization provisioning ใช้ platform-admin UI; ไม่เปิด self-service creation |
| AUTH-METHODS | รองรับ email/password และ Microsoft Entra sign-in |
| PROJECT-VISIBILITY | Organization member เข้าถึงเฉพาะ Projects ที่มี grant |
| ROLE-LIMITS | Role กำหนดเพดาน operation ตาม permission matrix; create เป็น Organization-scoped operation ส่วน existing Project ต้องมี grant |
| MFA-POLICY | เก็บ force MFA ใน DB ระดับ Organization; platform admin ต้อง MFA เสมอ |
| MFA-DEFAULT | Organization ใหม่มี force MFA=true |
| MFA-POLICY-ACTOR | เฉพาะ platform admin เปลี่ยน Organization force MFA |
| ENTRA-TENANTS | Entra รองรับหลาย allowlisted tenants; sign-in ไม่สร้าง membership/grants อัตโนมัติ |
| IDENTITY-LINKING | Linking ต้องพิสูจน์การควบคุมทั้งสองช่องทาง; email ตรงกันไม่ใช่ linking authority |

### Lifecycle and security

| ID | Requirement |
| --- | --- |
| INVITE-ACTIVATION | Platform admin เชิญ ผู้รับ activate เองโดยตั้ง password หรือพิสูจน์ allowed Entra identity; admin ไม่รู้ password |
| PASSWORD-RESET-ACTOR | เฉพาะ platform admin เริ่ม password reset ไป verified email เดิม; ไม่ตั้ง password แทนและไม่ข้าม MFA |
| SESSION-LIFETIME | Session มี absolute lifetime 24h จาก sign-in และ idle timeout 8h; เงื่อนไขใดถึงก่อนหมดอายุก่อน; activity ไม่เลื่อน absolute deadline |
| SIGN-OUT | Sign-out revoke current NightWatch server session และ clear local auth/tenant data; ไม่ใช่ global Entra logout |
| MFA-PROOF | MFA proof ใช้เฉพาะ current session; session ใหม่พิสูจน์ใหม่ และ MFA-RESET-AUTHORITY ต้อง fresh proof สำหรับ operation; ไม่มี remembered-device bypass |
| MFA-RECOVERY-METHODS | มี single-use recovery codes สำหรับ MFA challenge และ admin-assisted reset; การใช้ code ไม่ใช่ factor reset/replacement |
| MFA-POLICY-EFFECT | Force MFA ที่เปิดมีผลกับ protected request ถัดไปของ Organization; ไม่ revoke sessions/สิทธิ์ของ Organization อื่น |
| GRANT-AUTHORITY | Platform admin ให้/ถอน grant ผ่าน narrow operation; Organization owner ทำได้เฉพาะ Project ที่ตนมี grant. Recipient ต้องเป็น active same-Organization member; grant ไม่ยก role หรือเปลี่ยนสิทธิ์ Organization อื่น |
| PROJECT-CREATE | Create Project และ creator grant commit ใน transaction เดียว; ไม่ให้ grants แก่สมาชิกอื่นอัตโนมัติ |
| MFA-RESET-AUTHORITY | Ordinary-user MFA reset เริ่มโดย platform admin คนเดียวที่พิสูจน์ fresh TOTP สำหรับ operation นี้; session proof เดิมไม่พอ. Platform-admin account reset เริ่มผ่าน CLI เท่านั้น; ต้องมี verified-email proof, audit, revocation และ re-enrollment ไม่มี permanent bypass |
| PASSWORD-RESET-EFFECT | Password-reset success revoke ทุก NightWatch session ของบัญชี รวม linked Entra sessions; ไม่เปลี่ยน TOTP/membership/grants |
| PROJECT-DELETE | Project ใช้ soft delete: เอาออกจาก workspaceและ deny access เก็บ UUID/tombstone สำหรับ identity/audit; ไม่มี restore และไม่ถือว่าลบข้อมูลทุกสำเนา |
| INVITE-TOKEN | Invitation อายุ 24h ใช้ครั้งเดียว; platform admin resend แล้ว predecessor ใช้ไม่ได้; expired invitation ไม่ activate membership |
| RECOVERY-TOKENS | Password-reset และ MFA-recovery links อายุ 30m ใช้ครั้งเดียวและแยก purpose; ใช้ข้ามกันไม่ได้ |
| MFA-RECOVERY-CLI | Platform-admin recovery CLI ส่งลิงก์ไป verified email เดิม ไม่รับ email replacement/แสดง token ใน terminal; ต้อง enroll factor ใหม่ก่อน platform access |
| INVITE-AUTHORITY | เฉพาะ platform admin สร้าง Organization/เชิญ initial owner และเชิญสมาชิกเพิ่ม/เลือก invitation role; invitation ไม่ให้ Project grants |
| PROJECT-NAME | Active Project name ไม่ซ้ำใน Organization หลัง trim หัวท้ายและเทียบแบบ case-insensitive; cross-Organization ซ้ำได้; reuse ชื่อหลัง soft delete ได้ด้วย UUID ใหม่ |
| ACCESS-LOSS | เมื่อ auth/context หมดสิทธิ์ ให้ clear protected data ของ scope นั้นและคง no-data error screen พร้อม action sign-in/เลือก Organization; ไม่ auto-redirect/switch |
| AUDIT-RETENTION | Audit ของ auth/provisioning/grants/MFA/Project changes และ denials เก็บ 180 วัน; read path ไม่คืน expired entries และ maintenance ลบเกินอายุ; ไม่เก็บ passwords/tokens/TOTP secrets |
| NAME-CONFLICT | Name conflict แจ้งเพียงชื่อใช้ไม่ได้; ไม่คืน hidden Project ID/details/owner/grant list/link. ยอมรับ name-availability inference ไม่อ้างว่าปิด name-existence oracle |
| MFA-RESET-CUTOVER | การส่ง MFA-recovery link ยังไม่เพิกถอนของเดิม. เมื่อผู้ใช้ยืนยัน valid token สำเร็จ ให้ revoke ทุก session/proof/factor/recovery-code generation เดิม รวม linked-provider sessions; เหลือ recovery-only context ไม่มี protected accessจนยืนยัน factor ใหม่ |
| SESSION-ACTIVITY | Idle activity นับเฉพาะ foreground interaction ที่ server ยอมรับ; polling/background refresh ไม่ต่อ idle และ browser timestamp ไม่เป็น authority. Passive reading อาจหมด idle แม้ network ทำงาน |
| PASSWORD-RESET-EXIT | Password-reset success แสดงผลสำเร็จ/action ให้ sign-in เอง; ไม่ออก session ใหม่หรือ redirect อัตโนมัติ; credentials/MFA ต้องพิสูจน์ใหม่ |

### ERROR-CONTRACT — Error contract

`AppError(status, code, message, details?)` เป็น accepted constructor order: `status` คือ HTTP status, `code` เป็น machine-readable code, `message` และ optional `details` ต้อง display-safe. Response envelope คือ `{ error: { code, message, details? } }`.

[Implementation](../../packages/shared/src/errors.ts) ยังใช้ `AppError(code, message, statusCode, details?)`. ต้อง migrate constructor/callsites/affected tests พร้อมกันโดยไม่มี compatibility overload เมื่อมี implementation assignment; constructor order ไม่ใช่ open decision.

## 4. Authorization and state rules

| ID | Rule |
| --- | --- |
| R1 | Tenant operation ตรวจ session → verified membership → operation role → Project grant/parent scope. MFA ไม่ทดแทน authorization; Organization คือ tenant boundary |
| R2 | API tenant candidate: route `orgId` → `X-Org-ID` → earliest membership by `created_at` แล้ว verify. Body/browser selection ไม่เป็น authority. Initial web context: valid in-memory → valid `lastActiveTenantId` → first membership |
| R3 | Switch หลัง `PATCH /me/active-org` success; update router snapshot, reset selected Project, clear scoped queries และ block stale/in-flight responses. Initial fallback ไม่ใช่ auto-recovery หลัง denial |
| R4 | Membership ไม่ให้ implicit Project access; role และ grant ต้องผ่านทั้งคู่. Create ไม่ต้องมี grant ก่อน Project เกิด; existing Project ใช้ permission matrix |
| R5 | Platform role ไม่ใช่ global tenant bypass. Provisioning/invitation/policy/grant/reset ใช้ narrow operations; Project CRUD ผ่าน tenant membership/role/grant ตามปกติ |
| R6 | Protected request ใช้ force policy ของ Organization ที่ร้องขอและ server-session MFA proof; non-force Organization ไม่ใช้ข้าม force gate. Platform admin ต้อง MFA และ fresh initiating-admin proof สำหรับ MFA-RESET-AUTHORITY |
| R7 | Session/recovery transitions ใช้ SESSION-LIFETIME/SIGN-OUT/MFA-PROOF/MFA-RESET-AUTHORITY/PASSWORD-RESET-EFFECT/MFA-RESET-CUTOVER/SESSION-ACTIVITY/PASSWORD-RESET-EXIT; expiry/revocation ไม่ฟื้นจาก stale response หรือ cached proof; reset ไม่เปลี่ยน membership/grants |
| R8 | Tenant queries ใช้ supplied transaction, transaction-local `app.tenant_id`, tenant/Project predicates และ `USING`/`WITH CHECK`/`FORCE RLS`. Runtime เป็น non-owner `NOBYPASSRLS`; owner สำหรับ DDL; pre-tenant/CLI privileges จำกัด scope ไม่ใช้ runtime superuser |
| R9 | Email match/allowlist/invitation email ไม่ให้ merge identity หรือ grants. Entra authentication ไม่แทน NightWatch TOTP ที่ policy บังคับ |
| R10 | Tokens ผูก server-stored purpose/recipient/scope และใช้ตาม TTL/single-use rules. Password reset เปลี่ยน credential ที่มีอยู่; Entra-only ต้องผ่าน FL8/IDENTITY-LINKING ก่อนเพิ่ม password แรก ไม่ใช้ reset link แทน existing Entra proof |
| R11 | Soft-deleted Project deny list/detail/mutation/grant paths. UUID/tombstone ไม่ reuse เป็น Project ใหม่ และ grants เดิมไม่ให้สิทธิ์ UUID ใหม่ |
| R12 | Invalid session→401; denied membership/operation→403; foreign-parent Project→not-found ตาม Architecture §10. ไม่คืน protected data; redacted denial audit. Exact domain/MFA errors ส่วนที่เหลืออยู่ T1 |
| R13 | แยก loading/pending/empty/restricted/failure/success. Denial ใช้ ACCESS-LOSS; validation/network failure ไม่เป็น permission loss อัตโนมัติ. เก็บ non-secret input เฉพาะ scope ที่ยังมีสิทธิ์ ไม่เก็บ protected draft หลัง revocation/ย้ายข้าม Organization |
| R14 | Empty/no Project/no observations ไม่ใช่ assessment success/safety; unknown/stale ไม่แสดงว่า current/healthy. ไม่บังคับ business-criticality; audit ใช้ AUDIT-RETENTION |

### Permission matrix

| Operation | Platform admin | Organization owner | Organization admin | Viewer/auditor |
| --- | --- | --- | --- | --- |
| Create Organization/invite/select invitation role | Narrow admin path + MFA | ไม่ได้ | ไม่ได้ | ไม่ได้ |
| Change Organization force MFA | ได้ + MFA | ไม่ได้ | ไม่ได้ | ไม่ได้ |
| Create Project | ต้องมี Organization owner/admin role | ได้ + creator grant | ได้ + creator grant | ไม่ได้ |
| Read/update Project | ผ่าน tenant role/grant | มี grant: read/update | มี grant: read/update | มี grant: read เท่านั้น |
| Soft delete Project | Platform flag อย่างเดียวไม่พอ | ได้เมื่อมี grant | ไม่ได้ | ไม่ได้ |
| Give/revoke grants | Narrow admin path ใน tenant ที่เลือก | Project ที่มี grant | ไม่ได้ | ไม่ได้ |
| Start password reset | Verified email เดิม | ไม่ได้ | ไม่ได้ | ไม่ได้ |
| Start ordinary-user MFA reset | Initiating admin: fresh TOTP + audit/email recovery | ไม่ได้ | ไม่ได้ | ไม่ได้ |
| Start platform-admin MFA reset | Recovery CLI เท่านั้น | ไม่ได้ | ไม่ได้ | ไม่ได้ |

## 5. Flows

สถานะในตารางเป็น semantic states ไม่ใช่ approved schema enums.

| ID / requirements | Entry → success | Alternate/error boundary |
| --- | --- | --- |
| FL1 / ORG-PROVISION/MFA-DEFAULT,INVITE-ACTIVATION/INVITE-AUTHORITY | MFA-verified platform admin สร้าง Organization/เชิญ initial owner หรือสมาชิกเพิ่ม | Delivery failure ไม่ claim sent/active; admin resend ตาม INVITE-TOKEN |
| FL2 / ENTRA-TENANTS/INVITE-ACTIVATION/INVITE-TOKEN | ผู้รับพิสูจน์ bound identity ผ่าน valid invitation แล้วตั้ง password/ใช้ allowed Entra ก่อน membership active | Expired/used/superseded/wrong-recipient ไม่ activate; ให้ admin resend. Existing account ต้องพิสูจน์ control ไม่ duplicate/auto-link ด้วย email |
| FL3 / AUTH-METHODS,SESSION-LIFETIME/SIGN-OUT/MFA-PROOF,R1/R6 | Valid credentials → server session → expiry/membership check → MFA gate ก่อน protected access | Credential failure ไม่เผย secret/account detail; authenticated/no-membership ไม่ให้ customer access; invalid session ใช้ R12/ACCESS-LOSS |
| FL4 / MFA-POLICY/MFA-PROOF/MFA-RECOVERY-METHODS | Enroll/confirm TOTP ก่อน factor active และออก recovery codes; valid TOTP/unused code สร้าง current-session proof | Invalid/reused code ไม่สร้าง proof/reset factor. Required แต่ยังไม่ผ่าน: เห็นเฉพาะ enrollment/challenge. ไม่เพิ่ม optional MFA-settings UI |
| FL5 / PROJECT-VISIBILITY/ACCESS-LOSS,R2/R3/R6 | โหลด `/me/context`, resolve initial scope/list granted Projects; switch หลัง PATCH และ target gate สำเร็จ | Pending แยก target B จาก active context; ไม่แสดง A ใต้ป้าย B. PATCH failure ไม่พิสูจน์ว่า A หมดสิทธิ์; actual denial clear ตาม ACCESS-LOSS; late response ไม่ฟื้นข้อมูล |
| FL6 / ROLE-LIMITS,PROJECT-CREATE/PROJECT-DELETE/PROJECT-NAME/NAME-CONFLICT,R11 | Owner/admin create+creator grant; granted read/update; owner soft delete | Conflict ใช้ NAME-CONFLICT ไม่เกิด partial Project/grant; hidden/foreign/deleted deny; delete success เอาออกจาก workspace ไม่มี restore; pending/error ไม่ใช่ success |
| FL7 / GRANT-AUTHORITY,R4/R5 | Platform admin/granted owner ให้ถอน grant แก่ active same-Organization member | Admin/viewer/auditor/ungranted owner ทำไม่ได้; protected request ใหม่หลัง revoke deny. Clear stale cache เมื่อทราบ denial ไม่เพิ่ม push/polling |
| FL8 / IDENTITY-LINKING,R9/R10 | พิสูจน์ existing account และ target identity ทั้งคู่แล้ว link โดยไม่เพิ่ม membership/grants | Unverified/cancel/provider failure/email-only ไม่ link; identity บัญชีอื่นไม่ย้ายอัตโนมัติ; ไม่ลด MFA |
| FL9 / IDENTITY-LINKING,PASSWORD-RESET-ACTOR/PASSWORD-RESET-EFFECT/RECOVERY-TOKENS/PASSWORD-RESET-EXIT | Admin ส่ง link ให้ existing-password account; valid reset commit เปลี่ยน password/revoke sessions; success/action manual sign-in | Expired/used/wrong-purpose ไม่ reset; admin เริ่มใหม่. Entra-only ไม่เพิ่ม credential ผ่าน reset; ไม่เปลี่ยน TOTP/grants ไม่สร้าง session/redirect |
| FL10 / MFA-RECOVERY-METHODS/MFA-RESET-AUTHORITY/RECOVERY-TOKENS/MFA-RECOVERY-CLI/MFA-RESET-CUTOVER | Ordinary-user reset เริ่มด้วย initiating-admin fresh TOTP; platform-admin reset เริ่ม CLI; token confirmation → revoke old state → recovery-only → confirm new factor | ส่ง link ยังไม่ revoke; invalid token ไม่ cutover. Recovery code challenge อยู่ FL4 ไม่ใช่ reset. Lost mailbox ไม่มี bypass; ไม่มี email replacement/terminal token |
| FL11 / MFA-POLICY/MFA-DEFAULT/MFA-POLICY-ACTOR/MFA-POLICY-EFFECT | Platform admin เปลี่ยน force flag/audit; true บังคับ proof บน request ถัดไป | ไม่มี proof ต้อง challenge ก่อน customer data; false ไม่สร้าง proof/ยกเว้น platform admin; ไม่ revoke unrelated Organization |
| FL12 / SESSION-LIFETIME/SIGN-OUT/ACCESS-LOSS/SESSION-ACTIVITY | Current-session revoke/local clear หรือ expiry deny; valid sessions เครื่องอื่นยังอยู่ | Server sign-out failure ไม่ claim revoke success/no protected data บน failure screen; passive reading อาจหมด idle; ไม่ global Entra logout |

## 6. Acceptance criteria

**Execution status: Not exercised ทุกข้อ.** Methods เป็นแผนพิสูจน์ ไม่ใช่ผลทดสอบ; technical oracles ที่ขึ้นกับ T1/U2 ต้องใช้ accepted contracts.

| ID / requirements | Observable acceptance | Verification method |
| --- | --- | --- |
| AC1 / R1/R12 | Invalid/expired→401; denied membership/operation→403; ไม่มี protected data มี redacted audit; role/grant/MFA ไม่ทดแทนกัน | HTTP/browser พร้อม permitted positive control และ invalid/revoked cases |
| AC2 / R2 | Route/header/body conflict ไม่เปลี่ยน authority; API/web precedence ถูก ไม่เลือก invalid lastActive | Cases ที่ candidate แต่ละตัวให้ผลต่างกันจริง |
| AC3 / PROJECT-VISIBILITY/ROLE-LIMITS/GRANT-AUTHORITY/PROJECT-CREATE,R4/R5 | Ungranted member อ่านไม่ได้; role matrix บังคับ; admin delete ไม่ได้; viewer/auditor mutate ไม่ได้; atomic create ให้ grant เฉพาะผู้สร้าง | Browser/API/SQL: tenant A/B, granted/ungranted และ rollback |
| AC4 / R3/ACCESS-LOSS,FL5 | Switch A→B แล้ว delayed A ไม่กลับใน B; Project selection/reset ถูก; failure ไม่ถือ B active และ denied scope ไม่มีข้อมูล | Browser delayed-response/failure injection |
| AC5 / PROJECT-DELETE/PROJECT-NAME/NAME-CONFLICT,R11 | Name uniqueness/cross-Organization duplicate/concurrent create ถูก; conflict ไม่คืน hidden data; deleted deny ทุก path; reuse ชื่อเป็น UUID ใหม่ไม่ inherit grants | Concurrent DB/API และ browser lifecycle รวม collision กับ ungranted Project |
| AC6 / R8 | Non-owner ทำ allowed operations ได้ แต่ tenant/foreign parent/missing context/connection reuse ไม่ทำให้ cross-scope read/write | Dedicated PostgreSQL actual roles พร้อม positive/negative cases; owner connection/mocks ไม่ใช่ RLS proof |
| AC7 / ORG-PROVISION/MFA-DEFAULT,INVITE-ACTIVATION/INVITE-TOKEN/INVITE-AUTHORITY | Admin UI สร้าง force=true Organization/ส่ง invite; activation ตาม membership จริง; invalid/superseded recipient/token ไม่ activate; delivery failure ไม่ claim success | Actual UI/API/email sink/synthetic identities |
| AC8 / AUTH-METHODS/ENTRA-TENANTS/IDENTITY-LINKING,SESSION-LIFETIME/SESSION-ACTIVITY | Password/allowed Entra ได้; disallowed tenant ไม่สร้าง authorized session; linking พิสูจน์สองฝ่าย; cookies ตาม Architecture §3; lifetime/foreground idle enforce ไม่มี background extension | Configured IdP/browser, same-email/different-identity และ deterministic clock/foreground-vs-background/expiry boundaries |
| AC9 / MFA-POLICY/MFA-DEFAULT/MFA-POLICY-ACTOR,MFA-PROOF/MFA-RECOVERY-METHODS/MFA-POLICY-EFFECT,R6 | Force Organization/platform ต้อง proof; TOTP/unused code สร้าง current-session proof ไม่ reset factor; session ใหม่ไม่ reuse; current policy enforce ข้าม Organization ไม่ได้ | Force on/off, multi-Organization, invalid/replayed codes และ policy transitions |
| AC10 / R3/R13/R14,ACCESS-LOSS | Loading/pending ไม่เป็น empty/success; no-membership แยก no-granted-Projects ไม่อ้างว่า Organization ไม่มี Projects. Denial clear/no-data/actions; late response ไม่ฟื้น; validation/transport failure ไม่เป็น permission loss; unknown ไม่ claim current/safe | Browser states, revoked membership/grant และ delayed response หลัง denial |
| AC11 / R13,§7 | Keyboard/focus/labels/field errors/non-color meaning ใช้ได้; contrast/targets/themes/narrow/200% text ผ่าน; retention เฉพาะ authorized input และ pending กัน duplicates | Actual keyboard/assistive technology/rendered states; U2 oracles เมื่อยอมรับแล้ว ไม่อ้าง WCAG pass จาก prose |
| AC12 / AUDIT-RETENTION,R12/R14,ERROR-CONTRACT | Safe error envelope/unknown error ไม่เผย internals; changes/denials trace ได้ไม่มี secrets; expired audit ไม่คืนและถูก maintenance ลบ | Synthetic success/failure/audit fixtures และ retention boundary/maintenance |
| AC13 / IDENTITY-LINKING,PASSWORD-RESET-ACTOR/PASSWORD-RESET-EFFECT/RECOVERY-TOKENS/PASSWORD-RESET-EXIT,R10 | Existing-password reset commit เปลี่ยน credential/revoke all ไม่เปลี่ยน TOTP/grants; Entra-only ไม่เพิ่ม password ผ่าน reset; replay ไม่สำเร็จ; success มี manual sign-in ไม่มี session ใหม่/redirect | Actual email/API/browser, linked Entra/Entra-only, concurrent replay/old-credential issuance และ post-reset screen |
| AC14 / MFA-RECOVERY-METHODS/MFA-RESET-AUTHORITY/RECOVERY-TOKENS/MFA-RECOVERY-CLI/MFA-RESET-CUTOVER | Fresh initiating-admin TOTP จำเป็น; platform-admin reset CLI-only; sending ไม่ revoke แต่ confirmation cutover/recovery-only จน factor ใหม่ยืนยัน; old states ใช้ไม่ได้; token purpose/TTL/single-use/no replacement/output ถูก; code challenge ไม่ reset | Separate CLI/app roles/email/audit; before/after cutover, expiry/replay, recovery-context denial และ fresh-proof binding |
| AC15 / GRANT-AUTHORITY,R4/R5 | Granted owner/platform ให้ถอน same-Organization active-member grant ได้; unauthorized actor ไม่ได้; grant ไม่เกิน role; new request หลัง revoke deny | Actual API/SQL/UI roles และ concurrent removal ตาม accepted T1 |
| AC16 / SESSION-LIFETIME/SIGN-OUT,R7 | Signed-out session ใช้ protected API ต่อไม่ได้/local clear; valid เครื่องอื่นยังอยู่; stale response ไม่ฟื้น expiry; failed sign-out ไม่ claim revocation | Two browser sessions/server API/expiry/failure; ไม่ global Entra logout |

## 7. UX and data boundaries

### Accepted

- ใช้ persistent labels, field-level errors, visible pending และ duplicate prevention. Retain input ตาม R13; name conflict ทั้ง visible/accessibility descriptions ใช้ NAME-CONFLICT ไม่เติม metadata จาก backend.
- Lost response ไม่พิสูจน์ว่า operation สำเร็จหรือไม่เกิดขึ้น; token retry/secret-field lifecycle ต้องตรง accepted T1 ไม่ auto-resend/retry.
- Keyboard: logical order, visible focus, meaningful names, ไม่พึ่งสี/hover/placeholder. Text contrast ≥4.5:1; essential controls/focus ≥3:1 รวม primary button; targets ≥24×24 px หรือ equivalent spacing.
- ทั้งสอง themes, narrow layout และ 200% text enlargement ต้องไม่ทำ labels/actions หาย. ใช้ modal focus containment/restore, reduced motion และ collapsed-navigation rules เฉพาะ surface ที่มี.
- Passwords/TOTP/recovery codes ไม่ลง URL/storage/log; redact bearer links จาก request logging/audit. Narrow platform metadata access ไม่ให้ implicit findings/Project-data access.
- Audit180d ไม่กำหนด account deletion, tombstone purge หรือ AWS history retention.

### U2 — Proposed UX contract

ยังไม่เป็น accepted interaction/oracle:

1. MFA-pending switch แสดง target ที่ต้องยืนยัน ไม่ใช่ workspace พร้อมใช้; กัน switch ซ้ำระหว่าง pending ไม่ auto-switch/retry. Dirty-form exit แจ้งก่อนทิ้ง input; failed switch คง authorized input ใน A ไม่ย้ายไป B/เพิ่ม persistent draft storage.
2. Unknown result แสดงว่าผลยังยืนยันไม่ได้; recovery action ตรง FL2/FL9/FL10 ไม่เสนอ retry ที่ทำให้ expired token กลับ valid. ไม่เพิ่ม countdown/delivery receipt/email-edit capability.
3. Associate labels/errors programmatically; status announcement สำหรับ pending/result และ alert สำหรับ urgent errors โดยไม่ประกาศซ้ำ. เมื่อ denial ถอด focused control ให้ focus ไป named no-data heading ไม่ทำ sign-in/switch เอง; pending รับรู้ได้โดยไม่ย้าย focus ไม่ประกาศ secrets/hidden metadata.

## 8. T1 — Proposed technical contract

T1 ยังไม่ accepted ยกเว้น ERROR-CONTRACT. ข้อเสนอไม่ยืนยันว่า schema/library/environment พร้อมใช้งาน.

### Data and concurrency

- Direct `project_grants(tenant_id, project_id, membership_id)` มี unique key และ composite FKs ไป unique parent pairs `projects(tenant_id,id)`/`memberships(tenant_id,id)`. Parent identity immutable; membership ID ใช้ auth contract ไม่สมมติ UUID.
- One active membership ต่อ tenant/user; grant ไม่มี role สำเนา/global-user/team inheritance. ตรวจ current role/active membership/direct grant/active Project; new membership identity ไม่รับ grants เดิม. Reactivation carry-over ต้องกำหนดหากเปิด transition นั้น ไม่เพิ่ม membership UI.
- Create ตรวจ creator membership และ insert Project+grant ใน supplied transaction; response หลัง commit. Soft delete คง UUID/tombstone; candidate physical deletion ใช้ RESTRICT/NO ACTION ไม่ใช้ audit retention เป็น purge policy.
- Partial unique `(tenant_id,name_key)` เฉพาะ active rows ตัดสิน create/rename races; map เฉพาะ constraint นี้เป็น safe name conflict. ต้องกำหนด trim whitespace set/Unicode normalization/collation-version ไม่ลดเป็น ASCII-only.
- Lock membership rows ที่เกี่ยวข้องตาม ID order ก่อน Project row แล้ว recheck authorization. Create/role changes ใช้ membership-lock protocol; grant/revoke/update/delete ใช้ Project-row lockร่วม. ผลตาม serialization ไม่ใช่ arrival order; request ใหม่หลัง revoke/delete commit deny ไม่ย้อนคืน bytes ที่ตอบแล้ว. ไม่เพิ่ม last-owner restriction/creator permanent access.
- Tenant RLS ตาม R8 ป้องกัน cross-Organization ไม่แทน Project predicates ใน service SQL. Narrow platform path ตรวจ authorityก่อน selected-tenant transaction ไม่ต้องมี Org membershipแต่ไม่ bypass RLS/tenant CRUD; คืนเฉพาะ metadataจำเป็นสำหรับ selection/grants. Pre-tenant lookup แยก privileges.

### Identity, sessions and recovery

- Entra: verify signature/issuer/tenant allowlist/audience/lifetime/nonce; stable provider identity ไม่ใช้ email key. Linking callback/สอง proofs ผูก initiating session/target account/purpose; sign-in callback ไม่เป็น linking authority. Reject substitution/replay/wrong recipient/identity ที่อยู่บัญชีอื่น ไม่ย้าย grants.
- Token/code consumption และ state mutation มี consistent commit; concurrent replay ชนะครั้งเดียว; server-stored purpose/account/recipient/scope ไม่ถูกแทนด้วย request input. Retry/mail failure ไม่คืนชีพ consumed/superseded tokens.
- Password-reset commit revoke canonical-account sessions รวม concurrent issuance ด้วย old credentials; sign-out current เท่านั้น. Recovery cutover ใช้ MFA-RESET-CUTOVER; ไม่ consume จาก link GET/prefetch ต้อง explicit user confirmation.
- Fresh initiating-admin proof ผูก reset operation. Foreground activity ใช้ server event classification ไม่ trust browser time. Challenge/link/activity ไม่เลื่อน absolute deadline; expired/revoked state ไม่ฟื้นจาก cached proof.
- Protected requests อ่าน current requested-Organization force policy; false ไม่สร้าง proof, true challenge เมื่อไม่มี proof; platform ต้อง MFA ไม่ revoke unrelated Organization.

### CLI and delivery

- แยก bootstrap/recovery commands และ authorization. Executable access/การไม่มี admin ใน DB ไม่เป็น authority; approved operational principal ผูก target/narrow privileges/secret access/audit actor. Web identity ใช้ CLI privilege ไม่ได้.
- Recovery ไม่ replace email/print token/สร้าง platform session. Bootstrap ต้อง approve initial identity, prove recipient และ confirm factorก่อน platform access; retry ไม่สร้าง privileged identities ซ้ำ.
- Hash purpose-bound tokens; mail states แยก pending/sent/failed; redact secrets/audit expiry ตาม AUDIT-RETENTION; ไม่ทำ runtime partition DDL. Email send/retry transaction boundary, audit coupling, clock และ maintenance schedule ยังต้องกำหนด.

### API proposal

- Reuse `packages/api-contract`, accepted error envelope และ ERROR-CONTRACT. Context endpoints ตาม Architecture §8; wire prefixเดียวสอดคล้อง [scaffold `/api/v1`](../../apps/api/src/hello/routes.ts) ไม่เพิ่ม aliases.
- Project collection `organizations/:orgId/projects`, item `:projectId`: POSTรับ editable fields ไม่รับ creator/grants/tenant authorityจาก body; 201หลัง atomic commit. GET listเฉพาะ active granted Projects; GET/PATCHตรวจrole/grant; DELETE soft delete→204.
- Grant resource `:projectId/grants/:membershipId`: PUT/DELETE→204เมื่อ desired stateสำเร็จ; duplicate/absent operationยังตรวจauthority. Ownerใช้tenant path; platformใช้narrow admin pathแยกauthorization.
- Proposed name conflict: 409 `PROJECT_NAME_UNAVAILABLE` ไม่มี protected details; missing/deleted Project→404. คง accepted R12 semantics; ไม่คืน raw DB errors.

## 9. Readiness and open contracts

| Area | Current state / required input | Proposed owner |
| --- | --- | --- |
| Integrated specification | Acceptance ยัง not demonstrated; T1/U2 ต้องยอมรับส่วนที่จำเป็นก่อน affected implementation commitment | Product decision owner + contract owners |
| Grant persistence | Freeze membership/active-state mapping, auth lifecycle, FKs/indexes และ lock protocol | Tech Lead |
| Project/API | Freeze fields/limits/name normalization/collation-version, DTOs/routes/status/domain errors/order/ties/pagination/recipient lookup/admin paths | Tech Lead |
| Identity/session/MFA | Freeze library/version/schema/provider trust/dual-proof adapter, password requirements/throttling, activity events, freshness/binding, transaction/version/cache semantics, recovery-context scope/expiry และ retry/code rotation | Tech Lead + Security |
| Bootstrap/email/audit | Freeze executable/principal/credentials/first-admin bootstrap/retry, mail transaction boundary/audit coupling/expiry maintenance | Tech Lead + Platform |
| UX | Accept U2 state/form/focus/announcement contracts และ machine-readable MFA gate | UX + Tech Lead |
| AppError alignment | Contract accepted; implementation ยัง code-first ต้อง migrate constructor/callsites/tests พร้อมกัน | Engineering เมื่อได้รับมอบหมาย |
| Ownership/access | ยังไม่มี confirmed delivery/operational owner หรือ verification access evidence สำหรับ DB/runtime roles/Entra/email/CLI | Decision owner + Platform |
| Runtime acceptance | AC1–AC16 Not exercised; ไม่มี integrated browser/API/DB/IdP/email/CLI evidence | Engineering + QA เมื่อมี implementation assignment |

Missing contracts/access กั้นเฉพาะงานที่ต้องใช้ ไม่ต้องรอ Epic Done, AWS coverage, ranking หรือ customer measurement. ไม่ใช้ blanket department sign-off แทน prerequisite ที่ระบุ.

## 10. Verification and completion

**Safe verification:** synthetic identities, email sink, dedicated/disposable PostgreSQL พร้อม actual non-owner roles, configured test Entra tenant/consented app และ actual browser/CLI roles. ไม่มี production credential/data authorization. Mocks, fixture memberships, schema presence, typecheck หรือ health200 ไม่พิสูจน์ integrated behavior.

**Ready:** accepted current scope/contracts/oracles, confirmed ownership และ safe prerequisites ที่เกี่ยวข้อง. หากต้องมี design experiment ให้กำหนด bounded question/exit/authorization แยก; ไม่ต้องผ่าน implementation acceptance tests ก่อนเริ่ม implementation.

**Done:** accepted ACs ผ่านด้วย integrated invitation→activation→auth/MFA→scope/grants→Project/recovery evidence, required risk checks และ affected docs/contracts ตรงกับ implementation. Task completion ไม่แทน Feature acceptance; Done ไม่ให้ release authorization.

**Outcome measurement:** contribution ต่อ [DIR-001 §7](../product-direction.md#7-outcomes-and-measurement) “Time to a usable comparison” เฉพาะ authorized setup ไม่ใช่ comparison ทั้งวงจร. Baseline/target/cohort/window ยัง Unknown; PM/UX observation ต้องมี consent/authorizationและนับ failed/incomplete/abandoned attemptsคู่ success ไม่ซ่อน access cost. Outcome: Not measured.

**Next action:** contract owners resolve §9 และ decision owner ยอมรับ integrated specification; implementation/release ต้องมี authorization แยก.
