import type { MeContextResponse } from "@nightwatch/api-contract";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router";

import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Card, CardHeader } from "../../components/ui/card";
import { ApiError } from "../../lib/api/client";
import { leaveOrganization } from "../../lib/api/members";
import { MemberActionDialog } from "./MemberActionDialog";
import { useOrganizationScope } from "./useOrganizationScope";

const LEAVE_ATTRIBUTE = "data-self-leave";

/** Navigation state that asks the destination page to focus its heading. */
const SELF_LEFT_STATE = { selfLeft: true } as const;

/**
 * After a confirmed leave the old page and its dialog are gone, so the
 * destination heading takes focus once it exists (Organization page or
 * no-access). Runs once per arrival.
 */
export function useFocusHeadingAfterSelfLeave(
  headingRef: RefObject<HTMLElement | null>,
) {
  const state = useLocation().state as { selfLeft?: boolean } | null;
  const pending = useRef(state?.selfLeft === true);
  useEffect(() => {
    if (!pending.current) return;
    const heading = headingRef.current;
    if (heading === null) return;
    pending.current = false;
    heading.focus();
  });
}

// `refreshing` and `refresh-failed` replace the page body, so the hook lives
// in the page and survives the context refresh that hides the Organization.
type Phase = "idle" | "leaving" | "refreshing" | "refresh-failed";

/**
 * Self-leave flow for one Organization's member page. It works for every role
 * because it needs neither the member list nor a member row. Success is
 * decided by the server-confirmed context (no membership in this Organization
 * any more), never by the DELETE response alone; every completion is guarded
 * by `useOrganizationScope`, so a late A response cannot touch B or no-access.
 * Cancel and Escape send no request, and a failed DELETE is never replayed.
 */
export function useSelfLeave({
  organizationId,
  blocked,
  headingRef,
  refreshMembershipContext,
}: {
  organizationId: string;
  /** Focus lands here when the dialog's opener unmounts with the page body. */
  headingRef: RefObject<HTMLElement | null>;
  /** Another member mutation is in flight. */
  blocked: boolean;
  refreshMembershipContext: () => Promise<MeContextResponse | null>;
}) {
  const navigate = useNavigate();
  const { isCurrentScope, scopeCurrent } = useOrganizationScope(organizationId);
  const [phase, setPhase] = useState<Phase>("idle");
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    opener: HTMLElement;
  } | null>(null);
  const restoreFocus = useRef(false);
  // Kept so a retry after a failed refresh still explains the original failure.
  const lastFailure = useRef<unknown>(null);

  useEffect(() => {
    if (!restoreFocus.current || phase !== "idle") return;
    restoreFocus.current = false;
    const active = document.activeElement;
    if (active !== document.body && active !== headingRef.current) return;
    document.querySelector<HTMLElement>(`[${LEAVE_ATTRIBUTE}]`)?.focus();
  });

  async function settle(failure: unknown) {
    lastFailure.current = failure;
    setPhase("refreshing");
    const context = await refreshMembershipContext();
    if (!isCurrentScope()) return;
    if (context === null) {
      setPhase("refresh-failed");
      return;
    }
    if (!context.organizations.some((item) => item.id === organizationId)) {
      // Server-confirmed: the actor no longer belongs to this Organization.
      const next =
        context.organizations.find(
          (item) => item.id === context.lastActiveTenantId,
        ) ?? context.organizations[0];
      await navigate(
        next === undefined ? "/workspace" : `/organizations/${next.id}/members`,
        { replace: true, state: SELF_LEFT_STATE },
      );
      return;
    }
    setNotice(
      failure instanceof ApiError && failure.code === "LAST_OWNER"
        ? "องค์กรต้องมีเจ้าของอย่างน้อยหนึ่งคน คุณยังไม่ได้ออกจากองค์กร และโหลดสถานะล่าสุดแล้ว"
        : "ออกจากองค์กรไม่สำเร็จ โหลดสถานะล่าสุดแล้ว",
    );
    restoreFocus.current = true;
    inFlight.current = false;
    setPhase("idle");
  }

  async function submit() {
    if (inFlight.current || blocked || !isCurrentScope()) return;
    inFlight.current = true;
    setPhase("leaving");
    setNotice(null);
    let failure: unknown = null;
    try {
      const response = await leaveOrganization(organizationId);
      if (response.member.organizationId !== organizationId) {
        throw new Error("Leave response does not match the requested scope");
      }
    } catch (error) {
      failure = error;
    }
    if (!isCurrentScope()) return;
    setConfirmation(null);
    // The outcome of a failed DELETE is unknown (it may have committed), so the
    // server-confirmed context decides in both cases.
    await settle(failure);
  }

  const live = scopeCurrent;
  return {
    phase: live ? phase : "idle",
    pending: live && phase !== "idle",
    notice: live ? notice : null,
    confirmation: live ? confirmation : null,
    request: (opener: HTMLElement) => {
      if (inFlight.current || blocked || !isCurrentScope()) return;
      setNotice(null);
      setConfirmation({ opener });
    },
    confirm: () => {
      if (confirmation !== null) void submit();
    },
    cancel: () => {
      if (inFlight.current) return;
      setConfirmation(null);
    },
    retryRefresh: () => {
      if (phase === "refresh-failed") void settle(lastFailure.current);
    },
  };
}

