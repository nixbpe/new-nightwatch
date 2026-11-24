import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { Link, useLocation, useSearchParams } from "react-router";

import { AuthEyebrow, AuthHeader } from "../components/shell/AuthFrame";
import {
  Alert,
  Field,
  FieldValidationError,
  Input,
  SubmitButton,
} from "../components/ui";
import { Label } from "../components/ui/label";
import { Notice } from "../components/ui/notice";
import { PasswordInput } from "../components/ui/password-input";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { fetchInvitation, invitationQueryKey } from "../lib/api/invitations";
import {
  normalizeReturnTo,
  readInvitation,
  rememberReturnTo,
} from "../lib/auth/continuation";
import {
  readAuthFlowState,
  type AuthFlowState,
  type AuthNotice,
} from "../lib/auth/flow";

const NOTICE_TEXT: Record<AuthNotice, string> = {
  "email-verified": "ยืนยันอีเมลแล้ว กรุณาเข้าสู่ระบบ",
  "password-reset": "ตั้งรหัสผ่านใหม่แล้ว เข้าสู่ระบบด้วยรหัสผ่านใหม่",
};

export function LoginPage() {
  // Loaders bounce here as /login?from=<path+query>; only same-origin paths are honored.
  const [searchParams] = useSearchParams();
  const fromParam = searchParams.get("from");
  const from = normalizeReturnTo(fromParam);
  const { notice } = readAuthFlowState(useLocation().state);

  const [error, setError] = useState<string | null>(null);
  // Set once sign-in succeeded: the page changes only after the session refetch and loader re-run.
  const [redirecting, setRedirecting] = useState(false);
  // The refused address, so the verification page needs no retyping; null when the sign-in was not refused for it.
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  // A remembered invitation means this sign-in is to accept it; say which one and for which address.
  const pendingInvitationId = readInvitation();
  const invitationPreview = useQuery({
    queryKey: invitationQueryKey(pendingInvitationId ?? ""),
    queryFn: () => fetchInvitation(pendingInvitationId ?? ""),
    enabled: pendingInvitationId !== null,
    retry: false,
  });
  const invited = invitationPreview.data?.invitation;
  // A loader sent the user here from a deeper page. The loader cannot tell an expired session from a
  // first visit, so the notice says where sign-in leads and does not claim expiry. /workspace is the default entry.
  const showReturnNotice =
    fromParam !== null &&
    from !== "/workspace" &&
    invited === undefined &&
    notice === undefined;

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      setUnverifiedEmail(null);
      rememberReturnTo(from);
      try {
        const { data, error: signInError } = await authClient.signIn.email({
          email: value.email.trim(),
          password: value.password,
        });
        if (signInError != null) {
          const message = authErrorMessage(signInError, "เข้าสู่ระบบไม่สำเร็จ");
          if (
            signInError.status === 403 ||
            signInError.code === "EMAIL_NOT_VERIFIED"
          ) {
            setUnverifiedEmail(value.email.trim());
          }
          setError(message);
          return;
        }
        // The two-factor plugin navigates the whole window to the challenge; keep the form usable
        // for when the browser restores this page (Back) from its cache.
        if ("twoFactorRedirect" in data && data.twoFactorRedirect === true)
          return;
        setRedirecting(true);
      } catch {
        setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  useEffect(() => {
    if (invited !== undefined && form.state.values.email === "") {
      form.setFieldValue("email", invited.email);
    }
  }, [form, invited]);

  return (
    <div data-testid="login-page" className="flex min-h-screen flex-col">
      <AuthHeader />
      <div className="grid flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <BrandPanel />
        <main className="flex items-start justify-center px-4 pt-10 pb-8 sm:px-8 lg:items-center lg:py-12">
          <div className="flex w-full max-w-[400px] flex-col gap-6">
            <div>
              <AuthEyebrow>// sign in</AuthEyebrow>
              <h1 className="mt-2 text-[28px] leading-9 font-semibold text-heading">
                เข้าสู่ระบบ
              </h1>
              <p className="mt-1 text-sm text-foreground-secondary">
                เข้าสู่ระบบด้วยบัญชีที่สร้างจากคำเชิญ
              </p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void form.handleSubmit();
              }}
              className="flex flex-col gap-5"
              noValidate
            >
              {invited === undefined ? null : (
                <Alert data-testid="login-invitation" tone="info" role="status">
                  {`เข้าสู่ระบบเพื่อเข้าร่วมองค์กร ${invited.organizationName} ด้วยอีเมล ${invited.email}`}
                </Alert>
              )}
              {showReturnNotice ? (
                <Alert data-testid="login-return-notice" tone="info">
                  เข้าสู่ระบบเพื่อกลับไปยังหน้าที่เปิดไว้
                </Alert>
              ) : null}
              {error !== null || notice === undefined ? null : (
                <Notice tone="success" data-testid="login-notice">
                  {NOTICE_TEXT[notice]}
                </Notice>
              )}
              {error === null ? null : (
                <Alert
                  data-testid="login-auth-error"
                  tone={unverifiedEmail !== null ? "info" : "error"}
                  role="alert"
                >
                  {unverifiedEmail !== null ? (
                    <>
                      {error}{" "}
                      <Link
                        to="/verify-email"
                        state={
                          { email: unverifiedEmail } satisfies AuthFlowState
                        }
                        data-testid="login-verify-email"
                        className="font-medium underline"
                      >
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
                      data-testid="login-email"
                      type="email"
                      name="email"
                      autoComplete="email"
                      placeholder="name@company.com"
                      className="font-mono"
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                      aria-invalid={field.state.meta.errors.length > 0}
                      aria-describedby={
                        field.state.meta.errors.length > 0
                          ? "login-email-error"
                          : undefined
                      }
                    />
                    <FieldValidationError
                      id="login-email-error"
                      data-testid="login-email-error"
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
                  // Not <Field>: a wrapping <label> would also label the show/hide button.
                  <div className="flex flex-col gap-1">
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <Label htmlFor="login-password">รหัสผ่าน</Label>
                      <Link
                        to="/forgot-password"
                        data-testid="login-forgot-password"
                        className="inline-flex min-h-6 items-center text-[13px] text-primary underline underline-offset-4"
                      >
                        ลืมรหัสผ่าน
                      </Link>
                    </div>
                    <PasswordInput
                      id="login-password"
                      data-testid="login-password"
                      toggleTestId="login-password-toggle"
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
                      data-testid="login-password-error"
                      errors={field.state.meta.errors}
                    />
                  </div>
                )}
              </form.Field>
              <form.Subscribe
                selector={(state) => state.isSubmitting}
                children={(isSubmitting) => (
                  <SubmitButton
                    data-testid="login-submit"
                    pending={isSubmitting || redirecting}
                    pendingLabel="กำลังเข้าสู่ระบบ…"
                  >
                    เข้าสู่ระบบ <span aria-hidden="true">→</span>
                  </SubmitButton>
                )}
              />
            </form>
            <p className="text-xs text-foreground-secondary">
              ยังไม่มีคำเชิญ? ติดต่อเจ้าของหรือผู้ดูแลองค์กร
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

const BULLETS = [
  {
    label: "มองเห็นความเสี่ยงข้ามโปรเจกต์",
    desc: "เทียบลำดับความสำคัญของทุกโปรเจกต์ในลูกค้าองค์กรเดียวกัน",
  },
  {
    label: "หลักฐานและเหตุผลที่ตรวจสอบได้",
    desc: "ทุกลำดับความเสี่ยงมาพร้อมเหตุผล หลักฐาน และข้อมูลที่ยังขาดอยู่",
  },
  {
    label: "แยกข้อมูลแต่ละลูกค้าอย่างเคร่งครัด",
    desc: "ขอบเขตองค์กรไม่ปะปนกัน แม้ผู้ให้บริการจะดูแลหลายลูกค้า",
  },
] as const;

// Follows the theme tokens. The radar is decoration only: it sits in the corner and the text blocks are
// opaque Surface above it, so no ring line runs through a glyph.
function BrandPanel() {
  return (
    <aside className="relative hidden flex-col justify-between gap-12 overflow-hidden border-r border-foreground/10 bg-surface px-16 py-[72px] lg:flex">
      <div className="relative z-10 flex flex-col gap-5 bg-surface">
        {/* A <p>, not a heading: the aside comes before <main> in the DOM, so an h2 here would precede the page h1. */}
        <p className="max-w-[560px] text-[40px] leading-[1.4] font-semibold text-heading">
          จัดลำดับความเสี่ยงที่ควรแก้ไขก่อน ครอบคลุมทุกโปรเจกต์ของลูกค้า
        </p>
        <p className="max-w-[480px] text-base text-foreground-secondary">
          แพลตฟอร์มความปลอดภัยคลาวด์สำหรับผู้ให้บริการที่ดูแล AWS
          ให้ลูกค้าหลายราย
        </p>
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-56 -bottom-56 size-[560px]"
      >
        {[560, 420, 280].map((size) => (
          <span
            key={size}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/10"
            style={{ width: size, height: size }}
          />
        ))}
        <span className="absolute top-1/2 left-1/2 size-[140px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary" />
        <span className="absolute top-1/2 left-1/2 h-px w-[280px] origin-left -rotate-[38deg] bg-primary" />
        <span className="absolute top-[calc(50%-150px)] left-[calc(50%+140px)] size-2 rounded-full bg-primary" />
        <span className="absolute top-[calc(50%-60px)] left-[calc(50%-90px)] size-1.5 rounded-full bg-foreground/10" />
      </div>
      <ul className="relative z-10 flex max-w-[520px] flex-col gap-5 bg-surface">
        {BULLETS.map((bullet, index) => (
          <li key={bullet.label} className="flex gap-4">
            <span
              aria-hidden="true"
              className="pt-0.5 font-mono text-xs text-foreground-secondary"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-heading">
                {bullet.label}
              </span>
              <span className="text-[13px] text-foreground-secondary">
                {bullet.desc}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
