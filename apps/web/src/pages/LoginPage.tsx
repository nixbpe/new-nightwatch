import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useSearchParams } from "react-router";

import { AuthEyebrow, AuthHeader } from "../components/shell/AuthFrame";
import { EyeIcon, EyeOffIcon } from "../components/shell/icons";
import {
  Alert,
  Field,
  FieldValidationError,
  Input,
  SubmitButton,
} from "../components/ui";
import { Label } from "../components/ui/label";
import { MockupFrame } from "../components/ui/mockup-frame";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { normalizeReturnTo, rememberReturnTo } from "../lib/auth/continuation";

export function LoginPage() {
  // Loaders bounce here as /login?from=<path+query>; only same-origin paths are honored.
  const [searchParams] = useSearchParams();
  const fromParam = searchParams.get("from");
  const from = normalizeReturnTo(fromParam);

  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
          if (
            signInError.status === 403 ||
            signInError.code === "EMAIL_NOT_VERIFIED"
          ) {
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
    <div className="flex min-h-screen flex-col">
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
                ใช้อีเมลและรหัสผ่านที่ได้รับการเชิญเท่านั้น
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
              {error === null ? null : (
                <Alert tone={needsVerification ? "info" : "error"}>
                  {needsVerification ? (
                    <>
                      {error}{" "}
                      <Link
                        to="/verify-email"
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
                        className="text-[13px] text-primary underline underline-offset-4"
                      >
                        ลืมรหัสผ่าน
                      </Link>
                    </div>
                    <div className="relative flex items-center">
                      <Input
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        name="password"
                        autoComplete="current-password"
                        className="pr-11"
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
                      <button
                        type="button"
                        onClick={() => {
                          setShowPassword((value) => !value);
                        }}
                        className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-foreground-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                        {/* Inner text, not aria-label: an aria-label containing "รหัสผ่าน" collides with the field's label. */}
                        <span className="sr-only">
                          {showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                        </span>
                      </button>
                    </div>
                    <FieldValidationError
                      id="login-password-error"
                      errors={field.state.meta.errors}
                    />
                  </div>
                )}
              </form.Field>
              <form.Subscribe
                selector={(state) => state.isSubmitting}
                children={(isSubmitting) => (
                  <SubmitButton
                    pending={isSubmitting}
                    pendingLabel="กำลังเข้าสู่ระบบ…"
                  >
                    เข้าสู่ระบบ <span aria-hidden="true">→</span>
                  </SubmitButton>
                )}
              />
            </form>
            <p className="text-xs text-foreground-secondary">
              ยังไม่มีคำเชิญ? ติดต่อผู้ดูแลองค์กรของคุณ
            </p>
            <MockupFrame label="จดจำอุปกรณ์นี้" issue={65}>
              <label className="flex items-center gap-3 text-[13px] text-foreground-secondary">
                <input
                  type="checkbox"
                  disabled
                  className="size-4 rounded border-control-border accent-[var(--primary)]"
                />
                จดจำอุปกรณ์นี้ <span className="font-mono">30</span> วัน
              </label>
            </MockupFrame>
            <MockupFrame label="ลิงก์ช่วยเหลือ" issue={67}>
              <div className="flex gap-6 text-[13px] text-foreground-secondary">
                <span>เอกสาร</span>
                <span>ติดต่อผู้ดูแล</span>
              </div>
            </MockupFrame>
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
        <h2 className="max-w-[560px] text-[40px] leading-[1.4] font-semibold text-heading">
          จัดลำดับความเสี่ยงที่ควรแก้ไขก่อน ครอบคลุมทุกโปรเจกต์ของลูกค้า
        </h2>
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
