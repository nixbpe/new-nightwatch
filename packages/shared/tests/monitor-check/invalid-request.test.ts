import { describe, expect, it, vi } from "vitest";

import type * as outbound from "../../src/outbound-http";
import { sendOutboundRequest } from "../../src/outbound-http";
import { runCheck } from "../../src/monitor-check";
import { configFor, first } from "./fixtures";

vi.mock("../../src/outbound-http", async (importOriginal) => ({
  ...(await importOriginal<typeof outbound>()),
  sendOutboundRequest: vi.fn(),
}));

describe("invalid_request from the outbound helper", () => {
  it("is executor_error, a check_error with every assertion not evaluated", async () => {
    vi.mocked(sendOutboundRequest).mockResolvedValue({
      ok: false,
      failure: { reason: "invalid_request", message: "Request is not allowed" },
    });
    const result = await runCheck(
      configFor("http", 8080, {
        assertions: [{ kind: "bodyContains", text: "x" }],
      }),
      {},
    );
    expect(result).toMatchObject({
      outcome: "check_error",
      failureReason: "executor_error",
    });
    expect(first(result.assertions)).toMatchObject({
      status: "not_evaluated",
      reason: "no_response",
    });
  });
});
