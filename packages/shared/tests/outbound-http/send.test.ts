import net, { type Socket } from "node:net";
import tls from "node:tls";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  resolveOutboundHost,
  sendOutboundRequest,
  type OutboundDeps,
  type OutboundRequest,
} from "../../src/outbound-http";
import { sameDestination } from "../../src/outbound-http/send";
import {
  createTestPki,
  respond,
  startRawServer,
  TARGET_HOST,
  type RawServer,
  type TestPki,
} from "./fixtures";

const OTHER_HOST = "other.nw-test.internal";
const LOOPBACK = "127.0.0.1";

let pki: TestPki;
const servers: RawServer[] = [];

beforeAll(() => {
  pki = createTestPki();
}, 60_000);
afterAll(() => {
  pki.dispose();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function serve(options: Parameters<typeof startRawServer>[0]) {
  const server = await startRawServer(options);
  servers.push(server);
  return server;
}

const okBody = (socket: Socket, body = "ok") => {
  respond(
    socket,
    "200 OK",
    { "Content-Length": String(body.length), Connection: "close" },
    body,
  );
};

function baseRequest(
  url: string,
  overrides: Partial<OutboundRequest> = {},
): OutboundRequest {
  return {
    url,
    method: "GET",
    headers: {},
    timeoutMs: 5000,
    maxRedirects: 5,
    secretHeaderNames: ["Authorization", "X-Secret"],
    maxBodyBytes: 1024 * 1024,
    ...overrides,
  };
}

function deps(overrides: Partial<OutboundDeps> = {}): OutboundDeps {
  return {
    resolver: () => Promise.resolve([LOOPBACK]),
    testAllowedHosts: [TARGET_HOST, OTHER_HOST],
    ca: pki.ca,
    ...overrides,
  };
}

const at = (
  server: RawServer,
  path = "/",
  scheme = "http",
  host = TARGET_HOST,
) => `${scheme}://${host}:${String(server.port)}${path}`;

describe("HTTP/1.1 framing over node:net", () => {
  it("reads a Content-Length body and sends the fixed request headers", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        okBody(socket, "hello");
      },
    });
    const result = await sendOutboundRequest(
      baseRequest(at(server, "/a?b=1"), {
        headers: { "Accept-Encoding": "gzip", "X-Custom": "v" },
      }),
      deps(),
    );
    expect(result.ok).toBe(true);
    expect(result.response?.status).toBe(200);
    expect(result.response?.body.toString()).toBe("hello");
    expect(result.response?.bodyTruncated).toBe(false);
    expect(result.tls).toBeUndefined();
    const head = server.requests[0]?.head ?? "";
    expect(head).toContain("GET /a?b=1 HTTP/1.1");
    expect(head).toContain(`Host: ${TARGET_HOST}:${String(server.port)}`);
    expect(head).toContain("Connection: close");
    expect(head).toContain("Accept-Encoding: identity");
    expect(head).not.toContain("gzip");
    expect(head).toContain("X-Custom: v");
  });

  it("decodes a chunked body delivered in fragments", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        socket.write(
          "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5;ext=1\r\nhel",
        );
        setTimeout(() => {
          socket.write("lo\r\n6\r\n wor");
          setTimeout(() => socket.end("ld\r\n0\r\nX-Trailer: 1\r\n\r\n"), 20);
        }, 20);
      },
    });
    const result = await sendOutboundRequest(baseRequest(at(server)), deps());
    expect(result.response?.body.toString()).toBe("hello world");
  });

  it("reads a body that ends when the connection closes", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        socket.end("HTTP/1.1 200 OK\r\nX-A: 1\r\nX-A: 2\r\n\r\nuntil close");
      },
    });
    const result = await sendOutboundRequest(baseRequest(at(server)), deps());
    expect(result.response?.body.toString()).toBe("until close");
    expect(result.response?.headers["x-a"]).toBe("1, 2");
  });

  it("stops reading at maxBodyBytes and reports truncation", async () => {
    let closed = false;
    const server = await serve({
      onRequest: ({ socket }) => {
        socket.on("close", () => {
          closed = true;
        });
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 10000000\r\n\r\n");
        const timer = setInterval(() => {
          if (socket.destroyed) clearInterval(timer);
          else socket.write("x".repeat(4096));
        }, 2);
      },
    });
    const result = await sendOutboundRequest(
      baseRequest(at(server), { maxBodyBytes: 10 }),
      deps(),
    );
    expect(result.ok).toBe(true);
    expect(result.response?.body.toString()).toBe("xxxxxxxxxx");
    expect(result.response?.bodyTruncated).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(closed).toBe(true);
  });

  it("does not flag a body exactly at maxBodyBytes as truncated", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        okBody(socket, "12345");
      },
    });
    const result = await sendOutboundRequest(
      baseRequest(at(server), { maxBodyBytes: 5 }),
      deps(),
    );
    expect(result.response?.bodyTruncated).toBe(false);
    expect(result.response?.body.toString()).toBe("12345");
  });

  it("fails with body_read_failed when the connection closes before Content-Length", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nabc");
      },
    });
    const result = await sendOutboundRequest(baseRequest(at(server)), deps());
    expect(result.failure?.reason).toBe("body_read_failed");
  });

  it("sends a POST body with Content-Length", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    await sendOutboundRequest(
      baseRequest(at(server), { method: "POST", body: "payload" }),
      deps(),
    );
    expect(server.requests[0]?.head).toContain("Content-Length: 7");
  });
});

