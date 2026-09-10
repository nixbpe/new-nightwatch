import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { PostAuthRedirect } from "../components/PostAuthRedirect";
import {
  Alert,
  AuthPageShell,
  Field,
  FieldValidationError,
  FullPageLoading,
  Input,
  SubmitButton,
} from "../components/ui";
import { authClient, authErrorMessage } from "../lib/auth-client";

type ChallengeMode = "totp" | "recovery";

const MODE_OPTIONS: ReadonlyArray<{
  value: ChallengeMode;
  label: string;
}> = [
  { value: "totp", label: "รหัสจากแอปยืนยันตัวตน (TOTP)" },
  { value: "recovery", label: "รหัสกู้คืนบัญชี (ใช้ได้ครั้งเดียว)" },
];

/**
 * Second-factor challenge after sign-in. Reached via twoFactorClient's
 * onTwoFactorRedirect; while the challenge is pending the server issues no
 * session, so this page must render the challenge (and never the workspace)
 * until verification succeeds. The user picks the mode explicitly — the code
 * is never routed by guessing its shape.
 */
export function TwoFactorPage() {
  const { data, isPending } = authClient.useSession();
  const [error, setError] = useState<string | null>(null);

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
        }
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
    <AuthPageShell
      title="ยืนยันตัวตนสองขั้นตอน"
      subtitle="เลือกวิธียืนยันและกรอกรหัสเพื่อเข้าสู่พื้นที่ทำงาน"
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
        {error === null ? null : <Alert tone="error">{error}</Alert>}
        <form.Field name="mode">
          {(modeField) => (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">วิธียืนยัน</legend>
              {MODE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="challenge-mode"
                    value={option.value}
                    checked={modeField.state.value === option.value}
                    onChange={() => {
                      modeField.handleChange(option.value);
                      form.resetField("code");
                      setError(null);
                    }}
                    className="size-4 accent-[var(--primary)]"
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
          )}
        </form.Field>
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
                      ? "รหัสกู้คืนบัญชี"
                      : "รหัสยืนยัน 6 หลัก"
                  }
                >
                  <Input
                    type="text"
                    name="challenge-code"
                    inputMode={mode === "recovery" ? "text" : "numeric"}
                    autoComplete={mode === "recovery" ? "off" : "one-time-code"}
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                    }}
                    onBlur={field.handleBlur}
                    aria-invalid={field.state.meta.errors.length > 0}
                    aria-describedby={
                      field.state.meta.errors.length > 0
                        ? mode === "recovery"
                          ? "two-factor-recovery-error"
                          : "two-factor-totp-error"
                        : undefined
                    }
                  />
                  <FieldValidationError
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
        <form.Field name="trustDevice">
          {(field) => (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="trust-device"
                checked={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.checked);
                }}
                onBlur={field.handleBlur}
                className="size-4 rounded border-control-border accent-[var(--primary)]"
              />
              เชื่อถืออุปกรณ์นี้ (จะไม่ต้องยืนยันอีกบนอุปกรณ์นี้)
            </label>
          )}
        </form.Field>
        <form.Subscribe
          selector={(state) => state.isSubmitting}
          children={(isSubmitting) => (
            <SubmitButton pending={isSubmitting} pendingLabel="กำลังยืนยัน…">
              ยืนยัน
            </SubmitButton>
          )}
        />
      </form>
    </AuthPageShell>
  );
}
