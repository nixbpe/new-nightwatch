import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";

import {
  LaptopIcon,
  LogOutIcon,
  SmartphoneIcon,
} from "../../components/shell/icons";
import { Skeleton } from "../../components/shell/Skeleton";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { authClient, authErrorMessage } from "../../lib/auth-client";
import { formatDateTime, usePreferences } from "../../lib/preferences";
import { deviceLabel } from "../../lib/sessions/device-label";
import {
  fetchSessions,
  relativeTime,
  SESSIONS_QUERY_KEY,
  type SessionRow,
} from "../../lib/sessions/sessions";

const OTHERS = "__others__";

/**
 * Sessions tab: every session signed in to the account, the current one
 * marked and un-revokable, the rest revocable one at a time or all at
 * once (always behind an inline confirm). Session tokens are used only as
 * the revoke argument and never rendered.
 */
export function SessionsPage() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const currentToken = session?.session.token ?? null;
  const { preferences } = usePreferences();
  const query = useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: fetchSessions,
  });

  // Which confirm is open (a session token, or OTHERS), and where focus
  // returns when it closes.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

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
    try {
      const { error } = await run();
      if (error != null) {
        setFailure({
          key,
          message: authErrorMessage(error, "ออกจากระบบอุปกรณ์ไม่สำเร็จ"),
        });
        return;
      }
      closeConfirm(null);
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
      <section
        role="status"
        aria-label="กำลังโหลดรายการเซสชัน"
        className="flex flex-col gap-3 rounded-md border border-foreground/10 bg-surface p-6"
      >
        <Skeleton className="h-4 w-56" />
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-16 w-full" />
        ))}
      </section>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="error">{query.error.message}</Alert>
        <div>
          <Button
            type="button"
            variant="secondary"
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

  const rows = sortSessions(query.data, currentToken);
  const others = rows.filter((row) => row.token !== currentToken);
  const now = new Date();

  return (
    <section
      aria-labelledby="sessions-card-title"
      className="flex flex-col gap-5 rounded-md border border-foreground/10 bg-surface p-6"
    >
      <div>
        <h2 id="sessions-card-title" className="text-base font-semibold">
          อุปกรณ์ที่เข้าสู่ระบบอยู่
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">
          เซสชันทั้งหมดของบัญชีนี้ ออกจากระบบอุปกรณ์ที่ไม่รู้จักได้ทันที
        </p>
      </div>

      <ul className="flex flex-col rounded-md border border-foreground/10">
        {rows.map((row, index) => {
          const isCurrent = row.token === currentToken;
          const device = deviceLabel(row.userAgent);
          const isConfirming = confirming === row.token;
          const rowFailure =
            failure?.key === row.token ? failure.message : null;
          return (
            <li
              key={row.id}
              className={`flex flex-col gap-3 p-4 ${
                index < rows.length - 1 ? "border-b border-foreground/10" : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-foreground/10 bg-foreground/5 text-foreground-secondary"
                >
                  {device.kind === "phone" ? (
                    <SmartphoneIcon size={20} />
                  ) : (
                    <LaptopIcon size={20} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="truncate text-sm font-medium"
                      title={row.userAgent ?? undefined}
                    >
                      {device.label}
                    </span>
                    {isCurrent ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 px-2 py-0.5 text-xs font-medium text-primary">
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full bg-current"
                        />
                        อุปกรณ์นี้
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-foreground-secondary">
                    {row.ipAddress === null ||
                    row.ipAddress === undefined ||
                    row.ipAddress.trim() === "" ? (
                      "ไม่ทราบ IP"
                    ) : (
                      <span className="font-mono">{row.ipAddress}</span>
                    )}
                    {" · ใช้งานล่าสุด "}
                    <time
                      dateTime={row.updatedAt.toISOString()}
                      title={formatDateTime(row.updatedAt, preferences)}
                    >
                      {isCurrent ? "ตอนนี้" : relativeTime(row.updatedAt, now)}
                    </time>
                  </p>
                </div>
                {isCurrent ? null : isConfirming ? (
                  <div className="flex items-center gap-2">
                    <Button
                      ref={confirmRef}
                      type="button"
                      variant="destructive"
                      size="sm"
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
                  >
                    <LogOutIcon size={14} />
                    ออกจากระบบ
                  </Button>
                )}
              </div>
              {rowFailure === null ? null : (
                <p role="alert" className="text-sm text-danger">
                  {rowFailure}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {others.length === 0 ? (
        <Alert tone="info">
          ไม่มีอุปกรณ์อื่นเข้าสู่ระบบอยู่ — มีเพียงอุปกรณ์นี้เท่านั้น
        </Alert>
      ) : (
        <div className="flex flex-col gap-3 border-t border-foreground/10 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-foreground-secondary">
              อุปกรณ์นี้จะยังเข้าสู่ระบบอยู่ · อุปกรณ์อื่นต้องเข้าสู่ระบบใหม่
              (และผ่าน MFA ถ้าเปิดไว้)
            </p>
            {confirming === OTHERS ? (
              <div className="flex items-center gap-2">
                <Button
                  ref={confirmRef}
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy === OTHERS}
                  onClick={() => {
                    void revoke(OTHERS, () => authClient.revokeOtherSessions());
                  }}
                >
                  {busy === OTHERS
                    ? "กำลังออกจากระบบ…"
                    : `ยืนยันออกจากระบบ ${String(others.length)} อุปกรณ์`}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    closeConfirm(OTHERS);
                  }}
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
                className="text-danger"
                onClick={() => {
                  setFailure(null);
                  setConfirming(OTHERS);
                }}
              >
                ออกจากระบบทุกอุปกรณ์อื่น
              </Button>
            )}
          </div>
          {failure?.key === OTHERS ? (
            <p role="alert" className="text-sm text-danger">
              {failure.message}
            </p>
          ) : null}
        </div>
      )}
    </section>
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

/** Current session first, then most recently active. */
function sortSessions(rows: SessionRow[], currentToken: string | null) {
  return [...rows].sort((a, b) => {
    if (a.token === currentToken) return -1;
    if (b.token === currentToken) return 1;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}
