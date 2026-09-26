import { z } from "zod";

/** `notification-api/1` event names exposed to notification clients. */
export const notificationEventTypeSchema = z.enum([
  "ORG-NOTIFICATION-SETTINGS-CHANGED",
  "PASSWORD_CHANGED",
  "MFA_ENABLED",
  "MFA_DISABLED",
]);

export type NotificationEventType = z.infer<typeof notificationEventTypeSchema>;

const isoDateTimeSchema = z.iso.datetime();
const notificationItemIdSchema = z.uuid();
const organizationIdSchema = z.uuid();

const accountNotificationItemSchema = z.object({
  id: notificationItemIdSchema,
  scope: z.literal("account"),
  organizationId: z.null(),
  eventType: z.enum(["PASSWORD_CHANGED", "MFA_ENABLED", "MFA_DISABLED"]),
  occurredAt: isoDateTimeSchema,
  readAt: isoDateTimeSchema.nullable(),
  actor: z.null(),
  category: z.null(),
});

const organizationNotificationItemSchema = z.object({
  id: notificationItemIdSchema,
  scope: z.literal("organization"),
  organizationId: organizationIdSchema,
  eventType: z.literal("ORG-NOTIFICATION-SETTINGS-CHANGED"),
  occurredAt: isoDateTimeSchema,
  readAt: isoDateTimeSchema.nullable(),
  actor: z.object({ displayName: z.string().min(1) }),
  category: z.literal("notification-settings"),
});

/** A recipient inbox item, discriminated by its account or organization scope. */
export const notificationItemSchema = z.discriminatedUnion("scope", [
  accountNotificationItemSchema,
  organizationNotificationItemSchema,
]);

export type NotificationItem = z.infer<typeof notificationItemSchema>;

export const notificationDetailSchema = notificationItemSchema;
export type NotificationDetail = z.infer<typeof notificationDetailSchema>;

/**
 * `organizationId` is the scope the server resolved for this response (null
 * for personal-only). Organization selection is account-global, so a client
 * must discard a response whose scope differs from the one it expected.
 */
export const notificationListResponseSchema = z.object({
  items: z.array(notificationItemSchema),
  nextCursor: z.string().min(1).nullable(),
  unreadCount: z.number().int().min(0),
  organizationId: organizationIdSchema.nullable(),
});

export type NotificationListResponse = z.infer<
  typeof notificationListResponseSchema
>;

export const notificationCountResponseSchema = z.object({
  unreadCount: z.number().int().min(0),
  organizationId: organizationIdSchema.nullable(),
});

export type NotificationCountResponse = z.infer<
  typeof notificationCountResponseSchema
>;

export const markReadResponseSchema = z.object({
  id: notificationItemIdSchema,
  readAt: isoDateTimeSchema,
});

export type MarkReadResponse = z.infer<typeof markReadResponseSchema>;

/** Mark-all applies only if the server still resolves the expected scope. */
export const markAllReadRequestSchema = z.object({
  expectedOrganizationId: organizationIdSchema.nullable(),
});

export type MarkAllReadRequest = z.infer<typeof markAllReadRequestSchema>;

export const markAllReadResponseSchema = z.object({
  markedCount: z.number().int().min(0),
});

export type MarkAllReadResponse = z.infer<typeof markAllReadResponseSchema>;

export const organizationNotificationSettingsSchema = z.object({
  organizationId: organizationIdSchema,
  settingsChangedEnabled: z.boolean(),
  version: z.number().int().min(0),
});

export type OrganizationNotificationSettings = z.infer<
  typeof organizationNotificationSettingsSchema
>;

export const notificationSettingsUpdateSchema = z.object({
  settingsChangedEnabled: z.boolean(),
  expectedVersion: z.number().int().min(0),
});

export type NotificationSettingsUpdate = z.infer<
  typeof notificationSettingsUpdateSchema
>;

export const notificationItemParamsSchema = z.object({
  id: notificationItemIdSchema,
});

export const notificationSettingsParamsSchema = z.object({
  organizationId: organizationIdSchema,
});

export const notificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(2048).optional(),
});

function errorResponseForCodes<Codes extends readonly [string, ...string[]]>(
  codes: Codes,
) {
  return z.object({
    error: z.object({
      code: z.enum(codes),
      message: z.string().min(1),
      details: z.unknown().optional(),
    }),
  });
}

export const invalidInputErrorResponseSchema = errorResponseForCodes([
  "INVALID_INPUT",
]);
export const invalidCursorErrorResponseSchema = errorResponseForCodes([
  "INVALID_CURSOR",
]);
export const unauthenticatedErrorResponseSchema = errorResponseForCodes([
  "UNAUTHENTICATED",
]);
export const emailNotVerifiedErrorResponseSchema = errorResponseForCodes([
  "EMAIL_NOT_VERIFIED",
]);
export const membershipDeniedErrorResponseSchema = errorResponseForCodes([
  "MEMBERSHIP_DENIED",
]);
export const permissionDeniedErrorResponseSchema = errorResponseForCodes([
  "PERMISSION_DENIED",
]);
export const notificationNotFoundErrorResponseSchema = errorResponseForCodes([
  "NOTIFICATION_NOT_FOUND",
]);
export const settingsVersionConflictErrorResponseSchema = errorResponseForCodes(
  ["SETTINGS_VERSION_CONFLICT"],
);
export const inboxScopeChangedErrorResponseSchema = errorResponseForCodes([
  "INBOX_SCOPE_CHANGED",
]);

export const notificationStatusErrorResponseSchemas = {
  400: z.union([
    invalidInputErrorResponseSchema,
    invalidCursorErrorResponseSchema,
  ]),
  401: unauthenticatedErrorResponseSchema,
  403: z.union([
    emailNotVerifiedErrorResponseSchema,
    membershipDeniedErrorResponseSchema,
    permissionDeniedErrorResponseSchema,
  ]),
  404: notificationNotFoundErrorResponseSchema,
  409: settingsVersionConflictErrorResponseSchema,
} as const;

export type NotificationStatusErrorResponse<
  Status extends keyof typeof notificationStatusErrorResponseSchemas,
> = z.infer<(typeof notificationStatusErrorResponseSchemas)[Status]>;
