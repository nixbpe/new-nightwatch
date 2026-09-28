import type { AuthEnv, Logger } from "@nightwatch/shared";
import nodemailer, { type Transporter } from "nodemailer";

export type OutboundMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

// Never log recipients or bodies: they may contain single-use links.
export type Mailer = {
  send: (mail: OutboundMail) => Promise<void>;
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
        await transport.sendMail({
          from: authEnv.SMTP_FROM,
          ...mail,
        });
        logger.info({ component: "smtp" }, "mail accepted by transport");
      } catch {
        logger.warn({ component: "smtp" }, "mail transport failed");
        throw new Error("SMTP transport failed");
      }
    },
    verify: async () => {
      await transport.verify();
    },
  };
}
