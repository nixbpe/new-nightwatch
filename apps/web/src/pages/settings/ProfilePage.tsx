import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { initialsOf } from "../../components/shell/initials";
import { Skeleton } from "../../components/shell/Skeleton";
import { Alert, Input } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import { authClient, authErrorMessage } from "../../lib/auth-client";

const NAME_MAX = 100;

function validateName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "กรุณากรอกชื่อที่แสดง";
  }
  if (trimmed.length > NAME_MAX) {
    return `ชื่อที่แสดงต้องไม่เกิน ${String(NAME_MAX)} ตัวอักษร`;
  }
  return null;
}

/**
 * Profile tab: the display name (the one thing a user can change about how
 * they appear) and the account's email, read-only with its verification
 * badge. The avatar is derived from the name — no upload, by decision.
 */
export function ProfilePage() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: ME_CONTEXT_QUERY_KEY,
    queryFn: fetchMeContext,
  });

  if (meQuery.isPending) {
    return (
      <section
        role="status"
        aria-label="กำลังโหลดโปรไฟล์"
        className="flex flex-col gap-4 rounded-md border border-foreground/10 bg-surface p-6"
      >
        <Skeleton className="h-4 w-40" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-10 w-full max-w-md" />
      </section>
    );
  }

  if (meQuery.isError) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="error">
          โหลดข้อมูลโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
        </Alert>
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={meQuery.isRefetching}
            onClick={() => {
              void meQuery.refetch();
            }}
          >
            {meQuery.isRefetching ? "กำลังโหลด…" : "ลองใหม่"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ProfileForm
      storedName={meQuery.data.user.name}
      email={meQuery.data.user.email}
      emailVerified={meQuery.data.user.emailVerified}
      onSaved={async () => {
        await queryClient.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
      }}
    />
  );
}

function ProfileForm({
  storedName,
  email,
  emailVerified,
  onSaved,
}: {
  storedName: string;
  email: string;
  emailVerified: boolean;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(storedName);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const nameId = useId();
  const emailId = useId();

  const validation = validateName(name);
  const dirty = name.trim() !== storedName;
  const showError = touched && validation !== null;

  const save = async () => {
    setTouched(true);
    if (validation !== null) {
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const { error } = await authClient.updateUser({ name: name.trim() });
      if (error != null) {
        setNotice({
          tone: "error",
          text: authErrorMessage(error, "บันทึกโปรไฟล์ไม่สำเร็จ"),
        });
        return;
      }
      setName(name.trim());
      setTouched(false);
      await onSaved();
      setNotice({ tone: "success", text: "บันทึกแล้ว" });
    } catch {
      setNotice({
        tone: "error",
        text: "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="profile-card-title"
      className="flex flex-col gap-5 rounded-md border border-foreground/10 bg-surface p-6"
    >
      <div>
        <h2 id="profile-card-title" className="text-base font-semibold">
          ข้อมูลโปรไฟล์
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">
          ชื่อที่แสดงให้สมาชิกองค์กรอื่นเห็นในกิจกรรมและคำเชิญ
        </p>
      </div>

      {notice === null ? null : <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="inline-flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-surface text-xl font-medium"
        >
          {initialsOf(name.trim() === "" ? storedName : name)}
        </span>
        <p className="text-xs text-foreground-secondary">
          ระบบใช้อักษรย่อจากชื่อที่แสดง
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        noValidate
        className="flex flex-col gap-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={nameId} className="mb-1 block">
              ชื่อที่แสดง
            </Label>
            <Input
              id={nameId}
              name="display-name"
              autoComplete="name"
              maxLength={NAME_MAX + 20}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNotice(null);
              }}
              onBlur={() => {
                setTouched(true);
              }}
              aria-invalid={showError}
              aria-describedby={showError ? `${nameId}-error` : undefined}
            />
            {showError ? (
              <span
                id={`${nameId}-error`}
                role="alert"
                className="mt-1 block text-sm text-danger"
              >
                {validation}
              </span>
            ) : null}
          </div>
          <div>
            <Label htmlFor={emailId} className="mb-1 flex items-center gap-2">
              อีเมล
              {emailVerified ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 px-2 py-0.5 text-xs font-medium text-primary">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-current"
                  />
                  ยืนยันแล้ว
                </span>
              ) : null}
            </Label>
            <Input
              id={emailId}
              type="email"
              value={email}
              readOnly
              aria-describedby={`${emailId}-help`}
              className="text-foreground-secondary"
            />
            <p
              id={`${emailId}-help`}
              className="mt-1 text-xs text-foreground-secondary"
            >
              ใช้เข้าสู่ระบบและรับการแจ้งเตือน · เปลี่ยนอีเมลยังไม่เปิดให้บริการ
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-foreground/10 pt-4">
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty || saving}
            onClick={() => {
              setName(storedName);
              setTouched(false);
              setNotice(null);
            }}
          >
            ยกเลิก
          </Button>
          <Button type="submit" disabled={!dirty || saving}>
            {saving ? "กำลังบันทึก…" : "บันทึกการเปลี่ยนแปลง"}
          </Button>
        </div>
      </form>
    </section>
  );
}
