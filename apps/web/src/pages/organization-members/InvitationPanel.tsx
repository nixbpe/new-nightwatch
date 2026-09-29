import { invitationCreateInputSchema } from "@nightwatch/api-contract";
import type { MeContextResponse } from "@nightwatch/api-contract";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Alert, Field, Input, textInputClass } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { ApiError } from "../../lib/api/client";
import { createInvitation } from "../../lib/api/invitations";
import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import {
  getContextPublicationSnapshot,
  subscribeToContextPublication,
} from "../../lib/queryClient";
import {
  ADMIN_INVITABLE_ROLES,
  INVITABLE_ROLES,
  ROLE_LABELS,
  type InvitableRole,
} from "../../lib/roles";
import { Card, CardHeader } from "../../components/ui/card";

export function InvitationPanel({
  organizationId,
  organizationName,
  actorRole,
}: {
  organizationId: string;
  organizationName: string;
  actorRole: "owner" | "admin";
}) {
  const queryClient = useQueryClient();
  const initialPublicationVersion = useRef(
    getContextPublicationSnapshot(queryClient).version,
  );
  const lastPublishedServerOrgId = useRef(
    queryClient.getQueryData<MeContextResponse>(ME_CONTEXT_QUERY_KEY)
      ?.lastActiveTenantId ?? null,
  );
  const retired = useRef(false);
  // Retire only when a confirmed publication switches away from this panel's
  // organization. A bookmarked B form may start while A is the active tenant.
  const isCurrentScope = useCallback(() => {
    const version = getContextPublicationSnapshot(queryClient).version;
    if (version !== initialPublicationVersion.current) {
      const serverOrgId =
        queryClient.getQueryData<MeContextResponse>(ME_CONTEXT_QUERY_KEY)
          ?.lastActiveTenantId ?? null;
      if (
        lastPublishedServerOrgId.current !== serverOrgId &&
        serverOrgId !== organizationId
      ) {
        retired.current = true;
      }
      lastPublishedServerOrgId.current = serverOrgId;
      initialPublicationVersion.current = version;
    }
    return !retired.current;
  }, [organizationId, queryClient]);
  const currentScope = useSyncExternalStore(
    useCallback(
      (listener) =>
        subscribeToContextPublication(queryClient, () => {
          isCurrentScope();
          listener();
        }),
      [queryClient, isCurrentScope],
    ),
    isCurrentScope,
  );
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("viewer");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    tone: "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice !== null) noticeRef.current?.focus();
  }, [notice]);

  async function submit() {
    if (inFlight.current) return;
    setNotice(null);
    const parsed = invitationCreateInputSchema.safeParse({ email, role });
    if (!parsed.success) {
      setFieldError(
        email.trim() === ""
          ? "กรุณากรอกอีเมลผู้รับคำเชิญ"
          : "กรุณากรอกอีเมลที่ถูกต้อง",
      );
      emailRef.current?.focus();
      return;
    }
    setFieldError(null);
    inFlight.current = true;
    setPending(true);
    try {
      const result = await createInvitation(organizationId, parsed.data);
      if (!isCurrentScope()) return;
      setEmail("");
      setNotice(
        result.emailDispatch === "accepted"
          ? { tone: "success", text: "สร้างคำเชิญแล้ว" }
          : { tone: "warning", text: "สร้างคำเชิญแล้ว แต่อีเมลส่งไม่สำเร็จ" },
      );
    } catch (error) {
      if (!isCurrentScope()) return;
      const text =
        error instanceof ApiError
          ? error.code === "INVITATION_LIMIT_REACHED"
            ? "องค์กรมีคำเชิญที่รอดำเนินการครบ 100 รายการแล้ว"
            : error.code === "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED"
              ? "องค์กรมีสมาชิกครบ 1,000 คนแล้ว"
              : error.code === "INVITATION_ALREADY_PENDING"
                ? "มีคำเชิญที่รอดำเนินการสำหรับอีเมลนี้แล้ว"
                : error.status === 403
                  ? "คุณไม่มีสิทธิ์เชิญสมาชิกในองค์กรนี้"
                  : "สร้างคำเชิญไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
          : "สร้างคำเชิญไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
      setNotice({ tone: "error", text });
    } finally {
      if (isCurrentScope()) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }

  if (!currentScope) return null;
  return (
    <Card as="section" aria-labelledby="invite-card-title" padding="md">
      <CardHeader
        id="invite-card-title"
        title={<>เชิญสมาชิกเข้าสู่ {organizationName}</>}
      />
      {notice && (
        <div
          ref={noticeRef}
          tabIndex={-1}
          className="focus:outline-2 focus:outline-offset-2 focus:outline-primary"
        >
          {notice.tone === "error" ? (
            <Alert tone="error">{notice.text}</Alert>
          ) : (
            <Alert
              tone={notice.tone === "warning" ? "warning" : "success"}
              role="status"
            >
              {notice.text}
            </Alert>
          )}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
        noValidate
      >
        {/* Bottom-aligned so the button meets the fields whatever the label height; the error sits under the row. */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Field label="อีเมลของผู้ได้รับเชิญ" className="min-w-0 flex-1">
            <Input
              ref={emailRef}
              type="email"
              name="invite-email"
              autoComplete="off"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setFieldError(null);
              }}
              aria-invalid={fieldError !== null}
              aria-describedby={fieldError ? "invite-email-error" : undefined}
            />
          </Field>
          <Field label="บทบาท" className="sm:w-[200px]">
            <select
              name="invite-role"
              value={role}
              onChange={(event) => {
                setRole(event.target.value as InvitableRole);
              }}
              className={textInputClass}
            >
              {(actorRole === "owner"
                ? INVITABLE_ROLES
                : ADMIN_INVITABLE_ROLES
              ).map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "กำลังส่งคำเชิญ…" : "ส่งคำเชิญ"}
          </Button>
        </div>
        {fieldError && (
          <span
            id="invite-email-error"
            role="alert"
            className="text-sm text-danger"
          >
            {fieldError}
          </span>
        )}
        <p className="text-xs text-foreground-secondary">
          ผู้ได้รับเชิญต้องยืนยันอีเมลก่อนเข้าถึงองค์กร
          คำเชิญมีอายุจำกัดและใช้ได้กับอีเมลที่ระบุเท่านั้น
        </p>
      </form>
    </Card>
  );
}
