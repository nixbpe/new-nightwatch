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
          ["Cookie", "sid=abc"],
          ["Proxy-Authorization", "Basic abc"],
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
      "cookie",
      "proxy-authorization",
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
    expect(header.redacted).toBe(false);
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

describe("final URL redaction", () => {
  async function redirected(
    location: string,
    overrides: Partial<NormalizedMonitorConfig>,
    secret: string,
  ) {
    let requests = 0;
    const server = await startRawServer({
      onRequest: ({ socket }) => {
        requests++;
        socket.end(
          requests === 1
            ? response({
                line: "HTTP/1.1 302 Found",
                headers: [["Location", location]],
              })
            : response({
                headers: [["Content-Type", "text/plain"]],
                body: "ok",
              }),
        );
      },
    });
    servers.push(server);
    const result = await runCheck(
      configFor("http", server.port, {
        headers: [secretHeader("h1", "X-Own")],
        ...overrides,
      }),
      { "header.h1": secret },
      deps(),
    );
    return result.responseSnapshot;
  }

  it.each([
    ["raw", "tok123", "/cb/tok123"],
    ["URL-encoded", "tok 123", "/cb/tok%20123"],
  ])(
    "masks a %s secret the target put in a Location path",
    async (_, secret, path) => {
      for (const overrides of [
        {},
        { queryParams: [{ name: "q", value: "v" }] },
      ]) {
        const snapshot = await redirected(path, overrides, secret);
        expect(snapshot?.url).toContain("/cb/•••");
        expect(snapshot?.url).not.toContain("123");
        expect(snapshot?.statusLine?.status).toBe(200);
      }
    },
  );
});

describe("NUL from the target", () => {
  it("replaces U+0000 with U+FFFD in the reason phrase, header name and value, and body", async () => {
    const snapshot = await check(
      response({
        line: "HTTP/1.1 200 a\u0000b",
        headers: [
          ["Content-Type", "text/plain"],
          ["X-N\u0000ame", "v\u0000al"],
        ],
        body: "x\u0000y",
      }),
    );
    expect(snapshot.statusLine?.reasonPhrase).toBe("a\uFFFDb");
    expect(snapshot.headers.find((h) => h.name === "x-n\uFFFDame")?.value).toBe(
      "v\uFFFDal",
    );
    expect(snapshot.body).toMatchObject({ text: "x\uFFFDy" });
    expect(JSON.stringify(snapshot)).not.toContain("\\u0000");
  });
});

describe("more caps and redaction", () => {
  it("cuts a header value at 1024 UTF-8 bytes on a character boundary", async () => {
    const snapshot = await check(
      response({ headers: [["X-Long", "\u00e9".repeat(800)]] }),
    );
    const header = first(snapshot.headers);
    expect(header.value).toBe("\u00e9".repeat(512));
    expect(Buffer.byteLength(header.value)).toBe(1024);
    expect(snapshot.headersTruncated).toBe(true);
  });

  it("flags truncated and reports bytes when the executor reads 1 MiB", async () => {
    const snapshot = await check(
      response({
        headers: [["Content-Type", "text/plain"]],
        body: "b".repeat(1024 * 1024 + 10),
      }),
    );
    expect(snapshot.body).toMatchObject({
      kind: "text",
      truncated: true,
      totalBytesRead: 1024 * 1024,
    });
  });

  it("masks a non-ASCII secret in the reason phrase and a header name", async () => {
    const secret = "\u0e25\u0e31\u0e1a";
    const echoed = Buffer.from(secret, "utf8").toString("latin1");
    const snapshot = await check(
      response({
        line: `HTTP/1.1 200 r-${echoed}`,
        headers: [[`X-${echoed}`, "v"]],
      }),
      { headers: [secretHeader("h1", "X-Own")] },
      { "header.h1": secret },
    );
    expect(snapshot.statusLine?.reasonPhrase).toBe("r-\u2022\u2022\u2022");
    expect(snapshot.headers.map((h) => h.name)).toContain(
      "x-\u2022\u2022\u2022",
    );
  });

  it("flags truncated when the redactor gives up scanning", async () => {
    const secret = "a".repeat(4096);
    const snapshot = await check(
      response({
        headers: [["Content-Type", "text/plain"]],
        body: "a".repeat(200_000),
      }),
      { headers: [secretHeader("h1", "X-Own")] },
      { "header.h1": secret },
    );
    expect(snapshot.body).toMatchObject({ kind: "text", truncated: true });
    expect(JSON.stringify(snapshot)).not.toContain(secret);
  });

  it("keeps no snapshot detail for a redirect blocked by the address policy", async () => {
    const server = await startRawServer({
      onRequest: ({ socket }) => {
        socket.end(
          response({
            line: "HTTP/1.1 302 Found",
            headers: [["Location", "http://127.0.0.1:1/"]],
          }),
        );
      },
    });
    servers.push(server);
    const result = await runCheck(configFor("http", server.port), {}, deps());
    expect(result.failureReason).toBe("redirect_blocked");
    expect(result.responseSnapshot).toMatchObject({
      statusLine: null,
      headers: [],
      body: null,
    });
  });
});

