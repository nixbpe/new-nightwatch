import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useSearchParams } from "react-router";

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

/**
 * Split layout picked from the login redesign (see docs/ref/designs/): a
 * fixed dark brand panel states the product's value in the user's own words
 * from docs/product-direction.md, independent of the app's light/dark theme;
 * the form panel follows the current theme via the shared tokens every other
 * page already uses. Below the `lg` breakpoint the brand panel collapses to
 * the compact row so the page reflows instead of losing content.
 *
 * Known gap (tracked, not fixed here): the mockup's 4px corners and
 * hairline-not-shadow card treatment (docs/design-system.md) apply only to
 * the elements introduced by this page. The shared Input/SubmitButton still
 * render at their current global radius until index.css's tokens migrate —
 * that is a separate, app-wide change, not scoped to this page.
 */
export function LoginPage() {
  // The protected-route loaders bounce here as /login?from=<path+query>;
  // same-origin paths only, anything else falls back to the workspace.
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
        <div className="flex items-center gap-2.5 px-6 pt-6 lg:hidden">
          <BrandMark size={28} />
          <span className="text-base font-semibold">NightWatch</span>
        </div>
        <main className="flex flex-1 items-center justify-center p-4 sm:p-8">
          <div className="flex w-full max-w-[360px] flex-col gap-5">
            <div>
              <h1 className="text-2xl font-semibold">เข้าสู่ระบบ</h1>
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
                  // Not <Field>: the show/hide button must be a sibling of
                  // the label, not nested inside it — a <label> wraps both
                  // implicitly, and getByLabelText("รหัสผ่าน") would then
                  // match the button too. Explicit htmlFor/id keeps the same
                  // accessible association (and the same visual output) with
                  // only the <input> associated to the label.
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="login-password" className="mb-1 block">
                      รหัสผ่าน
                    </Label>
                    <div className="relative flex items-center">
                      <Input
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        name="password"
                        autoComplete="current-password"
                        className="pr-10"
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
                        className="absolute right-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                        {/* Visible/accessible name via inner text, not
                            aria-label: an aria-label containing "รหัสผ่าน"
                            gets matched by getByLabelText too, colliding
                            with the password field's own label. */}
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

/** 36px shield mark on a solid primary square (4px corners, per the redesign). */
function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span
      className="inline-flex flex-shrink-0 items-center justify-center rounded-[4px] bg-primary text-on-primary"
      style={{ width: size, height: size }}
    >
      <ShieldIcon size={Math.round(size * 0.55)} />
    </span>
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

/**
 * Fixed dark brand panel — deliberately independent of the app's light/dark
 * theme tokens (a fixed identity panel, not a themed surface); hidden below
 * `lg`, where the compact top row in LoginPage takes over.
 */
function BrandPanel() {
  return (
    <aside className="hidden flex-col justify-between overflow-hidden bg-[#05060a] p-14 text-[#f3f4f6] lg:flex">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <BrandMark size={36} />
          <span className="text-lg font-semibold">NightWatch</span>
        </div>
        <h2 className="max-w-[380px] text-[26px] leading-[34px] font-semibold">
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

// Inline SVGs, stroke-based on a 24px grid, matching the icon style already
// established for this design (docs/ref/designs/) — no icon library dependency.
function iconProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function ShieldIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  );
}

function LayersIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
  );
}

function SearchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function LockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg {...iconProps(18)}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg {...iconProps(18)}>
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61C3.94 8.42 2 12 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
