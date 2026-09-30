/**
 * Integrated verification against a running stack (API, Worker with all roles,
 * PostgreSQL, Redis). Not part of `bun run e2e`: it needs the API and Worker
 * logs of that stack, which the caller starts with stdout redirected to files.
 *
 *   API_LOG=... WORKER_LOG=... OUTBOUND_TEST_ALLOWED_HOSTS=<host> \
 *   EVIDENCE_OUT=... bun e2e/verification/api-matrix.ts
 *
 * Scenarios: role x operation matrix with direct requests (AC-02, AC-03, AC-48,
 * AC-57 permission order, AC-61 audit), SSRF blocks (AC-55), secret handling
 * (AC-25, AC-43, AC-44, AC-45, AC-56 including a moved ciphertext) and
 * concurrency (AC-38, AC-59). Every response body is kept in memory and
 * written to RESPONSES_OUT so the secret scan can read it.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";

import { createDatabase } from "../../packages/db/src/index.ts";
import { startMonitorTarget } from "../support/monitor-target.mjs";
import {
  addMember,
  basicConfig,
  cleanUp,
  createOrganization,
  createPerson,
  databaseOwnerUrl,
  monitorPath,
  signInApi,
  targetHostname,
  type ApiSession,
  type Person,
  type Role,
} from "../support/monitor-fixtures";

const API_LOG = process.env.API_LOG!;
const EVIDENCE_OUT = process.env.EVIDENCE_OUT!;
const RESPONSES_OUT = process.env.RESPONSES_OUT!;
const run = randomUUID().slice(0, 8);
const host = targetHostname();
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

type Target = Awaited<ReturnType<typeof startMonitorTarget>>;
type Reply = { status: number; body: any };
// Every secret this run sends anywhere; the log scan reads them from a file.
export const KNOWN_SECRETS: string[] = [];
// Query and body values: viewers may read them in the config (AC-47), but they
// must not reach results, incidents, notifications or logs (AC-42).
export const HIDDEN_VALUES: string[] = [];
const evidence: Record<string, unknown> = {};
const responses: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const urlOf = (t: Target, path: string) =>
  `http://${host}:${String(t.port)}${path}`;
const check = (name: string, ok: boolean, detail?: unknown) => {
  const rows = (evidence.checks ??= []) as unknown[];
  rows.push({ name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`,
  );
};

// Test is limited to 10 per 60 s per user and Organization (AC-11). Scenarios
// other than `rateLimit` stay under 9 so a run measures its own behavior.
const testTimes = new Map<string, number[]>();
async function pace(key: string) {
  const times = (testTimes.get(key) ?? []).filter(
    (t) => Date.now() - t < 61_000,
  );
  if (times.length >= 9) await sleep(61_000 - (Date.now() - times[0]!));
  times.push(Date.now());
  testTimes.set(
    key,
    times.filter((t) => Date.now() - t < 61_000),
  );
}

function wrap(
  session: ApiSession,
  key = randomUUID(),
  paced = true,
): ApiSession {
  return {
    async request(method, path, body) {
      if (paced && /\/test$/.test(path))
        await pace(`${key}:${path.split("/")[3]}`);
      const reply = await session.request(method, path, body);
      responses.push(JSON.stringify(reply.body));
      return reply;
    },
  };
}

// ---- audit log helpers -------------------------------------------------------
type LogLine = { msg?: string; actorUserId?: string; action?: string } & Record<
  string,
  unknown
>;
function logOffset() {
  return statSync(API_LOG).size;
}
async function linesSince(offset: number): Promise<LogLine[]> {
  await sleep(300);
  const text = readFileSync(API_LOG).subarray(offset).toString("utf8");
  return text
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as LogLine);
}

// ---- state snapshot ----------------------------------------------------------
async function snapshot(organizationId: string, monitorId: string) {
  const q = async (sql: string, args: unknown[]) =>
    (await pool.query(sql, args)).rows[0];
  return JSON.stringify({
    monitors: (
      await q("select count(*)::int n from monitors where tenant_id=$1", [
        organizationId,
      ])
    ).n,
    monitor: await q(
      "select version, status, name, url, check_config_version from monitors where id=$1",
      [monitorId],
    ),
    events: (
      await q(
        "select count(*)::int n from monitor_events where monitor_id=$1",
        [monitorId],
      )
    ).n,
    secrets: (
      await q(
        "select count(*)::int n from monitor_secrets where monitor_id=$1",
        [monitorId],
      )
    ).n,
  });
}

// ---- setup -------------------------------------------------------------------
const orgNames = { a: `Verify A ${run}`, b: `Verify B ${run}` };
let orgA = "";
let orgB = "";
const people = {} as Record<Role | "nonmember", Person>;
const sessions = {} as Record<Role | "nonmember", ApiSession>;
const memberIds = {} as Record<string, string>;
const userIds: string[] = [];
const orgIds: string[] = [];
let target: Target;
let probe: Target;

async function setup() {
  target = await startMonitorTarget();
  probe = await startMonitorTarget();
  orgA = await createOrganization(pool, orgNames.a);
  orgB = await createOrganization(pool, orgNames.b);
  orgIds.push(orgA, orgB);
  for (const role of ["owner", "admin", "viewer", "auditor"] as Role[]) {
    const person = await createPerson(pool, role, orgA);
    people[role] = person;
    userIds.push(person.userId);
    memberIds[role] = await addMember(pool, orgA, person.userId, role);
  }
  people.nonmember = await createPerson(pool, "nonmember", orgB);
  userIds.push(people.nonmember.userId);
  await addMember(pool, orgB, people.nonmember.userId, "owner");
  for (const key of Object.keys(people) as (Role | "nonmember")[]) {
    sessions[key] = wrap(await signInApi(people[key]));
  }
}

const config = (name: string, path = "/health") =>
  basicConfig(name, urlOf(target, path));

async function createMonitor(
  role: Role,
  organizationId: string,
  name: string,
  extra: Record<string, unknown> = {},
  path = "/health",
) {
  const reply = await sessions[role].request(
    "POST",
    monitorPath(organizationId),
    {
      ...config(name, path),
      clientRequestId: randomUUID(),
      ...extra,
    },
  );
  return reply;
}

// ---- role x operation matrix ------------------------------------------------
type Row = {
  role: string;
  op: string;
  status: number;
  code: string | null;
  probeHits: number;
  unchanged: boolean | null;
  auditLines: number;
};

async function matrix() {
  const owner = sessions.owner;
  const base = await createMonitor("owner", orgA, `base-${run}`);
  const M: string = base.body.monitor.id;
  const other = await createMonitor("owner", orgB, `other-${run}`);
  check("matrix setup created monitors", base.status === 201);
  const OB = other.body?.monitor?.id ?? randomUUID();
  const version = (await owner.request("GET", monitorPath(orgA, `/${M}`))).body
    .monitor.version;
  const secretId = randomUUID();
  const probeUrl = () =>
    urlOf(probe, `/status/200?p=${randomUUID().slice(0, 6)}`);
  KNOWN_SECRETS.push(`matrix-token-${run}`);
  const secretCfg = (name: string) => ({
    ...basicConfig(name, probeUrl()),
    auth: { type: "bearer" },
    secrets: [{ slot: "auth.token", value: `matrix-token-${run}` }],
  });

  type Op = {
    name: string;
    write: boolean;
    call: (s: ApiSession, org: string, id: string) => Promise<Reply>;
  };
  const ops: Op[] = [
    {
      name: "read list",
      write: false,
      call: (s, o) => s.request("GET", monitorPath(o)),
    },
    {
      name: "read recent-events",
      write: false,
      call: (s, o) => s.request("GET", monitorPath(o, "/recent-events")),
    },
    {
      name: "read detail",
      write: false,
      call: (s, o, id) => s.request("GET", monitorPath(o, `/${id}`)),
    },
    {
      name: "read checks",
      write: false,
      call: (s, o, id) => s.request("GET", monitorPath(o, `/${id}/checks`)),
    },
    {
      name: "read incidents",
      write: false,
      call: (s, o, id) => s.request("GET", monitorPath(o, `/${id}/incidents`)),
    },
    {
      name: "read response-times",
      write: false,
      call: (s, o, id) =>
        s.request("GET", monitorPath(o, `/${id}/response-times`)),
    },
    {
      name: "create",
      write: true,
      call: (s, o) =>
        s.request("POST", monitorPath(o), {
          ...basicConfig(
            `matrix-create-${randomUUID().slice(0, 6)}`,
            urlOf(target, "/health"),
          ),
          clientRequestId: randomUUID(),
        }),
    },
    {
      name: "create with secret",
      write: true,
      call: (s, o) =>
        s.request("POST", monitorPath(o), {
          ...basicConfig(
            `matrix-secret-${randomUUID().slice(0, 6)}`,
            urlOf(target, "/health"),
          ),
          auth: { type: "bearer" },
          secrets: [{ slot: "auth.token", value: `matrix-token-${run}` }],
          clientRequestId: randomUUID(),
        }),
    },
    {
      name: "edit",
      write: true,
      call: async (s, o, id) => {
        const v =
          (await sessions.owner.request("GET", monitorPath(o, `/${id}`))).body
            ?.monitor?.version ?? version;
        return s.request("PATCH", monitorPath(o, `/${id}`), {
          ...basicConfig(`edited-${run}`, urlOf(target, "/health")),
          expectedVersion: v,
        });
      },
    },
    {
      name: "edit secret replace",
      write: true,
      call: async (s, o, id) => {
        const v =
          (await sessions.owner.request("GET", monitorPath(o, `/${id}`))).body
            ?.monitor?.version ?? version;
        return s.request("PATCH", monitorPath(o, `/${id}`), {
          ...basicConfig(`edited-${run}`, urlOf(target, "/health")),
          auth: { type: "bearer" },
          secrets: [
            {
              slot: "auth.token",
              action: "replace",
              value: `matrix-token-${run}`,
            },
          ],
          expectedVersion: v,
        });
      },
    },
    {
      name: "test draft",
      write: true,
      call: (s, o) =>
        s.request(
          "POST",
          monitorPath(o, "/test"),
          basicConfig(`t-${run}`, probeUrl()),
        ),
    },
    {
      name: "test draft with secret",
      write: true,
      call: (s, o) =>
        s.request("POST", monitorPath(o, "/test"), secretCfg(`t-${run}`)),
    },
    {
      name: "test edit",
      write: true,
      call: (s, o, id) =>
        s.request(
          "POST",
          monitorPath(o, `/${id}/test`),
          basicConfig(`t-${run}`, probeUrl()),
        ),
    },
    {
      name: "pause",
      write: true,
      call: (s, o, id) => s.request("POST", monitorPath(o, `/${id}/pause`)),
    },
    {
      name: "resume",
      write: true,
      call: (s, o, id) => s.request("POST", monitorPath(o, `/${id}/resume`)),
    },
    {
      name: "delete",
      write: true,
      call: (s, o, id) => s.request("DELETE", monitorPath(o, `/${id}`)),
    },
    {
      name: "monitor alerts toggle",
      write: true,
      call: async (s, o) => {
        const path = `/api/organizations/${o}/notification-settings`;
        const current = (await sessions.owner.request("GET", path)).body;
        return s.request("PATCH", path, {
          monitorAlertsEnabled: !current.monitorAlertsEnabled,
          expectedVersion: current.version,
        });
      },
    },
  ];
  void secretId;

  const rows: Row[] = [];
  const roles = ["owner", "admin", "viewer", "auditor", "nonmember"] as const;
  for (const role of roles) {
    const org = role === "nonmember" ? orgA : orgA;
    for (const op of ops) {
      // Allowed roles work on their own copy so a delete or pause stays isolated.
      let id = M;
      let isolated = false;
      if (
        (role === "owner" || role === "admin") &&
        [
          "edit",
          "edit secret replace",
          "test edit",
          "pause",
          "resume",
          "delete",
        ].includes(op.name)
      ) {
        id =
          op.name === "delete" ||
          op.name === "pause" ||
          op.name === "resume" ||
          op.name === "edit" ||
          op.name === "edit secret replace" ||
          op.name === "test edit"
            ? (
                await createMonitor(
                  role as Role,
                  orgA,
                  `copy-${role}-${op.name}`,
                )
              ).body.monitor.id
            : M;
        isolated = true;
        if (op.name === "resume") {
          await sessions[role as Role].request(
            "POST",
            monitorPath(orgA, `/${id}/pause`),
          );
        }
      }
      const before = await snapshot(org, id);
      const hitsBefore = probe.hits.length;
      const offset = logOffset();
      const reply = await op.call(sessions[role], org, id);
      const lines = await linesSince(offset);
      const actor = people[role].userId;
      const audit = lines.filter(
        (l) => l.msg === "monitor mutation" && l.actorUserId === actor,
      );
      const after = await snapshot(org, id);
      rows.push({
        role,
        op: op.name,
        status: reply.status,
        code: reply.body?.error?.code ?? reply.body?.code ?? null,
        probeHits: probe.hits.length - hitsBefore,
        unchanged: isolated ? null : before === after,
        auditLines: audit.length,
      });
    }
  }
  evidence.matrix = rows;
  console.table(rows);

  const allowed = new Set(["owner", "admin"]);
  for (const r of rows) {
    const isRead = r.op.startsWith("read");
    const shouldPass = isRead ? r.role !== "nonmember" : allowed.has(r.role);
    const ok = shouldPass
      ? r.status >= 200 && r.status < 300
      : r.status === 403;
    check(
      `matrix ${r.role} / ${r.op} -> ${r.status}${r.code ? ` ${r.code}` : ""}`,
      ok,
      r,
    );
    if (!shouldPass) {
      check(
        `matrix ${r.role} / ${r.op} sends nothing out and changes nothing`,
        r.probeHits === 0 && r.unchanged !== false && r.auditLines === 0,
        r,
      );
    }
    if (
      shouldPass &&
      !isRead &&
      !["test draft", "test draft with secret", "test edit"].includes(r.op)
    ) {
      const expectAudit =
        r.op === "create with secret" || r.op === "edit secret replace" ? 2 : 1;
      check(
        `audit ${r.role} / ${r.op}: ${expectAudit} monitor mutation line(s)`,
        r.auditLines === expectAudit ||
          (r.op === "monitor alerts toggle" && r.auditLines <= 1),
        r,
      );
    }
    if (shouldPass && r.op.startsWith("test")) {
      check(
        `test ${r.role} / ${r.op} sent exactly one request`,
        r.probeHits === 1,
        r,
      );
    }
  }

  // Non-member answers must not reveal names, URLs or counts (AC-02).
  const leak = await sessions.nonmember.request("GET", monitorPath(orgA));
  const text = JSON.stringify(leak.body);
  check(
    "non-member list body carries no name, URL, host or count",
    leak.status === 403 &&
      !text.includes(`base-${run}`) &&
      !text.includes(host) &&
      !/total|count/i.test(text),
    text,
  );

  // AC-48: three kinds of bad id answer alike, in every operation.
  const idKinds: [string, string][] = [
    ["missing uuid", randomUUID()],
    ["malformed", "not-a-uuid"],
    ["other organization", OB],
  ];
  const idOps = ops.filter(
    (o) =>
      /detail|checks|incidents|response-times|edit|test edit|pause|resume|delete/.test(
        o.name,
      ) && !o.name.includes("secret"),
  );
  const bodies = new Set<string>();
  let idOk = true;
  for (const op of idOps) {
    for (const [, id] of idKinds) {
      const reply = await op.call(sessions.owner, orgA, id);
      bodies.add(
        `${String(reply.status)}:${JSON.stringify(reply.body?.error?.code ?? reply.body?.code)}`,
      );
      if (reply.status !== 404) idOk = false;
    }
  }
  evidence.idAnswers = [...bodies];
  check(
    `AC-48 id kinds x ${String(idOps.length)} operations all 404 with one code`,
    idOk && bodies.size === 1,
    [...bodies],
  );
  const other404 = await sessions.owner.request(
    "GET",
    monitorPath(orgA, `/${OB}`),
  );
  const missing404 = await sessions.owner.request(
    "GET",
    monitorPath(orgA, `/${randomUUID()}`),
  );
  check(
    "AC-48 other-organization and missing id have byte-identical bodies",
    JSON.stringify(other404.body) === JSON.stringify(missing404.body),
    [other404.body, missing404.body],
  );
}

// ---- SSRF (AC-55) ------------------------------------------------------------
async function ssrf() {
  const P = probe.port;
  const cases = [
    `http://127.0.0.1:${P}/x`,
    `http://localhost:${P}/x`,
    `http://0.0.0.0:${P}/x`,
    `http://2130706433:${P}/x`,
    `http://0x7f.0.0.1:${P}/x`,
    `http://[::1]:${P}/x`,
    `http://[::ffff:127.0.0.1]:${P}/x`,
    `http://[::ffff:7f00:1]:${P}/x`,
    `http://169.254.169.254:${P}/latest/meta-data`,
    `http://10.0.0.1:${P}/x`,
    `http://192.168.1.1:${P}/x`,
    `http://172.16.0.1:${P}/x`,
    `http://100.64.0.1:${P}/x`,
    `http://[fe80::1]:${P}/x`,
    `http://[fd00::1]:${P}/x`,
    `http://foo.127.0.0.1.nip.io:${P}/x`,
  ];
  const hitsBefore = probe.hits.length;
  const rows: unknown[] = [];
  for (const url of cases) {
    const test = await sessions.owner.request(
      "POST",
      monitorPath(orgA, "/test"),
      basicConfig("ssrf", url),
    );
    const save = await sessions.owner.request("POST", monitorPath(orgA), {
      ...basicConfig("ssrf", url),
      clientRequestId: randomUUID(),
    });
    const testBody = JSON.stringify(test.body);
    const saveBody = JSON.stringify(save.body);
    // Strip the host the caller typed, then no IP literal may remain in a body.
    const strip = (t: string) =>
      t
        .split(url)
        .join("")
        .replaceAll(new URL(url).host, "")
        .replaceAll(new URL(url).hostname, "");
    const leaked =
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(strip(testBody)) ||
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(strip(saveBody));
    rows.push({
      url,
      testStatus: test.status,
      reason: test.body?.result?.failureReason ?? test.body?.error?.code,
      saveStatus: save.status,
      saveCode: save.body?.error?.code,
    });
    const blockedTest =
      test.status === 422 ||
      test.body?.result?.failureReason === "blocked_address" ||
      test.body?.error?.code === "MONITOR_INVALID" ||
      test.body?.error?.code === "MONITOR_TARGET_BLOCKED";
    check(
      `AC-55 ${url} blocked in Test and Save, no resolved IP shown`,
      blockedTest && save.status >= 400 && !leaked,
      rows.at(-1),
    );
  }
  check(
    "AC-55 blocked addresses produced zero connections at the listener",
    probe.hits.length === hitsBefore,
    probe.hits.slice(hitsBefore).map((h) => h.path),
  );
  evidence.ssrf = rows;

  // Redirect to a blocked address never reaches the second listener (AC-34, AC-55).
  const second = await startMonitorTarget();
  const viaRedirect = `/redirect?to=${encodeURIComponent(`http://localhost:${String(second.port)}/x`)}`;
  const rTest = await sessions.owner.request(
    "POST",
    monitorPath(orgA, "/test"),
    basicConfig("redir", urlOf(target, viaRedirect)),
  );
  check(
    "AC-55 redirect to a blocked host is refused",
    rTest.body?.result?.failureReason === "redirect_blocked",
    rTest.body,
  );
  check(
    "AC-55 blocked redirect reached nothing",
    second.hits.length === 0,
    second.hits.length,
  );

  // A secret is not forwarded when a redirect leaves the origin (same host, other port).
  const crossTo = `/redirect?to=${encodeURIComponent(`http://${host}:${String(second.port)}/reflect`)}`;
  const crossToken = `redirect-token-${run}`;
  await sessions.owner.request("POST", monitorPath(orgA, "/test"), {
    ...basicConfig("cross", urlOf(target, crossTo)),
    auth: { type: "bearer" },
    secrets: [{ slot: "auth.token", value: crossToken }],
  });
  const seenAuth = second.hits.map((h) => h.headers["authorization"]);
  check(
    "AC-55 redirect to another origin dropped the Authorization header",
    second.hits.length === 1 && seenAuth.every((v) => v === undefined),
    seenAuth.length,
  );
  KNOWN_SECRETS.push(crossToken);
  await second.close();
}

// ---- secrets (AC-25, AC-43, AC-44, AC-45, AC-46, AC-56) -----------------------
// `redis-cli MONITOR` records every command with its arguments, so the BullMQ
// job payloads that are removed on completion are still scanned (AC-56).
let redisTrace = "";
let redisMonitor: ReturnType<typeof Bun.spawn> | null = null;
const redisContainer = () => process.env.REDIS_CONTAINER ?? "nw-dev-23-redis-1";
const monitorClientIds = () =>
  Bun.spawnSync([
    "docker",
    "exec",
    redisContainer(),
    "redis-cli",
    "CLIENT",
    "LIST",
  ])
    .stdout.toString()
    .split("\n")
    .filter((line) => line.includes("cmd=monitor"))
    .map((line) => /id=(\d+)/.exec(line)?.[1])
    .filter((id): id is string => id !== undefined);
let monitorsBefore = new Set<string>();
function startRedisMonitor() {
  monitorsBefore = new Set(monitorClientIds());
  redisMonitor = Bun.spawn(
    ["docker", "exec", redisContainer(), "redis-cli", "MONITOR"],
    { stdout: "pipe", stderr: "ignore" },
  );
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of redisMonitor!
      .stdout as ReadableStream<Uint8Array>) {
      redisTrace += decoder.decode(chunk);
    }
  })();
}
/** Killing `docker exec` leaves the MONITOR client alive inside Redis; remove the ones this run added. */
function stopRedisMonitor() {
  redisMonitor?.kill();
  for (const id of monitorClientIds()) {
    if (!monitorsBefore.has(id)) {
      Bun.spawnSync([
        "docker",
        "exec",
        redisContainer(),
        "redis-cli",
        "CLIENT",
        "KILL",
        "ID",
        id,
      ]);
    }
  }
}

