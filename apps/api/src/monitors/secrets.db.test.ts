import {
  monitorTestResultSchema,
  monitorWriteResponseSchema,
  type MonitorRecord,
} from "@nightwatch/api-contract";
import {
  decryptSecret,
  encryptSecret,
  loadMonitorEnv,
} from "@nightwatch/shared";
import type { Redis } from "ioredis";
import http from "node:http";
import type net from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  blockAuditInserts,
  openIsolatedAuditDatabase,
} from "../audit/test-support";
import { createRedisClient } from "../rate-limit";
import {
  monitorsPath,
  openMonitorTestContext,
  STUB_HOSTS,
  type MonitorTestContext,
  type TestOrganization,
} from "./test-support";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for secret Test runs");

const credentialEnv = loadMonitorEnv({
  NODE_ENV: "test",
  REDIS_URL: redisUrl,
});
const LOOPBACK = "127.0.0.1";
const HEADER_ID = "5b0c1a3e-6f0a-4a57-9c4e-8d1b2a3c4d5e";
const HEADER_SLOT = `header.${HEADER_ID}`;
// Run-unique values: any appearance outside the request under test is a leak,
// and a value cannot match a leftover from an earlier run.
const RUN = crypto.randomUUID();
const TOKEN = `tok-${RUN}-a`;
const USERNAME = `user-${RUN}-b`;
const PASSWORD = `pass-${RUN}-c`;
const API_KEY = `key-${RUN}-d`;
const HEADER_VALUE = `hdr-${RUN}-e`;
const NEW_TOKEN = `tok-${RUN}-replaced`;
const KNOWN_SECRETS = [
  TOKEN,
  USERNAME,
  PASSWORD,
  API_KEY,
  HEADER_VALUE,
  NEW_TOKEN,
];

// ---- Target servers -----------------------------------------------------------

type Seen = { path: string; headers: http.IncomingHttpHeaders };
type Target = {
  port: number;
  seen: Seen[];
  close: () => Promise<void>;
};

