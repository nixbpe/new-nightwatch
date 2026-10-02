import { z } from "zod";

import { organizationRoleSchema } from "./auth";

// Browser-safe on purpose (PKG-01): zod only. The API uses the labels for
// search and the export file, the web for display (F-007).

export const AUDIT_CATEGORIES = [
  "monitor",
  "notification_settings",
  "member",
  "invitation",
  "audit_log",
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
export const auditCategorySchema = z.enum(AUDIT_CATEGORIES);

export const AUDIT_ACTIONS = [
  "organization.monitor.create",
  "organization.monitor.update",
  "organization.monitor.pause",
  "organization.monitor.resume",
  "organization.monitor.delete",
  "organization.monitor.secret.set",
  "organization.monitor.secret.replace",
  "organization.notification-settings.monitor-alerts.update",
  "organization.notification-settings.update",
  "organization.member.role.update",
  "organization.member.revoke",
  "organization.member.leave",
  "organization.invitation.create",
  "organization.invitation.resend",
  "organization.invitation.cancel",
  "organization.audit-log.export",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const auditActionSchema = z.enum(AUDIT_ACTIONS);

// P-04: the labels of feature.md "Event inventory".
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "organization.monitor.create": "สร้างมอนิเตอร์",
  "organization.monitor.update": "แก้ไขมอนิเตอร์",
  "organization.monitor.pause": "หยุดมอนิเตอร์ชั่วคราว",
  "organization.monitor.resume": "เริ่มมอนิเตอร์ต่อ",
  "organization.monitor.delete": "ลบมอนิเตอร์",
  "organization.monitor.secret.set": "ตั้งค่าลับของมอนิเตอร์",
  "organization.monitor.secret.replace": "แทนที่ค่าลับของมอนิเตอร์",
  "organization.notification-settings.monitor-alerts.update":
    "เปลี่ยนการแจ้งเตือนมอนิเตอร์",
  "organization.notification-settings.update": "เปลี่ยนการตั้งค่าการแจ้งเตือน",
  "organization.member.role.update": "เปลี่ยนบทบาทสมาชิก",
  "organization.member.revoke": "ถอนสมาชิก",
  "organization.member.leave": "ออกจากองค์กร",
  "organization.invitation.create": "สร้างคำเชิญ",
  "organization.invitation.resend": "ส่งคำเชิญซ้ำ",
  "organization.invitation.cancel": "ยกเลิกคำเชิญ",
  "organization.audit-log.export": "ขอส่งออกบันทึกกิจกรรม",
};

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  monitor: "มอนิเตอร์",
  notification_settings: "ตั้งค่าการแจ้งเตือน",
  member: "สมาชิก",
  invitation: "คำเชิญ",
  audit_log: "บันทึกกิจกรรม",
};

export const AUDIT_LIST_MAX_LIMIT = 50;
export const AUDIT_SEARCH_MAX_LENGTH = 100;

export const AUDIT_CHANGE_FIELDS = [
  "role",
  "monitorAlertsEnabled",
  "settingsChangedEnabled",
  "name",
  "url",
  "method",
  "intervalSeconds",
  "timeoutSeconds",
  "header",
  "queryParam",
  "body",
  "authType",
  "apiKeyHeaderName",
  "expectedStatus",
  "assertions",
  "secret",
] as const;
export type AuditChangeField = (typeof AUDIT_CHANGE_FIELDS)[number];

const membershipSchema = z.enum(["current", "former"]);

export const auditActorSchema = z.object({
  userId: z.string(),
  displayName: z.string().nullable(),
  roleAtTime: organizationRoleSchema,
  membership: membershipSchema,
});
export type AuditActor = z.infer<typeof auditActorSchema>;

export const auditActorOptionSchema = auditActorSchema.omit({
  roleAtTime: true,
});
export type AuditActorOption = z.infer<typeof auditActorOptionSchema>;

export const auditTargetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("monitor"),
    monitorId: z.uuid(),
    displayName: z.string().nullable(),
    deleted: z.boolean(),
  }),
  z.object({
    type: z.literal("member"),
    userId: z.string(),
    displayName: z.string().nullable(),
    membership: membershipSchema,
  }),
  z.object({
    type: z.literal("invitation"),
    publicId: z.uuid(),
    role: organizationRoleSchema,
  }),
  z.object({ type: z.literal("notification_settings") }),
  z.object({
    type: z.literal("audit_export"),
    exportId: z.uuid(),
    format: z.enum(["csv", "json"]),
  }),
]);
export type AuditTarget = z.infer<typeof auditTargetSchema>;

