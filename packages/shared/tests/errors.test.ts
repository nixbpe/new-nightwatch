import { describe, expect, it } from "vitest";

import { AppError } from "../src/errors";

describe("AppError", () => {
  it("carries code, message, statusCode and details", () => {
    const error = new AppError(
      "SCAN_CONFLICT",
      "A scan is already running",
      409,
      {
        scanId: "123",
      },
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("SCAN_CONFLICT");
    expect(error.message).toBe("A scan is already running");
    expect(error.statusCode).toBe(409);
    expect(error.details).toEqual({ scanId: "123" });
  });

  it("defaults to statusCode 500", () => {
    expect(new AppError("BOOM", "boom").statusCode).toBe(500);
  });
});
