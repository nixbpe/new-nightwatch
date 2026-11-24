import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { Link } from "react-router";

import { PostAuthRedirect } from "../components/PostAuthRedirect";
import {
  Alert,
  Field,
  FieldValidationError,
  FullPageLoading,
  Input,
  SubmitButton,
} from "../components/ui";
import { AuthPageFrame } from "../components/shell/AuthFrame";
import { OtpCodeInput } from "../components/ui/otp-code-input";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { TRUST_DEVICE_LIFETIME } from "../lib/auth/flow";

type ChallengeMode = "totp" | "recovery";

// No session exists until verification succeeds, so never render the workspace here. The app
// code is the default; the user switches to a recovery code explicitly, so the code is never
// routed by guessing its shape.
export function TwoFactorPage() {
  const { data, isPending } = authClient.useSession();
  const [error, setError] = useState<string | null>(null);
  // Set once verification succeeded: the page changes only after the session refetch.
  const [redirecting, setRedirecting] = useState(false);

  const form = useForm({
    defaultValues: {
      mode: "totp" as ChallengeMode,
      code: "",
      trustDevice: false,
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const args = {
          code: value.code.trim(),
          trustDevice: value.trustDevice,
        };
        const { error: verifyError } =
          value.mode === "recovery"
            ? await authClient.twoFactor.verifyBackupCode(args)
            : await authClient.twoFactor.verifyTotp(args);
        if (verifyError != null) {
          setError(
            authErrorMessage(
              verifyError,
              value.mode === "recovery"
                ? "รหัสกู้คืนไม่ถูกต้องหรือถูกใช้ไปแล้ว"
                : "รหัสยืนยันไม่ถูกต้อง",
            ),
          );
          return;
        }
        setRedirecting(true);
      } catch {
        setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  if (isPending) {
    return <FullPageLoading label="กำลังตรวจสอบเซสชัน…" />;
  }
  if (data !== null) {
    return <PostAuthRedirect />;
  }

  return (
    <AuthPageFrame
      data-testid="two-factor-page"
      eyebrow="// two-factor"
      title="ยืนยันสองขั้นตอน (MFA)"
      subtitle="กรอกรหัสยืนยันเพื่อเข้าสู่พื้นที่ทำงาน"
    >
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
          <Alert data-testid="two-factor-error" tone="error">
            {error}
          </Alert>
        )}
        <form.Subscribe selector={(state) => state.values.mode}>
          {(mode) => (
            <form.Field
              key={mode}
              name="code"
              validators={{
                onChange: ({ value }) =>
                  value.trim() === "" ? "กรุณากรอกรหัสยืนยัน" : undefined,
                onSubmit: ({ value }) =>
                  value.trim() === "" ? "กรุณากรอกรหัสยืนยัน" : undefined,
              }}
            >
              {(field) => (
                <Field
                  label={
                    mode === "recovery"
                      ? "รหัสกู้คืนบัญชี (ใช้ได้ครั้งเดียว)"
                      : "รหัสยืนยัน 6 หลักจากแอปยืนยันตัวตน"
                  }
                >
                  {mode === "recovery" ? (
                    // Recovery codes keep their exact text; only the TOTP field strips non-digits.
                    <Input
                      data-testid="two-factor-code"
                      type="text"
                      name="challenge-code"
                      autoFocus
                      autoComplete="off"
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                      aria-invalid={field.state.meta.errors.length > 0}
                      aria-describedby={
                        field.state.meta.errors.length > 0
                          ? "two-factor-recovery-error"
                          : undefined
                      }
                    />
                  ) : (
                    <OtpCodeInput
                      data-testid="two-factor-code"
                      name="challenge-code"
                      value={field.state.value}
                      onValueChange={field.handleChange}
                      onBlur={field.handleBlur}
                      aria-invalid={field.state.meta.errors.length > 0}
                      aria-describedby={
                        field.state.meta.errors.length > 0
                          ? "two-factor-totp-error"
                          : undefined
                      }
                    />
                  )}
                  <FieldValidationError
                    data-testid="two-factor-code-error"
                    id={
                      mode === "recovery"
                        ? "two-factor-recovery-error"
                        : "two-factor-totp-error"
                    }
                    errors={field.state.meta.errors}
                  />
                </Field>
              )}
            </form.Field>
          )}
        </form.Subscribe>
        <form.Field name="mode">
          {(modeField) => (
            <Button
              data-testid={
                modeField.state.value === "totp"
                  ? "two-factor-mode-recovery"
                  : "two-factor-mode-totp"
              }
              type="button"
              variant="link"
              size="quiet"
              className="self-start px-0"
              onClick={() => {
                modeField.handleChange(
                  modeField.state.value === "totp" ? "recovery" : "totp",
                );
                form.resetField("code");
                setError(null);
              }}
            >
              {modeField.state.value === "totp"
                ? "ใช้รหัสกู้คืนแทน"
                : "ใช้รหัสจากแอปยืนยันตัวตนแทน"}
            </Button>
          )}
        </form.Field>
        <form.Field name="trustDevice">
          {(field) => (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                data-testid="two-factor-trust-device"
                name="trust-device"
                checked={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.checked);
                }}
                onBlur={field.handleBlur}
              />
              {`เชื่อถืออุปกรณ์นี้ ${TRUST_DEVICE_LIFETIME} (จะไม่ต้องยืนยันอีกบนอุปกรณ์นี้)`}
            </label>
          )}
        </form.Field>
        <form.Subscribe
          selector={(state) => state.isSubmitting}
          children={(isSubmitting) => (
            <SubmitButton
              data-testid="two-factor-submit"
              pending={isSubmitting || redirecting}
              pendingLabel="กำลังยืนยัน…"
            >
              ยืนยัน
            </SubmitButton>
          )}
        />
        <Link
          to="/login"
          data-testid="two-factor-login"
          className="text-center text-sm text-primary underline"
        >
          กลับไปเข้าสู่ระบบ
        </Link>
      </form>
    </AuthPageFrame>
  );
}
