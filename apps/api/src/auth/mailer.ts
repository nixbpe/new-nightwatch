import type { AuthEnv, Logger } from "@nightwatch/shared";
import nodemailer, { type Transporter } from "nodemailer";

export type OutboundMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * SMTP delivery with real failure semantics: send() rejects when the
 * server cannot deliver, and there is no fake transport fallback.
 * Recipients and message bodies (which may contain single-use links) are
 * never logged.
 */
export type Mailer = {
  send: (mail: OutboundMail) => Promise<void>;
  /** Fail-fast startup check against the configured SMTP server. */
  verify: () => Promise<void>;
};

export function createMailer(authEnv: AuthEnv, logger: Logger): Mailer {
  const transport: Transporter = nodemailer.createTransport({
    host: authEnv.SMTP_HOST,
    port: authEnv.SMTP_PORT,
    secure: authEnv.SMTP_SECURE,
    auth:
      authEnv.SMTP_USER && authEnv.SMTP_PASSWORD
        ? { user: authEnv.SMTP_USER, pass: authEnv.SMTP_PASSWORD }
        : undefined,
  });
  return {
    send: async (mail) => {
      try {
        const info = await transport.sendMail({
          from: authEnv.SMTP_FROM,
          ...mail,
        });
        logger.info({ messageId: info.messageId }, "mail delivered");
      } catch (error) {
        logger.warn(
          { err: error },
          "mail delivery failed; the auth flow reports the failure",
        );
        throw error;
      }
    },
    verify: async () => {
      await transport.verify();
    },
  };
}
