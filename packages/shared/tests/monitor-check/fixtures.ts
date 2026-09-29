import {
  startRawServer,
  TARGET_HOST,
  type RawServer,
} from "../outbound-http/fixtures";
import type {
  CheckDeps,
  NormalizedMonitorConfig,
} from "../../src/monitor-check";

export { createTestPki, TARGET_HOST } from "../outbound-http/fixtures";

export interface Reply {
  status?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

/** Answers every request with `reply(head)`, framing the body with Content-Length. */
export async function serveReplies(
  reply: (head: string) => Reply,
  tls?: { key: string; cert: string },
): Promise<RawServer> {
  return startRawServer({
    ...(tls ? { tls } : {}),
    onRequest: ({ head, socket }) => {
      const { status = "200 OK", headers = {}, body = "" } = reply(head);
      const payload = Buffer.from(body);
      const lines = Object.entries({
        "Content-Length": String(payload.length),
        Connection: "close",
        ...headers,
      }).map(([name, value]) => `${name}: ${value}`);
      socket.write(
        Buffer.concat([
          Buffer.from(`HTTP/1.1 ${status}\r\n${lines.join("\r\n")}\r\n\r\n`),
          payload,
        ]),
      );
    },
  });
}

export const deps = (overrides: CheckDeps = {}): CheckDeps => ({
  resolver: () => Promise.resolve(["127.0.0.1"]),
  testAllowedHosts: [TARGET_HOST],
  ...overrides,
});

export function configFor(
  scheme: "http" | "https",
  port: number,
  overrides: Partial<NormalizedMonitorConfig> = {},
): NormalizedMonitorConfig {
  return {
    url: `${scheme}://${TARGET_HOST}:${String(port)}/health`,
    method: "GET",
    timeoutSeconds: 5,
    headers: [],
    queryParams: [],
    body: null,
    expectedStatus: [{ from: 200, to: 299 }],
    assertions: [],
    auth: { type: "none" },
    ...overrides,
  };
}

export function only<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error("expected one item");
  return item;
}