describe("address policy at connect time", () => {
  it("rejects a DNS answer that mixes a public and a private address without connecting", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    const result = await sendOutboundRequest(
      baseRequest(`http://mixed.example.com:${String(server.port)}/`),
      deps({ resolver: () => Promise.resolve(["93.184.216.34", LOOPBACK]) }),
    );
    expect(result.failure?.reason).toBe("blocked_address");
    expect(server.connections()).toBe(0);
  });

  it.each(["127.0.0.1", "[::1]", "169.254.169.254", "10.0.0.1", "0x7f.1"])(
    "blocks the literal host %s without connecting",
    async (host) => {
      const server = await serve({
        onRequest: ({ socket }) => {
          okBody(socket);
        },
      });
      const result = await sendOutboundRequest(
        baseRequest(`http://${host}:${String(server.port)}/`),
        deps(),
      );
      expect(result.failure?.reason).toBe("blocked_address");
      expect(server.connections()).toBe(0);
    },
  );

  it("only exempts the hostnames in testAllowedHosts", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    const result = await sendOutboundRequest(
      baseRequest(`http://not-listed.nw-test.internal:${String(server.port)}/`),
      deps(),
    );
    expect(result.failure?.reason).toBe("blocked_address");
    expect(server.connections()).toBe(0);
  });

  it("connects to the address it validated even when DNS answers differently later", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    let calls = 0;
    const result = await sendOutboundRequest(
      baseRequest(at(server)),
      deps({
        resolver: () => {
          calls++;
          return Promise.resolve([calls === 1 ? LOOPBACK : "203.0.113.9"]);
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(calls).toBe(1);
    expect(server.connections()).toBe(1);
  });

  it("re-applies the policy to a changed DNS answer on the next resolve (AC-62)", async () => {
    let answer = "93.184.216.34";
    const resolver = () => Promise.resolve([answer]);
    const url = new URL("http://changing.example.com/");
    expect((await resolveOutboundHost(url, { resolver })).ok).toBe(true);
    answer = LOOPBACK;
    const changed = await resolveOutboundHost(url, { resolver });
    expect(changed).toEqual({ ok: false, reason: "blocked_address" });
  });

  it("never puts a resolved address in the result", async () => {
    const closed = await serve({});
    const closedPort = closed.port;
    await closed.close();
    const expired = await serve({ tls: pki.leaf.expired });
    const silent = await serve({});
    const results = await Promise.all([
      sendOutboundRequest(
        baseRequest("http://mixed.example.com/"),
        deps({
          resolver: () => Promise.resolve(["93.184.216.34", "10.9.8.7"]),
        }),
      ),
      sendOutboundRequest(baseRequest(`http://${TARGET_HOST}:9/`), deps()),
      sendOutboundRequest(baseRequest("http://10.9.8.7/"), deps()),
      sendOutboundRequest(
        baseRequest(`http://${TARGET_HOST}:${String(closedPort)}/`),
        deps(),
      ),
      sendOutboundRequest(baseRequest(at(expired, "/", "https")), deps()),
      sendOutboundRequest(baseRequest(at(silent), { timeoutMs: 150 }), deps()),
    ]);
    expect(results.map((r) => r.failure?.reason)).toEqual([
      "blocked_address",
      "invalid_request",
      "blocked_address",
      "connect_refused",
      "tls_invalid",
      "timeout",
    ]);
    for (const result of results) {
      const text = JSON.stringify(result);
      expect(text).not.toMatch(/10\.9\.8\.7|93\.184\.216\.34|127\.0\.0\.1|::1/);
    }
  });
});

describe("failure classification", () => {
  it("maps a refused connection", async () => {
    const closed = await serve({});
    const port = closed.port;
    await closed.close();
    const result = await sendOutboundRequest(
      baseRequest(`http://${TARGET_HOST}:${String(port)}/`),
      deps(),
    );
    expect(result.failure?.reason).toBe("connect_refused");
  });

  it("maps resolver errors", async () => {
    const notFound = await sendOutboundRequest(
      baseRequest("http://gone.example.com/"),
      deps({
        resolver: () =>
          Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })),
      }),
    );
    expect(notFound.failure?.reason).toBe("dns_not_found");
    const unavailable = await sendOutboundRequest(
      baseRequest("http://gone.example.com/"),
      deps({
        resolver: () =>
          Promise.reject(Object.assign(new Error("x"), { code: "EAI_AGAIN" })),
      }),
    );
    expect(unavailable.failure?.reason).toBe("resolver_unavailable");
  });

  it("rejects forbidden headers, CR/LF and unknown methods without connecting", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    const cases: Partial<OutboundRequest>[] = [
      { headers: { Host: "evil" } },
      { headers: { "X-A": "a\r\nInjected: 1" } },
      { headers: { "Transfer-Encoding": "chunked" } },
      { method: "CONNECT" },
    ];
    for (const overrides of cases) {
      const result = await sendOutboundRequest(
        baseRequest(at(server), overrides),
        deps(),
      );
      expect(result.failure?.reason).toBe("invalid_request");
    }
    expect(server.connections()).toBe(0);
  });

  it("rejects a disallowed port without connecting", async () => {
    const result = await sendOutboundRequest(
      baseRequest(`http://${TARGET_HOST}:22/`),
      deps(),
    );
    expect(result.failure?.reason).toBe("invalid_request");
  });
});

