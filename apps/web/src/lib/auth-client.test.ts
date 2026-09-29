import { afterEach, describe, expect, it, vi } from "vitest";

import { authErrorMessage } from "./auth-client";

const FALLBACK = "ไม่สำเร็จ";

describe("authErrorMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps a known better-auth code to Thai text", () => {
    expect(
      authErrorMessage(
        {
          code: "INVALID_EMAIL_OR_PASSWORD",
          message: "Invalid email or password",
        },
        FALLBACK,
      ),
    ).toBe("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  });

  it("maps a 429 without a code to the rate-limit text", () => {
    expect(
      authErrorMessage({ status: 429, message: "Too many requests" }, FALLBACK),
    ).toBe("มีคำขอมากเกินไป กรุณาลองใหม่ภายหลัง");
  });

  it("prefers the code map over the 429 status", () => {
    expect(
      authErrorMessage({ code: "INVALID_CODE", status: 429 }, FALLBACK),
    ).toBe("รหัสยืนยันไม่ถูกต้อง");
  });

  it("returns the fallback for an unknown code, never the English message", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      authErrorMessage(
        { code: "SOMETHING_NEW", message: "Something new" },
        FALLBACK,
      ),
    ).toBe(FALLBACK);
  });

  it("keeps USER_NOT_FOUND unmapped to avoid account enumeration", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      authErrorMessage(
        { code: "USER_NOT_FOUND", message: "User not found" },
        FALLBACK,
      ),
    ).toBe(FALLBACK);
  });

  it("returns the fallback for a message without a code", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(authErrorMessage({ message: "Session not found" }, FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it("does not resolve inherited object keys as codes", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(authErrorMessage({ code: "toString" }, FALLBACK)).toBe(FALLBACK);
  });

  it.each([null, undefined, "boom", 42])(
    "returns the fallback for non-object input %s",
    (input) => {
      expect(authErrorMessage(input, FALLBACK)).toBe(FALLBACK);
    },
  );

  it("warns the original code and message in development only, never in the return value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = authErrorMessage(
      { code: "SOMETHING_NEW", message: "Something new" },
      FALLBACK,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toContain("SOMETHING_NEW");
    expect(result).toBe(FALLBACK);
  });

  it("does not log in production", () => {
    vi.stubEnv("DEV", false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    authErrorMessage({ code: "SOMETHING_NEW", message: "x" }, FALLBACK);
    expect(warn).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("does not log for a mapped code", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    authErrorMessage({ code: "INVALID_PASSWORD" }, FALLBACK);
    expect(warn).not.toHaveBeenCalled();
  });
});