describe("header names are lowercased by the executor", () => {
  it.each(["Tok123", "caf\u00e9-\u0e25\u0e31\u0e1a", "A/B c"])(
    "masks secret %s echoed in a header name",
    async (secret) => {
      const echoed = Buffer.from(secret, "utf8").toString("latin1");
      const snapshot = await check(
        response({
          headers: [
            [`X-${echoed}`, "v"],
            [`X-${encodeURIComponent(secret).replaceAll("%", "")}`, "w"],
          ],
        }),
        { headers: [secretHeader("h1", "X-Own")] },
        { "header.h1": secret },
      );
      const names = snapshot.headers.map((h) => h.name);
      expect(names).toContain("x-\u2022\u2022\u2022");
      for (const name of names) {
        expect(name.toLowerCase()).not.toContain(echoed.toLowerCase());
      }
    },
  );

  it("masks an uppercase-hex URL-encoded secret in a header name", async () => {
    const snapshot = await check(
      response({ headers: [["X-a%2Fb", "v"]] }),
      { headers: [secretHeader("h1", "X-Own")] },
      { "header.h1": "a/b" },
    );
    expect(snapshot.headers.map((h) => h.name)).toContain(
      "x-\u2022\u2022\u2022",
    );
  });
});

describe("percent-encoding case echoed by the target", () => {
  const secret = "café-ลับ";
  const upper = encodeURIComponent(secret);
  const lower = upper.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
  const mixed = upper.replace(/%[0-9A-F]{2}/g, (m, i: number) =>
    i % 2 === 0 ? m.toLowerCase() : m,
  );
  const own = { headers: [secretHeader("h1", "X-Own")] };

  it.each([
    ["lowercase", lower],
    ["mixed case", mixed],
  ])(
    "masks a %s encoding in a value, body, reason phrase and name",
    async (_, echoed) => {
      expect(echoed).not.toBe(upper);
      const snapshot = await check(
        response({
          line: `HTTP/1.1 200 r-${echoed}`,
          headers: [
            ["Content-Type", "text/plain"],
            ["X-Echo", `v=${echoed}`],
            [`X-${echoed}`, "n"],
          ],
          body: `b=${echoed}`,
        }),
        own,
        { "header.h1": secret },
      );
      expect(snapshot.statusLine?.reasonPhrase).toBe("r-•••");
      expect(snapshot.headers.find((h) => h.name === "x-echo")?.value).toBe(
        "v=•••",
      );
      expect(snapshot.headers.map((h) => h.name)).toContain("x-•••");
      expect(snapshot.body).toMatchObject({ text: "b=•••" });
      expect(JSON.stringify(snapshot).toLowerCase()).not.toContain("%c3%a9");
    },
  );

  it.each([
    ["lowercase", lower],
    ["mixed case", mixed],
  ])("masks a %s encoding in a redirect URL", async (_, echoed) => {
    let requests = 0;
    const server = await startRawServer({
      onRequest: ({ socket }) => {
        requests++;
        socket.end(
          requests === 1
            ? response({
                line: "HTTP/1.1 302 Found",
                headers: [["Location", `/cb/${echoed}`]],
              })
            : response({}),
        );
      },
    });
    servers.push(server);
    for (const overrides of [
      {},
      { queryParams: [{ name: "q", value: "v" }] },
    ]) {
      requests = 0;
      const result = await runCheck(
        configFor("http", server.port, { ...own, ...overrides }),
        { "header.h1": secret },
        deps(),
      );
      expect(result.responseSnapshot?.url).toContain("/cb/•••");
      expect(result.responseSnapshot?.url.toLowerCase()).not.toContain("%c3");
    }
  });

  it("keeps the case of a percent-encoding that holds no secret", async () => {
    const snapshot = await check(
      response({
        headers: [
          ["Content-Type", "text/plain"],
          ["X-Echo", "a%c3%a9"],
        ],
        body: "%c3%a9",
      }),
      own,
      { "header.h1": secret },
    );
    expect(snapshot.headers.find((h) => h.name === "x-echo")?.value).toBe(
      "a%c3%a9",
    );
    expect(snapshot.body).toMatchObject({ text: "%c3%a9" });
  });
});

