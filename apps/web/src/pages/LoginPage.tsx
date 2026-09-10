import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useSearchParams } from "react-router";

import {
  Alert,
  AuthPageShell,
  Field,
  FieldValidationError,
  Input,
  SubmitButton,
} from "../components/ui";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { rememberReturnTo } from "../lib/auth/continuation";


export function LoginPage() {
  // The protected-route loaders bounce here as /login?from=<path+query>;
  // same-origin paths only, anything else falls back to the workspace.
  const [searchParams] = useSearchParams();
  const fromParam = searchParams.get("from");
  const from =
    fromParam !== null && fromParam.startsWith("/") && !fromParam.startsWith("//")
      ? fromParam
      : "/workspace";

  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      setNeedsVerification(false);
      rememberReturnTo(from);
      try {
        const { error: signInError } = await authClient.signIn.email({
          email: value.email.trim(),
          password: value.password,
        });
        if (signInError != null) {
          const message = authErrorMessage(signInError, "เข้าสู่ระบบไม่สำเร็จ");
          if (signInError.status === 403 || /not verified/i.test(message)) {
            setNeedsVerification(true);
          }
          setError(message);
        }
      } catch {
        setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  return (
    <AuthPageShell
      title="เข้าสู่ระบบ NightWatch"
      subtitle="ใช้อีเมลและรหัสผ่านที่ได้รับการเชิญเท่านั้น"
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
          <Alert tone={needsVerification ? "info" : "error"}>
            {needsVerification ? (
              <>
                {error}{" "}
                <Link to="/verify-email" className="font-medium underline">
                  ไปที่หน้ายืนยันอีเมล
                </Link>
              </>
            ) : (
              error
            )}
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
                  field.state.meta.errors.length > 0 ? "login-email-error" : undefined
                }
              />
              <FieldValidationError
                id="login-email-error"
                errors={field.state.meta.errors}
              />
            </Field>
          )}
        </form.Field>
        <form.Field
          name="password"
          validators={{
            onChange: ({ value }) => {
              if (value.trim() === "") {
                return "กรุณากรอกรหัสผ่าน";
              }
              return undefined;
            },
            onSubmit: ({ value }) =>
              value.trim() === "" ? "กรุณากรอกรหัสผ่าน" : undefined,
          }}
        >
          {(field) => (
            <Field label="รหัสผ่าน">
              <Input
                type="password"
                name="password"
                autoComplete="current-password"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.errors.length > 0}
                aria-describedby={
                  field.state.meta.errors.length > 0
                    ? "login-password-error"
                    : undefined
                }
              />
              <FieldValidationError
                id="login-password-error"
                errors={field.state.meta.errors}
              />
            </Field>
          )}
        </form.Field>
        <div className="flex items-center justify-between text-sm">
          <Link to="/forgot-password" className="text-primary underline">
            ลืมรหัสผ่าน
          </Link>
        </div>
        <form.Subscribe
          selector={(state) => state.isSubmitting}
          children={(isSubmitting) => (
            <SubmitButton
              pending={isSubmitting}
              pendingLabel="กำลังเข้าสู่ระบบ…"
            >
              เข้าสู่ระบบ
            </SubmitButton>
          )}
        />
      </form>
    </AuthPageShell>
  );
}
