import { z } from "zod";

export const awsRoleArnSchema = z
  .string()
  .max(512)
  .regex(/^arn:aws:iam::[0-9]{12}:role\/[A-Za-z0-9+=,.@_/-]+$/);
const accountId = z.string().regex(/^\d{12}$/);
const testAt = z.iso.datetime();
// `revision` is the settings revision the caller last read; a request made
// against an older one is refused with 409 instead of overwriting (AC-11).
export const awsOrganizationInputSchema = z
  .object({ roleArn: awsRoleArnSchema, revision: z.uuid() })
  .strict();
export const awsOrganizationDisconnectQuerySchema = z.object({
  revision: z.uuid(),
});

export const awsTestResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), accountId, arn: z.string() }),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      "AWS_ACCESS_DENIED",
      "AWS_ACCOUNT_MISMATCH",
      "AWS_REGION_DISABLED",
      "AWS_TIMEOUT",
      "AWS_UNKNOWN",
    ]),
  }),
]);

export const awsOrganizationSchema = z.object({
  revision: z.uuid(),
  roleArn: awsRoleArnSchema.nullable(),
  accountId: accountId.nullable(),
  lastTestAt: testAt.nullable(),
  externalId: z.string(),
  trustPolicy: z.string().nullable(),
  projects: z.array(
    z.object({
      projectId: z.uuid(),
      name: z.string(),
      accountId,
      roleArn: awsRoleArnSchema,
      lastTestAt: testAt,
      current: z.boolean(),
    }),
  ),
});
export type AwsOrganization = z.infer<typeof awsOrganizationSchema>;
export type AwsTestResult = z.infer<typeof awsTestResultSchema>;

const awsProjectRoleInputSchema = z
  .object({ roleArn: awsRoleArnSchema, method: z.literal("assume_role") })
  .strict();
export const awsProjectAccessKeySchema = z
  .object({
    method: z.literal("access_key"),
    accessKeyId: z.string().regex(/^[A-Z0-9]{16,128}$/),
    secretAccessKey: z
      .string()
      .min(16)
      .max(128)
      .regex(/^[A-Za-z0-9/+=]+$/),
    region: z
      .string()
      .max(32)
      .regex(/^[a-z]{2}(?:-[a-z]+)+-\d+$/),
  })
  .strict();
export const awsProjectInputSchema = z.discriminatedUnion("method", [
  awsProjectRoleInputSchema,
  awsProjectAccessKeySchema,
]);
export type AwsProjectInput = z.infer<typeof awsProjectInputSchema>;
export const awsProjectSchema = z.object({
  state: z.enum(["disconnected", "connected", "needs_retest"]),
  method: z.enum(["assume_role", "access_key"]).nullable(),
  accountId: accountId.nullable(),
  lastTestAt: testAt.nullable(),
  settings: z
    .object({
      hubConnected: z.boolean(),
      roleArn: awsRoleArnSchema.nullable(),
      region: z.string().nullable(),
      externalId: z.string(),
      trustPolicy: z.string().nullable(),
    })
    .optional(),
  secretSet: z.literal(true).optional(),
});
export type AwsProject = z.infer<typeof awsProjectSchema>;
