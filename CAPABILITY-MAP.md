# Capability Map: Personal Settings (การตั้งค่าส่วนตัว)

Source design: https://claude.ai/code/artifact/85f80e5a-fa43-463f-b632-afe697f476a5
(clickable prototype; light/dark; tabs: โปรไฟล์ / ความปลอดภัย / เซสชันและอุปกรณ์ / การแสดงผล).
Shell it lives in: `apps/web/src/components/shell/` (see `docs/ref/shell-structure.md`).

| Module id          | Responsibility                                                                                                                                              | Depends on                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `settings-shell`   | `/settings/*` route family, page header + tab strip layout, nav/breadcrumb/account-menu wiring, index redirect                                              | —                                   |
| `account-security` | Password change; MFA enable → verify → backup codes (existing) + regenerate codes + **disable**; moves the current `/settings/security` page into the shell | `settings-shell`                    |
| `account-sessions` | List signed-in sessions (device, IP, last active), revoke one, revoke all others; absolute times via `formatDateTime`                                       | `settings-shell`, `account-display` |
| `account-profile`  | Edit display name; read-only email with verified badge; initials avatar (no upload)                                                                         | `settings-shell`                    |
| `account-display`  | Theme (existing) + language / time zone / time format / week start, persisted in the browser only                                                           | `settings-shell`                    |

Build order: `settings-shell` → `account-security` → `account-display` → `account-sessions` → `account-profile`.
`account-security` and `account-profile` depend only on the shell; `account-sessions` also reads `formatDateTime` from `account-display`, so display lands first.

## Decisions taken with the user (2026-09-10)

- Capability map approved as above.
- Avatar: initials only; upload / image URL deferred (no object storage; not worth a `bytea` module yet).
- Display preferences are stored in the browser only (`localStorage`, like the theme). No server persistence, no migration.
- Routing: one URL per tab — `/settings/profile`, `/settings/security`, `/settings/sessions`, `/settings/display`; `/settings` redirects to `/settings/profile`.

Open questions resolved with the user (2026-09-11):

- Account menu keeps a single settings link, **การตั้งค่าส่วนตัว** → `/settings/profile`; the security link and the profile/settings stubs go. The "2FA เปิดอยู่" status therefore leaves the menu and lives on the security tab.
- The four tabs are searchable in the ⌘K palette (group "การตั้งค่าส่วนตัว") via palette-only sub-destinations on the nav leaf.
- `qrcode` (MIT, no runtime deps) is approved as a new `apps/web` dependency for the MFA QR step.
- Password minimum stays 8 characters (design copy updated from 12).
- Session IP is shown exactly as the API returns it, with no location claim; trusting a proxy header (`advanced.ipAddress.ipAddressHeaders`) is a recorded server follow-up, not part of this initiative.
- Profile shows no email-change control at all.
- Sessions use `formatDateTime` from `account-display` for absolute times from day one (hence the build order above).

## What this initiative does NOT change

- **No API, contract or schema changes.** Every account operation already exists as a Better Auth endpoint under `/api/auth/*` (`updateUser`, `changePassword`, `listSessions`, `revokeSession`, `revokeOtherSessions`, `twoFactor.enable/verifyTotp/generateBackupCodes/disable` — all confirmed present in better-auth 1.6.23). `packages/api-contract`, `apps/api`, `packages/db` and `openapi-types.gen.ts` stay untouched. If a module discovers it needs a server change, that is an "ask first" item, not a silent addition.
- Organization-level settings (ตั้งค่าองค์กร) are out of scope.
- Email change (`changeEmail`) is out of scope — it needs `user.changeEmail.enabled` on the server plus a verification flow.

## Shared implementation conventions

### Tech stack

React 19 + Vite, TypeScript strict, React Router v7 (data mode, loaders in `lib/auth/loaders.ts`), TanStack Query 5, TanStack Form, better-auth 1.6.23 client (`lib/auth-client.ts`), Tailwind v4 with the design tokens in `src/index.css`, shadcn/ui primitives in `components/ui`. Tests: Vitest + Testing Library on happy-dom; e2e: Playwright (`e2e/`).

### Commands (run from the repo root unless noted)

```
Dev servers:        bun run dev
Web unit tests:     bun run --cwd apps/web test
One test file:      cd apps/web && bunx vitest run src/pages/settings/SecurityPage.test.tsx
Typecheck:          bun run typecheck
Lint:               bun run lint
Format:             bun run format          (check: bun run format:check)
Full gate:          bun run validate        (format:check + codegen:check + lint + typecheck + test)
E2E (needs DB env): bun run e2e
```

`bun run codegen` is NOT needed for this initiative — no OpenAPI change. `bun run validate` must pass before every commit.

### Project structure