async function listen(
  redirectPort: () => number,
  hosts: { same: string; other: string },
): Promise<Target> {
  const seen: Seen[] = [];
  const server = http.createServer((request, response) => {
    const path = request.url ?? "/";
    seen.push({ path, headers: request.headers });
    if (path === "/redirect-other-port") {
      response
        .writeHead(302, {
          location: `http://${hosts.same}:${String(redirectPort())}/reflect`,
        })
        .end();
      return;
    }
    if (path === "/redirect-other-host") {
      response
        .writeHead(302, {
          location: `http://${hosts.other}:${String(port())}/reflect`,
        })
        .end();
      return;
    }
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ headers: request.headers }));
  });
  const sockets = new Set<net.Socket>();
  server.on("connection", (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const port = () => (server.address() as net.AddressInfo).port;
  return {
    port: port(),
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}

// ---- Fixtures -------------------------------------------------------------------

// The AC-21 case creates a trigger on audit_events, which deadlocks with other
// suites that write events, so this file has a database of its own.
let isolated: Awaited<ReturnType<typeof openIsolatedAuditDatabase>>;
let ctx: MonitorTestContext;
let bare: MonitorTestContext;
let redis: Redis;
let org: TestOrganization;
// Listening before collection lets the `it.each` tables name the real port.
const other = await listen(() => 0, {
  same: STUB_HOSTS.allowed,
  other: STUB_HOSTS.allowedOther,
});
const target = await listen(() => other.port, {
  same: STUB_HOSTS.allowed,
  other: STUB_HOSTS.allowedOther,
});
const responses: string[] = [];
const organizationIds: string[] = [];

beforeAll(async () => {
  redis = createRedisClient(redisUrl);
  isolated = await openIsolatedAuditDatabase();
  ctx = await openMonitorTestContext({ redis, urls: isolated.urls });
  bare = await openMonitorTestContext({
    withoutCredentials: true,
    urls: isolated.urls,
  });
  org = await ctx.createOrganization("secrets");
  organizationIds.push(org.id);
}, 120_000);

afterAll(async () => {
  await target.close();
  await other.close();
  await clearRateLimitKeys();
  redis.disconnect();
  await bare.close();
  await ctx.close();
  await isolated.close();
}, 60_000);

afterEach(async () => {
  target.seen.length = 0;
  other.seen.length = 0;
  await clearRateLimitKeys();
});

async function clearRateLimitKeys(): Promise<void> {
  const keys = organizationIds.map((id) => `rl:monitor-test:o:${id}`);
  for (const id of organizationIds) {
    keys.push(...(await redis.keys(`rl:monitor-test:u:*:o:${id}`)));
  }
  if (keys.length > 0) await redis.del(...keys);
}

const owner = () => org.users.owner;

// Every HTTP body is kept for the leak scan.
async function api(
  userId: string | null,
  method: "DELETE" | "GET" | "PATCH" | "POST",
  path: string,
  body?: unknown,
) {
  const response = await ctx.call(userId, method, path, body);
  responses.push(JSON.stringify(response.json));
  return response;
}

const targetUrl = (path = "/reflect") =>
  `http://${STUB_HOSTS.allowed}:${String(target.port)}${path}`;

type Secrets = { slot: string; value: string }[];
type Config = Record<string, unknown>;

function config(overrides: Config = {}): Config {
  return { name: "Secret monitor", url: targetUrl(), ...overrides };
}

const bearer = (): Config => ({
  ...config({ auth: { type: "bearer" } }),
  secrets: [{ slot: "auth.token", value: TOKEN }],
});
const basic = (): Config => ({
  ...config({ auth: { type: "basic" } }),
  secrets: [
    { slot: "auth.username", value: USERNAME },
    { slot: "auth.password", value: PASSWORD },
  ],
});
const apiKey = (): Config => ({
  ...config({ auth: { type: "apiKey", headerName: "X-Api-Key" } }),
  secrets: [{ slot: "auth.apiKey", value: API_KEY }],
});
const secretHeader = (): Config => ({
  ...config({ headers: [{ id: HEADER_ID, name: "X-Secret", secret: true }] }),
  secrets: [{ slot: HEADER_SLOT, value: HEADER_VALUE }],
});

const create = (body: Config, userId = owner(), organization = org) =>
  api(userId, "POST", monitorsPath(organization.id), {
    clientRequestId: crypto.randomUUID(),
    ...body,
  });

async function created(body: Config): Promise<MonitorRecord> {
  const response = await create(body);
  expect(response.status).toBe(201);
  return monitorWriteResponseSchema.parse(response.json).monitor;
}

// The Edit body an unchanged form sends: every configured slot kept.
function editBody(monitor: MonitorRecord, changes: Config = {}): Config {
  return {
    name: monitor.name,
    url: monitor.url,
    intervalSeconds: monitor.intervalSeconds,
    timeoutSeconds: monitor.timeoutSeconds,
    method: monitor.method,
    headers: monitor.headers,
    queryParams: monitor.queryParams,
    body: monitor.body,
    expectedStatus: monitor.expectedStatus,
    assertions: monitor.assertions,
    auth: monitor.auth,
    secrets: monitor.secretSlots.map(({ slot }) => ({ slot, action: "keep" })),
    expectedVersion: monitor.version,
    ...changes,
  };
}

const edit = (monitor: MonitorRecord, changes: Config = {}, userId = owner()) =>
  api(
    userId,
    "PATCH",
    monitorsPath(org.id, `/${monitor.id}`),
    editBody(monitor, changes),
  );

async function editOk(
  monitor: MonitorRecord,
  changes: Config = {},
): Promise<MonitorRecord> {
  const response = await edit(monitor, changes);
  expect(response.status).toBe(200);
  return monitorWriteResponseSchema.parse(response.json).monitor;
}

function testEdit(monitor: MonitorRecord, changes: Config = {}) {
  const body = editBody(monitor, changes);
  delete body.expectedVersion;
  return api(
    owner(),
    "POST",
    monitorsPath(org.id, `/${monitor.id}/test`),
    body,
  );
}

type SecretRow = {
  slot: string;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  key_version: string;
};

async function secretRows(monitorId: string): Promise<SecretRow[]> {
  const result = await ctx.owner.sql.query<SecretRow>(
    `select slot, ciphertext, iv, auth_tag, key_version
     from monitor_secrets where monitor_id = $1 order by slot`,
    [monitorId],
  );
  return result.rows;
}

const slotsOf = async (monitorId: string) =>
  (await secretRows(monitorId)).map((row) => row.slot);

async function monitorRow(id: string) {
  const result = await ctx.owner.sql.query<{
    version: number;
    check_config_version: number;
    consecutive_failures: number;
    headers: unknown;
  }>(
    `select version, check_config_version, consecutive_failures, headers
     from monitors where id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("monitor row missing");
  return row;
}

async function eventKinds(id: string): Promise<string[]> {
  const result = await ctx.owner.sql.query<{ kind: string }>(
    "select kind from monitor_events where monitor_id = $1 order by occurred_at, id",
    [id],
  );
  return result.rows.map((row) => row.kind);
}

// Audit events of one monitor, oldest first (written in the mutation's own
// transaction, F-007).
const auditActions = async (monitorId: string): Promise<string[]> =>
  (
    await ctx.owner.sql.query<{ action: string }>(
      `select action from audit_events
       where target_type = 'monitor' and target_id = $1
       order by occurred_at, id`,
      [monitorId],
    )
  ).rows.map((row) => row.action);

const auditChanges = async (
  monitorId: string,
  action: string,
): Promise<unknown[]> =>
  (
    await ctx.owner.sql.query<{ changes: unknown[] }>(
      `select changes from audit_events
       where target_type = 'monitor' and target_id = $1 and action = $2
       order by occurred_at, id`,
      [monitorId, action],
    )
  ).rows.flatMap((row) => row.changes);

function invalidFields(json: unknown): { field: string; reason: string }[] {
  return (
    json as {
      error: { details: { fields: { field: string; reason: string }[] } };
    }
  ).error.details.fields;
}

// ---- Create ---------------------------------------------------------------------

describe("Create with secrets (AC-25, AC-56)", () => {
  it.each([
    ["bearer", bearer, ["auth.token"]],
    ["basic", basic, ["auth.password", "auth.username"]],
    ["apiKey", apiKey, ["auth.apiKey"]],
    ["a secret header", secretHeader, [HEADER_SLOT]],
  ] as const)(
    "stores %s encrypted and returns only its slot names",
    async (_label, build, slots) => {
      const monitor = await created(build());
      expect(monitor.secretSlots).toEqual(
        slots.map((slot) => ({ slot, configured: true })),
      );
      const detail = await api(
        owner(),
        "GET",
        monitorsPath(org.id, `/${monitor.id}`),
      );
      expect(detail.status).toBe(200);
      expect(
        (detail.json as { monitor: { secretSlots: unknown } }).monitor
          .secretSlots,
      ).toEqual(monitor.secretSlots);
      for (const value of KNOWN_SECRETS) {
        expect(JSON.stringify(detail.json)).not.toContain(value);
      }

      const rows = await secretRows(monitor.id);
      expect(rows.map((row) => row.slot)).toEqual([...slots]);
      const expected = Object.fromEntries(
        (build().secrets as Secrets).map(({ slot, value }) => [slot, value]),
      );
      for (const row of rows) {
        expect(row.ciphertext.toString("utf8")).not.toContain(
          expected[row.slot] ?? "?",
        );
        // The row decrypts only under its own tenant, monitor and slot.
        expect(
          decryptSecret(
            {
              tenantId: org.id,
              monitorId: monitor.id,
              slot: row.slot,
              keyVersion: row.key_version,
              iv: row.iv,
              authTag: row.auth_tag,
              ciphertext: row.ciphertext,
            },
            credentialEnv,
          ),
        ).toBe(expected[row.slot]);
      }
    },
  );

  it("audits one create event for a Create with a secret, and nothing for a replay", async () => {
    const clientRequestId = crypto.randomUUID();
    const first = await api(owner(), "POST", monitorsPath(org.id), {
      clientRequestId,
      ...bearer(),
    });
    const monitor = monitorWriteResponseSchema.parse(first.json).monitor;
    const replay = await api(owner(), "POST", monitorsPath(org.id), {
      clientRequestId,
      ...bearer(),
    });
    expect(replay.status).toBe(201);
    expect(await auditActions(monitor.id)).toEqual([
      "organization.monitor.create",
    ]);
    expect(
      await auditChanges(monitor.id, "organization.monitor.create"),
    ).toEqual([]);
    expect(await slotsOf(monitor.id)).toEqual(["auth.token"]);
  });

  it.each([
    [
      "bearer without a token",
      config({ auth: { type: "bearer" } }),
      [{ field: "auth", reason: "required" }],
    ],
    [
      "basic with only a username",
      {
        ...config({ auth: { type: "basic" } }),
        secrets: [{ slot: "auth.username", value: USERNAME }],
      },
      [{ field: "auth", reason: "required" }],
    ],
    [
      "a secret header without a value",
      config({ headers: [{ id: HEADER_ID, name: "X-S", secret: true }] }),
      [{ field: "headers.0.value", reason: "required" }],
    ],
    [
      "a secret header without an id",
      {
        ...config({ headers: [{ name: "X-S", secret: true }] }),
        secrets: [{ slot: HEADER_SLOT, value: "v" }],
      },
      [{ field: "headers.0.id", reason: "required" }],
    ],
    [
      "a slot the auth type does not use",
      {
        ...config({ auth: { type: "bearer" } }),
        secrets: [
          { slot: "auth.token", value: TOKEN },
          { slot: "auth.password", value: "x" },
        ],
      },
      [{ field: "secrets.1.slot", reason: "invalid_format" }],
    ],
    [
      "an unknown slot",
      { ...config(), secrets: [{ slot: "auth.other", value: "x" }] },
      [{ field: "secrets.0.slot", reason: "invalid_format" }],
    ],
    [
      "a duplicate slot",
      {
        ...config({ auth: { type: "bearer" } }),
        secrets: [
          { slot: "auth.token", value: "a" },
          { slot: "auth.token", value: "b" },
        ],
      },
      [{ field: "secrets.1.slot", reason: "duplicate" }],
    ],
    [
      "an empty value",
      { ...bearer(), secrets: [{ slot: "auth.token", value: "" }] },
      [{ field: "secrets.0.value", reason: "required" }],
    ],
    [
      "a value over 4 KiB",
      {
        ...bearer(),
        secrets: [{ slot: "auth.token", value: "é".repeat(2049) }],
      },
      [{ field: "secrets.0.value", reason: "too_long" }],
    ],
    [
      "a value with a line break",
      { ...bearer(), secrets: [{ slot: "auth.token", value: "a\nb: c" }] },
      [{ field: "secrets.0.value", reason: "crlf" }],
    ],
    [
      "a value with NUL",
      { ...bearer(), secrets: [{ slot: "auth.token", value: "a\0b" }] },
      [{ field: "secrets.0.value", reason: "invalid_format" }],
    ],
    [
      "a lone surrogate",
      { ...bearer(), secrets: [{ slot: "auth.token", value: "a\uD800" }] },
      [{ field: "secrets.0.value", reason: "invalid_format" }],
    ],
  ] as const)("rejects %s and stores nothing", async (_label, body, fields) => {
    const before = await ctx.owner.sql.query(
      "select count(*)::int as total from monitors where tenant_id = $1",
      [org.id],
    );
    const response = await create(body);
    expect(response.status).toBe(400);
    expect(invalidFields(response.json)).toEqual(fields);
    const after = await ctx.owner.sql.query(
      "select count(*)::int as total from monitors where tenant_id = $1",
      [org.id],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("gives viewer, auditor and a non-member 403 and writes nothing", async () => {
    const outsider = await ctx.createUser("secrets-outsider");
    const before = await ctx.owner.sql.query(
      "select count(*)::int as total from monitors where tenant_id = $1",
      [org.id],
    );
    for (const userId of [org.users.viewer, org.users.auditor, outsider]) {
      const response = await create(bearer(), userId);
      expect(response.status).toBe(403);
    }
    const after = await ctx.owner.sql.query(
      "select count(*)::int as total from monitors where tenant_id = $1",
      [org.id],
    );
    expect(after.rows).toEqual(before.rows);
  });
});

// ---- Edit -----------------------------------------------------------------------

describe("Edit secrets (AC-26, AC-46)", () => {
  it("keeps the stored value and changes nothing when the form is unchanged", async () => {
    const monitor = await created(bearer());
    const before = await secretRows(monitor.id);
    const saved = await editOk(monitor);
    expect(saved.version).toBe(1);
    expect(await secretRows(monitor.id)).toEqual(before);
    expect(await auditActions(monitor.id)).toEqual([
      "organization.monitor.create",
    ]);
  });

  it("replaces a value alone: new ciphertext, version and check version up, streak and claim reset", async () => {
    const monitor = await created(bearer());
    await ctx.owner.sql.query(
      "update monitors set consecutive_failures = 2 where id = $1",
      [monitor.id],
    );
    await ctx.owner.sql.query(
      `update monitor_schedule set claim_token = gen_random_uuid(),
       claimed_until = now() + interval '1 minute' where monitor_id = $1`,
      [monitor.id],
    );
    const before = (await secretRows(monitor.id))[0];

    const saved = await editOk(monitor, {
      secrets: [{ slot: "auth.token", action: "replace", value: NEW_TOKEN }],
    });
    expect(saved.version).toBe(2);
    expect(saved.secretSlots).toEqual([
      { slot: "auth.token", configured: true },
    ]);
    const after = (await secretRows(monitor.id))[0];
    expect(
      after?.ciphertext.equals(before?.ciphertext ?? Buffer.alloc(0)),
    ).toBe(false);
    expect(await monitorRow(monitor.id)).toMatchObject({
      version: 2,
      check_config_version: 2,
      consecutive_failures: 0,
    });
    const schedule = await ctx.owner.sql.query<{
      claim_token: string | null;
      check_config_version: number;
    }>(
      "select claim_token, check_config_version from monitor_schedule where monitor_id = $1",
      [monitor.id],
    );
    expect(schedule.rows[0]).toEqual({
      claim_token: null,
      check_config_version: 2,
    });
    expect(await eventKinds(monitor.id)).toEqual(["config_changed"]);
    expect(await auditActions(monitor.id)).toEqual([
      "organization.monitor.create",
      "organization.monitor.secret.replace",
    ]);
    expect(
      await auditChanges(monitor.id, "organization.monitor.secret.replace"),
    ).toEqual([
      {
        field: "secret",
        key: "auth.token",
        before: { kind: "secret_set" },
        after: { kind: "changed" },
      },
    ]);
  });

  it.each([
    ["an empty value", { slot: "auth.token", action: "replace", value: "" }],
    ["no value", { slot: "auth.token", action: "replace" }],
  ])(
    "rejects replace with %s as required and changes nothing",
    async (_l, entry) => {
      const monitor = await created(bearer());
      const before = await secretRows(monitor.id);
      const response = await edit(monitor, { secrets: [entry] });
      expect(response.status).toBe(400);
      expect(invalidFields(response.json)).toEqual([
        { field: "secrets.0.value", reason: "required" },
      ]);
      expect(await secretRows(monitor.id)).toEqual(before);
      expect(await monitorRow(monitor.id)).toMatchObject({ version: 1 });
    },
  );

  it("rejects a value on keep, keep without a stored value, and delete of a required slot", async () => {
    const monitor = await created(bearer());
    const withValue = await edit(monitor, {
      secrets: [{ slot: "auth.token", action: "keep", value: "x" }],
    });
    expect(invalidFields(withValue.json)).toEqual([
      { field: "secrets.0.value", reason: "invalid_format" },
    ]);
    const removed = await edit(monitor, {
      secrets: [{ slot: "auth.token", action: "delete" }],
    });
    expect(invalidFields(removed.json)).toContainEqual({
      field: "secrets.0.slot",
      reason: "required",
    });
    // Basic needs two slots; only one is stored after the type change.
    const switched = await edit(monitor, {
      auth: { type: "basic" },
      secrets: [
        { slot: "auth.username", action: "keep" },
        { slot: "auth.password", action: "replace", value: PASSWORD },
      ],
    });
    expect(invalidFields(switched.json)).toEqual([
      { field: "secrets.0", reason: "required" },
    ]);
    expect(await slotsOf(monitor.id)).toEqual(["auth.token"]);
    expect(await monitorRow(monitor.id)).toMatchObject({ version: 1 });
  });

  it("deletes the old slots when the auth type changes", async () => {
    const monitor = await created(bearer());
    const saved = await editOk(monitor, {
      auth: { type: "apiKey", headerName: "X-Api-Key" },
      secrets: [{ slot: "auth.apiKey", action: "replace", value: API_KEY }],
    });
    expect(saved.secretSlots).toEqual([
      { slot: "auth.apiKey", configured: true },
    ]);
    expect(await slotsOf(monitor.id)).toEqual(["auth.apiKey"]);

    const none = await editOk(saved, { auth: { type: "none" }, secrets: [] });
    expect(none.secretSlots).toEqual([]);
    expect(await slotsOf(monitor.id)).toEqual([]);
  });

  it("accepts an explicit delete of a slot the saved config no longer uses", async () => {
    const monitor = await created(bearer());
    const saved = await editOk(monitor, {
      auth: { type: "none" },
      secrets: [{ slot: "auth.token", action: "delete" }],
    });
    expect(saved.secretSlots).toEqual([]);
    expect(await slotsOf(monitor.id)).toEqual([]);
  });

  it("deletes the slot of a removed secret header and keeps the other", async () => {
    const second = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    const monitor = await created({
      ...config({
        headers: [
          { id: HEADER_ID, name: "X-Secret", secret: true },
          { id: second, name: "X-Other", secret: true },
        ],
      }),
      secrets: [
        { slot: HEADER_SLOT, value: HEADER_VALUE },
        { slot: `header.${second}`, value: "other-value" },
      ],
    });
    const saved = await editOk(monitor, {
      headers: [{ id: second, name: "X-Other", secret: true }],
      secrets: [{ slot: `header.${second}`, action: "keep" }],
    });
    expect(saved.secretSlots).toEqual([
      { slot: `header.${second}`, configured: true },
    ]);
    expect(await slotsOf(monitor.id)).toEqual([`header.${second}`]);
    expect(await monitorRow(monitor.id)).toMatchObject({
      check_config_version: 2,
    });
  });

  it("gives viewer, auditor and a non-member 403 and leaves the row untouched", async () => {
    const monitor = await created(bearer());
    const before = await secretRows(monitor.id);
    const outsider = await ctx.createUser("secrets-edit-outsider");
    for (const userId of [org.users.viewer, org.users.auditor, outsider]) {
      const response = await edit(
        monitor,
        {
          secrets: [
            { slot: "auth.token", action: "replace", value: NEW_TOKEN },
          ],
        },
        userId,
      );
      expect(response.status).toBe(403);
    }
    expect(await secretRows(monitor.id)).toEqual(before);
    expect(await monitorRow(monitor.id)).toMatchObject({ version: 1 });
    // A denied Edit writes no audit event at all, not just none named for a secret.
    expect(await auditActions(monitor.id)).toEqual([
      "organization.monitor.create",
    ]);
  });

  it("leaves no monitor_secrets rows after the monitor is deleted", async () => {
    const monitor = await created(basic());
    expect(await slotsOf(monitor.id)).toHaveLength(2);
    const response = await api(
      owner(),
      "DELETE",
      monitorsPath(org.id, `/${monitor.id}`),
    );
    expect(response.status).toBe(204);
    expect(await slotsOf(monitor.id)).toEqual([]);
  });
});

// ---- Origin change (AC-44) ------------------------------------------------------------

describe("Origin change with a kept secret (AC-44)", () => {
  it.each([
    ["scheme", `https://${STUB_HOSTS.allowed}:PORT/reflect`],
    ["host", `http://${STUB_HOSTS.allowedOther}:PORT/reflect`],
    ["port", `http://${STUB_HOSTS.allowed}:OTHER/reflect`],
  ])(
    "returns 422 on Edit and Test when the %s changes",
    async (_label, template) => {
      const monitor = await created(bearer());
      const url = template
        .replace("PORT", String(target.port))
        .replace("OTHER", String(other.port));
      const before = await secretRows(monitor.id);
      const calls = ctx.resolverCalls.length;

      const edited = await edit(monitor, { url });
      expect(edited.status).toBe(422);
      expect(edited.json).toMatchObject({
        error: { code: "MONITOR_SECRET_ORIGIN_CHANGED" },
      });
      const tested = await testEdit(monitor, { url });
      expect(tested.status).toBe(422);
      expect(tested.json).toMatchObject({
        error: { code: "MONITOR_SECRET_ORIGIN_CHANGED" },
      });

      expect(target.seen).toEqual([]);
      expect(other.seen).toEqual([]);
      expect(await secretRows(monitor.id)).toEqual(before);
      expect(await monitorRow(monitor.id)).toMatchObject({ version: 1 });
      // Save-time DNS may run for Edit; Test resolves nothing before the 422.
      expect(ctx.resolverCalls.length - calls).toBeLessThanOrEqual(1);
    },
  );

  it("passes when only the path changes, and when every slot is replaced with the origin", async () => {
    const monitor = await created(bearer());
    const moved = await editOk(monitor, { url: targetUrl("/other-path?x=1") });
    expect(moved.version).toBe(2);
    expect(await slotsOf(monitor.id)).toEqual(["auth.token"]);

    const url = `http://${STUB_HOSTS.allowedOther}:${String(target.port)}/reflect`;
    const replaced = await editOk(moved, {
      url,
      secrets: [{ slot: "auth.token", action: "replace", value: NEW_TOKEN }],
    });
    expect(replaced.url).toBe(url);
  });
});

