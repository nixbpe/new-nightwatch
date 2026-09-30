import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { MonitorEnv } from "./env";

/** Row identity bound into the ciphertext as AAD. */
export type SecretLocation = {
  tenantId: string;
  monitorId: string;
  slot: string;
};

/** The four `monitor_secrets` columns that hold an encrypted value. */
export type EncryptedSecret = {
  keyVersion: string;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
};

/** Carries no plaintext, key or ciphertext material. */
export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

export type CredentialEnv = Pick<
  MonitorEnv,
  "CREDENTIAL_ENCRYPTION_KEYS" | "CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION"
>;

const IV_BYTES = 12;
const TAG_BYTES = 16;

function aad({ tenantId, monitorId, slot }: SecretLocation): Buffer {
  const parts = [tenantId, monitorId, slot];
  if (parts.some((part) => part.length === 0 || part.includes("|"))) {
    throw new CredentialError("invalid secret location");
  }
  return Buffer.from(parts.join("|"), "utf8");
}

function keyFor(env: CredentialEnv, version: string): Buffer | undefined {
  const keys = env.CREDENTIAL_ENCRYPTION_KEYS;
  return Object.hasOwn(keys, version)
    ? Buffer.from(keys[version] as string, "base64")
    : undefined;
}

/**
 * AES-256-GCM with a random 12-byte IV and the active key. The result maps
 * onto the `monitor_secrets` columns so a later key rotation can still
 * decrypt older rows by `keyVersion`.
 */
export function encryptSecret(
  input: SecretLocation & { value: string },
  env: CredentialEnv,
): EncryptedSecret {
  const keyVersion = env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION;
  const key = keyFor(env, keyVersion);
  if (key === undefined) {
    throw new CredentialError("active credential key is not configured");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(aad(input));
  const ciphertext = Buffer.concat([
    cipher.update(input.value, "utf8"),
    cipher.final(),
  ]);
  return { keyVersion, iv, authTag: cipher.getAuthTag(), ciphertext };
}

/** Throws CredentialError for any tampered, mis-bound or unknown-key input. */
export function decryptSecret(
  input: SecretLocation & EncryptedSecret,
  env: CredentialEnv,
): string {
  const fail = () => new CredentialError("secret cannot be decrypted");
  const key = keyFor(env, input.keyVersion);
  if (
    key === undefined ||
    input.iv.length !== IV_BYTES ||
    input.authTag.length !== TAG_BYTES
  ) {
    throw fail();
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, input.iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(aad(input));
    decipher.setAuthTag(input.authTag);
    return Buffer.concat([
      decipher.update(input.ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw fail();
  }
}
