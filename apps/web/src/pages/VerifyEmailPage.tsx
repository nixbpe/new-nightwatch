import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { Navigate, useNavigate } from "react-router";

import {
  Alert,
  Field,
  FieldValidationError,
  Input,
  SubmitButton,
} from "../components/ui";
import { AuthPageFrame } from "../components/shell/AuthFrame";
import { Button } from "../components/ui/button";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { fetchInvitation, invitationQueryKey } from "../lib/api/invitations";
import { readInvitation } from "../lib/auth/continuation";

const RESEND_COOLDOWN_MS = 60_000;

// Signup issues no session before verification, so arrivals may be anonymous and get an email form.
// The sent confirmation stays generic to avoid account enumeration.
export function VerifyEmailPage() {
  const navigate = useNavigate();
  const { data, isPending, refetch } = authClient.useSession();
  const [status, setStatus] = useState<"idle" | "sent" | "failed">("idle");
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const signedIn = data !== null;

  // The verification callback lands here with a possibly stale session; refresh once so the user isn't stuck.
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

  useEffect(() => {
    if (cooldownUntil === 0) {
      return;
    }

    const remainingMs = cooldownUntil - Date.now();
    if (remainingMs <= 0) {
      setCooldownUntil(0);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCooldownUntil((currentDeadline) =>
        currentDeadline === cooldownUntil ? 0 : currentDeadline,
      );
    }, remainingMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [cooldownUntil]);

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
    <AuthPageFrame
      data-testid="verify-email-page"
      subtitleTestId="verify-email-recipient"
      eyebrow="// verify email"
      title="ยืนยันอีเมลของคุณ"
      subtitle={subtitle}
    >
      <div className="flex flex-col gap-6">
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
            {error === null ? null : (
              <Alert data-testid="verify-email-resend-error" tone="error">
                {error}
              </Alert>
            )}
            {status === "sent" ? (
              <Alert data-testid="verify-email-sent" tone="success">
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
                    data-testid="verify-email-email"
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
                    data-testid="verify-email-field-error"
                    errors={field.state.meta.errors}
                  />
                </Field>
              )}
            </form.Field>
            <form.Subscribe
              selector={(state) => state.isSubmitting}
              children={(isSubmitting) => (
                <SubmitButton
                  data-testid="verify-email-resend"
                  pending={isSubmitting}
                  pendingLabel="กำลังส่ง…"
                  disabled={isSubmitting || coolingDown}
                >
                  {coolingDown
                    ? "ส่งแล้ว กรุณารอสักครู่"
                    : "ส่งอีเมลยืนยันอีกครั้ง"}
                </SubmitButton>
              )}
            />
          </form>
        )}
        {signedIn ? (
          <div className="flex flex-col gap-4">
            {error === null ? null : (
              <Alert data-testid="verify-email-resend-error" tone="error">
                {error}
              </Alert>
            )}
            {status === "sent" ? (
              <Alert data-testid="verify-email-sent" tone="success">
                ส่งอีเมลยืนยันใหม่แล้ว กรุณาตรวจสอบกล่องจดหมาย
                (รวมถึงโฟลเดอร์สแปม)
              </Alert>
            ) : null}
            <form.Subscribe
              selector={(state) => state.isSubmitting}
              children={(isSubmitting) => (
                <Button
                  data-testid="verify-email-resend"
                  type="button"
                  className="w-full"
                  disabled={isSubmitting || coolingDown}
                  onClick={() => {
                    void form.handleSubmit();
                  }}
                >
                  {isSubmitting
                    ? "กำลังส่ง…"
                    : coolingDown
                      ? "ส่งแล้ว กรุณารอสักครู่"
                      : "ส่งอีเมลยืนยันอีกครั้ง"}
                </Button>
              )}
            />
          </div>
        ) : null}
        <div className="flex items-center justify-between text-sm">
          {signedIn ? (
            <button
              data-testid="verify-email-sign-out"
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
              data-testid="verify-email-login"
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
            data-testid="verify-email-continue"
            type="button"
            className="text-primary underline"
            onClick={() => {
              void navigate("/onboarding", { replace: true });
            }}
          >
            ฉันยืนยันแล้ว ดำเนินการต่อ
          </button>
        </div>
      </div>
    </AuthPageFrame>
  );
}
