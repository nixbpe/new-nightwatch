import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Link } from "react-router";

import {
  Alert,
  AuthPageShell,
  Field,
  FieldValidationError,
  Input,
  SubmitButton,
} from "../components/ui";
import { authClient, authErrorMessage } from "../lib/auth-client";


export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      email: "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const { error: requestError } = await authClient.requestPasswordReset({
          email: value.email.trim(),
          redirectTo: "/reset-password",
        });
        // Always show the same confirmation to avoid account enumeration.
        if (requestError != null) {
          setError(authErrorMessage(requestError, "ส่งอีเมลไม่สำเร็จ"));
          return;
        }
        setSent(true);
      } catch {
        setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  return (
    <AuthPageShell
      title="ลืมรหัสผ่าน"
      subtitle="กรอกอีเมลที่ใช้เข้าสู่ระบบ เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้คุณ"
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">
            หากอีเมลนี้มีบัญชีในระบบ เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้โดยเร็ว
          </Alert>
          <Link
            to="/login"
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
          {error === null ? null : <Alert tone="error">{error}</Alert>}
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
              >
                ส่งลิงก์ตั้งรหัสผ่านใหม่
              </SubmitButton>
            )}
          />
          <p className="text-center text-sm">
            <Link to="/login" className="text-primary underline">
              กลับไปเข้าสู่ระบบ
            </Link>
          </p>
        </form>
      )}
    </AuthPageShell>
  );
}
