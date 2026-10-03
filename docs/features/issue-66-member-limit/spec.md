# Issue #66 Technical Spec: แสดงเพดานจำนวนสมาชิกองค์กร

Owner: Technical Lead spec นี้ได้รับอนุมัติแล้ว จึงเป็น source of truth ของ implementation และ review

| Field                  | Value |
| ---------------------- | ----- |
| Issue                  | [#66](https://github.com/nixbpe/new-nightwatch/issues/66) |
| Feature                | `docs/features/issue-66-member-limit/feature.md` (Product Owner, AC `P66-*`, `acceptanceVersion` `issue-66-AC-1`) |
| Epic                   | None |
| Status                 | Approved |
| Approved by user       | 2026-10-03 (ผู้ใช้สั่ง `/implement-issue` และให้ใช้ค่าตามคำแนะนำของ Technical Lead ทุกข้อโดยไม่ต้องถาม) |
| Start authorization    | 2026-10-03, issue #66 (ข้อความเดียวกัน) |
| `COMMIT_MODE`          | owned-slice (`/implement-issue` override) commit ได้เฉพาะไฟล์ที่ Task เป็นเจ้าของ integration owner push branch และเปิด PR ได้ 1 PR ไม่ครอบ merge, deploy หรือ force-push |
| `STOP_AT`              | merge-ready |

ป้าย [ตรวจแล้ว] คือสิ่งที่ Technical Lead อ่านใน code หรือ `gh issue view 66` ณ 2026-10-03

## Contracts

- API [ตรวจแล้ว: `GET /api/organizations/{organizationId}/members` ใช้ `organizationMemberListResponseSchema` ใน `packages/api-contract/src/auth.ts`, สร้าง body ใน `apps/api/src/organization-notifications/members.ts:168`]
  - เพิ่ม constant `ORGANIZATION_MEMBER_LIMIT = 1000` ใน `packages/api-contract/src/auth.ts` (precedent: `MONITOR_LIMIT_PER_ORGANIZATION` ใน `packages/api-contract/src/monitor.ts:10`)
  - `organizationMemberListResponseSchema` เพิ่ม field top-level `memberLimit: z.number().int().min(1)` ค่าเป็น `ORGANIZATION_MEMBER_LIMIT` เสมอ field อื่นและ error เดิมไม่เปลี่ยน
  - `apps/api/src/auth/index.ts` ใช้ `membershipLimit: ORGANIZATION_MEMBER_LIMIT` แทนเลข `1000` เพื่อให้ค่าที่แสดงกับค่าที่บังคับมาจากแหล่งเดียว
  - regenerate `apps/web/src/lib/api/openapi-types.gen.ts` (`codegen:check` ต้องผ่าน)
- Data: ไม่มี table, column, migration หรือ RLS ใหม่ query เดิมยังรันใน tenant context เดิม
- Web: `OrganizationMembersPage.tsx` บรรทัดสถานะของ `PageHeader` แสดงจำนวนสมาชิกเทียบเพดานจาก `list.data.memberLimit` ตามเงื่อนไขแสดงผลเดิมของจำนวนสมาชิก (ซ่อนขณะ fetching, error หรือ invalid page) ถอด `<MockupFrame label="เพดานจำนวนสมาชิก" issue={66}>` ออก query key `memberListQueryKey` และ cache scope ไม่เปลี่ยน copy "สมาชิกทั้งหมด {total} / {limit} คน" ตัวเลขทั้งสองมีจุลภาคหลักพัน (`Q-01` ใน Feature) และยังเป็น `font-mono`
- Authorization and security: สิทธิ์อ่านเดิม (owner และ admin) ไม่เปลี่ยน `memberLimit` เป็นค่าคงที่ของผลิตภัณฑ์ ไม่เปิดเผยข้อมูลองค์กรอื่น

## Design decisions

| OD | การตัดสิน (ค่าแนะนำของ Technical Lead, ผู้ใช้ยอมรับ 2026-10-03) | เหตุผล |
| --- | --- | --- |
| OD-66-01 | เพิ่ม field ใน response รายชื่อสมาชิก ไม่ hardcode 1000 ใน web | ตามแนวของ monitor `summary.limit` ถ้าเพดานต่างกันต่อองค์กรในอนาคต แก้แค่ฝั่ง server |
| OD-66-02 | นับเฉพาะสมาชิก คำเชิญที่รอตอบไม่นับรวม | Better Auth `membershipLimit` ตรวจจำนวนสมาชิกตอนรับคำเชิญ (#11) ตัวเลขที่แสดงจึงตรงกับที่ระบบบังคับ |
| OD-66-03 | ไม่ขยายสิทธิ์ viewer หน้า members อ่านได้เฉพาะ owner และ admin (`isMemberDirectoryReadable`) | การเปิดหน้าให้ viewer เป็นการเปลี่ยน authorization ที่ issue ไม่ได้ขอ story ของ viewer เป็น follow-up |
| OD-66-04 | ข้อความ error ที่มี "1,000" (`apps/api/src/onboarding/service.ts:93`, `InvitationPanel.tsx:132`, `AcceptInvitationPage.tsx:232`) คงเดิม | นอก scope ของ issue |

- Architecture drivers: ไม่กระทบ runtime (field คงที่ ไม่มี query เพิ่ม) maintainability ดีขึ้นเพราะเพดานมีแหล่งเดียว
- Non-goals: เพดานต่อองค์กร, การนับคำเชิญ, สิทธิ์ viewer, แก้ copy error เดิม, ลบ component `MockupFrame` (ยังใช้ใน 9 ไฟล์อื่น)

## Tasks

| Task   | Depends on | Integration owner of shared files |
| ------ | ---------- | --------------------------------- |
| NODE-1 | None       | software-engineer (NODE-1 เป็นเจ้าของทุกไฟล์) |

Task เดียวเพราะ contract, API และ UI เป็นพฤติกรรมเดียวขนาดเล็ก (ประมาณ 50 บรรทัด) แยกแล้วต้องรอกันเป็นลำดับโดยไม่ได้อะไร

### NODE-1 แสดงเพดานสมาชิกจาก server ในบรรทัดสถานะหน้าสมาชิก

- **OWNER:** software-engineer
- **READY:** spec นี้ Approved
- **OUTCOME:** response รายชื่อสมาชิกมี `memberLimit` จาก `ORGANIZATION_MEMBER_LIMIT` และหน้าสมาชิกแสดงจำนวนสมาชิกเทียบเพดานแทน mockup
- **SOURCE:** Contracts ด้านบน, OD-66-01 ถึง OD-66-04, AC ใน Feature
- **INVARIANTS:** สิทธิ์อ่านและ RLS ของ endpoint เดิม, field เดิมของ response, `membershipLimit` ที่ Better Auth บังคับยังเป็น 1000
- **FILES:** `packages/api-contract/src/auth.ts`, `packages/api-contract/src/index.ts`, `packages/api-contract/src/auth.test.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/organization-notifications/members.ts`, `apps/api/src/organization-notifications/routes.db.test.ts`, `apps/web/src/lib/api/openapi-types.gen.ts`, `apps/web/src/pages/OrganizationMembersPage.tsx`, `apps/web/src/pages/OrganizationMembersPage.test.tsx`, fixture ทุกไฟล์ใน `apps/web/src` และ `apps/api/src` ที่สร้าง member list response (ไฟล์นอกรายการนี้ต้องรายงานใน handoff)
- **NON-GOALS:** ตาม Design decisions
- **CONTRACTS:** ไม่มี sibling
- **VERIFY:** format บนไฟล์ที่แก้, lint และ typecheck ของ package ที่แก้, test ของไฟล์ที่แก้, `bun run codegen:check`, DB test ของ member list route
- **PROOF:** test schema ของ `memberLimit`, DB route test ว่า response มี `memberLimit: 1000`, web test ว่าบรรทัดสถานะแสดงค่าเพดานจาก response (ใช้ค่าที่ไม่ใช่ 1000 ใน test เพื่อพิสูจน์ว่าไม่ hardcode) และซ่อนเมื่อ loading/error, mockup frame ของ #66 หายไป
- **COVERS:** P66-01, P66-02, P66-03, P66-04, P66-05, P66-06, P66-07

## Integrated verification

- Gates หลัง writer หยุด: `bun run validate`, `COVERAGE_GATE=1 bun run test:coverage`, `bun run build`, `bun run security`

## Open decisions

None (OD-66-01 ถึง OD-66-04 ตัดสินแล้ว)

## Revisions

| Date | Change | Approved by user | `acceptanceVersion` |
| ---- | ------ | ---------------- | ------------------- |
| 2026-10-03 | ฉบับแรก | 2026-10-03 | `issue-66-AC-1` |
