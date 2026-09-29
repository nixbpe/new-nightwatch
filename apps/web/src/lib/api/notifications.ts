import {
  markAllReadRequestSchema,
  markAllReadResponseSchema,
  markReadResponseSchema,
  notificationCountResponseSchema,
  notificationDetailSchema,
  notificationListResponseSchema,
  notificationSettingsUpdateSchema,
  organizationNotificationSettingsSchema,
  type NotificationListResponse,
  type NotificationSettingsUpdate,
} from "@nightwatch/api-contract";

import { ApiError, request } from "./client";

export const NOTIFICATION_QUERY_PREFIX = ["tenant", "notifications"] as const;
export const notificationQueryKey = (organizationId: string | null) =>
  [...NOTIFICATION_QUERY_PREFIX, organizationId] as const;
export const notificationPageQueryKey = (
  organizationId: string | null,
  cursor?: string,
) =>
  cursor === undefined
    ? notificationQueryKey(organizationId)
    : ([...notificationQueryKey(organizationId), cursor] as const);
export const organizationNotificationSettingsQueryKey = (
  organizationId: string,
) => ["tenant", "notification-settings", organizationId] as const;

export type NotificationPage = NotificationListResponse;

// Org selection is account-global, so another session may switch it; a response for a different
// scope is rejected (never cached) and TenantProvider refreshes the context.
export class InboxScopeChangedError extends Error {
  constructor() {
    super("inbox scope changed");
    this.name = "InboxScopeChangedError";
  }
}

export function isInboxScopeChanged(error: unknown): boolean {
  return (
    error instanceof InboxScopeChangedError ||
    (error instanceof ApiError && error.code === "INBOX_SCOPE_CHANGED")
  );
}

function expectScope<T extends { organizationId: string | null }>(
  expectedOrganizationId: string | null,
  result: T,
): T {
  if (result.organizationId !== expectedOrganizationId) {
    throw new InboxScopeChangedError();
  }
  return result;
}

export function fetchNotifications(
  organizationId: string | null,
  cursor?: string,
): Promise<NotificationPage> {
  return request("/api/notifications", notificationListResponseSchema, {
    query: cursor === undefined ? { limit: 20 } : { limit: 20, cursor },
  }).then((result) =>
    expectScope(organizationId, notificationListResponseSchema.parse(result)),
  );
}
export function fetchUnreadCount(organizationId: string | null) {
  return request(
    "/api/notifications/unread-count",
    notificationCountResponseSchema,
  ).then((result) =>
    expectScope(organizationId, notificationCountResponseSchema.parse(result)),
  );
}
export function openNotification(id: string) {
  return request("/api/notifications/{id}/open", notificationDetailSchema, {
    method: "POST",
    params: { id },
  }).then((result) => notificationDetailSchema.parse(result));
}
export function markNotificationRead(id: string) {
  return request("/api/notifications/{id}/read", markReadResponseSchema, {
    method: "PATCH",
    params: { id },
  }).then((result) => markReadResponseSchema.parse(result));
}
export function markAllNotificationsRead(
  expectedOrganizationId: string | null,
) {
  const body = markAllReadRequestSchema.parse({ expectedOrganizationId });
  return request("/api/notifications/read-all", markAllReadResponseSchema, {
    method: "POST",
    body,
  }).then((result) => markAllReadResponseSchema.parse(result));
}
export function fetchOrganizationNotificationSettings(organizationId: string) {
  return request(
    "/api/organizations/{organizationId}/notification-settings",
    organizationNotificationSettingsSchema,
    { params: { organizationId } },
  ).then((result) => organizationNotificationSettingsSchema.parse(result));
}
export function updateOrganizationNotificationSettings(
  organizationId: string,
  update: NotificationSettingsUpdate,
) {
  const body = notificationSettingsUpdateSchema.parse(update);
  return request(
    "/api/organizations/{organizationId}/notification-settings",
    organizationNotificationSettingsSchema,
    { method: "PATCH", params: { organizationId }, body },
  ).then((result) => organizationNotificationSettingsSchema.parse(result));
}
