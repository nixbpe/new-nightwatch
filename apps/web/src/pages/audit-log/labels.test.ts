import { describe, expect, it } from "vitest";

import { CHANGE_FIELD_LABELS, targetText } from "./labels";

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

  it("says the Project was deleted once it is gone", () => {
    expect(
      targetText({
        type: "project",
        projectId,
        displayName: null,
        deleted: true,
      }),
    ).toBe("ถูกลบแล้ว");
  });
});

describe("shared change field labels", () => {
  it("labels name without naming a monitor, and labels description", () => {
    expect(CHANGE_FIELD_LABELS.name).toBe("ชื่อ");
    expect(CHANGE_FIELD_LABELS.description).toBe("คำอธิบาย");
  });
});
