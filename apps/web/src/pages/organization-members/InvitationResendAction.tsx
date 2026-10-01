import type {
  PendingInvitation,
  PendingInvitationListResponse,
} from "@nightwatch/api-contract";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import { ApiError } from "../../lib/api/client";
import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import {
  pendingInvitationListQueryPrefix,
  resendInvitation,
} from "../../lib/api/invitations";
import { formatDateTime, usePreferences } from "../../lib/preferences";
import type {
  InvitationFocusTarget,
  InvitationNotice,
} from "./InvitationCancelAction";
import { useOrganizationScope } from "./useOrganizationScope";

export type InvitationResendConfirmation = {
  invitation: PendingInvitation;
  opener: HTMLElement;
};

type ListRefresh = Promise<{
  data?: PendingInvitationListResponse;
  isError: boolean;
}>;

/**
 * Resend flow for one Organization's pending list, shaped like
 * `useInvitationCancel`. A confirmed resend moves the row to the top of the
 * first page, so success reloads page 1 (`loadFirstPage`) and puts focus on the
 * same row's "ส่งซ้ำ" button. A failed resend refetches the open page. Success
 * is shown only after that reload succeeded; "กลับ" and Escape send nothing.
 */
export function useInvitationResend({
  organizationId,
  refetchList,
  loadFirstPage,
  refreshMembershipContext,
  requestFocus,
}: {
  organizationId: string;
  refetchList: () => ListRefresh;
  loadFirstPage: () => ListRefresh;
  refreshMembershipContext: () => Promise<unknown>;
  requestFocus: (target: InvitationFocusTarget) => void;
}) {
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const { isCurrentScope, scopeCurrent } = useOrganizationScope(organizationId);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<InvitationNotice | null>(null);
  const [confirmation, setConfirmation] =
    useState<InvitationResendConfirmation | null>(null);

  function failureText(failure: unknown): string {
    if (failure instanceof ApiError) {
      switch (failure.code) {
        case "INVITATION_LIMIT_REACHED":
          return "องค์กรมีคำเชิญที่รอดำเนินการครบ 100 รายการแล้ว";
        case "INVITATION_RESEND_COOLDOWN": {
          const details = failure.details as
            { resendAvailableAt?: unknown } | undefined;
          const availableAt =
            typeof details?.resendAvailableAt === "string"
              ? new Date(details.resendAvailableAt)
              : null;
          if (availableAt !== null && !Number.isNaN(availableAt.getTime())) {
            return `ส่งซ้ำได้อีกครั้งเมื่อ ${formatDateTime(availableAt, preferences)}`;
          }
          break;
        }
        case "INVITATION_NOT_FOUND":
          return "ไม่พบคำเชิญนี้แล้ว";
        case "USER_ALREADY_MEMBER":
          return "ผู้รับเป็นสมาชิกแล้ว";
        case "INVITATION_ALREADY_PENDING":
          return "มีคำเชิญที่ยังใช้ได้สำหรับอีเมลนี้แล้ว";
      }
    }
    return "ส่งคำเชิญซ้ำไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
  }

  async function submit(invitation: PendingInvitation) {
    if (inFlight.current || !isCurrentScope()) return;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    let failure: unknown = null;
    let result: Awaited<ReturnType<typeof resendInvitation>> | null = null;
    try {
      result = await resendInvitation(organizationId, invitation.publicId);
    } catch (error) {
      failure = error;
    }
    if (!isCurrentScope()) return;
    const deniedCode =
      failure instanceof ApiError &&
      (failure.code === "PERMISSION_DENIED" ||
        failure.code === "MEMBERSHIP_DENIED");
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: pendingInvitationListQueryPrefix(organizationId),
        refetchType: "none",
      }),
      deniedCode
        ? queryClient.invalidateQueries({
            queryKey: ME_CONTEXT_QUERY_KEY,
            refetchType: "none",
          })
        : Promise.resolve(),
    ]);
    if (!isCurrentScope()) return;
    setConfirmation(null);
    // Only a server-confirmed resend moves the row to the top of page 1.
    const refreshed = await (result === null ? refetchList() : loadFirstPage());
    if (!isCurrentScope()) return;
    if (failure !== null) {
      setNotice({ tone: "error", text: failureText(failure) });
    } else if (!refreshed.isError && result !== null) {
      setNotice(
        result.emailDispatch === "accepted"
          ? { tone: "success", text: "ส่งคำเชิญซ้ำแล้ว" }
          : { tone: "warning", text: "ส่งคำเชิญซ้ำแล้ว แต่อีเมลส่งไม่สำเร็จ" },
      );
    } else {
      // The section shows its own list error with a retry.
      setNotice(null);
    }
    // A failed refetch leaves no row to focus, so name the heading outright.
    requestFocus(refreshed.isError ? "heading" : invitation.publicId);
    if (deniedCode) {
      await refreshMembershipContext();
      if (!isCurrentScope()) return;
    }
    inFlight.current = false;
    setPending(false);
  }

  const livePending = scopeCurrent && pending;
  return {
    pending: livePending,
    pendingText: livePending ? "กำลังส่ง…" : null,
    notice,
    confirmation,
    request: (invitation: PendingInvitation, opener: HTMLElement) => {
      if (inFlight.current || !isCurrentScope()) return;
      setConfirmation({ invitation, opener });
    },
    confirm: () => {
      if (confirmation !== null) void submit(confirmation.invitation);
    },
    cancel: () => {
      if (inFlight.current) return;
      setConfirmation(null);
    },
  };
}

export function InvitationResendButton({
  invitation,
  now,
  pending,
  register,
  onResend,
}: {
  invitation: PendingInvitation;
  /** Browser clock reading; the server decides with 429 regardless. */
  now: number;
  pending: boolean;
  register: (publicId: string, control: HTMLElement | null) => void;
  onResend: (invitation: PendingInvitation, opener: HTMLElement) => void;
}) {
  const { preferences } = usePreferences();
  const cooldownId = useId();
  if (!invitation.manageable) return null;
  const availableAt = new Date(invitation.resendAvailableAt);
  const cooling = availableAt.getTime() > now;
  return (
    <div className="flex flex-col gap-1">
      <Button
        ref={(control) => {
          register(invitation.publicId, control);
        }}
        type="button"
        variant="secondary"
        size="sm"
        // aria-disabled keeps the cooling button focusable so its reason is read.
        disabled={pending}
        aria-disabled={cooling ? "true" : undefined}
        aria-describedby={cooling ? cooldownId : undefined}
        aria-label={`ส่งคำเชิญซ้ำถึง ${invitation.email}`}
        onClick={(event) => {
          if (cooling) return;
          onResend(invitation, event.currentTarget);
        }}
      >
        ส่งซ้ำ
      </Button>
      {cooling ? (
        <span id={cooldownId} className="text-xs text-foreground-secondary">
          ส่งซ้ำได้อีกครั้งเมื่อ {formatDateTime(availableAt, preferences)}
        </span>
      ) : null}
    </div>
  );
}
