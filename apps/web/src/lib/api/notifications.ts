import {
  markAllReadRequestSchema,
  markAllReadResponseSchema,
  notificationCountResponseSchema,
  notificationDetailSchema,
  notificationListResponseSchema,
  notificationStatusFilterSchema,
  notificationCategoryFilterSchema,
  type NotificationStatusFilter,
  type NotificationCategoryFilter,
  notificationSettingsUpdateSchema,
  organizationNotificationSettingsSchema,
  type NotificationListResponse,
  type NotificationSettingsUpdate,
} from "@nightwatch/api-contract";

import { ApiError, request } from "./client";

export const NOTIFICATION_QUERY_PREFIX = ["tenant", "notifications"] as const;
export const notificationQueryKey = (organizationId: string | null) =>
  [...NOTIFICATION_QUERY_PREFIX, organizationId] as const;
export type NotificationFilters = {
  status: NotificationStatusFilter;
  category: NotificationCategoryFilter | null;
};
export function normalizeNotificationFilters(
  input: { status?: unknown; category?: unknown } = {},
): NotificationFilters {
  const status = notificationStatusFilterSchema.safeParse(input.status);
  const category = notificationCategoryFilterSchema.safeParse(input.category);
  return {
    status: status.success ? status.data : "all",
    category: category.success ? category.data : null,
  };
}
export function notificationFilteredQueryKey(
  organizationId: string | null,
  input: Partial<NotificationFilters> = {},
) {
  const filters = normalizeNotificationFilters(input);
  return filters.status === "all" && filters.category === null
    ? notificationQueryKey(organizationId)
    : ([...notificationQueryKey(organizationId), filters] as const);
}
export const notificationPagesQueryKey = (
  organizationId: string | null,
  filters: NotificationFilters,
) =>
  [...notificationFilteredQueryKey(organizationId, filters), "pages"] as const;
export const notificationPageQueryKey = (
  organizationId: string | null,
  cursor: string,
  filters: NotificationFilters,
) => [...notificationPagesQueryKey(organizationId, filters), cursor] as const;
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
  options: Partial<NotificationFilters> & { cursor?: string } = {},
): Promise<NotificationPage> {
  const filters = normalizeNotificationFilters(options);
  return request("/api/notifications", notificationListResponseSchema, {
    query: {
      limit: 20,
      status: filters.status,
      ...(filters.category === null ? {} : { category: filters.category }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    },
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
