import { describe, expect, it } from "vitest";

import { EnvValidationError, loadEnv } from "../src/env";

describe("loadEnv", () => {
  it("applies defaults when the environment is empty", () => {
    const env = loadEnv({});
    expect(env).toEqual({
      PORT: 4000,
      LOG_LEVEL: "info",
      NODE_ENV: "development",
    });
  });

  it("coerces PORT from a string", () => {
    expect(loadEnv({ PORT: "8080" }).PORT).toBe(8080);
  });

  it("fails fast on a non-numeric PORT", () => {
    expect(() => loadEnv({ PORT: "abc" })).toThrow(EnvValidationError);
  });

  it("fails fast on an unknown LOG_LEVEL", () => {
    expect(() => loadEnv({ LOG_LEVEL: "chatty" })).toThrow(EnvValidationError);
  });

  it("reports the offending variable in the error", () => {
    try {
      loadEnv({ NODE_ENV: "staging-ish" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).message).toContain("NODE_ENV");
    }
  });
});
