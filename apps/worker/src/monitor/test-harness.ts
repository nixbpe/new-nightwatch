// Shared setup of the monitor checker integration tests: a throwaway Postgres
// container (claims and purges are cross-tenant, so tests must not share a
// database), fixture monitors and local HTTP targets.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { withTenantContextRaw, type Database } from "@nightwatch/db";
import { openTestPostgres } from "@nightwatch/db/testing";
import type { OutboundDeps } from "@nightwatch/shared";

import type { MonitorCheckJob } from "./queue";

export const TARGET_HOST = "target.nw-test.internal";

/** Resolves the test host to loopback; every other host is refused by the SSRF helper. */
export const outboundDeps: OutboundDeps = {
  resolver: () => Promise.resolve(["127.0.0.1"]),
  testAllowedHosts: [TARGET_HOST],
};

type DockerResult = { exitCode: number; stdout: string; stderr: string };
function docker(args: string[], timeoutMs = 5_000): Promise<DockerResult> {
  const { promise, reject, resolve } = Promise.withResolvers<DockerResult>();
  const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  child.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once("close", (exitCode) => {
    clearTimeout(timer);
    const result = {
      exitCode: exitCode ?? 1,
      stdout: Buffer.concat(stdout).toString(),
      stderr: Buffer.concat(stderr).toString(),
    };
    if (timedOut) reject(new Error(`docker ${args[0] ?? "command"} timed out`));
    else if (result.exitCode !== 0)
      reject(new Error(result.stderr || result.stdout || "docker failed"));
    else resolve(result);
  });
  return promise;
}

export type TestDatabase = {
  owner: Database;
  runtime: Database;
  runtimeUrl: string;
  ownerUrl: string;
  stop(): Promise<void>;
};

export async function startTestDatabase(label: string): Promise<TestDatabase> {
  const fixture = await openTestPostgres(label);
  return {
    owner: fixture.owner,
    runtime: fixture.runtime,
    ...fixture.urls,
    stop: () => fixture.close(),
  };
}

export type SeedOptions = {
  url?: string;
  intervalSeconds?: number;
  timeoutSeconds?: number;
  method?: string;
  headers?: unknown[];
  queryParams?: unknown[];
  authType?: "none" | "bearer" | "basic" | "apiKey";
  apiKeyHeaderName?: string;
  expectedStatusRanges?: { from: number; to: number }[];
  assertions?: unknown[];
  checkConfigVersion?: number;
  status?: "active" | "paused";
  claimToken?: string;
};

export type SeededMonitor = {
  tenantId: string;
  projectId: string;
  /** An unused id for a second Project of the Organization. */
  otherProjectId: string;
  monitorId: string;
  claimToken: string;
  job(overrides?: Partial<MonitorCheckJob>): MonitorCheckJob;
};

export async function seedMonitor(
  db: TestDatabase,
  options: SeedOptions = {},
): Promise<SeededMonitor> {
  const tenantId = randomUUID();
  const projectId = randomUUID();
  const monitorId = randomUUID();
  const claimToken = options.claimToken ?? randomUUID();
  const interval = options.intervalSeconds ?? 60;
  const timeout = options.timeoutSeconds ?? 10;
  const version = options.checkConfigVersion ?? 1;
  await db.owner.sql.query(
    "insert into organization (id, name, slug) values ($1, 'Checker', $2)",
    [tenantId, `checker-${randomUUID()}`],
  );
  await db.owner.sql.query(
    "insert into projects (id, tenant_id, name, slug) values ($1, $2, 'Checker', $3)",
    [projectId, tenantId, `checker-${projectId.slice(0, 8)}`],
  );
  await withTenantContextRaw(db.runtime, tenantId, async (client) => {
    await client.query(
      `insert into monitors
         (id, tenant_id, project_id, name, url, method, headers, query_params,
          auth_type, api_key_header_name, expected_status_ranges, assertions,
          interval_seconds, timeout_seconds, status, check_config_version,
          client_request_id)
       values ($1, $2, $16, 'Checked monitor', $3, $4, $5::jsonb, $6::jsonb, $7, $8,
               $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15)`,
      [
        monitorId,
        tenantId,
        options.url ?? `http://${TARGET_HOST}:9/health`,
        options.method ?? "GET",
        JSON.stringify(options.headers ?? []),
        JSON.stringify(options.queryParams ?? []),
        options.authType ?? "none",
        options.apiKeyHeaderName ?? null,
        JSON.stringify(
          options.expectedStatusRanges ?? [{ from: 200, to: 299 }],
        ),
        JSON.stringify(options.assertions ?? []),
        interval,
        timeout,
        options.status ?? "active",
        version,
        randomUUID(),
        projectId,
      ],
    );
    await client.query(
      `insert into monitor_schedule
         (monitor_id, tenant_id, next_check_at, claim_token, claimed_until,
          check_config_version, interval_seconds, timeout_seconds)
       values ($1, $2, now() + interval '1 hour', $3, now() + interval '5 minutes',
               $4, $5, $6)`,
      [monitorId, tenantId, claimToken, version, interval, timeout],
    );
  });
  return {
    tenantId,
    projectId,
    otherProjectId: randomUUID(),
    monitorId,
    claimToken,
    job: (overrides = {}) => ({
      tenantId,
      monitorId,
      claimToken,
      checkConfigVersion: version,
      scheduledFor: new Date().toISOString(),
      ...overrides,
    }),
  };
}

