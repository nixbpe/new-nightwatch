import { beforeEach, describe, expect, it, vi } from "vitest";

const created: Record<string, unknown>[] = [];
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (options: Record<string, unknown>) => {
      created.push(options);
      return {
        sendMail: () => Promise.resolve(),
        verify: () => Promise.resolve(),
      };
    },
  },
}));

import { createMailer } from "./mailer";

const logger = { info: () => undefined, warn: () => undefined } as never;

beforeEach(() => {
  created.length = 0;
});

describe("createMailer", () => {
  it("bounds the SMTP connection, greeting and silence below the Worker's 5 minute lease", () => {
    createMailer(
      { SMTP_HOST: "smtp.example.test", SMTP_PORT: 587, SMTP_SECURE: false },
      logger,
    );
    expect(created[0]).toMatchObject({
      host: "smtp.example.test",
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
    const total =
      (created[0]?.connectionTimeout as number) +
      (created[0]?.greetingTimeout as number) +
      (created[0]?.socketTimeout as number);
    expect(total).toBeLessThan(5 * 60_000);
  });
});
