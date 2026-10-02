import { createServer } from "node:http";

/**
 * Local HTTP target for the monitor event feed and last response checks
 * (issue #58). Listens on 127.0.0.1 only; the app reaches it through the
 * hostname in OUTBOUND_TEST_ALLOWED_HOSTS. Use one target per monitor so the
 * hit counter of /probe belongs to that monitor's checks alone.
 *
 * Routes (any method):
 *   /probe    answers by the script entry for this hit (the last entry repeats):
 *             { status } or { hang: true } (never answers, so the check times out)
 *   /json     200 JSON while `hang` is false, else never answers; `setHang` flips it
 *   /long     200 text/plain, one line of `longBodyChars` characters without spaces
 *   /reflect  200 text/plain; charset=iso-8859-1, echoing request headers, query and
 *             body into the response headers (x-echo-*) and the body
 *
 * Every request is recorded in `hits`, including the body, so a test can
 * prove the secret really reached the target. Values stay in memory only.
 *
 * @typedef {{ status: number } | { hang: true }} ProbeStep
 * @typedef {{ path: string, search: string, method: string, headers: Record<string, string | string[] | undefined>, body: string }} ResponseTargetHit
 */

/**
 * @param {{ probeScript?: ProbeStep[], longBodyChars?: number }} [options]
 */
export async function startResponseTarget(options = {}) {
  const probeScript = options.probeScript ?? [{ status: 200 }];
  const longBodyChars = options.longBodyChars ?? 20_000;
  let hang = false;
  /** @type {ResponseTargetHit[]} */
  const hits = [];

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://target.invalid");
    /** @type {Buffer[]} */
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1");
      hits.push({
        path: url.pathname,
        search: url.search,
        method: request.method ?? "GET",
        headers: { ...request.headers },
        body,
      });

      if (url.pathname === "/probe") {
        const probeHits = hits.filter((hit) => hit.path === "/probe").length;
        const step =
          probeScript[Math.min(probeHits, probeScript.length) - 1] ??
          probeScript[0];
        if (step !== undefined && "hang" in step) return;
        response.writeHead(step?.status ?? 200, {
          "content-type": "application/json",
        });
        response.end(JSON.stringify({ probe: probeHits }));
      } else if (url.pathname === "/json") {
        if (hang) return;
        response.writeHead(200, {
          "content-type": "application/json",
          "x-feed-check": "ok",
        });
        response.end(JSON.stringify({ status: "ok", data: { count: 3 } }));
      } else if (url.pathname === "/long") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("x".repeat(longBodyChars));
      } else if (url.pathname === "/reflect") {
        /** @type {Record<string, string>} */
        const echoed = {};
        for (const [name, value] of Object.entries(request.headers)) {
          if (name === "host" || name === "connection") continue;
          echoed[`x-echo-${name}`] = Array.isArray(value)
            ? value.join(",")
            : (value ?? "");
        }
        echoed["x-echo-query"] = url.search;
        echoed["x-echo-body"] = body;
        const text = [
          ...Object.entries(request.headers).map(
            ([name, value]) => `${name}: ${String(value)}`,
          ),
          `query: ${url.search}`,
          `body: ${body}`,
        ].join("\n");
        // Node parses and writes header values as latin1, so a value with
        // characters up to U+00FF round-trips unchanged.
        response.writeHead(200, {
          "content-type": "text/plain; charset=iso-8859-1",
          ...echoed,
        });
        response.end(Buffer.from(text, "latin1"));
      } else {
        response.writeHead(404, { "content-type": "application/json" });
        response.end("{}");
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve(undefined);
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("response target did not bind a TCP port");
  }

  return {
    port: address.port,
    hits,
    /** @param {boolean} next whether /json stops answering */
    setHang(next) {
      hang = next;
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
