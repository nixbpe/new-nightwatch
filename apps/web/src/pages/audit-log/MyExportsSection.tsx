import type {
  AuditActorOption,
  AuditExportRecord,
} from "@nightwatch/api-contract";
import { useEffect, useId, useRef, useState, type Ref } from "react";
import { useLocation } from "react-router";

import { Skeleton } from "../../components/shell/Skeleton";
import { Button } from "../../components/ui/button";
import { SectionHeader } from "../../components/ui/section-header";
import { formatAuditTimestamp, type Preferences } from "../../lib/preferences";
import { failureText, FORMAT_LABEL, MY_EXPORTS_ID, scopeText } from "./exports";

const LIST_MAX = 20;

type RowState = {
  message?: string;
  busy?: "download" | "retry";
};

// Step 10, M-8. One live region for the whole section; every control that cannot be used
// right now is `aria-disabled` with a description (M-2), never `disabled`.
export function MyExportsSection({
  rows,
  loading,
  failedWithoutRows,
  pollFailed,
  onRetryList,
  inProgress,
  reasonId,
  announcement,
  actors,
  preferences,
  headingRef,
  buttonSuffix,
  onRetryRow,
  onDownload,
  onAdjustFilters,
}: {
  rows: readonly AuditExportRecord[] | undefined;
  loading: boolean;
  failedWithoutRows: boolean;
  pollFailed: boolean;
  onRetryList: () => void;
  inProgress: boolean;
  /** The one visible reason under the page header; set while `inProgress`. */
  reasonId: string;
  announcement: string;
  actors: readonly AuditActorOption[] | undefined;
  preferences: Preferences;
  headingRef: Ref<HTMLHeadingElement>;
  buttonSuffix: (record: AuditExportRecord) => string;
  onRetryRow: (record: AuditExportRecord) => Promise<string | null>;
  onDownload: (record: AuditExportRecord) => Promise<string | null>;
  onAdjustFilters: (record: AuditExportRecord) => void;
}) {
  const idBase = useId();
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const heading = useRef<HTMLHeadingElement | null>(null);
  const location = useLocation();
  const focusedFromHash = useRef(false);
  const visible = loading || failedWithoutRows || (rows?.length ?? 0) > 0;

  // M-10: `.../audit-log#my-exports` lands on the section heading once it renders.
  useEffect(() => {
    if (
      visible &&
      !focusedFromHash.current &&
      location.hash === `#${MY_EXPORTS_ID}`
    ) {
      focusedFromHash.current = true;
      heading.current?.focus();
    }
  }, [visible, location.hash]);

  if (!visible) return null;

  const patch = (id: string, change: RowState) => {
    setRowState((previous) => ({
      ...previous,
      [id]: { ...previous[id], ...change },
    }));
  };
  const run = async (
    record: AuditExportRecord,
    busy: "download" | "retry",
    action: (record: AuditExportRecord) => Promise<string | null>,
  ) => {
    if (rowState[record.id]?.busy !== undefined) return;
    patch(record.id, { busy, message: undefined });
    const message = await action(record);
    patch(record.id, { busy: undefined, message: message ?? undefined });
  };

  return (
    <section
      id={MY_EXPORTS_ID}
      aria-labelledby={`${idBase}-title`}
      className="flex flex-col gap-4"
    >
      <SectionHeader
        id={`${idBase}-title`}
        code="03"
        title="ไฟล์ส่งออกของฉัน"
        headingRef={(element) => {
          heading.current = element;
          if (typeof headingRef === "function") headingRef(element);
          else if (headingRef !== null) headingRef.current = element;
        }}
        headingTabIndex={-1}
        headingClassName="w-fit rounded-[4px] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        meta={
          pollFailed || failedWithoutRows ? (
            <span className="flex items-center gap-2">
              ข้อมูลอาจไม่เป็นปัจจุบัน
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onRetryList}
              >
                ลองใหม่
              </Button>
            </span>
          ) : undefined
        }
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {loading ? (
        <div aria-busy="true" className="flex min-h-11 items-center">
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      ) : null}
      {rows === undefined || rows.length === 0 ? null : (
        <div className="overflow-x-auto rounded-md border border-foreground/10 bg-surface">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">ไฟล์ส่งออกของฉัน</caption>
            <thead className="text-xs font-medium text-foreground-secondary">
              <tr>
                {["รูปแบบ", "ขอบเขต", "ขอเมื่อ", "สถานะ", "การดำเนินการ"].map(
                  (heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="h-11 border-b border-foreground/10 px-4 font-medium whitespace-nowrap"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => {
                const state = rowState[record.id] ?? {};
                const messageId = `${idBase}-${record.id}-message`;
                const suffix = buttonSuffix(record);
                const describedBy =
                  state.message !== undefined
                    ? messageId
                    : inProgress
                      ? reasonId
                      : undefined;
                const tooLarge =
                  record.status === "failed" &&
                  record.failureCode === "EXPORT_TOO_LARGE";
                const retryDisabled =
                  inProgress || state.busy !== undefined ? true : undefined;
                return (
                  <tr
                    key={record.id}
                    className="border-b border-foreground/10 align-top last:border-0"
                  >
                    <td className="px-4 py-3">{FORMAT_LABEL[record.format]}</td>
                    <td className="px-4 py-3 break-words">
                      {scopeText(record, preferences, actors)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] whitespace-nowrap">
                      {formatAuditTimestamp(
                        new Date(record.requestedAt),
                        preferences,
                      )}{" "}
                      {preferences.timeZone}
                    </td>
                    <td className="px-4 py-3">
                      <StatusCell record={record} preferences={preferences} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {record.status === "ready" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            aria-label={`ดาวน์โหลด ${suffix}`}
                            aria-disabled={
                              state.busy === "download" ? true : undefined
                            }
                            aria-describedby={describedBy}
                            onClick={() => {
                              void run(record, "download", onDownload);
                            }}
                          >
                            {state.busy === "download"
                              ? "กำลังดาวน์โหลด…"
                              : "ดาวน์โหลด"}
                          </Button>
                        ) : null}
                        {tooLarge ? (
                          <Button
                            type="button"
                            size="sm"
                            aria-label={`ปรับตัวกรอง ${suffix}`}
                            onClick={() => {
                              onAdjustFilters(record);
                            }}
                          >
                            ปรับตัวกรอง
                          </Button>
                        ) : null}
                        {record.status === "failed" ||
                        record.status === "expired" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            aria-label={`ขอใหม่ ${suffix}`}
                            aria-disabled={retryDisabled}
                            aria-busy={
                              state.busy === "retry" ? true : undefined
                            }
                            aria-describedby={describedBy}
                            onClick={() => {
                              if (retryDisabled === true) return;
                              void run(record, "retry", onRetryRow);
                            }}
                          >
                            ขอใหม่
                          </Button>
                        ) : null}
                      </div>
                      {tooLarge ? (
                        <p className="mt-1 text-xs text-foreground-secondary">
                          ช่วงวันในตัวกรองครอบช่วงของแถวนี้
                          อาจกว้างกว่าไฟล์ที่ขอ
                        </p>
                      ) : null}
                      {state.message === undefined ? null : (
                        <p
                          id={messageId}
                          role="alert"
                          className="mt-1 text-xs text-danger"
                        >
                          {state.message}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows !== undefined && rows.length >= LIST_MAX ? (
        <p className="text-xs text-foreground-secondary">
          แสดง {LIST_MAX} รายการล่าสุด
        </p>
      ) : null}
    </section>
  );
}

function StatusCell({
  record,
  preferences,
}: {
  record: AuditExportRecord;
  preferences: Preferences;
}) {
  switch (record.status) {
    case "generating":
      return <>กำลังสร้าง</>;
    case "ready":
      return (
        <>
          พร้อมดาวน์โหลด
          {record.expiresAt === null ? null : (
            <>
              {" "}
              · ดาวน์โหลดได้ถึง{" "}
              <span className="font-mono text-[13px]">
                {formatAuditTimestamp(new Date(record.expiresAt), preferences)}{" "}
                {preferences.timeZone}
              </span>
            </>
          )}
        </>
      );
    case "failed":
      return <>ล้มเหลว · {failureText(record.failureCode)}</>;
    case "expired":
      return <>หมดอายุ · ไฟล์หมดอายุแล้ว</>;
  }
}
