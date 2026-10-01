import type {
  PendingInvitation,
  PendingInvitationListResponse,
} from "@nightwatch/api-contract";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import { ApiError } from "../../lib/api/client";
import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import {
  cancelInvitation,
  pendingInvitationListQueryPrefix,
} from "../../lib/api/invitations";
import { useOrganizationScope } from "./useOrganizationScope";

export type InvitationNotice = { tone: "success" | "error"; text: string };

export type InvitationCancelConfirmation = {
  invitation: PendingInvitation;
  opener: HTMLElement;
};

/** A row's `publicId`, or "heading", where focus goes once the list settles. */
export type InvitationFocusTarget = string;

/**
 * Cancel flow for one Organization's pending list: confirmation, pending guard,
 * list refetch and stale-scope guard (`useOrganizationScope`). Success is shown
 * only when the DELETE succeeded and the refetched list no longer holds the
 * row. "กลับ" and Escape send no request. A server denial refreshes the
 * membership context. Resend reuses this shape: `request` opens the
 * confirmation, `confirm` submits once, `cancel` closes without a request.
 */
export function useInvitationCancel({
  organizationId,
  rows,
  refetchList,
  refreshMembershipContext,
  requestFocus,
}: {
  organizationId: string;
  /** Rows on the open page, used to pick the neighbour that receives focus. */
  rows: readonly PendingInvitation[];
  refetchList: () => Promise<{
    data?: PendingInvitationListResponse;
    isError: boolean;
  }>;
  refreshMembershipContext: () => Promise<unknown>;
  requestFocus: (target: InvitationFocusTarget) => void;
}) {
  const queryClient = useQueryClient();
  const { isCurrentScope, scopeCurrent } = useOrganizationScope(organizationId);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<InvitationNotice | null>(null);
  const [confirmation, setConfirmation] =
    useState<InvitationCancelConfirmation | null>(null);

  async function submit(invitation: PendingInvitation) {
    if (inFlight.current || !isCurrentScope()) return;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    let failure: unknown = null;
    try {
      await cancelInvitation(organizationId, invitation.publicId);
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
    // A refetch, not the DELETE response, decides what the notice says.
    const refreshed = await refetchList();
    if (!isCurrentScope()) return;
    const gone =
      !refreshed.isError &&
      refreshed.data?.invitations.every(
        (item) => item.publicId !== invitation.publicId,
      ) === true;
    if (refreshed.isError) {
      // The section shows its own list error with a retry.
      setNotice(null);
    } else if (failure !== null) {
      setNotice({
        tone: "error",
        text: "ยกเลิกคำเชิญไม่สำเร็จ โหลดรายการล่าสุดแล้ว",
      });
    } else if (!gone) {
      setNotice({
        tone: "error",
        text: "ยังพบคำเชิญในรายการล่าสุด ไม่สามารถยืนยันการยกเลิกได้",
      });
    } else {
      setNotice({
        tone: "success",
        text: `ยกเลิกคำเชิญถึง ${invitation.email} แล้ว`,
      });
    }
    requestFocus(
      failure === null ? neighbourOf(rows, invitation) : invitation.publicId,
    );
    if (!refreshed.isError && deniedCode) {
      await refreshMembershipContext();
      if (!isCurrentScope()) return;
    }
    inFlight.current = false;
    setPending(false);
  }

  const livePending = scopeCurrent && pending;
  return {
    scopeCurrent,
    pending: livePending,
    pendingText: livePending ? "กำลังยกเลิกคำเชิญ…" : null,
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

// Only manageable rows own a cancel button, so the next one that does gets
// focus, then the previous one, then the section heading.
function neighbourOf(
  rows: readonly PendingInvitation[],
  removed: PendingInvitation,
): InvitationFocusTarget {
  const index = rows.findIndex((row) => row.publicId === removed.publicId);
  const after = rows.slice(index + 1).find((row) => row.manageable);
  const before = rows
    .slice(0, Math.max(index, 0))
    .reverse()
    .find((row) => row.manageable);
  return (after ?? before)?.publicId ?? "heading";
}

export function InvitationCancelButton({
  invitation,
  pending,
  register,
  onCancel,
}: {
  invitation: PendingInvitation;
  pending: boolean;
  /** Lets the section find the control again after the list refetches. */
  register: (publicId: string, control: HTMLElement | null) => void;
  onCancel: (invitation: PendingInvitation, opener: HTMLElement) => void;
}) {
  if (!invitation.manageable) {
    return (
      <span className="text-sm text-foreground-secondary">
        เฉพาะเจ้าของจัดการได้
      </span>
    );
  }
  return (
    <Button
      ref={(control) => {
        register(invitation.publicId, control);
      }}
      type="button"
      variant="secondary"
      size="sm"
      disabled={pending}
      aria-label={`ยกเลิกคำเชิญถึง ${invitation.email}`}
      onClick={(event) => {
        onCancel(invitation, event.currentTarget);
      }}
    >
      ยกเลิกคำเชิญ
    </Button>
  );
}