export type SelfLeave = ReturnType<typeof useSelfLeave>;

/** Entry card, result notices and confirmation dialog; shown to every role. */
export function SelfLeaveSection({
  selfLeave,
  organization,
  actor,
  disabled,
  headingRef,
}: {
  selfLeave: SelfLeave;
  organization: { name: string; slug: string; role: string };
  actor: { name: string; email: string } | undefined;
  disabled: boolean;
  headingRef: RefObject<HTMLElement | null>;
}) {
  const headingId = useId();
  return (
    <>
      <Card as="section" padding="md" aria-labelledby={headingId}>
        <CardHeader
          id={headingId}
          title="ออกจากองค์กร"
          description={`คุณจะไม่สามารถเข้าถึง ${organization.name} ได้อีก บัญชีและสมาชิกภาพในองค์กรอื่นของคุณยังอยู่`}
          action={
            <Button
              {...{ [LEAVE_ATTRIBUTE]: "" }}
              type="button"
              variant="secondary"
              wrap
              disabled={disabled || selfLeave.pending}
              onClick={(event) => {
                selfLeave.request(event.currentTarget);
              }}
            >
              ออกจากองค์กร
            </Button>
          }
        />
        {selfLeave.notice !== null ? (
          <Alert tone="error">{selfLeave.notice}</Alert>
        ) : null}
      </Card>
      {selfLeave.confirmation !== null ? (
        <MemberActionDialog
          title="ยืนยันการออกจากองค์กร"
          description={
            <>
              <p>
                {actor === undefined ? "คุณ" : `${actor.name} (${actor.email})`}{" "}
                กำลังออกจากองค์กร {organization.name} ({organization.slug})
              </p>
              <p className="mt-2">
                คุณจะเข้าถึงองค์กรนี้ไม่ได้ทันที
                แต่บัญชีและสมาชิกภาพในองค์กรอื่นยังอยู่
                {organization.role === "owner"
                  ? " เจ้าของคนสุดท้ายออกไม่ได้ ต้องมีเจ้าของอีกคนก่อน"
                  : ""}
              </p>
            </>
          }
          confirmLabel="ยืนยันการออกจากองค์กร"
          confirmVariant="destructive"
          pendingLabel="กำลังออกจากองค์กร…"
          pending={selfLeave.pending}
          opener={selfLeave.confirmation.opener}
          fallbackFocus={headingRef}
          onCancel={selfLeave.cancel}
          onConfirm={selfLeave.confirm}
        />
      ) : null}
    </>
  );
}