describe("secrets that hold percent escapes", () => {
  const own = { headers: [secretHeader("h1", "X-Own")] };

  async function redirectUrl(echoed: string, secret: string) {
    let requests = 0;
    const server = await startRawServer({
      onRequest: ({ socket }) => {
        requests++;
        socket.end(
          requests === 1
            ? response({
                line: "HTTP/1.1 302 Found",
                headers: [["Location", `/cb/${echoed}`]],
              })
            : response({}),
        );
      },
    });
    servers.push(server);
    const result = await runCheck(
      configFor("http", server.port, own),
      { "header.h1": secret },
      deps(),
    );
    return result.responseSnapshot?.url;
  }

  it.each(["a%2fb%2fc", "a%2Fb%2Fc", "a%2Fb%2fc", "a%2fb%2Fc"])(
    "masks a secret holding percent escapes echoed as %s in a body and a redirect URL",
    async (echoed) => {
      const snapshot = await check(
        response({
          headers: [["Content-Type", "text/plain"]],
          body: `x=${echoed}`,
        }),
        own,
        { "header.h1": "a%2fb%2fc" },
      );
      expect(snapshot.body).toMatchObject({ text: "x=•••" });
      expect(await redirectUrl(echoed, "a%2fb%2fc")).toContain("/cb/•••");
    },
  );

  it.each(["%c3%83%c2%a9", "%C3%83%c2%A9"])(
    "masks a secret echoed as the percent-encoded latin1 form %s",
    async (echoed) => {
      const snapshot = await check(
        response({
          headers: [["Content-Type", "text/plain"]],
          body: `x=${echoed}`,
        }),
        own,
        { "header.h1": "é" },
      );
      expect(snapshot.body).toMatchObject({ text: "x=•••" });
    },
  );

  it("merges overlapping matches of two secrets into one mask", async () => {
    const snapshot = await check(
      response({
        headers: [["Content-Type", "text/plain"]],
        body: "x=%c3%a9",
      }),
      { headers: [secretHeader("h1", "X-A"), secretHeader("h2", "X-B")] },
      { "header.h1": "%c3", "header.h2": "é" },
    );
    expect(snapshot.body).toMatchObject({ text: "x=•••" });
  });
});

describe("fold depends on the characters around a secret", () => {
  const own = { headers: [secretHeader("h1", "X-Own")] };
  const body = (text: string) =>
    response({ headers: [["Content-Type", "text/plain"]], body: text });

  it.each([
    ["deadbeef1234", "x%deadbeef1234"],
    ["deadbeef", "x%0deadbeef"],
    ["deadbeef", "x%0deadbeef end"],
    ["ab%c", "ab%cd"],
    ["ab%c", "ab%cdz"],
    ["ab%c1", "ab%c1"],
    ["a%b", "a%bc"],
  ])("masks secret %s inside %s", async (secret, text) => {
    const snapshot = await check(body(text), own, { "header.h1": secret });
    if (snapshot.body?.kind !== "text") throw new Error("expected text");
    expect(snapshot.body.text).toContain("•••");
    expect(snapshot.body.text.toLowerCase()).not.toContain(secret);
  });

  it("masks such a secret in a redirect URL", async () => {
    let requests = 0;
    const server = await startRawServer({
      onRequest: ({ socket }) => {
        requests++;
        socket.end(
          requests === 1
            ? response({
                line: "HTTP/1.1 302 Found",
                headers: [["Location", "/cb/x%deadbeef1234"]],
              })
            : response({}),
        );
      },
    });
    servers.push(server);
    const result = await runCheck(
      configFor("http", server.port, own),
      { "header.h1": "deadbeef1234" },
      deps(),
    );
    expect(result.responseSnapshot?.url).toContain("/cb/x%•••");
    expect(result.responseSnapshot?.url).not.toContain("deadbeef");
  });
});

