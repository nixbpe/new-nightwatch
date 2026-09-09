import { useState, type SubmitEvent } from "react";
import { Link, useNavigate } from "react-router";

import {
  Alert,
  Field,
  FullPageLoading,
  SubmitButton,
  textInputClass,
} from "../components/ui";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { INVITABLE_ROLES, ROLE_LABELS, type InvitableRole } from "../lib/roles";
import { useTenant } from "../lib/tenant/TenantProvider";

export function WorkspacePage() {
  const navigate = useNavigate();
  const {
    me,
    mePending,
    meError,
    retryMe,
    activeOrg,
    switchOrg,
    orgSwitchPending,
  } = useTenant();

  if (mePending) {
    return <FullPageLoading label="กำลังโหลดข้อมูลองค์กร…" />;
  }

  if (me === undefined) {
    // The context request failed before any data arrived: a server error
    // or network failure is never "zero memberships". Offer an explicit
    // retry instead of spinning forever.
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-sm">
          <h1 className="text-xl font-semibold">โหลดข้อมูลองค์กรไม่สำเร็จ</h1>
          <div className="mt-3">
            <Alert tone="error">
              {meError?.message ||
                "เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง"}
            </Alert>
          </div>
          <button
            type="button"
            className="mt-4 w-full rounded-md bg-primary px-4 py-2.5 font-medium text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => {
              void retryMe();
            }}
          >
            ลองใหม่
          </button>
        </div>
      </main>
    );
  }

  const memberships = me.organizations;

  return (
    <div className="min-h-screen">
      <header className="border-b border-control-border/40 bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="text-lg font-semibold">NightWatch</span>
          {memberships.length > 1 ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-foreground-secondary">องค์กร</span>
              <select
                name="active-organization"
                value={activeOrg?.id ?? ""}
                disabled={orgSwitchPending}
                onChange={(event) => {
                  void switchOrg(event.target.value);
                }}
                className="rounded-md border border-control-border bg-surface px-2 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {memberships.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="ms-auto flex items-center gap-4 text-sm">
            <span className="text-foreground-secondary">{me.user.email}</span>
            <Link to="/settings/security" className="text-primary underline">
              ความปลอดภัย
            </Link>
            <button
              type="button"
              className="text-foreground-secondary underline"
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
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {activeOrg === null ? (
          <AccessNeeded email={me.user.email} />
        ) : (
          <div className="flex flex-col gap-6">
            <section className="rounded-lg bg-surface p-6 shadow-sm">
              <h1 className="text-xl font-semibold">{activeOrg.name}</h1>
              <p className="mt-1 text-sm text-foreground-secondary">
                slug: {activeOrg.slug} — บทบาทของคุณ:{" "}
                {ROLE_LABELS[activeOrg.role] ?? activeOrg.role}
              </p>
              <p className="mt-4 text-sm text-foreground-secondary">
                ยังไม่มีข้อมูลการสแกนหรือสถานะระบบสำหรับองค์กรนี้
                ข้อมูลการตรวจสอบจะปรากฏที่นี่เมื่อเปิดใช้งานโมดูลการสแกน
              </p>
            </section>
            {activeOrg.role === "owner" || activeOrg.role === "admin" ? (
              <InviteMemberPanel
                organizationId={activeOrg.id}
                organizationName={activeOrg.name}
              />
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}

function AccessNeeded({ email }: { email: string }) {
  const navigate = useNavigate();
  return (
    <section className="rounded-lg bg-surface p-6 shadow-sm">
      <h1 className="text-xl font-semibold">ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร</h1>
      <p className="mt-2 text-sm text-foreground-secondary">
        บัญชี {email} ยังไม่เป็นสมาชิกขององค์กรใด
        การเข้าถึงต้องได้รับคำเชิญจากผู้ดูแลองค์กร หากคุณเพิ่งรับคำเชิญ
        กรุณาเปิดลิงก์จากอีเมลอีกครั้งหลังเข้าสู่ระบบ
      </p>
      <div className="mt-4">
        <button
          type="button"
          className="rounded-md border border-control-border px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
        </button>
      </div>
    </section>
  );
}

function InviteMemberPanel({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("viewer");
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setNotice(null);
    setPending(true);
    try {
      const { error } = await authClient.organization.inviteMember({
        email: email.trim(),
        role,
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
        text: `ส่งคำเชิญถึง ${email.trim()} เพื่อเข้าร่วม${organizationName} แล้ว`,
      });
      setEmail("");
    } catch {
      setNotice({
        tone: "error",
        text: "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-lg bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-semibold">
        เชิญสมาชิกเข้าสู่ {organizationName}
      </h2>
      <form
        onSubmit={(event) => void onSubmit(event)}
        className="mt-4 flex flex-col gap-4"
        noValidate
      >
        {notice === null ? null : (
          <Alert tone={notice.tone === "error" ? "error" : "success"}>
            {notice.text}
          </Alert>
        )}
        <Field label="อีเมลของผู้ได้รับเชิญ">
          <input
            type="email"
            name="invite-email"
            autoComplete="off"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            className={textInputClass}
          />
        </Field>
        <Field label="บทบาท">
          <select
            name="invite-role"
            value={role}
            onChange={(event) => {
              setRole(event.target.value as InvitableRole);
            }}
            className={textInputClass}
          >
            {INVITABLE_ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <SubmitButton pending={pending} pendingLabel="กำลังส่งคำเชิญ…">
            ส่งคำเชิญ
          </SubmitButton>
        </div>
        <p className="text-sm text-foreground-secondary">
          ผู้ได้รับเชิญต้องยืนยันอีเมลก่อนเข้าถึงองค์กร
          คำเชิญมีอายุจำกัดและใช้ได้กับอีเมลที่ระบุเท่านั้น
        </p>
      </form>
    </section>
  );
}
