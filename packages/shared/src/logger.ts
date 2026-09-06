import { pino, type DestinationStream, type Logger } from "pino";

/** Credential-bearing fields that must never reach log output. */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "password",
  "*.password",
  "token",
  "*.token",
  "secret",
  "*.secret",
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
