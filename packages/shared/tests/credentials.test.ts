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
  const encrypt = (value = "s3cret-value") =>
    encryptSecret({ ...location, value }, env);

  it("round-trips a secret and never stores plaintext or reuses an IV", () => {
    const a = encrypt();
    const b = encrypt();
    expect(a.ciphertext.toString("utf8")).not.toContain("s3cret-value");
    expect(a.iv.length).toBe(12);
    expect(a.authTag.length).toBe(16);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(decryptSecret({ ...location, ...a }, env)).toBe("s3cret-value");
  });

  it("decrypts from values shaped like the monitor_secrets columns", () => {
    const stored = encrypt("column-value");
    const row = {
      key_version: stored.keyVersion,
      iv: Buffer.from(stored.iv),
      auth_tag: Buffer.from(stored.authTag),
      ciphertext: Buffer.from(stored.ciphertext),
    };
    expect(
      decryptSecret(
        {
          ...location,
          keyVersion: row.key_version,
          iv: row.iv,
          authTag: row.auth_tag,
          ciphertext: row.ciphertext,
        },
        env,
      ),
    ).toBe("column-value");
  });

  it.each([
    ["tenant", { tenantId: "t-2" }],
    ["monitor", { monitorId: "m-2" }],
    ["slot", { slot: "header.x" }],
  ])("refuses a ciphertext moved to another %s", (_name, override) => {
    expect(() =>
      decryptSecret({ ...location, ...override, ...encrypt("v") }, env),
    ).toThrow(CredentialError);
  });

  it("refuses tampered ciphertext, tampered tag and unknown key version", () => {
    const stored = encrypt();
    const flipped = Buffer.from(stored.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() =>
      decryptSecret({ ...location, ...stored, ciphertext: flipped }, env),
    ).toThrow(CredentialError);
    const badTag = Buffer.from(stored.authTag);
    badTag[0] = (badTag[0] ?? 0) ^ 1;
    expect(() =>
      decryptSecret({ ...location, ...stored, authTag: badTag }, env),
    ).toThrow(CredentialError);
    expect(() =>
      decryptSecret({ ...location, ...stored, keyVersion: "v9" }, env),
    ).toThrow(CredentialError);
  });

  it("refuses a truncated 4-byte tag and a wrong-length IV", () => {
    const stored = encrypt();
    expect(() =>
      decryptSecret(
        { ...location, ...stored, authTag: stored.authTag.subarray(0, 4) },
        env,
      ),
    ).toThrow(CredentialError);
    expect(() =>
      decryptSecret({ ...location, ...stored, iv: randomBytes(16) }, env),
    ).toThrow(CredentialError);
    expect(() =>
      decryptSecret(
        { ...location, ...stored, iv: stored.iv.subarray(0, 8) },
        env,
      ),
    ).toThrow(CredentialError);
  });

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "never resolves the inherited property %s as a key version",
    (keyVersion) => {
      expect(() =>
        decryptSecret({ ...location, ...encrypt(), keyVersion }, env),
      ).toThrow(CredentialError);
    },
  );

  it("still decrypts values written under an older key version after rotation", () => {
    const k1 = key();
    const old = encryptSecret(
      { ...location, value: "old" },
      envWith({ v1: k1 }, "v1"),
    );
    const rotated = envWith({ v1: k1, v2: key() }, "v2");
    expect(decryptSecret({ ...location, ...old }, rotated)).toBe("old");
    expect(
      encryptSecret({ ...location, value: "new" }, rotated).keyVersion,
    ).toBe("v2");
  });

  it("rejects a location containing the AAD separator", () => {
    expect(() =>
      encryptSecret({ ...location, slot: "a|b", value: "v" }, env),
    ).toThrow(CredentialError);
  });

  it("uses the dev key outside production so local code can encrypt", () => {
    const dev = loadMonitorEnv({ REDIS_URL: "redis://x" });
    const stored = encryptSecret({ ...location, value: "v" }, dev);
    expect(decryptSecret({ ...location, ...stored }, dev)).toBe("v");
  });
});
