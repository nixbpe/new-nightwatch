import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate, useSearchParams } from "react-router";

import { Alert, SubmitButton } from "../components/ui";
import { AuthPageFrame } from "../components/shell/AuthFrame";
import { Button } from "../components/ui/button";
import { PasswordField } from "../components/ui/password-field";
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
  // Only a dead link is fixed by asking for a new one; any other failure leaves this link usable.
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
            <PasswordField
              id="reset-password-password"
              label="รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)"
              name="new-password"
              autoComplete="new-password"
              value={field.state.value}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
              errors={field.state.meta.errors}
            />
          )}
        </form.Field>
        <form.Field
          name="confirm"
          validators={{
            onChangeListenTo: ["password"],
            // Empty stays quiet while the user is still typing the first field; submit asks for it.
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
            <PasswordField
              id="reset-password-confirm"
              label="ยืนยันรหัสผ่านใหม่"
              name="confirm-password"
              autoComplete="new-password"
              value={field.state.value}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
              // An empty-submit message lingers in errorMap.onSubmit while typing; the live mismatch wins.
              errors={[
                field.state.meta.errorMap.onChange,
                field.state.meta.errorMap.onSubmit,
              ].filter(Boolean)}
            />
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