describe("timeout", () => {
  it("times out when the server never answers", async () => {
    const server = await serve({});
    const started = Date.now();
    const result = await sendOutboundRequest(
      baseRequest(at(server), { timeoutMs: 200 }),
      deps(),
    );
    expect(result.failure?.reason).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("counts every hop against one budget", async () => {
    const slowRedirect = (socket: Socket, location: string) => {
      setTimeout(() => {
        respond(socket, "302 Found", {
          Location: location,
          "Content-Length": "0",
        });
      }, 200);
    };
    const second = await serve({
      onRequest: ({ socket }) => {
        setTimeout(() => {
          okBody(socket);
        }, 200);
      },
    });
    const first = await serve({
      onRequest: ({ socket }) => {
        slowRedirect(socket, at(second));
      },
    });
    const within = await sendOutboundRequest(
      baseRequest(at(first), { timeoutMs: 3000 }),
      deps(),
    );
    expect(within.ok).toBe(true);
    const over = await sendOutboundRequest(
      baseRequest(at(first), { timeoutMs: 300 }),
      deps(),
    );
    expect(over.failure?.reason).toBe("timeout");
  });
});

describe("redirects", () => {
  async function chain(hops: number) {
    const server: RawServer = await serve({
      onRequest: ({ head, socket }) => {
        const step = Number(/GET \/step\/(\d+)/.exec(head)?.[1] ?? "0");
        if (step < hops)
          respond(socket, "302 Found", {
            Location: `/step/${String(step + 1)}`,
            "Content-Length": "0",
          });
        else okBody(socket, `done ${String(step)}`);
      },
    });
    return server;
  }

  it("follows 5 redirects and stops at 6 with redirect_limit", async () => {
    const five = await chain(5);
    const passed = await sendOutboundRequest(
      baseRequest(at(five, "/step/0")),
      deps(),
    );
    expect(passed.response?.body.toString()).toBe("done 5");
    expect(passed.response?.redirects).toBe(5);
    const six = await chain(6);
    const failed = await sendOutboundRequest(
      baseRequest(at(six, "/step/0")),
      deps(),
    );
    expect(failed.failure?.reason).toBe("redirect_limit");
  });

  it("reports a redirect loop as redirect_limit", async () => {
    const server = await serve({
      onRequest: ({ head, socket }) => {
        const next = head.includes("GET /a ") ? "/b" : "/a";
        respond(socket, "301 Moved", { Location: next, "Content-Length": "0" });
      },
    });
    const result = await sendOutboundRequest(
      baseRequest(at(server, "/a")),
      deps(),
    );
    expect(result.failure?.reason).toBe("redirect_limit");
  });

  it.each([301, 302, 303, 307, 308])("follows status %i", async (status) => {
    const server = await serve({
      onRequest: ({ head, socket }) => {
        if (head.includes("GET /start"))
          respond(socket, `${String(status)} Moved`, {
            Location: "/end",
            "Content-Length": "0",
          });
        else okBody(socket, "end");
      },
    });
    const result = await sendOutboundRequest(
      baseRequest(at(server, "/start")),
      deps(),
    );
    expect(result.response?.body.toString()).toBe("end");
  });

  it("switches POST to GET on 302 and keeps POST with its body on 307", async () => {
    const run = async (status: string) => {
      const server = await serve({
        onRequest: ({ head, socket }) => {
          if (head.includes("/start"))
            respond(socket, status, {
              Location: "/end",
              "Content-Length": "0",
            });
          else okBody(socket);
        },
      });
      await sendOutboundRequest(
        baseRequest(at(server, "/start"), { method: "POST", body: "data" }),
        deps(),
      );
      return server.requests[1]?.head ?? "";
    };
    const after302 = await run("302 Found");
    expect(after302).toContain("GET /end");
    expect(after302).not.toContain("Content-Length");
    const after307 = await run("307 Temporary Redirect");
    expect(after307).toContain("POST /end");
    expect(after307).toContain("Content-Length: 4");
  });

  it("drops secret headers when the redirect goes to another host", async () => {
    const target = await serve({
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    const origin = await serve({
      onRequest: ({ socket }) => {
        respond(socket, "302 Found", {
          Location: at(target, "/", "http", OTHER_HOST),
          "Content-Length": "0",
        });
      },
    });
    await sendOutboundRequest(
      baseRequest(at(origin), {
        headers: {
          "X-Secret": "s3",
          authorization: "Bearer t",
          "X-Public": "p",
        },
      }),
      deps(),
    );
    const forwarded = target.requests[0]?.head.toLowerCase() ?? "";
    expect(forwarded).not.toContain("x-secret");
    expect(forwarded).not.toContain("authorization");
    expect(forwarded).toContain("x-public: p");
    expect(origin.requests[0]?.head.toLowerCase()).toContain("x-secret: s3");
  });

  it("drops secret headers when only the port changes on plain http", async () => {
    const target = await serve({
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    const origin = await serve({
      onRequest: ({ socket }) => {
        respond(socket, "302 Found", {
          Location: at(target),
          "Content-Length": "0",
        });
      },
    });
    await sendOutboundRequest(
      baseRequest(at(origin), { headers: { "X-Secret": "s3" } }),
      deps(),
    );
    expect(target.requests[0]?.head.toLowerCase()).not.toContain("x-secret");
  });

  it("drops secret headers on an http to https upgrade that changes to a non-default port", async () => {
    const secure = await serve({
      tls: pki.leaf.good,
      onRequest: ({ socket }) => {
        okBody(socket, "secure");
      },
    });
    const origin = await serve({
      onRequest: ({ socket }) => {
        respond(socket, "301 Moved", {
          Location: at(secure, "/", "https"),
          "Content-Length": "0",
        });
      },
    });
    const result = await sendOutboundRequest(
      baseRequest(at(origin), {
        headers: { "X-Secret": "s3", "X-Public": "p" },
      }),
      deps(),
    );
    expect(result.response?.body.toString()).toBe("secure");
    const forwarded = secure.requests[0]?.head.toLowerCase() ?? "";
    expect(forwarded).not.toContain("x-secret");
    expect(forwarded).toContain("x-public: p");
    expect(result.tls?.reason).toBeNull();
    expect(result.tls?.issuer).toBe("NW Test");
  });

  it("keeps secrets only for same-origin or default-port http to https redirects", () => {
    const keeps = (from: string, to: string) =>
      sameDestination(new URL(from), new URL(to));
    expect(keeps("http://a.example/", "https://a.example/")).toBe(true);
    expect(keeps("http://a.example:80/", "https://a.example:443/")).toBe(true);
    expect(keeps("https://a.example:8443/x", "https://a.example:8443/y")).toBe(
      true,
    );
    expect(keeps("http://a.example/", "https://a.example:8443/")).toBe(false);
    expect(keeps("http://a.example:8080/", "https://a.example/")).toBe(false);
    expect(keeps("http://a.example:8080/", "http://a.example:9090/")).toBe(
      false,
    );
    expect(keeps("http://a.example/", "https://b.example/")).toBe(false);
    expect(keeps("https://a.example/", "http://a.example/")).toBe(false);
  });

  it("blocks https to http as redirect_blocked without contacting the target", async () => {
    const plain = await serve({
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    const secure = await serve({
      tls: pki.leaf.good,
      onRequest: ({ socket }) => {
        respond(socket, "302 Found", {
          Location: at(plain),
          "Content-Length": "0",
        });
      },
    });
    const result = await sendOutboundRequest(
      baseRequest(at(secure, "/", "https")),
      deps(),
    );
    expect(result.failure?.reason).toBe("redirect_blocked");
    expect(plain.connections()).toBe(0);
  });

  it("blocks a redirect to a forbidden address without connecting", async () => {
    const victim = await serve({
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    const targets = [
      `http://127.0.0.1:${String(victim.port)}/`,
      `http://[::1]:${String(victim.port)}/`,
      `http://169.254.169.254/`,
      `http://unlisted.nw-test.internal:${String(victim.port)}/`,
      `http://${TARGET_HOST}:22/`,
      `ftp://${TARGET_HOST}/`,
    ];
    for (const location of targets) {
      const origin = await serve({
        onRequest: ({ socket }) => {
          respond(socket, "302 Found", {
            Location: location,
            "Content-Length": "0",
          });
        },
      });
      const result = await sendOutboundRequest(baseRequest(at(origin)), deps());
      expect(result.failure?.reason, location).toBe("redirect_blocked");
    }
    expect(victim.connections()).toBe(0);
  });
});

describe("TLS verification", () => {
  it.each([
    ["expired", "expired"],
    ["wrongName", "hostname_mismatch"],
    ["selfSigned", "self_signed"],
    ["unknownCa", "untrusted"],
  ] as const)(
    "fails a %s certificate with tlsReason %s before any request byte",
    async (name, tlsReason) => {
      const server = await serve({
        tls: pki.leaf[name],
        onRequest: ({ socket }) => {
          okBody(socket);
        },
      });
      const result = await sendOutboundRequest(
        baseRequest(at(server, "/", "https"), {
          headers: { "X-Secret": "s3", Authorization: "Bearer t" },
        }),
        deps(),
      );
      expect(result.ok).toBe(false);
      expect(result.failure?.reason).toBe("tls_invalid");
      expect(result.failure?.tlsReason).toBe(tlsReason);
      expect(result.tls?.reason).toBe(tlsReason);
      expect(server.bytesReceived()).toBe(0);
      expect(server.requests).toHaveLength(0);
    },
  );

  it("returns issuer and notAfter of a valid certificate", async () => {
    const server = await serve({
      tls: pki.leaf.good,
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    const result = await sendOutboundRequest(
      baseRequest(at(server, "/", "https")),
      deps(),
    );
    expect(result.ok).toBe(true);
    expect(result.tls?.issuer).toBe("NW Test");
    const notAfter = result.tls?.notAfter?.getTime() ?? 0;
    expect(notAfter).toBeGreaterThan(Date.now());
    expect(notAfter).toBeLessThan(Date.now() + 31 * 86_400_000);
  });

  it("reports the certificate of the last hop after a redirect", async () => {
    const last = await serve({
      tls: pki.leaf.good,
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    const first = await serve({
      onRequest: ({ socket }) => {
        respond(socket, "302 Found", {
          Location: at(last, "/", "https"),
          "Content-Length": "0",
        });
      },
    });
    const result = await sendOutboundRequest(baseRequest(at(first)), deps());
    expect(result.tls?.issuer).toBe("NW Test");
  });
});

// The Node typings model `connect` as overloads; the helper only ever calls the options form.
const netModule = net as {
  connect: (options: net.TcpNetConnectOpts) => Socket;
};
const tlsModule = tls as {
  connect: (options: tls.ConnectionOptions) => tls.TLSSocket;
};

describe("connection-time address check", () => {
  const realNetConnect = net.connect;
  const realTlsConnect = tls.connect;
  const FAKE_REMOTE = "203.0.113.9";
  const spoof = (socket: Socket) =>
    Object.defineProperty(socket, "remoteAddress", {
      get: () => FAKE_REMOTE,
    });

  it("blocks an http socket whose remote address differs from the validated one", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    vi.spyOn(netModule, "connect").mockImplementation(
      (options: net.TcpNetConnectOpts) => {
        const socket = realNetConnect(options);
        spoof(socket);
        return socket;
      },
    );
    const result = await sendOutboundRequest(baseRequest(at(server)), deps());
    expect(result.failure?.reason).toBe("blocked_address");
    expect(server.bytesReceived()).toBe(0);
  });

  it("blocks an https socket whose remote address differs before any request byte", async () => {
    const server = await serve({
      tls: pki.leaf.good,
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    vi.spyOn(tlsModule, "connect").mockImplementation(
      (options: tls.ConnectionOptions) => {
        const socket = realTlsConnect(options);
        spoof(socket);
        return socket;
      },
    );
    const result = await sendOutboundRequest(
      baseRequest(at(server, "/", "https")),
      deps(),
    );
    expect(result.failure?.reason).toBe("blocked_address");
    expect(server.bytesReceived()).toBe(0);
  });

  it("reports a mismatch on a redirect hop as redirect_blocked", async () => {
    const second = await serve({
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    const first = await serve({
      onRequest: ({ socket }) => {
        respond(socket, "302 Found", {
          Location: at(second),
          "Content-Length": "0",
        });
      },
    });
    let calls = 0;
    vi.spyOn(netModule, "connect").mockImplementation(
      (options: net.TcpNetConnectOpts) => {
        const socket = realNetConnect(options);
        if (++calls === 2) spoof(socket);
        return socket;
      },
    );
    const result = await sendOutboundRequest(baseRequest(at(first)), deps());
    expect(result.failure?.reason).toBe("redirect_blocked");
    expect(second.bytesReceived()).toBe(0);
  });

  it("classifies a non-TLS peer that closes as tls_invalid handshake_failed", async () => {
    const open = new Set<Socket>();
    const plain = net.createServer((socket) => {
      open.add(socket);
      socket.on("error", () => undefined);
      socket.end("HTTP/1.1 200 OK\r\n\r\nnot tls");
    });
    await new Promise<void>((resolve) => plain.listen(0, "127.0.0.1", resolve));
    try {
      const port = (plain.address() as net.AddressInfo).port;
      const result = await sendOutboundRequest(
        baseRequest(`https://${TARGET_HOST}:${String(port)}/`),
        deps(),
      );
      expect(result.failure?.reason).toBe("tls_invalid");
      expect(result.failure?.tlsReason).toBe("handshake_failed");
    } finally {
      for (const socket of open) socket.destroy();
      await new Promise((resolve) => plain.close(resolve));
    }
  });

  it("gives each resolved address an equal share of the budget", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    let calls = 0;
    // The first connection never completes, like a blackholed AAAA record.
    vi.spyOn(netModule, "connect").mockImplementation(
      (options: net.TcpNetConnectOpts) =>
        ++calls === 1 ? new net.Socket() : realNetConnect(options),
    );
    const result = await sendOutboundRequest(
      baseRequest(at(server), { timeoutMs: 2000 }),
      deps({ resolver: () => Promise.resolve(["192.0.2.1", LOOPBACK]) }),
    );
    expect(result.ok).toBe(true);
    expect(result.response?.elapsedMs).toBeLessThan(1900);
  });
});

describe("response parsing bounds", () => {
  it("settles at the zero-size chunk and ignores an endless trailer", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        socket.write(
          "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nhi\r\n0\r\n",
        );
        const timer = setInterval(() => {
          if (socket.destroyed) clearInterval(timer);
          else socket.write("x".repeat(8192));
        }, 1);
      },
    });
    const started = Date.now();
    const result = await sendOutboundRequest(
      baseRequest(at(server), { timeoutMs: 5000 }),
      deps(),
    );
    expect(result.response?.body.toString()).toBe("hi");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("rejects a head over 64 KiB even when it arrives in one read with its terminator", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        socket.end(
          `HTTP/1.1 200 OK\r\nX-Big: ${"a".repeat(70_000)}\r\n\r\nbody`,
        );
      },
    });
    const result = await sendOutboundRequest(baseRequest(at(server)), deps());
    expect(result.failure?.reason).toBe("body_read_failed");
  });

  it("keeps header names such as constructor and __proto__ as plain data", async () => {
    const server = await serve({
      onRequest: ({ socket }) => {
        socket.end(
          "HTTP/1.1 200 OK\r\nconstructor: y\r\n__proto__: z\r\nContent-Length: 0\r\n\r\n",
        );
      },
    });
    const result = await sendOutboundRequest(baseRequest(at(server)), deps());
    const headers = result.response?.headers ?? {};
    expect(Object.getPrototypeOf(headers)).toBeNull();
    expect(headers["constructor"]).toBe("y");
    expect(Object.keys(headers)).toContain("__proto__");
    expect(Object.getOwnPropertyDescriptor(headers, "__proto__")?.value).toBe(
      "z",
    );
  });
});

describe("redirect limits and header carry-over", () => {
  it("caps maxRedirects at 5", async () => {
    const server = await serve({
      onRequest: ({ head, socket }) => {
        const step = Number(/GET \/step\/(\d+)/.exec(head)?.[1] ?? "0");
        if (step < 6) {
          respond(socket, "302 Found", {
            Location: `/step/${String(step + 1)}`,
            "Content-Length": "0",
          });
        } else okBody(socket);
      },
    });
    const result = await sendOutboundRequest(
      baseRequest(at(server, "/step/0"), { maxRedirects: 10 }),
      deps(),
    );
    expect(result.failure?.reason).toBe("redirect_limit");
  });

  it("sends the secret header on a same-origin redirect", async () => {
    const server = await serve({
      onRequest: ({ head, socket }) => {
        if (head.includes("GET /start")) {
          respond(socket, "302 Found", {
            Location: "/end",
            "Content-Length": "0",
          });
        } else okBody(socket);
      },
    });
    await sendOutboundRequest(
      baseRequest(at(server, "/start"), { headers: { "X-Secret": "s3" } }),
      deps(),
    );
    expect(server.requests[1]?.head.toLowerCase()).toContain("x-secret: s3");
  });

  it("always drops authorization and cookie when the destination changes", async () => {
    const target = await serve({
      onRequest: ({ socket }) => {
        okBody(socket);
      },
    });
    const origin = await serve({
      onRequest: ({ socket }) => {
        respond(socket, "302 Found", {
          Location: at(target, "/", "http", OTHER_HOST),
          "Content-Length": "0",
        });
      },
    });
    await sendOutboundRequest(
      baseRequest(at(origin), {
        secretHeaderNames: [],
        headers: {
          Authorization: "Bearer t",
          Cookie: "sid=1",
          "X-Public": "p",
        },
      }),
      deps(),
    );
    const forwarded = target.requests[0]?.head.toLowerCase() ?? "";
    expect(forwarded).not.toContain("authorization");
    expect(forwarded).not.toContain("cookie");
    expect(forwarded).toContain("x-public: p");
    expect(origin.requests[0]?.head.toLowerCase()).toContain("cookie: sid=1");
  });
});
