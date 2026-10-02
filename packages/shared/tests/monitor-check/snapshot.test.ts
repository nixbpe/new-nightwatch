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
import { configFor, createTestPki, deps, first } from "./fixtures";

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

/** Answers with exact bytes, so tests control the status line and non-ASCII octets. */
async function serveRaw(reply: Buffer | string) {
  const server = await startRawServer({
    onRequest: ({ socket }) => {
      socket.end(Buffer.from(reply as string, "latin1"));
    },
  });
  servers.push(server);
  return server;
}

function response(options: {
  line?: string;
  headers?: [string, string][];
  body?: Buffer | string;
}): Buffer {
  const body = Buffer.isBuffer(options.body)
    ? options.body
    : Buffer.from(options.body ?? "", "utf8");
  const pairs: [string, string][] = [
    ...(options.headers ?? []),
    ["Content-Length", String(body.length)],
  ];
  const headers = pairs
    .map(([name, value]) => `${name}: ${value}`)
    .join("\r\n");
  return Buffer.concat([
    Buffer.from(
      `${options.line ?? "HTTP/1.1 200 OK"}\r\n${headers}\r\n\r\n`,
      "latin1",
    ),
    body,
  ]);
}

async function check(
  reply: Buffer,
  overrides: Partial<NormalizedMonitorConfig> = {},
  secrets: Record<string, string> = {},
) {
  const server = await serveRaw(reply);
  const result = await runCheck(
    configFor("http", server.port, overrides),
    secrets,
    deps(),
  );
  const snapshot = result.responseSnapshot;
  if (snapshot === undefined) throw new Error("expected a snapshot");
  return snapshot;
}

const secretHeader = (id: string, name: string) => ({
  id,
  name,
  secret: true,
});

describe("status line", () => {
  it("keeps HTTP/1.0 and the reason phrase", async () => {
    const snapshot = await check(
      response({ line: "HTTP/1.0 503 Service Unavailable" }),
    );
    expect(snapshot.statusLine).toEqual({
      httpVersion: "HTTP/1.0",
      status: 503,
      reasonPhrase: "Service Unavailable",
    });
    expect(snapshot.detailOmitted).toBeNull();
  });

  it("reports a missing reason phrase as null", async () => {
    const snapshot = await check(response({ line: "HTTP/1.1 200" }));
    expect(snapshot.statusLine).toEqual({
      httpVersion: "HTTP/1.1",
      status: 200,
      reasonPhrase: null,
    });
  });

  it("cuts a reason phrase at 128 characters", async () => {
    const snapshot = await check(
      response({ line: `HTTP/1.1 200 ${"r".repeat(200)}` }),
    );
    expect(snapshot.statusLine?.reasonPhrase).toBe("r".repeat(128));
  });
});

