import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Link } from "react-router";

import {
  Alert,
  Field,
  FieldValidationError,
  Input,
  SubmitButton,
} from "../components/ui";
import { AuthPageFrame } from "../components/shell/AuthFrame";
import { Button } from "../components/ui/button";
import { Notice } from "../components/ui/notice";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { RESET_LINK_LIFETIME } from "../lib/auth/flow";
import { useResendCooldown } from "../lib/auth/useResendCooldown";

export function ForgotPasswordPage() {
  // The address the user typed; the confirmation echoes it back and resend reuses it.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const cooldown = useResendCooldown();

  async function requestLink(email: string): Promise<boolean> {
    setError(null);
    try {
      const { error: requestError } = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      // Always show the same confirmation to avoid account enumeration.
      if (requestError != null) {
        setError(authErrorMessage(requestError, "ส่งอีเมลไม่สำเร็จ"));
        return false;
      }
      cooldown.start();
      return true;
    } catch {
      setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      return false;
    }
  }

  const form = useForm({
    defaultValues: {
      email: "",
    },
    onSubmit: async ({ value }) => {
      const email = value.email.trim();
      if (await requestLink(email)) {
        setSentTo(email);
      }
    },
  });

  return (
    <AuthPageFrame
      eyebrow="// forgot password"
      title="ลืมรหัสผ่าน"
      subtitle="กรอกอีเมลที่ใช้เข้าสู่ระบบ เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้คุณ"
    >
      {sentTo !== null ? (
        <div className="flex flex-col gap-4">
          {error === null ? null : (
            <Alert data-testid="forgot-password-error" tone="error">
              {error}
            </Alert>
          )}
          <Notice
            tone="success"
            data-testid="forgot-password-success"
            className="items-start break-words"
          >
            {`หากอีเมล ${sentTo} มีบัญชีในระบบ เราจะส่งลิงก์ที่ใช้ได้ ${RESET_LINK_LIFETIME} ตรวจโฟลเดอร์สแปมด้วย`}
          </Notice>
          <Button
            data-testid="forgot-password-resend"
            type="button"
            variant="secondary"
            className="w-full"
            disabled={resending || cooldown.secondsLeft > 0}
            onClick={() => {
              setResending(true);
              void requestLink(sentTo).finally(() => {
                setResending(false);
              });
            }}
          >
            {resending
              ? "กำลังส่ง…"
              : cooldown.secondsLeft > 0
                ? `ส่งใหม่ได้ในอีก ${String(cooldown.secondsLeft)} วินาที`
                : "ส่งอีกครั้ง"}
          </Button>
          <Link
            to="/login"
            data-testid="forgot-password-login"
            className="text-center text-sm text-primary underline"
          >
            กลับไปเข้าสู่ระบบ
          </Link>
        </div>
      ) : (
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
            <Alert data-testid="forgot-password-error" tone="error">
              {error}
            </Alert>
          )}
          <form.Field
            name="email"
            validators={{
              onChange: ({ value }) => {
                if (value.trim() === "") {
                  return "กรุณากรอกอีเมล";
                }
                return undefined;
              },
              onSubmit: ({ value }) =>
                value.trim() === "" ? "กรุณากรอกอีเมล" : undefined,
            }}
          >
            {(field) => (
              <Field label="อีเมล">
                <Input
                  data-testid="forgot-password-email"
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
                      ? "forgot-password-email-error"
                      : undefined
                  }
                />
                <FieldValidationError
                  id="forgot-password-email-error"
                  data-testid="forgot-password-email-error"
                  errors={field.state.meta.errors}
                />
              </Field>
            )}
          </form.Field>
          <form.Subscribe
            selector={(state) => state.isSubmitting}
            children={(isSubmitting) => (
              <SubmitButton
                data-testid="forgot-password-submit"
                pending={isSubmitting}
                pendingLabel="กำลังส่ง…"
              >
                ส่งลิงก์ตั้งรหัสผ่านใหม่
              </SubmitButton>
            )}
          />
          <p className="text-center text-sm">
            <Link
              data-testid="forgot-password-login"
              to="/login"
              className="text-primary underline"
            >
              กลับไปเข้าสู่ระบบ
            </Link>
          </p>
        </form>
      )}
    </AuthPageFrame>
  );
}
