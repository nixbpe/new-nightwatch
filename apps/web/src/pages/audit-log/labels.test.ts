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
