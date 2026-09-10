import { Outlet } from "react-router";

/**
 * Layout for every route that must render with no sidebar/header — the
 * complement of AppShell (components/shell/AppShell.tsx): sign-in,
 * password recovery, the two-factor challenge, the verify-email resend
 * hub, onboarding, and invitation acceptance. Every one of these already
 * renders its own full-page chrome (AuthPageShell, or LoginPage's own
 * split layout); this layout adds nothing visual — it only makes "these
 * routes intentionally have no shell chrome" explicit in the route tree
 * instead of leaving them as ungrouped top-level siblings.
 *
 * Layout switching (Step 5) is realized structurally: which layout a
 * route nests under, gated per-route by this app's existing loaders
 * (lib/auth/loaders.ts). requireAnonLoader already bounces an already
 * signed-in visitor away from login/forgot-password/reset-password
 * before this layout ever renders for them — that loader is this app's
 * real equivalent of "the existing auth flag" (checked fresh against the
 * server per request, not a reactive client boolean). No separate mock
 * guard is added here: /two-factor explicitly owns its own challenge
 * rules (see router.tsx), and a generic session-based redirect at this
 * layer would risk contradicting that page-owned logic.
 */
export function AuthLayout() {
  return <Outlet />;
}
