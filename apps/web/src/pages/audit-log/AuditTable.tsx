import {
  AUDIT_ACTION_LABELS,
  type AuditEventSummary,
} from "@nightwatch/api-contract";
import { Link } from "react-router";

import { formatAuditTimestamp, type Preferences } from "../../lib/preferences";
import { actorText, targetText } from "./labels";

/** What the list needs to come back to the same rows: the pinned `asOf` and the anchor of the relative range. */
export type ListSnapshot = { asOf: string; now: string };

/** The router state a row link carries to the detail page and the back link returns. */
export type AuditListReturnState = {
  search?: string;
  eventId?: string;
  snapshot?: ListSnapshot;
};

export function auditEventPath(organizationId: string, eventId: string) {
  return `/organizations/${organizationId}/audit-log/${eventId}`;
}

// A table of its own: DataTable has no caption, and AC-17 needs one with `th scope`.
export function AuditTable({
  organizationId,
  events,
  preferences,
  search,
  snapshot,
  registerLink,
}: {
  organizationId: string;
  events: readonly AuditEventSummary[];
  preferences: Preferences;
  /** The list's query string, handed to the detail page so its back link restores it. */
  search: string;
  /** The snapshot on screen; the detail page hands it back so the list returns to the same rows. */
  snapshot: ListSnapshot;
  registerLink: (eventId: string, element: HTMLAnchorElement | null) => void;
}) {
  const headerClass =
    "h-11 border-b border-foreground/10 px-4 font-medium whitespace-nowrap";
  return (
    <div
      data-testid="audit-events-region"
      tabIndex={0}
      role="region"
      aria-label="ตารางบันทึกกิจกรรม"
      className="overflow-x-auto rounded-md border border-foreground/10 bg-surface focus:outline-2 focus:outline-offset-2 focus:outline-primary"
    >
      <table
        data-testid="audit-events-table"
        className="w-full min-w-[720px] text-left text-sm"
      >
        <caption className="sr-only">
          บันทึกกิจกรรมขององค์กร เรียงจากใหม่สุดก่อน
        </caption>
        <thead className="sticky top-0 z-10 bg-surface text-xs font-medium text-foreground-secondary">
          <tr>
            <th
              data-testid="audit-events-time-heading"
              data-time-zone={preferences.timeZone}
              scope="col"
              className={headerClass}
            >
              เวลา ({preferences.timeZone})
            </th>
            <th scope="col" className={headerClass}>
              ผู้ดำเนินการ
            </th>
            <th scope="col" className={headerClass}>
              การกระทำ
            </th>
            <th scope="col" className={headerClass}>
              เป้าหมาย
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const time = formatAuditTimestamp(
              new Date(event.occurredAt),
              preferences,
            );
            const action = AUDIT_ACTION_LABELS[event.action];
            return (
              <tr
                data-testid={`audit-event-record-${event.id}`}
                data-category={event.category}
                key={event.id}
                className="border-b border-foreground/10 transition-colors duration-100 last:border-0 hover:surface-hover"
              >
                <td className="h-11 px-4 align-middle font-mono text-[13px] whitespace-nowrap">
                  <Link
                    data-testid="audit-event-row-link"
                    ref={(element) => {
                      registerLink(event.id, element);
                    }}
                    to={auditEventPath(organizationId, event.id)}
                    state={{ search, eventId: event.id, snapshot }}
                    aria-label={`${time} ${action}`}
                    className="rounded-[4px] text-primary underline-offset-4 hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {time}
                  </Link>
                </td>
                <td
                  data-testid="audit-event-row-actor"
                  data-member-role={event.actor.roleAtTime}
                  data-membership={event.actor.membership}
                  className="h-11 px-4 align-middle"
                >
                  {actorText(event.actor)}
                </td>
                <td
                  data-testid="audit-event-row-action"
                  data-action-code={event.action}
                  className="h-11 px-4 align-middle"
                >
                  {action}
                </td>
                <td
                  data-testid="audit-event-row-target"
                  data-target-type={event.target.type}
                  className="h-11 px-4 align-middle"
                >
                  {targetText(event.target)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
