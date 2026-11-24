import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";

import {
  LaptopIcon,
  LogOutIcon,
  SmartphoneIcon,
} from "../../components/shell/icons";
import { PageState } from "../../components/shell/PageState";
import { EmptyState } from "../../components/shell/EmptyState";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { authClient, authErrorMessage } from "../../lib/auth-client";
import { formatDateTime, usePreferences } from "../../lib/preferences";
import { deviceLabel } from "../../lib/sessions/device-label";
import {
  fetchSessions,
  SESSIONS_QUERY_KEY,
  type SessionRow,
} from "../../lib/sessions/sessions";
import { Card, CardFooter } from "../../components/ui/card";
import { SectionHeader } from "../../components/ui/section-header";
import { StatusPill } from "../../components/ui/status-pill";
import { IconTile } from "../../components/ui/icon-tile";

const OTHERS = "__others__";

// Session tokens are used only as the revoke argument and never rendered.
export function SessionsPage() {
  const queryClient = useQueryClient();
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const sessionToken = session?.session.token ?? null;
  const { preferences } = usePreferences();
  const query = useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: fetchSessions,
  });

  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (confirming !== null) {
      confirmRef.current?.focus();
    } else if (pendingFocus.current !== null) {
      triggers.current.get(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  }, [confirming]);

  const closeConfirm = (returnTo: string | null) => {
    pendingFocus.current = returnTo;
    setConfirming(null);
  };

  const revoke = async (
    key: string,
    run: () => Promise<{ error: unknown }>,
  ) => {
    setBusy(key);
    setFailure(null);
    setRevoked(false);
    try {
      const { error } = await run();
      if (error != null) {
        setFailure({
          key,
          message: authErrorMessage(error, "ออกจากระบบเซสชันไม่สำเร็จ"),
        });
        return;
      }
      closeConfirm(null);
      // The revoked row and its focused confirm button are about to unmount.
      headingRef.current?.focus();
      setRevoked(true);
      await queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    } catch {
      setFailure({
        key,
        message: "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง",
      });
    } finally {
      setBusy(null);
    }
  };

  if (query.isPending) {
    return (
      <PageState
        kind="loading"
        layout="lines"
        data-testid="sessions-loading"
        label="กำลังโหลดรายการเซสชัน…"
      />
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col gap-4">
        <Alert data-testid="sessions-load-error" tone="error">
          {query.error.message}
        </Alert>
        <div>
          <Button
            type="button"
            variant="secondary"
            data-testid="sessions-load-retry"
            disabled={query.isRefetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            {query.isRefetching ? "กำลังโหลด…" : "ลองใหม่"}
          </Button>
        </div>
      </div>
    );
  }

  let currentToken: string | null = null;
  if (!isSessionPending && sessionToken !== null) {
    let matchingRowCount = 0;
    for (const row of query.data) {
      if (row.token === sessionToken) {
        matchingRowCount += 1;
        if (matchingRowCount > 1) break;
      }
    }
    if (matchingRowCount === 1) currentToken = sessionToken;
  }
  const rows = sortSessions(query.data, currentToken);
  const others =
    currentToken === null
      ? null
      : rows.filter((row) => row.token !== currentToken);

  return (
    <Card as="section" aria-labelledby="sessions-card-title" padding="md">
      <div className="flex flex-col gap-2">
        <SectionHeader
          id="sessions-card-title"
          headingRef={headingRef}
          headingTabIndex={-1}
          headingClassName="focus:outline-none"
          title="เซสชันที่เข้าสู่ระบบอยู่"
        />
        <p className="text-sm text-foreground-secondary">
          เซสชันทั้งหมดของบัญชีนี้ ออกจากระบบเซสชันที่ไม่รู้จักได้ทันที
        </p>
        {currentToken === null && !isSessionPending ? (
          <p
            data-testid="sessions-current-unknown"
            role="status"
            className="text-sm text-foreground-secondary"
          >
            ยังระบุไม่ได้ว่าเซสชันไหนคือเซสชันนี้ จึงซ่อนปุ่มออกจากระบบไว้
            เพื่อไม่ให้ออกจากเซสชันที่ใช้อยู่โดยไม่ตั้งใจ ลองโหลดหน้านี้ใหม่
          </p>
        ) : null}
      </div>

      <ul
        data-testid="sessions-rows"
        className="flex flex-col rounded-md border border-foreground/10"
      >
        {rows.map((row, index) => {
          const isCurrent = row.token === currentToken;
          const device = deviceLabel(row.userAgent);
          const isConfirming = confirming === row.token;
          const rowFailure =
            failure?.key === row.token ? failure.message : null;
          const lastActive = formatDateTime(row.updatedAt, preferences);
          return (
            <li
              key={row.id}
              data-testid={`session-row-${row.id}`}
              className={`flex flex-col gap-3 p-4 ${
                index < rows.length - 1 ? "border-b border-foreground/10" : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <IconTile>
                  {device.kind === "phone" ? (
                    <SmartphoneIcon size={20} />
                  ) : (
                    <LaptopIcon size={20} />
                  )}
                </IconTile>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="truncate text-sm font-medium"
                      data-testid="session-device"
                      title={row.userAgent ?? undefined}
                    >
                      {device.label}
                    </span>
                    {isCurrent ? (
                      <StatusPill
                        data-testid="session-current"
                        tone="primary"
                        dot
                      >
                        เซสชันนี้
                      </StatusPill>
                    ) : null}
                  </div>
                  <p className="flex flex-wrap gap-x-2 text-xs text-foreground-secondary">
                    <span
                      data-testid={
                        row.ipAddress == null || row.ipAddress.trim() === ""
                          ? "session-ip-unknown"
                          : "session-ip"
                      }
                    >
                      {row.ipAddress === null ||
                      row.ipAddress === undefined ||
                      row.ipAddress.trim() === "" ? (
                        "ไม่ทราบ IP"
                      ) : (
                        <span className="font-mono text-foreground">
                          {row.ipAddress}
                        </span>
                      )}
                    </span>
                    <span>
                      เข้าสู่ระบบ{" "}
                      <time
                        data-testid="session-created-at"
                        dateTime={row.createdAt.toISOString()}
                      >
                        {formatDateTime(row.createdAt, preferences)}
                      </time>
                    </span>
                    <span>
                      ใช้งานล่าสุด{" "}
                      <time
                        data-testid="session-updated-at"
                        dateTime={row.updatedAt.toISOString()}
                      >
                        {lastActive}
                      </time>
                    </span>
                    <span>
                      หมดอายุ{" "}
                      <time
                        data-testid="session-expires-at"
                        dateTime={row.expiresAt.toISOString()}
                      >
                        {formatDateTime(row.expiresAt, preferences)}
                      </time>
                    </span>
                  </p>
                </div>
                {currentToken === null || isCurrent ? null : isConfirming ? (
                  <div className="flex items-center gap-2">
                    <Button
                      ref={confirmRef}
                      type="button"
                      variant="destructive-outline"
                      size="sm"
                      data-testid="session-revoke-confirm"
                      aria-label={`${busy === row.token ? "กำลังออกจากระบบ" : "ยืนยันออกจากระบบ"} ${device.label}`}
                      disabled={busy === row.token}
                      onClick={() => {
                        void revoke(row.token, () =>
                          authClient.revokeSession({ token: row.token }),
                        );
                      }}
                    >
                      {busy === row.token
                        ? "กำลังออกจากระบบ…"
                        : "ยืนยันออกจากระบบ"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        closeConfirm(row.token);
                      }}
                      data-testid="session-revoke-cancel"
                      aria-label={`ยกเลิกการออกจากระบบ ${device.label}`}
                    >
                      ยกเลิก
                    </Button>
                  </div>
                ) : (
                  <Button
                    ref={(element) => {
                      registerTrigger(triggers, row.token, element);
                    }}
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setFailure(null);
                      setConfirming(row.token);
                    }}
                    data-testid="session-revoke-open"
                    aria-label={`ออกจากระบบ ${device.label}`}
                  >
                    <LogOutIcon size={14} />
                    ออกจากระบบ
                  </Button>
                )}
              </div>
              {rowFailure === null ? null : (
                <p
                  data-testid="session-revoke-error"
                  role="alert"
                  className="text-sm text-danger"
                >
                  {rowFailure}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <Notice tone="success">
        {revoked ? "ออกจากระบบเซสชันที่เลือกแล้ว" : null}
      </Notice>
      {others?.length === 0 ? (
        <EmptyState
          data-testid="sessions-no-others"
          icon={<LaptopIcon size={20} />}
          title="ไม่มีเซสชันอื่นเข้าสู่ระบบอยู่ มีเพียงเซสชันนี้เท่านั้น"
        />
      ) : null}
      {others !== null && others.length > 0 ? (
        <CardFooter variant="stack">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-foreground-secondary">
              เซสชันนี้จะยังเข้าสู่ระบบอยู่ เซสชันอื่นต้องเข้าสู่ระบบใหม่
              (และผ่าน MFA ถ้าเปิดไว้)
            </p>
            {confirming === OTHERS ? (
              <div className="flex items-center gap-2">
                <Button
                  ref={confirmRef}
                  type="button"
                  variant="destructive-outline"
                  size="sm"
                  data-testid="sessions-others-confirm"
                  disabled={busy === OTHERS}
                  onClick={() => {
                    void revoke(OTHERS, () => authClient.revokeOtherSessions());
                  }}
                >
                  {busy === OTHERS
                    ? "กำลังออกจากระบบ…"
                    : `ยืนยันออกจากระบบ ${String(others.length)} เซสชัน`}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    closeConfirm(OTHERS);
                  }}
                  data-testid="sessions-others-cancel"
                >
                  ยกเลิก
                </Button>
              </div>
            ) : (
              <Button
                ref={(element) => {
                  registerTrigger(triggers, OTHERS, element);
                }}
                type="button"
                variant="secondary"
                onClick={() => {
                  setFailure(null);
                  setConfirming(OTHERS);
                }}
                data-testid="sessions-others-open"
              >
                ออกจากระบบทุกเซสชันอื่น
              </Button>
            )}
          </div>
          {failure?.key === OTHERS ? (
            <p
              data-testid="sessions-others-error"
              role="alert"
              className="text-sm text-danger"
            >
              {failure.message}
            </p>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}

function registerTrigger(
  triggers: RefObject<Map<string, HTMLButtonElement>>,
  key: string,
  element: HTMLButtonElement | null,
): void {
  if (element === null) {
    triggers.current.delete(key);
  } else {
    triggers.current.set(key, element);
  }
}

function sortSessions(rows: SessionRow[], currentToken: string | null) {
  return [...rows].sort((a, b) => {
    if (a.token === currentToken) return -1;
    if (b.token === currentToken) return 1;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}
