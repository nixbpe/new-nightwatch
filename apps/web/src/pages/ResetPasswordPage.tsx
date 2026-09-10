import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate, useSearchParams } from "react-router";

import {
  Alert,
  AuthPageShell,
  Field,
  FieldValidationError,
  Input,
  SubmitButton,
} from "../components/ui";
import { authClient, authErrorMessage } from "../lib/auth-client";

/**
 * Target of the reset-password email link: /reset-password?token=<token>.
 * The token is submitted with the new password and consumed atomically by
 * the server — a missing, expired, or replayed token is refused with a
 * safe error and a path to request a fresh link.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      password: "",
      confirm: "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      if (token === null) {
        return;
      }
      if (value.password !== value.confirm) {
        setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
        return;
      }
      try {
        const { error: resetError } = await authClient.resetPassword({
          newPassword: value.password,
          token,
        });
        if (resetError != null) {
          setError(authErrorMessage(resetError, "ตั้งรหัสผ่านใหม่ไม่สำเร็จ"));
          return;
        }
        void navigate("/login", { replace: true });
      } catch {
        setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  if (token === null) {
    return (
      <AuthPageShell title="ตั้งรหัสผ่านใหม่">
        <div className="flex flex-col gap-4">
          <Alert tone="error">
            ลิงก์นี้ไม่ถูกต้องหรือไม่สมบูรณ์
            กรุณาขอลิงก์ตั้งรหัสผ่านใหม่จากอีเมล
          </Alert>
          <Link
            to="/forgot-password"
            className="w-full rounded-md bg-primary px-4 py-2.5 text-center font-medium text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            ขอลิงก์ใหม่
          </Link>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell
      title="ตั้งรหัสผ่านใหม่"
      subtitle="เลือกรหัสผ่านใหม่ที่ปลอดภัยสำหรับบัญชีของคุณ"
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
          <Alert tone="error">
            {error}{" "}
            <Link to="/forgot-password" className="font-medium underline">
              ขอลิงก์ใหม่
            </Link>
          </Alert>
        )}
        <form.Field
          name="password"
          validators={{
            onChange: ({ value }) => {
              if (value.trim() === "") {
                return "กรุณากรอกรหัสผ่านใหม่";
              }
              if (value.length < 8) {
                return "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร";
              }
              return undefined;
            },
            onSubmit: ({ value }) => {
              if (value.trim() === "") {
                return "กรุณากรอกรหัสผ่านใหม่";
              }
              if (value.length < 8) {
                return "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร";
              }
              return undefined;
            },
          }}
        >
          {(field) => (
            <Field label="รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)">
              <Input
                type="password"
                name="new-password"
                autoComplete="new-password"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.errors.length > 0}
                aria-describedby={
                  field.state.meta.errors.length > 0
                    ? "reset-password-password-error"
                    : undefined
                }
              />
              <FieldValidationError
                id="reset-password-password-error"
                errors={field.state.meta.errors}
              />
            </Field>
          )}
        </form.Field>
        <form.Field
          name="confirm"
          validators={{
            onChange: ({ value }) => {
              if (value.trim() === "") {
                return "กรุณายืนยันรหัสผ่านใหม่";
              }
              if (value.length < 8) {
                return "รหัสผ่านยืนยันต้องมีอย่างน้อย 8 ตัวอักษร";
              }
              return undefined;
            },
            onSubmit: ({ value }) => {
              if (value.trim() === "") {
                return "กรุณายืนยันรหัสผ่านใหม่";
              }
              if (value.length < 8) {
                return "รหัสผ่านยืนยันต้องมีอย่างน้อย 8 ตัวอักษร";
              }
              return undefined;
            },
          }}
        >
          {(field) => (
            <Field label="ยืนยันรหัสผ่านใหม่">
              <Input
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.errors.length > 0}
                aria-describedby={
                  field.state.meta.errors.length > 0
                    ? "reset-password-confirm-error"
                    : undefined
                }
              />
              <FieldValidationError
                id="reset-password-confirm-error"
                errors={field.state.meta.errors}
              />
            </Field>
          )}
        </form.Field>
        <form.Subscribe
          selector={(state) => state.isSubmitting}
          children={(isSubmitting) => (
            <SubmitButton pending={isSubmitting} pendingLabel="กำลังบันทึก…">
              บันทึกรหัสผ่านใหม่
            </SubmitButton>
          )}
        />
      </form>
    </AuthPageShell>
  );
}
