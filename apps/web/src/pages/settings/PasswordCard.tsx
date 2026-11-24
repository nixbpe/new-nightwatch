import { useForm, useSelector } from "@tanstack/react-form";
import { useState } from "react";

import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { PasswordField } from "../../components/ui/password-field";
import { authClient, authErrorMessage } from "../../lib/auth-client";
import { CardFooter, CardSection } from "../../components/ui/card";
import { SectionHeader } from "../../components/ui/section-header";

const MIN_LENGTH = 8;

export function PasswordCard() {
  const [notice, setNotice] = useState<string | null>(null);
  const [currentPasswordError, setCurrentPasswordError] = useState<
    string | null
  >(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Remounts the fields after a success so a revealed field is hidden again.
  const [fieldsKey, setFieldsKey] = useState(0);

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
          // Only a wrong current password belongs on that field; a too short or too long new
          // password is also a 400 and is shown at the top of the form.
          if (error.code === "INVALID_PASSWORD") {
            setCurrentPasswordError(message);
          } else {
            setFormError(message);
          }
          return;
        }
        form.reset();
        setFieldsKey((key) => key + 1);
        setNotice("เปลี่ยนรหัสผ่านแล้ว เซสชันอื่นทั้งหมดถูกออกจากระบบ");
      } catch {
        setFormError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  // A field's errors wait for its first blur or a submit attempt; a change sets `isTouched`, so it is no gate.
  const submitAttempts = useSelector(form.store, (s) => s.submissionAttempts);
  const visibleErrors = (meta: {
    isBlurred: boolean;
    errors: readonly unknown[];
  }) => (meta.isBlurred || submitAttempts > 0 ? meta.errors : []);

  return (
    <CardSection
      data-testid="password-change-section"
      aria-labelledby="password-card-title"
    >
      <div className="flex flex-col gap-2">
        <SectionHeader id="password-card-title" code="02" title="รหัสผ่าน" />
        <p className="text-sm text-foreground-secondary">
          ต้องมีอย่างน้อย {MIN_LENGTH} ตัวอักษร และไม่ซ้ำกับรหัสผ่านเดิม
        </p>
      </div>

      {notice === null ? null : (
        <Notice data-testid="password-change-success" tone="success">
          {notice}
        </Notice>
      )}
      {formError === null ? null : (
        <Alert data-testid="password-change-error" tone="error">
          {formError}
        </Alert>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
        noValidate
        className="flex flex-col gap-6"
      >
        <div key={fieldsKey} className="flex max-w-md flex-col gap-4">
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
                onChange={(next) => {
                  setCurrentPasswordError(null);
                  field.handleChange(next);
                }}
                onBlur={field.handleBlur}
                errors={visibleErrors(field.state.meta)}
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
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                errors={visibleErrors(field.state.meta)}
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
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                errors={visibleErrors(field.state.meta)}
              />
            )}
          </form.Field>
        </div>
        <CardFooter variant="split">
          <p className="text-xs text-foreground-secondary">
            เปลี่ยนรหัสผ่านแล้ว เซสชันอื่นทั้งหมดจะถูกออกจากระบบ
          </p>
          <form.Subscribe
            selector={(state) => state.isSubmitting}
            children={(submitting) => (
              <Button
                data-testid="password-change-submit"
                type="submit"
                disabled={submitting}
              >
                {submitting ? "กำลังเปลี่ยน…" : "เปลี่ยนรหัสผ่าน"}
              </Button>
            )}
          />
        </CardFooter>
      </form>
    </CardSection>
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
