import type { MeContextResponse } from "@nightwatch/api-contract";

export type SelfLeaveAttempt = "responded" | "last-owner" | "other-failure";
export type SelfLeaveOrigin = Readonly<{
  signal: AbortSignal;
  isCurrent: () => boolean;
}>;
export type SelfLeaveInput = Readonly<{
  organizationId: string;
  origin: SelfLeaveOrigin;
  attempt: SelfLeaveAttempt;
}>;
export type SelfLeaveView =
  | { kind: "idle" }
  | { kind: "confirming" | "refresh-failed" | "ready"; organizationId: string }
  | {
      kind: "not-left";
      organizationId: string;
      notice: "last-owner" | "other";
    };

export function selfLeaveDestination(
  context: MeContextResponse,
): string | null {
  return context.organizations.some(
    (organization) => organization.id === context.lastActiveTenantId,
  )
    ? context.lastActiveTenantId
    : null;
}
