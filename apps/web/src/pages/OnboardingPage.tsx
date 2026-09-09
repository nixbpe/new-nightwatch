import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { PostAuthRedirect } from "../components/guards";
import { Alert, FullPageLoading } from "../components/ui";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { ME_CONTEXT_QUERY_KEY } from "../lib/api/me";
import { readInvitation, rememberInvitation } from "../lib/auth/continuation";

type TokenPhase = "none" | "running" | "failed" | "done";

/**
 * Post-verification hub. The server's verification email links here as
 * /onboarding?emailVerificationToken=<token> (optionally carrying
 * &invitationId=<id> so a new-tab verification keeps the invitation).
 *
 * Contract: consume the token once, then redirect — to /login,
 * /verify-email, the explicit acceptance page /accept-invitation/:id, or the
 * workspace. Acceptance is never performed here; it stays an explicit user
 * action on the acceptance page. Holds all redirects until the token call and
 * session refetch settle so an in-flight callback is never unmounted.
 */
export function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const verificationToken = searchParams.get("emailVerificationToken");
  // Emailed-link continuation wins over same-tab storage; both are sanitized.
  const invitationParam = searchParams.get("invitationId");
  const invitationId =
    invitationParam !== null && /^[A-Za-z0-9_-]+$/.test(invitationParam)
      ? invitationParam
      : readInvitation();

  const [tokenPhase, setTokenPhase] = useState<TokenPhase>(
    verificationToken === null ? "none" : "running",
  );
  const [tokenError, setTokenError] = useState<string | null>(null);
  const tokenStarted = useRef(false);

  const {
    data: session,
    isPending: sessionPending,
    refetch: refetchSession,
  } = authClient.useSession();
  const user = session?.user;

  // Consume the emailed token exactly once; hold every redirect until the
  // verification call and the session refetch have settled. A rejection
  // renders a retry-safe error instead of bouncing away.
  useEffect(() => {
    if (verificationToken === null || tokenStarted.current) {
      return;
    }
    tokenStarted.current = true;
    void (async () => {
      const { error: verifyError } = await authClient.verifyEmail({
        query: { token: verificationToken, callbackURL: "/onboarding" },
      });
      const next = new URLSearchParams(searchParams);
      next.delete("emailVerificationToken");
      setSearchParams(next, { replace: true });
      if (verifyError != null) {
        setTokenError(
          authErrorMessage(
            verifyError,
            "ยืนยันอีเมลไม่สำเร็จ ลิงก์อาจหมดอายุหรือใช้ไปแล้ว",
          ),
        );
        setTokenPhase("failed");
        return;
      }
      await refetchSession();
      setTokenPhase("done");
    })();
  }, [verificationToken, searchParams, setSearchParams, refetchSession]);

  // Post-verification routing. Pure redirects: idempotent under StrictMode.
  useEffect(() => {
    if (tokenPhase === "running" || tokenPhase === "failed") {
      return;
    }
    if (sessionPending) {
      return;
    }
    if (user === undefined) {
      if (invitationId !== null) {
        rememberInvitation(invitationId);
      }
      void navigate("/login", { replace: true });
      return;
    }
    if (!user.emailVerified) {
      void navigate("/verify-email", { replace: true });
      return;
    }
    if (invitationId !== null) {
      rememberInvitation(invitationId);
      void navigate(`/accept-invitation/${invitationId}`, { replace: true });
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
  }, [tokenPhase, sessionPending, user, invitationId, navigate, queryClient]);

  if (tokenPhase === "running") {
    return <FullPageLoading label="กำลังยืนยันอีเมลของคุณ…" />;
  }

  if (tokenPhase === "failed") {
    return (
      <HubCard title="ยืนยันอีเมลไม่สำเร็จ">
        <div className="flex flex-col gap-4">
          <Alert tone="error">{tokenError}</Alert>
          <button
            type="button"
            className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={() => {
              void navigate("/verify-email", { replace: true });
            }}
          >
            ส่งอีเมลยืนยันใหม่
          </button>
          <button
            type="button"
            className="w-full rounded-md border border-control-border px-4 py-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={() => {
              void navigate("/login", { replace: true });
            }}
          >
            กลับไปเข้าสู่ระบบ
          </button>
        </div>
      </HubCard>
    );
  }

  if (!sessionPending && user?.emailVerified && invitationId === null) {
    return <PostAuthRedirect />;
  }

  // Every remaining outcome is a redirect handled by the routing effect.
  return <FullPageLoading label="กำลังตั้งค่าบัญชีของคุณ…" />;
}

function HubCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}
