import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { EnvValidationError, loadMonitorEnv } from "../src/env";

const key = (bytes = 32): string => randomBytes(bytes).toString("base64");
const base = { REDIS_URL: "redis://127.0.0.1:6379" };
const prod = {
  ...base,
  NODE_ENV: "production",
  CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ v1: key() }),
  CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: "v1",
};

describe("loadMonitorEnv", () => {
  it("fails in production without keys", () => {
    expect(() => loadMonitorEnv({ ...base, NODE_ENV: "production" })).toThrow(
      /CREDENTIAL_ENCRYPTION_KEYS is required in production/,
    );
  });

  it("accepts a complete production environment", () => {
    const env = loadMonitorEnv({
      ...prod,
      MONITOR_EGRESS_CANARY_URLS: "https://a.example, http://b.example/x",
    });
    expect(env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION).toBe("v1");
    expect(env.MONITOR_EGRESS_CANARY_URLS).toEqual([
      "https://a.example",
      "http://b.example/x",
    ]);
    expect(env.OUTBOUND_TEST_ALLOWED_HOSTS).toEqual([]);
  });

  it("requires REDIS_URL", () => {
    expect(() => loadMonitorEnv({})).toThrow(EnvValidationError);
  });

  it.each([
    ["not 32 bytes", JSON.stringify({ v1: key(16) })],
    ["not base64", JSON.stringify({ v1: "not base64 at all!" })],
    ["not JSON", "v1=abc"],
    ["empty map", "{}"],
    ["bad version name", JSON.stringify({ "v.1": key() })],
  ])("rejects keys that are %s at startup", (_name, keys) => {
    let message = "";
    try {
      loadMonitorEnv({ ...prod, CREDENTIAL_ENCRYPTION_KEYS: keys });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/CREDENTIAL_ENCRYPTION_KEYS/);
  });

  it("never echoes a key or version in startup errors", () => {
    const secret = key();
    for (const keys of [
      JSON.stringify({ [secret]: "v1" }),
      JSON.stringify({ [secret]: secret }),
      JSON.stringify({ v1: secret.slice(0, -2) }),
    ]) {
      let message = "";
      try {
        loadMonitorEnv({
          ...prod,
          CREDENTIAL_ENCRYPTION_KEYS: keys,
          CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: secret,
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/CREDENTIAL_ENCRYPTION_KEYS/);
      expect(message).not.toContain(secret);
      expect(message).not.toContain(secret.slice(0, 12));
    }
  });

  it("rejects keys that are not canonical base64 of 32 bytes", () => {
    const bytes = randomBytes(32);
    for (const bad of [
      bytes.toString("base64").replace(/=+$/, ""),
      Buffer.from([0xfb, 0xff, ...bytes.subarray(2)]).toString("base64url"),
      Buffer.from([0xfb, 0xff, ...bytes.subarray(2)])
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_"),
    ]) {
      expect(() =>
        loadMonitorEnv({
          ...prod,
          CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ v1: bad }),
        }),
      ).toThrow(EnvValidationError);
    }
  });

  it("rejects a __proto__ key version instead of dropping it", () => {
    expect(() =>
      loadMonitorEnv({
        ...prod,
        CREDENTIAL_ENCRYPTION_KEYS: `{"__proto__":"${key()}","v1":"${key()}"}`,
      }),
    ).toThrow(/CREDENTIAL_ENCRYPTION_KEYS/);
  });

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "v.1"])(
    "fails when the active version is %s",
    (active) => {
      expect(() =>
        loadMonitorEnv({
          ...prod,
          CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: active,
        }),
      ).toThrow(/CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION/);
    },
  );

  describe("development key in production", () => {
    const devKey = Buffer.alloc(32, "nightwatch-dev-credential-key").toString(
      "base64",
    );

    it("is accepted outside production", () => {
      const env = loadMonitorEnv(base);
      expect(env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION).toBe("dev");
      expect(env.CREDENTIAL_ENCRYPTION_KEYS.dev).toBe(devKey);
    });

    it("is refused as version dev, as the public key value, or as active", () => {
      for (const keys of [{ dev: key(), v1: key() }, { v1: devKey }]) {
        expect(() =>
          loadMonitorEnv({
            ...prod,
            CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify(keys),
            CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: "v1",
          }),
        ).toThrow(/development credential key/);
      }
      expect(() =>
        loadMonitorEnv({
          ...prod,
          CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ dev: key() }),
          CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: "dev",
        }),
      ).toThrow(/development credential key/);
    });
  });

  it("rejects an active version that is not in the key map", () => {
    expect(() =>
      loadMonitorEnv({
        ...prod,
        CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: "v2",
      }),
    ).toThrow(/must name a version present/);
  });

  it("rejects an unusable canary URL", () => {
    expect(() =>
      loadMonitorEnv({
        ...base,
        MONITOR_EGRESS_CANARY_URLS: "ftp://x.example",
      }),
    ).toThrow(/MONITOR_EGRESS_CANARY_URLS/);
  });

  describe("OUTBOUND_TEST_ALLOWED_HOSTS", () => {
    it("parses hostnames outside production", () => {
      const env = loadMonitorEnv({
        ...base,
        NODE_ENV: "test",
        OUTBOUND_TEST_ALLOWED_HOSTS: "target.nw-test.internal, Other.Test",
      });
      expect(env.OUTBOUND_TEST_ALLOWED_HOSTS).toEqual([
        "target.nw-test.internal",
        "other.test",
      ]);
    });

    it("fails startup when set with NODE_ENV=production", () => {
      expect(() =>
        loadMonitorEnv({
          ...prod,
          OUTBOUND_TEST_ALLOWED_HOSTS: "target.nw-test.internal",
        }),
      ).toThrow(/must not be set when NODE_ENV=production/);
    });

    it("treats an empty value as unset in production", () => {
      expect(
        loadMonitorEnv({ ...prod, OUTBOUND_TEST_ALLOWED_HOSTS: "" })
          .OUTBOUND_TEST_ALLOWED_HOSTS,
      ).toEqual([]);
    });

    it.each([
      "127.0.0.1",
      "[::1]",
      "::1",
      "169.254.169.254",
      "2130706433",
      "0x7f.1",
      "*.nw-test.internal",
      "*",
      "host.internal:8080",
      "host.internal/path",
      "a.example,127.0.0.1",
      "127.1",
      "0177.0.0.1",
      "a..b",
      "target.internal.",
    ])("rejects %s", (host) => {
      expect(() =>
        loadMonitorEnv({ ...base, OUTBOUND_TEST_ALLOWED_HOSTS: host }),
      ).toThrow(/plain hostnames/);
    });
  });
});
