import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CredentialError,
  decryptSecret,
  encryptSecret,
} from "../src/credentials";
import { loadMonitorEnv } from "../src/env";

const key = (): string => randomBytes(32).toString("base64");
const location = { tenantId: "t-1", monitorId: "m-1", slot: "auth.token" };

function envWith(keys: Record<string, string>, active: string) {
  return loadMonitorEnv({
    REDIS_URL: "redis://127.0.0.1:6379",
    CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify(keys),
    CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: active,
  });
}

describe("credential helper", () => {
  const env = envWith({ v1: key() }, "v1");

  it("round-trips a secret and never stores plaintext or reuses an IV", () => {
    const a = encryptSecret({ ...location, value: "s3cret-value" }, env);
    const b = encryptSecret({ ...location, value: "s3cret-value" }, env);
    expect(a).not.toContain("s3cret-value");
    expect(a).not.toBe(b);
    expect(decryptSecret({ ...location, ciphertext: a }, env)).toBe(
      "s3cret-value",
    );
  });

  it.each([
    ["tenant", { tenantId: "t-2" }],
    ["monitor", { monitorId: "m-2" }],
    ["slot", { slot: "header.x" }],
  ])("refuses a ciphertext moved to another %s", (_name, override) => {
    const ciphertext = encryptSecret({ ...location, value: "v" }, env);
    expect(() =>
      decryptSecret({ ...location, ...override, ciphertext }, env),
    ).toThrow(CredentialError);
  });

  it("refuses a tampered ciphertext and an unknown key version", () => {
    const ciphertext = encryptSecret({ ...location, value: "value" }, env);
    const parts = ciphertext.split(".");
    parts[3] = Buffer.from("tampered!!!!").toString("base64");
    expect(() =>
      decryptSecret({ ...location, ciphertext: parts.join(".") }, env),
    ).toThrow(CredentialError);
    expect(() =>
      decryptSecret(
        { ...location, ciphertext: ciphertext.replace(/^v1/, "v9") },
        env,
      ),
    ).toThrow(CredentialError);
  });

  it("still decrypts values written under an older key version after rotation", () => {
    const k1 = key();
    const old = encryptSecret(
      { ...location, value: "old" },
      envWith({ v1: k1 }, "v1"),
    );
    const rotated = envWith({ v1: k1, v2: key() }, "v2");
    expect(decryptSecret({ ...location, ciphertext: old }, rotated)).toBe(
      "old",
    );
    expect(
      encryptSecret({ ...location, value: "new" }, rotated).startsWith("v2."),
    ).toBe(true);
  });

  it("rejects a location containing the AAD separator", () => {
    expect(() =>
      encryptSecret({ ...location, slot: "a|b", value: "v" }, env),
    ).toThrow(CredentialError);
  });

  it("uses the dev key outside production so local code can encrypt", () => {
    const dev = loadMonitorEnv({ REDIS_URL: "redis://x" });
    const ciphertext = encryptSecret({ ...location, value: "v" }, dev);
    expect(decryptSecret({ ...location, ciphertext }, dev)).toBe("v");
  });
});