describe("body scan limits", () => {
  const own = { headers: [secretHeader("h1", "X-Own")] };
  const secret = "SECRETVALUE";
  const textBody = (body: string) =>
    response({ headers: [["Content-Type", "text/plain"]], body });

  it("keeps the original percent-encoding case when a secret matches only past the output cap", async () => {
    const body = `%c3${"a".repeat(32_780)}${secret}`;
    const snapshot = await check(textBody(body), own, { "header.h1": secret });
    if (snapshot.body?.kind !== "text") throw new Error("expected text");
    expect(snapshot.body.text.startsWith("%c3a")).toBe(true);
    expect(snapshot.body.truncated).toBe(true);
  });

  it("never shows part of a secret that straddles the end of the scanned prefix", async () => {
    // Long secrets shrink to a 3 character mask, so the output stays under 16 KiB
    // and the end of the scanned prefix would be shown.
    const long = `SECRET${"v".repeat(94)}`;
    const scanned = 2 * 16 * 1024 + 36 * long.length;
    const unit = `${long}-`;
    const padding = (scanned - 4) % unit.length;
    const snapshot = await check(
      textBody(`${"a".repeat(padding)}${unit.repeat(1000)}`),
      { headers: [secretHeader("h1", "X-Own")] },
      { "header.h1": long },
    );
    if (snapshot.body?.kind !== "text") throw new Error("expected text");
    expect(snapshot.body.text).toContain("•••");
    expect(snapshot.body.text).not.toContain("SEC");
    expect(snapshot.body.truncated).toBe(true);
  });

  it("still shows a full 16 KiB of a large body that holds no secret", async () => {
    const snapshot = await check(textBody("b".repeat(1024 * 1024)), own, {
      "header.h1": secret,
    });
    expect(snapshot.body).toMatchObject({
      kind: "text",
      truncated: true,
      totalBytesRead: 1024 * 1024,
    });
    if (snapshot.body?.kind !== "text") throw new Error("expected text");
    expect(snapshot.body.text).toBe("b".repeat(16 * 1024));
  });
});

describe("URL encodings other than encodeURIComponent", () => {
  const own = { headers: [secretHeader("h1", "X-Own")] };
  const form = (value: string) =>
    new URLSearchParams([["", value]]).toString().slice(1);
  const strict = (value: string) =>
    encodeURIComponent(value).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const lowerHex = (text: string) =>
    text.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());

  const cases: [string, string][] = [
    ["tok 123", "tok+123"],
    ["tok 123", form("tok 123")],
    ["a!b'c(d)e*f~g", form("a!b'c(d)e*f~g")],
    ["a!b'c(d)e*f~g", strict("a!b'c(d)e*f~g")],
    ["a!b'c(d)e*f~g", encodeURIComponent("a!b'c(d)e*f~g")],
    ["a b!c", strict("a b!c").replaceAll("%20", "+")],
    ["café ลับ", form("café ลับ")],
    ["café ลับ", lowerHex(form("café ลับ"))],
    ["café ลับ", lowerHex(strict("café ลับ").replaceAll("%20", "+"))],
  ];

  it.each(cases)("masks secret %s echoed as %s", async (secret, echoed) => {
    const snapshot = await check(
      response({
        headers: [
          ["Content-Type", "text/plain"],
          ["X-Echo", `v=${echoed}`],
        ],
        body: `b=${echoed}`,
      }),
      own,
      { "header.h1": secret },
    );
    expect(snapshot.body).toMatchObject({ text: "b=•••" });
    expect(snapshot.headers.find((h) => h.name === "x-echo")?.value).toBe(
      "v=•••",
    );

    let requests = 0;
    const server = await startRawServer({
      onRequest: ({ socket }) => {
        requests++;
        socket.end(
          requests === 1
            ? response({
                line: "HTTP/1.1 302 Found",
                headers: [["Location", `/cb/${echoed}`]],
              })
            : response({}),
        );
      },
    });
    servers.push(server);
    const result = await runCheck(
      configFor("http", server.port, own),
      { "header.h1": secret },
      deps(),
    );
    expect(result.responseSnapshot?.url).toContain("/cb/•••");
  });
});