// ---- Test (AC-45, AC-43) --------------------------------------------------------------

const REFLECT = [
  {
    kind: "jsonPathEquals",
    path: "$.headers.authorization",
    expected: "never-matches",
  },
];

const resultOf = (json: unknown): unknown =>
  (json as { result: unknown }).result;

function reflected(result: {
  assertions: { actual: string | null }[];
}): string {
  return result.assertions[0]?.actual ?? "";
}

describe("Test in Edit with stored and replaced secrets (AC-45)", () => {
  it("sends the stored value for keep, and does not store or change anything", async () => {
    const monitor = await created(bearer());
    const before = await secretRows(monitor.id);
    const response = await testEdit(monitor, { assertions: REFLECT });
    expect(response.status).toBe(200);
    const request = target.seen.at(-1);
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(await secretRows(monitor.id)).toEqual(before);
    expect(await monitorRow(monitor.id)).toMatchObject({ version: 1 });
  });

  it("sends the replacement for replace and leaves the stored row unchanged", async () => {
    const monitor = await created(bearer());
    const before = await secretRows(monitor.id);
    const response = await testEdit(monitor, {
      assertions: REFLECT,
      secrets: [{ slot: "auth.token", action: "replace", value: NEW_TOKEN }],
    });
    expect(response.status).toBe(200);
    expect(target.seen.at(-1)?.headers.authorization).toBe(
      `Bearer ${NEW_TOKEN}`,
    );
    expect(await secretRows(monitor.id)).toEqual(before);
  });

  it("uses only the provided values before create", async () => {
    const response = await api(owner(), "POST", monitorsPath(org.id, "/test"), {
      ...apiKey(),
      assertions: REFLECT.map((a) => ({
        ...a,
        path: "$.headers['x-api-key']",
      })),
    });
    expect(response.status).toBe(200);
    expect(target.seen.at(-1)?.headers["x-api-key"]).toBe(API_KEY);
  });

  it("sends a secret header and Basic credentials, and shows them as ••• in the result", async () => {
    const header = await created(secretHeader());
    const headerTest = await testEdit(header, {
      assertions: [{ ...REFLECT[0], path: "$.headers['x-secret']" }],
    });
    expect(target.seen.at(-1)?.headers["x-secret"]).toBe(HEADER_VALUE);
    const headerResult = monitorTestResultSchema.parse(
      resultOf(headerTest.json),
    );
    expect(reflected(headerResult)).toBe('"•••"');

    const monitor = await created(basic());
    const response = await testEdit(monitor, { assertions: REFLECT });
    const encoded = Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");
    expect(target.seen.at(-1)?.headers.authorization).toBe(`Basic ${encoded}`);
    const result = monitorTestResultSchema.parse(resultOf(response.json));
    expect(reflected(result)).toBe('"Basic •••"');
    for (const leak of [USERNAME, PASSWORD, encoded]) {
      expect(JSON.stringify(response.json)).not.toContain(leak);
    }
  });

  it("does not forward secrets to another host or another port on a redirect", async () => {
    const monitor = await created(bearer());
    for (const path of ["/redirect-other-port", "/redirect-other-host"]) {
      target.seen.length = 0;
      other.seen.length = 0;
      const response = await testEdit(monitor, { url: targetUrl(path) });
      expect(response.status).toBe(200);
      const hops =
        path === "/redirect-other-port" ? other.seen : target.seen.slice(1);
      expect(hops.length).toBeGreaterThan(0);
      for (const hop of hops) expect(hop.headers.authorization).toBeUndefined();
      // The first hop carried the value.
      expect(target.seen[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("reports a stored slot that cannot be decrypted as a check error, without a request", async () => {
    const monitor = await created(bearer());
    await ctx.owner.sql.query(
      `update monitor_secrets set ciphertext = '\\x00'::bytea where monitor_id = $1`,
      [monitor.id],
    );
    const response = await testEdit(monitor);
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      result: {
        outcome: "check_error",
        failureReason: "secret_decrypt_failed",
      },
    });
    expect(target.seen).toEqual([]);
  });
});

describe("Test in Edit reads (R13-01, R13-02, quota)", () => {
  it("reads the monitor and its kept ciphertext in one statement", async () => {
    const monitor = await created(bearer());
    ctx.statements.length = 0;
    const response = await testEdit(monitor);
    expect(response.status).toBe(200);
    // Two statements are two READ COMMITTED snapshots: an Edit committing between
    // them could pair a new secret with the old origin.
    const reads = ctx.statements.filter((text) =>
      text.includes("monitor_secrets"),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatch(/from\s+monitors\s+as\s+m/);
  });

  it("reports secret_decrypt_failed even when the stored URL is a blocked address", async () => {
    const monitor = await created(bearer());
    // An IP literal: the URL is refused before the request needs the secret.
    const blocked = "http://10.0.0.5:8080/x";
    await ctx.owner.sql.query("update monitors set url = $2 where id = $1", [
      monitor.id,
      blocked,
    ]);
    await ctx.owner.sql.query(
      `update monitor_secrets set ciphertext = set_byte(ciphertext, 0,
         get_byte(ciphertext, 0) # 255) where monitor_id = $1`,
      [monitor.id],
    );
    const refreshed = { ...monitor, url: blocked };
    const response = await testEdit(refreshed);
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      result: {
        outcome: "check_error",
        failureReason: "secret_decrypt_failed",
      },
    });
  });

  it("re-checks write permission before it reads or decrypts a kept secret", async () => {
    const admin = await ctx.createUser("secrets-demoted");
    await ctx.owner.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'admin', now(), now())`,
      [crypto.randomUUID(), org.id, admin],
    );
    const monitor = await created(bearer());
    const path = monitorsPath(org.id, `/${monitor.id}/test`);
    const body = editBody(monitor);
    delete body.expectedVersion;

    // The pre-check and the existence check have passed when the second
    // tenant transaction (the secret read) begins: demote there.
    let transactions = 0;
    ctx.hooks.before = async (text) => {
      if (!text.includes("set_config")) return;
      transactions += 1;
      if (transactions !== 2) return;
      await ctx.owner.sql.query(
        "update member set role = 'viewer' where organization_id = $1 and user_id = $2",
        [org.id, admin],
      );
    };
    target.seen.length = 0;
    const response = await api(admin, "POST", path, body);
    ctx.hooks.before = undefined;

    expect(transactions).toBeGreaterThanOrEqual(2);
    expect(response.status).toBe(403);
    expect(response.json).toMatchObject({
      error: { code: "PERMISSION_DENIED" },
    });
    expect(target.seen).toEqual([]);
    expect(JSON.stringify(response.json)).not.toContain(TOKEN);
    expect(
      ctx
        .logRecords()
        .some(
          (record) =>
            record.action === "organization.monitor.test" &&
            record.code === "PERMISSION_DENIED",
        ),
    ).toBe(true);
  });

  it("spends no rate-limit quota on the origin-change 422", async () => {
    const monitor = await created(bearer());
    const key = `rl:monitor-test:u:${owner()}:o:${org.id}`;
    const moved = await testEdit(monitor, {
      url: `http://${STUB_HOSTS.allowedOther}:${String(target.port)}/reflect`,
    });
    expect(moved.status).toBe(422);
    expect(await redis.zcard(key)).toBe(0);
    expect(await redis.zcard(`rl:monitor-test:o:${org.id}`)).toBe(0);
    expect((await testEdit(monitor)).status).toBe(200);
    expect(await redis.zcard(key)).toBe(1);
  });
});

