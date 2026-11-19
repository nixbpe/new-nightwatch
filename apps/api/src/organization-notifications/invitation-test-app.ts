import type { Database } from "@nightwatch/db";
import { createLogger, type AuthEnv, type Env } from "@nightwatch/shared";

import { createApp } from "../app";
import type { Auth, AuthSession } from "../auth";
import type { Mailer } from "../auth/mailer";

type InvitationTestAppInput = {
  database: Database;
  runtimeUrl: string;
  secret: string;
  actorIds: Record<string, string>;
  actorEmail: (actor: string) => string;
  loggerName: string;
  mailer: Mailer;
};

export function createInvitationTestApp({
  database,
  runtimeUrl,
  secret,
  actorIds,
  actorEmail,
  loggerName,
  mailer,
}: InvitationTestAppInput) {
  const env: Env = { PORT: 4000, LOG_LEVEL: "silent", NODE_ENV: "test" };
  const authEnv: AuthEnv = {
    DATABASE_URL: runtimeUrl,
    BETTER_AUTH_SECRET: secret,
    APP_URL: "http://localhost:5173",
    BETTER_AUTH_URL: "http://localhost:4000",
    CORS_ORIGIN: "http://localhost:5173",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: 1025,
    SMTP_SECURE: false,
    SMTP_FROM: "Invitation <invite@example.test>",
  };
  const auth: Auth = {
    handler: () => Promise.resolve(new Response("native auth route not used")),
    getSession: (headers) => {
      const actor = headers.get("x-test-actor");
      const id = actor ? actorIds[actor] : undefined;
      return Promise.resolve(
        actor && id
          ? ({
              user: {
                id,
                email: actorEmail(actor),
                name: id,
                emailVerified: true,
              },
              session: {
                id,
                token: "test-session",
                expiresAt: new Date(Date.now() + 60_000),
              },
            } satisfies AuthSession)
          : null,
      );
    },
  };
  const logs: string[] = [];
  const app = createApp({
    env,
    authEnv,
    auth,
    database,
    mailer,
    logger: createLogger(
      { level: "info", name: loggerName },
      {
        write: (line: string) => {
          logs.push(line);
        },
      },
    ),
  });
  return { app, logs };
}
