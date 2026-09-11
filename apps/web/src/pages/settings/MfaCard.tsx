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
import { Alert, Field, FieldValidationError, Input } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { authClient, authErrorMessage } from "../../lib/auth-client";

type EnrollmentDraft = { totpURI: string; backupCodes: string[] };

/** Where the not-yet-enabled side of the card is. */
type Stage = "idle" | "password" | "scan" | "verify";

const REFRESH_GUARD_MESSAGE =
  "ยืนยันรหัสแล้วแต่ยังไม่สามารถยืนยันสถานะกับเซิร์ฟเวอร์ได้ กรุณารีเฟรชหน้านี้";

function secretFromUri(totpURI: string): string | null {
  const secret = totpURI.split("secret=")[1]?.split("&")[0];
  return secret === undefined || secret === "" ? null : secret;
}

function groupedSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

function downloadCodes(codes: string[]): void {
  const blob = new Blob(
    [
      `รหัสกู้คืน NightWatch\nแต่ละรหัสใช้ได้ครั้งเดียว\n\n${codes.join("\n")}\n`,
    ],
    { type: "text/plain;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "nightwatch-recovery-codes.txt";
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Two-factor (TOTP) card. Enrolment runs inline as three steps — password,
 * scan + save recovery codes, verify the first code — and the enabled
 * state offers recovery-code regeneration. `enabled` is the server's word
 * (me/context); nothing here claims "enabled" before `refreshStatus`
 * confirms it. The enrolment draft (secret, codes, QR) lives only in this
 * component's state and is dropped on cancel, back, success or unmount.
 */
export function MfaCard({
  enabled,
  refreshStatus,
}: {
  enabled: boolean;
  refreshStatus: () => Promise<boolean | undefined>;
}) {
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
  const [copied, setCopied] = useState<null | "secret" | "codes">(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);
  const enableTriggerRef = useRef<HTMLButtonElement>(null);
  const regenTriggerRef = useRef<HTMLButtonElement>(null);
  const disableTriggerRef = useRef<HTMLButtonElement>(null);
  // Inline panels are not overlays, but focus still moves into an opened
  // panel (autoFocus on its field) and back to the button that opened it
  // when it closes — that button remounts, so the return happens after
  // the next render.
  const pendingFocus = useRef<RefObject<HTMLButtonElement | null> | null>(null);
  useEffect(() => {
    // Stays pending until the target button is actually mounted (e.g. the
    // enable button only appears once the parent reports enabled=false).
    const target = pendingFocus.current?.current;
    if (target !== null && target !== undefined) {
      target.focus();
      pendingFocus.current = null;
    }
  });

  useEffect(() => {
    if (enabled) {
      setDraft(null);
      setStage("idle");
      setAcknowledged(false);
    }
  }, [enabled]);

  // The QR is derived from the draft's URI and never stored anywhere else.
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
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      if (copiedTimer.current !== null) {
        clearTimeout(copiedTimer.current);
      }
      copiedTimer.current = setTimeout(() => {
        setCopied(null);
      }, 1500);
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
    <section
      aria-labelledby="mfa-card-title"
      className="flex flex-col gap-5 rounded-md border border-foreground/10 bg-surface p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="mfa-card-title" className="text-base font-semibold">
            ยืนยันสองขั้นตอน (MFA)
          </h2>
          <p className="mt-1 text-sm text-foreground-secondary">
            ใช้รหัส 6 หลักจากแอปยืนยันตัวตน (TOTP) เพิ่มอีกชั้นเมื่อเข้าสู่ระบบ
            — ไม่บังคับ แต่แนะนำสำหรับเจ้าของและผู้ดูแลองค์กร
          </p>
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>

      {enabled ? (
        <>
          {justEnabled ? (
            <Alert tone="success">
              เปิดใช้งานยืนยันสองขั้นตอนแล้ว —
              ครั้งถัดไปที่เข้าสู่ระบบจะต้องกรอกรหัสจากแอปด้วย
            </Alert>
          ) : null}
          <div className="flex flex-col rounded-md border border-foreground/10">
            <div className="flex items-center justify-between gap-3 border-b border-foreground/10 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <IconTile tone="positive">
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
                  ref={disableTriggerRef}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="text-danger"
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
                <Alert tone="error">
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
                      <Field label="ยืนยันรหัสผ่านปัจจุบันเพื่อปิดใช้งาน">
                        <Input
                          type="password"
                          name="disable-password"
                          autoComplete="current-password"
                          autoFocus
                          value={field.state.value}
                          onChange={(event) => {
                            field.handleChange(event.target.value);
                          }}
                          onBlur={field.handleBlur}
                          aria-invalid={
                            field.state.meta.errors.length > 0 ||
                            disableError !== null
                          }
                          aria-describedby={
                            field.state.meta.errors.length > 0 ||
                            disableError !== null
                              ? "disable-password-error"
                              : undefined
                          }
                        />
                        {disableError === null ? (
                          <FieldValidationError
                            id="disable-password-error"
                            errors={field.state.meta.errors}
                          />
                        ) : (
                          <span
                            id="disable-password-error"
                            role="alert"
                            className="mt-1 block text-sm text-danger"
                          >
                            {disableError}
                          </span>
                        )}
                      </Field>
                    )}
                  </disableForm.Field>
                </div>
                <div className="flex items-center gap-2">
                  <disableForm.Subscribe
                    selector={(state) => state.isSubmitting}
                    children={(submitting) => (
                      <Button
                        type="submit"
                        variant="destructive"
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
                    ใช้แทนรหัสจากแอปเมื่อเข้าถึงโทรศัพท์ไม่ได้ ·
                    สร้างชุดใหม่ได้ทุกเมื่อ ชุดเดิมจะใช้ไม่ได้ทันที
                  </p>
                </div>
              </div>
              {regen === null ? (
                <Button
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
                      <Field label="รหัสผ่านปัจจุบัน (จำเป็นสำหรับสร้างรหัสกู้คืนชุดใหม่)">
                        <Input
                          type="password"
                          name="regenerate-password"
                          autoComplete="current-password"
                          autoFocus
                          value={field.state.value}
                          onChange={(event) => {
                            field.handleChange(event.target.value);
                          }}
                          onBlur={field.handleBlur}
                          aria-invalid={
                            field.state.meta.errors.length > 0 ||
                            regenError !== null
                          }
                          aria-describedby={
                            field.state.meta.errors.length > 0 ||
                            regenError !== null
                              ? "regenerate-password-error"
                              : undefined
                          }
                        />
                        {regenError === null ? (
                          <FieldValidationError
                            id="regenerate-password-error"
                            errors={field.state.meta.errors}
                          />
                        ) : (
                          <span
                            id="regenerate-password-error"
                            role="alert"
                            className="mt-1 block text-sm text-danger"
                          >
                            {regenError}
                          </span>
                        )}
                      </Field>
                    )}
                  </regenerateForm.Field>
                </div>
                <div className="flex items-center gap-2">
                  <regenerateForm.Subscribe
                    selector={(state) => state.isSubmitting}
                    children={(submitting) => (
                      <Button type="submit" disabled={submitting}>
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
                  >
                    ยกเลิก
                  </Button>
                </div>
              </form>
            ) : null}
            {regen !== null && regen !== "form" ? (
              <div className="flex flex-col gap-3 border-t border-foreground/10 p-4">
                <CodesHeader
                  title="รหัสกู้คืนชุดใหม่"
                  description="แสดงเพียงครั้งนี้ · แต่ละรหัสใช้ได้ครั้งเดียว · ชุดเดิมใช้ไม่ได้แล้ว"
                  codes={regen.codes}
                  copied={copied === "codes"}
                  onCopy={() => {
                    copy(regen.codes.join("\n"), "codes");
                  }}
                />
                <BackupCodes codes={regen.codes} />
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setRegen(null);
                      pendingFocus.current = regenTriggerRef;
                    }}
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
                Google Authenticator, 1Password, Authy หรือแอป TOTP อื่น ·
                ใช้เวลาตั้งค่าประมาณ 2 นาที
              </p>
            </div>
          </div>
          <Button
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
            className="flex flex-col gap-5"
          >
            <div className="flex max-w-md flex-col gap-4">
              <p className="text-sm text-foreground-secondary">
                ยืนยันตัวตนอีกครั้งก่อนเปลี่ยนวิธีเข้าสู่ระบบ —
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
                  <Field label="รหัสผ่านปัจจุบัน">
                    <Input
                      type="password"
                      name="password"
                      autoComplete="current-password"
                      autoFocus
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                      aria-invalid={
                        field.state.meta.errors.length > 0 ||
                        enableError !== null
                      }
                      aria-describedby={
                        field.state.meta.errors.length > 0 ||
                        enableError !== null
                          ? "enable-password-error"
                          : undefined
                      }
                    />
                    {enableError === null ? (
                      <FieldValidationError
                        id="enable-password-error"
                        errors={field.state.meta.errors}
                      />
                    ) : (
                      <span
                        id="enable-password-error"
                        role="alert"
                        className="mt-1 block text-sm text-danger"
                      >
                        {enableError}
                      </span>
                    )}
                  </Field>
                )}
              </enableForm.Field>
            </div>
            <StepFooter
              left={
                <Button type="button" variant="ghost" onClick={resetEnrollment}>
                  ยกเลิก
                </Button>
              }
              right={
                <enableForm.Subscribe
                  selector={(state) => state.isSubmitting}
                  children={(submitting) => (
                    <Button type="submit" disabled={submitting}>
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
                    สร้างคิวอาร์โค้ดไม่สำเร็จ — ใช้คีย์ด้านล่างแทน
                  </p>
                )}
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">1. สแกนด้วยแอปยืนยันตัวตน</p>
                <p className="text-sm text-foreground-secondary">
                  หรือกรอกคีย์นี้ในแอปด้วยตนเองถ้าสแกนไม่ได้
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="block min-w-0 flex-1 truncate rounded-md border border-foreground/10 bg-foreground/5 px-3 py-2 font-mono text-sm tracking-wider">
                    {secretDisplay}
                  </code>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      copy(secret ?? draft.totpURI, "secret");
                    }}
                  >
                    <CopyIcon size={14} />
                    {copied === "secret" ? "คัดลอกแล้ว" : "คัดลอก"}
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <CodesHeader
                  title="2. เก็บรหัสกู้คืนไว้ในที่ปลอดภัย"
                  description="ใช้แทนรหัสจากแอปเมื่อเข้าถึงโทรศัพท์ไม่ได้ · แต่ละรหัสใช้ได้ครั้งเดียว · แสดงเพียงครั้งนี้"
                  codes={draft.backupCodes}
                  copied={copied === "codes"}
                  onCopy={() => {
                    copy(draft.backupCodes.join("\n"), "codes");
                  }}
                />
                <BackupCodes codes={draft.backupCodes} />
              </div>
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => {
                    setAcknowledged(event.target.checked);
                  }}
                  className="mt-0.5 h-4 w-4 accent-primary"
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
                type="button"
                variant="ghost"
                onClick={() => {
                  // A new enable call issues a new secret; the current draft
                  // is therefore discarded here, not kept around.
                  setDraft(null);
                  setAcknowledged(false);
                  setStage("password");
                }}
              >
                <ArrowLeftIcon size={16} />
                ย้อนกลับ
              </Button>
            }
            right={
              <Button
                type="button"
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
            className="flex flex-col gap-5"
          >
            <div className="flex max-w-md flex-col gap-4">
              <p className="text-sm text-foreground-secondary">
                กรอกรหัสที่แอปแสดงอยู่ตอนนี้ — MFA
                จะเปิดใช้งานเมื่อรหัสแรกถูกต้องเท่านั้น รหัสเปลี่ยนทุก{" "}
                <span className="font-mono">30</span> วินาที
              </p>
              {error === null ? null : <Alert tone="error">{error}</Alert>}
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
                    <Input
                      type="text"
                      name="first-totp"
                      inputMode="numeric"
                      autoFocus
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="000000"
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(
                          event.target.value.replace(/[^0-9]/g, "").slice(0, 6),
                        );
                      }}
                      onBlur={field.handleBlur}
                      aria-invalid={
                        field.state.meta.errors.length > 0 || codeInvalid
                      }
                      aria-describedby={
                        field.state.meta.errors.length > 0
                          ? "first-totp-error"
                          : undefined
                      }
                      className="w-56 text-center font-mono text-2xl tracking-[0.35em]"
                    />
                    <FieldValidationError
                      id="first-totp-error"
                      errors={field.state.meta.errors}
                    />
                  </Field>
                )}
              </verifyForm.Field>
            </div>
            <StepFooter
              left={
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setError(null);
                    setCodeInvalid(false);
                    setStage("scan");
                  }}
                >
                  <ArrowLeftIcon size={16} />
                  ย้อนกลับ
                </Button>
              }
              right={
                <verifyForm.Subscribe
                  selector={(state) => state.isSubmitting}
                  children={(submitting) => (
                    <Button type="submit" disabled={submitting}>
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
    </section>
  );
}

const STEPS = ["ยืนยันรหัสผ่าน", "สแกนและเก็บรหัสกู้คืน", "ยืนยันรหัสแรก"];

function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol
      aria-label="ขั้นตอนการเปิดใช้งาน"
      className="flex items-center gap-2 overflow-x-auto"
    >
      {STEPS.map((label, index) => {
        const n = index + 1;
        const state = n < current ? "done" : n === current ? "current" : "next";
        const last = index === STEPS.length - 1;
        return (
          <li
            key={label}
            aria-current={state === "current" ? "step" : undefined}
            className={`flex items-center gap-2 ${last ? "" : "flex-1"}`}
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
              className={`text-[13px] font-medium whitespace-nowrap ${
                state === "next" ? "text-foreground-secondary" : ""
              }`}
            >
              {label}
            </span>
            {last ? null : (
              <span
                aria-hidden="true"
                className={`h-px min-w-4 flex-1 ${
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
    <div className="flex items-center justify-between gap-2 border-t border-foreground/10 pt-4">
      {left}
      {right}
    </div>
  );
}

function CodesHeader({
  title,
  description,
  codes,
  copied,
  onCopy,
}: {
  title: string;
  description: string;
  codes: string[];
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-foreground-secondary">{description}</p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCopy}>
          <CopyIcon size={14} />
          {copied ? "คัดลอกแล้ว" : "คัดลอกทั้งหมด"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            downloadCodes(codes);
          }}
        >
          <DownloadIcon size={14} />
          ดาวน์โหลด .txt
        </Button>
      </div>
    </div>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border border-foreground/10 bg-foreground/5 px-4 py-3">
      {codes.map((code) => (
        <li key={code} className="font-mono text-sm">
          {code}
        </li>
      ))}
    </ul>
  );
}

function IconTile({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "positive";
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-foreground/10 bg-foreground/5 ${
        tone === "positive" ? "text-primary" : "text-foreground-secondary"
      }`}
    >
      {children}
    </span>
  );
}

function StatusBadge({
  tone,
  children,
}: {
  tone: "neutral" | "caution" | "positive";
  children: ReactNode;
}) {
  const color =
    tone === "positive"
      ? "text-primary"
      : tone === "caution"
        ? "text-caution"
        : "text-foreground-secondary";
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-foreground/10 bg-surface px-2 py-0.5 text-xs font-medium whitespace-nowrap ${color}`}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-current"
      />
      {children}
    </span>
  );
}
