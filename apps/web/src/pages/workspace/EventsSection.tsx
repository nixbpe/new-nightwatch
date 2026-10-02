import { useQuery } from "@tanstack/react-query";
import type { MonitorRecentEvent } from "@nightwatch/api-contract";
import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router";

import { Skeleton } from "../../components/shell/Skeleton";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { MockupFrame } from "../../components/ui/mockup-frame";
import { SectionHeader } from "../../components/ui/section-header";
import { cn } from "@/lib/utils";
import {
  fetchMonitorRecentEvents,
  MONITOR_REFETCH_INTERVAL_MS,
  monitorQueryKeys,
} from "../../lib/api/monitors";
import {
  formatDuration,
  formatTimeOrDate,
  incidentReasonLabel,
  Time,
  TIME_ZONE,
} from "../monitors/format";
import { HttpStatus } from "../monitors/HttpStatus";
import { sslDaysText } from "../monitors/SslLabel";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { isDenied } from "./rows";

const SSL_EVENT_TITLES = {
  caution: "SSL ใกล้หมดอายุ",
  danger: "SSL วิกฤต",
  expired: "SSL หมดอายุแล้ว",
} as const;

function eventDot(event: MonitorRecentEvent): string {
  if (event.kind === "incident_opened") return "bg-danger";
  if (event.kind === "incident_closed") return "bg-primary";
  return event.sslLevel === "caution" ? "bg-caution" : "bg-danger";
}

function EventText({ event }: { event: MonitorRecentEvent }) {
  if (event.kind === "incident_opened") {
    return (
      <>
        เริ่มล่ม
        {event.reason === null
          ? null
          : ` สาเหตุ ${incidentReasonLabel(event.reason)}`}
        <HttpStatus status={event.httpStatus} />
      </>
    );
  }
  if (event.kind === "incident_closed") {
    return (
      <>
        ล่ม {formatDuration(event.durationSeconds ?? 0)} สิ้นสุด
        {event.reason === null
          ? null
          : ` (${incidentReasonLabel(event.reason)})`}
        <HttpStatus status={event.httpStatus} />
      </>
    );
  }
  const title =
    event.sslLevel === undefined
      ? "SSL"
      : ((SSL_EVENT_TITLES as Record<string, string>)[event.sslLevel] ?? "SSL");
  const days =
    event.sslLevel === undefined
      ? null
      : sslDaysText(event.sslLevel, event.daysRemaining ?? null);
  return <>{days === null ? title : `${title} ${days}`}</>;
}

const ROW_CLASS =
  "grid grid-cols-[56px_minmax(0,1fr)] gap-3 border-b border-foreground/10 py-3";

function EventRow({
  organizationId,
  event,
}: {
  organizationId: string;
  event: MonitorRecentEvent;
}) {
  return (
    <li className={ROW_CLASS}>
      <span className="pt-0.5 font-mono text-xs text-foreground-secondary">
        <Time iso={event.at} format={formatTimeOrDate} />
      </span>
      <span className="flex items-baseline gap-2 text-sm">
        <span
          aria-hidden="true"
          className={cn(
            "mt-1.5 size-[7px] shrink-0 self-start rounded-full",
            eventDot(event),
          )}
        />
        <span className="min-w-0">
          <Link
            to={`/organizations/${organizationId}/monitors/${event.monitorId}`}
            className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {event.monitorName}
          </Link>{" "}
          <span className="text-foreground-secondary">
            <EventText event={event} />
          </span>
        </span>
      </span>
    </li>
  );
}

// Independent query: a failure here stays in this section and never blocks the stats.
export function EventsSection({ organizationId }: { organizationId: string }) {
  const events = useQuery({
    queryKey: monitorQueryKeys.recentEvents(organizationId),
    queryFn: () => fetchMonitorRecentEvents(organizationId),
    refetchInterval: MONITOR_REFETCH_INTERVAL_MS,
  });
  const { refreshMembershipContext } = useTenant();
  const denied = isDenied(events.error);
  const refreshed = useRef(false);
  useEffect(() => {
    if (!denied || refreshed.current) return;
    refreshed.current = true;
    void refreshMembershipContext();
  }, [denied, refreshMembershipContext]);
  let body: ReactNode;
  if (denied) {
    body = <Alert tone="error">คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้</Alert>;
  } else if (events.data !== undefined) {
    body =
      events.data.events.length === 0 ? (
        <p className="py-6 text-sm text-foreground-secondary">
          ไม่มีเหตุการณ์ล่มหรือ SSL เตือนในช่วงที่เก็บข้อมูล
        </p>
      ) : (
        <ol>
          {events.data.events.map((event) => (
            <EventRow
              key={`${event.kind}:${event.monitorId}:${event.at}`}
              organizationId={organizationId}
              event={event}
            />
          ))}
        </ol>
      );
  } else if (events.isError) {
    body = (
      <div className="flex flex-col items-start gap-3 py-4">
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
      <div aria-busy="true" className="flex flex-col gap-3 py-4">
        <p role="status" className="sr-only">
          กำลังโหลดเหตุการณ์ล่าสุด
        </p>
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-4 w-48 max-w-full" />
      </div>
    );
  }
  return (
    <section aria-labelledby="overview-events" className="flex flex-col">
      <SectionHeader
        id="overview-events"
        code="02"
        title="เหตุการณ์ล่าสุด"
        meta={
          <Link
            to="/notifications"
            className="text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            กล่องแจ้งเตือน →
          </Link>
        }
      />
      <p className="pt-2 text-xs text-foreground-secondary">
        เวลาแสดงตามเขตเวลา <span className="font-mono">{TIME_ZONE}</span>
      </p>
      {body}
      {!denied && events.data !== undefined && events.isError ? (
        <Alert tone="warning">อัปเดตเหตุการณ์ล่าสุดไม่สำเร็จ</Alert>
      ) : null}
      <EventsMockups />
    </section>
  );
}

// Sample rows only: neutral dots, placeholder times, no live claim (CMP-05).
function SampleRow({ text, source }: { text: string; source: ReactNode }) {
  return (
    <li className={cn(ROW_CLASS, "py-2 last:border-b-0")}>
      <span className="pt-0.5 font-mono text-xs text-foreground-secondary">
        --:--
      </span>
      <span className="flex items-baseline gap-2 text-sm">
        <span
          aria-hidden="true"
          className="mt-1.5 size-[7px] shrink-0 self-start rounded-full border border-foreground/20"
        />
        <span className="min-w-0">
          {text}
          <span className="block text-[11px] text-foreground-secondary">
            {source}
          </span>
        </span>
      </span>
    </li>
  );
}

// TYP-04: only Latin tokens take the monospace face; Thai in the same line stays sans.
function Latin({ children }: { children: ReactNode }) {
  return <span className="font-mono">{children}</span>;
}

function EventsMockups() {
  return (
    <div className="mt-4 flex flex-col gap-4">
      <MockupFrame label="กิจกรรมขององค์กรในเหตุการณ์ล่าสุด" issue={63}>
        <ol>
          <SampleRow
            text="เชิญ n.p@acme.example เป็นสมาชิก"
            source="องค์กร · คำเชิญ"
          />
          <SampleRow
            text="ลงชื่อเข้าใช้จากอุปกรณ์ใหม่"
            source={
              <>
                ความปลอดภัย · <Latin>Chrome, macOS</Latin>
              </>
            }
          />
        </ol>
      </MockupFrame>
    </div>
  );
}
