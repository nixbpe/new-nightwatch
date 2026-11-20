import { describe, expect, it } from "vitest";

import { projectAccessOf } from "./access";

describe("projectAccessOf", () => {
  it.each(["owner", "admin"] as const)(
    "%s outranks the Project role",
    (role) => {
      expect(projectAccessOf(role, "member")).toEqual({ kind: "org-admin" });
      expect(projectAccessOf(role, null)).toEqual({ kind: "org-admin" });
    },
  );

  it.each(["viewer", "auditor"] as const)(
    "%s follows the Project role",
    (role) => {
      expect(projectAccessOf(role, "admin")).toEqual({
        kind: "member",
        role: "admin",
      });
      expect(projectAccessOf(role, null)).toEqual({ kind: "none" });
    },
  );
});
