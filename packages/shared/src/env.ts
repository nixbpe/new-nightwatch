import { isIP } from "node:net";

import { z } from "zod";

/**
 * Server-side environment contract. Fail-fast: a process with an invalid
 * environment must not start.
 */
export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  REDIS_KEY_PREFIX: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
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
    APP_URL: z.url().default("http://localhost:5173"),
    /** Public API origin where /api/auth is served. */
    BETTER_AUTH_URL: z.url().default("http://localhost:4000"),
    /** Credentialed CORS origin; must exactly match APP_URL when set. */
    CORS_ORIGIN: z.url().optional(),
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
        code: "custom",
        path: ["SMTP_PASSWORD"],
        message: "SMTP_PASSWORD is required when SMTP_USER is set",
      });
    }
    if (value.SMTP_PASSWORD && !value.SMTP_USER) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_USER"],
        message: "SMTP_USER is required when SMTP_PASSWORD is set",
      });
    }
    if (value.CORS_ORIGIN && value.CORS_ORIGIN !== value.APP_URL) {
      ctx.addIssue({
        code: "custom",
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
  readonly issues: z.core.$ZodIssue[];

  constructor(issues: z.core.$ZodIssue[]) {
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
          code: "custom",
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
          code: "custom",
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

/** Development-only credential key (version "dev"); refused in production. */
const DEV_CREDENTIAL_KEY = Buffer.alloc(
  32,
  "nightwatch-dev-credential-key",
).toString("base64");
const DEV_CREDENTIAL_KEY_VERSION = "dev";

/** Must start alphanumeric so "__proto__" can never be a version. */
const CREDENTIAL_KEY_VERSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Canonical base64 of exactly 32 bytes, or null. */
function canonicalKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32) return null;
  const canonical = bytes.toString("base64");
  return canonical === value ? canonical : null;
}

/**
 * Test-harness hostnames only. IP literals (including forms the WHATWG URL
 * parser reads as IPv4, such as "2130706433" or "0x7f.1") and wildcards are
 * refused so the exemption can never widen past a named DNS host.
 */
function isPlainHostname(host: string): boolean {
  if (host.includes(":") || isIP(host) !== 0) return false;
  const labels = host.split(".");
  return (
    host.length <= 253 &&
    labels.every((label) => label.length <= 63 && HOST_LABEL.test(label)) &&
    /^[a-z]/.test(labels[labels.length - 1] ?? "")
  );
}

export const monitorEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    REDIS_URL: z.string().min(1),
    /** JSON map of key version to base64 32-byte AES-256 key. */
    CREDENTIAL_ENCRYPTION_KEYS: z.string().min(1).optional(),
    CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: z.string().min(1).optional(),
    /** Comma-separated URL list. */
    MONITOR_EGRESS_CANARY_URLS: z.string().optional(),
    /** Comma-separated hostnames; refused when NODE_ENV=production. */
    OUTBOUND_TEST_ALLOWED_HOSTS: z.string().optional(),
  })
  .transform((raw, ctx) => {
    const fail = (path: string, message: string) => {
      ctx.addIssue({ code: "custom", path: [path], message });
    };
    const production = raw.NODE_ENV === "production";

    const keys = Object.create(null) as Record<string, string>;
    let activeVersion = raw.CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION ?? "";
    // Messages below are static: neither versions nor key material is echoed.
    if (raw.CREDENTIAL_ENCRYPTION_KEYS === undefined) {
      if (production) {
        fail(
          "CREDENTIAL_ENCRYPTION_KEYS",
          "CREDENTIAL_ENCRYPTION_KEYS is required in production",
        );
      } else {
        keys[DEV_CREDENTIAL_KEY_VERSION] = DEV_CREDENTIAL_KEY;
        activeVersion ||= DEV_CREDENTIAL_KEY_VERSION;
      }
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.CREDENTIAL_ENCRYPTION_KEYS);
      } catch {
        parsed = undefined;
      }
      // Not z.record: it drops a "__proto__" key, which must be rejected.
      const entries =
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
          ? Object.entries(parsed as Record<string, unknown>)
          : [];
      if (entries.length === 0) {
        fail(
          "CREDENTIAL_ENCRYPTION_KEYS",
          "must be a non-empty JSON object of key version to base64 key",
        );
      }
      for (const [version, value] of entries) {
        const key = canonicalKey(value);
        if (!CREDENTIAL_KEY_VERSION.test(version) || key === null) {
          fail(
            "CREDENTIAL_ENCRYPTION_KEYS",
            "every entry must map a version matching [A-Za-z0-9][A-Za-z0-9_-]{0,31} to the base64 encoding of exactly 32 bytes",
          );
        } else {
          keys[version] = key;
        }
        if (
          production &&
          (version === DEV_CREDENTIAL_KEY_VERSION ||
            value === DEV_CREDENTIAL_KEY)
        ) {
          fail(
            "CREDENTIAL_ENCRYPTION_KEYS",
            "the development credential key must not be used in production",
          );
        }
      }
    }
    if (raw.CREDENTIAL_ENCRYPTION_KEYS !== undefined || !production) {
      if (!activeVersion) {
        fail(
          "CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION",
          "CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION is required with CREDENTIAL_ENCRYPTION_KEYS",
        );
      } else if (
        !CREDENTIAL_KEY_VERSION.test(activeVersion) ||
        !Object.hasOwn(keys, activeVersion)
      ) {
        fail(
          "CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION",
          "must name a version present in CREDENTIAL_ENCRYPTION_KEYS",
        );
      } else if (production && activeVersion === DEV_CREDENTIAL_KEY_VERSION) {
        fail(
          "CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION",
          "the development credential key must not be used in production",
        );
      }
    }

    const canaryUrls = splitList(raw.MONITOR_EGRESS_CANARY_URLS ?? "");
    for (const url of canaryUrls) {
      if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
        fail(
          "MONITOR_EGRESS_CANARY_URLS",
          "every entry must be an http or https URL",
        );
        break;
      }
    }

    const allowedHosts = splitList(raw.OUTBOUND_TEST_ALLOWED_HOSTS ?? "").map(
      (host) => host.toLowerCase(),
    );
    if (allowedHosts.length > 0) {
      if (production) {
        fail(
          "OUTBOUND_TEST_ALLOWED_HOSTS",
          "must not be set when NODE_ENV=production",
        );
      }
      if (!allowedHosts.every(isPlainHostname)) {
        fail(
          "OUTBOUND_TEST_ALLOWED_HOSTS",
          "entries must be plain hostnames (no IP literals, wildcards, ports or paths)",
        );
      }
    }

    return {
      NODE_ENV: raw.NODE_ENV,
      REDIS_URL: raw.REDIS_URL,
      CREDENTIAL_ENCRYPTION_KEYS: keys,
      CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: activeVersion,
      MONITOR_EGRESS_CANARY_URLS: canaryUrls,
      OUTBOUND_TEST_ALLOWED_HOSTS: allowedHosts,
    };
  });

/** Key versions map to canonical base64 32-byte keys; lists are already split. */
export type MonitorEnv = z.output<typeof monitorEnvSchema>;

/**
 * Environment for API and Worker monitor features. Production requires
 * explicit keys; other environments fall back to a dev-only key.
 */
export function loadMonitorEnv(
  source: NodeJS.ProcessEnv = process.env,
): MonitorEnv {
  const result = monitorEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }
  return result.data;
}
