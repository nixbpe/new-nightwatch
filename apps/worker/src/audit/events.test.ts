import type { AuditEventBatchRow } from "@nightwatch/db";
import { describe, expect, it } from "vitest";

import { readEventBatch, type TenantClient } from "./events";

function row(overrides: Partial<AuditEventBatchRow>): AuditEventBatchRow {
  return {
    id: crypto.randomUUID(),
    occurredAtUtc: "2026-10-11T00:00:00.000Z",
    cursorAt: "2026-10-11 00:00:00+00",
    actorUserId: "actor",
    actorRole: "admin",
    category: "project",
    action: "organization.project.update",
    targetType: "project",
    targetId: crypto.randomUUID(),
    targetAttributes: {},
    changes: [],
    actorName: "Actor",
    actorCurrent: true,
    targetName: "Payments",
    targetCurrent: false,
    monitorExists: false,
    projectExists: true,
    targetProjectName: null,
    targetProjectExists: false,
    ...overrides,
  };
}

async function targetsOf(rows: AuditEventBatchRow[]): Promise<string[]> {
  const client = {
    query: () => Promise.resolve({ rows }),
  } as unknown as TenantClient;
  const batch = await readEventBatch(client, {
    tenantId: crypto.randomUUID(),
    filters: { from: "2026-01-01", to: "2026-12-31" },
    retainedFrom: new Date("2026-01-01"),
    snapshotAt: new Date("2026-12-31"),
    cursor: null,
  });
  return batch.events.map((event) => event.target);
}

describe("export target of a Project event (AC-09)", () => {
  it("names the Project while it exists and says it was deleted after", async () => {
    expect(
      await targetsOf([
        row({ projectExists: true }),
        row({ projectExists: false, targetName: null }),
      ]),
    ).toEqual(["Payments", "ถูกลบแล้ว"]);
  });

  it("does not fall back to the notification settings label", async () => {
    const [target] = await targetsOf([row({})]);
    expect(target).not.toBe("การตั้งค่าการแจ้งเตือน");
  });
});

describe("export target of a monitor event (AC-09)", () => {
  const monitor = {
    targetType: "monitor",
    action: "organization.monitor.pause",
    category: "monitor",
    targetName: "Checkout",
    monitorExists: true,
    targetProjectName: "Payments",
    targetProjectExists: true,
    targetAttributes: { projectId: crypto.randomUUID() },
  } as const;

  it("names the monitor and its Project, hides what was deleted, and leaves an event without a Project as it was", async () => {
    expect(
      await targetsOf([
        row(monitor),
        row({ ...monitor, targetProjectExists: false }),
        row({ ...monitor, monitorExists: false }),
        row({ ...monitor, targetAttributes: {} }),
      ]),
    ).toEqual([
      "Checkout ในโปรเจกต์ Payments",
      "Checkout ในโปรเจกต์ ถูกลบแล้ว",
      "ถูกลบแล้ว ในโปรเจกต์ Payments",
      "Checkout",
    ]);
  });
});

describe("export target of a Project member event", () => {
  const member = {
    targetType: "member",
    action: "organization.project.member.add",
    targetAttributes: { projectId: crypto.randomUUID() },
    targetName: "Somchai",
    targetCurrent: true,
    targetProjectName: "Payments",
    targetProjectExists: true,
  } as const;

  it("names the member and the Project, and hides what no longer exists", async () => {
    expect(
      await targetsOf([
        row(member),
        row({
          ...member,
          targetCurrent: false,
          targetName: null,
          targetProjectExists: false,
          targetProjectName: null,
        }),
      ]),
    ).toEqual([
      "Somchai ในโปรเจกต์ Payments",
      "ไม่ใช่สมาชิกแล้ว ในโปรเจกต์ ถูกลบแล้ว",
    ]);
  });
});
