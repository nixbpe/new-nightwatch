import {
  monitorWriteResponseSchema,
  type MonitorConfigInput,
  type MonitorRecord,
} from "@nightwatch/api-contract";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  monitorsPath,
  openMonitorTestContext,
  STUB_HOSTS,
  TEST_ROLES,
  validConfig,
  type MonitorTestContext,
  type TestOrganization,
  type TestRole,
} from "./test-support";

let ctx: MonitorTestContext;
let org: TestOrganization;
let otherOrg: TestOrganization;
// Separate Organizations keep each section below the 50-monitor limit.
let vOrg: TestOrganization;
let outsider: string;

beforeAll(async () => {
  ctx = await openMonitorTestContext();
  org = await ctx.createOrganization("monitor-a");
  otherOrg = await ctx.createOrganization("monitor-b");
  vOrg = await ctx.createOrganization("monitor-v");
  outsider = await ctx.createUser("monitor-outsider");
}, 120_000);

afterAll(async () => {
  await ctx.close();
});

const create = (
  organizationId: string,
  userId: string | null,
  config = validConfig(),
  clientRequestId: string = crypto.randomUUID(),
) =>
  ctx.call(userId, "POST", monitorsPath(organizationId), {
    ...config,
    clientRequestId,
  });

async function createdBy(
  userId: string,
  config = validConfig(),
  organization = org,
) {
  const response = await create(organization.id, userId, config);
  expect(response.status).toBe(201);
  return monitorWriteResponseSchema.parse(response.json).monitor;
}

async function monitorRows(organizationId: string) {
  const result = await ctx.owner.sql.query<{
    id: string;
    version: number;
    status: string;
    updated_at: Date;
  }>(
    "select id, version, status, updated_at from monitors where tenant_id = $1 order by id",
    [organizationId],
  );
  return result.rows;
}

type Operation = "create" | "edit" | "pause" | "resume" | "delete";

function request(
  operation: Operation,
  organizationId: string,
  monitor: MonitorRecord,
): { method: "DELETE" | "PATCH" | "POST"; path: string; body?: unknown } {
  const item = monitorsPath(organizationId, `/${monitor.id}`);
  switch (operation) {
    case "create":
      return {
        method: "POST",
        path: monitorsPath(organizationId),
        body: { ...validConfig(), clientRequestId: crypto.randomUUID() },
      };
    case "edit":
      return {
        method: "PATCH",
        path: item,
        body: {
          ...validConfig({ name: "Renamed" }),
          expectedVersion: monitor.version,
        },
      };
    case "pause":
      return { method: "POST", path: `${item}/pause` };
    case "resume":
      return { method: "POST", path: `${item}/resume` };
    case "delete":
      return { method: "DELETE", path: item };
  }
}

const OPERATIONS: Operation[] = ["create", "edit", "pause", "resume", "delete"];
const SUCCESS: Record<Operation, number> = {
  create: 201,
  edit: 200,
  pause: 200,
  resume: 200,
  delete: 204,
};

