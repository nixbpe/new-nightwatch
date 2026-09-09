import { z } from "zod";

/**
 * Server-side environment contract. Fail-fast: a process with an invalid
 * environment must not start.
 */
export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Auth/database environment contract (owned by the auth boundary).
 * Fail-fast: `loadAuthEnv` throws on invalid or production-incomplete
 * configuration. Development-only defaults exist only for local settings
 * (loopback SMTP, localhost origins, development-only auth secret); no
 * production fake secrets are ever defaulted.
 */
/**
 * Strict boolean for environment values. `z.coerce.boolean()` is unusable
 * here: it applies JS truthiness, so the process.env string "false" would
 * coerce to `true` and break TLS startup against Mailpit. Only the exact
 * strings "true"/"false" (or a real boolean for programmatic callers) are
 * accepted; anything else fails validation.
 */
const envBoolean = z.union([
  z.boolean(),
  z.enum(["true", "false"]).transform((value) => value === "true"),
]);

export const authEnvSchema = z
  .object({
    /** Runtime application URL: pooled, non-owner, NOBYPASSRLS. */
    DATABASE_URL: z.string().min(1),
    /** Owner connection for migrations/provisioning; falls back to DATABASE_URL. */
    DATABASE_OWNER_URL: z.string().min(1).optional(),
    /** Better Auth signing/encryption secret; >= 32 chars. */
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    /** Frontend origin (browser app). */
    APP_URL: z.string().url().default("http://localhost:5173"),
    /** Public API origin where /api/auth is served. */
    BETTER_AUTH_URL: z.string().url().default("http://localhost:4000"),
    /** Credentialed CORS origin; must exactly match APP_URL when set. */
    CORS_ORIGIN: z.string().url().optional(),
    SMTP_HOST: z.string().min(1).default("127.0.0.1"),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_SECURE: envBoolean.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMTP_FROM: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.SMTP_USER && !value.SMTP_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SMTP_PASSWORD"],
        message: "SMTP_PASSWORD is required when SMTP_USER is set",
      });
    }
    if (value.SMTP_PASSWORD && !value.SMTP_USER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SMTP_USER"],
        message: "SMTP_USER is required when SMTP_PASSWORD is set",
      });
    }
    if (value.CORS_ORIGIN && value.CORS_ORIGIN !== value.APP_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CORS_ORIGIN"],
        message: "CORS_ORIGIN must exactly match APP_URL",
      });
    }
  });

export type AuthEnv = z.infer<typeof authEnvSchema> & {
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
  SMTP_FROM: string;
};

/** Development-only auth secret; refused in production by loadAuthEnv. */
const DEV_BETTER_AUTH_SECRET = "nightwatch-dev-only-secret-change-me-0123456";
const DEV_SMTP_FROM = "NightWatch Dev <no-reply@nightwatch.dev.local>";

export class EnvValidationError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    const summary = issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    super(`Invalid environment configuration: ${summary}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }
  return result.data;
}

/**
 * Parse and finalize the auth environment. Production requires an explicit
 * BETTER_AUTH_SECRET and SMTP_FROM; development falls back to documented
 * loopback/development-only values. Never returns an incomplete config.
 */
export function loadAuthEnv(source: NodeJS.ProcessEnv = process.env): AuthEnv {
  const result = authEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }
  const env = result.data;
  const nodeEnv = source.NODE_ENV ?? "development";
  if (!env.BETTER_AUTH_SECRET) {
    if (nodeEnv === "production") {
      throw new EnvValidationError([
        {
          code: z.ZodIssueCode.custom,
          path: ["BETTER_AUTH_SECRET"],
          message: "BETTER_AUTH_SECRET (>= 32 chars) is required in production",
        },
      ]);
    }
    env.BETTER_AUTH_SECRET = DEV_BETTER_AUTH_SECRET;
  }
  if (!env.SMTP_FROM) {
    if (nodeEnv === "production") {
      throw new EnvValidationError([
        {
          code: z.ZodIssueCode.custom,
          path: ["SMTP_FROM"],
          message: "SMTP_FROM is required in production",
        },
      ]);
    }
    env.SMTP_FROM = DEV_SMTP_FROM;
  }
  env.CORS_ORIGIN = env.CORS_ORIGIN ?? env.APP_URL;
  return env as AuthEnv;
}