describe("header redaction", () => {
  it("masks the denylisted headers and the monitor's secret header names", async () => {
    const snapshot = await check(
      response({
        headers: [
          ["Set-Cookie", "sid=abc"],
          ["Authorization", "Bearer echoed"],
          ["WWW-Authenticate", "Basic realm=x"],
          ["Proxy-Authenticate", "Basic"],
          ["X-Custom-Secret", "plain-value"],
          ["X-Api-Key", "k"],
          ["X-Request-Id", "req-1"],
        ],
      }),
      {
        headers: [secretHeader("h1", "X-Custom-Secret")],
        auth: { type: "apiKey", headerName: "X-Api-Key" },
      },
      { "header.h1": "unrelated-secret", "auth.apiKey": "key-value" },
    );
    const byName = Object.fromEntries(
      snapshot.headers.map((header) => [header.name, header]),
    );
    for (const name of [
      "set-cookie",
      "authorization",
      "www-authenticate",
      "proxy-authenticate",
      "x-custom-secret",
      "x-api-key",
    ]) {
      expect(byName[name]).toEqual({ name, value: "•••", redacted: true });
    }
    expect(byName["x-request-id"]).toEqual({
      name: "x-request-id",
      value: "req-1",
      redacted: false,
    });
  });

  it("masks plain, JSON-escaped and URL-encoded secrets in a header, the reason phrase and the body", async () => {
    const secret = 'sec"ret value/1';
    const forms = [
      secret,
      JSON.stringify(secret).slice(1, -1),
      encodeURIComponent(secret),
    ];
    const snapshot = await check(
      response({
        line: `HTTP/1.1 200 ${forms[0] ?? ""}`,
        headers: [
          ["Content-Type", "text/plain"],
          ["X-Echo", forms.join(" | ")],
          [`X-${encodeURIComponent(secret).replace(/%/g, "")}`, "v"],
        ],
        body: forms.join("\n"),
      }),
      { headers: [secretHeader("h1", "X-Own")] },
      { "header.h1": secret },
    );
    const text = JSON.stringify(snapshot);
    for (const form of forms) expect(text).not.toContain(form);
    expect(snapshot.statusLine?.reasonPhrase).toBe("•••");
    const echo = snapshot.headers.find((header) => header.name === "x-echo");
    expect(echo).toEqual({
      name: "x-echo",
      value: "••• | ••• | •••",
      redacted: true,
    });
    expect(snapshot.body).toMatchObject({
      kind: "text",
      text: "•••\n•••\n•••",
    });
  });

  it("masks a secret in a header name", async () => {
    const snapshot = await check(
      response({ headers: [["X-tokenvalue123", "v"]] }),
      { headers: [secretHeader("h1", "X-Own")] },
      { "header.h1": "tokenvalue123" },
    );
    expect(JSON.stringify(snapshot)).not.toContain("tokenvalue123");
    expect(snapshot.headers.find((h) => h.name === "x-•••")?.redacted).toBe(
      true,
    );
  });

  it("masks a non-ASCII secret echoed as UTF-8 octets in a header (decoded latin1)", async () => {
    const secret = "รหัสลับ";
    const snapshot = await check(
      response({
        headers: [
          ["X-Echo", `v=${Buffer.from(secret, "utf8").toString("latin1")}`],
        ],
      }),
      { headers: [secretHeader("h1", "X-Own")] },
      { "header.h1": secret },
    );
    const echo = snapshot.headers.find((header) => header.name === "x-echo");
    expect(echo).toEqual({ name: "x-echo", value: "v=•••", redacted: true });
  });

  it("masks a non-ASCII secret in an iso-8859-1 body and a utf-8 body", async () => {
    const secret = "café-ลับ";
    const latin1 = await check(
      response({
        headers: [["Content-Type", "text/plain; charset=iso-8859-1"]],
        body: Buffer.from(
          `x ${Buffer.from(secret, "utf8").toString("latin1")} y`,
          "latin1",
        ),
      }),
      { headers: [secretHeader("h1", "X-Own")] },
      { "header.h1": secret },
    );
    expect(latin1.body).toMatchObject({ kind: "text", text: "x ••• y" });
    const utf8 = await check(
      response({
        headers: [["Content-Type", "text/plain; charset=utf-8"]],
        body: `x ${secret} y`,
      }),
      { headers: [secretHeader("h1", "X-Own")] },
      { "header.h1": secret },
    );
    expect(utf8.body).toMatchObject({ kind: "text", text: "x ••• y" });
  });

  it("masks the Basic credential's base64 form echoed by the target", async () => {
    const encoded = Buffer.from("user:pass").toString("base64");
    const snapshot = await check(
      response({
        headers: [["Content-Type", "text/plain"]],
        body: `got ${encoded}`,
      }),
      { auth: { type: "basic" } },
      { "auth.username": "user", "auth.password": "pass" },
    );
    expect(snapshot.body).toMatchObject({ text: "got •••" });
  });
});

