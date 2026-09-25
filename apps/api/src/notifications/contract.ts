import { createRoute } from "@hono/zod-openapi";
import {
  emailNotVerifiedErrorResponseSchema,
  invalidInputErrorResponseSchema,
  markAllReadResponseSchema,
  markReadResponseSchema,
  notificationCountResponseSchema,
  notificationDetailSchema,
  notificationItemParamsSchema,
  notificationListQuerySchema,
  notificationListResponseSchema,
  notificationSettingsParamsSchema,
  notificationSettingsUpdateSchema,
  notificationStatusErrorResponseSchemas,
  organizationNotificationSettingsSchema,
  notificationNotFoundErrorResponseSchema,
  settingsVersionConflictErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@nightwatch/api-contract";

const invalidInputResponse = {
  description: "Invalid request input",
  content: {
    "application/json": { schema: invalidInputErrorResponseSchema },
  },
} as const;

const unauthenticatedResponse = {
  description: "No valid session",
  content: {
    "application/json": { schema: unauthenticatedErrorResponseSchema },
  },
} as const;

const emailNotVerifiedResponse = {
  description: "Email is not verified",
  content: {
    "application/json": { schema: emailNotVerifiedErrorResponseSchema },
  },
} as const;

const notificationItemNotFoundResponse = {
  description: "Notification item is not visible or no longer exists",
  content: {
    "application/json": { schema: notificationNotFoundErrorResponseSchema },
  },
} as const;

const settingsVersionConflictResponse = {
  description: "The settings version is stale",
  content: {
    "application/json": { schema: settingsVersionConflictErrorResponseSchema },
  },
} as const;

const inboxErrorResponses = {
  401: unauthenticatedResponse,
  403: emailNotVerifiedResponse,
} as const;

const notificationItemErrorResponses = {
  400: invalidInputResponse,
  ...inboxErrorResponses,
  404: notificationItemNotFoundResponse,
} as const;

const notificationSettingsErrorResponses = {
  400: invalidInputResponse,
  401: unauthenticatedResponse,
  403: {
    description:
      "Email is unverified, membership is denied, or permission is denied",
    content: {
      "application/json": {
        schema: notificationStatusErrorResponseSchemas[403],
      },
    },
  },
  409: settingsVersionConflictResponse,
} as const;

const notificationSettingsReadErrorResponses = {
  400: invalidInputResponse,
  401: unauthenticatedResponse,
  403: notificationSettingsErrorResponses[403],
} as const;
/**
 * `notification-api/1` route declarations. The notifications domain owns
 * handler registration; this module deliberately contains no business logic.
 */
export const notificationRouteDeclarations = {
  list: createRoute({
    method: "get",
    path: "/api/notifications",
    tags: ["notifications"],
    summary: "List visible notification inbox items",
    request: { query: notificationListQuerySchema },
    responses: {
      200: {
        description: "Visible personal and active-organization items",
        content: {
          "application/json": { schema: notificationListResponseSchema },
        },
      },
      400: {
        description: "Invalid request input or cursor",
        content: {
          "application/json": {
            schema: notificationStatusErrorResponseSchemas[400],
          },
        },
      },
      ...inboxErrorResponses,
    },
  }),
  unreadCount: createRoute({
    method: "get",
    path: "/api/notifications/unread-count",
    tags: ["notifications"],
    summary: "Count unread visible notification inbox items",
    responses: {
      200: {
        description: "Unread count for visible notification scope",
        content: {
          "application/json": { schema: notificationCountResponseSchema },
        },
      },
      ...inboxErrorResponses,
    },
  }),
  open: createRoute({
    method: "post",
    path: "/api/notifications/{id}/open",
    tags: ["notifications"],
    summary: "Open a notification and atomically mark it read",
    request: { params: notificationItemParamsSchema },
    responses: {
      200: {
        description: "Opened notification detail",
        content: { "application/json": { schema: notificationDetailSchema } },
      },
      ...notificationItemErrorResponses,
    },
  }),
  markRead: createRoute({
    method: "patch",
    path: "/api/notifications/{id}/read",
    tags: ["notifications"],
    summary: "Mark a notification read",
    request: { params: notificationItemParamsSchema },
    responses: {
      200: {
        description: "The notification read transition",
        content: { "application/json": { schema: markReadResponseSchema } },
      },
      ...notificationItemErrorResponses,
    },
  }),
  markAllRead: createRoute({
    method: "post",
    path: "/api/notifications/read-all",
    tags: ["notifications"],
    summary: "Mark all currently visible notifications read",
    responses: {
      200: {
        description: "Count of items newly marked read",
        content: { "application/json": { schema: markAllReadResponseSchema } },
      },
      ...inboxErrorResponses,
    },
  }),
  getSettings: createRoute({
    method: "get",
    path: "/api/organizations/{organizationId}/notification-settings",
    tags: ["notification-settings"],
    summary: "Get organization notification settings",
    request: { params: notificationSettingsParamsSchema },
    responses: {
      200: {
        description: "Organization notification settings",
        content: {
          "application/json": {
            schema: organizationNotificationSettingsSchema,
          },
        },
      },
      ...notificationSettingsReadErrorResponses,
    },
  }),
  updateSettings: createRoute({
    method: "patch",
    path: "/api/organizations/{organizationId}/notification-settings",
    tags: ["notification-settings"],
    summary: "Update organization notification settings with compare-and-swap",
    request: {
      params: notificationSettingsParamsSchema,
      body: {
        content: {
          "application/json": { schema: notificationSettingsUpdateSchema },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Updated organization notification settings",
        content: {
          "application/json": {
            schema: organizationNotificationSettingsSchema,
          },
        },
      },
      ...notificationSettingsErrorResponses,
    },
  }),
} as const;

export type NotificationRouteDeclarations =
  typeof notificationRouteDeclarations;
