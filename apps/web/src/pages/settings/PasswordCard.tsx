import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { EyeIcon, EyeOffIcon } from "../../components/shell/icons";
import { Alert, FieldValidationError, Input } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { authClient, authErrorMessage } from "../../lib/auth-client";

const MIN_LENGTH = 8;

/**
 * Change password. Other sessions are revoked on success (better-auth
 * `revokeOtherSessions`), which the footer says up front. A rejected
 * current password is reported on that field; other failures as an alert.
 */
export function PasswordCard() {
  const [notice, setNotice] = useState<string | null>(null);
  const [currentPasswordError, setCurrentPasswordError] = useState<
    string | null
  >(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [reveal, setReveal] = useState({
    current: false,
    next: false,
    confirm: false,
  });

  const form = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      setNotice(null);
      setFormError(null);
      setCurrentPasswordError(null);
      try {
        const { error } = await authClient.changePassword({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
          revokeOtherSessions: true,
        });
        if (error != null) {
          const message = authErrorMessage(error, "เปลี่ยนรหัสผ่านไม่สำเร็จ");
          if (error.status === 400 || error.code === "INVALID_PASSWORD") {
            setCurrentPasswordError(message);
          } else {
            setFormError(message);
          }
          return;
        }
        form.reset();
        setReveal({ current: false, next: false, confirm: false });
        setNotice("เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นทุกเครื่องถูกออกจากระบบ");
      } catch {
        setFormError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  const toggle = (key: keyof typeof reveal) => {
    setReveal((value) => ({ ...value, [key]: !value[key] }));
  };

  return (
    <section
      aria-labelledby="password-card-title"
      className="flex flex-col gap-5 rounded-md border border-foreground/10 bg-surface p-6"
    >
      <div>
        <h2 id="password-card-title" className="text-base font-semibold">
          รหัสผ่าน
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">
          ต้องมีอย่างน้อย {MIN_LENGTH} ตัวอักษร และไม่ซ้ำกับรหัสผ่านเดิม
        </p>
      </div>

      {notice === null ? null : <Alert tone="success">{notice}</Alert>}
      {formError === null ? null : <Alert tone="error">{formError}</Alert>}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
        noValidate
        className="flex flex-col gap-5"
      >
        <div className="flex max-w-md flex-col gap-4">
          <form.Field
            name="currentPassword"
            validators={{
              onChange: ({ value }) =>
                value === "" ? "กรุณากรอกรหัสผ่านปัจจุบัน" : undefined,
              onSubmit: ({ value }) =>
                value === "" ? "กรุณากรอกรหัสผ่านปัจจุบัน" : undefined,
            }}
          >
            {(field) => (
              <PasswordField
                id="change-current-password"
                label="รหัสผ่านปัจจุบัน"
                autoComplete="current-password"
                value={field.state.value}
                revealed={reveal.current}
                onToggle={() => {
                  toggle("current");
                }}
                onChange={(next) => {
                  setCurrentPasswordError(null);
                  field.handleChange(next);
                }}
                onBlur={field.handleBlur}
                errors={field.state.meta.errors}
                serverError={currentPasswordError}
              />
            )}
          </form.Field>
          <form.Field
            name="newPassword"
            validators={{
              onChangeListenTo: ["currentPassword"],
              onChange: ({ value, fieldApi }) =>
                validateNewPassword(
                  value,
                  fieldApi.form.getFieldValue("currentPassword"),
                ),
              onSubmit: ({ value, fieldApi }) =>
                validateNewPassword(
                  value,
                  fieldApi.form.getFieldValue("currentPassword"),
                ),
            }}
          >
            {(field) => (
              <PasswordField
                id="change-new-password"
                label="รหัสผ่านใหม่"
                autoComplete="new-password"
                value={field.state.value}
                revealed={reveal.next}
                onToggle={() => {
                  toggle("next");
                }}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                errors={field.state.meta.errors}
              />
            )}
          </form.Field>
          <form.Field
            name="confirmPassword"
            validators={{
              onChangeListenTo: ["newPassword"],
              onChange: ({ value, fieldApi }) =>
                validateConfirm(
                  value,
                  fieldApi.form.getFieldValue("newPassword"),
                ),
              onSubmit: ({ value, fieldApi }) =>
                validateConfirm(
                  value,
                  fieldApi.form.getFieldValue("newPassword"),
                ),
            }}
          >
            {(field) => (
              <PasswordField
                id="change-confirm-password"
                label="ยืนยันรหัสผ่านใหม่"
                autoComplete="new-password"
                value={field.state.value}
                revealed={reveal.confirm}
                onToggle={() => {
                  toggle("confirm");
                }}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                errors={field.state.meta.errors}
              />
            )}
          </form.Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/10 pt-4">
          <p className="text-xs text-foreground-secondary">
            เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นทุกเครื่องจะถูกออกจากระบบ
          </p>
          <form.Subscribe
            selector={(state) => state.isSubmitting}
            children={(submitting) => (
              <Button type="submit" variant="secondary" disabled={submitting}>
                {submitting ? "กำลังเปลี่ยน…" : "เปลี่ยนรหัสผ่าน"}
              </Button>
            )}
          />
        </div>
      </form>
    </section>
  );
}

function validateNewPassword(
  value: string,
  currentPassword: string,
): string | undefined {
  if (value.length < MIN_LENGTH) {
    return `รหัสผ่านใหม่ต้องมีอย่างน้อย ${String(MIN_LENGTH)} ตัวอักษร`;
  }
  if (currentPassword !== "" && value === currentPassword) {
    return "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน";
  }
  return undefined;
}

function validateConfirm(
  value: string,
  newPassword: string,
): string | undefined {
  return value === newPassword
    ? undefined
    : "รหัสผ่านยืนยันไม่ตรงกับรหัสผ่านใหม่";
}

function PasswordField({
  id,
  label,
  autoComplete,
  value,
  revealed,
  onToggle,
  onChange,
  onBlur,
  errors,
  serverError = null,
}: {
  id: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  revealed: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
  onBlur: () => void;
  errors: readonly unknown[];
  serverError?: string | null;
}) {
  const invalid = errors.length > 0 || serverError !== null;
  const errorId = `${id}-error`;
  return (
    <div>
      <Label htmlFor={id} className="mb-1 block">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={revealed ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          onBlur={onBlur}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          className="pr-11"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-foreground-secondary hover:text-foreground"
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
          <span className="sr-only">
            {revealed ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
          </span>
        </button>
      </div>
      {serverError === null ? (
        <FieldValidationError id={errorId} errors={errors} />
      ) : (
        <span
          id={errorId}
          role="alert"
          className="mt-1 block text-sm text-danger"
        >
          {serverError}
        </span>
      )}
    </div>
  );
}