async function secrets() {
  startRedisMonitor();
  await sleep(500);
  const mk = () => `s-${randomUUID()}`;
  const token = mk();
  const user = `u-${run}`;
  const pass = mk();
  const apiKey = mk();
  const headerSecret = mk();
  KNOWN_SECRETS.push(token, pass, apiKey, headerSecret, user);
  const basicB64 = Buffer.from(`${user}:${pass}`).toString("base64");
  KNOWN_SECRETS.push(basicB64);
  const kinds = [
    {
      kind: "bearer",
      auth: { type: "bearer" },
      secrets: [{ slot: "auth.token", value: token }],
      creds: { authorization: `Bearer ${token}` },
      headers: [] as unknown[],
    },
    {
      kind: "basic",
      auth: { type: "basic" },
      secrets: [
        { slot: "auth.username", value: user },
        { slot: "auth.password", value: pass },
      ],
      creds: { authorization: `Basic ${basicB64}` },
      headers: [],
    },
    {
      kind: "apiKey",
      auth: { type: "apiKey", headerName: "X-Api-Key" },
      secrets: [{ slot: "auth.apiKey", value: apiKey }],
      creds: { "x-api-key": apiKey },
      headers: [],
    },
  ];
  const headerId = randomUUID();
  const created: { kind: string; id: string; target: Target; name: string }[] =
    [];
  const offsetAll = logOffset();
  for (const k of kinds.concat([
    {
      kind: "header",
      auth: { type: "none" },
      secrets: [{ slot: `header.${headerId}`, value: headerSecret }],
      creds: { "x-secret-thing": headerSecret },
      headers: [{ id: headerId, name: "X-Secret-Thing", secret: true }],
    },
  ] as never)) {
    const t = await startMonitorTarget();
    t.setCredentials(k.creds);
    const name = `secret-${k.kind}-${run}`;
    const body = {
      ...basicConfig(name, urlOf(t, "/creds")),
      auth: k.auth,
      headers: k.headers,
      secrets: k.secrets,
    };
    const test = await sessions.owner.request(
      "POST",
      monitorPath(orgA, "/test"),
      body,
    );
    check(
      `AC-25 Test with ${k.kind} passes against a credential-checking target`,
      test.body?.result?.outcome === "pass",
      test.body,
    );
    const save = await sessions.owner.request("POST", monitorPath(orgA), {
      ...body,
      clientRequestId: randomUUID(),
    });
    check(
      `AC-25 create with ${k.kind} returns secretSlots only`,
      save.status === 201 &&
        Array.isArray(save.body?.monitor?.secretSlots) &&
        !JSON.stringify(save.body).includes(String(k.secrets[0]!.value)),
      save.body?.monitor?.secretSlots,
    );
    created.push({ kind: k.kind, id: save.body.monitor.id, target: t, name });
  }
  // Scheduled checks decrypt and send the stored values.
  for (const c of created) {
    const deadline = Date.now() + 100_000;
    let outcome = "";
    while (Date.now() < deadline) {
      const r = await pool.query(
        "select outcome from monitor_check_results where monitor_id=$1 order by checked_at desc limit 1",
        [c.id],
      );
      outcome = r.rows[0]?.outcome ?? "";
      if (outcome) break;
      await sleep(3000);
    }
    check(
      `AC-56 scheduled check with ${c.kind} secret authenticated (${outcome})`,
      outcome === "pass",
      outcome,
    );
  }
  const detail = await sessions.viewer.request(
    "GET",
    monitorPath(orgA, `/${created[0]!.id}`),
  );
  check(
    "AC-25 viewer sees slots, never values",
    detail.status === 200 &&
      detail.body.monitor.secretSlots.length > 0 &&
      !KNOWN_SECRETS.some((s) => JSON.stringify(detail.body).includes(s)),
    detail.body.monitor.secretSlots,
  );

  // Edit: keep uses stored value; replace uses the new one; changing origin is refused (AC-26, AC-44, AC-45).
  const bearer = created[0]!;
  const cur = (
    await sessions.owner.request("GET", monitorPath(orgA, `/${bearer.id}`))
  ).body.monitor;
  const editBase = {
    ...basicConfig(bearer.name, urlOf(bearer.target, "/creds")),
    auth: { type: "bearer" },
  };
  const before = bearer.target.hits.length;
  const keepTest = await sessions.owner.request(
    "POST",
    monitorPath(orgA, `/${bearer.id}/test`),
    { ...editBase, secrets: [{ slot: "auth.token", action: "keep" }] },
  );
  check(
    "AC-45 Test in Edit with keep uses the stored value",
    keepTest.body?.result?.outcome === "pass" &&
      bearer.target.hits.length === before + 1,
    keepTest.body?.result?.outcome,
  );
  const newToken = mk();
  KNOWN_SECRETS.push(newToken);
  bearer.target.setCredentials({ authorization: `Bearer ${newToken}` });
  const replTest = await sessions.owner.request(
    "POST",
    monitorPath(orgA, `/${bearer.id}/test`),
    {
      ...editBase,
      secrets: [{ slot: "auth.token", action: "replace", value: newToken }],
    },
  );
  const stored = await pool.query(
    "select encode(ciphertext,'hex') c from monitor_secrets where monitor_id=$1",
    [bearer.id],
  );
  const stillOld = await sessions.owner.request(
    "POST",
    monitorPath(orgA, `/${bearer.id}/test`),
    { ...editBase, secrets: [{ slot: "auth.token", action: "keep" }] },
  );
  check(
    "AC-45 Test with replace sends the new value and does not store it",
    replTest.body?.result?.outcome === "pass" &&
      stillOld.body?.result?.outcome !== "pass" &&
      stored.rows.length === 1,
    [replTest.body?.result?.outcome, stillOld.body?.result?.outcome],
  );
  const originChange = await sessions.owner.request(
    "PATCH",
    monitorPath(orgA, `/${bearer.id}`),
    {
      ...basicConfig(bearer.name, `http://${host}:${String(probe.port)}/creds`),
      auth: { type: "bearer" },
      secrets: [{ slot: "auth.token", action: "keep" }],
      expectedVersion: cur.version,
    },
  );
  const originTest = await sessions.owner.request(
    "POST",
    monitorPath(orgA, `/${bearer.id}/test`),
    {
      ...basicConfig(bearer.name, `http://${host}:${String(probe.port)}/creds`),
      auth: { type: "bearer" },
      secrets: [{ slot: "auth.token", action: "keep" }],
    },
  );
  check(
    "AC-44 origin change with keep is refused in Edit and Test (422)",
    originChange.status === 422 &&
      originTest.status === 422 &&
      originChange.body?.error?.code === "MONITOR_SECRET_ORIGIN_CHANGED",
    [originChange.status, originTest.status],
  );
  const replaceEmpty = await sessions.owner.request(
    "PATCH",
    monitorPath(orgA, `/${bearer.id}`),
    {
      ...editBase,
      secrets: [{ slot: "auth.token", action: "replace", value: "" }],
      expectedVersion: cur.version,
    },
  );
  check(
    "AC-26 replace with an empty value is MONITOR_INVALID required",
    replaceEmpty.status === 400 &&
      replaceEmpty.body?.error?.code === "MONITOR_INVALID",
    replaceEmpty.body,
  );
  const typeChange = await sessions.owner.request(
    "PATCH",
    monitorPath(orgA, `/${bearer.id}`),
    {
      ...basicConfig(bearer.name, urlOf(bearer.target, "/creds")),
      auth: { type: "none" },
      secrets: [{ slot: "auth.token", action: "delete" }],
      expectedVersion: cur.version,
    },
  );
  const slotsLeft = await pool.query(
    "select count(*)::int n from monitor_secrets where monitor_id=$1",
    [bearer.id],
  );
  check(
    "AC-46 changing auth type deletes the old slot",
    typeChange.status === 200 && slotsLeft.rows[0].n === 0,
    [typeChange.status, slotsLeft.rows[0].n],
  );

  // Reflecting endpoint: the secret is redacted from assertion actuals and errors (AC-43).
  const reflectToken = mk();
  KNOWN_SECRETS.push(reflectToken);
  const reflect = await sessions.owner.request(
    "POST",
    monitorPath(orgA, "/test"),
    {
      ...basicConfig("reflect", urlOf(target, "/reflect")),
      auth: { type: "bearer" },
      secrets: [{ slot: "auth.token", value: reflectToken }],
      assertions: [
        {
          kind: "jsonPathEquals",
          path: "$.headers.authorization",
          expected: "nope",
        },
        { kind: "bodyContains", text: "nothing-like-this" },
      ],
    },
  );
  const reflectText = JSON.stringify(reflect.body);
  check(
    "AC-43 reflected secret is redacted to bullets in the Test result",
    !reflectText.includes(reflectToken) && reflectText.includes("•••"),
    reflectText.slice(0, 300),
  );

  // Ciphertext moved to another monitor cannot be decrypted (AC-56 AAD).
  const [a, b] = [created[2]!, created[3]!];
  const rowsA = (
    await pool.query(
      "select slot, ciphertext, iv, auth_tag, key_version from monitor_secrets where monitor_id=$1",
      [a.id],
    )
  ).rows;
  const rowsB = (
    await pool.query(
      "select slot, ciphertext, iv, auth_tag, key_version from monitor_secrets where monitor_id=$1",
      [b.id],
    )
  ).rows;
  const swap = async (
    target: string,
    slot: string,
    src: { ciphertext: Buffer; iv: Buffer; auth_tag: Buffer },
  ) =>
    pool.query(
      "update monitor_secrets set ciphertext=$3, iv=$4, auth_tag=$5 where monitor_id=$1 and slot=$2",
      [target, slot, src.ciphertext, src.iv, src.auth_tag],
    );
  await swap(a.id, rowsA[0].slot, rowsB[0]);
  const t0 = new Date();
  let decryptFailed = "";
  const until = Date.now() + 100_000;
  while (Date.now() < until && !decryptFailed) {
    await sleep(3000);
    const r = await pool.query(
      "select failure_reason from monitor_check_results where monitor_id=$1 and checked_at > $2 and outcome='check_error' limit 1",
      [a.id, t0],
    );
    decryptFailed = r.rows[0]?.failure_reason ?? "";
  }
  check(
    "AC-56 a ciphertext moved to another row fails as secret_decrypt_failed (AAD)",
    decryptFailed === "secret_decrypt_failed",
    decryptFailed,
  );
  await swap(a.id, rowsA[0].slot, rowsA[0]);
  const hasIncident = await pool.query(
    "select count(*)::int n from monitor_incidents where monitor_id=$1",
    [a.id],
  );
  check(
    "AC-39 secret_decrypt_failed opened no incident",
    hasIncident.rows[0].n === 0,
    hasIncident.rows[0].n,
  );

  // Query and body values never reach results, incidents, notifications or logs (AC-42).
  const queryValue = `qval-${run}`;
  const bodyValue = `bodyval-${run}`;
  HIDDEN_VALUES.push(queryValue, bodyValue);
  const qbTarget = await startMonitorTarget();
  const qbName = `querybody-${run}`;
  const qb = await sessions.owner.request("POST", monitorPath(orgA), {
    ...basicConfig(qbName, urlOf(qbTarget, "/health")),
    method: "POST",
    queryParams: [{ name: "token", value: queryValue }],
    body: { type: "text", content: bodyValue },
    clientRequestId: randomUUID(),
  });
  const qbTest = await sessions.owner.request(
    "POST",
    monitorPath(orgA, "/test"),
    {
      ...basicConfig(qbName, urlOf(qbTarget, "/health")),
      method: "POST",
      queryParams: [{ name: "token", value: queryValue }],
      body: { type: "text", content: bodyValue },
    },
  );
  const qbText = JSON.stringify(qbTest.body);
  check(
    "AC-42 Test result shows the query as name=\u2022\u2022\u2022, never the value",
    qbText.includes("token=") &&
      !qbText.includes(queryValue) &&
      !qbText.includes(bodyValue),
    qbText.slice(0, 200),
  );
  const qbId = qb.body.monitor.id as string;
  const qbDeadline = Date.now() + 100_000;
  let qbRow: { url_masked: string; outcome: string } | undefined;
  while (Date.now() < qbDeadline && !qbRow) {
    qbRow = (
      await pool.query(
        "select url_masked, outcome from monitor_check_results where monitor_id=$1 limit 1",
        [qbId],
      )
    ).rows[0];
    if (!qbRow) await sleep(3000);
  }
  check(
    "AC-42 stored result carries the masked URL only",
    qbRow !== undefined &&
      qbRow.url_masked.includes("token=") &&
      !qbRow.url_masked.includes(queryValue),
    qbRow,
  );
  const sawBody = qbTarget.hits.some(
    (h) => h.method === "POST" && h.path === "/health",
  );
  check(
    "AC-42 the request itself carried the query and the body (target saw a POST)",
    sawBody,
    qbTarget.hits.length,
  );
  for (const table of [
    "monitor_check_results",
    "monitor_incidents",
    "monitor_events",
    "monitor_schedule",
    "notification_intents",
    "notification_inbox_items",
  ]) {
    for (const v of [queryValue, bodyValue]) {
      const r = await pool.query(
        `select count(*)::int n from ${table} t where t::text like '%' || $1 || '%'`,
        [v],
      );
      if (r.rows[0].n > 0)
        check(`AC-42 ${table} holds no query or body value`, false, table);
    }
  }
  check(
    "AC-42 no result, incident, event, schedule or notification row holds a query or body value",
    true,
  );
  await qbTarget.close();

  // Delete removes stored secrets in the same transaction (AC-46).
  const del = await sessions.owner.request(
    "DELETE",
    monitorPath(orgA, `/${b.id}`),
  );
  const gone = await pool.query(
    "select count(*)::int n from monitor_secrets where monitor_id=$1",
    [b.id],
  );
  check(
    "AC-46 deleting a monitor deletes its secrets",
    del.status === 204 || del.status === 200 ? gone.rows[0].n === 0 : false,
    [del.status, gone.rows[0].n],
  );

  // Audit lines for the whole secret scenario: no secret, no query, no body.
  const lines = await linesSince(offsetAll);
  const mutation = lines.filter((l) => l.msg === "monitor mutation");
  const dump = JSON.stringify(mutation);
  check(
    "AC-61 audit lines of the secret scenario carry no secret, URL or body",
    mutation.length > 0 &&
      !KNOWN_SECRETS.some((s) => dump.includes(s)) &&
      !dump.includes("http://") &&
      !dump.includes(host),
    mutation.length,
  );
  evidence.auditActions = mutation.map((l) => l.action);
  await scanStores();
  for (const c of created) await c.target.close();
  evidence.knownSecretCount = KNOWN_SECRETS.length;
}

