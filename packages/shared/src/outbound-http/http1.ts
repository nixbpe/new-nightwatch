import type { Duplex } from "node:stream";

const MAX_HEAD_BYTES = 64 * 1024;

export interface Http1Request {
  method: string;
  target: string;
  host: string;
  headers: [name: string, value: string][];
  body?: Uint8Array;
}

export interface Http1Response {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  bodyTruncated: boolean;
}

export class Http1Error extends Error {}

interface ExchangeOptions {
  maxBodyBytes: number;
  /** Return true to resolve right after the head without reading the body (redirects). */
  skipBody: (status: number, headers: Record<string, string>) => boolean;
}

type Framing = "none" | "length" | "chunked" | "close";
type ChunkState = "size" | "data" | "crlf";

/**
 * One HTTP/1.1 request/response on an open socket: `Connection: close`,
 * `Accept-Encoding: identity`, no HTTP/2, no `100 Continue`, no keep-alive.
 */
export function exchange(
  socket: Duplex,
  request: Http1Request,
  options: ExchangeOptions,
): Promise<Http1Response> {
  return new Promise((resolve, reject) => {
    let pending: Buffer = Buffer.alloc(0);
    let status = 0;
    let headers: Record<string, string> | null = null;
    let framing: Framing = "none";
    let remaining = 0;
    let chunkState: ChunkState = "size";
    let chunkRemaining = 0;
    const parts: Buffer[] = [];
    let collected = 0;
    let truncated = false;
    let settled = false;

    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve({
        status,
        headers: headers ?? {},
        body: Buffer.concat(parts),
        bodyTruncated: truncated,
      });
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Http1Error(message));
    };

    const collect = (data: Buffer) => {
      if (data.length === 0) return;
      const room = options.maxBodyBytes - collected;
      if (data.length > room) {
        if (room > 0) parts.push(data.subarray(0, room));
        collected = options.maxBodyBytes;
        truncated = true;
        succeed();
        return;
      }
      parts.push(data);
      collected += data.length;
    };

    const parseHead = (raw: string): boolean => {
      const lines = raw.split("\r\n");
      const match = /^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(lines[0] ?? "");
      if (!match) {
        fail("malformed status line");
        return false;
      }
      status = Number(match[1]);
      headers = Object.create(null) as Record<string, string>;
      for (const line of lines.slice(1)) {
        const colon = line.indexOf(":");
        if (colon <= 0) {
          fail("malformed header");
          return false;
        }
        const name = line.slice(0, colon).toLowerCase();
        const value = line.slice(colon + 1).trim();
        const previous = headers[name];
        headers[name] =
          previous === undefined ? value : `${previous}, ${value}`;
      }
      return true;
    };

    const chooseFraming = (): boolean => {
      const current = headers ?? {};
      if (status < 200) {
        fail("unsupported informational response");
        return false;
      }
      if (
        request.method === "HEAD" ||
        status === 204 ||
        status === 304 ||
        options.skipBody(status, current)
      ) {
        framing = "none";
        return true;
      }
      const encoding = current["transfer-encoding"];
      if (encoding !== undefined) {
        const last = (encoding.split(",").pop() ?? "").trim().toLowerCase();
        framing = last === "chunked" ? "chunked" : "close";
        return true;
      }
      const length = current["content-length"];
      if (length !== undefined) {
        const values = new Set(length.split(",").map((v) => v.trim()));
        const [only = ""] = values;
        if (values.size !== 1 || !/^\d{1,15}$/.test(only)) {
          fail("invalid content-length");
          return false;
        }
        framing = "length";
        remaining = Number(only);
        return true;
      }
      framing = "close";
      return true;
    };

    const readChunked = () => {
      for (;;) {
        if (settled) return;
        if (chunkState === "size") {
          const end = pending.indexOf("\r\n");
          if (end === -1) {
            if (pending.length > 1024) fail("chunk size line too long");
            return;
          }
          const [sizeText = ""] = pending
            .subarray(0, end)
            .toString("latin1")
            .split(";");
          const token = sizeText.trim();
          pending = pending.subarray(end + 2);
          if (!/^[0-9a-fA-F]{1,12}$/.test(token)) {
            fail("invalid chunk size");
            return;
          }
          chunkRemaining = parseInt(token, 16);
          if (chunkRemaining === 0) {
            // Connection: close, so trailers are discarded rather than parsed.
            succeed();
            return;
          }
          chunkState = "data";
        } else if (chunkState === "data") {
          if (pending.length === 0) return;
          const take = Math.min(chunkRemaining, pending.length);
          const piece = pending.subarray(0, take);
          pending = pending.subarray(take);
          chunkRemaining -= take;
          if (chunkRemaining === 0) chunkState = "crlf";
          collect(piece);
        } else {
          if (pending.length < 2) return;
          if (pending[0] !== 0x0d || pending[1] !== 0x0a) {
            fail("invalid chunk terminator");
            return;
          }
          pending = pending.subarray(2);
          chunkState = "size";
        }
      }
    };

    const advance = () => {
      if (headers === null) {
        const end = pending.indexOf("\r\n\r\n");
        if (end === -1) {
          if (pending.length > MAX_HEAD_BYTES) fail("response head too large");
          return;
        }
        if (end > MAX_HEAD_BYTES) {
          fail("response head too large");
          return;
        }
        const raw = pending.subarray(0, end).toString("latin1");
        pending = pending.subarray(end + 4);
        if (!parseHead(raw) || !chooseFraming()) return;
        if (framing === "none") {
          succeed();
          return;
        }
        if (framing === "length" && remaining === 0) {
          succeed();
          return;
        }
      }
      if (framing === "length") {
        const take = Math.min(remaining, pending.length);
        const piece = pending.subarray(0, take);
        pending = pending.subarray(take);
        remaining -= take;
        collect(piece);
        if (remaining === 0) succeed();
      } else if (framing === "close") {
        const piece = pending;
        pending = Buffer.alloc(0);
        collect(piece);
      } else if (framing === "chunked") {
        readChunked();
      }
    };

    socket.on("data", (data: Buffer) => {
      if (settled) return;
      pending = pending.length === 0 ? data : Buffer.concat([pending, data]);
      advance();
    });
    socket.on("end", () => {
      if (settled) return;
      if (headers === null) fail("connection closed before response head");
      else if (framing === "close") succeed();
      else fail("connection closed before body completed");
    });
    socket.on("error", () => {
      fail("socket error");
    });
    socket.on("close", () => {
      if (!settled) fail("connection closed");
    });

    const lines = [
      `${request.method} ${request.target} HTTP/1.1`,
      `Host: ${request.host}`,
      "Connection: close",
      "Accept-Encoding: identity",
      ...request.headers.map(([name, value]) => `${name}: ${value}`),
    ];
    if (request.body !== undefined) {
      lines.push(`Content-Length: ${String(request.body.byteLength)}`);
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (request.body !== undefined) socket.write(request.body);
  });
}
