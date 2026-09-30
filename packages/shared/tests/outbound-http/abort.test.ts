import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCheck, type CheckDeps } from "../../src/monitor-check";
import {
  sendOutboundRequest,
  type OutboundRequest,
} from "../../src/outbound-http";
import { configFor } from "../monitor-check/fixtures";
import { TARGET_HOST } from "./fixtures";

const LOOPBACK = "127.0.0.1";
const netModule = net as {
  connect: (options: net.TcpNetConnectOpts) => net.Socket;
};
const realConnect = net.connect;

interface Hanging {
  port: number;
  /** Server-side sockets still open. */
  open: () => number;
  received: () => number;
  close: () => Promise<void>;
}

/** Accepts TCP and answers with `onData` (or never), tracking open sockets. */
async function hangingServer(
  onData?: (socket: net.Socket, received: Buffer) => void,
): Promise<Hanging> {
  const sockets = new Set<net.Socket>();
  let bytes = 0;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.on("data", (data: Buffer) => {
      bytes += data.length;
      onData?.(socket, data);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const hanging: Hanging = {
    port: (server.address() as net.AddressInfo).port,
    open: () => sockets.size,
    received: () => bytes,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
  return hanging;
}

const servers: Hanging[] = [];
afterEach(async () => {
  netModule.connect = realConnect;
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const deps = (overrides: CheckDeps = {}): CheckDeps => ({
  resolver: () => Promise.resolve([LOOPBACK]),
  testAllowedHosts: [TARGET_HOST],
  ...overrides,
});

const request = (
  url: string,
  signal: AbortSignal,
  timeoutMs = 10_000,
): OutboundRequest => ({
  url,
  method: "GET",
  headers: {},
  timeoutMs,
  maxRedirects: 5,
  secretHeaderNames: [],
  maxBodyBytes: 1024 * 1024,
  signal,
});

const target = (port: number, scheme = "http") =>
  `${scheme}://${TARGET_HOST}:${String(port)}/`;

/** Aborts once `ready()` holds, so the abort lands in the phase under test whatever the load. */
async function abortWhen<T>(
  ready: () => boolean,
  run: (s: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const pending = run(controller.signal);
  await vi.waitFor(
    () => {
      expect(ready()).toBe(true);
    },
    { timeout: 20_000, interval: 5 },
  );
  controller.abort();
  return pending;
}

describe("caller abort of sendOutboundRequest", () => {
  it("makes no connection and no lookup for an already aborted signal", async () => {
    const server = await hangingServer();
    servers.push(server);
    const resolver = vi.fn(() => Promise.resolve([LOOPBACK]));
    const result = await sendOutboundRequest(
      request(target(server.port), AbortSignal.abort()),
      deps({ resolver }),
    );
    expect(result.failure?.reason).toBe("executor_error");
    expect(resolver).not.toHaveBeenCalled();
    expect(server.open()).toBe(0);
    expect(server.received()).toBe(0);
  });

  it("stops during DNS resolution", async () => {
    let lookups = 0;
    const result = await abortWhen(
      () => lookups === 1,
      (signal) =>
        sendOutboundRequest(
          request(target(9999), signal),
          deps({
            resolver: () => {
              lookups++;
              return new Promise<string[]>(() => undefined);
            },
          }),
        ),
    );
    // The 10 s request timeout would report `timeout` instead.
    expect(result.failure?.reason).toBe("executor_error");
  });

  it("stops during connect and destroys the socket", async () => {
    const sockets: net.Socket[] = [];
    netModule.connect = () => {
      const socket = new net.Socket();
      sockets.push(socket);
      return socket;
    };
    const result = await abortWhen(
      () => sockets.length === 1,
      (signal) => sendOutboundRequest(request(target(9999), signal), deps()),
    );
    expect(result.failure?.reason).toBe("executor_error");
    expect(sockets.every((socket) => socket.destroyed)).toBe(true);
  });

  it("stops during the TLS handshake and closes the connection", async () => {
    const server = await hangingServer();
    servers.push(server);
    // The ClientHello reached the server, so the client is inside the handshake.
    const result = await abortWhen(
      () => server.received() > 0,
      (signal) =>
        sendOutboundRequest(
          request(target(server.port, "https"), signal),
          deps(),
        ),
    );
    expect(result.failure?.reason).toBe("executor_error");
    await vi.waitFor(() => {
      expect(server.open()).toBe(0);
    });
  });

  it("stops during the body read and closes the connection", async () => {
    const server = await hangingServer((socket) => {
      socket.write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial");
    });
    servers.push(server);
    const result = await abortWhen(
      () => server.received() > 0,
      (signal) =>
        sendOutboundRequest(request(target(server.port), signal), deps()),
    );
    expect(result.failure?.reason).toBe("executor_error");
    expect(result.response).toBeUndefined();
    await vi.waitFor(() => {
      expect(server.open()).toBe(0);
    });
  });

  it("still reports timeout when nothing aborts", async () => {
    const result = await sendOutboundRequest(
      request(target(9999), new AbortController().signal, 100),
      deps({ resolver: () => new Promise<string[]>(() => undefined) }),
    );
    expect(result.failure?.reason).toBe("timeout");
  });

  it("reports timeout when the timer fires before the caller aborts", async () => {
    const controller = new AbortController();
    const pending = sendOutboundRequest(
      request(target(9999), controller.signal, 50),
      deps({ resolver: () => new Promise<string[]>(() => undefined) }),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    controller.abort();
    expect((await pending).failure?.reason).toBe("timeout");
  });
});

describe("caller abort of runCheck", () => {
  it("returns check_error executor_error and every assertion not evaluated", async () => {
    const server = await hangingServer();
    servers.push(server);
    const result = await abortWhen(
      () => server.received() > 0 || server.open() > 0,
      (signal) =>
        runCheck(
          configFor("http", server.port, {
            assertions: [{ kind: "bodyContains", text: "x" }],
          }),
          {},
          deps({ signal }),
        ),
    );
    expect(result).toMatchObject({
      outcome: "check_error",
      failureReason: "executor_error",
      tls: null,
    });
    expect(result.assertions[0]).toMatchObject({
      status: "not_evaluated",
      reason: "no_response",
    });
    await vi.waitFor(() => {
      expect(server.open()).toBe(0);
    });
  });

  it("does not connect for an already aborted signal", async () => {
    const server = await hangingServer();
    servers.push(server);
    const result = await runCheck(
      configFor("http", server.port),
      {},
      deps({ signal: AbortSignal.abort() }),
    );
    expect(result).toMatchObject({
      outcome: "check_error",
      failureReason: "executor_error",
    });
    expect(server.open()).toBe(0);
    expect(server.received()).toBe(0);
  });
});
