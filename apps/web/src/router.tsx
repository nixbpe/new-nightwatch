import {
  createBrowserRouter,
  Link,
  Outlet,
  useRevalidator,
  type RouteObject,
} from "react-router";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppShell } from "./components/shell/AppShell";
import { AuthEyebrow } from "./components/shell/AuthFrame";
import { AuthLayout } from "./components/shell/AuthLayout";
import { BrandMark } from "./components/shell/BrandMark";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import {
  auditLogEventLoader,
  auditLogLoader,
  monitorCreateLoader,
  monitorDetailLoader,
  monitorEditLoader,
  monitorsOverviewLoader,
  notificationSettingsLoader,
  notificationsLoader,
  organizationMembersLoader,
  requireAnonLoader,
  rootLoader,
  sessionsLoader,
  settingsIndexLoader,
  settingsLoader,
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
import { AuditEventPage } from "./pages/audit-log/AuditEventPage";
import { AuditLogPage } from "./pages/audit-log/AuditLogPage";
import { DetailPage } from "./pages/monitors/DetailPage";
import { MonitorFormPage } from "./pages/monitors/MonitorFormPage";
import { OverviewPage } from "./pages/monitors/OverviewPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { OrganizationNotificationSettingsPage } from "./pages/OrganizationNotificationSettingsPage";
import { OrganizationMembersPage } from "./pages/OrganizationMembersPage";
import { DisplayPage } from "./pages/settings/DisplayPage";
import { ProfilePage } from "./pages/settings/ProfilePage";
import { SecurityPage } from "./pages/settings/SecurityPage";
import { SessionsPage } from "./pages/settings/SessionsPage";
import { SettingsLayout } from "./pages/settings/SettingsLayout";
import { TwoFactorPage } from "./pages/TwoFactorPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { WorkspacePage } from "./pages/WorkspacePage";

// Lives outside the per-identity query boundary so auth transitions keep navigation state.
// An in-page sign-in/sign-out changes identity without navigating, so loaders must be re-run.
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

// Standalone, not under AppShell: anonymous visitors reach bad URLs too, and the shell's
// header would show misleading session state.
function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <BrandMark withName />
      <Card className="w-full max-w-md items-center p-6 text-center sm:p-8">
        <AuthEyebrow>{"// 404"}</AuthEyebrow>
        <h1 className="mt-2 text-[28px] leading-9 font-semibold text-heading">
          ไม่พบหน้านี้
        </h1>
        <p className="mt-2 text-sm text-foreground-secondary">
          ตรวจสอบที่อยู่หรือกลับไปยังพื้นที่ทำงาน
        </p>
        <Button asChild className="mt-6">
          <Link to="/workspace">ไปที่พื้นที่ทำงาน</Link>
        </Button>
      </Card>
    </main>
  );
}

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    hydrateFallbackElement: <div role="status">กำลังเปิดหน้า…</div>,
    children: [
      { path: "/", loader: rootLoader },
      {
        element: <AuthLayout />,
        children: [
          {
            path: "/login",
            loader: requireAnonLoader,
            element: <LoginPage />,
          },
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
          // The two-factor plugin arrives via a full navigation; the page applies its own challenge rules.
          { path: "/two-factor", element: <TwoFactorPage /> },
          // No loader gate: signup issues no session before verification, so anonymous arrivals must reach it.
          {
            path: "/verify-email",
            loader: verifyEmailLoader,
            element: <VerifyEmailPage />,
          },
          // Handles anonymous, unverified and token-carrying arrivals itself, so no loader gate.
          { path: "/onboarding", element: <OnboardingPage /> },
        ],
      },
      // TenantProvider wraps the shell: the org switcher, account menu and breadcrumb read the active org.
      {
        element: (
          <TenantProvider>
            <AppShell />
          </TenantProvider>
        ),
        children: [
          {
            path: "/workspace",
            loader: workspaceLoader,
            element: <WorkspacePage />,
          },
          {
            path: "/organizations/:organizationId/monitors",
            loader: monitorsOverviewLoader,
            element: <OverviewPage />,
          },
          {
            path: "/organizations/:organizationId/monitors/new",
            loader: monitorCreateLoader,
            element: <MonitorFormPage mode="create" />,
          },
          {
            path: "/organizations/:organizationId/monitors/:monitorId/edit",
            loader: monitorEditLoader,
            element: <MonitorFormPage mode="edit" />,
          },
          {
            path: "/organizations/:organizationId/monitors/:monitorId",
            loader: monitorDetailLoader,
            element: <DetailPage />,
          },
          {
            path: "/notifications",
            loader: notificationsLoader,
            element: <NotificationsPage />,
          },
          {
            path: "/organizations/:organizationId/notification-settings",
            loader: notificationSettingsLoader,
            element: <OrganizationNotificationSettingsPage />,
          },
          {
            path: "/organizations/:organizationId/members",
            loader: organizationMembersLoader,
            element: <OrganizationMembersPage />,
          },
          {
            path: "/organizations/:organizationId/audit-log",
            loader: auditLogLoader,
            element: <AuditLogPage />,
          },
          {
            path: "/organizations/:organizationId/audit-log/:eventId",
            loader: auditLogEventLoader,
            element: <AuditEventPage />,
          },
          // The layout loader gates the session and prefetches me/context for every tab.
          {
            path: "/settings",
            loader: settingsLoader,
            element: <SettingsLayout />,
            children: [
              { index: true, loader: settingsIndexLoader },
              { path: "profile", element: <ProfilePage /> },
              { path: "security", element: <SecurityPage /> },
              {
                path: "sessions",
                loader: sessionsLoader,
                element: <SessionsPage />,
              },
              { path: "display", element: <DisplayPage /> },
            ],
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
