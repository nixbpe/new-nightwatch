# Epic: Authentication, Authorization และ Workspace Onboarding

## การควบคุมและการติดตาม (Controls and traceability)

- ID: E-001 (draft convention; ไม่ใช่ tracker ID)
- Revision: v0 — ร่างแรก
- Parent Direction: DIR-001 / [docs/product-direction.md](../product-direction.md) / v2 (retained source revision; document_status: Direction Approved for the unchanged scope approved on 2026-09-07; historical approval provenance in Direction §1)
- delivery_status: Refining — ขอบเขต Epic ได้รับอนุมัติและกำลังลงรายละเอียด F-001; ไม่ใช่ Ready หรือ In Progress ของ implementation
- outcome_status: Not measured
- Owner: ผู้รับผิดชอบยังไม่ confirm — เสนอ Product Owner role
- Evidence / decision references: D1–D9 (DIR-001 §1); Direction §3 capability landscape, §4 Establish context, §5 isolation; [architecture](../architecture.md) §3/§5/§8 และ [design system](../design-system.md). Direction §1 บันทึก historical approval ภายใต้ชื่อ discovery artifact เดิม PDD-001 v2 ซึ่งแยกจากคำสั่งร่าง Epic เดิม; การเปลี่ยนชื่อเป็น DIR-001 ไม่เปลี่ยน approved scope หรืออนุมัติ Product Design candidate
- E001-A1 / 2026-09-07: ผู้ใช้/product decision owner ระบุ “Approve epic E-001 และจากนั้นเริ่มร่างเอกสาร F-001 แบบละเอียด” — อนุมัติขอบเขต E-001 v0 และเลือก F-001 สำหรับการร่างรายละเอียดเท่านั้น ไม่ใช่อนุมัติ Feature specification ที่ยังไม่ได้ร่าง, Stories/Tasks, implementation หรือ release; open decisions ที่บันทึกไว้ยังไม่ได้รับคำตอบ

## Outcome เป้าหมายและขอบเขต (Target outcome and boundaries)

- ผู้ใช้ / ปัญหา: provider Platform/SRE operator (D1, D6) ต้อง sign-in และทำงานได้เฉพาะภายใน customer Organization ที่ membership ของตนได้รับการ verify (Direction §5 isolation risk) ปัจจุบัน scaffold ไม่มี database, session หรือ tenant context (architecture §1) ทำให้ทุก capability ใน first-scope value loop ยังเริ่มไม่ได้
- Target outcome: operator sign-in ได้ ถูก route ไปเฉพาะ Organization ที่เป็น verified member และเห็น/จัดการ Projects ภายใน Organization เดียวครั้งละหนึ่ง — สร้าง authorized context ที่ Direction §3 value-loop ขั้น 1 ต้องการ ก่อนงาน cloud connection, evidence collection หรือ prioritization ใดๆ
- Supporting / contrary evidence: ไม่มี customer evidence — ทุก claim ใน Direction ยังเป็น Hypothesis (Direction §6) ส่วนที่รองรับคือ technical contract ใน architecture §3 ที่ Epic นี้จะ implement; Epic นี้เป็น technical prerequisite ไม่ใช่หลักฐานของ demand
- Scope:
  - Identity: Better Auth บน PostgreSQL — users, sessions, provider accounts, verifications, memberships (architecture §3)
  - Tenant enforcement: session → verified membership → tenantId/userId/userRole → permission guard; resolve URL `orgId` จาก verified membership เท่านั้น ห้าม trust browser selection หรือ request body; semantics 401/403 พร้อม audit denial โดยไม่มี protected data (architecture §3)
  - Authorization model: roles `owner`/`admin`/`viewer`/`auditor` พร้อม permission guard แบบ explicit และ local (architecture §2/§5)
  - Organization provisioning: self-service creation disabled; ผู้ใช้ยืนยัน platform-admin UI พร้อม invitation/activation ใน F-001 C1/G1/G16 แล้ว; working v3 รวม contract reviews แต่ bootstrap/delivery mechanics ยังต้อง freeze ใน T1
  - Project management: Project CRUD ภายใน Organization เดียวเท่านั้น ภายใต้ tenant transaction พร้อม RLS (architecture §3/§5)
  - Web tenant context: `/me/context`, `PATCH /me/active-org`, query keying ด้วย organizationId และ block in-flight response ของ tenant อื่น (architecture §8) — operator อาจมี membership หลาย Organization (Direction §2) การ switch จึงต้องถูกตั้งแต่แรก แม้การเปรียบเทียบจะอยู่ใน Organization เดียว (D7)
  - Persistence enabler: packages/db — Drizzle schema/client, tenant transaction helpers, custom migration runner (`NNNN_*.sql` + `__nightwatch_migrations` + advisory lock), runtime roles แบบ non-owner `NOBYPASSRLS` พร้อม FORCE RLS (architecture §3/§5) ติดตามเป็น Enabler Task ภายใต้ Feature ที่เลือก ไม่ disguise เป็น user value
