# NODE-F004-02 — Invitation

| Field | Value |
| --- | --- |
| Feature | `F-004`, `acceptanceVersion: F-004-AC-2` |
| Story | `F-004-S02` |
| Status | Approved, 2026-09-27; split confirmed by commit/issue instruction |
| Depends on | `NODE-F004-01` merged and handoff accepted |
| Parallel with | `NODE-F004-03` source work after node 01 |
| Merge gate | Merge before node 03; node 03 rebases before final review |
| Implementation authorization | None; start authorization is still required |

Common contracts and design decisions are authoritative in `../spec.md`.

- **OWNER:** `software-engineer`
- **READY:** NODE-F004-01 handoff/review passed; API list, member page and shared contract are available
- **OUTCOME:** invitation create authorized at commit, hard-capped acceptance and member-page form; invitation persistence is distinct from SMTP transport result and the UI never presents the recipient as a member before acceptance
- **SOURCE:** `F-004-AC-2` AC-04–AC-07, AC-16–AC-17
- **INVARIANTS:** native invite create/accept bypass is closed; create permission, duplicate and pending-limit checks use the same lock as insert; concurrent same-email creates produce one pending row; accept serializes count, claim and member insert and keeps member count <= 1,000; the cap loser leaves its invitation pending; failure/log output contains no PII or token; SMTP never runs inside the transaction; a late A result never writes a B notice
- **FILES:** existing `apps/api/src/organization-notifications/routes.ts`, `apps/api/src/onboarding/routes.ts`, `apps/api/src/onboarding/service.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/emails.ts`, `apps/api/src/auth/mailer.ts`, `apps/api/src/app.ts`, `packages/api-contract/src/auth.ts`, `packages/api-contract/src/index.ts`, `apps/web/src/lib/api/openapi-types.gen.ts`, `apps/web/src/lib/api/invitations.ts`, `apps/web/src/pages/AcceptInvitationPage.tsx`, `apps/web/src/pages/WorkspacePage.tsx`, `apps/web/src/lib/roles.ts`; planned-new `apps/api/src/organization-notifications/invitations.ts`, `apps/web/src/pages/organization-members/InvitationPanel.tsx`; focused auth/onboarding/invitation DB, route and web tests. `apps/api/src/auth/index.ts` owns native guards and `membershipLimit: 1000`; `apps/api/src/auth/emails.ts` remains the email builder.
- **NON-GOALS:** pending invitation list/resend/cancel, transport queue, delivery guarantee, teams, organization hooks, onboarding redesign
- **CONTRACTS:** first-party create POST, normalized email, 48-hour expiry, 100 pending-invitation limit, deterministic `409` codes and `emailDispatch`; first-party accept POST, privacy-equivalent `404`, hard member cap 1,000 and atomic pending→accepted/member insert; native create/accept denied; public invitation preview/signup gate preserved
- **VERIFY:** focused real DB and HTTP create role×role matrix across A/B, already-member, live/expired pending invitation, 99/100 pending limit, concurrent same-email create, actor demotion/revoke while create waits on Organization lock, direct native create/accept bypass denial, SMTP accepted/failure and invalid email; accept unknown/expired/non-pending/wrong-email/already-member, 999/1,000 members, concurrent different-invitation accepts from 999, replay and rollback injection; inspect invitation/membership/context/protected-read rows; web duplicate submit, field errors, pre-insert failure/draft, accepted success, failed warning, no automatic retry, first-party accept/cap error/context selection, delayed A response after A→B and keyboard focus
- **PROOF:** authorization-time actor role and DB rows; status/code; one invitation from a concurrent duplicate; exact expiry range; invitation tied to A; accepted/failed response and one SMTP attempt; concurrent accept final count 1,000 with one accepted and one pending; losing `ORGANIZATION_MEMBERSHIP_LIMIT_REACHED`; no member before accept; context/protected access after accept; redacted logs and UI request count/notice
- **COVERS:** AC-04 (invite), AC-05, AC-06, AC-07, AC-16 (invite), AC-17 (invite)

## Parallel and shared-file policy

Node 02 and node 03 may implement source changes in parallel after node 01. Node 02 owns invitation-specific modules, onboarding/auth changes and its branch's generated OpenAPI output. Both nodes may need `apps/web/src/pages/OrganizationMembersPage.tsx`; each keeps behavior in a separate component. Merge node 02 first. Node 03 then rebases and performs the only composition conflict resolution. No sibling edits the same shared file in the same worktree.