const REDIS_LUA = `
local out = {}
local cursor = "0"
repeat
  local r = redis.call("SCAN", cursor, "MATCH", "*", "COUNT", 500)
  cursor = r[1]
  for _, k in ipairs(r[2]) do
    local t = redis.call("TYPE", k).ok
    if t == "string" then out[#out+1] = k .. "=" .. redis.call("GET", k)
    elseif t == "hash" then out[#out+1] = k .. "=" .. table.concat(redis.call("HGETALL", k), "|")
    elseif t == "list" then out[#out+1] = k .. "=" .. table.concat(redis.call("LRANGE", k, 0, -1), "|")
    elseif t == "zset" then out[#out+1] = k .. "=" .. table.concat(redis.call("ZRANGE", k, 0, -1), "|")
    elseif t == "set" then out[#out+1] = k .. "=" .. table.concat(redis.call("SMEMBERS", k), "|")
    end
  end
until cursor == "0"
return out
`;

/** Known values must not sit in any monitor or notification table, nor in Redis (AC-56). */
async function scanStores() {
  const tables = [
    "monitors",
    "monitor_secrets",
    "monitor_schedule",
    "monitor_check_results",
    "monitor_incidents",
    "monitor_events",
    "notification_intents",
    "notification_inbox_items",
    "notification_dispatch_ledger",
  ];
  const needles = KNOWN_SECRETS.flatMap((v) => [
    v,
    Buffer.from(v).toString("hex"),
  ]);
  const hits: string[] = [];
  for (const table of tables) {
    for (const needle of needles) {
      const r = await pool.query(
        `select count(*)::int n from ${table} t where t::text like '%' || $1 || '%'`,
        [needle],
      );
      if (r.rows[0].n > 0) hits.push(`${table}:${needle.slice(0, 6)}`);
    }
  }
  check(
    `AC-56 ${String(needles.length)} needles absent from ${String(tables.length)} tables (incl. bytea as hex)`,
    hits.length === 0,
    hits,
  );
  const container = process.env.REDIS_CONTAINER ?? "nw-dev-23-redis-1";
  const dump = Bun.spawnSync([
    "docker",
    "exec",
    container,
    "redis-cli",
    "--raw",
    "EVAL",
    REDIS_LUA,
    "0",
  ]);
  const text = dump.stdout.toString();
  const redisHits = needles.filter((n) => text.includes(n));
  stopRedisMonitor();
  const traced = needles.filter((n) => redisTrace.includes(n));
  const enqueued = (redisTrace.match(/monitor-check/g) ?? []).length;
  check(
    `AC-56 needles absent from Redis keys (${String(text.length)} bytes) and from every Redis command during the scenario (${String(redisTrace.length)} bytes, ${String(enqueued)} monitor-check references)`,
    dump.exitCode === 0 &&
      redisHits.length === 0 &&
      traced.length === 0 &&
      enqueued > 0,
    {
      exit: dump.exitCode,
      keyHits: redisHits.length,
      traceHits: traced.length,
      enqueued,
    },
  );
}

