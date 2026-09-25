import {
  markAllReadResponseSchema,
  markReadResponseSchema,
  notificationCountResponseSchema,
  notificationDetailSchema,
  notificationListResponseSchema,
  notificationSettingsUpdateSchema,
  organizationNotificationSettingsSchema,
  type NotificationListResponse,
} from "@nightwatch/api-contract";

import { request } from "./client";

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

export type NotificationPage = NotificationListResponse & {
  organizationId: string | null;
};

export function fetchNotifications(
  organizationId: string | null,
  cursor?: string,
): Promise<NotificationPage> {
  return request("/api/notifications", notificationListResponseSchema, {
    query: cursor === undefined ? { limit: 20 } : { limit: 20, cursor },
  }).then((result) => ({
    ...notificationListResponseSchema.parse(result),
    organizationId,
  }));
}
export function fetchUnreadCount(organizationId: string | null) {
  return request(
    "/api/notifications/unread-count",
    notificationCountResponseSchema,
  ).then((result) => ({
    ...notificationCountResponseSchema.parse(result),
    organizationId,
  }));
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
export function markAllNotificationsRead() {
  return request("/api/notifications/read-all", markAllReadResponseSchema, {
    method: "POST",
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
  update: { settingsChangedEnabled: boolean; expectedVersion: number },
) {
  const body = notificationSettingsUpdateSchema.parse(update);
  return request(
    "/api/organizations/{organizationId}/notification-settings",
    organizationNotificationSettingsSchema,
    { method: "PATCH", params: { organizationId }, body },
  ).then((result) => organizationNotificationSettingsSchema.parse(result));
}
