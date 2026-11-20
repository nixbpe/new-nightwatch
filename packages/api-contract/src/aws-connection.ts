import { z } from "zod";

export const awsRoleArnSchema = z
  .string()
  .max(512)
  .regex(/^arn:aws:iam::[0-9]{12}:role\/[A-Za-z0-9+=,.@_/-]+$/);
const accountId = z.string().regex(/^\d{12}$/);
const testAt = z.iso.datetime();
export const awsOrganizationInputSchema = z
  .object({ roleArn: awsRoleArnSchema })
  .strict();

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

export const awsProjectRoleInputSchema = awsOrganizationInputSchema.extend({
  method: z.literal("assume_role"),
});
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
