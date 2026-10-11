import { describe, expect, it } from "vitest";

import {
  assertProjectAccess,
  projectAccessOf,
  type ProjectAccess,
  type ProjectAction,
} from "./access";

type Outcome = "allowed" | "PERMISSION_DENIED" | "PROJECT_NOT_FOUND";

function outcome(access: ProjectAccess, action: ProjectAction): Outcome {
  try {
    assertProjectAccess(access, action);
    return "allowed";
  } catch (error) {
    return (error as { code: Outcome }).code;
  }
}

const table: [string, ProjectAccess, Record<ProjectAction, Outcome>][] = [
  [
    "org-admin",
    { kind: "org-admin" },
    {
      "project.read": "allowed",
      "project.update": "allowed",
      "project.delete": "allowed",
      "project.members.manage": "allowed",
    },
  ],
  [
    "member/admin",
    { kind: "member", role: "admin" },
    {
      "project.read": "allowed",
      "project.update": "allowed",
      "project.delete": "PERMISSION_DENIED",
      "project.members.manage": "allowed",
    },
  ],
  [
    "member/member",
    { kind: "member", role: "member" },
    {
      "project.read": "allowed",
      "project.update": "PERMISSION_DENIED",
      "project.delete": "PERMISSION_DENIED",
      "project.members.manage": "PERMISSION_DENIED",
    },
  ],
  [
    "none",
    { kind: "none" },
    {
      "project.read": "PROJECT_NOT_FOUND",
      "project.update": "PROJECT_NOT_FOUND",
      "project.delete": "PROJECT_NOT_FOUND",
      "project.members.manage": "PROJECT_NOT_FOUND",
    },
  ],
];

describe("assertProjectAccess", () => {
  it.each(table)("%s", (_name, access, expected) => {
    for (const action of Object.keys(expected) as ProjectAction[]) {
      expect(outcome(access, action), action).toBe(expected[action]);
    }
  });
});

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
