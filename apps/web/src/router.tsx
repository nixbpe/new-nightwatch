import {
  createBrowserRouter,
  Link,
  Outlet,
  useRevalidator,
  type RouteObject,
} from "react-router";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppShell } from "./components/shell/AppShell";
import { ShieldIcon } from "./components/shell/icons";
import {
  requireAnonLoader,
  rootLoader,
  securitySettingsLoader,
  verifyEmailLoader,
  workspaceLoader,
} from "./lib/auth/loaders";
import { SessionQueryProvider } from "./lib/auth/SessionQueryProvider";
import { TenantProvider } from "./lib/tenant/TenantProvider";
import { AcceptInvitationPage } from "./pages/AcceptInvitationPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { SecuritySettingsPage } from "./pages/SecuritySettingsPage";
import { TwoFactorPage } from "./pages/TwoFactorPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { WorkspacePage } from "./pages/WorkspacePage";

/**
 * App shell for every route. The router lives OUTSIDE the per-identity
 * query boundary, so auth transitions never invalidate navigation or
 * pending invitation flows — the boundary remounts only the routed tree.
 *
 * The revalidation wiring closes the loop the component guards used to
 * close: an in-page auth transition (sign-in on /login, sign-out on a
 * protected page) changes the resolved identity without any navigation,
 * so the boundary asks the router to re-run the active loaders — the
 * anonymous gate then continues a fresh sign-in, the verified gate bounces
 * a dropped session.
 */
export function RootLayout() {
  const revalidator = useRevalidator();
  return (
    <ErrorBoundary>
      <SessionQueryProvider
        onResolvedIdentityChange={() => void revalidator.revalidate()}
      >
        <Outlet />
      </SessionQueryProvider>
    </ErrorBoundary>
  );
}

// Deliberately standalone (not nested under AppShell): a bad URL is
// reachable by anonymous and signed-in visitors alike, and the shell's
// header shows session state that would be misleading for the former.
// The one link resolves correctly either way — /workspace redirects an
// anonymous visitor on to /login via its own loader.
function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-6 text-center shadow-sm">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-primary text-on-primary">
          <ShieldIcon size={20} />
        </span>
        <h1 className="mt-3 text-2xl font-semibold">ไม่พบหน้านี้</h1>
        <p className="mt-2 text-sm text-foreground-secondary">
          ตรวจสอบที่อยู่หรือกลับไปยังพื้นที่ทำงาน
        </p>
        <Link
          to="/workspace"
          className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          ไปที่พื้นที่ทำงาน
        </Link>
      </div>
    </main>
  );
}

/**
 * Data-mode route table. Auth gating lives in loaders (lib/auth/loaders.ts)
 * with redirect rules identical to the old component guards; pages still
 * consume their data through useQuery hooks backed by the loader-prefetched
 * per-identity cache.
 */
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { path: "/", loader: rootLoader },
      { path: "/login", loader: requireAnonLoader, element: <LoginPage /> },
      {
        path: "/forgot-password",
        loader: requireAnonLoader,
        element: <ForgotPasswordPage />,
      },
      {
        path: "/reset-password",
        loader: requireAnonLoader,
        element: <ResetPasswordPage />,
      },
      {
        path: "/accept-invitation/:invitationId",
        element: <AcceptInvitationPage />,
      },
      // The two-factor plugin owns arrivals here via a full navigation;
      // the page applies its own challenge rules.
      { path: "/two-factor", element: <TwoFactorPage /> },
      // Resend hub for the not-yet-verified. Signup issues no session
      // before verification, so this page must stay reachable for
      // anonymous arrivals: it offers explicit, safe email entry itself
      // (see VerifyEmailPage).
      {
        path: "/verify-email",
        loader: verifyEmailLoader,
        element: <VerifyEmailPage />,
      },
      // Onboarding handles anonymous, unverified and token-carrying
      // arrivals itself, so it stays outside the loader gates.
      { path: "/onboarding", element: <OnboardingPage /> },
      // Authenticated app pages share the AppShell layout (header/sidebar/
      // main/footer — see components/shell/AppShell.tsx); each still runs
      // its own loader gate exactly as before nesting.
      {
        element: <AppShell />,
        children: [
          {
            path: "/workspace",
            loader: workspaceLoader,
            element: (
              <TenantProvider>
                <WorkspacePage />
              </TenantProvider>
            ),
          },
          {
            path: "/settings/security",
            loader: securitySettingsLoader,
            element: <SecuritySettingsPage />,
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
