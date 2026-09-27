import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { useNavigate } from "react-router";

import { EmptyState } from "../components/shell/EmptyState";
import { GridIcon } from "../components/shell/icons";
import { Page, PageHeader } from "../components/shell/Page";
import { Skeleton } from "../components/shell/Skeleton";
import {
  Alert,
  Field,
  FieldValidationError,
  Input,
  textInputClass,
} from "../components/ui";
import { Button } from "../components/ui/button";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { INVITABLE_ROLES, ROLE_LABELS, type InvitableRole } from "../lib/roles";
import { useTenant } from "../lib/tenant/TenantProvider";

const CARD =
  "flex flex-col gap-6 rounded-md border border-foreground/10 bg-surface p-6";

export function WorkspacePage() {
  const { me, mePending, meError, retryMe, activeOrg } = useTenant();

  if (mePending) {
    return (
      <Page>
        <div role="status" className={CARD}>
          <span className="sr-only">กำลังโหลดข้อมูลองค์กร…</span>
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </div>
      </Page>
    );
  }

  if (me === undefined) {
    // The context request failed before any data arrived: a server error
    // or network failure is never "zero memberships". Offer an explicit
    // retry instead of spinning forever.
    return (
      <Page>
        <section className={CARD}>
          <h1 className="text-xl font-semibold">โหลดข้อมูลองค์กรไม่สำเร็จ</h1>
          <Alert tone="error">
            {meError?.message ||
              "เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง"}
          </Alert>
          <div>
            <Button
              type="button"
              onClick={() => {
                void retryMe();
              }}
            >
              ลองใหม่
            </Button>
          </div>
        </section>
      </Page>
    );
  }

  if (activeOrg === null) {
    return <AccessNeeded email={me.user.email} />;
  }

  return (
    <Page>
      <PageHeader
        eyebrow={`${activeOrg.name} · ${ROLE_LABELS[activeOrg.role] ?? activeOrg.role}`}
        title="ภาพรวม"
        // Names are not unique across organizations (only the slug is), so
        // the slug stays visible as the identifier of the active tenant.
        description={
          <>
            slug <span className="font-mono">{activeOrg.slug}</span>
          </>
        }
      />
      <EmptyState
        icon={<GridIcon size={20} />}
        title="ยังไม่มีข้อมูลการสแกน"
        description="ข้อมูลการตรวจสอบและสถานะระบบขององค์กรนี้จะปรากฏที่นี่เมื่อเปิดใช้งานโมดูลการสแกน"
      />
      {activeOrg.role === "owner" || activeOrg.role === "admin" ? (
        <InviteMemberPanel
          organizationId={activeOrg.id}
          organizationName={activeOrg.name}
        />
      ) : null}
    </Page>
  );
}

function AccessNeeded({ email }: { email: string }) {
  const navigate = useNavigate();
  return (
    <Page>
      <section className={CARD}>
        <div>
          <h1 className="text-xl font-semibold">
            ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร
          </h1>
          <p className="mt-2 text-sm text-foreground-secondary">
            บัญชี {email} ยังไม่เป็นสมาชิกขององค์กรใด
            การเข้าถึงต้องได้รับคำเชิญจากผู้ดูแลองค์กร หากคุณเพิ่งรับคำเชิญ
            กรุณาเปิดลิงก์จากอีเมลอีกครั้งหลังเข้าสู่ระบบ
          </p>
        </div>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    void navigate("/login", { replace: true });
                  },
                },
              });
            }}
          >
            ออกจากระบบ
          </Button>
        </div>
      </section>
    </Page>
  );
}

function InviteMemberPanel({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const form = useForm({
    defaultValues: {
      email: "",
      role: "viewer" as InvitableRole,
    },
    onSubmit: async ({ value }) => {
      setNotice(null);
      try {
        const { error } = await authClient.organization.inviteMember({
          email: value.email.trim(),
          role: value.role,
          organizationId,
        });
        if (error != null) {
          setNotice({
            tone: "error",
            text: authErrorMessage(error, "ส่งคำเชิญไม่สำเร็จ"),
          });
          return;
        }
        setNotice({
          tone: "success",
          text: `ส่งคำเชิญถึง ${value.email.trim()} เพื่อเข้าร่วม${organizationName} แล้ว`,
        });
        form.resetField("email");
      } catch {
        setNotice({
          tone: "error",
          text: "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง",
        });
      }
    },
  });

  return (
    <section aria-labelledby="invite-card-title" className={CARD}>
      <div>
        <h2 id="invite-card-title" className="text-base font-semibold">
          เชิญสมาชิกเข้าสู่ {organizationName}
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">
          ผู้ได้รับเชิญต้องยืนยันอีเมลก่อนเข้าถึงองค์กร
          คำเชิญมีอายุจำกัดและใช้ได้กับอีเมลที่ระบุเท่านั้น
        </p>
      </div>
      {notice === null ? null : (
        <Alert tone={notice.tone === "error" ? "error" : "success"}>
          {notice.text}
        </Alert>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-6"
        noValidate
      >
        <div className="grid max-w-2xl gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <form.Field
            name="email"
            validators={{
              onChange: ({ value }) =>
                value.trim() === "" ? "กรุณากรอกอีเมลผู้รับคำเชิญ" : undefined,
              onSubmit: ({ value }) =>
                value.trim() === "" ? "กรุณากรอกอีเมลผู้รับคำเชิญ" : undefined,
            }}
          >
            {(field) => (
              <Field label="อีเมลของผู้ได้รับเชิญ">
                <Input
                  type="email"
                  name="invite-email"
                  autoComplete="off"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby={
                    field.state.meta.errors.length > 0
                      ? "invite-email-error"
                      : undefined
                  }
                />
                <FieldValidationError
                  id="invite-email-error"
                  errors={field.state.meta.errors}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="role">
            {(field) => (
              <Field label="บทบาท">
                <select
                  name="invite-role"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value as InvitableRole);
                  }}
                  onBlur={field.handleBlur}
                  className={textInputClass}
                >
                  {INVITABLE_ROLES.map((value) => (
                    <option key={value} value={value}>
                      {ROLE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </form.Field>
        </div>
        <div className="flex justify-end border-t border-foreground/10 pt-4">
          <form.Subscribe
            selector={(state) => state.isSubmitting}
            children={(isSubmitting) => (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "กำลังส่งคำเชิญ…" : "ส่งคำเชิญ"}
              </Button>
            )}
          />
        </div>
      </form>
    </section>
  );
}