describe("Audit events for secrets (F-005 AC-61, F-007)", () => {
  const actionsAfter = async (
    monitorId: string,
    work: () => Promise<unknown>,
  ): Promise<string[]> => {
    const before = (await auditActions(monitorId)).length;
    await work();
    return (await auditActions(monitorId)).slice(before);
  };

  it("writes one update event when an Edit changes config and stores a new slot and overwrites one", async () => {
    const monitor = await created(basic());
    const actions = await actionsAfter(monitor.id, () =>
      editOk(monitor, {
        headers: [{ id: HEADER_ID, name: "X-Secret", secret: true }],
        secrets: [
          { slot: "auth.username", action: "keep" },
          { slot: "auth.password", action: "replace", value: NEW_TOKEN },
          { slot: HEADER_SLOT, action: "replace", value: HEADER_VALUE },
        ],
      }),
    );
    expect(actions).toEqual(["organization.monitor.update"]);
    expect(
      await auditChanges(monitor.id, "organization.monitor.update"),
    ).toEqual([
      {
        field: "secret",
        key: "auth.password",
        before: { kind: "secret_set" },
        after: { kind: "changed" },
      },
      {
        field: "secret",
        key: "X-Secret",
        before: null,
        after: { kind: "secret_set" },
      },
    ]);
    expect(
      JSON.stringify(
        await auditChanges(monitor.id, "organization.monitor.update"),
      ),
    ).not.toContain(HEADER_ID);
  });

  it("writes one update event with the new auth slot when the auth type changes", async () => {
    const monitor = await created(bearer());
    const actions = await actionsAfter(monitor.id, () =>
      editOk(monitor, {
        auth: { type: "apiKey", headerName: "X-Api-Key" },
        secrets: [{ slot: "auth.apiKey", action: "replace", value: API_KEY }],
      }),
    );
    expect(actions).toEqual(["organization.monitor.update"]);
    const changes = await auditChanges(
      monitor.id,
      "organization.monitor.update",
    );
    expect(changes).toContainEqual({
      field: "authType",
      before: { kind: "value", value: "bearer" },
      after: { kind: "value", value: "apiKey" },
    });
    expect(changes).toContainEqual({
      field: "secret",
      key: "auth.apiKey",
      before: null,
      after: { kind: "secret_set" },
    });
    expect(changes).toContainEqual({
      field: "secret",
      key: "auth.token",
      before: { kind: "secret_set" },
      after: null,
    });
  });

  it("writes secret.set when an Edit only fills a slot the config needs but the store lacks", async () => {
    const monitor = await created(bearer());
    await ctx.owner.sql.query(
      "delete from monitor_secrets where monitor_id = $1",
      [monitor.id],
    );
    const actions = await actionsAfter(monitor.id, () =>
      editOk(
        { ...monitor, secretSlots: [] },
        {
          secrets: [
            { slot: "auth.token", action: "replace", value: NEW_TOKEN },
          ],
        },
      ),
    );
    expect(actions).toEqual(["organization.monitor.secret.set"]);
    expect(
      await auditChanges(monitor.id, "organization.monitor.secret.set"),
    ).toEqual([
      {
        field: "secret",
        key: "auth.token",
        before: null,
        after: { kind: "secret_set" },
      },
    ]);
  });

  it("stores neither a query value, a body value nor a secret in any event, and masks the query", async () => {
    const queryValue = `qv-${RUN}`;
    const bodyValue = `bv-${RUN}`;
    const newBodyValue = `bv2-${RUN}`;
    const monitor = await created({
      ...bearer(),
      queryParams: [{ name: "api_key", value: queryValue }],
      method: "POST",
      body: { type: "text", content: bodyValue },
    });
    await editOk(monitor, {
      url: targetUrl(`/reflect?sig=${queryValue}`),
      queryParams: [{ name: "api_key", value: `${queryValue}-2` }],
      body: { type: "text", content: newBodyValue },
      secrets: [{ slot: "auth.token", action: "replace", value: NEW_TOKEN }],
    });
    const rows = await ctx.owner.sql.query<{ text: string }>(
      "select t::text as text from audit_events t where target_id = $1",
      [monitor.id],
    );
    const text = rows.rows.map((row) => row.text).join("\n");
    for (const value of [
      queryValue,
      bodyValue,
      newBodyValue,
      TOKEN,
      NEW_TOKEN,
    ]) {
      expect(text.includes(value), "audit_events contains a secret").toBe(
        false,
      );
    }
    const changes = await auditChanges(
      monitor.id,
      "organization.monitor.update",
    );
    expect(changes).toContainEqual({
      field: "body",
      before: null,
      after: { kind: "changed" },
    });
    expect(changes).toContainEqual({
      field: "queryParam",
      key: "api_key",
      before: { kind: "masked" },
      after: { kind: "masked" },
    });
    expect(changes).toContainEqual({
      field: "url",
      before: { kind: "value", value: new URL(targetUrl()).href },
      after: {
        kind: "value",
        value: `${new URL(targetUrl()).href}?sig=\u2022\u2022\u2022`,
      },
    });
    expect(JSON.stringify(changes)).toContain("\u2022\u2022\u2022");
  });

  it("rolls the secret write back when the event insert fails", async () => {
    const organization = await ctx.createOrganization("audit-secret-rollback");
    const as = organization.users.owner;
    const made = await ctx.call(as, "POST", monitorsPath(organization.id), {
      clientRequestId: crypto.randomUUID(),
      ...bearer(),
    });
    expect(made.status).toBe(201);
    const monitor = monitorWriteResponseSchema.parse(made.json).monitor;
    const before = await secretRows(monitor.id);

    const unblock = await blockAuditInserts(
      isolated.urls.ownerUrl,
      organization.id,
    );
    try {
      const edited = await ctx.call(
        as,
        "PATCH",
        monitorsPath(organization.id, `/${monitor.id}`),
        editBody(monitor, {
          secrets: [
            { slot: "auth.token", action: "replace", value: NEW_TOKEN },
          ],
        }),
      );
      expect(edited.status).toBe(500);
    } finally {
      await unblock();
    }
    expect(await secretRows(monitor.id)).toEqual(before);
    expect(await monitorRow(monitor.id)).toMatchObject({ version: 1 });
  });
});

