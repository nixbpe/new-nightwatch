// Shared setup of the monitor checker integration tests: a throwaway Postgres
// container (claims and purges are cross-tenant, so tests must not share a
// database), fixture monitors and local HTTP targets.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import {
  createDatabase,
  runMigrations,
  withTenantContextRaw,
  type Database,
} from "@nightwatch/db";
import type { OutboundDeps } from "@nightwatch/shared";

import type { MonitorCheckJob } from "./queue";

export const TARGET_HOST = "target.nw-test.internal";

/** Resolves the test host to loopback; every other host is refused by the SSRF helper. */
export const outboundDeps: OutboundDeps = {
  resolver: () => Promise.resolve(["127.0.0.1"]),
  testAllowedHosts: [TARGET_HOST],
};

const initRolesScript = fileURLToPath(
  new URL("../../../../scripts/db/init/001-roles.sh", import.meta.url),
);
const migrationsDir = new URL(
  "../../../../packages/db/migrations",
  import.meta.url,
).pathname;

type DockerResult = { exitCode: number; stdout: string; stderr: string };
function docker(args: string[], allowFailure = false): Promise<DockerResult> {
  const { promise, reject, resolve } = Promise.withResolvers<DockerResult>();
  const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.once("error", reject);
  child.once("close", (exitCode) => {
    const result = {
      exitCode: exitCode ?? 1,
      stdout: Buffer.concat(stdout).toString(),
      stderr: Buffer.concat(stderr).toString(),
    };
    if (result.exitCode !== 0 && !allowFailure)
      reject(new Error(result.stderr || result.stdout || "docker failed"));
    else resolve(result);
  });
  return promise;
}

function databaseUrl(username: string, password: string, port: number): string {
  const url = new URL("postgres://localhost/nightwatch");
  url.username = username;
  url.password = password;
  url.port = String(port);
  return url.toString();
}

export type TestDatabase = {
  owner: Database;
  runtime: Database;
  runtimeUrl: string;
  ownerUrl: string;
  stop(): Promise<void>;
};

export async function startTestDatabase(label: string): Promise<TestDatabase> {
  const run = randomUUID();
  const ownerPassword = `owner-${randomUUID()}`;
  const runtimePassword = `runtime-${randomUUID()}`;
  const container = `nightwatch-monitor-${label}-postgres-${run}`;
  await docker([
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_USER=nightwatch_owner",
    "--env",
    `POSTGRES_PASSWORD=${ownerPassword}`,
    "--env",
    "POSTGRES_DB=nightwatch",
    "--env",
    `NW_DB_PASSWORD=${runtimePassword}`,
    "--volume",
    `${initRolesScript}:/docker-entrypoint-initdb.d/001-roles.sh:ro`,
    "postgres:17.11-alpine",
  ]);
  let owner: Database | null = null;
  let runtime: Database | null = null;
  try {
    await docker([
      "exec",
      container,
      "sh",
      "-ceu",
      `timeout 40 sh -ceu 'until pg_isready -h 127.0.0.1 -U nightwatch_owner -d nightwatch >/dev/null && psql -h 127.0.0.1 -U nightwatch_owner -d nightwatch -Atqc "select 1 from pg_roles where rolname = '"'"'nightwatch'"'"'" | grep -qx 1; do sleep 0.1; done'`,
    ]);
    const { stdout } = await docker(["port", container, "5432/tcp"]);
    const port = Number(/:(\d+)\s*$/.exec(stdout)?.[1]);
    const ownerUrl = databaseUrl("nightwatch_owner", ownerPassword, port);
    const runtimeUrl = databaseUrl("nightwatch", runtimePassword, port);
    await runMigrations({ url: ownerUrl, migrationsDir, log: () => undefined });
    owner = createDatabase(ownerUrl);
    runtime = createDatabase(runtimeUrl);
    const opened = { owner, runtime };
    return {
      ...opened,
      ownerUrl,
      runtimeUrl,
      async stop() {
        await opened.runtime.close();
        await opened.owner.close();
        await docker(["rm", "--force", container], true);
      },
    };
  } catch (error) {
    await runtime?.close();
    await owner?.close();
    await docker(["rm", "--force", container], true);
    throw error;
  }
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
  monitorId: string;
  claimToken: string;
  job(overrides?: Partial<MonitorCheckJob>): MonitorCheckJob;
};

/** Organization, monitor and a claimed schedule row (the state right after a claim). */
export async function seedMonitor(
  db: TestDatabase,
  options: SeedOptions = {},
): Promise<SeededMonitor> {
  const tenantId = randomUUID();
  const monitorId = randomUUID();
  const claimToken = options.claimToken ?? randomUUID();
  const interval = options.intervalSeconds ?? 60;
  const timeout = options.timeoutSeconds ?? 10;
  const version = options.checkConfigVersion ?? 1;
  await db.owner.sql.query(
    "insert into organization (id, name, slug) values ($1, 'Checker', $2)",
    [tenantId, `checker-${randomUUID()}`],
  );
  await withTenantContextRaw(db.runtime, tenantId, async (client) => {
    await client.query(
      `insert into monitors
         (id, tenant_id, name, url, method, headers, query_params, auth_type,
          api_key_header_name, expected_status_ranges, assertions,
          interval_seconds, timeout_seconds, status, check_config_version,
          client_request_id)
       values ($1, $2, 'Checked monitor', $3, $4, $5::jsonb, $6::jsonb, $7, $8,
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
  /** Replaces the response behavior for later requests. */
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
  server.on("connection", () => {
    connections += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${TARGET_HOST}:${String(port)}`,
    port,
    connections: () => connections,
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

/** A loopback port with nothing listening on it. */
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
  await docker([
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "--publish",
    "127.0.0.1::6379",
    "redis:7.4.7-alpine",
  ]);
  try {
    await docker([
      "exec",
      container,
      "sh",
      "-ceu",
      "timeout 30 sh -ceu 'until redis-cli ping | grep -q PONG; do sleep 0.1; done'",
    ]);
    const { stdout } = await docker(["port", container, "6379/tcp"]);
    const port = Number(/:(\d+)\s*$/.exec(stdout)?.[1]);
    return {
      url: `redis://127.0.0.1:${String(port)}`,
      freeze: async () => {
        await docker(["pause", container]);
      },
      stop: async () => {
        await docker(["rm", "--force", container], true);
      },
    };
  } catch (error) {
    await docker(["rm", "--force", container], true);
    throw error;
  }
}
