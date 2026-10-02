import type {
  OrganizationMember,
  OrganizationMemberListResponse,
} from "@nightwatch/api-contract";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";

import { Button } from "../../components/ui/button";
import { ApiError } from "../../lib/api/client";
import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import {
  MEMBER_LIST_QUERY_PREFIX,
  revokeOrganizationMember,
} from "../../lib/api/members";
import type { ActorRole, RoleNotice } from "./MemberRoleActions";
import { useOrganizationScope } from "./useOrganizationScope";

export type RevokeConfirmation = {
  member: OrganizationMember;
  opener: HTMLElement;
};

const REVOKE_ATTRIBUTE = "data-member-revoke";

// Removing oneself is the self-leave flow, not a revoke.
export function canRevoke(
  actorRole: ActorRole,
  actorUserId: string | undefined,
  member: OrganizationMember,
): boolean {
  return (
    member.userId !== actorUserId &&
    (actorRole === "owner" || member.role !== "owner")
  );
}

/**
 * Revoke flow for one Organization's member page: confirmation, pending guard,
 * list refetch and stale-scope guard (`useOrganizationScope`). Success is
 * shown only when the DELETE succeeded and the refetched list no longer holds
 * the member. Cancel and Escape send no request. When the server denies the
 * actor, the page's membership refresh decides where the user lands
 * (server-confirmed Organization or no-access).
 */
export function useMemberRevoke({
  organizationId,
  listSettled,
  headingRef,
  refetchList,
  refreshMembershipContext,
  blocked,
}: {
  organizationId: string;
  listSettled: boolean;
  /** The dialog parks focus here when the removed member's row is gone. */
  headingRef: RefObject<HTMLElement | null>;
  refetchList: () => Promise<{
    data?: OrganizationMemberListResponse;
    isError: boolean;
  }>;
  refreshMembershipContext: () => Promise<unknown>;
  /** Another member mutation is in flight. */
  blocked: boolean;
}) {
  const queryClient = useQueryClient();
  const { isCurrentScope, scopeCurrent } = useOrganizationScope(organizationId);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<RoleNotice | null>(null);
  const [confirmation, setConfirmation] = useState<RevokeConfirmation | null>(
    null,
  );
  // Member whose control had focus; the list skeleton unmounts it on refetch.
  const focusMemberId = useRef<string | null>(null);

  useEffect(() => {
    const memberId = focusMemberId.current;
    if (memberId === null || pending || !listSettled || !isCurrentScope()) {
      return;
    }
    focusMemberId.current = null;
    const active = document.activeElement;
    if (active !== document.body && active !== headingRef.current) return;
    const control = Array.from(
      document.querySelectorAll<HTMLElement>(`[${REVOKE_ATTRIBUTE}]`),
    ).find((element) => element.dataset.memberRevoke === memberId);
    (control ?? headingRef.current)?.focus();
  }, [headingRef, isCurrentScope, listSettled, pending]);

  async function submit(member: OrganizationMember) {
    if (inFlight.current || blocked || !isCurrentScope()) return;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    let failure: unknown = null;
    try {
      const response = await revokeOrganizationMember(
        organizationId,
        member.id,
      );
      if (
        response.member.organizationId !== organizationId ||
        response.member.id !== member.id
      ) {
        throw new Error("Revoke response does not match the requested member");
      }
    } catch (error) {
      failure = error;
    }
    if (!isCurrentScope()) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: [...MEMBER_LIST_QUERY_PREFIX, organizationId],
        refetchType: "none",
      }),
      queryClient.invalidateQueries({
        queryKey: ME_CONTEXT_QUERY_KEY,
        refetchType: "none",
      }),
    ]);
    if (!isCurrentScope()) return;
    setConfirmation(null);
    // A refetch, not the DELETE response, decides what the notice says.
    const refreshed = await refetchList();
    if (!isCurrentScope()) return;
    const removed =
      !refreshed.isError &&
      refreshed.data?.members.every((item) => item.id !== member.id) === true;
    if (refreshed.isError) {
      // A denied list recovers through the page's membership refresh.
      setNotice(null);
    } else if (failure !== null) {
      setNotice({
        tone: "error",
        text:
          failure instanceof ApiError && failure.code === "LAST_OWNER"
            ? "องค์กรต้องมีเจ้าของอย่างน้อยหนึ่งคน ไม่ได้ถอนสมาชิก และโหลดรายการล่าสุดแล้ว"
            : "ถอนสมาชิกไม่สำเร็จ โหลดรายการล่าสุดแล้ว",
      });
    } else if (!removed) {
      setNotice({
        tone: "error",
        text: "ยังพบสมาชิกในรายการล่าสุด ไม่สามารถยืนยันการถอนได้",
      });
    } else {
      setNotice({
        tone: "success",
        text: `ถอน ${member.name} ออกจากองค์กรแล้ว`,
      });
    }
    focusMemberId.current = member.id;
    // A server denial means the actor's own role or membership changed; the
    // member list alone cannot show that.
    const deniedCode =
      failure instanceof ApiError &&
      (failure.code === "PERMISSION_DENIED" ||
        failure.code === "MEMBERSHIP_DENIED");
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
    pendingText: livePending ? "กำลังถอนสมาชิก…" : null,
    notice,
    confirmation,
    request: (member: OrganizationMember, opener: HTMLElement) => {
      if (inFlight.current || blocked || !isCurrentScope()) return;
      setConfirmation({ member, opener });
    },
    confirm: () => {
      if (confirmation === null) return;
      focusMemberId.current = confirmation.member.id;
      void submit(confirmation.member);
    },
    cancel: () => {
      if (inFlight.current) return;
      focusMemberId.current = null;
      setConfirmation(null);
    },
  };
}

export function MemberRevokeButton({
  member,
  actorRole,
  actorUserId,
  pending,
  onRevoke,
}: {
  member: OrganizationMember;
  actorRole: ActorRole;
  actorUserId: string | undefined;
  pending: boolean;
  onRevoke: (member: OrganizationMember, opener: HTMLElement) => void;
}) {
  if (!canRevoke(actorRole, actorUserId, member)) return null;
  return (
    <Button
      {...{ [REVOKE_ATTRIBUTE]: member.id }}
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={`ถอน ${member.name} ออกจากองค์กร`}
      onClick={(event) => {
        onRevoke(member, event.currentTarget);
      }}
    >
      ถอนสมาชิก
    </Button>
  );
}
