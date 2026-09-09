import { useState, type SubmitEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import {
  Alert,
  AuthPageShell,
  Field,
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

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || token === null) {
      return;
    }
    setError(null);
    if (password !== confirm) {
      setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      return;
    }
    setPending(true);
    try {
      const { error: resetError } = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (resetError != null) {
        setError(authErrorMessage(resetError, "ตั้งรหัสผ่านใหม่ไม่สำเร็จ"));
        return;
      }
      void navigate("/login", { replace: true });
    } catch {
      setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setPending(false);
    }
  }

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
        onSubmit={(event) => void onSubmit(event)}
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
        <Field label="รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)">
          <Input
            type="password"
            name="new-password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>
        <Field label="ยืนยันรหัสผ่านใหม่">
          <Input
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value);
            }}
          />
        </Field>
        <SubmitButton pending={pending} pendingLabel="กำลังบันทึก…">
          บันทึกรหัสผ่านใหม่
        </SubmitButton>
      </form>
    </AuthPageShell>
  );
}
