import { useForm } from "@tanstack/react-form";
import { toDataURL } from "qrcode";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  KeyIcon,
  RefreshIcon,
  SmartphoneIcon,
} from "../../components/shell/icons";
import { Skeleton } from "../../components/shell/Skeleton";
import { Alert, Field, FieldValidationError } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { authClient, authErrorMessage } from "../../lib/auth-client";
import { formatAuditDate, usePreferences } from "../../lib/preferences";
import { CardSection } from "../../components/ui/card";
import { OtpCodeInput } from "../../components/ui/otp-code-input";
import { PasswordField } from "../../components/ui/password-field";
import { SectionHeader } from "../../components/ui/section-header";
import { StatusPill } from "../../components/ui/status-pill";
import { IconTile } from "../../components/ui/icon-tile";
import { Notice } from "../../components/ui/notice";

type EnrollmentDraft = { totpURI: string; backupCodes: string[] };

type Stage = "idle" | "password" | "scan" | "verify";

const REFRESH_GUARD_MESSAGE =
  "ยืนยันรหัสแล้วแต่ยังไม่สามารถยืนยันสถานะกับเซิร์ฟเวอร์ได้ กรุณารีเฟรชหน้านี้";
const VERIFY_TOTP_CLIENT_ERROR_ID = "first-totp-error";
const VERIFY_TOTP_SERVER_ERROR_ID = "first-totp-server-error";

function secretFromUri(totpURI: string): string | null {
  const secret = totpURI.split("secret=")[1]?.split("&")[0];
  return secret === undefined || secret === "" ? null : secret;
}

function groupedSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

