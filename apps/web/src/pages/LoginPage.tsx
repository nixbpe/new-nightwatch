import { useState, type SubmitEvent } from "react";
import { Link, useLocation } from "react-router";

import {
  Alert,
  AuthPageShell,
  Field,
  Input,
  SubmitButton,
} from "../components/ui";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { rememberReturnTo } from "../lib/auth/continuation";

export function LoginPage() {
  const location = useLocation();
  const from =
    (location.state as { from?: string } | null)?.from ?? "/workspace";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setError(null);
    setNeedsVerification(false);
    setPending(true);
    rememberReturnTo(from);
    try {
      const { error: signInError } = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (signInError != null) {
        const message = authErrorMessage(signInError, "เข้าสู่ระบบไม่สำเร็จ");
        if (signInError.status === 403 || /not verified/i.test(message)) {
          setNeedsVerification(true);
        }
        setError(message);
        return;
      }
    } catch {
      setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthPageShell
      title="เข้าสู่ระบบ NightWatch"
      subtitle="ใช้อีเมลและรหัสผ่านที่ได้รับการเชิญเท่านั้น"
    >
      <form
        onSubmit={(event) => void onSubmit(event)}
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
        <Field label="รหัสผ่าน">
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>
        <div className="flex items-center justify-between text-sm">
          <Link to="/forgot-password" className="text-primary underline">
            ลืมรหัสผ่าน
          </Link>
        </div>
        <SubmitButton pending={pending} pendingLabel="กำลังเข้าสู่ระบบ…">
          เข้าสู่ระบบ
        </SubmitButton>
      </form>
    </AuthPageShell>
  );
}
