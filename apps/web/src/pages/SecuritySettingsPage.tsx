import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router";

import {
  Alert,
  Field,
  FieldValidationError,
  FullPageLoading,
  Input,
  SubmitButton,
} from "../components/ui";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../lib/api/me";

type EnrollmentDraft = {
  totpURI: string;
  backupCodes: string[];
};

/** Optional TOTP enrollment and recovery-code regeneration. */
export function SecuritySettingsPage() {
  const queryClient = useQueryClient();
  const { data, isPending } = authClient.useSession();
  const meQuery = useQuery({
    queryKey: ME_CONTEXT_QUERY_KEY,
    queryFn: fetchMeContext,
  });
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<EnrollmentDraft | null>(null);
  const [regenerated, setRegenerated] = useState<string[] | null>(null);

  const enableForm = useForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const { data: enableData, error: enableError } =
          await authClient.twoFactor.enable({ password: value.password });
        if (enableError != null) {
          setError(
            authErrorMessage(
              enableError,
              "เปิดใช้งานยืนยันสองขั้นตอนไม่สำเร็จ",
            ),
          );
          return;
        }
        setDraft({
          totpURI: enableData.totpURI,
          backupCodes: enableData.backupCodes,
        });
        enableForm.resetField("password");
      } catch {
        setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  const verifyForm = useForm({
    defaultValues: { code: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const { error: verifyError } = await authClient.twoFactor.verifyTotp({
          code: value.code.trim(),
        });
        if (verifyError != null) {
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
        verifyForm.resetField("code");
        if (refreshed.data?.user.twoFactorEnabled !== true) {
          setError(
            "ยืนยันรหัสแล้วแต่ยังไม่สามารถยืนยันสถานะกับเซิร์ฟเวอร์ได้ กรุณารีเฟรชหน้านี้",
          );
        }
      } catch {
        setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  const regenerateForm = useForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const { data: codesData, error: codesError } =
          await authClient.twoFactor.generateBackupCodes({
            password: value.password,
          });
        if (codesError != null) {
          setError(
            authErrorMessage(codesError, "สร้างรหัสกู้คืนใหม่ไม่สำเร็จ"),
          );
          return;
        }
        setRegenerated(codesData.backupCodes);
        regenerateForm.resetField("password");
      } catch {
        setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  if (isPending) {
    return <FullPageLoading label="กำลังตรวจสอบเซสชัน…" />;
  }
  if (data === null) {
    return <Navigate to="/login" replace />;
  }
  if (meQuery.isPending) {
    return <FullPageLoading label="กำลังโหลดข้อมูลความปลอดภัย…" />;
  }
  if (meQuery.isError) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading />
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
    );
  }

  const twoFactorEnabled = meQuery.data.user.twoFactorEnabled;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading />
      <div className="flex flex-col gap-4">
        <p className="text-sm text-foreground-secondary">
          สถานะปัจจุบัน:{" "}
          <span className="font-medium text-foreground">
            {twoFactorEnabled ? "เปิดใช้งานแล้ว" : "ยังไม่ได้เปิดใช้งาน"}
          </span>
        </p>
        {error === null ? null : <Alert tone="error">{error}</Alert>}

        {twoFactorEnabled ? (
          <div className="flex flex-col gap-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void regenerateForm.handleSubmit();
              }}
              className="flex flex-col gap-4"
              noValidate
            >
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
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                      aria-invalid={field.state.meta.errors.length > 0}
                      aria-describedby={
                        field.state.meta.errors.length > 0
                          ? "regenerate-password-error"
                          : undefined
                      }
                    />
                    <FieldValidationError
                      id="regenerate-password-error"
                      errors={field.state.meta.errors}
                    />
                  </Field>
                )}
              </regenerateForm.Field>
              <regenerateForm.Subscribe
                selector={(state) => state.isSubmitting}
                children={(submitting) => (
                  <SubmitButton pending={submitting} pendingLabel="กำลังสร้าง…">
                    สร้างรหัสกู้คืนใหม่
                  </SubmitButton>
                )}
              />
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
        ) : draft !== null ? (
          <EnrollmentDraftView draft={draft}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void verifyForm.handleSubmit();
              }}
              className="flex flex-col gap-4"
              noValidate
            >
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
                      autoComplete="one-time-code"
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                      aria-invalid={field.state.meta.errors.length > 0}
                      aria-describedby={
                        field.state.meta.errors.length > 0
                          ? "first-totp-error"
                          : undefined
                      }
                    />
                    <FieldValidationError
                      id="first-totp-error"
                      errors={field.state.meta.errors}
                    />
                  </Field>
                )}
              </verifyForm.Field>
              <verifyForm.Subscribe
                selector={(state) => state.isSubmitting}
                children={(submitting) => (
                  <SubmitButton
                    pending={submitting}
                    pendingLabel="กำลังยืนยัน…"
                  >
                    ยืนยันรหัสแรกและเปิดใช้งาน
                  </SubmitButton>
                )}
              />
            </form>
          </EnrollmentDraftView>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void enableForm.handleSubmit();
            }}
            className="flex flex-col gap-4"
            noValidate
          >
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
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                    }}
                    onBlur={field.handleBlur}
                    aria-invalid={field.state.meta.errors.length > 0}
                    aria-describedby={
                      field.state.meta.errors.length > 0
                        ? "enable-password-error"
                        : undefined
                    }
                  />
                  <FieldValidationError
                    id="enable-password-error"
                    errors={field.state.meta.errors}
                  />
                </Field>
              )}
            </enableForm.Field>
            <enableForm.Subscribe
              selector={(state) => state.isSubmitting}
              children={(submitting) => (
                <SubmitButton
                  pending={submitting}
                  pendingLabel="กำลังเปิดใช้งาน…"
                >
                  เปิดใช้งานยืนยันสองขั้นตอน
                </SubmitButton>
              )}
            />
          </form>
        )}

        <p className="text-sm">
          <Link to="/workspace" className="text-primary underline">
            กลับไปพื้นที่ทำงาน
          </Link>
        </p>
      </div>
    </div>
  );
}

function PageHeading() {
  return (
    <div>
      <h1 className="text-xl font-semibold">ความปลอดภัยของบัญชี</h1>
      <p className="mt-1 text-sm text-foreground-secondary">
        ยืนยันสองขั้นตอน (TOTP) ช่วยเพิ่มความปลอดภัยให้บัญชีของคุณ —
        เปิดใช้งานได้ตามต้องการ ไม่บังคับ
      </p>
    </div>
  );
}

function EnrollmentDraftView({
  draft,
  children,
}: {
  draft: EnrollmentDraft;
  children: ReactNode;
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
      {children}
    </div>
  );
}
