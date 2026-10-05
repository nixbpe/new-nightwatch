import {
  insertMonitorNotificationIntent,
  type MonitorNotificationEventType,
  type MonitorNotificationInput,
} from "@nightwatch/db";

import type { MonitorEvent, MonitorEventHook } from "./record-result";

type SslLevel = "caution" | "danger" | "expired";

const SSL_RANK: Record<SslLevel, number> = {
  caution: 1,
  danger: 2,
  expired: 3,
};

const SSL_EVENT_TYPE: Record<SslLevel, MonitorNotificationEventType> = {
  caution: "MONITOR_SSL_CAUTION",
  danger: "MONITOR_SSL_DANGER",
  expired: "MONITOR_SSL_EXPIRED",
};

/**
 * Writes the notification intent of a monitor event inside transaction B, so
 * the intent and its dispatch ledger commit with the check result and a
 * notification queue outage cannot lose them. The membership advisory lock is
 * already held (record-result retries with it before an event can follow), so
 * the recipient snapshot and the toggle read are ordered against member and
 * settings changes.
 */
export const writeMonitorNotification: MonitorEventHook = async (tx, event) => {
  const base = {
    tenantId: event.tenantId,
    monitorId: event.monitorId,
    monitorName: event.monitorName,
    occurredAt: event.occurredAt,
    sslNotAfter: null,
  };
  const prefix = `monitor:${event.monitorId}`;

  if (event.type === "incident_opened") {
    if (
      !event.alertDownEnabled ||
      !(await monitorAlertsEnabled(tx, event.tenantId))
    )
      return;
    await insertMonitorNotificationIntent(tx, {
      ...base,
      eventType: "MONITOR_DOWN",
      origin: `${prefix}:incident:${event.incidentId}:down`,
      reason: event.reason,
    });
    await tx.query(
      "update monitor_incidents set down_notified = true where id = $1",
      [event.incidentId],
    );
    return;
  }

  if (event.type === "incident_closed") {
    if (!event.downNotified || event.endReason !== "recovered") return;
    if (
      !event.alertDownEnabled ||
      !(await monitorAlertsEnabled(tx, event.tenantId))
    )
      return;
    await insertMonitorNotificationIntent(tx, {
      ...base,
      eventType: "MONITOR_RECOVERED",
      origin: `${prefix}:incident:${event.incidentId}:recovered`,
      reason: null,
    });
    return;
  }

  await writeSslNotification(tx, event, base, prefix);
};

// An organization without a settings row has the column default (true).
async function monitorAlertsEnabled(
  tx: Parameters<MonitorEventHook>[0],
  tenantId: string,
): Promise<boolean> {
  const settings = await tx.query<{ enabled: boolean }>(
    `select monitor_alerts_enabled as enabled
     from notification_org_settings where tenant_id = $1`,
    [tenantId],
  );
  return settings.rows[0]?.enabled !== false;
}

async function writeSslNotification(
  tx: Parameters<MonitorEventHook>[0],
  event: Extract<MonitorEvent, { type: "ssl_level_entered" }>,
  base: Omit<MonitorNotificationInput, "eventType" | "origin" | "reason">,
  prefix: string,
): Promise<void> {
  // record-result resets these when the certificate identity changed, so a
  // matching not_after here means the level was already reported for it.
  const notified = await tx.query<{
    level: SslLevel | null;
    notAfter: Date | null;
  }>(
    `select ssl_notified_level as level, ssl_notified_not_after as "notAfter"
     from monitors where id = $1`,
    [event.monitorId],
  );
  const [row] = notified.rows;
  const sameCertificate = row?.notAfter?.getTime() === event.notAfter.getTime();
  const reported = sameCertificate && row.level ? SSL_RANK[row.level] : 0;
  if (SSL_RANK[event.level] <= reported) return;

  if (
    event.alertSslEnabled &&
    (await monitorAlertsEnabled(tx, event.tenantId))
  ) {
    await insertMonitorNotificationIntent(tx, {
      ...base,
      eventType: SSL_EVENT_TYPE[event.level],
      origin: `${prefix}:ssl:${event.host}:${String(Math.floor(event.notAfter.getTime() / 1000))}:${event.level}`,
      reason: null,
      sslNotAfter: event.notAfter,
    });
  }
  await tx.query(
    `update monitors set ssl_notified_level = $2, ssl_notified_not_after = $3
     where id = $1`,
    [event.monitorId, event.level, event.notAfter],
  );
}
