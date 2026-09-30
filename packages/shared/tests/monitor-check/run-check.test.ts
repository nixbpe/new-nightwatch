import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  runCheck,
  type NormalizedMonitorConfig,
} from "../../src/monitor-check";
import {
  startRawServer,
  type RawServer,
  type TestPki,
} from "../outbound-http/fixtures";
import {
  configFor,
  createTestPki,
  deps,
  first,
  serveReplies,
  TARGET_HOST,
} from "./fixtures";

let pki: TestPki;
const servers: RawServer[] = [];
beforeAll(() => {
  pki = createTestPki();
}, 60_000);
afterAll(() => {
  pki.dispose();
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function serve(
  reply: Parameters<typeof serveReplies>[0],
  tls?: Parameters<typeof serveReplies>[1],
) {
  const server = await serveReplies(reply, tls);
  servers.push(server);
  return server;
}

const failOutcome = { outcome: "fail" } as const;
const allNotEvaluated = (result: Awaited<ReturnType<typeof runCheck>>) =>
  result.assertions.every(
    (assertion) =>
      assertion.status === "not_evaluated" &&
      assertion.reason === "no_response",
  );

const threeAssertions: NormalizedMonitorConfig["assertions"] = [
  { kind: "jsonPathEquals", pathSegments: ["a"], expectedValue: 1 },
  { kind: "bodyContains", text: "x" },
  { kind: "responseTimeBelow", ms: 1000 },
];

describe("expected status and outcome", () => {
  it("passes when status is in a range and every assertion passes", async () => {
    const server = await serve(() => ({ body: "ok" }));
    const result = await runCheck(
      configFor("http", server.port, {
        assertions: [{ kind: "bodyContains", text: "ok" }],
      }),
      {},
      deps(),
    );
    expect(result).toMatchObject({
      outcome: "pass",
      httpStatus: 200,
      failureReason: null,
      tlsReason: null,
      tls: null,
      evaluatedFromPrefix: false,
    });
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("uses the injected clock for checkedAt", async () => {
    const server = await serve(() => ({}));
    const at = new Date("2026-01-02T03:04:05.000Z");
    const result = await runCheck(
      configFor("http", server.port),
      {},
      deps({ clock: () => at }),
    );
    expect(result.checkedAt).toBe(at);
  });

  it("fails with http_status outside every range and still evaluates assertions", async () => {
    const server = await serve(() => ({
      status: "500 Internal Server Error",
      body: "x",
    }));
    const result = await runCheck(
      configFor("http", server.port, {
        assertions: [{ kind: "bodyContains", text: "x" }],
      }),
      {},
      deps(),
    );
    expect(result).toMatchObject({
      outcome: "fail",
      httpStatus: 500,
      failureReason: "http_status",
    });
    expect(result.assertions[0]).toMatchObject({ status: "pass" });
  });

  it("accepts a status from a second range", async () => {
    const server = await serve(() => ({ status: "404 Not Found" }));
    const result = await runCheck(
      configFor("http", server.port, {
        expectedStatus: [
          { from: 200, to: 299 },
          { from: 404, to: 404 },
        ],
      }),
      {},
      deps(),
    );
    expect(result.outcome).toBe("pass");
  });

  it("passes when a prefix-ended JSONPath is the only assertion short of pass", async () => {
    const pad = "x".repeat(1.2 * 1024 * 1024);
    const server = await serve(() => ({
      headers: { "Content-Type": "application/json" },
      body: `{"pad":"${pad}","status":"ok"}`,
    }));
    const result = await runCheck(
      configFor("http", server.port, {
        assertions: [
          {
            kind: "jsonPathEquals",
            pathSegments: ["status"],
            expectedValue: "ok",
          },
        ],
      }),
      {},
      deps(),
    );
    expect(result).toMatchObject({
      outcome: "pass",
      failureReason: null,
      evaluatedFromPrefix: true,
    });
    expect(first(result.assertions)).toMatchObject({
      status: "not_evaluated",
      reason: "prefix_ended",
    });
  });

  it("fails the check, not check_error, for an oversized malformed JSON body", async () => {
    const pad = "x".repeat(1.2 * 1024 * 1024);
    const server = await serve(() => ({ body: `{'status':'ok',${pad}` }));
    const result = await runCheck(
      configFor("http", server.port, {
        assertions: [
          {
            kind: "jsonPathEquals",
            pathSegments: ["status"],
            expectedValue: "ok",
          },
        ],
      }),
      {},
      deps(),
    );
    expect(result).toMatchObject({
      outcome: "fail",
      failureReason: "assertion_failed",
    });
    expect(first(result.assertions).reason).toBe("not_json");
  });

  it("still fails when another assertion fails beside a prefix-ended one", async () => {
    const pad = "x".repeat(1.2 * 1024 * 1024);
    const server = await serve(() => ({
      headers: { "Content-Type": "application/json" },
      body: `{"pad":"${pad}","status":"ok"}`,
    }));
    const result = await runCheck(
      configFor("http", server.port, {
        assertions: [
          {
            kind: "jsonPathEquals",
            pathSegments: ["status"],
            expectedValue: "ok",
          },
          { kind: "responseTimeBelow", ms: 0 },
        ],
      }),
      {},
      deps(),
    );
    expect(result).toMatchObject({
      outcome: "fail",
      failureReason: "assertion_failed",
    });
  });

  it("fails with assertion_failed when status is fine but an assertion fails", async () => {
    const server = await serve(() => ({ body: "hello" }));
    const result = await runCheck(
      configFor("http", server.port, {
        assertions: [{ kind: "bodyContains", text: "bye" }],
      }),
      {},
      deps(),
    );
    expect(result).toMatchObject({
      outcome: "fail",
      failureReason: "assertion_failed",
    });
  });
});

describe("no response (AC-32) and classification (AC-10)", () => {
  const withThree = (port = 8080) =>
    configFor("http", port, { assertions: threeAssertions });

  it("dns_not_found is a fail with every assertion not evaluated", async () => {
    const result = await runCheck(
      withThree(),
      {},
      deps({
        resolver: () =>
          Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })),
      }),
    );
    expect(result).toMatchObject({
      ...failOutcome,
      failureReason: "dns_not_found",
      httpStatus: null,
      responseTimeMs: null,
    });
    expect(result.assertions).toHaveLength(3);
    expect(allNotEvaluated(result)).toBe(true);
  });

  it("resolver_unavailable is a check_error", async () => {
    const result = await runCheck(
      withThree(),
      {},
      deps({
        resolver: () =>
          Promise.reject(Object.assign(new Error("x"), { code: "EAI_AGAIN" })),
      }),
    );
    expect(result).toMatchObject({
      outcome: "check_error",
      failureReason: "resolver_unavailable",
    });
    expect(allNotEvaluated(result)).toBe(true);
  });

  it("blocked_address is a fail when the name resolves to a private address", async () => {
    const result = await runCheck(
      withThree(),
      {},
      deps({
        resolver: () => Promise.resolve(["10.0.0.1"]),
        testAllowedHosts: [],
      }),
    );
    expect(result).toMatchObject({
      ...failOutcome,
      failureReason: "blocked_address",
    });
    expect(allNotEvaluated(result)).toBe(true);
  });

  it("timeout is a fail", async () => {
    // Accepts the connection and never answers.
    const silent = await startRawServer({});
    servers.push(silent);
    const result = await runCheck(
      { ...withThree(silent.port), timeoutSeconds: 1 },
      {},
      deps(),
    );
    expect(result).toMatchObject({ ...failOutcome, failureReason: "timeout" });
    expect(allNotEvaluated(result)).toBe(true);
  }, 10_000);

  it("timeout after a completed handshake keeps the certificate", async () => {
    // Completes TLS, then never answers.
    const silent = await startRawServer({ tls: pki.leaf.good });
    servers.push(silent);
    const result = await runCheck(
      { ...configFor("https", silent.port), timeoutSeconds: 2 },
      {},
      deps({ ca: pki.ca }),
    );
    expect(result).toMatchObject({
      ...failOutcome,
      failureReason: "timeout",
      tlsReason: null,
    });
    expect(result.tls?.notAfter).toBeInstanceOf(Date);
    expect(result.tls?.host).toBe(TARGET_HOST);
  }, 10_000);

  it("connect_refused is a fail", async () => {
    const server = await serve(() => ({}));
    const port = server.port;
    await server.close();
    const result = await runCheck(withThree(port), {}, deps());
    expect(result).toMatchObject({
      ...failOutcome,
      failureReason: "connect_refused",
    });
    expect(allNotEvaluated(result)).toBe(true);
  });

  it("redirect_limit is a fail", async () => {
    const server = await serve(() => ({
      status: "302 Found",
      headers: { Location: "/loop" },
    }));
    const result = await runCheck(
      configFor("http", server.port, { assertions: threeAssertions }),
      {},
      deps(),
    );
    expect(result).toMatchObject({
      ...failOutcome,
      failureReason: "redirect_limit",
    });
    expect(allNotEvaluated(result)).toBe(true);
  });

  it.each([
    ["self-signed", "selfSigned", "self_signed"],
    ["expired", "expired", "expired"],
    ["wrong name", "wrongName", "hostname_mismatch"],
    ["unknown CA", "unknownCa", "untrusted"],
  ] as const)(
    "%s certificate is tls_invalid with tlsReason %s",
    async (_n, leaf, tlsReason) => {
      const server = await serve(() => ({}), pki.leaf[leaf]);
      const result = await runCheck(
        configFor("https", server.port, { assertions: threeAssertions }),
        {},
        deps({ ca: pki.ca }),
      );
      expect(result).toMatchObject({
        ...failOutcome,
        failureReason: "tls_invalid",
        tlsReason,
      });
      expect(allNotEvaluated(result)).toBe(true);
    },
  );

  it("returns issuer and notAfter of a valid certificate", async () => {
    const server = await serve(() => ({}), pki.leaf.good);
    const result = await runCheck(
      configFor("https", server.port),
      {},
      deps({ ca: pki.ca }),
    );
    expect(result.outcome).toBe("pass");
    expect(result.tls?.issuer).toBe("NW Test");
    expect(result.tls?.host).toBe(TARGET_HOST);
    expect(result.tls?.notAfter).toBeInstanceOf(Date);
  });
});

describe("pre-validation of the saved config", () => {
  it("does not connect for a loopback literal and reports blocked_address", async () => {
    const server = await serve(() => ({}));
    const result = await runCheck(
      {
        ...configFor("http", server.port),
        url: `http://127.0.0.1:${String(server.port)}/`,
      },
      {},
      deps(),
    );
    expect(result).toMatchObject({
      outcome: "fail",
      failureReason: "blocked_address",
    });
    expect(server.connections()).toBe(0);
  });

  it.each([
    ["ftp scheme", { url: "ftp://target.nw-test.internal/" }],
    ["userinfo", { url: `http://u:p@${TARGET_HOST}/` }],
    [
      "forbidden header",
      { headers: [{ name: "Host", value: "evil", secret: false }] },
    ],
    [
      "CRLF in a header value",
      { headers: [{ name: "X-A", value: "a\r\nX-B: b", secret: false }] },
    ],
  ] as const)(
    "%s is executor_error and sends nothing",
    async (_name, override) => {
      const server = await serve(() => ({}));
      const result = await runCheck(
        {
          ...configFor("http", server.port),
          ...override,
        } as NormalizedMonitorConfig,
        {},
        deps(),
      );
      expect(result).toMatchObject({
        outcome: "check_error",
        failureReason: "executor_error",
      });
      expect(server.connections()).toBe(0);
    },
  );

  it("is executor_error when a secret slot the config needs is missing", async () => {
    const server = await serve(() => ({}));
    const result = await runCheck(
      configFor("http", server.port, { auth: { type: "bearer" } }),
      {},
      deps(),
    );
    expect(result).toMatchObject({
      outcome: "check_error",
      failureReason: "executor_error",
    });
    expect(server.connections()).toBe(0);
  });
});

describe("request building", () => {
  const head = (server: RawServer) => first(server.requests).head;
  const headerValues = (requestHead: string, name: string) =>
    requestHead
      .split("\r\n")
      .slice(1)
      .map((line) => line.split(/:\s*/, 2) as [string, string])
      .filter(([header]) => header.toLowerCase() === name.toLowerCase())
      .map(([, value]) => value);

  it("appends query params and masks them in the result url", async () => {
    const server = await serve(() => ({}));
    const result = await runCheck(
      configFor("http", server.port, {
        url: `http://${TARGET_HOST}:${String(server.port)}/p?x=1`,
        queryParams: [
          { name: "a", value: "1" },
          { name: "b", value: "hello world" },
        ],
      }),
      {},
      deps(),
    );
    expect(head(server).split("\r\n")[0]).toBe(
      "GET /p?x=1&a=1&b=hello+world HTTP/1.1",
    );
    expect(result.url).toBe(
      `http://${TARGET_HOST}:${String(server.port)}/p?x=•••&a=•••&b=•••`,
    );
  });

  it.each([
    ["%20", "/p?q=a%20b", "/p?q=a%20b&n=1"],
    ["~", "/p?q=a~b", "/p?q=a~b&n=1"],
    ["a bare flag", "/p?flag", "/p?flag&n=1"],
    ["a bare flag and an encoded slash", "/p?flag&r=%2F", "/p?flag&r=%2F&n=1"],
  ])("keeps the saved query bytes with %s", async (_name, path, sent) => {
    const server = await serve(() => ({}));
    await runCheck(
      configFor("http", server.port, {
        url: `http://${TARGET_HOST}:${String(server.port)}${path}`,
        queryParams: [{ name: "n", value: "1" }],
      }),
      {},
      deps(),
    );
    expect(head(server).split("\r\n")[0]).toBe(`GET ${sent} HTTP/1.1`);
  });

  it("leaves a saved query untouched when there are no params", async () => {
    const server = await serve(() => ({}));
    await runCheck(
      configFor("http", server.port, {
        url: `http://${TARGET_HOST}:${String(server.port)}/p?flag&q=a%20b~`,
      }),
      {},
      deps(),
    );
    expect(head(server).split("\r\n")[0]).toBe("GET /p?flag&q=a%20b~ HTTP/1.1");
  });

  it("returns the whole masked url even past 200 characters", async () => {
    const server = await serve(() => ({}));
    const path = `/${"a".repeat(300)}`;
    const result = await runCheck(
      configFor("http", server.port, {
        url: `http://${TARGET_HOST}:${String(server.port)}${path}`,
        queryParams: [{ name: "k", value: "v" }],
      }),
      {},
      deps(),
    );
    expect(result.url).toBe(
      `http://${TARGET_HOST}:${String(server.port)}${path}?k=•••`,
    );
    expect(result.url.length).toBeGreaterThan(300);
  });

  it("is executor_error with no connection when query params push the url past 2048", async () => {
    const server = await serve(() => ({}));
    const base = `http://${TARGET_HOST}:${String(server.port)}/`;
    const room = 2048 - base.length - "?k=".length;
    const fits = await runCheck(
      configFor("http", server.port, {
        url: base,
        queryParams: [{ name: "k", value: "v".repeat(room) }],
      }),
      {},
      deps(),
    );
    expect(fits.outcome).toBe("pass");
    const over = await runCheck(
      configFor("http", server.port, {
        url: base,
        queryParams: [{ name: "k", value: "v".repeat(room + 1) }],
      }),
      {},
      deps(),
    );
    expect(over).toMatchObject({
      outcome: "check_error",
      failureReason: "executor_error",
    });
    expect(server.connections()).toBe(1);
  });

  it.each(["GET", "HEAD"] as const)(
    "%s sends no body and no content type",
    async (method) => {
      const server = await serve(() => ({}));
      await runCheck(
        configFor("http", server.port, {
          method,
          body: { type: "json", content: '{"a":1}' },
        }),
        {},
        deps(),
      );
      expect(head(server).toLowerCase()).not.toMatch(
        /content-length|content-type/,
      );
    },
  );

  it("POST sends the body with a default content type", async () => {
    const server = await serve(() => ({}));
    await runCheck(
      configFor("http", server.port, {
        method: "POST",
        body: { type: "json", content: '{"a":1}' },
      }),
      {},
      deps(),
    );
    expect(head(server).toLowerCase()).toContain(
      "content-type: application/json",
    );
    expect(head(server).toLowerCase()).toContain("content-length: 7");
  });

  it("keeps a user content type on POST", async () => {
    const server = await serve(() => ({}));
    await runCheck(
      configFor("http", server.port, {
        method: "POST",
        body: { type: "text", content: "hi" },
        headers: [
          {
            name: "content-type",
            value: "application/x-custom",
            secret: false,
          },
        ],
      }),
      {},
      deps(),
    );
    expect(head(server).toLowerCase()).toContain(
      "content-type: application/x-custom",
    );
    expect(head(server).toLowerCase()).not.toContain("text/plain");
  });

  it.each([
    [
      { type: "bearer" },
      { "auth.token": "tok-1" },
      ["Authorization", "Bearer tok-1"],
    ],
    [
      { type: "basic" },
      { "auth.username": "alice", "auth.password": "pw" },
      ["Authorization", `Basic ${Buffer.from("alice:pw").toString("base64")}`],
    ],
    [
      { type: "apiKey", headerName: "X-Api-Key" },
      { "auth.apiKey": "k-1" },
      ["X-Api-Key", "k-1"],
    ],
  ] as const)("sends %j auth", async (auth, secrets, [name, value]) => {
    const server = await serve(() => ({}));
    await runCheck(configFor("http", server.port, { auth }), secrets, deps());
    expect(headerValues(head(server), name)).toEqual([value]);
  });

  it("replaces a same-named user header, ignoring case, with the auth header", async () => {
    const server = await serve(() => ({}));
    await runCheck(
      configFor("http", server.port, {
        auth: { type: "apiKey", headerName: "X-Api-Key" },
        headers: [
          { name: "x-api-key", value: "user-value", secret: false },
          { name: "authorization", value: "user-auth", secret: false },
        ],
      }),
      { "auth.apiKey": "k-1" },
      deps(),
    );
    expect(headerValues(head(server), "x-api-key")).toEqual(["k-1"]);
    expect(headerValues(head(server), "authorization")).toEqual(["user-auth"]);
  });

  it("replaces a user Authorization header with a bearer token", async () => {
    const server = await serve(() => ({}));
    await runCheck(
      configFor("http", server.port, {
        auth: { type: "bearer" },
        headers: [{ name: "authorization", value: "user-auth", secret: false }],
      }),
      { "auth.token": "tok-1" },
      deps(),
    );
    expect(headerValues(head(server), "authorization")).toEqual([
      "Bearer tok-1",
    ]);
  });
});

describe("secret redaction (AC-43)", () => {
  it("masks header and Basic credential values an endpoint reflects", async () => {
    const server = await serve((requestHead) => ({
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ echo: requestHead }),
    }));
    const secrets = {
      "auth.username": "alice",
      "auth.password": "hunter2-Pw",
      "header.h1": "sk-live-9f8e7d",
    };
    const basic = Buffer.from("alice:hunter2-Pw").toString("base64");
    const result = await runCheck(
      configFor("http", server.port, {
        auth: { type: "basic" },
        headers: [{ id: "h1", name: "X-Token", secret: true }],
        assertions: [
          {
            kind: "jsonPathEquals",
            pathSegments: ["echo"],
            expectedValue: "nothing",
          },
          { kind: "bodyContains", text: "no-such-text" },
        ],
      }),
      secrets,
      deps(),
    );
    const [reflected, missing] = result.assertions;
    expect(reflected).toMatchObject({ reason: "value_mismatch" });
    expect(reflected?.actual).toContain("•••");
    expect(missing?.reason).toBe("text_not_found");
    const serialized = JSON.stringify(result);
    for (const leaked of ["hunter2-Pw", "sk-live-9f8e7d", basic]) {
      expect(serialized).not.toContain(leaked);
    }
  });
});
