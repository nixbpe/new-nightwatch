import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate, useSearchParams } from "react-router";

import { Alert, FieldValidationError, SubmitButton } from "../components/ui";
import { AuthPageFrame } from "../components/shell/AuthFrame";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { PasswordInput } from "../components/ui/password-input";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { RESET_LINK_LIFETIME, type AuthFlowState } from "../lib/auth/flow";

function confirmMismatch(confirm: string, password: string) {
  return confirm === password ? undefined : "รหัสผ่านทั้งสองช่องไม่ตรงกัน";
}

// The server consumes the token atomically and refuses missing, expired or replayed tokens.
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [error, setError] = useState<string | null>(null);
  const [linkDead, setLinkDead] = useState(false);

  const form = useForm({
    defaultValues: {
      password: "",
      confirm: "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      setLinkDead(false);
      if (token === null) {
        return;
      }
      try {
        const { error: resetError } = await authClient.resetPassword({
          newPassword: value.password,
          token,
        });
        if (resetError != null) {
          setError(authErrorMessage(resetError, "ตั้งรหัสผ่านใหม่ไม่สำเร็จ"));
          setLinkDead(
            resetError.code === "INVALID_TOKEN" ||
              resetError.code === "TOKEN_EXPIRED",
          );
          return;
        }
        void navigate("/login", {
          replace: true,
          state: { notice: "password-reset" } satisfies AuthFlowState,
        });
      } catch {
        setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  if (token === null) {
    return (
      <AuthPageFrame eyebrow="// reset password" title="ตั้งรหัสผ่านใหม่">
        <div className="flex flex-col gap-4">
          <Alert data-testid="reset-password-invalid-link" tone="error">
            ลิงก์นี้ไม่ถูกต้องหรือไม่สมบูรณ์
            กรุณาขอลิงก์ตั้งรหัสผ่านใหม่จากอีเมล
          </Alert>
          <Button asChild className="w-full">
            <Link
              data-testid="reset-password-request-link"
              to="/forgot-password"
            >
              ขอลิงก์ใหม่
            </Link>
          </Button>
        </div>
      </AuthPageFrame>
    );
  }

  return (
    <AuthPageFrame
      eyebrow="// reset password"
      title="ตั้งรหัสผ่านใหม่"
      subtitle={`เลือกรหัสผ่านใหม่ที่ปลอดภัยสำหรับบัญชีของคุณ ลิงก์นี้ใช้ได้ ${RESET_LINK_LIFETIME}`}
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
          <Alert data-testid="reset-password-error" tone="error">
            {error}
            {linkDead ? (
              <>
                {" "}
                <Link
                  data-testid="reset-password-request-link"
                  to="/forgot-password"
                  className="font-medium underline"
                >
                  ขอลิงก์ใหม่
                </Link>
              </>
            ) : null}
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
            <div>
              <Label htmlFor="reset-password-password" className="mb-2 block">
                รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)
              </Label>
              <PasswordInput
                id="reset-password-password"
                data-testid="reset-password-password"
                toggleTestId="reset-password-password-toggle"
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
                data-testid="reset-password-password-error"
                errors={field.state.meta.errors}
              />
            </div>
          )}
        </form.Field>
        <form.Field
          name="confirm"
          validators={{
            onChangeListenTo: ["password"],
            onChange: ({ value, fieldApi }) =>
              value === ""
                ? undefined
                : confirmMismatch(
                    value,
                    fieldApi.form.getFieldValue("password"),
                  ),
            onSubmit: ({ value, fieldApi }) =>
              value.trim() === ""
                ? "กรุณายืนยันรหัสผ่านใหม่"
                : confirmMismatch(
                    value,
                    fieldApi.form.getFieldValue("password"),
                  ),
          }}
        >
          {(field) => (
            <div>
              <Label htmlFor="reset-password-confirm" className="mb-2 block">
                ยืนยันรหัสผ่านใหม่
              </Label>
              <PasswordInput
                id="reset-password-confirm"
                data-testid="reset-password-confirm"
                toggleTestId="reset-password-confirm-toggle"
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
                data-testid="reset-password-confirm-error"
                errors={field.state.meta.errors}
              />
            </div>
          )}
        </form.Field>
        <form.Subscribe
          selector={(state) => state.isSubmitting}
          children={(isSubmitting) => (
            <SubmitButton
              data-testid="reset-password-submit"
              pending={isSubmitting}
              pendingLabel="กำลังบันทึก…"
            >
              บันทึกรหัสผ่านใหม่
            </SubmitButton>
          )}
        />
      </form>
    </AuthPageFrame>
  );
}
