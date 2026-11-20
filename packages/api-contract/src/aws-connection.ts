import { z } from "zod";

// Browser-safe on purpose (PKG-01): zod only. The web form validates the Role
// ARN with the same schema the API parses requests with.

/** `arn:aws:iam::<12 digits>:role/<optional path/><name>` (F-013 AC-05). */
export const AWS_ROLE_ARN_PATTERN =
  /^arn:aws:iam::(\d{12}):role\/(?:[\w+=,.@-]+\/)*[\w+=,.@-]{1,64}$/;

export const awsRoleArnSchema = z
  .string()
  .max(2048)
  .regex(AWS_ROLE_ARN_PATTERN);

/** The account a valid Role ARN names. */
export function awsRoleArnAccountId(roleArn: string): string {
  const account = AWS_ROLE_ARN_PATTERN.exec(roleArn)?.[1];
  if (account === undefined) throw new Error("not an IAM role ARN");
  return account;
}

/**
 * Why a connection test failed. Fixed codes only: raw AWS messages never reach
 * the client, a log or the audit log. `AWS_ACCOUNT_MISMATCH`: STS answered for
 * another account than the one the Role ARN names.
 */
export const AWS_TEST_FAILURE_CODES = [
  "AWS_ACCESS_DENIED",
  "AWS_REGION_DISABLED",
  "AWS_TIMEOUT",
  "AWS_UNKNOWN",
  "AWS_ACCOUNT_MISMATCH",
] as const;
export type AwsTestFailureCode = (typeof AWS_TEST_FAILURE_CODES)[number];
export const awsTestFailureCodeSchema = z.enum(AWS_TEST_FAILURE_CODES);

const revisionSchema = z.number().int().min(0);
const isoDateTime = z.iso.datetime({ offset: true });

export const organizationAwsConnectionParamsSchema = z.object({
  organizationId: z.uuid(),
});

/** Body of `POST .../aws-connection/test` and `PUT .../aws-connection`. */
export const organizationAwsConnectionRequestSchema = z.strictObject({
  roleArn: awsRoleArnSchema,
  /** The `revision` the form was loaded with. */
  revision: revisionSchema,
});
export type OrganizationAwsConnectionRequest = z.infer<
  typeof organizationAwsConnectionRequestSchema
>;

export const organizationAwsConnectionDeleteQuerySchema = z.object({
  revision: z.coerce.number().int().min(0),
});
export type OrganizationAwsConnectionDeleteQuery = z.infer<
  typeof organizationAwsConnectionDeleteQuerySchema
>;

export const awsLastTestSchema = z.object({
  result: z.enum(["passed", "failed"]),
  code: awsTestFailureCodeSchema.nullable(),
  testedAt: isoDateTime,
});
export type AwsLastTest = z.infer<typeof awsLastTestSchema>;

/**
 * A Project that connects through the Organization account. `stale`: its last
 * result was recorded against an earlier or disconnected Organization
 * connection and is history only; `lastTest` still carries it.
 */
export const organizationAwsProjectSchema = z.object({
  projectId: z.uuid(),
  projectName: z.string(),
  roleArn: z.string(),
  accountId: z.string(),
  lastTest: awsLastTestSchema.nullable(),
  status: z.enum(["passed", "failed", "untested", "stale"]),
});
export type OrganizationAwsProject = z.infer<
  typeof organizationAwsProjectSchema
>;

export const organizationAwsConnectionSchema = z.object({
  roleArn: z.string(),
  accountId: z.string(),
  /** The identity STS returned when the saved value was tested. */
  verifiedArn: z.string(),
  testedAt: isoDateTime,
  updatedAt: isoDateTime,
  /** `null` once the user who saved it is no longer a member. */
  updatedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type OrganizationAwsConnection = z.infer<
  typeof organizationAwsConnectionSchema
>;

export const organizationAwsConnectionResponseSchema = z.object({
  externalId: z.string(),
  /** NightWatch's principal for the trust policy; `null` when not configured (AC-02). */
  principalArn: z.string().nullable(),
  revision: revisionSchema,
  connection: organizationAwsConnectionSchema.nullable(),
  /** Assume-role Projects only; access-key Projects are not affected. */
  projects: z.array(organizationAwsProjectSchema),
});
export type OrganizationAwsConnectionResponse = z.infer<
  typeof organizationAwsConnectionResponseSchema
>;

/** A test result. It never changes what is saved. */
export const organizationAwsConnectionTestResponseSchema = z.discriminatedUnion(
  "result",
  [
    z.object({
      result: z.literal("passed"),
      accountId: z.string(),
      arn: z.string(),
    }),
    z.object({ result: z.literal("failed"), code: awsTestFailureCodeSchema }),
  ],
);
export type OrganizationAwsConnectionTestResponse = z.infer<
  typeof organizationAwsConnectionTestResponseSchema
>;

function awsErrorSchema<Code extends string, Details extends z.ZodType>(
  code: Code,
  details: Details,
) {
  return z.object({
    error: z.object({
      code: z.literal(code),
      message: z.string().min(1),
      details,
    }),
  });
}

export const awsRoleArnInvalidErrorResponseSchema = awsErrorSchema(
  "AWS_ROLE_ARN_INVALID",
  z.object({ field: z.literal("roleArn") }),
);
export const awsConnectionRevisionConflictErrorResponseSchema = awsErrorSchema(
  "AWS_CONNECTION_REVISION_CONFLICT",
  z.object({ currentRevision: revisionSchema }),
);
/** PUT only: the server's own test failed, so nothing was saved. */
export const awsConnectionTestFailedErrorResponseSchema = awsErrorSchema(
  "AWS_CONNECTION_TEST_FAILED",
  z.object({ code: awsTestFailureCodeSchema }),
);
export const awsTestRateLimitedErrorResponseSchema = awsErrorSchema(
  "AWS_TEST_RATE_LIMITED",
  z.object({ retryAfterSeconds: z.number().int().min(1) }),
);