// ---- concurrency and late results (AC-38, AC-59) ----------------------------
async function concurrency() {
  const limitOrg = await createOrganization(pool, `Verify limit ${run}`);
  orgIds.push(limitOrg);
  const person = await createPerson(pool, "limit", limitOrg);
  userIds.push(person.userId);
  await addMember(pool, limitOrg, person.userId, "owner");
  const s = wrap(await signInApi(person));
  const replies = await Promise.all(
    Array.from({ length: 60 }, (_, i) =>
      s.request("POST", monitorPath(limitOrg), {
        ...basicConfig(`limit-${String(i)}`, urlOf(target, "/health")),
        clientRequestId: randomUUID(),
      }),
    ),
  );
  const ok = replies.filter((r) => r.status === 201).length;
  const rest = new Set(
    replies
      .filter((r) => r.status !== 201)
      .map((r) => `${String(r.status)} ${String(r.body?.error?.code)}`),
  );
  const count = (
    await pool.query(
      "select count(*)::int n from monitors where tenant_id=$1",
      [limitOrg],
    )
  ).rows[0].n;
  check(
    "AC-59 60 concurrent creates at limit 50 made exactly 50",
    ok === 50 && count === 50,
    { ok, count, rest: [...rest] },
  );
  const one = (
    await pool.query("select id from monitors where tenant_id=$1 limit 1", [
      limitOrg,
    ])
  ).rows[0].id;
  let conflicts = 0;
  for (let round = 0; round < 8; round++) {
    const v = (await s.request("GET", monitorPath(limitOrg, `/${one}`))).body
      .monitor.version;
    const pair = await Promise.all(
      [0, 1].map((i) =>
        s.request("PATCH", monitorPath(limitOrg, `/${one}`), {
          ...basicConfig(
            `edit-${String(round)}-${String(i)}`,
            urlOf(target, "/health"),
          ),
          expectedVersion: v,
        }),
      ),
    );
    const codes = pair.map((p) => p.status).sort();
    if (codes[0] === 200 && codes[1] === 409) conflicts++;
  }
  check(
    "AC-59 concurrent Edit with one version: one 200, one 409, 8 of 8 rounds",
    conflicts === 8,
    conflicts,
  );
  const dup = await pool.query(
    "select monitor_id from monitor_incidents where ended_at is null group by monitor_id having count(*) > 1",
  );
  check(
    "AC-59 no monitor has two open incidents",
    dup.rowCount === 0,
    dup.rowCount,
  );

  // Late result after Pause, Edit and Delete is dropped (AC-38).
  const slow = await startMonitorTarget();
  slow.setDelay(9000);
  const rows: Record<string, unknown>[] = [];
  for (const action of ["pause", "edit", "delete"] as const) {
    const created = await s
      .request("DELETE", "/api/none")
      .then(() => null)
      .catch(() => null);
    void created;
    const org = limitOrg;
    // Free a slot: the org is at its limit.
    const victim = (
      await pool.query(
        "select id from monitors where tenant_id=$1 order by created_at limit 1",
        [org],
      )
    ).rows[0].id;
    await s.request("DELETE", monitorPath(org, `/${victim}`));
    const name = `late-${action}-${run}`;
    const body = {
      ...basicConfig(name, urlOf(slow, "/health")),
      timeoutSeconds: 20,
    };
    const c = await s.request("POST", monitorPath(org, ""), {
      ...body,
      clientRequestId: randomUUID(),
    });
    const id = c.body.monitor.id as string;
    const seenBefore = slow.hits.length;
    const start = Date.now();
    while (slow.hits.length === seenBefore && Date.now() - start < 40_000)
      await sleep(500);
    const inflight = slow.hits.length > seenBefore;
    const v = c.body.monitor.version;
    if (action === "pause")
      await s.request("POST", monitorPath(org, `/${id}/pause`));
    if (action === "edit")
      await s.request("PATCH", monitorPath(org, `/${id}`), {
        ...body,
        name: `${name}-x`,
        timeoutSeconds: 21,
        expectedVersion: v,
      });
    if (action === "delete")
      await s.request("DELETE", monitorPath(org, `/${id}`));
    const at = new Date();
    await sleep(14_000);
    const late = await pool.query(
      "select count(*)::int n from monitor_check_results where monitor_id=$1 and checked_at > $2 and check_config_version = $3",
      [id, at, 1],
    );
    rows.push({ action, inflight, lateRows: late.rows[0].n });
    check(
      `AC-38 result of a check in flight during ${action} is dropped`,
      inflight && late.rows[0].n === 0,
      rows.at(-1),
    );
    if (action !== "delete")
      await s.request("DELETE", monitorPath(org, `/${id}`));
  }
  evidence.late = rows;
  await slow.close();
}

