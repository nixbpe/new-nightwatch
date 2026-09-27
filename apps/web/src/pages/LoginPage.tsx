import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useSearchParams } from "react-router";

import { BrandMark } from "../components/shell/BrandMark";
import {
  EyeIcon,
  EyeOffIcon,
  LayersIcon,
  LockIcon,
  SearchIcon,
} from "../components/shell/icons";
import {
  Alert,
  Field,
  FieldValidationError,
  Input,
  SubmitButton,
} from "../components/ui";
import { Label } from "../components/ui/label";
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
          if (signInError.status === 403 || /not verified/i.test(message)) {
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
    <div className="grid min-h-screen lg:grid-cols-[560px_minmax(0,1fr)]">
      <BrandPanel />
      <div className="flex flex-col">
        <div className="px-4 pt-4 sm:px-8 sm:pt-8 lg:hidden">
          <BrandMark size={28} withName />
        </div>
        <main className="flex flex-1 items-start justify-center px-4 pt-10 pb-8 sm:px-8 lg:items-center lg:py-8">
          <div className="flex w-full max-w-[360px] flex-col gap-6">
            <div>
              <h1 className="text-2xl font-semibold">เข้าสู่ระบบ</h1>
              <p className="mt-2 text-sm text-foreground-secondary">
                ใช้อีเมลและรหัสผ่านที่ได้รับการเชิญเท่านั้น
              </p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void form.handleSubmit();
              }}
              className="flex flex-col gap-4"
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
                    <Label htmlFor="login-password" className="mb-2 block">
                      รหัสผ่าน
                    </Label>
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
              <div className="flex items-center justify-between text-sm">
                <Link to="/forgot-password" className="text-primary underline">
                  ลืมรหัสผ่าน
                </Link>
              </div>
              <form.Subscribe
                selector={(state) => state.isSubmitting}
                children={(isSubmitting) => (
                  <SubmitButton
                    pending={isSubmitting}
                    pendingLabel="กำลังเข้าสู่ระบบ…"
                  >
                    เข้าสู่ระบบ
                  </SubmitButton>
                )}
              />
              <p className="text-center text-sm text-foreground-secondary">
                ยังไม่มีคำเชิญ? ติดต่อผู้ดูแลองค์กรของคุณ
              </p>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}

const BULLETS = [
  {
    icon: LayersIcon,
    label: "มองเห็นความเสี่ยงข้ามโปรเจกต์",
    desc: "เทียบลำดับความสำคัญของทุกโปรเจกต์ในลูกค้าองค์กรเดียวกัน",
  },
  {
    icon: SearchIcon,
    label: "หลักฐานและเหตุผลที่ตรวจสอบได้",
    desc: "ทุกลำดับความเสี่ยงมาพร้อมเหตุผล หลักฐาน และข้อมูลที่ยังขาดอยู่",
  },
  {
    icon: LockIcon,
    label: "แยกข้อมูลแต่ละลูกค้าอย่างเคร่งครัด",
    desc: "ขอบเขตองค์กรไม่ปะปนกัน แม้ผู้ให้บริการจะดูแลหลายลูกค้า",
  },
] as const;

// Fixed dark panel, deliberately independent of the light/dark theme tokens.
function BrandPanel() {
  return (
    <aside className="hidden flex-col justify-between overflow-hidden bg-[#05060a] p-14 text-[#f3f4f6] lg:flex">
      <div className="flex flex-col gap-6">
        <BrandMark size={36} withName />
        <h2 className="max-w-[440px] text-[28px] leading-9 font-semibold">
          จัดลำดับความเสี่ยงที่ควรแก้ไขก่อน ครอบคลุมทุกโปรเจกต์ของลูกค้า
        </h2>
        <p className="max-w-[380px] text-sm text-white/70">
          แพลตฟอร์มความปลอดภัยคลาวด์สำหรับผู้ให้บริการที่ดูแล AWS
          ให้ลูกค้าหลายราย
        </p>
      </div>
      <div className="flex flex-col gap-5">
        {BULLETS.map((bullet) => (
          <div key={bullet.label} className="flex gap-3">
            <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[4px] bg-white/8 text-white">
              <bullet.icon size={16} />
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-white">
                {bullet.label}
              </span>
              <span className="text-[13px] text-white/64">{bullet.desc}</span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
