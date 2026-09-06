import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logger";

function captureStream() {
  let output = "";
  return {
    stream: { write: (chunk: string) => (output += chunk) },
    read: () => output,
  };
}

describe("createLogger", () => {
  it("redacts credential fields from log output", () => {
    const { stream, read } = captureStream();
    const logger = createLogger({ level: "info", name: "test" }, stream);
    logger.info(
      { password: "hunter2", headers: { authorization: "Bearer sekret" } },
      "auth",
    );
    expect(read()).toContain("[REDACTED]");
    expect(read()).not.toContain("hunter2");
    expect(read()).not.toContain("sekret");
  });

  it("emits structured JSON with level, name and timestamp", () => {
    const { stream, read } = captureStream();
    const logger = createLogger(
      { level: "info", name: "nightwatch-api" },
      stream,
    );
    logger.info({ requestId: "req-1" }, "request completed");
    const line = JSON.parse(read().trim()) as Record<string, unknown>;
    expect(line["level"]).toBe(30);
    expect(line["name"]).toBe("nightwatch-api");
    expect(line["requestId"]).toBe("req-1");
    expect(line["msg"]).toBe("request completed");
    expect(typeof line["time"]).toBe("string");
  });

  it("suppresses records below the configured level", () => {
    const { stream, read } = captureStream();
    const logger = createLogger({ level: "warn", name: "test" }, stream);
    logger.info("quiet");
    logger.warn("loud");
    expect(read()).not.toContain("quiet");
    expect(read()).toContain("loud");
  });
});
