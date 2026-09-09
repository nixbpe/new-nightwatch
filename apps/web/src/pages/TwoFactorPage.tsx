import { useState, type SubmitEvent } from "react";

import { PostAuthRedirect } from "../components/guards";
import {
  Alert,
  AuthPageShell,
  Field,
  FullPageLoading,
  SubmitButton,
  textInputClass,
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
  const [mode, setMode] = useState<ChallengeMode>("totp");
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (isPending) {
    return <FullPageLoading label="กำลังตรวจสอบเซสชัน…" />;
  }
  if (data !== null) {
    // Already fully signed in — no challenge pending.
    return <PostAuthRedirect />;
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setError(null);
    setPending(true);
    try {
      const args = { code: code.trim(), trustDevice };
      // TOTP and backup codes go to different endpoints; recovery codes are
      // one-time, so a wrong recovery code must not be retried as TOTP.
      const { error: verifyError } =
        mode === "recovery"
          ? await authClient.twoFactor.verifyBackupCode(args)
          : await authClient.twoFactor.verifyTotp(args);
      if (verifyError != null) {
        setError(
          authErrorMessage(
            verifyError,
            mode === "recovery"
              ? "รหัสกู้คืนไม่ถูกต้องหรือถูกใช้ไปแล้ว"
              : "รหัสยืนยันไม่ถูกต้อง",
          ),
        );
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
      title="ยืนยันตัวตนสองขั้นตอน"
      subtitle="เลือกวิธียืนยันและกรอกรหัสเพื่อเข้าสู่พื้นที่ทำงาน"
    >
      <form
        onSubmit={(event) => void onSubmit(event)}
        className="flex flex-col gap-4"
        noValidate
      >
        {error === null ? null : <Alert tone="error">{error}</Alert>}
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
                checked={mode === option.value}
                onChange={() => {
                  setMode(option.value);
                  setCode("");
                  setError(null);
                }}
                className="size-4 accent-[var(--primary)]"
              />
              {option.label}
            </label>
          ))}
        </fieldset>
        <Field
          label={mode === "recovery" ? "รหัสกู้คืนบัญชี" : "รหัสยืนยัน 6 หลัก"}
        >
          <input
            type="text"
            name="challenge-code"
            inputMode={mode === "recovery" ? "text" : "numeric"}
            autoComplete={mode === "recovery" ? "off" : "one-time-code"}
            required
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
            }}
            className={textInputClass}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="trust-device"
            checked={trustDevice}
            onChange={(event) => {
              setTrustDevice(event.target.checked);
            }}
            className="size-4 rounded border-control-border accent-[var(--primary)]"
          />
          เชื่อถืออุปกรณ์นี้ (จะไม่ต้องยืนยันอีกบนอุปกรณ์นี้)
        </label>
        <SubmitButton pending={pending} pendingLabel="กำลังยืนยัน…">
          ยืนยัน
        </SubmitButton>
      </form>
    </AuthPageShell>
  );
}
