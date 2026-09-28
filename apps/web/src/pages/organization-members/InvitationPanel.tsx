import { invitationCreateInputSchema } from "@nightwatch/api-contract";
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

const CARD =
  "flex flex-col gap-6 rounded-md border border-foreground/10 bg-surface p-6";

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
  const publicationVersion = useSyncExternalStore(
    useCallback(
      (listener) => subscribeToContextPublication(queryClient, listener),
      [queryClient],
    ),
    useCallback(
      () => getContextPublicationSnapshot(queryClient).version,
      [queryClient],
    ),
  );
  const initialPublicationVersion = useRef(publicationVersion);
  const isCurrentScope = () =>
    getContextPublicationSnapshot(queryClient).version ===
    initialPublicationVersion.current;
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

  if (publicationVersion !== initialPublicationVersion.current) return null;
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
      {notice && (
        <div
          ref={noticeRef}
          tabIndex={-1}
          className="focus:outline-2 focus:outline-offset-2 focus:outline-primary"
        >
          {notice.tone === "error" ? (
            <Alert tone="error">{notice.text}</Alert>
          ) : (
            <p
              role="status"
              className={`rounded-md border px-3 py-2 text-sm ${notice.tone === "warning" ? "border-caution/40 text-caution" : "border-primary/40 text-primary"}`}
            >
              {notice.text}
            </p>
          )}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-6"
        noValidate
      >
        <div className="grid max-w-2xl gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <div>
            <Field label="อีเมลของผู้ได้รับเชิญ">
              <Input
                ref={emailRef}
                type="email"
                name="invite-email"
                autoComplete="off"
                value={email}
                style={{ outlineColor: "var(--primary)" }}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setFieldError(null);
                }}
                aria-invalid={fieldError !== null}
                aria-describedby={fieldError ? "invite-email-error" : undefined}
              />
            </Field>
            {fieldError && (
              <span
                id="invite-email-error"
                role="alert"
                className="mt-1 block text-sm text-danger"
              >
                {fieldError}
              </span>
            )}
          </div>
          <Field label="บทบาท">
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
        </div>
        <div className="flex justify-end border-t border-foreground/10 pt-4">
          <Button
            type="submit"
            style={{ outlineColor: "var(--primary)" }}
            disabled={pending}
          >
            {pending ? "กำลังส่งคำเชิญ…" : "ส่งคำเชิญ"}
          </Button>
        </div>
      </form>
    </section>
  );
}
