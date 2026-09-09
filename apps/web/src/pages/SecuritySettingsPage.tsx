import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SubmitEvent } from "react";
import { Link, Navigate } from "react-router";

import {
  Alert,
  AuthPageShell,
  Field,
  FullPageLoading,
  SubmitButton,
  textInputClass,
} from "../components/ui";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../lib/api/me";

type EnrollmentDraft = {
  totpURI: string;
  backupCodes: string[];
};

type PendingAction = "enable" | "verify" | "regenerate" | null;

/**
 * Optional TOTP enrollment and recovery-code regeneration. MFA is opt-in per
 * the approved scope. Enrollment is a two-step state machine:
 *   enable (current password) → URI + backup codes → first TOTP code
 *   via verifyTotp → enabled ONLY once the server reports
 *   twoFactorEnabled=true on the me/context contract.
 */
export function SecuritySettingsPage() {
  const queryClient = useQueryClient();
  const { data, isPending } = authClient.useSession();
  // twoFactorEnabled comes from the me/context contract — the client-side
  // session inference does not carry plugin fields reliably.
  const meQuery = useQuery({
    queryKey: ME_CONTEXT_QUERY_KEY,
    queryFn: fetchMeContext,
  });
  const [password, setPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [draft, setDraft] = useState<EnrollmentDraft | null>(null);
  const [regenerated, setRegenerated] = useState<string[] | null>(null);

  if (isPending) {
    return <FullPageLoading label="กำลังตรวจสอบเซสชัน…" />;
  }
  if (data === null) {
    return <Navigate to="/login" replace />;
  }
  // The known enabled/disabled status comes only from a successful server
  // context lookup — never render it (or enrollment controls) while the
  // lookup is pending or has failed.
  if (meQuery.isPending) {
    return <FullPageLoading label="กำลังโหลดข้อมูลความปลอดภัย…" />;
  }
  if (meQuery.isError) {
    return (
      <AuthPageShell
        title="ความปลอดภัยของบัญชี"
        subtitle="ยืนยันสองขั้นตอน (TOTP) ช่วยเพิ่มความปลอดภัยให้บัญชีของคุณ — เปิดใช้งานได้ตามต้องการ ไม่บังคับ"
      >
        <div className="flex flex-col gap-4">
          <Alert tone="error">
            ไม่สามารถตรวจสอบสถานะยืนยันสองขั้นตอนได้ กรุณาลองใหม่อีกครั้ง
          </Alert>
          <button
            type="button"
            disabled={meQuery.isRefetching}
            onClick={() => {
              void meQuery.refetch();
            }}
            className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {meQuery.isRefetching ? "กำลังโหลด…" : "ลองใหม่"}
          </button>
          <p className="text-sm">
            <Link to="/workspace" className="text-primary underline">
              กลับไปพื้นที่ทำงาน
            </Link>
          </p>
        </div>
      </AuthPageShell>
    );
  }

  const twoFactorEnabled = meQuery.data.user.twoFactorEnabled;

  async function enable(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingAction !== null) {
      return;
    }
    setError(null);
    setPendingAction("enable");
    try {
      const { data: enableData, error: enableError } =
        await authClient.twoFactor.enable({ password });
      if (enableError != null) {
        setError(
          authErrorMessage(enableError, "เปิดใช้งานยืนยันสองขั้นตอนไม่สำเร็จ"),
        );
        return;
      }
      // Enable alone does NOT activate the second factor: Better Auth keeps
      // twoFactorEnabled=false until the first TOTP verifies. Hold the URI
      // and backup codes in a pending draft until that verification lands.
      setDraft({
        totpURI: enableData.totpURI,
        backupCodes: enableData.backupCodes,
      });
      setPassword("");
    } catch {
      setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setPendingAction(null);
    }
  }

  async function confirmFirstCode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingAction !== null) {
      return;
    }
    setError(null);
    setPendingAction("verify");
    try {
      const { error: verifyError } = await authClient.twoFactor.verifyTotp({
        code: verifyCode.trim(),
      });
      if (verifyError != null) {
        // Wrong/expired code: enrollment stays pending and the draft remains
        // visible so the user can retry without re-enrolling.
        setError(
          authErrorMessage(
            verifyError,
            "รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง",
          ),
        );
        return;
      }
      const refreshed = await meQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
      setDraft(null);
      setVerifyCode("");
      // Never claim enabled from the verify call alone — only the server
      // contract may flip the visible state.
      if (refreshed.data?.user.twoFactorEnabled !== true) {
        setError(
          "ยืนยันรหัสแล้วแต่ยังไม่สามารถยืนยันสถานะกับเซิร์ฟเวอร์ได้ กรุณารีเฟรชหน้านี้",
        );
      }
    } catch {
      setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setPendingAction(null);
    }
  }

  async function regenerateCodes(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingAction !== null) {
      return;
    }
    setError(null);
    setPendingAction("regenerate");
    try {
      const { data: codesData, error: codesError } =
        await authClient.twoFactor.generateBackupCodes({ password });
      if (codesError != null) {
        // Invalid credentials must not disturb the currently displayed codes.
        setError(authErrorMessage(codesError, "สร้างรหัสกู้คืนใหม่ไม่สำเร็จ"));
        return;
      }
      setRegenerated(codesData.backupCodes);
      setPassword("");
    } catch {
      setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <AuthPageShell
      title="ความปลอดภัยของบัญชี"
      subtitle="ยืนยันสองขั้นตอน (TOTP) ช่วยเพิ่มความปลอดภัยให้บัญชีของคุณ — เปิดใช้งานได้ตามต้องการ ไม่บังคับ"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-foreground-secondary">
          สถานะปัจจุบัน:{" "}
          <span className="font-medium text-foreground">
            {twoFactorEnabled ? "เปิดใช้งานแล้ว" : "ยังไม่ได้เปิดใช้งาน"}
          </span>
        </p>
        {error === null ? null : <Alert tone="error">{error}</Alert>}

        {twoFactorEnabled ? (
          <RecoveryCodesPanel
            password={password}
            onPasswordChange={setPassword}
            pending={pendingAction === "regenerate"}
            onRegenerate={(event) => void regenerateCodes(event)}
            regenerated={regenerated}
          />
        ) : draft !== null ? (
          <EnrollmentDraftPanel
            draft={draft}
            verifyCode={verifyCode}
            onVerifyCodeChange={setVerifyCode}
            pending={pendingAction === "verify"}
            onConfirm={(event) => void confirmFirstCode(event)}
          />
        ) : (
          <form
            onSubmit={(event) => void enable(event)}
            className="flex flex-col gap-4"
            noValidate
          >
            <Field label="รหัสผ่านปัจจุบัน">
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
                className={textInputClass}
              />
            </Field>
            <SubmitButton
              pending={pendingAction === "enable"}
              pendingLabel="กำลังเปิดใช้งาน…"
            >
              เปิดใช้งานยืนยันสองขั้นตอน
            </SubmitButton>
          </form>
        )}

        <p className="text-sm">
          <Link to="/workspace" className="text-primary underline">
            กลับไปพื้นที่ทำงาน
          </Link>
        </p>
      </div>
    </AuthPageShell>
  );
}