```
apps/web/src/
  pages/settings/
    SettingsLayout.tsx            settings-shell: header + tab strip + <Outlet/>
    SettingsLayout.test.tsx
    settings-tabs.ts              settings-shell: tab config (key, label, icon, path)
    ProfilePage.tsx (+ .test)     account-profile
    SecurityPage.tsx (+ .test)    account-security (moved from pages/SecuritySettingsPage.tsx)
    MfaCard.tsx                   account-security: the inline 3-step enrolment + enabled state
    PasswordCard.tsx              account-security
    SessionsPage.tsx (+ .test)    account-sessions
    DisplayPage.tsx (+ .test)     account-display
  lib/
    sessions/device-label.ts (+ .test)   account-sessions: user-agent → "Chrome 129 · macOS"
    preferences.ts (+ .test)             account-display: localStorage-backed preferences hook
    theme.ts                             (existing) reused by account-display
  components/shell/
    nav-config.ts                 settings-shell: leaf /settings + palette-only tab destinations
    AccountMenu.tsx               settings-shell: one real link (การตั้งค่าส่วนตัว), stubs removed
  router.tsx                      settings-shell adds the nested /settings routes
```

Tests live next to the file they test (`X.test.tsx`), as everywhere else in `apps/web`.

### Code style

Follow the existing pages: a page component owns its TanStack form(s), calls `authClient.*` directly, maps errors through `authErrorMessage`, and renders `Alert` / `Field` / `Input` / `SubmitButton` from `components/ui`. Thai copy lives in the JSX as literals (no i18n layer yet). Icons are inline SVGs from `components/shell/icons.tsx`.

```tsx
const form = useForm({
  defaultValues: { currentPassword: "", newPassword: "" },
  onSubmit: async ({ value }) => {
    setNotice(null);
    const { error } = await authClient.changePassword({
      currentPassword: value.currentPassword,
      newPassword: value.newPassword,
      revokeOtherSessions: true,
    });
    if (error != null) {
      setNotice({
        tone: "error",
        text: authErrorMessage(error, "เปลี่ยนรหัสผ่านไม่สำเร็จ"),
      });
      return;
    }
    setNotice({
      tone: "success",
      text: "เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นถูกออกจากระบบ",
    });
    form.reset();
  },
});
```

Conventions that already bite in this codebase:

- `getByLabelText` also matches elements with a direct `aria-label` — give icon-only buttons a visually hidden `<span className="sr-only">` name instead of `aria-label` when they sit near a labelled input.
- Attribute a boolean, not `""`, when a prop must be truthy (`disabled={pending}`).
- `@typescript-eslint/no-unnecessary-condition` is on: do not compare against states the type rules out.
- Number-to-string in template literals must be explicit (`String(n)`).
- Commit messages: conventional (`feat(web): …`), one logical change per commit, ending with the session attribution trailer.

### Testing strategy

- **Unit / component (Vitest + RTL, happy-dom):** every page and helper. Mock `better-auth/react` (`createAuthClient` → object with the methods the page calls) and `better-auth/client/plugins` exactly as `SecuritySettingsPage.test.tsx` / `AppShell.test.tsx` do; mock `../lib/api/me` for `fetchMeContext`. Render through `createMemoryRouter` + `RouterProvider` when a page depends on `useNavigate` / nested routes. Assert by role and Thai label, never by class.
- **Coverage:** `apps/web/vitest.config.ts` gates 80 % lines / 70 % branches when `COVERAGE_GATE=1`; new files must not drag the package below that.
- **E2E (Playwright, `e2e/tests/`):** one `settings.spec.ts` covering tab navigation and the URL-per-tab contract against the dev servers; the MFA and password flows need a real database + mailbox and are therefore written but tagged to run only when `DATABASE_URL` is set (same rule as the existing auth e2e).
- **Live check before commit:** open the feature in the running app at 1440 / 768 / 390 px, both themes, keyboard-only pass on every dialog and step (design-system rule: overlays keep focus and restore it).

### Boundaries

**Always**

- Run `bun run validate` before each commit; keep the suite green (currently 109 tests).
- Talk to identity only through `authClient` (never hand-rolled `fetch` to `/api/auth/*`), and read account facts from `me/context` or `useSession()` — never invent them.
- After any mutation that changes what the shell shows (name, 2FA status, session revocation), `invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY })` and/or refetch the session so the sidebar account block and the account menu's "2FA เปิดอยู่" stay truthful.
- Follow `docs/design-system.md`: 4 px corners, hairline borders, Thai copy from the design, ≥ 24 px targets, visible focus, no colour-only meaning, no illustrative data presented as live.
- Keep secrets out of the DOM and logs: never render or log session tokens, TOTP secrets, or backup codes anywhere except the one-time reveal the flow requires.

**Ask first**

- Adding a dependency beyond the approved `qrcode` (e.g. a user-agent parser or timezone list).
- Any change to `apps/api`, `packages/api-contract`, `packages/db`, or better-auth server options (`changeEmail`, IP-address headers, session settings).
- Changing the password policy (currently 8 characters, matching reset/signup).
- Touching shell components beyond `nav-config.ts` (leaf + palette entries), `CommandPalette.tsx` (group label for palette entries) and the account-menu link.
- Removing or rewriting an existing test.

**Never**

- Commit secrets or `.env` files; edit `openapi-types.gen.ts` by hand; use `drizzle-kit push`.
- Weaken a loader gate or a server check because the UI "already prevents it" (FE-07: authorization belongs to the API).
- Show counts, timestamps or device details the API does not actually return.
