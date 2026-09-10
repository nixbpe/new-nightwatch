import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { Navigate, useNavigate } from "react-router";

import {
  Alert,
  AuthPageShell,
  Field,
  FieldValidationError,
  Input,
  SubmitButton,
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
  const [status, setStatus] = useState<"idle" | "sent" | "failed">("idle");
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const signedIn = data !== null;

  // The email-verification callback lands here with a possibly stale session
  // snapshot; force one refresh so a just-verified user is not stuck.
  useEffect(() => {
    if (data !== null && !data.user.emailVerified) {
      void refetch();
    }
  }, [data, refetch]);

  const pendingInvitationId = signedIn ? null : readInvitation();
  const invitationPreview = useQuery({
    queryKey: invitationQueryKey(pendingInvitationId ?? ""),
    queryFn: () => fetchInvitation(pendingInvitationId ?? ""),
    enabled: pendingInvitationId !== null,
    retry: false,
  });

  const form = useForm({
    defaultValues: {
      email: data?.user.email ?? "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      const resolvedEmail =
        value.email.trim() === "" && data !== null
          ? data.user.email
          : value.email.trim();
      try {
        const { error: resendError } = await authClient.sendVerificationEmail({
          email: resolvedEmail,
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
    },
  });

  useEffect(() => {
    const invited = invitationPreview.data?.invitation;
    if (invited !== undefined && form.state.values.email === "") {
      form.setFieldValue("email", invited.email);
    }
  }, [form, invitationPreview.data]);

  if (isPending) {
    return null;
  }
  if (data !== null && data.user.emailVerified) {
    return <Navigate to="/onboarding" replace />;
  }

  const coolingDown = Date.now() < cooldownUntil;
  const subtitle =
    data === null
      ? "กรอกอีเมลที่ใช้สมัครบัญชี เราจะส่งลิงก์ยืนยันใหม่ให้คุณ"
      : `เราส่งลิงก์ยืนยันไปที่ ${data.user.email} กรุณาเปิดอีเมลแล้วคลิกลิงก์เพื่อดำเนินการต่อ`;

  return (
    <AuthPageShell title="ยืนยันอีเมลของคุณ" subtitle={subtitle}>
      {signedIn ? null : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
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
          <form.Field
            name="email"
            validators={{
              onChange: ({ value }) =>
                value.trim() === "" ? "กรุณากรอกอีเมล" : undefined,
              onSubmit: ({ value }) =>
                value.trim() === "" ? "กรุณากรอกอีเมล" : undefined,
            }}
          >
            {(field) => (
              <Field label="อีเมลที่ใช้สมัครบัญชี">
                <Input
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby={
                    field.state.meta.errors.length > 0
                      ? "verify-email-error"
                      : undefined
                  }
                />
                <FieldValidationError
                  id="verify-email-error"
                  errors={field.state.meta.errors}
                />
              </Field>
            )}
          </form.Field>
          <form.Subscribe
            selector={(state) => state.isSubmitting}
            children={(isSubmitting) => (
              <SubmitButton
                pending={isSubmitting}
                pendingLabel="กำลังส่ง…"
                disabled={isSubmitting || coolingDown}
              >
                ส่งอีเมลยืนยันอีกครั้ง
              </SubmitButton>
            )}
          />
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
          <form.Subscribe
            selector={(state) => state.isSubmitting}
            children={(isSubmitting) => (
              <button
                type="button"
                disabled={isSubmitting || coolingDown}
                onClick={() => {
                  void form.handleSubmit();
                }}
                className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting
                  ? "กำลังส่ง…"
                  : coolingDown
                    ? "ส่งแล้ว กรุณารอสักครู่"
                    : "ส่งอีเมลยืนยันอีกครั้ง"}
              </button>
            )}
          />
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