describe("secrets echoed in any URL encoding", () => {
  const own = { headers: [secretHeader("h1", "X-Own")] };
  // A head is decoded as latin1, so a UTF-8 echo reaches the executor as its latin1 form.
  const wire = (text: string) => Buffer.from(text, "utf8").toString("latin1");

  const cases: [string, string][] = [
    ["p@ss word", "p@ss word"],
    ["x/é", "x/é"],
    ["a/b c", "a/b%20c"],
    ["a~* b", "a%7E%2A+b"],
    ["a b/c~d", "a%20b/c%7Ed"],
    ["a b/c~d", "a+b%2Fc~d"],
  ];

  it.each(cases)("masks secret %s echoed as %s", async (secret, echoed) => {
    const snapshot = await check(
      response({
        line: `HTTP/1.1 200 r-${wire(echoed)}`,
        headers: [
          ["Content-Type", "text/plain"],
          ["X-Echo", `v=${wire(echoed)}`],
        ],
        body: `b=${echoed}`,
      }),
      own,
      { "header.h1": secret },
    );
    expect(snapshot.body).toMatchObject({ text: "b=•••" });
    expect(snapshot.headers.find((h) => h.name === "x-echo")?.value).toBe(
      "v=•••",
    );
    expect(snapshot.statusLine?.reasonPhrase).toBe("r-•••");

    let requests = 0;
    const server = await startRawServer({
      onRequest: ({ socket }) => {
        requests++;
        socket.end(
          requests === 1
            ? response({
                line: "HTTP/1.1 302 Found",
                headers: [["Location", `/cb/${wire(echoed)}`]],
              })
            : response({}),
        );
      },
    });
    servers.push(server);
    const result = await runCheck(
      configFor("http", server.port, own),
      { "header.h1": secret },
      deps(),
    );
    expect(result.responseSnapshot?.url).toContain("/cb/•••");
  });

  it("keeps text that holds no secret unchanged", async () => {
    const snapshot = await check(
      response({
        headers: [
          ["Content-Type", "text/plain"],
          ["X-Echo", "a%7Eb+c%2fd"],
        ],
        body: "a%7Eb+c%2fd",
      }),
      own,
      { "header.h1": "zzz" },
    );
    expect(snapshot.body).toMatchObject({ text: "a%7Eb+c%2fd" });
    expect(snapshot.headers.find((h) => h.name === "x-echo")?.value).toBe(
      "a%7Eb+c%2fd",
    );
  });
});

