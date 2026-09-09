import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type SubmitEvent } from "react";
import { Navigate, useNavigate } from "react-router";

import {
  Alert,
  AuthPageShell,
  Field,
  SubmitButton,
  textInputClass,
} from "../components/ui";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { fetchInvitation, invitationQueryKey } from "../lib/api/invitations";
import { readInvitation } from "../lib/auth/continuation";

const RESEND_COOLDOWN_MS = 60_000;

/**
 * Resend hub for not-yet-verified accounts. Signup issues no session before
 * the email is verified (and unverified sign-in is refused), so a freshly
 * signed-up invitation holder arrives here anonymous. Signed-in users resend
 * to their session email; anonymous visitors get an explicit, safe email
 * entry form — prefilled from the remembered pending invitation when one
 * exists — so the resend affordance is reachable on the real flow.
 *
 * The sent confirmation stays generic (no account enumeration); any pending
 * invitation continuation is carried into the verification callback target
 * and consumed by /onboarding.
 */
export function VerifyEmailPage() {
  const navigate = useNavigate();
  const { data, isPending, refetch } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "failed">(
    "idle",
  );
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const signedIn = data !== null;

  // The email-verification callback lands here with a possibly stale session
  // snapshot; force one refresh so a just-verified user is not stuck.
  useEffect(() => {
    if (data !== null && !data.user.emailVerified) {
      void refetch();
    }
    // Run once per mount; the guards already loop-protect the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Anonymous + remembered invitation: prefill the invited email from the
  // public preview (unknown/expired invitations safely yield no prefill).
  const pendingInvitationId = signedIn ? null : readInvitation();
  const invitationPreview = useQuery({
    queryKey: invitationQueryKey(pendingInvitationId ?? ""),
    queryFn: () => fetchInvitation(pendingInvitationId ?? ""),
    enabled: pendingInvitationId !== null,
    retry: false,
  });
  useEffect(() => {
    const invited = invitationPreview.data?.invitation;
    if (invited !== undefined && email === "") {
      setEmail(invited.email);
    }
    // Prefill once per loaded preview; later edits are the user's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitationPreview.data]);

  if (isPending) {
    return null;
  }
  if (data !== null && data.user.emailVerified) {
    return <Navigate to="/onboarding" replace />;
  }

  const targetEmail = signedIn ? data.user.email : email.trim();
  const coolingDown = Date.now() < cooldownUntil;

  async function resend() {
    if (status === "sending" || coolingDown) {
      return;
    }
    if (targetEmail === "") {
      return;
    }
    setError(null);
    setStatus("sending");
    try {
      // Keep the pending invitation in the callback target as well as in
      // same-tab storage, so verification can resume it even in a new tab
      // (the server forwards it into the emailed link when supported).
      const { error: resendError } = await authClient.sendVerificationEmail({
        email: targetEmail,
        callbackURL:
          pendingInvitationId === null
            ? "/onboarding"
            : `/onboarding?invitationId=${pendingInvitationId}`,
      });
      if (resendError != null) {
        setError(authErrorMessage(resendError, "ส่งอีเมลยืนยันไม่สำเร็จ"));
        setStatus("failed");
        return;
      }
      setStatus("sent");
      setCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
    } catch {
      setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      setStatus("failed");
    }
  }

  return (
    <AuthPageShell
      title="ยืนยันอีเมลของคุณ"
      subtitle={
        signedIn
          ? `เราส่งลิงก์ยืนยันไปที่ ${targetEmail} กรุณาเปิดอีเมลแล้วคลิกลิงก์เพื่อดำเนินการต่อ`
          : "กรอกอีเมลที่ใช้สมัครบัญชี เราจะส่งลิงก์ยืนยันใหม่ให้คุณ"
      }
    >
      {signedIn ? null : (
        <form
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            void resend();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          {error === null ? null : <Alert tone="error">{error}</Alert>}
          {status === "sent" ? (
            <Alert tone="success">
              ส่งอีเมลยืนยันใหม่แล้ว กรุณาตรวจสอบกล่องจดหมาย
              (รวมถึงโฟลเดอร์สแปม)
            </Alert>
          ) : null}
          <Field label="อีเมลที่ใช้สมัครบัญชี">
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              className={textInputClass}
            />
          </Field>
          <SubmitButton
            pending={status === "sending"}
            pendingLabel="กำลังส่ง…"
            disabled={email.trim() === ""}
          >
            ส่งอีเมลยืนยันอีกครั้ง
          </SubmitButton>
        </form>
      )}
      {signedIn ? (
        <div className="flex flex-col gap-4">
          {error === null ? null : <Alert tone="error">{error}</Alert>}
          {status === "sent" ? (
            <Alert tone="success">
              ส่งอีเมลยืนยันใหม่แล้ว กรุณาตรวจสอบกล่องจดหมาย
              (รวมถึงโฟลเดอร์สแปม)
            </Alert>
          ) : null}
          <button
            type="button"
            disabled={status === "sending" || coolingDown}
            onClick={() => void resend()}
            className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "sending"
              ? "กำลังส่ง…"
              : coolingDown
                ? "ส่งแล้ว กรุณารอสักครู่"
                : "ส่งอีเมลยืนยันอีกครั้ง"}
          </button>
        </div>
      ) : null}
      <div className="flex items-center justify-between text-sm">
        {signedIn ? (
          <button
            type="button"
            className="text-foreground-secondary underline"
            onClick={() => {
              void authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    void navigate("/login", { replace: true });
                  },
                },
              });
            }}
          >
            ออกจากระบบ
          </button>
        ) : (
          <button
            type="button"
            className="text-foreground-secondary underline"
            onClick={() => {
              void navigate("/login", { replace: true });
            }}
          >
            กลับไปเข้าสู่ระบบ
          </button>
        )}
        <button
          type="button"
          className="text-primary underline"
          onClick={() => {
            void navigate("/onboarding", { replace: true });
          }}
        >
          ฉันยืนยันแล้ว — ดำเนินการต่อ
        </button>
      </div>
    </AuthPageShell>
  );
}
