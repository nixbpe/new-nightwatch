import {
  auditChangeSchema,
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABELS,
} from "@nightwatch/api-contract";
import { describe, expect, it } from "vitest";

import { monitorAuditChanges } from "../monitors/audit";
import type { StoredConfig } from "../monitors/record";
import { AUDIT_ACTION_CATEGORIES } from "./record";

describe("audit contract and writer agree", () => {
  it("lists the same 16 actions, each with its category and a label", () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual(
      Object.keys(AUDIT_ACTION_CATEGORIES).sort(),
    );
    expect(AUDIT_ACTIONS).toHaveLength(16);
    for (const action of AUDIT_ACTIONS) {
      expect(AUDIT_CATEGORIES).toContain(AUDIT_ACTION_CATEGORIES[action]);
      expect(AUDIT_ACTION_LABELS[action].length).toBeGreaterThan(0);
    }
  });

  it("has a label for each of the 5 categories", () => {
    expect(AUDIT_CATEGORIES).toHaveLength(5);
    expect(Object.keys(AUDIT_CATEGORY_LABELS).sort()).toEqual(
      [...AUDIT_CATEGORIES].sort(),
    );
  });
});

describe("monitor changes fit the response schema", () => {
  it("parses every field monitorAuditChanges can emit", () => {
    const before: StoredConfig = {
      name: "a",
      url: "https://example.test/?k=1",
      method: "GET",
      intervalSeconds: 60,
      timeoutSeconds: 5,
      headers: [
        { name: "A", value: "1", secret: false },
        { id: "h1", name: "S", secret: true },
      ],
      queryParams: [{ name: "q", value: "1" }],
      bodyType: null,
      bodyContent: null,
      authType: "bearer",
      apiKeyHeaderName: null,
      expectedStatusText: "200",
      expectedStatusRanges: [{ from: 200, to: 200 }],
      assertions: [{ kind: "bodyContains", text: "x" }],
    };
    const after: StoredConfig = {
      ...before,
      name: "b",
      url: "https://example.test/?k=2",
      method: "POST",
      intervalSeconds: 300,
      timeoutSeconds: 10,
      headers: [
        { name: "A", value: "2", secret: false },
        { id: "h1", name: "S2", secret: true },
      ],
      queryParams: [{ name: "q", value: "2" }],
      bodyType: "text",
      bodyContent: "b",
      authType: "apiKey",
      apiKeyHeaderName: "X-K",
      expectedStatusText: "200-299",
      assertions: [{ kind: "responseTimeBelow", ms: 5 }],
    };
    const changes = monitorAuditChanges(before, after, {
      written: ["auth.apiKey", "header.h1"],
      stored: new Set(["header.h1", "auth.token"]),
      deleted: ["auth.token"],
    });
    const fields = new Set(changes.map((change) => change.field));
    expect(fields.size).toBeGreaterThanOrEqual(12);
    for (const change of changes) {
      expect(auditChangeSchema.safeParse(change).success, change.field).toBe(
        true,
      );
    }
  });
});
