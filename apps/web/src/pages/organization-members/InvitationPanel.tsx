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

import { Alert, Field, Input } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { Notice } from "../../components/ui/notice";
import { ApiError } from "../../lib/api/client";
import { INVITATION_LIFETIME } from "../../lib/auth/flow";
import {
  createInvitation,
  pendingInvitationListQueryPrefix,
} from "../../lib/api/invitations";
import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import { cn } from "../../lib/utils";
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

export function InvitationPanel({
  organizationId,
  organizationName,
  actorRole,
  collapsed = false,
  onCreated,
}: {
  organizationId: string;
  organizationName: string;
  actorRole: "owner" | "admin";
  collapsed?: boolean;
  onCreated: () => void;
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
  // A success keeps the admin in the form for the next address; the live region
  // announces it. A warning or error moves focus to its message.
  useEffect(() => {
    if (notice === null || collapsed) return;
    if (notice.tone === "success") emailRef.current?.focus();
    else noticeRef.current?.focus();
  }, [notice, collapsed]);

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
      void queryClient.invalidateQueries({
        queryKey: pendingInvitationListQueryPrefix(organizationId),
      });
      onCreated();
      setEmail("");
      setNotice(
        result.emailDispatch === "accepted"
          ? { tone: "success", text: `ส่งคำเชิญถึง ${parsed.data.email} แล้ว` }
          : {
              tone: "warning",
              text: `สร้างคำเชิญถึง ${parsed.data.email} แล้ว แต่อีเมลส่งไม่สำเร็จ`,
            },
      );
    } catch (error) {
      if (!isCurrentScope()) return;
      const text =
        error instanceof ApiError
          ? error.code === "INVITATION_LIMIT_REACHED"
            ? "องค์กรมีคำเชิญที่รอตอบรับครบ 100 รายการแล้ว"
            : error.code === "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED"
              ? "องค์กรมีสมาชิกครบ 1,000 คนแล้ว"
              : error.code === "INVITATION_ALREADY_PENDING"
                ? "มีคำเชิญที่รอตอบรับสำหรับอีเมลนี้แล้ว"
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
    <section
      aria-labelledby="invite-card-title"
      className="rounded-md border border-foreground/10 bg-surface text-foreground"
    >
      <div
        hidden={collapsed}
        className="border-b border-foreground/10 px-5 py-3.5"
      >
        <h2
          id="invite-card-title"
          data-testid="members-invitation-heading"
          className="text-base font-semibold text-heading"
        >
          เชิญสมาชิกเข้าสู่ {organizationName}
        </h2>
      </div>
      <div aria-live="polite">
        {notice && (
          <div
            ref={noticeRef}
            data-testid="members-invitation-notice-focus"
            tabIndex={-1}
            className={cn(
              "mx-5 mt-5 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              collapsed && "mb-5",
            )}
          >
            {notice.tone === "success" ? (
              <Notice data-testid="members-invitation-success" tone="success">
                {notice.text}
              </Notice>
            ) : (
              <Alert
                data-testid={`members-invitation-${notice.tone}`}
                tone={notice.tone}
              >
                {notice.text}
              </Alert>
            )}
          </div>
        )}
      </div>
      <form
        hidden={collapsed}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3 p-5"
        noValidate
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Field label="อีเมลของผู้ได้รับเชิญ" className="min-w-0 flex-1">
            <Input
              data-testid="members-invitation-email"
              ref={emailRef}
              type="email"
              name="invite-email"
              className="font-mono"
              placeholder="name@company.com"
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
            <Select
              data-testid="members-invitation-role"
              name="invite-role"
              value={role}
              onChange={(event) => {
                setRole(event.target.value as InvitableRole);
              }}
            >
              {(actorRole === "owner"
                ? INVITABLE_ROLES
                : ADMIN_INVITABLE_ROLES
              ).map((value) => (
                <option
                  data-testid={`members-invitation-role-${value}`}
                  key={value}
                  value={value}
                >
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            data-testid="members-invitation-send"
            type="submit"
            disabled={pending}
          >
            {pending ? "กำลังส่งคำเชิญ…" : "ส่งคำเชิญ"}
          </Button>
        </div>
        {fieldError && (
          <span
            data-testid="members-invitation-email-error"
            id="invite-email-error"
            role="alert"
            className="text-sm text-danger"
          >
            {fieldError}
          </span>
        )}
        <p
          data-testid="members-invitation-hint"
          className="text-xs text-foreground-secondary"
        >
          {`ผู้ได้รับเชิญต้องยืนยันอีเมลก่อนเข้าถึงองค์กร คำเชิญใช้ได้ ${INVITATION_LIFETIME} และใช้ได้กับอีเมลที่ระบุเท่านั้น`}
        </p>
      </form>
    </section>
  );
}
