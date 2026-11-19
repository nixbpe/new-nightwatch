import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logger";

function captureStream() {
  let output = "";
  return {
    stream: { write: (chunk: string) => (output += chunk) },
    read: () => output,
  };
}

function bodyCredentials(prefix: string) {
  return {
    password: `${prefix}-password-sentinel`,
    token: `${prefix}-token-sentinel`,
    secret: `${prefix}-secret-sentinel`,
    backupCode: `${prefix}-backup-code-sentinel`,
    backupCodes: [
      `${prefix}-first-backup-code-sentinel`,
      `${prefix}-second-backup-code-sentinel`,
    ],
    cookie: `${prefix}-cookie-sentinel`,
  };
}

describe("createLogger", () => {
  it("redacts credential fields from log output", () => {
    const { stream, read } = captureStream();
    const logger = createLogger({ level: "info", name: "test" }, stream);
    logger.info(
      { password: "hunter2", headers: { authorization: "Bearer sekret" } },
      "auth",
    );
    expect(read()).toContain("[REDACTED]");
    expect(read()).not.toContain("hunter2");
    expect(read()).not.toContain("sekret");
  });

  it("redacts session cookies and MFA backup codes while preserving event metadata", () => {
    const { stream, read } = captureStream();
    const logger = createLogger({ level: "info", name: "test" }, stream);
    const sentinels = {
      backupCode: "top-level-backup-code-sentinel",
      backupCodes: [
        "first-backup-code-sentinel",
        "second-backup-code-sentinel",
      ],
      cookie: "top-level-cookie-sentinel",
      nestedBackupCode: "nested-backup-code-sentinel",
      nestedBackupCodes: [
        "nested-first-backup-code-sentinel",
        "nested-second-backup-code-sentinel",
      ],
      nestedCookie: "nested-cookie-sentinel",
      headerAuthorization: "header-authorization-sentinel",
      headerCookie: "header-cookie-sentinel",
      reqHeaderAuthorization: "req-header-authorization-sentinel",
      reqHeaderCookie: "req-header-cookie-sentinel",
    };
    const body = bodyCredentials("body");
    const reqBody = bodyCredentials("req-body");
    const expectedSentinels = [
      ...Object.values(sentinels),
      ...Object.values(body),
      ...Object.values(reqBody),
    ].flat();

    logger.info(
      {
        event: "mfa-challenge-completed",
        requestId: "req-safe",
        backupCode: sentinels.backupCode,
        backupCodes: sentinels.backupCodes,
        cookie: sentinels.cookie,
        auth: {
          backupCode: sentinels.nestedBackupCode,
          backupCodes: sentinels.nestedBackupCodes,
          cookie: sentinels.nestedCookie,
        },
        body,
        req: {
          body: reqBody,
          headers: {
            authorization: sentinels.reqHeaderAuthorization,
            cookie: sentinels.reqHeaderCookie,
          },
        },
        headers: {
          authorization: sentinels.headerAuthorization,
          cookie: sentinels.headerCookie,
        },
      },
      "MFA challenge completed",
    );

    const output = read();
    const line = JSON.parse(output.trim()) as Record<string, unknown>;
    expect(output).toContain("[REDACTED]");
    for (const sentinel of expectedSentinels) {
      expect(output).not.toContain(sentinel);
    }
    expect(line["event"]).toBe("mfa-challenge-completed");
    expect(line["requestId"]).toBe("req-safe");
    expect(line["msg"]).toBe("MFA challenge completed");
  });

  it("redacts monitor header values, secrets and auth while keeping names", () => {
    const { stream, read } = captureStream();
    const logger = createLogger({ level: "info", name: "test" }, stream);
    logger.info(
      {
        monitor: {
          headers: [{ name: "X-Api-Key", value: "header-value-sentinel" }],
          secrets: [{ slot: "auth.token", value: "secret-value-sentinel" }],
          auth: { type: "bearer", token: "auth-token-sentinel" },
        },
        headers: { "x-api-key": { value: "keyed-value-sentinel" } },
        secrets: { "auth.token": "top-secrets-sentinel" },
        auth: "top-auth-sentinel",
        monitorId: "m-1",
      },
      "monitor",
    );
    const out = read();
    for (const sentinel of [
      "header-value-sentinel",
      "secret-value-sentinel",
      "auth-token-sentinel",
      "keyed-value-sentinel",
      "top-secrets-sentinel",
      "top-auth-sentinel",
    ]) {
      expect(out).not.toContain(sentinel);
    }
    expect(out).toContain("X-Api-Key");
    expect(out).toContain('"monitorId":"m-1"');
  });

  it("redacts the credential key map when an env object is logged", () => {
    const { stream, read } = captureStream();
    const logger = createLogger({ level: "info", name: "test" }, stream);
    logger.info(
      {
        CREDENTIAL_ENCRYPTION_KEYS: { v1: "top-key-sentinel" },
        env: { CREDENTIAL_ENCRYPTION_KEYS: { v1: "nested-key-sentinel" } },
      },
      "env",
    );
    const output = read();
    const line = JSON.parse(output.trim()) as Record<string, unknown>;
    expect(line["msg"]).toBe("env");
    expect(line["CREDENTIAL_ENCRYPTION_KEYS"]).toBe("[REDACTED]");
    expect(line["env"]).toEqual({
      CREDENTIAL_ENCRYPTION_KEYS: "[REDACTED]",
    });
    expect(output).not.toContain("top-key-sentinel");
    expect(output).not.toContain("nested-key-sentinel");
  });
});
