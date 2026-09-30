import { createServer } from "node:http";

/**
 * Local HTTP target for monitor e2e and integrated verification. It listens on
 * 127.0.0.1 only; the app reaches it through the hostname listed in
 * OUTBOUND_TEST_ALLOWED_HOSTS (the SSRF helper blocks loopback otherwise).
 *
 * Routes (any method):
 *   /health          200 JSON while `mode` is "up", 503 while "down"
 *   /status/:code    that status
 *   /slow?ms=N       200 after N ms
 *   /creds           200 only when every header in `credentials` matches, else 401
 *   /reflect         200 JSON echoing the request headers (secret redaction checks)
 *   /redirect?to=URL 302 to URL
 *   /json            200 {"status":"ok","data":{"count":3}}
 *
 * `hits` records every request so a test can prove that a denied operation
 * sent nothing out. Header values stay in memory and are never printed.
 *
 * @typedef {{ at: number, method: string, path: string, headers: Record<string, string | string[] | undefined> }} TargetHit
 */

/**
 * @param {{ port?: number }} [options]
 */
export async function startMonitorTarget(options = {}) {
  /** @type {"up" | "down"} */
  let mode = "up";
  /** @type {Record<string, string>} */
  let credentials = {};
  /** @type {TargetHit[]} */
  const hits = [];

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://target.invalid");
    hits.push({
      at: Date.now(),
      method: request.method ?? "GET",
      path: url.pathname,
      headers: { ...request.headers },
    });
    request.resume();
    const send = (status, body, headers = {}) => {
      response.writeHead(status, {
        "content-type": "application/json",
        ...headers,
      });
      response.end(request.method === "HEAD" ? undefined : body);
    };

    if (url.pathname === "/health") {
      if (mode === "up") send(200, JSON.stringify({ status: "ok" }));
      else send(503, JSON.stringify({ status: "down" }));
    } else if (url.pathname.startsWith("/status/")) {
      const code = Number(url.pathname.slice("/status/".length));
      send(Number.isInteger(code) ? code : 400, "{}");
    } else if (url.pathname === "/slow") {
      const ms = Number(url.searchParams.get("ms") ?? "0");
      setTimeout(() => {
        send(200, JSON.stringify({ status: "slow" }));
      }, ms);
    } else if (url.pathname === "/creds") {
      const matches = Object.entries(credentials).every(
        ([name, value]) => request.headers[name.toLowerCase()] === value,
      );
      send(matches ? 200 : 401, JSON.stringify({ authenticated: matches }));
    } else if (url.pathname === "/reflect") {
      send(200, JSON.stringify({ headers: request.headers }));
    } else if (url.pathname === "/redirect") {
      send(302, "{}", { location: url.searchParams.get("to") ?? "/health" });
    } else if (url.pathname === "/json") {
      send(200, JSON.stringify({ status: "ok", data: { count: 3 } }));
    } else {
      send(404, "{}");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      resolve(undefined);
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("monitor target did not bind a TCP port");
  }

  return {
    port: address.port,
    hits,
    /** @param {"up" | "down"} next */
    setMode(next) {
      mode = next;
    },
    /** @param {Record<string, string>} next lower-case header name to expected value */
    setCredentials(next) {
      credentials = next;
    },
    /** @param {string} path */
    hitsFor(path) {
      return hits.filter((hit) => hit.path === path);
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => {
        server.close(() => {
          resolve(undefined);
        });
      });
    },
  };
}
