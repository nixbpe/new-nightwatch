import type { UseQueryResult } from "@tanstack/react-query";
import type { MonitorRecentEvent } from "@nightwatch/api-contract";
import { Link } from "react-router";

import { Skeleton } from "../../../components/shell/Skeleton";
import { Alert } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { SectionHeader } from "../../../components/ui/section-header";
import {
  MONITOR_RECENT_EVENTS_LIMIT,
  type MonitorRecentEventsResponse,
} from "../../../lib/api/monitors";
import {
  formatDuration,
  formatTime,
  Time,
  TIME_ZONE,
} from "../../monitors/format";
import { HttpStatus } from "../../monitors/HttpStatus";
import { sslText } from "../../monitors/SslLabel";

function EventText({ event }: { event: MonitorRecentEvent }) {
  if (event.kind === "incident_opened")
    return (
      <>
        ล่ม · <span className="font-mono">{event.reason}</span>
        <HttpStatus status={event.httpStatus} />
      </>
    );
  if (event.kind === "incident_closed")
    return (
      <>
        กลับมาใช้งานได้
        {event.durationSeconds === undefined
          ? null
          : ` · ล่ม ${formatDuration(event.durationSeconds)}`}
      </>
    );
  return (
    <>
      SSL{" "}
      {event.sslLevel === undefined
        ? "ไม่ทราบระดับ"
        : sslText(event.sslLevel, event.daysRemaining ?? null)}
    </>
  );
}

export function EventsSection({
  organizationId,
  projectId,
  events,
}: {
  organizationId: string;
  projectId: string;
  events: UseQueryResult<MonitorRecentEventsResponse>;
}) {
  const monitorsPath = `/organizations/${organizationId}/projects/${projectId}/monitors`;
  return (
    <section
      data-testid="project-overview-events"
      aria-labelledby="overview-events"
    >
      <SectionHeader
        id="overview-events"
        title="เหตุการณ์ล่าสุด"
        meta={
          <Link className="text-primary underline" to={monitorsPath}>
            มอนิเตอร์ทั้งหมด
          </Link>
        }
      />
      <p className="pt-2 text-xs text-foreground-secondary">
        ล่าสุด <span className="font-mono">{MONITOR_RECENT_EVENTS_LIMIT}</span>{" "}
        รายการ · เวลาตามเขตเวลา <span className="font-mono">{TIME_ZONE}</span>
      </p>
      {events.data !== undefined ? (
        events.data.events.length === 0 ? (
          <p
            data-testid="project-overview-events-empty"
            className="py-6 text-sm text-foreground-secondary"
          >
            ไม่มีเหตุการณ์ล่มหรือ SSL เตือนในช่วงที่เก็บข้อมูล
          </p>
        ) : (
          <ol>
            {events.data.events.map((event) => (
              <li
                data-testid="project-overview-event"
                key={`${event.kind}:${event.monitorId}:${event.at}`}
                className="grid grid-cols-[56px_minmax(0,1fr)] gap-3 border-b border-foreground/10 py-3 text-sm"
              >
                <span className="font-mono text-xs text-foreground-secondary">
                  <Time iso={event.at} format={formatTime} />
                </span>
                <span className="flex items-baseline gap-2">
                  <span
                    aria-hidden="true"
                    className={`size-[7px] shrink-0 rounded-full ${event.kind === "incident_closed" ? "bg-primary" : event.kind === "ssl_level" && event.sslLevel === "caution" ? "bg-caution" : "bg-danger"}`}
                  />
                  <span className="min-w-0">
                    <Link
                      className="text-primary underline"
                      to={`${monitorsPath}/${event.monitorId}`}
                    >
                      {event.monitorName}
                    </Link>
                    <span className="block text-foreground-secondary">
                      <EventText event={event} />
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )
      ) : events.isError ? (
        <div
          data-testid="project-overview-events-error"
          className="flex flex-col items-start gap-3 py-4"
        >
          <Alert tone="error">โหลดเหตุการณ์ล่าสุดไม่สำเร็จ</Alert>
          <Button variant="secondary" onClick={() => void events.refetch()}>
            ลองใหม่
          </Button>
        </div>
      ) : (
        <Skeleton className="my-4 h-16 w-full" />
      )}
      {events.data !== undefined && events.isError ? (
        <Alert tone="warning">อัปเดตเหตุการณ์ล่าสุดไม่สำเร็จ</Alert>
      ) : null}
    </section>
  );
}
