import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuditExportListResponse,
  AuditExportRecord,
  AuditExportRequest,
} from "@nightwatch/api-contract";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  auditLogQueryKeys,
  downloadAuditExport,
  fetchAuditExports,
} from "../../lib/api/audit-log";
import { ApiError } from "../../lib/api/client";
import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import { NOTIFICATION_QUERY_PREFIX } from "../../lib/api/notifications";
import { formatAuditTimestamp, type Preferences } from "../../lib/preferences";
import { isAuditDenied, retryAuditRead } from "./access";
import {
  requestFromRecord,
  rowButtonSuffix,
  rowRetryErrorText,
  submitExport,
  type ExportOutcome,
} from "./exports";

const POLL_MS = 5_000;
const LIST_MAX = 20;

const STATUS_PHRASE: Record<AuditExportRecord["status"], string> = {
  generating: "กำลังสร้าง",
  ready: "พร้อมดาวน์โหลด",
  failed: "สร้างไม่สำเร็จ",
  expired: "หมดอายุแล้ว",
};

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Everything the export flow needs from the page: the exports query (owner and admin only),
 * the polling, the one handler for a 403 (B-2) and the three actions. `report` is the page's
 * own denied handler; it only receives `MEMBERSHIP_DENIED`.
 */
export function useAuditExport({
  organizationId,
  role,
  reading,
  scopeCurrent,
  isCurrentScope,
  report,
  preferences,
}: {
  organizationId: string;
  role: string | null;
  reading: boolean;
  scopeCurrent: boolean;
  isCurrentScope: () => boolean;
  report: (error: unknown) => void;
  preferences: Preferences;
}) {
  const queryClient = useQueryClient();
  const key = auditLogQueryKeys.exports(organizationId);
  const [revoked, setRevoked] = useState(false);
  const [dialog, setDialog] = useState<{ opener: HTMLElement | null } | null>(
    null,
  );
  const [requestedNotice, setRequestedNotice] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const permissionNotice = useRef<HTMLDivElement>(null);
  // Requests in flight end with the page or when the Organization scope retires: the server
  // must not create an export for an Organization the user has already left.
  const scopeAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    scopeAbort.current = controller;
    return () => {
      controller.abort();
    };
  }, []);
  useEffect(() => {
    if (!scopeCurrent) scopeAbort.current?.abort();
  }, [scopeCurrent]);
  const canExport = (role === "owner" || role === "admin") && !revoked;

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchAuditExports(organizationId),
    enabled: canExport && reading,
    retry: retryAuditRead,
    refetchInterval: (current) =>
      current.state.data?.exports.some((row) => row.status === "generating") ===
      true
        ? POLL_MS
        : false,
  });
  const inProgress = query.data?.inProgress ?? false;

  // B-2: one handler for a 403 from the list, a poll, the POST, `ขอใหม่` and a download.
  const handleDenied = useCallback(
    (error: unknown) => {
      if (!isAuditDenied(error) || !isCurrentScope()) return;
      if (error.code === "MEMBERSHIP_DENIED") {
        report(error);
        return;
      }
      setRevoked(true);
      setDialog(null);
      setRequestedNotice(false);
      void queryClient.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
    },
    [isCurrentScope, queryClient, report],
  );
  // Only the exports go: the list stays readable. Done after the render that disables the
  // query, so nothing rebuilds and fetches it again.
  useEffect(() => {
    if (!revoked) return;
    void queryClient.cancelQueries({ queryKey: key });
    queryClient.removeQueries({ queryKey: key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revoked, organizationId, queryClient]);
  useEffect(() => {
    handleDenied(query.error);
  }, [query.error, handleDenied]);
  useEffect(() => {
    if (revoked) permissionNotice.current?.focus();
  }, [revoked]);

  // A status change announces itself once, and means a notification may have arrived.
  const previous = useRef<Map<string, AuditExportRecord["status"]> | null>(
    null,
  );
  useEffect(() => {
    const rows = query.data?.exports;
    if (rows === undefined) return;
    const before = previous.current;
    previous.current = new Map(rows.map((row) => [row.id, row.status]));
    if (before === null) return;
    const messages: string[] = [];
    let settled = false;
    for (const row of rows) {
      const was = before.get(row.id);
      if (was === row.status) continue;
      const label = `ไฟล์ ${row.format.toUpperCase()} ที่ขอเมื่อ ${formatAuditTimestamp(new Date(row.requestedAt), preferences)} ${preferences.timeZone}`;
      messages.push(`${label} ${STATUS_PHRASE[row.status]}`);
      if (was === "generating") settled = true;
    }
    if (messages.length > 0) setAnnouncement(messages.join(" "));
    if (settled) {
      void queryClient.invalidateQueries({
        queryKey: NOTIFICATION_QUERY_PREFIX,
      });
    }
  }, [query.data, preferences, queryClient]);

  // M-1: the row and `inProgress` are in the cache before the refetch lands.
  const writeCreated = useCallback(
    (record: AuditExportRecord) => {
      queryClient.setQueryData<AuditExportListResponse>(key, (old) => ({
        exports: [
          record,
          ...(old?.exports.filter((row) => row.id !== record.id) ?? []),
        ].slice(0, LIST_MAX),
        inProgress: true,
      }));
      void queryClient.invalidateQueries({ queryKey: key });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [organizationId, queryClient],
  );
  const refetchList = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, queryClient]);

  const submitFromDialog = async (
    body: AuditExportRequest,
  ): Promise<ExportOutcome> => {
    const outcome = await submitExport(
      organizationId,
      body,
      scopeAbort.current?.signal,
    );
    if (outcome.kind === "aborted" || !isCurrentScope()) return outcome;
    if (outcome.kind === "created") {
      writeCreated(outcome.record);
      setRequestedNotice(true);
      setDialog(null);
    } else if (outcome.kind === "in-progress") {
      refetchList();
      setDialog(null);
    } else if (outcome.kind === "denied") {
      handleDenied(outcome.error);
    }
    return outcome;
  };

  /** Returns the message to show in the row, or null. */
  const retryRow = async (
    record: AuditExportRecord,
  ): Promise<string | null> => {
    const outcome = await submitExport(
      organizationId,
      requestFromRecord(record, new Date()),
      scopeAbort.current?.signal,
    );
    if (outcome.kind === "aborted" || !isCurrentScope()) return null;
    if (outcome.kind === "created") {
      writeCreated(outcome.record);
    } else if (outcome.kind === "in-progress") {
      refetchList();
    } else if (outcome.kind === "denied") {
      handleDenied(outcome.error);
    }
    return rowRetryErrorText(outcome);
  };

  const downloadRow = async (
    record: AuditExportRecord,
  ): Promise<string | null> => {
    try {
      const file = await downloadAuditExport(
        organizationId,
        record.id,
        scopeAbort.current?.signal,
      );
      if (!isCurrentScope() || scopeAbort.current?.signal.aborted === true) {
        return null;
      }
      saveBlob(
        file.blob,
        file.filename ?? `audit-log-${record.id}.${record.format}`,
      );
      return null;
    } catch (error) {
      if (!isCurrentScope() || scopeAbort.current?.signal.aborted === true) {
        return null;
      }
      if (isAuditDenied(error)) {
        handleDenied(error);
        return null;
      }
      if (error instanceof ApiError) {
        if (error.code === "AUDIT_EXPORT_NOT_FOUND") {
          refetchList();
          return "ไม่พบไฟล์นี้ โหลดรายการล่าสุดแล้ว";
        }
        if (error.code === "AUDIT_EXPORT_NOT_READY") {
          refetchList();
          return "ไฟล์ยังไม่พร้อม โหลดรายการล่าสุดแล้ว";
        }
        if (error.code === "AUDIT_EXPORT_EXPIRED") {
          queryClient.setQueryData<AuditExportListResponse>(key, (old) =>
            old === undefined
              ? old
              : {
                  ...old,
                  exports: old.exports.map((row) =>
                    row.id === record.id ? { ...row, status: "expired" } : row,
                  ),
                },
          );
          return "ไฟล์หมดอายุแล้ว";
        }
      }
      return "ดาวน์โหลดไม่สำเร็จ ลองใหม่อีกครั้ง";
    }
  };

  return {
    canExport,
    revoked,
    query,
    rows: query.data?.exports,
    inProgress,
    dialog,
    openDialog: (opener: HTMLElement | null) => {
      setRequestedNotice(false);
      setDialog({ opener });
    },
    closeDialog: () => {
      setDialog(null);
    },
    requestedNotice,
    dismissRequestedNotice: () => {
      setRequestedNotice(false);
    },
    permissionNotice,
    announcement,
    submitFromDialog,
    retryRow,
    downloadRow,
    rowButtonSuffix: (record: AuditExportRecord) =>
      rowButtonSuffix(record, preferences),
  };
}
