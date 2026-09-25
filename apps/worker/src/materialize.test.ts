import { describe, expect, it, vi } from "vitest";

import {
  processMaterialization,
  type MaterializationDependencies,
  type MaterializeJobData,
} from "./materialize";

const job: MaterializeJobData = {
  dispatchId: "dispatch-1",
  claimToken: "claim-1",
  scope: { kind: "account", userId: "account-1" },
};

function dependencies(): MaterializationDependencies {
  return {
    resolveClaim: vi.fn().mockResolvedValue({
      intentId: "intent-1",
      scope: { kind: "account", userId: "account-1" },
    }),
    materializeAndComplete: vi.fn().mockResolvedValue(true),
  };
}

describe("processMaterialization", () => {
  it("does not materialize or acknowledge a job whose payload scope was forged", async () => {
    const deps = dependencies();

    await expect(
      processMaterialization(
        {
          ...job,
          scope: { kind: "account", userId: "another-account" },
        },
        deps,
      ),
    ).rejects.toThrow("does not match the committed dispatch claim");

    expect(deps.materializeAndComplete).not.toHaveBeenCalled();
  });
});