describe("role x operation", () => {
  const table: string[] = [];

  afterAll(() => {
    console.info(`role x operation (status code)\n${table.join("\n")}\n`);
  });

  it.each(TEST_ROLES)("%s", async (role: TestRole) => {
    const allowed = role === "owner" || role === "admin";
    for (const operation of OPERATIONS) {
      // A monitor made by an owner, so every operation has a target; resume
      // needs a paused one.
      const target = await createdBy(org.users.owner);
      if (operation === "resume") {
        await ctx.call(
          org.users.owner,
          "POST",
          monitorsPath(org.id, `/${target.id}/pause`),
        );
      }
      const before = await monitorRows(org.id);
      const { method, path, body } = request(operation, org.id, target);
      const response = await ctx.call(org.users[role], method, path, body);
      const after = await monitorRows(org.id);
      const code =
        (response.json as { error?: { code: string } } | null)?.error?.code ??
        "-";
      table.push(
        `${role.padEnd(8)} ${operation.padEnd(7)} ${String(response.status)} ${code}`,
      );

      if (allowed) {
        expect(response.status, `${role} ${operation}`).toBe(
          SUCCESS[operation],
        );
      } else {
        expect(response.status, `${role} ${operation}`).toBe(403);
        expect(code).toBe("PERMISSION_DENIED");
        expect(after).toEqual(before);
      }
    }
  });

  it("answers a nonmember and a missing Organization with the same 403 body", async () => {
    const target = await createdBy(org.users.owner);
    const missingOrganization = crypto.randomUUID();
    for (const operation of OPERATIONS) {
      const nonmember = request(operation, org.id, target);
      const missing = request(operation, missingOrganization, target);
      const first = await ctx.call(
        outsider,
        nonmember.method,
        nonmember.path,
        nonmember.body,
      );
      const second = await ctx.call(
        org.users.owner,
        missing.method,
        missing.path,
        missing.body,
      );
      table.push(
        `outsider ${operation.padEnd(7)} ${String(first.status)} ${(first.json as { error: { code: string } }).error.code}`,
      );
      table.push(
        `no-org   ${operation.padEnd(7)} ${String(second.status)} ${(second.json as { error: { code: string } }).error.code}`,
      );
      expect(first.status).toBe(403);
      expect(first.json).toEqual({
        error: {
          code: "MEMBERSHIP_DENIED",
          message: "คุณไม่ใช่สมาชิกขององค์กรนี้",
        },
      });
      expect(second.status).toBe(403);
      expect(second.json).toEqual(first.json);
    }
    // The member of another Organization changed nothing in this one.
    expect(
      (await monitorRows(org.id)).some((row) => row.id === target.id),
    ).toBe(true);
  });

  it("checks permission before looking the monitor up", async () => {
    const response = await ctx.call(
      org.users.viewer,
      "PATCH",
      monitorsPath(org.id, `/${crypto.randomUUID()}`),
      { ...validConfig(), expectedVersion: 1 },
    );
    expect(response.status).toBe(403);
    expect(response.json).toMatchObject({
      error: { code: "PERMISSION_DENIED" },
    });
  });

  it("touches no row, DNS or connection for a valid body from a viewer, auditor or nonmember", async () => {
    const target = await createdBy(org.users.owner);
    const before = await monitorRows(org.id);
    const calls = ctx.resolverCalls.length;
    const hostUrl = `https://${STUB_HOSTS.public}/denied`;
    for (const user of [org.users.viewer, org.users.auditor, outsider]) {
      const created = await create(org.id, user, validConfig({ url: hostUrl }));
      const edited = await ctx.call(
        user,
        "PATCH",
        monitorsPath(org.id, `/${target.id}`),
        {
          ...validConfig({ url: hostUrl }),
          expectedVersion: target.version,
        },
      );
      expect(created.status).toBe(403);
      expect(edited.status).toBe(403);
    }
    expect(await monitorRows(org.id)).toEqual(before);
    expect(ctx.resolverCalls.length).toBe(calls);
  });

  it("gives a nonmember with an invalid body only allow-listed field and reason", async () => {
    const response = await ctx.call(outsider, "POST", monitorsPath(org.id), {
      name: "",
      url: "ftp://x",
      secrets: [{ slot: "auth.token", value: "s" }],
    });
    expect(response.status).toBe(400);
    expect(response.json).toMatchObject({
      error: { code: "MONITOR_INVALID" },
    });
    expect(JSON.stringify(response.json)).not.toContain("auth.token");
  });

  it("rejects an unknown key and a malformed secret slot with the field named", async () => {
    const send = (extra: Record<string, unknown>) =>
      ctx.call(org.users.owner, "POST", monitorsPath(org.id), {
        ...validConfig(),
        clientRequestId: crypto.randomUUID(),
        ...extra,
      });
    const unknown = await send({ mode: "basic" });
    expect(unknown.status).toBe(400);
    expect(unknown.json).toEqual({
      error: {
        code: "MONITOR_INVALID",
        message: "Invalid monitor input",
        details: { fields: [{ field: "request", reason: "invalid_format" }] },
      },
    });
    const slot = await send({ secrets: [{ slot: "auth.nope", value: "s" }] });
    expect(slot.json).toMatchObject({
      error: {
        details: {
          fields: [{ field: "secrets.0.slot", reason: "invalid_format" }],
        },
      },
    });
  });

  it("requires a session", async () => {
    const response = await create(org.id, null);
    expect(response.status).toBe(401);
  });
});

