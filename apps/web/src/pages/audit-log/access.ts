import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { isAuditLogQueryOf } from "../../lib/api/audit-log";
import { ApiError } from "../../lib/api/client";
import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import { useTenant } from "../../lib/tenant/TenantProvider";

const READER_ROLES = ["owner", "admin", "auditor"];

export type DeniedCode = "MEMBERSHIP_DENIED" | "PERMISSION_DENIED";

export function isAuditDenied(
  error: unknown,
): error is ApiError & { code: DeniedCode } {
  return (
    error instanceof ApiError &&
    (error.code === "MEMBERSHIP_DENIED" || error.code === "PERMISSION_DENIED")
  );
}

/** One retry for a blip; a denial or a missing event will not change on a second ask. */
export function retryAuditRead(failureCount: number, error: unknown): boolean {
  return (
    failureCount < 1 &&
    !isAuditDenied(error) &&
    !(error instanceof ApiError && error.status === 404)
  );
}

export type AuditAccess =
  | { status: "loading" }
  | { status: "error"; retry: () => Promise<void> }
  | { status: "denied"; code: DeniedCode }
  | { status: "allowed"; role: string; organizationName: string };

/** What the confirmed membership context says; the server decides again on every request. */
export function useAuditAccess(organizationId: string): AuditAccess {
  const { me, mePending, meError, retryMe } = useTenant();
  if (me === undefined) {
    return mePending || meError === null
      ? { status: "loading" }
      : { status: "error", retry: retryMe };
  }
  const organization = me.organizations.find(
    (item) => item.id === organizationId,
  );
  if (organization === undefined) {
    return { status: "denied", code: "MEMBERSHIP_DENIED" };
  }
  if (!READER_ROLES.includes(organization.role)) {
    return { status: "denied", code: "PERMISSION_DENIED" };
  }
  return {
    status: "allowed",
    role: organization.role,
    organizationName: organization.name,
  };
}

export const DENIED_MESSAGES: Record<DeniedCode, string> = {
  MEMBERSHIP_DENIED: "คุณไม่ใช่สมาชิกขององค์กรนี้",
  PERMISSION_DENIED: "คุณไม่มีสิทธิ์ดูบันทึกกิจกรรม",
};

/**
 * Step 15: the first denial from the server latches for this page instance
 * (a refetch of the refreshed context must not re-enable the queries and loop on
 * 403), drops every cached audit entry of the Organization and reloads the context.
 */
export function useAuditDenial(
  organizationId: string,
  isCurrentScope: () => boolean,
) {
  const queryClient = useQueryClient();
  const [deniedCode, setDeniedCode] = useState<DeniedCode | null>(null);
  const report = useCallback(
    (error: unknown) => {
      if (!isAuditDenied(error) || !isCurrentScope()) return;
      setDeniedCode((current) => current ?? error.code);
      void queryClient.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
    },
    [isCurrentScope, queryClient],
  );
  // Removed after the render that disables the queries: removed while an observer is still
  // enabled, a query is rebuilt and fetched again, and the rows would come back.
  useEffect(() => {
    if (deniedCode === null) return;
    queryClient.removeQueries({
      predicate: (query) => isAuditLogQueryOf(query.queryKey, organizationId),
    });
  }, [deniedCode, organizationId, queryClient]);
  return { deniedCode, report };
}
