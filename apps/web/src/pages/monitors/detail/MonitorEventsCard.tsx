import type {
  Monitor,
  MonitorConfigChange,
  MonitorEvent,
} from "@nightwatch/api-contract";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Skeleton } from "../../../components/shell/Skeleton";
import { Alert } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { DataTablePagination } from "../../../components/ui/data-table";
import { SectionHeader } from "../../../components/ui/section-header";
import {
  fetchMonitorEvents,
  MONITOR_HISTORY_PAGE_SIZE,
  MONITOR_REFETCH_INTERVAL_MS,
  monitorQueryKeys,
} from "../../../lib/api/monitors";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  Time,
  TIME_ZONE,
} from "../format";
import {
  configChangeValueText,
  configFieldLabel,
  EVENT_KIND_LABELS,
  eventActorText,
  failureCauseText,
  SECRET_ACTION_LABELS,
} from "./labels";

const THAI = /[\u0e00-\u0e7f]/;

// Latin tokens are mono, Thai wording is not (TYP-04).
const mono = (text: string) =>
  THAI.test(text) ? text : <span className="font-mono">{text}</span>;

function valueNode(value: string | number | null) {
  return value === null ? "ไม่มี" : mono(String(value));
}

function ChangeLine({
  change,
  headerNameById,
}: {
  change: MonitorConfigChange;
  headerNameById: ReadonlyMap<string, string>;
}) {
  const label = configFieldLabel(change.field, headerNameById);
  if (change.kind === "secret") {
    return (
      <>
        {label}: {SECRET_ACTION_LABELS[change.action]}
      </>
    );
  }
  if (change.kind === "changed") {
    return <>{label}: เปลี่ยน</>;
  }
  const before = configChangeValueText(change.field, change.before);
  const after = configChangeValueText(change.field, change.after);
  return (
    <>
      {label}: ก่อน {valueNode(before)} หลัง {valueNode(after)}
    </>
  );
}