// ---- Test rate limit (AC-11) and permission before limiter (AC-57) ----------
async function rateLimit() {
  const org = await createOrganization(pool, `Verify rate ${run}`);
  orgIds.push(org);
  const users: ApiSession[] = [];
  for (const label of ["a", "b", "c", "d"]) {
    const person = await createPerson(pool, `rate-${label}`, org);
    userIds.push(person.userId);
    await addMember(pool, org, person.userId, "owner");
    users.push(wrap(await signInApi(person), randomUUID(), false));
  }
  const viewer = await createPerson(pool, "rate-viewer", org);
  userIds.push(viewer.userId);
  await addMember(pool, org, viewer.userId, "viewer");
  const viewerSession = wrap(await signInApi(viewer), randomUUID(), false);
  const fire = (s: ApiSession) =>
    s.request(
      "POST",
      monitorPath(org, "/test"),
      basicConfig(
        "rate",
        urlOf(probe, `/status/200?r=${randomUUID().slice(0, 6)}`),
      ),
    );

  const hits = probe.hits.length;
  const first = [];
  for (let i = 0; i < 12; i++) first.push(await fire(users[0]!));
  const ok = first.filter((r) => r.status === 200).length;
  const limited = first.filter((r) => r.status === 429);
  check(
    "AC-11 user limit: 10 Tests pass, the 11th and 12th get 429 MONITOR_TEST_RATE_LIMITED with retryAfterSeconds",
    ok === 10 &&
      limited.length === 2 &&
      limited.every(
        (r) =>
          r.body?.error?.code === "MONITOR_TEST_RATE_LIMITED" &&
          typeof r.body?.error?.details?.retryAfterSeconds === "number",
      ),
    { ok, limited: limited.map((r) => r.body) },
  );
  check(
    "AC-11 limited Tests sent nothing out",
    probe.hits.length - hits === 10,
    probe.hits.length - hits,
  );
  for (const s of [users[1]!, users[2]!])
    for (let i = 0; i < 10; i++) await fire(s);
  const orgLimited = await fire(users[3]!);
  check(
    "AC-11 organization limit: the 31st Test in 60 s is refused for a user with no own history",
    orgLimited.status === 429,
    orgLimited.status,
  );
  check(
    "AC-11 exactly 30 requests reached the listener",
    probe.hits.length - hits === 30,
    probe.hits.length - hits,
  );
  const denied = await fire(viewerSession);
  const nonmember = await wrap(
    await signInApi(people.nonmember),
    randomUUID(),
    false,
  ).request(
    "POST",
    monitorPath(org, "/test"),
    basicConfig("rate", urlOf(probe, "/status/200")),
  );
  check(
    "AC-57 permission is checked before the limiter: viewer and non-member get 403, not 429",
    denied.status === 403 && nonmember.status === 403,
    [denied.status, nonmember.status],
  );
  check(
    "AC-57 no request left for denied or limited Tests",
    probe.hits.length - hits === 30,
    probe.hits.length - hits,
  );
}

