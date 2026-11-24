import { awsRoleArnSchema } from "@nightwatch/api-contract";

// Customers paste these into the AWS console. Every value is a live one from
// the API or a visible placeholder that IAM rejects; never a wildcard account.

export function trustPolicy(principalArn: string, externalId: string): string {
  return JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: principalArn },
          Action: "sts:AssumeRole",
          Condition: { StringEquals: { "sts:ExternalId": externalId } },
        },
      ],
    },
    null,
    2,
  );
}

/** Not an IAM ARN, so AWS refuses the policy until the customer names a real role. */
export const TARGET_ROLE_PLACEHOLDER =
  "arn:aws:iam::<TARGET_ACCOUNT_ID>:role/<TARGET_ROLE_NAME>";

/** Lets the hub role assume only the roles the Projects already use; with none, the Resource is the placeholder. */
export function permissionPolicy(projectRoleArns: readonly string[]): string {
  const arns = [...new Set(projectRoleArns)].filter(
    (arn) => awsRoleArnSchema.safeParse(arn).success,
  );
  return JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "sts:AssumeRole",
          Resource: arns.length === 0 ? [TARGET_ROLE_PLACEHOLDER] : arns,
        },
      ],
    },
    null,
    2,
  );
}