describe("JSON escapes and nested encodings", () => {
  const own = { headers: [secretHeader("h1", "X-Own")] };
  // A head is decoded as latin1, so a UTF-8 echo reaches the executor as its latin1 form.
  const wire = (text: string) => Buffer.from(text, "utf8").toString("latin1");

  // [secret, echoed, also check a redirect URL]
  const cases: [string, string, boolean][] = [
    // Python json.dumps (ensure_ascii), Thai and é
    ["ลับ", "\\u0e25\\u0e31\\u0e1a", false],
    ["café", "caf\\u00e9", false],
    // surrogate pair
    ["x😀y", "x\\ud83d\\ude00y", false],
    // PHP json_encode
    ["a/b", "a\\/b", false],
    // Go json.Marshal
    ["a&b<c>", "a\\u0026b\\u003cc\\u003e", false],
    // JSON-escaped quote and backslash
    ['q"r\\s', 'q\\"r\\\\s', false],
    // percent encoded twice, partly encoded, UTF-8 next to raw non-ASCII
    ["tok 123", "tok%2520123", true],
    ["deadbeef", "%64e%61dbeef", true],
    ["café ลับ", "caf%C3%A9 ลับ", false],
    // JSON escapes that spell a percent escape, and a percent escape that spells JSON
    ["a b", "a\\u0025\\u0032\\u0030b", false],
    ["é", "%5Cu00e9", true],
  ];

  it.each(cases)(
    "masks secret %j echoed as %j",
    async (secret, echoed, inUrl) => {
      const snapshot = await check(
        response({
          line: `HTTP/1.1 200 r-${wire(echoed)}`,
          headers: [
            ["Content-Type", "text/plain"],
            ["X-Echo", `v=${wire(echoed)}`],
          ],
          body: `b=${echoed}`,
        }),
        own,
        { "header.h1": secret },
      );
      expect(snapshot.body).toMatchObject({ text: "b=•••" });
      expect(snapshot.headers.find((h) => h.name === "x-echo")?.value).toBe(
        "v=•••",
      );
      expect(snapshot.statusLine?.reasonPhrase).toBe("r-•••");
      if (!inUrl) return;

      let requests = 0;
      const server = await startRawServer({
        onRequest: ({ socket }) => {
          requests++;
          socket.end(
            requests === 1
              ? response({
                  line: "HTTP/1.1 302 Found",
                  headers: [["Location", `/cb/${wire(echoed)}`]],
                })
              : response({}),
          );
        },
      });
      servers.push(server);
      const result = await runCheck(
        configFor("http", server.port, own),
        { "header.h1": secret },
        deps(),
      );
      expect(result.responseSnapshot?.url).toContain("/cb/•••");
    },
  );

  it("masks a JSON-escaped secret in a header name", async () => {
    const snapshot = await check(
      response({ headers: [["X-caf\\u00e9", "v"]] }),
      own,
      { "header.h1": "café" },
    );
    expect(snapshot.headers.map((h) => h.name)).toContain("x-•••");
  });

  it("does not end the shown text on half of a surrogate pair", async () => {
    // Masks shrink the output under 16 KiB, so the end of the safe range is shown;
    // padding puts that end between the two halves of an emoji.
    const long = `SECRET${"v".repeat(94)}`;
    const unit = `😀${long}-`;
    const safeEnd = 2 * 16 * 1024;
    const padding = (safeEnd - 1) % unit.length;
    const snapshot = await check(
      response({
        headers: [["Content-Type", "text/plain"]],
        body: `${"a".repeat(padding)}${unit.repeat(1000)}`,
      }),
      own,
      { "header.h1": long },
    );
    if (snapshot.body?.kind !== "text") throw new Error("expected text");
    expect(snapshot.body.text).toContain("•••");
    expect(snapshot.body.text).not.toMatch(
      /[\ud800-\udbff](?![\udc00-\udfff])/,
    );
  });
});

describe("work limits", () => {
  const thai = "ก".repeat(1365);
  const noisy = "%41+\\u00e9%20".repeat(2000);
  const body = (text: string) =>
    response({ headers: [["Content-Type", "text/plain"]], body: text });

  it("masks the whole body when decoding would exceed the work budget", async () => {
    // A long secret widens the scanned prefix; every layer of decoding repeats it.
    const snapshot = await check(
      body(noisy.repeat(30)),
      { headers: [secretHeader("h1", "X-Own")] },
      { "header.h1": thai },
    );
    expect(snapshot.body).toMatchObject({
      kind: "text",
      text: "•••",
      truncated: true,
    });
  });

  it("keeps showing a noisy body when the secrets are short", async () => {
    const snapshot = await check(
      body(noisy.repeat(30)),
      { headers: [secretHeader("h1", "X-Own")] },
      { "header.h1": "short-secret" },
    );
    if (snapshot.body?.kind !== "text") throw new Error("expected text");
    expect(snapshot.body.text.startsWith("%41+")).toBe(true);
    expect(snapshot.body.text).not.toBe("•••");
  });
});
