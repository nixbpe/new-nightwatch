import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { RequireAnon, RequireAuth, RequireVerified } from "./components/guards";
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

export function App() {
  return (
    <ErrorBoundary>
      {/* BrowserRouter lives outside the per-identity query boundary so
          auth transitions never invalidate navigation or pending
          invitation flows. */}
      <BrowserRouter>
        <SessionQueryProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/workspace" replace />} />
            <Route
              path="/login"
              element={
                <RequireAnon>
                  <LoginPage />
                </RequireAnon>
              }
            />
            <Route
              path="/forgot-password"
              element={
                <RequireAnon>
                  <ForgotPasswordPage />
                </RequireAnon>
              }
            />
            <Route
              path="/reset-password"
              element={
                <RequireAnon>
                  <ResetPasswordPage />
                </RequireAnon>
              }
            />
            <Route
              path="/accept-invitation/:invitationId"
              element={<AcceptInvitationPage />}
            />
            <Route path="/two-factor" element={<TwoFactorPage />} />
            {/* Resend hub for the not-yet-verified. Signup issues no
                session before verification, so this page must stay
                reachable for anonymous arrivals: it offers explicit,
                safe email entry itself (see VerifyEmailPage). */}
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            {/* Onboarding handles anonymous, unverified and token-carrying
                arrivals itself, so it stays outside the auth guards. */}
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route
              path="/workspace"
              element={
                <RequireAuth>
                  <RequireVerified>
                    <TenantProvider>
                      <WorkspacePage />
                    </TenantProvider>
                  </RequireVerified>
                </RequireAuth>
              }
            />
            <Route
              path="/settings/security"
              element={
                <RequireAuth>
                  <RequireVerified>
                    <SecuritySettingsPage />
                  </RequireVerified>
                </RequireAuth>
              }
            />
            <Route
              path="*"
              element={
                <main className="flex min-h-screen items-center justify-center p-4">
                  <div className="w-full max-w-md rounded-lg bg-surface p-6 text-center shadow-sm">
                    <h1 className="text-2xl font-semibold">ไม่พบหน้านี้</h1>
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
              }
            />
          </Routes>
        </SessionQueryProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
