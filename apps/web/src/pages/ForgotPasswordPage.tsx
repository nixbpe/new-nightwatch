import { useState, type SubmitEvent } from "react";
import { Link } from "react-router";

import {
  Alert,
  AuthPageShell,
  Field,
  Input,
  SubmitButton,
} from "../components/ui";
import { authClient, authErrorMessage } from "../lib/auth-client";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setError(null);
    setPending(true);
    try {
      const { error: requestError } = await authClient.requestPasswordReset({
        email: email.trim(),
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
    } finally {
      setPending(false);
    }
  }

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
          onSubmit={(event) => void onSubmit(event)}
          className="flex flex-col gap-4"
          noValidate
        >
          {error === null ? null : <Alert tone="error">{error}</Alert>}
          <Field label="อีเมล">
            <Input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </Field>
          <SubmitButton pending={pending} pendingLabel="กำลังส่ง…">
            ส่งลิงก์ตั้งรหัสผ่านใหม่
          </SubmitButton>
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