// ---- Credentials unavailable ----------------------------------------------------------

describe("An app built without the credential env", () => {
  it("answers 503 only for a request that stores a secret", async () => {
    const organization = await bare.createOrganization("bare");
    const post = (body: Config) =>
      bare.call(
        organization.users.owner,
        "POST",
        monitorsPath(organization.id),
        { clientRequestId: crypto.randomUUID(), ...body },
      );
    const secret = await post(bearer());
    expect(secret.status).toBe(503);
    expect(secret.json).toMatchObject({
      error: { code: "CREDENTIALS_UNAVAILABLE" },
    });
    const plain = await post(config());
    expect(plain.status).toBe(201);
    const rows = await bare.owner.sql.query(
      "select count(*)::int as total from monitors where tenant_id = $1",
      [organization.id],
    );
    expect(rows.rows).toEqual([{ total: 1 }]);
  });

  it("answers 503 on Edit with replace and on Test in Edit with keep, changing nothing", async () => {
    const organization = await bare.createOrganization("bare-edit");
    const owner = organization.users.owner;
    const id = crypto.randomUUID();
    await bare.owner.sql.query(
      `insert into monitors (id, tenant_id, name, url, auth_type, client_request_id)
       values ($1, $2, 'Bare', $3, 'bearer', $4)`,
      [id, organization.id, targetUrl(), crypto.randomUUID()],
    );
    const sealed = encryptSecret(
      {
        tenantId: organization.id,
        monitorId: id,
        slot: "auth.token",
        value: TOKEN,
      },
      credentialEnv,
    );
    await bare.owner.sql.query(
      `insert into monitor_secrets
         (monitor_id, tenant_id, slot, ciphertext, iv, auth_tag, key_version)
       values ($1, $2, 'auth.token', $3, $4, $5, $6)`,
      [
        id,
        organization.id,
        sealed.ciphertext,
        sealed.iv,
        sealed.authTag,
        sealed.keyVersion,
      ],
    );
    const config = {
      name: "Bare",
      url: targetUrl(),
      auth: { type: "bearer" },
    };
    const path = monitorsPath(organization.id, `/${id}`);
    const edited = await bare.call(owner, "PATCH", path, {
      ...config,
      expectedVersion: 1,
      secrets: [{ slot: "auth.token", action: "replace", value: NEW_TOKEN }],
    });
    expect(edited.status).toBe(503);
    expect(edited.json).toMatchObject({
      error: { code: "CREDENTIALS_UNAVAILABLE" },
    });
    const tested = await bare.call(owner, "POST", `${path}/test`, {
      ...config,
      secrets: [{ slot: "auth.token", action: "keep" }],
    });
    expect(tested.status).toBe(503);
    expect(tested.json).toMatchObject({
      error: { code: "CREDENTIALS_UNAVAILABLE" },
    });
    expect(JSON.stringify([edited.json, tested.json])).not.toMatch(
      /KEYS|ACTIVE_KEY/,
    );
    const after = await bare.owner.sql.query<{ version: number }>(
      "select version from monitors where id = $1",
      [id],
    );
    expect(after.rows).toEqual([{ version: 1 }]);
  });
});

