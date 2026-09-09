import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { authClient } from "../lib/auth-client";
import {
  clearReturnTo,
  readInvitation,
  readReturnTo,
} from "../lib/auth/continuation";
import { FullPageLoading } from "./ui";

/** Bounces anonymous visitors to /login, remembering the intended path. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  const location = useLocation();

  if (isPending) {
    return <FullPageLoading label="กำลังตรวจสอบเซสชัน…" />;
  }
  if (data === null) {
    const from = location.pathname + location.search;
    return (
      <Navigate
        to="/login"
        state={{ from: from === "/" ? "/workspace" : from }}
        replace
      />
    );
  }
  return <>{children}</>;
}

/**
 * Verified-email gate for authenticated areas. The session snapshot can be
 * stale right after the email-verification callback lands on /onboarding,
 * so an unverified flag triggers exactly one forced refetch before bouncing
 * to the resend page — no redirect loop between guards.
 */
export function RequireVerified({ children }: { children: ReactNode }) {
  const { data, isPending, refetch } = authClient.useSession();
  const [rechecked, setRechecked] = useState(false);

  const unverified = data !== null && !data.user.emailVerified;

  useEffect(() => {
    if (unverified && !rechecked) {
      setRechecked(true);
      void refetch();
    }
  }, [unverified, rechecked, refetch]);

  if (isPending || (unverified && !rechecked)) {
    return <FullPageLoading label="กำลังตรวจสอบสถานะอีเมล…" />;
  }
  if (unverified) {
    return <Navigate to="/verify-email" replace />;
  }
  return <>{children}</>;
}

/** Resolves the continuation once, consuming only the return path after commit. */
export function PostAuthRedirect() {
  const navigate = useNavigate();
  const [destination] = useState(() =>
    readInvitation() === null ? readReturnTo() : "/onboarding",
  );

  useEffect(() => {
    clearReturnTo();
    void navigate(destination, { replace: true });
  }, [destination, navigate]);

  return <FullPageLoading label="กำลังเข้าสู่ระบบ…" />;
}

/** Keeps signed-in users out of anonymous-only pages (login, signup, forgot password). */
export function RequireAnon({ children }: { children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  if (isPending) {
    return <FullPageLoading label="กำลังตรวจสอบเซสชัน…" />;
  }
  if (data !== null) {
    return <PostAuthRedirect />;
  }
  return <>{children}</>;
}