// The account and date tell apart files from several accounts or sets.
function downloadCodes(
  codes: string[],
  accountEmail: string | undefined,
  downloadedOn: string,
): void {
  const header = [
    "รหัสกู้คืน NightWatch",
    ...(accountEmail === undefined ? [] : [`บัญชี: ${accountEmail}`]),
    `ดาวน์โหลดเมื่อ: ${downloadedOn}`,
    "แต่ละรหัสใช้ได้ครั้งเดียว",
  ];
  const blob = new Blob([`${header.join("\n")}\n\n${codes.join("\n")}\n`], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "nightwatch-recovery-codes.txt";
  anchor.click();
  URL.revokeObjectURL(url);
}

// `enabled` comes from the server; nothing claims enabled before `refreshStatus` confirms it.
// The enrolment draft (secret, codes, QR) lives only in component state and is dropped on exit.
export function MfaCard({
  enabled,
  refreshStatus,
  accountEmail,
}: {
  enabled: boolean;
  refreshStatus: () => Promise<boolean | undefined>;
  accountEmail?: string;
}) {
  const { preferences } = usePreferences();
  const download = (codes: string[]) => {
    downloadCodes(
      codes,
      accountEmail,
      formatAuditDate(new Date(), preferences),
    );
  };
  const [stage, setStage] = useState<Stage>("idle");
  const [draft, setDraft] = useState<EnrollmentDraft | null>(null);
  const [qr, setQr] = useState<
    | { state: "loading" }
    | { state: "ready"; dataUrl: string }
    | { state: "failed" }
  >({ state: "loading" });
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [justEnabled, setJustEnabled] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const [regen, setRegen] = useState<null | "form" | { codes: string[] }>(null);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenAcknowledged, setRegenAcknowledged] = useState(false);
  const [copied, setCopied] = useState<null | "secret" | "codes">(null);
  const [copyFailed, setCopyFailed] = useState<null | "secret" | "codes">(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);
  const enableTriggerRef = useRef<HTMLButtonElement>(null);
  const regenTriggerRef = useRef<HTMLButtonElement>(null);
  const regenCodesTitleRef = useRef<HTMLParagraphElement>(null);
  const disableTriggerRef = useRef<HTMLButtonElement>(null);
  // Focus returns to the opener after the next render, since that button remounts.
  const pendingFocus = useRef<RefObject<HTMLButtonElement | null> | null>(null);
  useEffect(() => {
    // Stays pending until the target is mounted (the enable button appears only after enabled=false).
    const target = pendingFocus.current?.current;
    if (target !== null && target !== undefined) {
      target.focus();
      pendingFocus.current = null;
    }
  });

  // The password form unmounts when the new codes appear, so focus would fall to the page; send it to their heading.
  const regenCodes = regen !== null && regen !== "form" ? regen : null;
  useEffect(() => {
    if (regenCodes !== null) {
      regenCodesTitleRef.current?.focus();
    }
  }, [regenCodes]);

  useEffect(() => {
    if (enabled) {
      setDraft(null);
      setStage("idle");
      setAcknowledged(false);
    }
  }, [enabled]);

  // The QR is derived from the draft's URI and never stored.
  useEffect(() => {
    if (draft === null) {
      return;
    }
    let cancelled = false;
    setQr({ state: "loading" });
    toDataURL(draft.totpURI, { margin: 0, width: 168 })
      .then((dataUrl) => {
        if (!cancelled) {
          setQr({ state: "ready", dataUrl });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQr({ state: "failed" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [draft]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) {
        clearTimeout(copiedTimer.current);
      }
    },
    [],
  );

  const copy = (text: string, which: "secret" | "codes") => {
    setCopyFailed(null);
    // The executor also turns a missing `navigator.clipboard` (plain http) into a rejection.
    void new Promise<void>((resolve) => {
      resolve(navigator.clipboard.writeText(text));
    })
      .then(() => {
        setCopied(which);
        if (copiedTimer.current !== null) {
          clearTimeout(copiedTimer.current);
        }
        copiedTimer.current = setTimeout(() => {
          setCopied(null);
        }, 1500);
      })
      .catch(() => {
        setCopied(null);
        setCopyFailed(which);
      });
  };

  const resetEnrollment = () => {
    setDraft(null);
    setStage("idle");
    setAcknowledged(false);
    setError(null);
    setCodeInvalid(false);
    setEnableError(null);
    pendingFocus.current = enableTriggerRef;
  };

  const enableForm = useForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value }) => {
      setEnableError(null);
      try {
        const { data, error: enableErr } = await authClient.twoFactor.enable({
          password: value.password,
        });
        if (enableErr != null) {
          setEnableError(
            authErrorMessage(enableErr, "เปิดใช้งานยืนยันสองขั้นตอนไม่สำเร็จ"),
          );
          return;
        }
        // Better Auth 1.7 discriminates the response; this request enrolls TOTP.
        if (data.method !== "totp") {
          setEnableError("เปิดใช้งานยืนยันสองขั้นตอนไม่สำเร็จ");
          return;
        }
        setDraft({ totpURI: data.totpURI, backupCodes: data.backupCodes });
        setAcknowledged(false);
        setStage("scan");
        enableForm.resetField("password");
      } catch {
        setEnableError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  const verifyForm = useForm({
    defaultValues: { code: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      setCodeInvalid(false);
      try {
        const { error: verifyErr } = await authClient.twoFactor.verifyTotp({
          code: value.code.trim(),
        });
        if (verifyErr != null) {
          setCodeInvalid(true);
          setError(
            authErrorMessage(
              verifyErr,
              "รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง",
            ),
          );
          return;
        }
        const confirmed = await refreshStatus();
        verifyForm.resetField("code");
        if (confirmed === true) {
          setDraft(null);
          setStage("idle");
          setAcknowledged(false);
          setJustEnabled(true);
        } else {
          setError(REFRESH_GUARD_MESSAGE);
        }
      } catch {
        setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  const regenerateForm = useForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value }) => {
      setRegenError(null);
      try {
        const { data, error: codesErr } =
          await authClient.twoFactor.generateBackupCodes({
            password: value.password,
          });
        if (codesErr != null) {
          setRegenError(
            authErrorMessage(codesErr, "สร้างรหัสกู้คืนใหม่ไม่สำเร็จ"),
          );
          return;
        }
        setRegenAcknowledged(false);
        setRegen({ codes: data.backupCodes });
        regenerateForm.resetField("password");
      } catch {
        setRegenError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  const disableForm = useForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value }) => {
      setDisableError(null);
      try {
        const { error: disableErr } = await authClient.twoFactor.disable({
          password: value.password,
        });
        if (disableErr != null) {
          setDisableError(
            authErrorMessage(disableErr, "ปิดใช้งานยืนยันสองขั้นตอนไม่สำเร็จ"),
          );
          return;
        }
        const stillEnabled = await refreshStatus();
        disableForm.resetField("password");
        if (stillEnabled === false) {
          setDisableOpen(false);
          setJustEnabled(false);
          setRegen(null);
          pendingFocus.current = enableTriggerRef;
        } else {
          setDisableError(
            "ปิดใช้งานแล้วแต่ยังไม่สามารถยืนยันสถานะกับเซิร์ฟเวอร์ได้ กรุณารีเฟรชหน้านี้",
          );
        }
      } catch {
        setDisableError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  const status: { label: string; tone: "neutral" | "caution" | "positive" } =
    enabled
      ? { label: "เปิดอยู่", tone: "positive" }
      : stage === "idle"
        ? { label: "ปิดอยู่", tone: "neutral" }
        : { label: "กำลังตั้งค่า", tone: "caution" };

  const secret = draft === null ? null : secretFromUri(draft.totpURI);
  const secretDisplay =
    draft === null
      ? ""
      : secret === null
        ? draft.totpURI
        : groupedSecret(secret);

  return (
    <CardSection data-testid="mfa-card" aria-labelledby="mfa-card-title">
      <div className="flex flex-col gap-2">
        <SectionHeader
          id="mfa-card-title"
          code="01"
          title="ยืนยันสองขั้นตอน (MFA)"
          meta={
            <StatusPill
              data-testid={
                enabled
                  ? "mfa-status-enabled"
                  : stage === "idle"
                    ? "mfa-status-disabled"
                    : "mfa-status-pending"
              }
              tone={
                status.tone === "positive"
                  ? "primary"
                  : status.tone === "caution"
                    ? "caution"
                    : "muted"
              }
              dot
            >
              {status.label}
            </StatusPill>
          }
        />
        <p className="text-sm text-foreground-secondary">
          ใช้รหัส 6 หลักจากแอปยืนยันตัวตน (TOTP) เพิ่มอีกชั้นเมื่อเข้าสู่ระบบ
          ไม่บังคับ แต่แนะนำสำหรับเจ้าของและผู้ดูแลองค์กร
        </p>
      </div>

      {enabled ? (
        <>
          {justEnabled ? (
            <Notice data-testid="mfa-enabled-notice" tone="success">
              เปิดใช้งานยืนยันสองขั้นตอนแล้ว
              ครั้งถัดไปที่เข้าสู่ระบบจะต้องกรอกรหัสจากแอปด้วย
            </Notice>
          ) : null}
          <div className="flex flex-col rounded border border-foreground/10">
            <div className="flex items-center justify-between gap-3 border-b border-foreground/10 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <IconTile>
                  <SmartphoneIcon size={20} />
                </IconTile>
                <div className="min-w-0">
                  <p className="text-sm font-medium">แอปยืนยันตัวตน (TOTP)</p>
                  <p className="text-xs text-foreground-secondary">
                    ต้องกรอกรหัสจากแอปทุกครั้งที่เข้าสู่ระบบ
                  </p>
                </div>
              </div>
              {disableOpen ? null : (
                <Button
                  data-testid="mfa-disable-open"
                  ref={disableTriggerRef}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setRegen(null);
                    setRegenError(null);
                    setDisableError(null);
                    setJustEnabled(false);
                    setDisableOpen(true);
                  }}
                >
                  ปิดใช้งาน
                </Button>
              )}
            </div>
            {disableOpen ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void disableForm.handleSubmit();
                }}
                noValidate
                className="flex flex-col gap-4 border-b border-foreground/10 bg-foreground/5 p-4"
              >
                <Alert data-testid="mfa-disable-warning" tone="error">
                  การปิด MFA ทำให้บัญชีเข้าสู่ระบบได้ด้วยรหัสผ่านอย่างเดียว
                  และรหัสกู้คืนทุกชุดจะใช้ไม่ได้อีก
                </Alert>
                <div className="max-w-md">
                  <disableForm.Field
                    name="password"
                    validators={{
                      onChange: ({ value }) =>
                        value === "" ? "กรุณากรอกรหัสผ่านปัจจุบัน" : undefined,
                      onSubmit: ({ value }) =>
                        value === "" ? "กรุณากรอกรหัสผ่านปัจจุบัน" : undefined,
                    }}
                  >
                    {(field) => (
                      <PasswordField
                        id="disable-password"
                        testId="mfa-disable-password"
                        label="ยืนยันรหัสผ่านปัจจุบันเพื่อปิดใช้งาน"
                        name="disable-password"
                        autoComplete="current-password"
                        autoFocus
                        value={field.state.value}
                        onChange={field.handleChange}
                        onBlur={field.handleBlur}
                        errors={field.state.meta.errors}
                        serverError={disableError}
                      />
                    )}
                  </disableForm.Field>
                </div>
                <div className="flex items-center gap-2">
                  <disableForm.Subscribe
                    selector={(state) => state.isSubmitting}
                    children={(submitting) => (
                      <Button
                        data-testid="mfa-disable-submit"
                        type="submit"
                        variant="destructive-outline"
                        disabled={submitting}
                      >
                        {submitting
                          ? "กำลังปิดใช้งาน…"
                          : "ปิดใช้งานยืนยันสองขั้นตอน"}
                      </Button>
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setDisableOpen(false);
                      setDisableError(null);
                      disableForm.reset();
                      pendingFocus.current = disableTriggerRef;
                    }}
                    data-testid="mfa-disable-cancel"
                  >
                    ยกเลิก
                  </Button>
                </div>
              </form>
            ) : null}
            <div className="flex items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <IconTile>
                  <KeyIcon size={20} />
                </IconTile>
                <div className="min-w-0">
                  <p className="text-sm font-medium">รหัสกู้คืน</p>
                  <p className="text-xs text-foreground-secondary">
                    ใช้แทนรหัสจากแอปเมื่อเข้าถึงโทรศัพท์ไม่ได้
                    สร้างชุดใหม่ได้ทุกเมื่อ แล้วชุดเดิมจะใช้ไม่ได้ทันที
                  </p>
                </div>
              </div>
              {regen === null ? (
                <Button
                  data-testid="mfa-regenerate-open"
                  ref={regenTriggerRef}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDisableOpen(false);
                    setDisableError(null);
                    setRegenError(null);
                    setRegen("form");
                  }}
                >
                  <RefreshIcon size={14} />
                  สร้างชุดใหม่
                </Button>
              ) : null}
            </div>
            {regen === "form" ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void regenerateForm.handleSubmit();
                }}
                noValidate
                className="flex flex-col gap-4 border-t border-foreground/10 bg-foreground/5 p-4"
              >
                <div className="max-w-md">
                  <regenerateForm.Field
                    name="password"
                    validators={{
                      onChange: ({ value }) =>
                        value === "" ? "กรุณากรอกรหัสผ่านปัจจุบัน" : undefined,
                      onSubmit: ({ value }) =>
                        value === "" ? "กรุณากรอกรหัสผ่านปัจจุบัน" : undefined,
                    }}
                  >
                    {(field) => (
                      <PasswordField
                        id="regenerate-password"
                        testId="mfa-regenerate-password"
                        label="รหัสผ่านปัจจุบัน (จำเป็นสำหรับสร้างรหัสกู้คืนชุดใหม่)"
                        name="regenerate-password"
                        autoComplete="current-password"
                        autoFocus
                        value={field.state.value}
                        onChange={field.handleChange}
                        onBlur={field.handleBlur}
                        errors={field.state.meta.errors}
                        serverError={regenError}
                      />
                    )}
                  </regenerateForm.Field>
                </div>
                <div className="flex items-center gap-2">
                  <regenerateForm.Subscribe
                    selector={(state) => state.isSubmitting}
                    children={(submitting) => (
                      <Button
                        data-testid="mfa-regenerate-submit"
                        type="submit"
                        disabled={submitting}
                      >
                        {submitting ? "กำลังสร้าง…" : "สร้างรหัสกู้คืนใหม่"}
                      </Button>
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setRegen(null);
                      setRegenError(null);
                      regenerateForm.reset();
                      pendingFocus.current = regenTriggerRef;
                    }}
                    data-testid="mfa-regenerate-cancel"
                  >
                    ยกเลิก
                  </Button>
                </div>
              </form>
            ) : null}
            {regen !== null && regen !== "form" ? (
              <div className="flex flex-col gap-3 border-t border-foreground/10 p-4">
                <CodesHeader
                  titleRef={regenCodesTitleRef}
                  title="รหัสกู้คืนชุดใหม่"
                  description="แสดงเพียงครั้งนี้ แต่ละรหัสใช้ได้ครั้งเดียว และชุดเดิมใช้ไม่ได้แล้ว"
                  codes={regen.codes}
                  copied={copied === "codes"}
                  copyFailed={copyFailed === "codes"}
                  onCopy={() => {
                    copy(regen.codes.join("\n"), "codes");
                  }}
                  onDownload={download}
                />
                <BackupCodes codes={regen.codes} />
                <label className="flex items-start gap-2.5 text-sm">
                  <Checkbox
                    data-testid="mfa-regenerate-acknowledge"
                    checked={regenAcknowledged}
                    onChange={(event) => {
                      setRegenAcknowledged(event.target.checked);
                    }}
                    className="mt-0.5"
                  />
                  <span>
                    ฉันบันทึกรหัสกู้คืนชุดใหม่ไว้ในที่ปลอดภัยแล้ว
                    และเข้าใจว่าชุดเดิมใช้ไม่ได้ทันที
                  </span>
                </label>
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!regenAcknowledged}
                    onClick={() => {
                      setRegen(null);
                      pendingFocus.current = regenTriggerRef;
                    }}
                    data-testid="mfa-regenerate-done"
                  >
                    เรียบร้อย
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : stage === "idle" ? (
        <div className="flex items-center justify-between gap-4 rounded-md border border-foreground/10 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <IconTile>
              <SmartphoneIcon size={20} />
            </IconTile>
            <div className="min-w-0">
              <p className="text-sm font-medium">แอปยืนยันตัวตน</p>
              <p className="text-xs text-foreground-secondary">
                Google Authenticator, 1Password, Authy หรือแอป TOTP อื่น
                ใช้เวลาตั้งค่าประมาณ 2 นาที
              </p>
            </div>
          </div>
          <Button
            data-testid="mfa-enable-open"
            ref={enableTriggerRef}
            type="button"
            onClick={() => {
              setJustEnabled(false);
              setError(null);
              setStage("password");
            }}
          >
            เปิดใช้งาน
          </Button>
        </div>
      ) : stage === "password" ? (
        <>
          <Stepper current={1} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void enableForm.handleSubmit();
            }}
            noValidate
            className="flex flex-col gap-6"
          >
            <div className="flex max-w-md flex-col gap-4">
              <p className="text-sm text-foreground-secondary">
                ยืนยันตัวตนอีกครั้งก่อนเปลี่ยนวิธีเข้าสู่ระบบ
                รหัสผ่านนี้ใช้เฉพาะขั้นตอนนี้
              </p>
              <enableForm.Field
                name="password"
                validators={{
                  onChange: ({ value }) =>
                    value === "" ? "กรุณากรอกรหัสผ่านปัจจุบัน" : undefined,
                  onSubmit: ({ value }) =>
                    value === "" ? "กรุณากรอกรหัสผ่านปัจจุบัน" : undefined,
                }}
              >
                {(field) => (
                  <PasswordField
                    id="enable-password"
                    testId="mfa-enable-password"
                    label="รหัสผ่านปัจจุบัน"
                    name="password"
                    autoComplete="current-password"
                    autoFocus
                    value={field.state.value}
                    onChange={field.handleChange}
                    onBlur={field.handleBlur}
                    errors={field.state.meta.errors}
                    serverError={enableError}
                  />
                )}
              </enableForm.Field>
            </div>
            <StepFooter
              left={
                <Button
                  wrap
                  type="button"
                  variant="ghost"
                  data-testid="mfa-enable-cancel"
                  onClick={resetEnrollment}
                >
                  ยกเลิก
                </Button>
              }
              right={
                <enableForm.Subscribe
                  selector={(state) => state.isSubmitting}
                  children={(submitting) => (
                    <Button
                      data-testid="mfa-enable-submit"
                      wrap
                      type="submit"
                      disabled={submitting}
                    >
                      {submitting ? "กำลังตรวจสอบ…" : "ถัดไป: สแกนคิวอาร์โค้ด"}
                      <ArrowRightIcon size={16} />
                    </Button>
                  )}
                />
              }
            />
          </form>
        </>
      ) : draft === null ? null : stage === "scan" ? (
        <>
          <Stepper current={2} />
          <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
            <div className="flex flex-col gap-2">
              {/* Scanners want dark modules on white, in both themes. */}
              <div className="flex h-[200px] w-[200px] items-center justify-center rounded-md border border-foreground/10 bg-white p-4">
                {qr.state === "ready" ? (
                  <img
                    data-testid="mfa-qr"
                    src={qr.dataUrl}
                    alt="คิวอาร์โค้ดสำหรับแอปยืนยันตัวตน"
                    width={168}
                    height={168}
                    className="block"
                  />
                ) : qr.state === "loading" ? (
                  <Skeleton className="h-[168px] w-[168px]" />
                ) : (
                  <p className="text-center text-xs text-foreground-secondary">
                    สร้างคิวอาร์โค้ดไม่สำเร็จ ใช้คีย์ด้านล่างแทน
                  </p>
                )}
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">สแกนด้วยแอปยืนยันตัวตน</p>
                <p className="text-sm text-foreground-secondary">
                  หรือกรอกคีย์นี้ในแอปด้วยตนเองถ้าสแกนไม่ได้
                </p>
                <div className="mt-1 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <code
                    data-testid="mfa-secret"
                    className="block min-w-0 flex-1 break-all rounded-md border border-foreground/10 bg-foreground/5 px-3 py-2 font-mono text-sm tracking-wider"
                  >
                    {secretDisplay}
                  </code>
                  <Button
                    wrap
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      copy(secret ?? draft.totpURI, "secret");
                    }}
                    data-testid={
                      copied === "secret"
                        ? "mfa-secret-copy-done"
                        : "mfa-secret-copy-ready"
                    }
                  >
                    <CopyIcon size={14} />
                    {copied === "secret" ? "คัดลอกแล้ว" : "คัดลอก"}
                  </Button>
                </div>
                <CopyStatus
                  testId="mfa-secret-copy-status"
                  copied={copied === "secret"}
                  failedText={
                    copyFailed === "secret"
                      ? "คัดลอกไม่สำเร็จ เลือกคีย์แล้วคัดลอกเอง"
                      : null
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <CodesHeader
                  title="เก็บรหัสกู้คืนไว้ในที่ปลอดภัย"
                  description="ใช้แทนรหัสจากแอปเมื่อเข้าถึงโทรศัพท์ไม่ได้ แต่ละรหัสใช้ได้ครั้งเดียว และแสดงเพียงครั้งนี้"
                  codes={draft.backupCodes}
                  copied={copied === "codes"}
                  copyFailed={copyFailed === "codes"}
                  onCopy={() => {
                    copy(draft.backupCodes.join("\n"), "codes");
                  }}
                  onDownload={download}
                />
                <BackupCodes codes={draft.backupCodes} />
              </div>
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  data-testid="mfa-recovery-acknowledge"
                  checked={acknowledged}
                  onChange={(event) => {
                    setAcknowledged(event.target.checked);
                  }}
                  className="mt-0.5"
                />
                <span>
                  ฉันบันทึกรหัสกู้คืนไว้ในที่ปลอดภัยแล้ว
                  และเข้าใจว่ารหัสชุดนี้จะไม่แสดงอีก
                </span>
              </label>
            </div>
          </div>
          <StepFooter
            left={
              <Button
                wrap
                type="button"
                variant="ghost"
                onClick={() => {
                  // A new enable call issues a new secret, so the current draft is discarded.
                  setDraft(null);
                  setAcknowledged(false);
                  setStage("password");
                }}
                data-testid="mfa-scan-back"
              >
                <ArrowLeftIcon size={16} />
                ย้อนกลับ
              </Button>
            }
            right={
              <Button
                wrap
                type="button"
                data-testid="mfa-scan-next"
                disabled={!acknowledged}
                onClick={() => {
                  setError(null);
                  setCodeInvalid(false);
                  setStage("verify");
                }}
              >
                ถัดไป: ยืนยันรหัสแรก
                <ArrowRightIcon size={16} />
              </Button>
            }
          />
        </>
      ) : (
        <>
          <Stepper current={3} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void verifyForm.handleSubmit();
            }}
            noValidate
            className="flex flex-col gap-6"
          >
            <div className="flex max-w-md flex-col gap-4">
              <p className="text-sm text-foreground-secondary">
                กรอกรหัสที่แอปแสดงอยู่ตอนนี้ MFA
                จะเปิดใช้งานเมื่อรหัสแรกถูกต้องเท่านั้น รหัสเปลี่ยนทุก{" "}
                <span className="font-mono">30</span> วินาที
              </p>
              {error === null ? null : codeInvalid ? (
                <Alert
                  data-testid="mfa-verify-server-error"
                  id={VERIFY_TOTP_SERVER_ERROR_ID}
                  tone="error"
                >
                  {error}
                </Alert>
              ) : (
                <Alert data-testid="mfa-verify-guard" tone="error">
                  {error}
                </Alert>
              )}
              <verifyForm.Field
                name="code"
                validators={{
                  onChange: ({ value }) =>
                    value.trim() === "" ? "กรุณากรอกรหัสยืนยัน" : undefined,
                  onSubmit: ({ value }) =>
                    value.trim() === "" ? "กรุณากรอกรหัสยืนยัน" : undefined,
                }}
              >
                {(field) => (
                  <Field label="รหัสยืนยัน 6 หลักจากแอปยืนยันตัวตน">
                    <OtpCodeInput
                      data-testid="mfa-verify-code"
                      name="first-totp"
                      value={field.state.value}
                      onValueChange={field.handleChange}
                      onBlur={field.handleBlur}
                      aria-invalid={
                        field.state.meta.errors.length > 0 || codeInvalid
                      }
                      aria-describedby={
                        field.state.meta.errors.length > 0
                          ? codeInvalid
                            ? `${VERIFY_TOTP_CLIENT_ERROR_ID} ${VERIFY_TOTP_SERVER_ERROR_ID}`
                            : VERIFY_TOTP_CLIENT_ERROR_ID
                          : codeInvalid
                            ? VERIFY_TOTP_SERVER_ERROR_ID
                            : undefined
                      }
                    />
                    <FieldValidationError
                      data-testid="mfa-verify-client-error"
                      id={VERIFY_TOTP_CLIENT_ERROR_ID}
                      errors={field.state.meta.errors}
                    />
                  </Field>
                )}
              </verifyForm.Field>
            </div>
            <StepFooter
              left={
                <Button
                  wrap
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setError(null);
                    setCodeInvalid(false);
                    setStage("scan");
                  }}
                  data-testid="mfa-verify-back"
                >
                  <ArrowLeftIcon size={16} />
                  ย้อนกลับ
                </Button>
              }
              right={
                <verifyForm.Subscribe
                  selector={(state) => state.isSubmitting}
                  children={(submitting) => (
                    <Button
                      data-testid="mfa-verify-submit"
                      wrap
                      type="submit"
                      disabled={submitting}
                    >
                      <CheckIcon size={16} />
                      {submitting ? "กำลังยืนยัน…" : "ยืนยันและเปิดใช้งาน"}
                    </Button>
                  )}
                />
              }
            />
          </form>
        </>
      )}
    </CardSection>
  );
}