// `masked` renders as "•••", `secret_set` as "ตั้งค่าแล้ว", `changed` as "เปลี่ยนแล้ว".
//
// null is a value of the schemas below, but OpenAPI 3.0 cannot say "one of
// these, or null" the way the generator expects: `nullable` on a union becomes
// an empty `{nullable}` member, which the generated client types as `unknown`
// and which swallows the whole union. `meta` states the schema directly:
// the same members, with `nullable: true` beside them.
export const auditValueSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("value"),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]).meta({
      anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
      nullable: true,
    }),
  }),
  z.object({ kind: z.literal("masked") }),
  z.object({ kind: z.literal("secret_set") }),
  z.object({ kind: z.literal("changed") }),
]);
export type AuditValue = z.infer<typeof auditValueSchema>;

const auditNullableValueSchema = auditValueSchema.nullable().meta({
  oneOf: auditValueSchema.options.map((member) => {
    const schema: Record<string, unknown> = {
      ...z.toJSONSchema(member, { target: "openapi-3.0" }),
    };
    delete schema.$schema;
    return schema;
  }),
  nullable: true,
});

export const auditChangeSchema = z.object({
  field: z.enum(AUDIT_CHANGE_FIELDS),
  key: z.string().optional(),
  before: auditNullableValueSchema,
  after: auditNullableValueSchema,
});
export type AuditChange = z.infer<typeof auditChangeSchema>;

// ---- Requests --------------------------------------------------------------

export const auditLogOrganizationParamsSchema = z.object({
  organizationId: z.uuid(),
});

// Any string: a malformed id answers 404 like a missing one (AC-13), after the
// role check.
export const auditLogEventParamsSchema =
  auditLogOrganizationParamsSchema.extend({
    eventId: z.string().min(1).max(256),
  });

const isoDateTime = z.iso.datetime({ offset: true });

const categoriesQuerySchema = z
  .string()
  .transform((value) => value.split(","))
  .pipe(z.array(auditCategorySchema).min(1))
  .refine((list) => new Set(list).size === list.length, {
    message: "duplicate category",
  });

export const auditLogListQuerySchema = z
  .object({
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    categories: categoriesQuerySchema.optional(),
    actorUserId: z.string().min(1).max(128).optional(),
    q: z
      .string()
      .trim()
      .min(1)
      .max(AUDIT_SEARCH_MAX_LENGTH)
      // eslint-disable-next-line no-control-regex -- the point is to reject them
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value))
      .optional(),
    asOf: isoDateTime.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(AUDIT_LIST_MAX_LIMIT)
      .default(AUDIT_LIST_MAX_LIMIT),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      Date.parse(query.from) <= Date.parse(query.to),
    { message: "from is after to" },
  );
export type AuditLogListQuery = z.output<typeof auditLogListQuerySchema>;

// ---- Responses -------------------------------------------------------------

export const auditEventSummarySchema = z.object({
  id: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  category: auditCategorySchema,
  action: auditActionSchema,
  actor: auditActorSchema,
  target: auditTargetSchema,
});
export type AuditEventSummary = z.infer<typeof auditEventSummarySchema>;

export const auditLogListResponseSchema = z.object({
  organizationId: z.uuid(),
  asOf: z.iso.datetime({ offset: true }),
  retainedFrom: z.iso.datetime({ offset: true }),
  recordingStartedAt: z.iso.datetime({ offset: true }),
  events: z.array(auditEventSummarySchema),
  page: z.object({
    limit: z.number().int(),
    offset: z.number().int(),
    total: z.number().int(),
  }),
});
export type AuditLogListResponse = z.infer<typeof auditLogListResponseSchema>;

// Present only on `organization.audit-log.export`; the search text itself is
// never stored.
export const auditExportScopeSchema = z.object({
  format: z.enum(["csv", "json"]),
  from: z.string().nullable(),
  to: z.string().nullable(),
  categories: z.array(auditCategorySchema),
  actorUserId: z.string().nullable(),
  searchApplied: z.boolean(),
});
export type AuditExportScope = z.infer<typeof auditExportScopeSchema>;

export const auditEventDetailSchema = auditEventSummarySchema.extend({
  changes: z.array(auditChangeSchema),
  exportScope: auditExportScopeSchema.optional(),
});
export type AuditEventDetail = z.infer<typeof auditEventDetailSchema>;

export const auditLogEventResponseSchema = z.object({
  organizationId: z.uuid(),
  event: auditEventDetailSchema,
});
export type AuditLogEventResponse = z.infer<typeof auditLogEventResponseSchema>;

export const auditLogActorsResponseSchema = z.object({
  actors: z.array(auditActorOptionSchema),
});
export type AuditLogActorsResponse = z.infer<
  typeof auditLogActorsResponseSchema
>;

function auditErrorSchema<Code extends string>(code: Code) {
  return z.object({
    error: z.object({
      code: z.literal(code),
      message: z.string().min(1),
      details: z.unknown().optional(),
    }),
  });
}
export const auditValidationErrorResponseSchema =
  auditErrorSchema("VALIDATION_ERROR");