describe("caps", () => {
  it("keeps 50 headers and flags the rest", async () => {
    const headers: [string, string][] = Array.from({ length: 60 }, (_, i) => [
      `X-H${String(i)}`,
      "v",
    ]);
    const snapshot = await check(response({ headers }));
    expect(snapshot.headers).toHaveLength(50);
    expect(snapshot.headersTruncated).toBe(true);
  });

  it("cuts a header name at 256 and a value at 1 KiB, and flags it", async () => {
    const snapshot = await check(
      response({
        headers: [[`X-${"n".repeat(300)}`, "v".repeat(2000)]],
      }),
    );
    const header = first(snapshot.headers);
    expect(header.name).toBe(`x-${"n".repeat(254)}`);
    expect(header.value).toBe("v".repeat(1024));
    expect(snapshot.headersTruncated).toBe(true);
  });

  it("does not flag headers that fit", async () => {
    const snapshot = await check(response({ headers: [["X-A", "b"]] }));
    expect(snapshot.headersTruncated).toBe(false);
  });

  it("cuts a body at 16 KiB and reports the bytes read", async () => {
    const snapshot = await check(
      response({
        headers: [["Content-Type", "text/plain"]],
        body: "b".repeat(20 * 1024),
      }),
    );
    expect(snapshot.body).toEqual({
      kind: "text",
      text: "b".repeat(16 * 1024),
      truncated: true,
      totalBytesRead: 20 * 1024,
    });
  });

  it("never splits a multi-byte character at the 16 KiB cut", async () => {
    const snapshot = await check(
      response({
        headers: [["Content-Type", "text/plain"]],
        body: "ก".repeat(8000),
      }),
    );
    if (snapshot.body?.kind !== "text") throw new Error("expected text");
    expect(Buffer.byteLength(snapshot.body.text)).toBeLessThanOrEqual(16384);
    expect(snapshot.body.text).toBe("ก".repeat(5461));
    expect(snapshot.body.truncated).toBe(true);
  });

  it("redacts before cutting, so a secret straddling 16 KiB is not shown in part", async () => {
    const secret = "S3cretStraddle";
    const body = `${"a".repeat(16 * 1024 - 5)}${secret}${"z".repeat(100)}`;
    const snapshot = await check(
      response({ headers: [["Content-Type", "text/plain"]], body }),
      { headers: [secretHeader("h1", "X-Own")] },
      { "header.h1": secret },
    );
    if (snapshot.body?.kind !== "text") throw new Error("expected text");
    // The mask is cut by bytes after redaction; no fragment of the secret remains.
    expect(snapshot.body.text).toBe(`${"a".repeat(16 * 1024 - 5)}•`);
    expect(snapshot.body.text).not.toContain("S3cret");
  });
});

describe("body kind", () => {
  it.each([
    "text/html",
    "application/json",
    "application/problem+json",
    "application/xml",
    "application/atom+xml",
  ])("stores %s as text", async (type) => {
    const snapshot = await check(
      response({
        headers: [["Content-Type", `${type}; charset=utf-8`]],
        body: "ok",
      }),
    );
    expect(snapshot.body).toEqual({
      kind: "text",
      text: "ok",
      truncated: false,
      totalBytesRead: 2,
    });
  });

  it.each(["image/png", "application/octet-stream", "application/pdf"])(
    "omits %s as not_text",
    async (type) => {
      const snapshot = await check(
        response({ headers: [["Content-Type", type]], body: "xx" }),
      );
      expect(snapshot.body).toEqual({ kind: "omitted", reason: "not_text" });
    },
  );

  it("omits a missing content-type as not_text", async () => {
    const snapshot = await check(response({ body: "xx" }));
    expect(snapshot.body).toEqual({ kind: "omitted", reason: "not_text" });
  });

  it("reports an empty body as no_body", async () => {
    const snapshot = await check(
      response({ headers: [["Content-Type", "text/plain"]] }),
    );
    expect(snapshot.body).toEqual({ kind: "omitted", reason: "no_body" });
  });

  it("reports invalid utf-8 as undecodable", async () => {
    const snapshot = await check(
      response({
        headers: [["Content-Type", "text/plain"]],
        body: Buffer.from([0xff, 0xfe, 0x41]),
      }),
    );
    expect(snapshot.body).toEqual({ kind: "omitted", reason: "undecodable" });
  });

  it("picks the body kind from the raw content-type, before redaction", async () => {
    const snapshot = await check(
      response({
        headers: [["Content-Type", "text/plain"]],
        body: "hello",
      }),
      { headers: [secretHeader("h1", "X-Own")] },
      { "header.h1": "text" },
    );
    expect(snapshot.headers.find((h) => h.name === "content-type")?.value).toBe(
      "•••/plain",
    );
    expect(snapshot.body).toMatchObject({ kind: "text", text: "hello" });
  });
});

