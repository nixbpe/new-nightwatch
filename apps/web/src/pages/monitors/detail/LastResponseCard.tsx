import type { LastResponse } from "@nightwatch/api-contract";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Skeleton } from "../../../components/shell/Skeleton";
import { Alert } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { SectionHeader } from "../../../components/ui/section-header";
import { ApiError } from "../../../lib/api/client";
import {
  fetchMonitorLastResponse,
  MONITOR_REFETCH_INTERVAL_MS,
  monitorQueryKeys,
} from "../../../lib/api/monitors";
import { formatTimeOrDate, Time, TIME_ZONE } from "../format";
import { failureCauseText } from "./labels";

const READ_ROLE_ONLY_TEXT = "เฉพาะเจ้าของและผู้ดูแลเห็น headers และเนื้อหา";
const REQUEST_VALUES_TEXT =
  "ไม่เก็บ headers และเนื้อหา เพราะคำขอมี query หรือ body ซึ่งเป้าหมายอาจสะท้อนกลับ";
const FROM_TARGET_TEXT = "เนื้อหานี้มาจากเป้าหมายโดยตรง";
const BODY_OMITTED_TEXT = {
  no_body: "ไม่มีเนื้อหา",
  not_text: "เนื้อหาไม่ใช่ข้อความ",
  undecodable: "ถอดรหัสเนื้อหาไม่ได้",
  request_values: REQUEST_VALUES_TEXT,
} as const;

const TRUNCATED_BADGE = (
  <span className="rounded border border-foreground/20 px-1.5 py-0.5 text-xs text-foreground-secondary">
    ตัดแล้ว
  </span>
);

function Shell({
  code,
  meta,
  children,
}: {
  code?: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="detail-last-response"
      className="flex min-w-0 flex-col gap-4"
    >
      <SectionHeader
        id="detail-last-response"
        code={code}
        title="การตอบกลับล่าสุด"
        meta={meta}
      />
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}

function ResponseBody({ response }: { response: LastResponse }) {
  const { statusLine, detailOmitted, body } = response;
  const cause = failureCauseText(response.failureReason);
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {statusLine === null ? (
          <>
            <span className="font-medium">ไม่มี response</span>
            {cause === null ? null : <span>สาเหตุ {cause}</span>}
          </>
        ) : (
          <span className="font-mono font-medium">
            {statusLine.httpVersion} {statusLine.status}
            {statusLine.reasonPhrase === null
              ? ""
              : ` ${statusLine.reasonPhrase}`}
          </span>
        )}
      </p>
      <p className="text-xs text-foreground-secondary">
        ตรวจเมื่อ <Time iso={response.checkedAt} format={formatTimeOrDate} /> (
        {TIME_ZONE})
      </p>
      <p className="font-mono text-xs break-all text-foreground-secondary">
        {response.url}
      </p>
      {detailOmitted === "request_values" ? (
        <p className="text-xs text-foreground-secondary">
          {REQUEST_VALUES_TEXT}
        </p>
      ) : null}
      {statusLine !== null && detailOmitted === null ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">Headers</h3>
            {response.headersTruncated ? TRUNCATED_BADGE : null}
          </div>
          {response.headers.length === 0 ? (
            <p className="text-xs text-foreground-secondary">ไม่มี headers</p>
          ) : (
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">
                  headers ของการตอบกลับล่าสุด
                </caption>
                <thead>
                  <tr className="text-foreground-secondary">
                    <th scope="col" className="py-1 pr-3 font-medium">
                      ชื่อ
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      ค่า
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {response.headers.map((header, index) => (
                    <tr
                      key={`${header.name}:${String(index)}`}
                      className="border-t border-foreground/10 align-top"
                    >
                      <th
                        scope="row"
                        className="py-1 pr-3 font-mono font-normal break-all"
                      >
                        {header.name}
                      </th>
                      <td className="py-1 font-mono break-all">
                        {header.redacted ? (
                          <span className="font-sans text-foreground-secondary">
                            ค่าถูกซ่อน
                          </span>
                        ) : (
                          header.value
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">เนื้อหา</h3>
            {body?.kind === "text" && body.truncated ? TRUNCATED_BADGE : null}
          </div>
          {body?.kind === "text" ? (
            <div className="min-w-0">
              <pre
                tabIndex={0}
                aria-label="เนื้อหาของการตอบกลับล่าสุด"
                className="surface-inset max-h-96 overflow-auto rounded-md border border-foreground/10 p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground"
              >
                {body.text}
              </pre>
            </div>
          ) : (
            <p className="text-xs text-foreground-secondary">
              {body === null
                ? BODY_OMITTED_TEXT.no_body
                : BODY_OMITTED_TEXT[body.reason]}
            </p>
          )}
          <p className="text-xs text-foreground-secondary">
            {FROM_TARGET_TEXT}
          </p>
        </>
      ) : null}
    </>
  );
}

function isDenied(error: unknown): boolean {
  return error instanceof ApiError && error.code === "PERMISSION_DENIED";
}

function LastResponsePanel({
  organizationId,
  monitorId,
  code,
}: {
  code?: string;
  organizationId: string;
  monitorId: string;
}) {
  const query = useQuery({
    queryKey: monitorQueryKeys.lastResponse(organizationId, monitorId),
    queryFn: () => fetchMonitorLastResponse(organizationId, monitorId),
    // A 403 means the role changed: stop polling and show only the role note.
    refetchInterval: (current) =>
      isDenied(current.state.error) ? false : MONITOR_REFETCH_INTERVAL_MS,
  });
  const data = query.data;
  if (isDenied(query.error)) {
    return (
      <Shell code={code}>
        <p className="text-sm text-foreground-secondary">
          {READ_ROLE_ONLY_TEXT}
        </p>
      </Shell>
    );
  }
  return (
    <Shell code={code} meta={`เวลาแสดงตามเขตเวลา ${TIME_ZONE}`}>
      {data === undefined && query.isError ? (
        <>
          <Alert tone="error">โหลดการตอบกลับล่าสุดไม่สำเร็จ</Alert>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => void query.refetch()}
          >
            ลองอีกครั้ง
          </Button>
        </>
      ) : null}
      {data === undefined && !query.isError ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <p role="status" className="sr-only">
            กำลังโหลดการตอบกลับล่าสุด
          </p>
          <Skeleton className="h-4 w-48 max-w-full" />
          <Skeleton className="h-4 w-32 max-w-full" />
        </div>
      ) : null}
      {data !== undefined && data.response === null ? (
        <p className="text-sm text-foreground-secondary">ยังไม่มีผลตรวจ</p>
      ) : null}
      {data?.response == null ? null : (
        <ResponseBody response={data.response} />
      )}
      {data !== undefined && query.isError ? (
        <Alert tone="warning">อัปเดตการตอบกลับล่าสุดไม่สำเร็จ</Alert>
      ) : null}
    </Shell>
  );
}

/** Only owner and admin may read the response; any other role never sends the request. */
export function LastResponseCard({
  canRead,
  ...rest
}: {
  canRead: boolean;
  code?: string;
  organizationId: string;
  monitorId: string;
}) {
  if (!canRead) {
    return (
      <Shell code={rest.code}>
        <p className="text-sm text-foreground-secondary">
          {READ_ROLE_ONLY_TEXT}
        </p>
      </Shell>
    );
  }
  return <LastResponsePanel {...rest} />;
}
