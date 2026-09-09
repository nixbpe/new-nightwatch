import { describe, expect, it } from "vitest";

import { EnvValidationError, loadAuthEnv } from "../src/env";

const REQUIRED = {
  DATABASE_URL: "postgres://runtime:pw@localhost:5432/nightwatch",
};

describe("loadAuthEnv", () => {
  it("applies development defaults for loopback settings", () => {
    const env = loadAuthEnv({ ...REQUIRED, NODE_ENV: "development" });
    expect(env.DATABASE_URL).toBe(REQUIRED.DATABASE_URL);
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.APP_URL).toBe("http://localhost:5173");
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:4000");
    expect(env.CORS_ORIGIN).toBe(env.APP_URL);
    expect(env.SMTP_HOST).toBe("127.0.0.1");
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.SMTP_SECURE).toBe(false);
    expect(env.SMTP_FROM).toContain("no-reply");
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadAuthEnv({})).toThrow(EnvValidationError);
  });

  it("rejects a BETTER_AUTH_SECRET shorter than 32 chars", () => {
    expect(() =>
      loadAuthEnv({ ...REQUIRED, BETTER_AUTH_SECRET: "short" }),
    ).toThrow(EnvValidationError);
  });

  it("requires an explicit secret and SMTP_FROM in production", () => {
    expect(() => loadAuthEnv({ ...REQUIRED, NODE_ENV: "production" })).toThrow(
      EnvValidationError,
    );
    expect(() =>
      loadAuthEnv({
        ...REQUIRED,
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "a".repeat(32),
      }),
    ).toThrow(EnvValidationError);
    const env = loadAuthEnv({
      ...REQUIRED,
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "a".repeat(32),
      SMTP_FROM: "NightWatch <no-reply@nightwatch.example>",
    });
    expect(env.SMTP_FROM).toBe("NightWatch <no-reply@nightwatch.example>");
  });

  it("rejects truthy-looking junk for the strict SMTP_SECURE boolean", () => {
    // Regression (INT-AUTH-2): z.coerce.boolean() made the string "false"
    // true, breaking TLS startup against Mailpit. Only the exact strings
    // "true"/"false" (or a real boolean) parse; any other value fails
    // validation instead of being truthiness-coerced.
    expect(loadAuthEnv({ ...REQUIRED, SMTP_SECURE: "false" }).SMTP_SECURE).toBe(
      false,
    );
    expect(loadAuthEnv({ ...REQUIRED, SMTP_SECURE: "true" }).SMTP_SECURE).toBe(
      true,
    );
    expect(() => loadAuthEnv({ ...REQUIRED, SMTP_SECURE: "0" })).toThrow(
      EnvValidationError,
    );
    expect(() => loadAuthEnv({ ...REQUIRED, SMTP_SECURE: "yes" })).toThrow(
      EnvValidationError,
    );
  });

  it("enforces the SMTP credential pairing rule", () => {
    expect(() => loadAuthEnv({ ...REQUIRED, SMTP_USER: "mailer" })).toThrow(
      EnvValidationError,
    );
    expect(() => loadAuthEnv({ ...REQUIRED, SMTP_PASSWORD: "pw" })).toThrow(
      EnvValidationError,
    );
    const env = loadAuthEnv({
      ...REQUIRED,
      SMTP_USER: "mailer",
      SMTP_PASSWORD: "pw",
    });
    expect(env.SMTP_USER).toBe("mailer");
  });

  it("rejects a CORS_ORIGIN that does not exactly match APP_URL", () => {
    expect(() =>
      loadAuthEnv({
        ...REQUIRED,
        APP_URL: "https://app.nightwatch.example",
        CORS_ORIGIN: "https://evil.example",
      }),
    ).toThrow(EnvValidationError);
  });

  it("keeps an explicit CORS_ORIGIN equal to APP_URL", () => {
    const env = loadAuthEnv({
      ...REQUIRED,
      APP_URL: "https://app.nightwatch.example",
      CORS_ORIGIN: "https://app.nightwatch.example",
    });
    expect(env.CORS_ORIGIN).toBe("https://app.nightwatch.example");
  });
});
