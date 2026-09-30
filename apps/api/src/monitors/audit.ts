import { AppError, type Logger } from "@nightwatch/shared";

export const MONITOR_AUDIT_ACTIONS = [
  "organization.monitor.create",
  "organization.monitor.update",
  "organization.monitor.pause",
  "organization.monitor.resume",
  "organization.monitor.delete",
  "organization.monitor.secret.set",
  "organization.monitor.secret.replace",
  "organization.notification-settings.monitor-alerts.update",
] as const;
export type MonitorAuditAction = (typeof MONITOR_AUDIT_ACTIONS)[number];

export type MonitorDenialAction =
  `organization.monitor.${"list" | "read" | "create" | "update" | "pause" | "resume" | "delete" | "test"}`;

// AC-61: one info line per successful mutation, after commit. It carries
// identifiers only (never URL, config, query, body or secrets). A logger
// failure must not turn a committed mutation into an error response.
export function auditMonitorMutation(
  logger: Logger,
  event: {
    actorUserId: string;
    action: MonitorAuditAction;
    organizationId: string;
    monitorId?: string;
  },
): void {
  try {
    logger.info(
      {
        actorUserId: event.actorUserId,
        action: event.action,
        organizationId: event.organizationId,
        ...(event.monitorId === undefined
          ? {}
          : { monitorId: event.monitorId }),
      },
      "monitor mutation",
    );
  } catch {
    // Best effort by design.
  }
}

const DENIAL_CODES = new Set(["MEMBERSHIP_DENIED", "PERMISSION_DENIED"]);

// Logs actor and action only, never the organization, monitor id, URL or input.
export async function auditMonitorDenials<T>(
  logger: Logger,
  actorUserId: string,
  action: MonitorDenialAction,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppError && DENIAL_CODES.has(error.code)) {
      logger.warn(
        { actorUserId, action, code: error.code },
        "organization access denied",
      );
    }
    throw error;
  }
}
