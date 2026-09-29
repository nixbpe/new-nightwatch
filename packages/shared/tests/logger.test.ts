import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logger";

function captureStream() {
  let output = "";
  return {
    stream: { write: (chunk: string) => (output += chunk) },
    read: () => output,
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
      bodyPassword: "body-password-sentinel",
      bodyToken: "body-token-sentinel",
      bodySecret: "body-secret-sentinel",
      bodyBackupCode: "body-backup-code-sentinel",
      bodyBackupCodes: [
        "body-first-backup-code-sentinel",
        "body-second-backup-code-sentinel",
      ],
      bodyCookie: "body-cookie-sentinel",
      reqBodyPassword: "req-body-password-sentinel",
      reqBodyToken: "req-body-token-sentinel",
      reqBodySecret: "req-body-secret-sentinel",
      reqBodyBackupCode: "req-body-backup-code-sentinel",
      reqBodyBackupCodes: [
        "req-body-first-backup-code-sentinel",
        "req-body-second-backup-code-sentinel",
      ],
      reqBodyCookie: "req-body-cookie-sentinel",
      headerAuthorization: "header-authorization-sentinel",
      headerCookie: "header-cookie-sentinel",
      reqHeaderAuthorization: "req-header-authorization-sentinel",
      reqHeaderCookie: "req-header-cookie-sentinel",
    };

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
        body: {
          password: sentinels.bodyPassword,
          token: sentinels.bodyToken,
          secret: sentinels.bodySecret,
          backupCode: sentinels.bodyBackupCode,
          backupCodes: sentinels.bodyBackupCodes,
          cookie: sentinels.bodyCookie,
        },
        req: {
          body: {
            password: sentinels.reqBodyPassword,
            token: sentinels.reqBodyToken,
            secret: sentinels.reqBodySecret,
            backupCode: sentinels.reqBodyBackupCode,
            backupCodes: sentinels.reqBodyBackupCodes,
            cookie: sentinels.reqBodyCookie,
          },
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
    for (const sentinel of Object.values(sentinels).flat()) {
      expect(output).not.toContain(sentinel);
    }
    expect(line["event"]).toBe("mfa-challenge-completed");
    expect(line["requestId"]).toBe("req-safe");
    expect(line["msg"]).toBe("MFA challenge completed");
  });

  it("emits structured JSON with level, name and timestamp", () => {
    const { stream, read } = captureStream();
    const logger = createLogger(
      { level: "info", name: "nightwatch-api" },
      stream,
    );
    logger.info({ requestId: "req-1" }, "request completed");
    const line = JSON.parse(read().trim()) as Record<string, unknown>;
    expect(line["level"]).toBe(30);
    expect(line["name"]).toBe("nightwatch-api");
    expect(line["requestId"]).toBe("req-1");
    expect(line["msg"]).toBe("request completed");
    expect(typeof line["time"]).toBe("string");
  });

  it("suppresses records below the configured level", () => {
    const { stream, read } = captureStream();
    const logger = createLogger({ level: "warn", name: "test" }, stream);
    logger.info("quiet");
    logger.warn("loud");
    expect(read()).not.toContain("quiet");
    expect(read()).toContain("loud");
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
});