describe("uniform MONITOR_NOT_FOUND", () => {
  it.each(["edit", "pause", "resume", "delete"] as const)(
    "%s answers a missing id, a malformed id and another Organization's id alike",
    async (operation) => {
      const foreign = monitorWriteResponseSchema.parse(
        (await create(otherOrg.id, otherOrg.users.owner)).json,
      ).monitor;
      const bodies: unknown[] = [];
      for (const id of [crypto.randomUUID(), "not-a-uuid", foreign.id]) {
        const built = request(operation, org.id, { ...foreign, id });
        const response = await ctx.call(
          org.users.owner,
          built.method,
          built.path,
          built.body,
        );
        expect(response.status).toBe(404);
        bodies.push(response.json);
      }
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[2]).toEqual(bodies[0]);
      expect(bodies[0]).toEqual({
        error: { code: "MONITOR_NOT_FOUND", message: "ไม่พบมอนิเตอร์นี้" },
      });
      // The foreign monitor is untouched.
      expect(
        (await monitorRows(otherOrg.id)).some((row) => row.id === foreign.id),
      ).toBe(true);
    },
  );
});

describe("validation over HTTP", () => {
  type Case = {
    label: string;
    config: Partial<MonitorConfigInput>;
    status: number;
    fields?: { field: string; reason: string }[];
  };
  const rows = (count: number, name = (i: number) => `x-h${String(i)}`) =>
    Array.from({ length: count }, (_, index) => ({
      name: name(index),
      value: "v",
      secret: false,
    }));
  const longUrl = (length: number) => {
    const prefix = `https://${STUB_HOSTS.public}/`;
    return `${prefix}${"a".repeat(length - prefix.length)}`;
  };
  const bad = (
    label: string,
    config: Partial<MonitorConfigInput>,
    field: string,
    reason: string,
  ): Case => ({
    label,
    config,
    status: 400,
    fields: [{ field, reason }],
  });
  const ok = (label: string, config: Record<string, unknown>): Case => ({
    label,
    config,
    status: 201,
  });

  const cases: Case[] = [
    ok("URL of 2048 characters", { url: longUrl(2048) }),
    bad("URL of 2049 characters", { url: longUrl(2049) }, "url", "too_long"),
    bad(
      "URL that grows past 2048 with query params",
      {
        url: longUrl(2040),
        queryParams: [{ name: "token", value: "abcdefghij" }],
      },
      "url",
      "too_long",
    ),
    ok("port 443", { url: `https://${STUB_HOSTS.public}:443/` }),
    ok("port 1024", { url: `https://${STUB_HOSTS.public}:1024/` }),
    ok("port 65535", { url: `https://${STUB_HOSTS.public}:65535/` }),
    bad(
      "port 1023",
      { url: `https://${STUB_HOSTS.public}:1023/` },
      "url",
      "blocked_port",
    ),
    bad(
      "userinfo",
      { url: `https://u:p@${STUB_HOSTS.public}/` },
      "url",
      "embedded_credentials",
    ),
    bad(
      "ftp scheme",
      { url: `ftp://${STUB_HOSTS.public}/` },
      "url",
      "blocked_scheme",
    ),
    bad("not a URL", { url: "not a url" }, "url", "invalid_format"),
    bad("empty URL", { url: "" }, "url", "required"),
    ok("20 headers", { headers: rows(20) }),
    bad("21 headers", { headers: rows(21) }, "headers", "too_many"),
    ok("20 query params", {
      queryParams: Array.from({ length: 20 }, () => ({
        name: "q",
        value: "v",
      })),
    }),
    bad(
      "21 query params",
      {
        queryParams: Array.from({ length: 21 }, () => ({
          name: "q",
          value: "v",
        })),
      },
      "queryParams",
      "too_many",
    ),
    ok("header name of 256 characters", {
      headers: [{ name: "h".repeat(256), value: "v", secret: false }],
    }),
    bad(
      "header name of 257 characters",
      { headers: [{ name: "h".repeat(257), value: "v", secret: false }] },
      "headers.0.name",
      "too_long",
    ),
    ok("header value of 4 KiB", {
      headers: [{ name: "x-a", value: "v".repeat(4096), secret: false }],
    }),
    bad(
      "header value over 4 KiB",
      { headers: [{ name: "x-a", value: "v".repeat(4097), secret: false }] },
      "headers.0.value",
      "too_long",
    ),
    // The 4 KiB value cap is looser than the 2,048-character final URL.
    bad(
      "query value of 4 KiB (final URL too long)",
      { queryParams: [{ name: "q", value: "v".repeat(4096) }] },
      "url",
      "too_long",
    ),
    ok("body of 64 KiB", {
      method: "POST",
      body: { type: "text", content: "a".repeat(65536) },
    }),
    bad(
      "body over 64 KiB",
      { method: "POST", body: { type: "text", content: "a".repeat(65537) } },
      "body.content",
      "too_long",
    ),
    bad(
      "invalid JSON body",
      { method: "POST", body: { type: "json", content: "{oops" } },
      "body.content",
      "invalid_json",
    ),
    ok("10 assertions", {
      assertions: Array.from({ length: 10 }, () => ({
        kind: "bodyContains",
        text: "ok",
      })),
    }),
    bad(
      "11 assertions",
      {
        assertions: Array.from({ length: 11 }, () => ({
          kind: "bodyContains",
          text: "ok",
        })),
      },
      "assertions",
      "too_many",
    ),
    ok("timeout 1", { timeoutSeconds: 1 }),
    ok("timeout 30", { timeoutSeconds: 30 }),
    bad("timeout 31", { timeoutSeconds: 31 }, "timeoutSeconds", "out_of_range"),
    bad("timeout 0", { timeoutSeconds: 0 }, "timeoutSeconds", "out_of_range"),
    bad(
      "interval 120",
      { intervalSeconds: 120 },
      "intervalSeconds",
      "out_of_range",
    ),
    bad(
      "HEAD with a body assertion",
      { method: "HEAD", assertions: [{ kind: "bodyContains", text: "x" }] },
      "assertions.0.kind",
      "body_assertion_with_head",
    ),
    bad(
      "duplicate header",
      { headers: [...rows(1), ...rows(1)] },
      "headers.1.name",
      "duplicate",
    ),
    bad(
      "forbidden header",
      { headers: [{ name: "Host", value: "x", secret: false }] },
      "headers.0.name",
      "blocked_header",
    ),
    bad(
      "CR/LF in a header value",
      { headers: [{ name: "x-a", value: "a\r\nb", secret: false }] },
      "headers.0.value",
      "crlf",
    ),
    bad(
      "header that collides with bearer auth",
      {
        auth: { type: "bearer" },
        headers: [{ name: "authorization", value: "x", secret: false }],
      },
      "headers.0.name",
      "auth_header_conflict",
    ),
    bad(
      "expected status 99",
      { expectedStatus: "99" },
      "expectedStatus",
      "out_of_range",
    ),
    bad(
      "expected status reversed",
      { expectedStatus: "300-200" },
      "expectedStatus",
      "out_of_range",
    ),
    bad(
      "expected status malformed",
      { expectedStatus: "2xx" },
      "expectedStatus",
      "invalid_format",
    ),
    bad(
      "JSONPath filter",
      {
        assertions: [
          { kind: "jsonPathEquals", path: "$.a[?(@.b)]", expected: "1" },
        ],
      },
      "assertions.0.path",
      "invalid_jsonpath",
    ),
    bad(
      "response time above the timeout",
      {
        timeoutSeconds: 5,
        assertions: [{ kind: "responseTimeBelow", ms: 5001 }],
      },
      "assertions.0.ms",
      "out_of_range",
    ),
    ok("response time equal to the timeout", {
      timeoutSeconds: 5,
      assertions: [{ kind: "responseTimeBelow", ms: 5000 }],
    }),
    bad("missing name", { name: undefined }, "name", "required"),
    bad(
      "header id with NUL",
      { headers: [{ id: "a\0", name: "x-a", secret: true }] },
      "headers.0.id",
      "invalid_format",
    ),
    bad(
      "header id with a lone surrogate",
      { headers: [{ id: "\uD800", name: "x-a", secret: true }] },
      "headers.0.id",
      "invalid_format",
    ),
    bad(
      "empty header id",
      { headers: [{ id: "", name: "x-a", secret: true }] },
      "headers.0.id",
      "invalid_format",
    ),
    bad(
      "duplicate header id",
      {
        headers: [
          {
            id: "0b9d1c62-4f0e-4c55-8a1d-3f2b7c9e1a10",
            name: "x-a",
            secret: true,
          },
          {
            id: "0b9d1c62-4f0e-4c55-8a1d-3f2b7c9e1a10",
            name: "x-b",
            secret: true,
          },
        ],
      },
      "headers.1.id",
      "duplicate",
    ),
    ok("name of 100 characters", { name: "n".repeat(100) }),
    bad(
      "name of 101 characters",
      { name: "n".repeat(101) },
      "name",
      "too_long",
    ),
    bad("NUL in the name", { name: "a\0b" }, "name", "invalid_format"),
    bad(
      "NUL in the URL path",
      { url: `https://${STUB_HOSTS.public}/a\0b` },
      "url",
      "invalid_format",
    ),
    bad(
      "NUL in a text body",
      { method: "POST", body: { type: "text", content: "a\0b" } },
      "body.content",
      "invalid_format",
    ),
    bad(
      "NUL in a query value",
      { queryParams: [{ name: "q", value: "a\0" }] },
      "queryParams.0.value",
      "invalid_format",
    ),
    bad(
      "lone surrogate in a query value",
      { queryParams: [{ name: "q", value: "a\uD800" }] },
      "queryParams.0.value",
      "invalid_format",
    ),
    bad(
      "lone surrogate in a header value",
      { headers: [{ name: "x-a", value: "\uDC00", secret: false }] },
      "headers.0.value",
      "invalid_format",
    ),
    bad(
      "NUL in an assertion expected value",
      {
        assertions: [{ kind: "jsonPathEquals", path: "$.a", expected: "a\0" }],
      },
      "assertions.0.expected",
      "invalid_format",
    ),
  ];

  it.each(cases)("$label", async ({ config, status, fields }) => {
    const before = (await monitorRows(vOrg.id)).length;
    const response = await create(
      vOrg.id,
      vOrg.users.owner,
      validConfig(config),
    );
    expect(response.status).toBe(status);
    const after = (await monitorRows(vOrg.id)).length;
    if (status === 201) {
      expect(after).toBe(before + 1);
      return;
    }
    expect(after).toBe(before);
    expect(response.json).toEqual({
      error: {
        code: "MONITOR_INVALID",
        message: "Invalid monitor input",
        details: { fields },
      },
    });
  });

  it.each([
    ["malformed JSON", "application/json", "{oops", 400, "INVALID_INPUT"],
    ["an empty body", "application/json", "", 400, "INVALID_INPUT"],
    [
      "a non-JSON content type",
      "text/plain",
      "a=1",
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    ],
    ["no content type", null, "{}", 415, "UNSUPPORTED_MEDIA_TYPE"],
  ])(
    "answers %s with a client error envelope, not a 500",
    async (_label, contentType, text, status, code) => {
      const response = await ctx.call(
        vOrg.users.owner,
        "POST",
        monitorsPath(vOrg.id),
        undefined,
        { text, contentType },
      );
      expect(response.status).toBe(status);
      expect(response.json).toMatchObject({ error: { code } });
    },
  );

  it("stores a well-formed emoji name and trims the URL", async () => {
    const response = await create(
      vOrg.id,
      vOrg.users.owner,
      validConfig({
        name: "ok \u{1F600}",
        url: ` https://${STUB_HOSTS.public}/t `,
      }),
    );
    expect(response.status).toBe(201);
    const { monitor } = monitorWriteResponseSchema.parse(response.json);
    expect(monitor).toMatchObject({
      name: "ok \u{1F600}",
      url: `https://${STUB_HOSTS.public}/t`,
    });
  });

  it("never echoes input values in errors", async () => {
    const marker = "sk_live_marker_9f3a";
    const response = await create(
      vOrg.id,
      vOrg.users.owner,
      validConfig({
        url: `ftp://user:${marker}@${STUB_HOSTS.public}/?token=${marker}`,
        headers: [{ name: "Host", value: marker, secret: false }],
      }),
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.json)).not.toContain(marker);
  });
});

