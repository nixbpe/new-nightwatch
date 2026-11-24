import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { Navigate, useLocation, useNavigate } from "react-router";

import {
  Alert,
  Field,
  FieldValidationError,
  FullPageLoading,
  Input,
  SubmitButton,
} from "../components/ui";
import { AuthPageFrame } from "../components/shell/AuthFrame";
import { Button } from "../components/ui/button";
import { Notice } from "../components/ui/notice";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { fetchInvitation, invitationQueryKey } from "../lib/api/invitations";
import { readInvitation } from "../lib/auth/continuation";
import {
  readAuthFlowState,
  VERIFICATION_LINK_LIFETIME,
} from "../lib/auth/flow";
import { useResendCooldown } from "../lib/auth/useResendCooldown";

// Signup issues no session before verification, so arrivals may be anonymous and get an email form.
// The sent confirmation stays generic to avoid account enumeration.
export function VerifyEmailPage() {
  const session = authClient.useSession();
  return (
    <VerificationForm
      key={
        session.data === null
          ? "anonymous"
          : `${session.data.user.id}:${session.data.user.email}`
      }
      session={session}
    />
  );
}

// Reset identity-owned feedback and pending completions when the session owner changes.
function VerificationForm({
  session,
}: {
  session: ReturnType<typeof authClient.useSession>;
}) {
  const navigate = useNavigate();
  const flow = readAuthFlowState(useLocation().state);
  const { data, isPending, refetch } = session;
  const [status, setStatus] = useState<"idle" | "sent" | "failed">("idle");
  const cooldown = useResendCooldown();
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkState, setCheckState] = useState<"idle" | "done" | "failed">(
    "idle",
  );

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
      email: data?.user.email ?? flow.email ?? "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      const resolvedEmail =
        data !== null ? data.user.email : value.email.trim();
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
        cooldown.start();
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

  async function checkVerification() {
    setChecking(true);
    setCheckState("idle");
    try {
      // Better Auth resolves refetch even on HTTP failure; session.error owns that result.
      await refetch();
      setCheckState("done");
    } catch {
      setCheckState("failed");
    } finally {
      setChecking(false);
    }
  }

  const checkFailed =
    checkState === "failed" || (checkState === "done" && session.error != null);

  if (isPending) {
    return (
      <FullPageLoading
        data-testid="verify-email-loading"
        label="กำลังตรวจสอบเซสชัน…"
      />
    );
  }
  if (data !== null && data.user.emailVerified) {
    return <Navigate to="/onboarding" replace />;
  }

  const coolingDown = cooldown.secondsLeft > 0;
  const resendLabel = coolingDown
    ? `ส่งใหม่ได้ในอีก ${String(cooldown.secondsLeft)} วินาที`
    : "ส่งอีเมลยืนยันอีกครั้ง";
  // Only a hand-off from signup may claim an email was sent; a login refusal carries the address alone.
  const signupEmail =
    data === null && flow.sent === true ? flow.email : undefined;
  const justSignedUp = signupEmail !== undefined;
  const lifetime = `ลิงก์ใช้ได้ ${VERIFICATION_LINK_LIFETIME} ตรวจโฟลเดอร์สแปมด้วย`;
  const subtitle =
    data !== null
      ? `เราส่งลิงก์ยืนยันไปที่ ${data.user.email} กรุณาเปิดอีเมลแล้วคลิกลิงก์เพื่อดำเนินการต่อ ${lifetime}`
      : justSignedUp
        ? `เราส่งลิงก์ยืนยันไปที่ ${signupEmail} แล้ว กรุณาเปิดอีเมลแล้วคลิกลิงก์เพื่อดำเนินการต่อ ${lifetime}`
        : "กรอกอีเมลที่ใช้สมัครบัญชี เราจะส่งลิงก์ยืนยันใหม่ให้คุณ";

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
              <Notice tone="success" data-testid="verify-email-sent">
                ส่งอีเมลยืนยันใหม่แล้ว กรุณาตรวจสอบกล่องจดหมาย
                (รวมถึงโฟลเดอร์สแปม)
              </Notice>
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
                  variant={justSignedUp ? "secondary" : "default"}
                >
                  {resendLabel}
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
              <Notice tone="success" data-testid="verify-email-sent">
                ส่งอีเมลยืนยันใหม่แล้ว กรุณาตรวจสอบกล่องจดหมาย
                (รวมถึงโฟลเดอร์สแปม)
              </Notice>
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
                  {isSubmitting ? "กำลังส่ง…" : resendLabel}
                </Button>
              )}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-3">
          {checkFailed ? (
            <Alert data-testid="verify-email-check-error" tone="error">
              ตรวจสอบการยืนยันไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
            </Alert>
          ) : checkState === "done" ? (
            <Alert
              data-testid="verify-email-not-verified"
              tone="info"
              role="status"
            >
              ยังไม่พบการยืนยัน กรุณาเปิดลิงก์ในอีเมลก่อน
            </Alert>
          ) : null}
          {signedIn ? (
            <Button
              data-testid="verify-email-continue"
              type="button"
              variant="secondary"
              className="w-full"
              disabled={checking}
              onClick={() => {
                void checkVerification();
              }}
            >
              {checking ? "กำลังตรวจสอบ…" : "ฉันยืนยันแล้ว ดำเนินการต่อ"}
            </Button>
          ) : (
            <Button
              data-testid="verify-email-login"
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => {
                void navigate("/login", { replace: true });
              }}
            >
              ไปเข้าสู่ระบบ
            </Button>
          )}
          {signedIn ? (
            <Button
              data-testid="verify-email-sign-out"
              type="button"
              variant="link"
              size="quiet"
              className="self-center text-foreground-secondary underline"
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
            </Button>
          ) : null}
        </div>
      </div>
    </AuthPageFrame>
  );
}
