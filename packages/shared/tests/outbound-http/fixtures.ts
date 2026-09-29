import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";

export const TARGET_HOST = "target.nw-test.internal";

export interface TestPki {
  ca: string;
  leaf: Record<
    "good" | "wrongName" | "expired" | "selfSigned" | "unknownCa",
    { key: string; cert: string }
  >;
  dispose: () => void;
}

function openssl(cwd: string, ...args: string[]) {
  execFileSync("openssl", args, { cwd, stdio: "pipe" });
}

/** Builds a throwaway CA and leaf certificates with the openssl CLI. */
export function createTestPki(): TestPki {
  const dir = mkdtempSync(join(tmpdir(), "nw-outbound-pki-"));
  const read = (file: string) => readFileSync(join(dir, file), "utf8");
  mkdirSync(join(dir, "newcerts"));
  writeFileSync(join(dir, "index.txt"), "");
  writeFileSync(join(dir, "serial"), "01\n");
  writeFileSync(
    join(dir, "ca.cnf"),
    [
      "[ca]",
      "default_ca = local",
      "[local]",
      `dir = ${dir}`,
      "database = $dir/index.txt",
      "new_certs_dir = $dir/newcerts",
      "serial = $dir/serial",
      "default_md = sha256",
      "policy = any",
      "unique_subject = no",
      "[any]",
      "commonName = supplied",
      "",
    ].join("\n"),
  );

  openssl(
    dir,
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    "-days",
    "30",
    "-subj",
    "/CN=NW Test CA/O=NW Test",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
  );
  openssl(
    dir,
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-keyout",
    "ca2.key",
    "-out",
    "ca2.crt",
    "-days",
    "30",
    "-subj",
    "/CN=Other CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
  );

  const issue = (
    name: string,
    host: string,
    signer: "ca" | "ca2",
    dates: string[],
  ) => {
    writeFileSync(join(dir, `${name}.ext`), `subjectAltName=DNS:${host}\n`);
    openssl(
      dir,
      "req",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-keyout",
      `${name}.key`,
      "-out",
      `${name}.csr`,
      "-subj",
      `/CN=${host}`,
    );
    openssl(
      dir,
      "ca",
      "-batch",
      "-notext",
      "-config",
      "ca.cnf",
      "-cert",
      `${signer}.crt`,
      "-keyfile",
      `${signer}.key`,
      "-in",
      `${name}.csr`,
      "-out",
      `${name}.crt`,
      "-extfile",
      `${name}.ext`,
      ...dates,
    );
    return { key: read(`${name}.key`), cert: read(`${name}.crt`) };
  };
  const valid = ["-days", "30"];

  openssl(
    dir,
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-keyout",
    "self.key",
    "-out",
    "self.crt",
    "-days",
    "30",
    "-subj",
    `/CN=${TARGET_HOST}`,
    "-addext",
    `subjectAltName=DNS:${TARGET_HOST}`,
  );

  return {
    ca: read("ca.crt"),
    leaf: {
      good: issue("good", TARGET_HOST, "ca", valid),
      wrongName: issue("wrong", "other.nw-test.internal", "ca", valid),
      expired: issue("expired", TARGET_HOST, "ca", [
        "-startdate",
        "20200101000000Z",
        "-enddate",
        "20200102000000Z",
      ]),
      selfSigned: { key: read("self.key"), cert: read("self.crt") },
      unknownCa: issue("unknown", TARGET_HOST, "ca2", valid),
    },
    dispose: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface CapturedRequest {
  head: string;
  socket: net.Socket;
}

export interface RawServer {
  port: number;
  /** Application-layer bytes received across all connections. */
  bytesReceived: () => number;
  /** TCP connections accepted, including ones that never sent a request. */
  connections: () => number;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

/** A byte-level HTTP server so tests control framing (chunked, close-delimited). */
export async function startRawServer(options: {
  tls?: { key: string; cert: string };
  onRequest?: (request: CapturedRequest) => void;
}): Promise<RawServer> {
  let bytes = 0;
  let connections = 0;
  const requests: CapturedRequest[] = [];
  const open = new Set<net.Socket>();
  const handle = (socket: net.Socket) => {
    open.add(socket);
    socket.on("close", () => open.delete(socket));
    socket.on("error", () => undefined);
    let buffer = "";
    let handled = false;
    socket.on("data", (data: Buffer) => {
      bytes += data.length;
      buffer += data.toString("latin1");
      if (!handled && buffer.includes("\r\n\r\n")) {
        handled = true;
        const request = {
          head: buffer.slice(0, buffer.indexOf("\r\n\r\n")),
          socket,
        };
        requests.push(request);
        options.onRequest?.(request);
      }
    });
  };
  const server = options.tls
    ? tls.createServer({ key: options.tls.key, cert: options.tls.cert }, handle)
    : net.createServer(handle);
  server.on("connection", () => {
    connections++;
  });
  server.on("tlsClientError", () => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    bytesReceived: () => bytes,
    connections: () => connections,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of open) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}

export function respond(
  socket: net.Socket,
  status: string,
  headers: Record<string, string>,
  body = "",
) {
  const head = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  socket.write(`HTTP/1.1 ${status}\r\n${head.join("\r\n")}\r\n\r\n${body}`);
}
