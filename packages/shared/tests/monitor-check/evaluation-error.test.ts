import { afterEach, describe, expect, it, vi } from "vitest";

import { runCheck } from "../../src/monitor-check";
import * as assertions from "../../src/monitor-check/assertions";
import type { RawServer } from "../outbound-http/fixtures";
import { configFor, deps, serveReplies } from "./fixtures";

vi.mock("../../src/monitor-check/assertions", async (importOriginal) => {
  const original = await importOriginal<typeof assertions>();
  return {
    ...original,
    evaluateAssertions: vi.fn(original.evaluateAssertions),
  };
});

const servers: RawServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("an unexpected exception while evaluating a response", () => {
  it("returns a check_error with executor_error instead of rejecting", async () => {
    const actual = await vi.importActual<typeof assertions>(
      "../../src/monitor-check/assertions",
    );
    vi.mocked(assertions.evaluateAssertions).mockImplementation(
      (list, response, redact) => {
        if (response !== null) throw new Error("boom");
        return actual.evaluateAssertions(list, response, redact);
      },
    );
    const server = await serveReplies(() => ({ body: "ok" }));
    servers.push(server);
    const result = await runCheck(
      configFor("http", server.port, {
        assertions: [{ kind: "bodyContains", text: "ok" }],
      }),
      {},
      deps(),
    );
    expect(result).toMatchObject({
      outcome: "check_error",
      failureReason: "executor_error",
    });
    expect(result.assertions[0]).toMatchObject({
      status: "not_evaluated",
      reason: "no_response",
    });
  });
});

describe("a secret with a lone surrogate", () => {
  it("does not make runCheck reject", async () => {
    const actual = await vi.importActual<typeof assertions>(
      "../../src/monitor-check/assertions",
    );
    vi.mocked(assertions.evaluateAssertions).mockImplementation(
      actual.evaluateAssertions,
    );
    const server = await serveReplies((head) => ({ body: head }));
    servers.push(server);
    const secret = "a\uD800b";
    const result = await runCheck(
      configFor("http", server.port, {
        auth: { type: "apiKey", headerName: "X-Key" },
        assertions: [{ kind: "bodyContains", text: "X-Key" }],
      }),
      { "auth.apiKey": secret },
      deps(),
    );
    expect(result.outcome).toBe("pass");
    expect(JSON.stringify(result)).not.toContain("a\\ud800b");
  });
});