function EventSummary({
  event,
  headerNameById,
}: {
  event: MonitorEvent;
  headerNameById: ReadonlyMap<string, string>;
}) {
  switch (event.kind) {
    case "check_failed": {
      const cause = failureCauseText(event.failureReason, event.tlsReason);
      return (
        <>
          <span data-testid="monitor-event-title" className="font-medium">
            {EVENT_KIND_LABELS.check_failed}
          </span>
          {cause === null ? null : <> · {cause}</>}
          {event.httpStatus === null ? null : (
            <> · {mono(`HTTP ${String(event.httpStatus)}`)}</>
          )}
          {event.responseTimeMs === null ? null : (
            <> · {mono(`${formatNumber(event.responseTimeMs)} ms`)}</>
          )}
        </>
      );
    }
    case "incident_opened": {
      const cause = failureCauseText(event.reason);
      return (
        <>
          <span data-testid="monitor-event-title" className="font-medium">
            {EVENT_KIND_LABELS.incident_opened}
          </span>
          {cause === null ? null : <> · {cause}</>}
          {event.httpStatus === null ? null : (
            <> · {mono(`HTTP ${String(event.httpStatus)}`)}</>
          )}
        </>
      );
    }
    case "incident_closed":
      return event.endReason === "recovered" ? (
        <>
          <span data-testid="monitor-event-title" className="font-medium">
            {EVENT_KIND_LABELS.incident_closed_recovered}
          </span>
          {event.httpStatus === null ? null : (
            <> · {mono(`HTTP ${String(event.httpStatus)}`)}</>
          )}
          {event.responseTimeMs === null ? null : (
            <> · {mono(`${formatNumber(event.responseTimeMs)} ms`)}</>
          )}
          <> · ล่ม {formatDuration(event.durationSeconds)}</>
        </>
      ) : (
        <>
          <span data-testid="monitor-event-title" className="font-medium">
            {EVENT_KIND_LABELS.incident_closed_paused}
          </span>{" "}
          · หยุดชั่วคราวโดยผู้ใช้ · ล่ม {formatDuration(event.durationSeconds)}
        </>
      );
    case "paused":
    case "resumed":
    case "config_changed": {
      const actor = eventActorText(event.actor);
      const title = EVENT_KIND_LABELS[event.kind];
      return (
        <>
          <span data-testid="monitor-event-title" className="font-medium">
            {title}
          </span>
          {actor === null ? null : <> โดย {actor}</>}
          {event.kind === "config_changed" && event.changes.length > 0 ? (
            <ul
              data-testid="monitor-event-changes"
              className="mt-1 flex flex-col gap-0.5 text-xs text-foreground-secondary"
            >
              {event.changes.map((change) => (
                <li
                  key={`${change.field}:${change.kind}`}
                  data-testid="monitor-event-change"
                  data-field={change.field}
                  data-kind={change.kind}
                  data-before-kind={
                    change.kind === "value"
                      ? change.before === null
                        ? "null"
                        : typeof change.before
                      : undefined
                  }
                  data-after-kind={
                    change.kind === "value"
                      ? change.after === null
                        ? "null"
                        : typeof change.after
                      : undefined
                  }
                  data-action-code={
                    change.kind === "secret" ? change.action : undefined
                  }
                  className="break-words"
                >
                  <ChangeLine change={change} headerNameById={headerNameById} />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      );
    }
  }
}

// Independent query: a failure stays inside this card.
export function MonitorEventsCard({
  organizationId,
  monitorId,
  headers,
}: {
  organizationId: string;
  monitorId: string;
  headers: Monitor["headers"];
}) {
  const [offset, setOffset] = useState(0);
  const page = { limit: MONITOR_HISTORY_PAGE_SIZE, offset };
  const events = useQuery({
    queryKey: monitorQueryKeys.events(organizationId, monitorId, page),
    queryFn: () => fetchMonitorEvents(organizationId, monitorId, page),
    refetchInterval: MONITOR_REFETCH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  });
  const data = events.data;
  // One page needs no pager (AC-86); `hasPrevious` keeps the way back when the total shrinks while on a later page.
  const hasPrevious = data !== undefined && data.page.offset > 0;
  const hasNext =
    data !== undefined &&
    data.page.offset + data.events.length < data.page.total;
  const headerNameById = new Map(
    headers.flatMap((header) =>
      header.id === undefined ? [] : [[header.id, header.name] as const],
    ),
  );
  return (
    <section
      data-testid="monitor-event-feed"
      aria-labelledby="detail-event-feed"
      className="flex flex-col gap-4"
    >
      <SectionHeader
        id="detail-event-feed"
        title="ฟีดเหตุการณ์"
        meta={<>30 วันล่าสุด · เวลาแสดงตามเขตเวลา {TIME_ZONE}</>}
      />
      <div className="flex flex-col gap-3">
        {data === undefined && events.isError ? (
          <>
            <Alert data-testid="monitor-event-feed-error" tone="error">
              โหลดฟีดเหตุการณ์ไม่สำเร็จ
            </Alert>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="self-start"
              data-testid="monitor-event-feed-retry"
              onClick={() => void events.refetch()}
            >
              ลองอีกครั้ง
            </Button>
          </>
        ) : null}
        {data === undefined && !events.isError ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <p
              data-testid="monitor-event-feed-loading"
              role="status"
              className="sr-only"
            >
              กำลังโหลดฟีดเหตุการณ์
            </p>
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="h-4 w-48 max-w-full" />
          </div>
        ) : null}
        {data !== undefined && data.page.total === 0 ? (
          <p
            data-testid="monitor-event-feed-empty"
            className="text-sm text-foreground-secondary"
          >
            ยังไม่มีเหตุการณ์ใน 30 วันล่าสุด
          </p>
        ) : null}
        {data !== undefined && data.page.total > 0 ? (
          <>
            <ol
              data-testid="monitor-event-feed-list"
              aria-label="ฟีดเหตุการณ์ของมอนิเตอร์"
              className="divide-y divide-foreground/10 text-sm"
            >
              {data.events.map((event) => (
                <li
                  key={event.id}
                  data-testid={`monitor-event-record-${event.id}`}
                  data-event-kind={event.kind}
                  data-reason={
                    "failureReason" in event
                      ? event.failureReason
                      : "reason" in event
                        ? event.reason
                        : "endReason" in event
                          ? event.endReason
                          : undefined
                  }
                  data-tls-reason={
                    "tlsReason" in event ? event.tlsReason : undefined
                  }
                  data-actor-kind={
                    "actor" in event ? event.actor.kind : undefined
                  }
                  data-incident-id={
                    "incidentId" in event ? event.incidentId : undefined
                  }
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5"
                >
                  <span className="w-40 shrink-0 font-mono text-xs text-foreground-secondary">
                    <Time
                      testId="monitor-event-time"
                      iso={event.at}
                      format={formatDateTime}
                    />
                  </span>
                  <div className="min-w-0 flex-1 break-words">
                    <EventSummary
                      event={event}
                      headerNameById={headerNameById}
                    />
                  </div>
                </li>
              ))}
            </ol>
            {hasPrevious || hasNext ? (
              <DataTablePagination
                data-testid="monitor-event-feed-pagination"
                previousTestId="monitor-event-feed-previous"
                nextTestId="monitor-event-feed-next"
                summaryTestId="monitor-event-feed-summary"
                ariaLabel="หน้าฟีดเหตุการณ์"
                summary={
                  <>
                    แสดง {data.page.offset + 1}–
                    {data.page.offset + data.events.length} จาก{" "}
                    {data.page.total}
                  </>
                }
                previousLabel="ก่อนหน้า"
                nextLabel="ถัดไป"
                hasPrevious={hasPrevious}
                hasNext={hasNext}
                onPrevious={() => {
                  setOffset(Math.max(0, offset - MONITOR_HISTORY_PAGE_SIZE));
                }}
                onNext={() => {
                  setOffset(offset + MONITOR_HISTORY_PAGE_SIZE);
                }}
              />
            ) : null}
          </>
        ) : null}
        {data !== undefined && events.isError ? (
          <Alert data-testid="monitor-event-feed-refresh-error" tone="warning">
            อัปเดตฟีดเหตุการณ์ไม่สำเร็จ
          </Alert>
        ) : null}
      </div>
    </section>
  );
}
