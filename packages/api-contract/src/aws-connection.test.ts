import { describe, expect, it } from "vitest";

import {
  awsRoleArnAccountId,
  awsRoleArnSchema,
  organizationAwsConnectionDeleteQuerySchema,
  organizationAwsConnectionRequestSchema,
} from "./aws-connection";

describe("Role ARN (F-013 AC-05)", () => {
  it.each([
    "arn:aws:iam::111122223333:role/NightWatchOrgHub",
    "arn:aws:iam::111122223333:role/path/to/Name+=,.@_-",
    `arn:aws:iam::111122223333:role/${"n".repeat(64)}`,
  ])("accepts %s", (value) => {
    expect(awsRoleArnSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    "",
    "arn:aws:iam::11112222333:role/x",
    "arn:aws:iam::111122223333:user/x",
    "arn:aws:iam::111122223333:role/",
    "arn:aws:iam::111122223333:role/a b",
    "arn:aws-cn:iam::111122223333:role/x",
    ` arn:aws:iam::111122223333:role/x`,
    `arn:aws:iam::111122223333:role/${"n".repeat(65)}`,
  ])("rejects %j", (value) => {
    expect(awsRoleArnSchema.safeParse(value).success).toBe(false);
  });

  it("names the ARN's account", () => {
    expect(awsRoleArnAccountId("arn:aws:iam::111122223333:role/x")).toBe(
      "111122223333",
    );
  });
});

describe("request shapes", () => {
  it("requires a revision and refuses extra fields", () => {
    const roleArn = "arn:aws:iam::111122223333:role/x";
    expect(
      organizationAwsConnectionRequestSchema.safeParse({ roleArn }).success,
    ).toBe(false);
    expect(
      organizationAwsConnectionRequestSchema.safeParse({
        roleArn,
        revision: 0,
        externalId: "client-chosen",
      }).success,
    ).toBe(false);
    expect(
      organizationAwsConnectionDeleteQuerySchema.parse({ revision: "3" }),
    ).toEqual({ revision: 3 });
  });
});
