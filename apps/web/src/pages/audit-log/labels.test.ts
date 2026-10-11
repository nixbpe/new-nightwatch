import { describe, expect, it } from "vitest";

import { targetText } from "./labels";

const projectId = crypto.randomUUID();

describe("targetText for a Project", () => {
  it("shows the current name while the Project exists", () => {
    expect(
      targetText({
        type: "project",
        projectId,
        displayName: "Payments",
        deleted: false,
      }),
    ).toBe("Payments");
  });

  it("marks a deleted Project the same way as a deleted monitor, never by its old name", () => {
    const deletedMonitor = targetText({
      type: "monitor",
      monitorId: crypto.randomUUID(),
      displayName: null,
      deleted: true,
    });
    expect(deletedMonitor).toMatch(/\S/);
    expect(
      targetText({
        type: "project",
        projectId,
        displayName: "Payments",
        deleted: true,
      }),
    ).toBe(deletedMonitor);
    expect(
      targetText({
        type: "project",
        projectId,
        displayName: null,
        deleted: false,
      }),
    ).toBe(deletedMonitor);
  });
});

describe("targetText for a Project member", () => {
  const member = {
    type: "member" as const,
    userId: "u1",
    displayName: "Somchai",
    membership: "current" as const,
  };

  it("names both the member and the Project", () => {
    expect(
      targetText({
        ...member,
        project: { projectId, displayName: "Payments", deleted: false },
      }),
    ).toBe("Somchai ในโปรเจกต์ Payments");
  });

  it("never shows a former member's name or a deleted Project's name", () => {
    expect(
      targetText({
        ...member,
        membership: "former",
        project: { projectId, displayName: null, deleted: true },
      }),
    ).toBe("ไม่ใช่สมาชิกแล้ว ในโปรเจกต์ ถูกลบแล้ว");
  });

  it("keeps the Organization member target unchanged", () => {
    expect(targetText(member)).toBe("Somchai");
  });
});
