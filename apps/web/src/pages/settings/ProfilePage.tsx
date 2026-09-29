import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { initialsOf } from "../../components/shell/initials";
import { Skeleton } from "../../components/shell/Skeleton";
import { Alert, Field, Input } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import { authClient, authErrorMessage } from "../../lib/auth-client";
import { Card, CardHeader, CardFooter } from "../../components/ui/card";
import { StatusPill } from "../../components/ui/status-pill";

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

// The avatar is derived from the name; no upload, by decision.
export function ProfilePage() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: ME_CONTEXT_QUERY_KEY,
    queryFn: fetchMeContext,
  });

  if (meQuery.isPending) {
    return (
      <Card
        as="section"
        role="status"
        aria-label="กำลังโหลดโปรไฟล์"
        padding="md"
      >
        <Skeleton className="h-4 w-40" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-10 w-full max-w-md" />
      </Card>
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
    <Card as="section" aria-labelledby="profile-card-title" padding="md">
      <CardHeader
        id="profile-card-title"
        title="ข้อมูลโปรไฟล์"
        description="ชื่อที่แสดงให้สมาชิกองค์กรอื่นเห็นในกิจกรรมและคำเชิญ"
      />

      {notice === null ? null : <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="surface-inset inline-flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full border border-foreground/10 text-xl font-medium"
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
        className="flex flex-col gap-6"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={
              <span className="inline-flex min-h-6 items-center">
                ชื่อที่แสดง
              </span>
            }
            error={showError ? validation : null}
            errorId={`${nameId}-error`}
          >
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
          </Field>
          <div>
            <Field
              label={
                <span className="inline-flex min-h-6 items-center gap-2">
                  อีเมล
                  {emailVerified ? (
                    <StatusPill tone="primary" dot>
                      ยืนยันแล้ว
                    </StatusPill>
                  ) : null}
                </span>
              }
            >
              <Input
                id={emailId}
                type="email"
                value={email}
                readOnly
                aria-describedby={`${emailId}-help`}
                className="text-foreground-secondary"
              />
            </Field>
            <p
              id={`${emailId}-help`}
              className="mt-1 text-xs text-foreground-secondary"
            >
              ใช้เข้าสู่ระบบและรับการแจ้งเตือน เปลี่ยนอีเมลยังไม่เปิดให้บริการ
            </p>
          </div>
        </div>
        <CardFooter>
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
        </CardFooter>
      </form>
    </Card>
  );
}
