// Throwaway CA and leaf certificates (openssl CLI) for HTTPS check targets.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TARGET_HOST, type Target } from "./test-harness";

export type Validity = { days: number } | "expired";

export type TestPki = {
  ca: string;
  issue(host: string, validity: Validity): { key: string; cert: string };
  dispose(): void;
};

export function createTestPki(): TestPki {
  const dir = mkdtempSync(join(tmpdir(), "nw-worker-pki-"));
  const openssl = (...args: string[]) => {
    execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  };
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
    "/CN=NW Worker Test CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
  );
  let counter = 0;
  return {
    ca: read("ca.crt"),
    issue(host, validity) {
      counter += 1;
      const name = `leaf${String(counter)}`;
      writeFileSync(join(dir, `${name}.ext`), `subjectAltName=DNS:${host}\n`);
      openssl(
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
      const dates =
        validity === "expired"
          ? ["-startdate", "20200101000000Z", "-enddate", "20200102000000Z"]
          : ["-days", String(validity.days)];
      openssl(
        "ca",
        "-batch",
        "-notext",
        "-config",
        "ca.cnf",
        "-cert",
        "ca.crt",
        "-keyfile",
        "ca.key",
        "-in",
        `${name}.csr`,
        "-out",
        `${name}.crt`,
        "-extfile",
        `${name}.ext`,
        ...dates,
      );
      return { key: read(`${name}.key`), cert: read(`${name}.crt`) };
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** HTTPS or HTTP target on loopback; `host` is the name the URL uses. */
export async function startTlsTarget(
  credentials: { key: string; cert: string } | null,
  handler: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => void = (_request, response) => {
    response.statusCode = 200;
    response.end("ok");
  },
  host: string = TARGET_HOST,
): Promise<Target & { origin: string }> {
  const requests: Target["requests"] = [];
  let current = handler;
  const listener = (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => {
    requests.push({
      method: request.method ?? "",
      url: request.url ?? "",
      headers: request.headers,
    });
    current(request, response);
  };
  const server = credentials
    ? https.createServer(credentials, listener)
    : http.createServer(listener);
  server.on("tlsClientError", () => undefined);
  let connections = 0;
  let closed = 0;
  server.on("connection", (socket) => {
    connections += 1;
    socket.once("close", () => {
      closed += 1;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `${credentials ? "https" : "http"}://${host}:${String(port)}`;
  return {
    url: origin,
    origin,
    port,
    connections: () => connections,
    closedConnections: () => closed,
    requests,
    setHandler(next) {
      current = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
