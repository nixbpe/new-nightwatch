import { awsRoleArnSchema } from "@nightwatch/api-contract";
import { describe, expect, it } from "vitest";

import {
  permissionPolicy,
  TARGET_ROLE_PLACEHOLDER,
  trustPolicy,
} from "./policies";

const A = "arn:aws:iam::444455556666:role/NightWatchReadOnly";
const B = "arn:aws:iam::777788889999:role/path/Other";

type Policy = { Statement: { Resource: string[] }[] };

describe("permissionPolicy", () => {
  it("names each distinct, valid Role ARN once and nothing else", () => {
    const parsed = JSON.parse(
      permissionPolicy([A, B, A, "arn:aws:iam::*:role/Any", "not an arn"]),
    ) as Policy;
    expect(parsed.Statement[0]?.Resource).toEqual([A, B]);
    for (const arn of parsed.Statement[0]?.Resource ?? []) {
      expect(awsRoleArnSchema.safeParse(arn).success).toBe(true);
    }
  });

  it("falls back to a placeholder that is not a valid ARN, never a wildcard account", () => {
    const text = permissionPolicy([]);
    const parsed = JSON.parse(text) as Policy;
    expect(parsed.Statement[0]?.Resource).toEqual([TARGET_ROLE_PLACEHOLDER]);
    expect(awsRoleArnSchema.safeParse(TARGET_ROLE_PLACEHOLDER).success).toBe(
      false,
    );
    expect(text).not.toContain("*");
  });
});

describe("trustPolicy", () => {
  it("binds the principal and the External ID", () => {
    const parsed = JSON.parse(trustPolicy("arn:aws:iam::1:role/P", "ext")) as {
      Statement: {
        Principal: { AWS: string };
        Condition: { StringEquals: Record<string, string> };
      }[];
    };
    expect(parsed.Statement[0]?.Principal.AWS).toBe("arn:aws:iam::1:role/P");
    expect(parsed.Statement[0]?.Condition.StringEquals["sts:ExternalId"]).toBe(
      "ext",
    );
  });
});