export type Target = {
  url: string;
  port: number;
  /** TCP connections accepted; a request that never reached the server leaves this at 0. */
  connections(): number;
  /** Accepted connections the client side has since closed. */
  closedConnections(): number;
  setHandler(handler: TargetHandler): void;
  requests: {
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
  }[];
  close(): Promise<void>;
};

type TargetHandler = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
) => void;

/** Local HTTP target on 127.0.0.1; reached through the stub resolver only. */
export async function startTarget(
  initial: TargetHandler = (_request, response) => {
    response.statusCode = 200;
    response.end("ok");
  },
): Promise<Target> {
  let handler = initial;
  const requests: Target["requests"] = [];
  const server = http.createServer((request, response) => {
    requests.push({
      method: request.method ?? "",
      url: request.url ?? "",
      headers: request.headers,
    });
    handler(request, response);
  });
  server.keepAliveTimeout = 0;
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
  return {
    url: `http://${TARGET_HOST}:${String(port)}`,
    port,
    connections: () => connections,
    closedConnections: () => closed,
    setHandler(next) {
      handler = next;
    },
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

export async function updateMonitor(
  db: TestDatabase,
  seeded: SeededMonitor,
  sql: string,
  values: unknown[] = [],
): Promise<void> {
  await withTenantContextRaw(db.runtime, seeded.tenantId, (client) =>
    client.query(sql, values),
  );
}

export async function rows<T extends Record<string, unknown>>(
  db: TestDatabase,
  seeded: SeededMonitor,
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  return withTenantContextRaw(db.runtime, seeded.tenantId, async (client) => {
    const result = await client.query<T>(sql, values);
    return result.rows;
  });
}

export async function closedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export type TestRedis = {
  url: string;
  /** Freezes the container: connections hang instead of being refused. */
  freeze(): Promise<void>;
  stop(): Promise<void>;
};

/** Throwaway Redis so process tests never share a queue with other runs. */
export async function startTestRedis(label: string): Promise<TestRedis> {
  const container = `nightwatch-monitor-${label}-redis-${randomUUID()}`;
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      const { stdout } = await docker([
        "container",
        "ls",
        "--all",
        "--quiet",
        "--filter",
        `name=^/${container}$`,
      ]);
      if (stdout.trim())
        await docker(["rm", "--force", "--volumes", container]);
      const remaining = await docker([
        "container",
        "ls",
        "--all",
        "--quiet",
        "--filter",
        `name=^/${container}$`,
      ]);
      if (remaining.stdout.trim())
        throw new Error(`Unresolved owned container ${container}`);
    })();
    return stopping;
  };
  try {
    await docker(
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        container,
        "--publish",
        "127.0.0.1::6379",
        "redis:7.4.7-alpine",
      ],
      15_000,
    );
    await docker(
      [
        "exec",
        container,
        "sh",
        "-ceu",
        "timeout 20 sh -ceu 'until redis-cli ping | grep -q PONG; do sleep 0.1; done'",
      ],
      25_000,
    );
    const { stdout } = await docker(["port", container, "6379/tcp"]);
    const port = Number(/^127\.0\.0\.1:(\d+)\s*$/.exec(stdout)?.[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid Redis loopback port binding");
    return {
      url: `redis://127.0.0.1:${String(port)}`,
      freeze: async () => {
        await docker(["pause", container]);
      },
      stop,
    };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Redis setup and cleanup failed: ${container}`,
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