/** Pending enrollment: URI/backup codes shown, activation awaits first TOTP. */
function EnrollmentDraftPanel({
  draft,
  verifyCode,
  onVerifyCodeChange,
  pending,
  onConfirm,
}: {
  draft: EnrollmentDraft;
  verifyCode: string;
  onVerifyCodeChange: (value: string) => void;
  pending: boolean;
  onConfirm: (event: SubmitEvent<HTMLFormElement>) => void;
}) {
  const secret = draft.totpURI.split("secret=")[1]?.split("&")[0] ?? null;
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="info">
        สแกน URI ด้านล่างด้วยแอปยืนยันตัวตน จากนั้นกรอกรหัส 6
        หลักแรกเพื่อเปิดใช้งาน —
        ยืนยันสองขั้นตอนจะยังไม่เปิดใช้งานจนกว่ารหัสแรกจะถูกต้อง
      </Alert>
      <div className="rounded-md border border-control-border p-3">
        <p className="break-all font-mono text-xs">{draft.totpURI}</p>
        {secret === null ? null : (
          <p className="mt-2 break-all text-sm">
            <span className="text-foreground-secondary">คีย์ลับ: </span>
            <span className="font-mono text-xs">{secret}</span>
          </p>
        )}
      </div>
      <div>
        <h2 className="text-sm font-medium">
          รหัสกู้คืนบัญชี (เก็บไว้ในที่ปลอดภัย แสดงเพียงครั้งนี้
          ใช้ได้ครั้งเดียวแต่ละรหัส)
        </h2>
        <ul className="mt-2 grid grid-cols-2 gap-1">
          {draft.backupCodes.map((code) => (
            <li key={code} className="font-mono text-xs">
              {code}
            </li>
          ))}
        </ul>
      </div>
      <form onSubmit={onConfirm} className="flex flex-col gap-4" noValidate>
        <Field label="รหัสยืนยัน 6 หลักจากแอปยืนยันตัวตน">
          <input
            type="text"
            name="first-totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={verifyCode}
            onChange={(event) => {
              onVerifyCodeChange(event.target.value);
            }}
            className={textInputClass}
          />
        </Field>
        <SubmitButton pending={pending} pendingLabel="กำลังยืนยัน…">
          ยืนยันรหัสแรกและเปิดใช้งาน
        </SubmitButton>
      </form>
    </div>
  );
}

function RecoveryCodesPanel({
  password,
  onPasswordChange,
  pending,
  onRegenerate,
  regenerated,
}: {
  password: string;
  onPasswordChange: (value: string) => void;
  pending: boolean;
  onRegenerate: (event: SubmitEvent<HTMLFormElement>) => void;
  regenerated: string[] | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onRegenerate} className="flex flex-col gap-4" noValidate>
        <Field label="รหัสผ่านปัจจุบัน (จำเป็นสำหรับสร้างรหัสกู้คืนชุดใหม่)">
          <input
            type="password"
            name="regenerate-password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => {
              onPasswordChange(event.target.value);
            }}
            className={textInputClass}
          />
        </Field>
        <SubmitButton pending={pending} pendingLabel="กำลังสร้าง…">
          สร้างรหัสกู้คืนใหม่
        </SubmitButton>
      </form>
      {regenerated === null ? null : (
        <div>
          <h2 className="text-sm font-medium">
            รหัสกู้คืนชุดใหม่ (แสดงเพียงครั้งนี้ ใช้ได้ครั้งเดียวแต่ละรหัส
            รหัสชุดเดิมจะใช้ไม่ได้อีก)
          </h2>
          <ul className="mt-2 grid grid-cols-2 gap-1">
            {regenerated.map((code) => (
              <li key={code} className="font-mono text-xs">
                {code}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