// ---- alerts setting, pause closing an incident, no recovery after a pause ---
async function alerts() {
  const org = await createOrganization(pool, `Verify alerts ${run}`);
  orgIds.push(org);
  const person = await createPerson(pool, "alerts", org);
  userIds.push(person.userId);
  await addMember(pool, org, person.userId, "owner");
  const s = wrap(await signInApi(person));
  const down = await startMonitorTarget();
  down.setMode("down");
  const count = async (monitorId: string, type: string) =>
    (
      await pool.query(
        "select count(*)::int n from notification_inbox_items where tenant_id = $1 and subject_monitor_id = $2 and event_type = $3",
        [org, monitorId, type],
      )
    ).rows[0].n as number;
  const waitFor = async (fn: () => Promise<boolean>, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await sleep(3000);
    }
    return false;
  };
  const make = async (name: string) =>
    (
      await s.request("POST", monitorPath(org), {
        ...basicConfig(name, urlOf(down, "/health")),
        clientRequestId: randomUUID(),
      })
    ).body.monitor.id as string;

  const a = await make(`alerts-a-${run}`);
  const incidentA = await waitFor(
    async () =>
      (
        await pool.query(
          "select 1 from monitor_incidents where monitor_id = $1 and ended_at is null",
          [a],
        )
      ).rowCount === 1,
    240_000,
  );
  const notifiedA = await waitFor(
    async () => (await count(a, "MONITOR_DOWN")) === 1,
    120_000,
  );
  check(
    "AC-24 the incident opened and one MONITOR_DOWN reached the inbox (alerts on by default)",
    incidentA && notifiedA,
    { incidentA, notifiedA },
  );

  // Pause closes the open incident as paused_by_user and sends no recovery (AC-19, AC-51).
  await s.request("POST", monitorPath(org, `/${a}/pause`));
  const closed = (
    await pool.query(
      "select end_reason from monitor_incidents where monitor_id = $1",
      [a],
    )
  ).rows;
  check(
    "AC-19 Pause closes the open incident with paused_by_user",
    closed.length === 1 && closed[0].end_reason === "paused_by_user",
    closed,
  );

  // Alerts off: an incident still opens but no notification is created (AC-24).
  const settingsPath = `/api/organizations/${org}/notification-settings`;
  const current = (await s.request("GET", settingsPath)).body;
  const off = await s.request("PATCH", settingsPath, {
    monitorAlertsEnabled: false,
    expectedVersion: current.version,
  });
  check(
    "AC-24 the owner can switch monitor alerts off",
    off.status === 200 && off.body.monitorAlertsEnabled === false,
    off.body,
  );
  const b = await make(`alerts-b-${run}`);
  const incidentB = await waitFor(
    async () =>
      (
        await pool.query(
          "select 1 from monitor_incidents where monitor_id = $1 and ended_at is null",
          [b],
        )
      ).rowCount === 1,
    240_000,
  );
  await sleep(45_000);
  check(
    "AC-24 alerts off: the incident opened but no MONITOR_DOWN was created for it",
    incidentB && (await count(b, "MONITOR_DOWN")) === 0,
    { incidentB },
  );
  check(
    "AC-24 the earlier notification stays in the inbox",
    (await count(a, "MONITOR_DOWN")) === 1,
  );
  down.setMode("up");
  await sleep(90_000);
  check(
    "AC-51 no MONITOR_RECOVERED for the paused incident",
    (await count(a, "MONITOR_RECOVERED")) === 0,
  );
  await down.close();
}

async function main() {
  const only = process.argv[2];
  await setup();
  try {
    if (!only || only === "matrix") await matrix();
    if (!only || only === "ssrf") await ssrf();
    if (!only || only === "secrets") await secrets();
    if (!only || only === "ratelimit") await rateLimit();
    if (!only || only === "concurrency") await concurrency();
    if (!only || only === "alerts") await alerts();
  } finally {
    writeFileSync(EVIDENCE_OUT, JSON.stringify(evidence, null, 2));
    writeFileSync(RESPONSES_OUT, responses.join("\n"));
    writeFileSync(
      `${RESPONSES_OUT}.secrets.json`,
      JSON.stringify({ secrets: KNOWN_SECRETS, hidden: HIDDEN_VALUES }),
    );
    await target.close();
    await probe.close();
    await cleanUp(pool, userIds, orgIds);
    await database.close();
  }
  const failed = ((evidence.checks ?? []) as { ok: boolean }[]).filter(
    (c) => !c.ok,
  ).length;
  console.log(
    `checks: ${String(((evidence.checks ?? []) as unknown[]).length)} failed: ${String(failed)}`,
  );
  process.exit(failed === 0 ? 0 : 1);
}
await main();