const STEPS = ["ยืนยันรหัสผ่าน", "สแกนและเก็บรหัสกู้คืน", "ยืนยันรหัสแรก"];

function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol
      data-testid="mfa-enrollment-progress"
      aria-label="ขั้นตอนการเปิดใช้งาน"
      className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-center"
    >
      {STEPS.map((label, index) => {
        const n = index + 1;
        const state = n < current ? "done" : n === current ? "current" : "next";
        const last = index === STEPS.length - 1;
        return (
          <li
            key={label}
            data-testid={
              n === 1
                ? "mfa-step-password"
                : n === 2
                  ? "mfa-step-scan"
                  : "mfa-step-verify"
            }
            aria-current={state === "current" ? "step" : undefined}
            className={`flex min-w-0 items-center gap-2 ${last ? "" : "lg:flex-1"}`}
          >
            <span
              className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold ${
                state === "done"
                  ? "bg-primary text-on-primary"
                  : state === "current"
                    ? "border-2 border-primary text-primary"
                    : "border border-control-border text-foreground-secondary"
              }`}
            >
              {state === "done" ? <CheckIcon size={14} /> : n}
            </span>
            <span
              className={`min-w-0 text-sm font-medium ${
                state === "next" ? "text-foreground-secondary" : ""
              }`}
            >
              {label}
            </span>
            {last ? null : (
              <span
                aria-hidden="true"
                className={`hidden h-px min-w-4 flex-1 lg:block ${
                  state === "done" ? "bg-primary" : "bg-foreground/10"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StepFooter({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="flex flex-col items-stretch gap-2 border-t border-foreground/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
      {left}
      {right}
    </div>
  );
}

function CodesHeader({
  title,
  titleRef,
  description,
  codes,
  copied,
  copyFailed,
  onCopy,
  onDownload,
}: {
  title: string;
  /** Makes the title focusable so a view that replaces a form can move focus onto it. */
  titleRef?: RefObject<HTMLParagraphElement | null>;
  description: string;
  codes: string[];
  copied: boolean;
  copyFailed: boolean;
  onCopy: () => void;
  onDownload: (codes: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p
          data-testid="mfa-codes-title"
          ref={titleRef}
          tabIndex={titleRef === undefined ? undefined : -1}
          className="text-sm font-medium outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {title}
        </p>
        <p className="text-xs text-foreground-secondary">{description}</p>
        <CopyStatus
          testId="mfa-codes-copy-status"
          copied={copied}
          failedText={
            copyFailed
              ? "คัดลอกไม่สำเร็จ เลือกรหัสแล้วคัดลอกเอง หรือดาวน์โหลด .txt"
              : null
          }
        />
      </div>
      <div className="flex min-w-0 flex-col items-stretch gap-1 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          data-testid={copied ? "mfa-codes-copy-done" : "mfa-codes-copy-ready"}
          wrap
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCopy}
        >
          <CopyIcon size={14} />
          {copied ? "คัดลอกแล้ว" : "คัดลอกทั้งหมด"}
        </Button>
        <Button
          wrap
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onDownload(codes);
          }}
          data-testid="mfa-codes-download"
        >
          <DownloadIcon size={14} />
          ดาวน์โหลด .txt
        </Button>
      </div>
    </div>
  );
}

// Always mounted so a screen reader announces the text when it appears; the button label alone is not announced.
function CopyStatus({
  copied,
  failedText,
  testId,
}: {
  copied: boolean;
  failedText: string | null;
  testId: string;
}) {
  return (
    <p role="status" data-testid={testId} className="text-xs text-danger">
      {failedText ??
        (copied ? <span className="sr-only">คัดลอกแล้ว</span> : null)}
    </p>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <ul
      data-testid="mfa-recovery-codes"
      className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-md border border-foreground/10 bg-foreground/5 px-4 py-3 sm:grid-cols-2"
    >
      {codes.map((code) => (
        <li
          data-testid="mfa-recovery-code"
          key={code}
          className="min-w-0 break-all font-mono text-sm"
        >
          {code}
        </li>
      ))}
    </ul>
  );
}