- Non-goals:
  - Cloud account connection, assessment/evidence collection, prioritization และ next-action guidance — เป็น Feature ถัดไปของ first-scope value loop (Direction §3); evidence collection ต้องรอ decision "Supported AWS scope and technical signals" (Direction §8) เพิ่มเติม
  - Cross-customer aggregation หรือ view (D7); business-criticality entry (D8); native assignment, ticket handoff หรือ remediation tracking (D5)
  - Entra provider — ต้องมี explicit configuration ก่อน enable (architecture §3)
  - Reporting, notifications และ module อื่นที่อยู่นอกขอบเขต — ต้องมีการ select แยกภายหลัง (Direction §8)
- Constraints / risks:
  - Cross-customer disclosure จาก membership/scope enforcement ที่ผิดเป็น trust risk สำคัญ (Direction §5 ไม่ได้จัดอันดับ severity): RLS และ membership verification ต้องมาพร้อมตารางแรก; verification ต้องใช้ real-role denial และ tenant A/B isolation บน dedicated database — mocks พิสูจน์ RLS ไม่ได้ (architecture §10)
  - การ defer tenancy ไป Feature ถัดไปจะบังคับ retrofit RLS ทุกตารางย้อนหลัง — ปฏิเสธแนวทางนี้
  - Session/cookie contract ของ Better Auth (host-only, HttpOnly, SameSite=Lax, production Secure) และความสอดคล้องของ `CORS_ORIGIN`/`APP_URL`/`trustedOrigins` ต้องคงไว้; ห้ามขยาย cookie scope เพื่อ CORS (architecture §3)
  - "Deployment, data control and operating boundaries" (Direction §8) ยังไม่ resolve; ไม่บล็อกการร่างหรือ development แต่บล็อกคำตอบเรื่อง key-management/retention ใน production

| Outcome metric / population / window | Baseline and source | Target / acceptance of target | Measurement and owner | Guardrails / observed outcome refs |
| --- | --- | --- | --- | --- |
| ส่วนช่วยของ "Time to a usable comparison" (Direction §7, adoption diagnostic): นาทีตั้งแต่เริ่ม authorized customer setup จนถึง review comparison ข้าม Projects ที่เกี่ยวข้องได้ถูกต้อง ต่อ onboarding attempt — Epic นี้ครอบส่วน authorized setup (sign-in → verified Organization membership → เห็น Projects ใน Organization เดียว); ส่วน comparison อยู่ใน Feature ถัดไป | Unknown — ยังไม่มี telemetry; collection plan ตาม Direction §7 (observe onboarding ด้วย representative authorized scope โดยบันทึก attempt ที่ incomplete/failed/abandoned คู่กับที่สำเร็จ) | Proposal เท่านั้น (measurement definitions ใน Direction §7 ยังไม่ approved); ยังไม่มี target value | วิธี observe และเงื่อนไข consent ตาม Direction §6/§7; ผู้รับผิดชอบที่เสนอคือ PM พร้อม UX/security input — ยังไม่ confirm | Guardrail จาก Direction §7 ใช้เต็ม: ห้ามปรับผลโดยซ่อน access requirements, ลด agreed coverage หรือบังคับ business-criticality entry (D8); cross-customer-scope mistake ต้องปรากฏ ไม่ถูกกลบด้วยค่าเฉลี่ย; outcome_status คง Not measured |

## Feature candidates แบบหยาบและการเลือก (Rough Feature candidates and selection)