export const auditEventNotFoundErrorResponseSchema = auditErrorSchema(
  "AUDIT_EVENT_NOT_FOUND",
);

// ---- Export ----------------------------------------------------------------

export const AUDIT_EXPORT_MAX_EVENTS = 50_000;
export const AUDIT_EXPORT_MAX_BYTES = 25 * 1024 * 1024;
export const AUDIT_EXPORT_FILE_TTL_HOURS = 24;
export const AUDIT_EXPORT_LIST_MAX = 20;

export const AUDIT_EXPORT_FAILURE_CODES = [
  "EXPORT_TOO_LARGE",
  "EXPORT_FAILED",
  "REQUESTER_NOT_AUTHORIZED",
] as const;
export type AuditExportFailureCode =
  (typeof AUDIT_EXPORT_FAILURE_CODES)[number];

const auditExportTimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (timeZone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Invalid IANA time zone." },
  );

const auditSearchTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(AUDIT_SEARCH_MAX_LENGTH)
  // eslint-disable-next-line no-control-regex -- the point is to reject them
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

const auditExportFiltersInputSchema = z.object({
  from: isoDateTime,
  to: isoDateTime,
  categories: z
    .array(auditCategorySchema)
    .max(AUDIT_CATEGORIES.length)
    .optional(),
  actorUserId: z.string().min(1).max(128).optional(),
  q: auditSearchTextSchema.optional(),
});

export const auditExportRequestSchema = z
  .object({
    format: z.enum(["csv", "json"]),
    timeZone: auditExportTimeZoneSchema,
    filters: auditExportFiltersInputSchema,
    asOf: isoDateTime,
  })
  .refine(
    (body) => Date.parse(body.filters.from) <= Date.parse(body.filters.to),
    { message: "from is after to" },
  );
export type AuditExportRequest = z.output<typeof auditExportRequestSchema>;

export const auditExportParamsSchema = auditLogOrganizationParamsSchema.extend({
  exportId: z.string().min(1).max(256),
});

/** The requester's own filters, `q` included, so a retry can reuse them. */
export const auditExportRecordSchema = z.object({
  id: z.uuid(),
  format: z.enum(["csv", "json"]),
  status: z.enum(["generating", "ready", "failed", "expired"]),
  filters: z.object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    categories: z.array(auditCategorySchema),
    actorUserId: z.string().nullable(),
    q: z.string().nullable(),
  }),
  timeZone: z.string(),
  requestedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  rowCount: z.number().int().nullable(),
  failureCode: z.enum(AUDIT_EXPORT_FAILURE_CODES).nullable(),
});
export type AuditExportRecord = z.infer<typeof auditExportRecordSchema>;

export const auditExportCreateResponseSchema = z.object({
  export: auditExportRecordSchema,
});
export type AuditExportCreateResponse = z.infer<
  typeof auditExportCreateResponseSchema
>;

export const auditExportListResponseSchema = z.object({
  exports: z.array(auditExportRecordSchema),
  inProgress: z.boolean(),
});
export type AuditExportListResponse = z.infer<
  typeof auditExportListResponseSchema
>;

export const auditExportEmptyErrorResponseSchema =
  auditErrorSchema("AUDIT_EXPORT_EMPTY");
export const auditExportTooLargeErrorResponseSchema = z.object({
  error: z.object({
    code: z.literal("AUDIT_EXPORT_TOO_LARGE"),
    message: z.string().min(1),
    details: z.object({ limit: z.number().int(), total: z.number().int() }),
  }),
});
export const auditExportInProgressErrorResponseSchema = auditErrorSchema(
  "AUDIT_EXPORT_IN_PROGRESS",
);
export const auditExportNotFoundErrorResponseSchema = auditErrorSchema(
  "AUDIT_EXPORT_NOT_FOUND",
);
export const auditExportNotReadyErrorResponseSchema = auditErrorSchema(
  "AUDIT_EXPORT_NOT_READY",
);
export const auditExportExpiredErrorResponseSchema = auditErrorSchema(
  "AUDIT_EXPORT_EXPIRED",
);

/** The note on the page, in the export dialog and in every file (feature.md, step 3). */
export function auditScopeNote(recordingStartedOn: string): string {
  return `บันทึกเฉพาะการกระทำที่สำเร็จในหมวด มอนิเตอร์ ตั้งค่าการแจ้งเตือน สมาชิก คำเชิญ และบันทึกกิจกรรม ตั้งแต่ ${recordingStartedOn} ไม่รวมการกระทำที่ถูกปฏิเสธ การตอบรับคำเชิญ (สมาชิกเข้าร่วม) กิจกรรมระดับบัญชี (เข้าสู่ระบบ รหัสผ่าน MFA) และกิจกรรมของ AWS account, API key และ findings`;
}
