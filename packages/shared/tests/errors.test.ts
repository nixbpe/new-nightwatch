import { describe, expect, it } from "vitest";

import { AppError } from "../src/errors";

describe("AppError", () => {
  it("carries statusCode, code, message and details (status-first)", () => {
    const error = new AppError(
      409,
      "SCAN_CONFLICT",
      "A scan is already running",
      {
        scanId: "123",
      },
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe("SCAN_CONFLICT");
    expect(error.message).toBe("A scan is already running");
    expect(error.details).toEqual({ scanId: "123" });
  });

  it("defaults to statusCode 500", () => {
    expect(new AppError(500, "BOOM", "boom").statusCode).toBe(500);
  });
});