| Candidate / existing or draft reference | User behavior / ส่วนช่วยต่อ outcome | Evidence and uncertainty | Selected / deferred / rejected / undecided | เหตุผล, trade-off และ decision ref |
| --- | --- | --- | --- | --- |
| [F-001: Workspace onboarding](F-001-workspace-onboarding.md) / v3 | Operator เข้า Organization/Projects ตาม membership, role, explicit grants และ auth/MFA/recovery gates | C1–C9/G1–G23 ยืนยันแล้ว; F001-R3 เป็น bounded data/security/UX/QA review ไม่ใช่ integrated acceptance | Selected — E001-A1; v1 approved — F001-A1; v3 รวม F001-D2/D3/R3 และ F001-ERR1 | F001-ERR1 รับรอง `AppError(status, code, message, details?)` แล้ว; T1/U2 ส่วนที่เหลือยังเป็น reviewed proposals ไม่สืบทอด v1 approval หรืออนุญาต implementation |
| F-002 (candidate): MFA hardening เพิ่มเติม | ไม่มีพฤติกรรมเพิ่มเติมที่เลือกในรอบนี้ | F-001 v3 รวม first-auth TOTP, Organization force policy และ recovery ตามคำตอบผู้ใช้ | Undecided / unselected สำหรับงานเพิ่มเติม | ไม่ใช้ F-002 เลื่อน first-auth MFA; ไม่สร้าง Feature artifact เพิ่ม |

- เหตุผลของลำดับ: F-001 สร้าง auth/tenant context และ Project access foundation; first-auth TOTP อยู่ใน F-001 ตาม architecture/คำตอบผู้ใช้ ไม่ต้องรอ F-002
- งาน downstream นอก Epic นี้: cloud account connection และ evidence collection เป็นของ Epic ถัดไปใน first-scope value loop (Direction §3) และต้องรอ decision "Supported AWS scope and technical signals" (Direction §8) เพิ่มเติม — ทั้งคู่พึ่งพา tenant context ของ Epic นี้แต่ไม่ได้อยู่ใน containment ของ Epic นี้
- Next refinement: working F-001 v3 รวม product answers และ bounded contract reviews; ขั้นถัดไปคือ accepted contract freeze/prerequisites ไม่ถาม product choices เดิมซ้ำและไม่ใช้ review แทน runtime proof

## Dependencies, readiness และ completion

| blocked_by reference หรือ None | Prerequisite จริง / งานที่ได้รับผล | Ready condition | Input owner / next action |
| --- | --- | --- | --- |
| F-001 v3 T1/U2 — accepted contract freeze | Affected auth/provisioning/grant/UI implementation; Project-grant model เพิ่มจาก A5 เดิม | ยอมรับ exact contracts ตามรายการคงค้างใน Feature; Architecture update ต้องมี accepted decision และ assignment ไม่ใช่แก้ blueprint เป็น proposal โดยปริยาย | Technical/UX contract owners ตาม assignment; ยังไม่ยืนยัน delivery ownership |
| Dedicated PostgreSQL สำหรับ RLS verification (architecture §10) | Exit ของ Enabler Task — verify tenant isolation ไม่ได้โดยไม่มี non-owner role จริง | มี database สำหรับ CI/local verification พร้อม owner + runtime roles | Platform engineer |

ไม่มี open decision อื่นใน Direction §8 ที่บล็อก Epic นี้: "Supported AWS scope and technical signals" บล็อก Feature ด้าน evidence collection; "Ranking and explanation contract" บล็อก prioritization; คำถามเรื่อง research protocol และ pilot บล็อกเฉพาะ studies (Direction §8)

- Readiness assessment: E001-A1/F001-A1 คง revision-bound approval เดิม. F-001 v3 รวม C/G และ F001-R3 reviews; QA ยืนยัน documentary correction ของ QA-F001-01 ใน v2 แล้ว แต่ integrated v3 acceptance, exact T1/U2 freeze และ owner/environment evidence ยังไม่ครบ; คง Refining
- Completion evidence: ยังไม่มี runtime acceptance evidence; delivery_status: Refining ไม่ใช่ Done
- Release and outcome: ไม่มี release decision หรือ observation; Done ≠ released ≠ outcome achieved

## Handoff

- **Outcome:** E-001 v0 scope approval คงเดิม; child ปัจจุบันคือ F-001 v3 ไม่ใช่ implementation/release. Cloud connection/collection ยังคง downstream นอก Epic
- **Deliverables:** Epic และ [F-001 v3](F-001-workspace-onboarding.md); ไม่มี Stories/Tasks/F-002 artifacts
- **Evidence:** DIR-001/E001-A1/F001-A1, F001-D2/D3 actual answers และ F001-R3 read-only reviews; ไม่มี runtime/customer validation
- **Risks and blockers:** Accepted T1/U2 contracts, confirmed owners และ slice-relevant verification access; review ไม่พิสูจน์ RLS/CLI/IdP/browser behavior
- **Next owner:** ผู้ใช้/product decision owner ทบทวน integrated v3; contract owners freeze รายการที่ระบุเมื่อได้รับมอบหมาย ไม่ใช่คำสั่งเริ่ม implementation
