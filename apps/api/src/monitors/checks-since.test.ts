import { MONITOR_RETENTION_DAYS } from "@nightwatch/api-contract";
import { describe, expect, it } from "vitest";

import { checksSinceFloor } from "./read-service";

const NOW = new Date("2026-09-30T08:00:00.000Z");
const DAY_MS = 86_400_000;

describe("checksSinceFloor", () => {
  it("leaves the list unbounded without a since", () => {
    expect(checksSinceFloor(undefined, NOW)).toBeNull();
  });

  it("keeps a since inside the retention window", () => {
    expect(checksSinceFloor("2026-09-29T08:00:00.000Z", NOW)).toEqual(
      new Date("2026-09-29T08:00:00.000Z"),
    );
  });

  it("raises an older since to the start of the retention window", () => {
    expect(checksSinceFloor("2020-01-01T00:00:00.000Z", NOW)).toEqual(
      new Date(NOW.getTime() - MONITOR_RETENTION_DAYS * DAY_MS),
    );
  });

  it("keeps a since in the future, which matches no result", () => {
    expect(checksSinceFloor("2026-10-01T00:00:00.000Z", NOW)).toEqual(
      new Date("2026-10-01T00:00:00.000Z"),
    );
  });
});
