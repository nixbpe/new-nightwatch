import { pino, type DestinationStream, type Logger } from "pino";

/** Credential-bearing fields that must never reach log output. */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "password",
  "*.password",
  "body.password",
  "req.body.password",
  "token",
  "*.token",
  "body.token",
  "req.body.token",
  "secret",
  "*.secret",
  "body.secret",
  "req.body.secret",
  "cookie",
  "*.cookie",
  "body.cookie",
  "req.body.cookie",
  "headers.*.value",
  "*.headers.*.value",
  "secrets",
  "*.secrets",
  "secrets.*.value",
  "*.secrets.*.value",
  "auth",
  "*.auth",
  "backupCode",
  "*.backupCode",
  "body.backupCode",
  "req.body.backupCode",
  "backupCodes",
  "*.backupCodes",
  "body.backupCodes",
  "req.body.backupCodes",
];

export type LoggerOptions = {
  level?: string;
  name?: string;
};

export function createLogger(
  options: LoggerOptions = {},
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      name: options.name ?? "nightwatch",
      level: options.level ?? "info",
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}

export type { Logger };
