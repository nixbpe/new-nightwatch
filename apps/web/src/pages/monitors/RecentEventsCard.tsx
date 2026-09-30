import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MonitorRecentEvent } from "@nightwatch/api-contract";
import { Link } from "react-router";

import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Card, CardHeader } from "../../components/ui/card";
import { StatusPill } from "../../components/ui/status-pill";
import { Skeleton } from "../../components/shell/Skeleton";
import {
  fetchMonitorRecentEvents,
  MONITOR_REFETCH_INTERVAL_MS,
  monitorQueryKeys,
} from "../../lib/api/monitors";
import {
  TIME_ZONE,
  formatDateTime,
  formatDuration,
  incidentReasonLabel,
  Time,
} from "./format";
import { sslDaysText } from "./SslLabel";

const SSL_EVENT_TITLES = {
  caution: { tone: "caution", text: "SSL ใกล้หมดอายุ" },
  danger: { tone: "danger", text: "SSL วิกฤต" },
  expired: { tone: "danger", text: "SSL หมดอายุแล้ว" },
} as const;

function EventRow({
  organizationId,
  event,
}: {
  organizationId: string;
  event: MonitorRecentEvent;
}) {
  const sslTitle =
    event.kind === "ssl_level" && event.sslLevel !== undefined
      ? (
          SSL_EVENT_TITLES as Record<
            string,
            { tone: "caution" | "danger"; text: string }
          >
        )[event.sslLevel]
      : undefined;
  const days =
    event.sslLevel === undefined
      ? null
      : sslDaysText(event.sslLevel, event.daysRemaining ?? null);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-foreground/10 px-4 py-3 text-sm last:border-b-0">
      {event.kind === "ssl_level" ? (
        <StatusPill tone={sslTitle?.tone ?? "neutral"}>
          {sslTitle?.text ?? "SSL"}
        </StatusPill>
      ) : (
        <StatusPill tone="danger" dot>
          ล่ม
        </StatusPill>
      )}
      <Link
        to={`/organizations/${organizationId}/monitors/${event.monitorId}`}
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        {event.monitorName}
      </Link>
      <span className="text-foreground-secondary">
        {event.kind === "incident_opened" ? (
          <>
            เริ่มล่ม <Time iso={event.at} format={formatDateTime} />
            {event.reason === null
              ? null
              : ` สาเหตุ ${incidentReasonLabel(event.reason)}`}
          </>
        ) : null}
        {event.kind === "incident_closed" ? (
          <>
            ล่ม {formatDuration(event.durationSeconds ?? 0)} สิ้นสุด{" "}
            <Time iso={event.at} format={formatDateTime} />
            {event.reason === null
              ? null
              : ` (${incidentReasonLabel(event.reason)})`}
          </>
        ) : null}
        {event.kind === "ssl_level" ? (
          <>
            {days === null ? null : `${days} `}ตั้งแต่{" "}
            <Time iso={event.at} format={formatDateTime} />
          </>
        ) : null}
      </span>
    </li>
  );
}

// Independent query: a failure here stays inside the card and never blocks the table.
export function RecentEventsCard({
  organizationId,
}: {
  organizationId: string;
}) {
  const events = useQuery({
    queryKey: monitorQueryKeys.recentEvents(organizationId),
    queryFn: () => fetchMonitorRecentEvents(organizationId),
    refetchInterval: MONITOR_REFETCH_INTERVAL_MS,
  });
  let body: ReactNode;
  if (events.data !== undefined) {
    body =
      events.data.events.length === 0 ? (
        <p className="px-4 py-6 text-sm text-foreground-secondary">
          ไม่มีเหตุการณ์ล่มหรือ SSL เตือนในช่วงที่เก็บข้อมูล
        </p>
      ) : (
        <ul>
          {events.data.events.map((event) => (
            <EventRow
              key={`${event.kind}:${event.monitorId}:${event.at}`}
              organizationId={organizationId}
              event={event}
            />
          ))}
        </ul>
      );
  } else if (events.isError) {
    body = (
      <div className="flex flex-col items-start gap-3 p-4">
        <Alert tone="error">โหลดเหตุการณ์ล่าสุดไม่สำเร็จ</Alert>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void events.refetch()}
        >
          ลองอีกครั้ง
        </Button>
      </div>
    );
  } else {
    body = (
      <div aria-busy="true" className="flex flex-col gap-3 p-4">
        <p role="status" className="sr-only">
          กำลังโหลดเหตุการณ์ล่าสุด
        </p>
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-4 w-48 max-w-full" />
      </div>
    );
  }
  return (
    <Card as="section" aria-labelledby="recent-events-title">
      <CardHeader
        id="recent-events-title"
        title="เหตุการณ์ล่าสุด"
        description={`เวลาแสดงตามเขตเวลา ${TIME_ZONE}`}
        className="border-b border-foreground/10 p-4"
      />
      {body}
      {events.data !== undefined && events.isError ? (
        <div className="border-t border-foreground/10 p-4">
          <Alert tone="warning">อัปเดตเหตุการณ์ล่าสุดไม่สำเร็จ</Alert>
        </div>
      ) : null}
    </Card>
  );
}
