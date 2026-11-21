import { describe, expect, it } from "vitest";

import { EnvValidationError, loadSmtpEnv } from "./env";

const base = { SMTP_FROM: "nightwatch@example.test" };

describe("loadSmtpEnv", () => {
  it("reads an authenticated, implicit-TLS server", () => {
    expect(
      loadSmtpEnv({
        ...base,
        SMTP_HOST: "smtp.example.test",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
        SMTP_USER: "mailer",
        SMTP_PASSWORD: "secret",
      }),
    ).toMatchObject({
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: 465,
      SMTP_SECURE: true,
      SMTP_USER: "mailer",
      SMTP_PASSWORD: "secret",
    });
  });

  it("reads the empty strings a container passes for unset variables as unset", () => {
    expect(
      loadSmtpEnv({
        ...base,
        SMTP_SECURE: "",
        SMTP_USER: "",
        SMTP_PASSWORD: "",
      }),
    ).toMatchObject({
      SMTP_SECURE: false,
      SMTP_USER: undefined,
      SMTP_PASSWORD: undefined,
    });
  });

  it("refuses a user without a password and the other way round", () => {
    expect(() => loadSmtpEnv({ ...base, SMTP_USER: "mailer" })).toThrow(
      EnvValidationError,
    );
    expect(() => loadSmtpEnv({ ...base, SMTP_PASSWORD: "secret" })).toThrow(
      EnvValidationError,
    );
  });

  it("needs a sender and refuses a bad boolean", () => {
    expect(() => loadSmtpEnv({})).toThrow(EnvValidationError);
    expect(() => loadSmtpEnv({ ...base, SMTP_SECURE: "yes" })).toThrow(
      EnvValidationError,
    );
  });
});