describe("save-time target checks (AC-09)", () => {
  async function listener() {
    let connections = 0;
    const server = net.createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as net.AddressInfo).port;
    return {
      port,
      connections: () => connections,
      close: () =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    };
  }

  it("blocks forbidden literals and resolutions with no request out and no row", async () => {
    const target = await listener();
    const port = String(target.port);
    try {
      const urls = [
        `http://127.0.0.1:${port}/`,
        "http://[::1]:8080/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.1/",
        "http://localhost:8080/",
        `http://${STUB_HOSTS.internal}/`,
        `http://${STUB_HOSTS.mixed}/`,
        // Resolves to 127.0.0.1 where the listener runs; it must see nothing.
        `http://${STUB_HOSTS.loopback}:${port}/`,
      ];
      const before = (await monitorRows(vOrg.id)).length;
      for (const url of urls) {
        const response = await create(
          vOrg.id,
          vOrg.users.owner,
          validConfig({ url }),
        );
        expect(response.status, url).toBe(422);
        expect(response.json).toEqual({
          error: {
            code: "MONITOR_TARGET_BLOCKED",
            message: "ปลายทางนี้ไม่อนุญาตให้ตรวจ",
            details: { field: "url" },
          },
        });
        expect(JSON.stringify(response.json)).not.toMatch(
          /10\.0\.0|127\.0|169\.254|::1/,
        );
      }
      expect((await monitorRows(vOrg.id)).length).toBe(before);
      expect(target.connections()).toBe(0);
    } finally {
      await target.close();
    }
  });

  it("blocks an Edit to a forbidden host and leaves the row unchanged", async () => {
    const monitor = await createdBy(vOrg.users.owner, validConfig(), vOrg);
    const before = await monitorRows(vOrg.id);
    const response = await ctx.call(
      vOrg.users.owner,
      "PATCH",
      monitorsPath(vOrg.id, `/${monitor.id}`),
      {
        ...validConfig({ url: `http://${STUB_HOSTS.internal}/` }),
        expectedVersion: monitor.version,
      },
    );
    expect(response.status).toBe(422);
    expect(await monitorRows(vOrg.id)).toEqual(before);
  });

  it("saves a host whose lookup hangs once the deadline passes", async () => {
    const started = Date.now();
    const response = await create(
      vOrg.id,
      vOrg.users.owner,
      validConfig({ url: `https://${STUB_HOSTS.hang}/` }),
    );
    expect(response.status).toBe(201);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("saves a host that does not resolve, and a test-allowed hostname", async () => {
    expect(
      (
        await create(
          vOrg.id,
          vOrg.users.owner,
          validConfig({ url: `https://${STUB_HOSTS.missing}/` }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await create(
          vOrg.id,
          vOrg.users.owner,
          validConfig({ url: `http://${STUB_HOSTS.allowed}:8080/` }),
        )
      ).status,
    ).toBe(201);
  });
});