describe("request_values", () => {
  const reply = () =>
    response({
      line: "HTTP/1.0 201 Created Reflect",
      headers: [
        ["Content-Type", "text/plain"],
        ["X-Echo", "token=abc"],
      ],
      body: "token=abc",
    });
  const omitted = {
    detailOmitted: "request_values",
    statusLine: {
      httpVersion: "HTTP/1.0",
      status: 201,
      reasonPhrase: null,
    },
    headers: [],
    headersTruncated: false,
    body: { kind: "omitted", reason: "request_values" },
  } as const;

  it("omits detail when the config URL has a query", async () => {
    const server = await serveRaw(reply());
    const result = await runCheck(
      {
        ...configFor("http", server.port),
        url: `http://target.nw-test.internal:${String(server.port)}/p?token=abc`,
      },
      {},
      deps(),
    );
    expect(result.responseSnapshot).toMatchObject(omitted);
  });

  it("omits detail when query params are appended by buildCheckUrl", async () => {
    const snapshot = await check(reply(), {
      queryParams: [{ name: "token", value: "abc" }],
    });
    expect(snapshot).toMatchObject(omitted);
  });

  it("omits detail for a POST that sends a body", async () => {
    const snapshot = await check(reply(), {
      method: "POST",
      body: { type: "text", content: "token=abc" },
    });
    expect(snapshot).toMatchObject(omitted);
  });

  it("keeps detail for a GET whose config has a body that is not sent", async () => {
    const snapshot = await check(reply(), {
      method: "GET",
      body: { type: "text", content: "token=abc" },
    });
    expect(snapshot.detailOmitted).toBeNull();
    expect(snapshot.statusLine?.reasonPhrase).toBe("Created Reflect");
    expect(snapshot.body).toMatchObject({ kind: "text", text: "token=abc" });
  });

  it("keeps detail for a GET without query", async () => {
    const snapshot = await check(reply());
    expect(snapshot.detailOmitted).toBeNull();
    expect(snapshot.headers.map((h) => h.name)).toContain("x-echo");
  });

  it("keeps no response detail when a request with a query gets no response", async () => {
    const snapshot = await check(Buffer.alloc(0), {
      queryParams: [{ name: "token", value: "abc" }],
    });
    expect(snapshot).toMatchObject({
      detailOmitted: "request_values",
      statusLine: null,
      headers: [],
      body: null,
    });
  });

  it("does not use a query value as a redaction needle", async () => {
    const snapshot = await check(
      response({
        headers: [["Content-Type", "application/json"]],
        body: "{}",
      }),
      { method: "GET" },
      {},
    );
    expect(snapshot.headers.find((h) => h.name === "content-type")?.value).toBe(
      "application/json",
    );
  });
});

describe("no response", () => {
  it("returns an empty snapshot for a failed redirect", async () => {
    const server = await startRawServer({
      onRequest: ({ socket }) => {
        socket.end(
          response({
            line: "HTTP/1.1 302 Found",
            headers: [["Location", "/health"]],
          }),
        );
      },
    });
    servers.push(server);
    const result = await runCheck(configFor("http", server.port), {}, deps());
    expect(result.failureReason).toBe("redirect_limit");
    expect(result.responseSnapshot).toEqual({
      url: result.url,
      detailOmitted: null,
      statusLine: null,
      headers: [],
      headersTruncated: false,
      body: null,
    });
  });
});