// ---- Leak scan (AC-43, AC-61) ----------------------------------------------------------

const SCANNED_TABLES = [
  "monitors",
  "monitor_schedule",
  "monitor_events",
  "monitor_incidents",
  "monitor_check_results",
  "monitor_check_hourly",
  "monitor_last_responses",
  "monitor_secrets",
  "notification_intents",
  "notification_inbox_items",
  "notification_intent_recipients",
  "notification_dispatch_ledger",
  "audit_events",
];

describe("Scan for known secret values (AC-43)", () => {
  it("finds no secret in any response, log line, monitor table or notification table", async () => {
    const monitor = await created(bearer());
    await editOk(monitor, {
      secrets: [{ slot: "auth.token", action: "replace", value: NEW_TOKEN }],
    });
    await testEdit(monitor, { assertions: REFLECT });
    const second = await created(basic());
    await testEdit(second, { assertions: REFLECT });
    await created(apiKey());
    await created(secretHeader());

    const haystacks: [string, string][] = [
      ["responses", responses.join("\n")],
      ["logs", ctx.lines.join("\n")],
    ];
    for (const table of SCANNED_TABLES) {
      const result = await ctx.owner.sql.query<{ text: string }>(
        `select t::text as text from ${table} t`,
      );
      // Rows of other suites may share the table; the fixtures here are ours.
      haystacks.push([table, result.rows.map((row) => row.text).join("\n")]);
    }
    const encodedBasic = Buffer.from(`${USERNAME}:${PASSWORD}`).toString(
      "base64",
    );
    for (const [name, text] of haystacks) {
      for (const value of [...KNOWN_SECRETS, encodedBasic]) {
        expect(text.includes(value), `${name} contains a secret`).toBe(false);
      }
    }
    // The stored bytes stay in monitor_secrets: ciphertext, iv and tag must not
    // appear, in hex or base64, in any response, log line or other table.
    const stored = await ctx.owner.sql.query<{
      ciphertext: Buffer;
      iv: Buffer;
      auth_tag: Buffer;
    }>(
      // A row a test overwrote with a few bytes would match anywhere.
      `select ciphertext, iv, auth_tag from monitor_secrets
       where tenant_id = $1 and length(ciphertext) >= 8`,
      [org.id],
    );
    expect(stored.rows.length).toBeGreaterThan(5);
    const bytes = stored.rows.flatMap((row) =>
      [row.ciphertext, row.iv, row.auth_tag].flatMap((part) => [
        part.toString("hex"),
        part.toString("base64"),
      ]),
    );
    for (const [name, text] of haystacks) {
      if (name === "monitor_secrets") continue;
      for (const form of bytes) {
        expect(text.includes(form), `${name} contains stored bytes`).toBe(
          false,
        );
      }
    }
  });
});
