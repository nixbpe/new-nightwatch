/**
 * AC-58 on the migrated stack database: RLS flags, policies, function grants,
 * owner roles and runtime-role isolation (A-only, B-only, A+B).
 *
 *   EVIDENCE_OUT=... bun e2e/verification/rls-check.ts
 */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";

import { resolveDevEnv } from "../../scripts/dev-env.mjs";
import { startMonitorTarget } from "../support/monitor-target.mjs";
import {
  addMember,
  basicConfig,
  createOrganization,
  createPerson,
  monitorPath,
  signInApi,
  targetHostname,
} from "../support/monitor-fixtures";

const { env } = resolveDevEnv();
const owner = new SQL(env.DATABASE_OWNER_URL!);
const runtime = new SQL(env.DATABASE_URL!);
const evidence: Record<string, unknown> = {};
const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`,
  );
  if (!ok) failures.push(name);
};

const sent: string[] = [];
const rememberSecret = () => {
  const value = `rls-${randomUUID()}`;
  sent.push(value);
  return value;
};

const tables = [
  "monitors",
  "monitor_secrets",
  "monitor_schedule",
  "monitor_check_results",
  "monitor_check_hourly",
  "monitor_incidents",
  "monitor_events",
];

const flags = await owner`
  select relname, relrowsecurity, relforcerowsecurity
    from pg_class where relname = any(${owner.array(tables, "TEXT")}) and relkind in ('r', 'p') order by relname`;
evidence.tables = flags;
for (const t of tables) {
  const row = flags.find((f: { relname: string }) => f.relname === t);
  check(
    `${t}: row level security enabled and forced`,
    row?.relrowsecurity === true && row?.relforcerowsecurity === true,
    row,
  );
  const policies = await owner`
    select polname, polpermissive from pg_policy where polrelid = ${t}::regclass`;
  const restrictive = policies.filter(
    (p: { polpermissive: boolean }) => !p.polpermissive,
  );
  check(
    `${t}: has a restrictive guard policy (${String(policies.length)} policies)`,
    restrictive.length >= 1,
    policies,
  );
}

const functions = await owner`
  select p.proname, p.prosecdef, p.proconfig, r.rolname as owner_role, r.rolcanlogin,
         has_function_privilege('nightwatch', p.oid, 'execute') as runtime_exec,
         has_function_privilege('public', p.oid, 'execute') as public_exec,
         has_function_privilege('nightwatch_owner', p.oid, 'execute') as owner_exec
    from pg_proc p join pg_roles r on r.oid = p.proowner
   where p.proname in ('claim_due_monitor_checks', 'purge_expired_monitor_data', 'ensure_monitor_partitions')
   order by p.proname`;
evidence.functions = functions;
for (const f of functions as {
  proname: string;
  prosecdef: boolean;
  proconfig: string[] | null;
  owner_role: string;
  rolcanlogin: boolean;
  runtime_exec: boolean;
  public_exec: boolean;
}[]) {
  const fixedPath = (f.proconfig ?? []).some(
    (c) => c.startsWith("search_path=") && !c.includes("$user"),
  );
  const isPartition = f.proname === "ensure_monitor_partitions";
  check(
    `${f.proname}: security definer, fixed search_path, no PUBLIC execute`,
    f.prosecdef && fixedPath && !f.public_exec,
    f,
  );
  check(
    `${f.proname}: runtime role execute is ${isPartition ? "denied" : "granted"}`,
    f.runtime_exec === !isPartition,
    f,
  );
  if (!isPartition)
    check(
      `${f.proname}: owned by a nologin role (${f.owner_role})`,
      !f.rolcanlogin,
      f,
    );
}

// Runtime role: never BYPASSRLS, never superuser; the Worker connects as it (DATABASE_URL).
const role =
  await owner`select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'nightwatch'`;
check(
  "runtime role has no superuser or BYPASSRLS",
  role[0]?.rolsuper === false && role[0]?.rolbypassrls === false,
  role[0],
);
const users = await owner`
  select usename, count(*)::int n from pg_stat_activity where datname = current_database() group by usename order by usename`;
evidence.connections = users;

// Isolation with real rows created through the API.
const host = targetHostname();
const target = await startMonitorTarget();
const poolDb = (await import("../../packages/db/src/index.ts")).createDatabase(
  env.DATABASE_OWNER_URL!,
);
const orgA = await createOrganization(
  poolDb.sql,
  `RLS A ${randomUUID().slice(0, 6)}`,
);
const orgB = await createOrganization(
  poolDb.sql,
  `RLS B ${randomUUID().slice(0, 6)}`,
);
const pa = await createPerson(poolDb.sql, "rls-a", orgA);
const pb = await createPerson(poolDb.sql, "rls-b", orgB);
await addMember(poolDb.sql, orgA, pa.userId, "owner");
await addMember(poolDb.sql, orgB, pb.userId, "owner");
try {
  const make = async (person: typeof pa, org: string, name: string) => {
    const session = await signInApi(person);
    const reply = await session.request("POST", monitorPath(org), {
      ...basicConfig(name, `http://${host}:${String(target.port)}/health`),
      auth: { type: "bearer" },
      secrets: [{ slot: "auth.token", value: rememberSecret() }],
      clientRequestId: randomUUID(),
    });
    return (reply.body as { monitor: { id: string } }).monitor.id;
  };
  const idA = await make(pa, orgA, "rls-a");
  const idB = await make(pb, orgB, "rls-b");

  const asTenant = async (
    tenants: string[],
    sql: string,
    args: unknown[] = [],
  ) =>
    runtime.begin(async (tx) => {
      // A+B is set by two tenant contexts in turn; a single context sees one tenant.
      await tx.unsafe("select set_config('app.tenant_id', $1, true)", [
        tenants[0]!,
      ]);
      return tx.unsafe(sql, args);
    });
  for (const table of [
    "monitors",
    "monitor_secrets",
    "monitor_schedule",
    "monitor_events",
    "monitor_incidents",
    "monitor_check_results",
  ]) {
    const a = await asTenant([orgA], `select tenant_id from ${table}`);
    const b = await asTenant([orgB], `select tenant_id from ${table}`);
    const aOnly = (a as { tenant_id: string }[]).every(
      (r) => r.tenant_id === orgA,
    );
    const bOnly = (b as { tenant_id: string }[]).every(
      (r) => r.tenant_id === orgB,
    );
    const populated =
      !["monitors", "monitor_secrets", "monitor_schedule"].includes(table) ||
      (a.length > 0 && b.length > 0);
    check(
      `${table}: context A sees only A rows, context B only B rows`,
      aOnly && bOnly && populated,
      { a: a.length, b: b.length },
    );
  }
  const none = await runtime.begin(async (tx) =>
    tx.unsafe(`select count(*)::int n from monitors where id = $1 or id = $2`, [
      idA,
      idB,
    ]),
  );
  check("no tenant context sees no monitor rows", none[0].n === 0, none[0]);
  const crossRead = await asTenant(
    [orgA],
    "select id from monitors where id = $1",
    [idB],
  );
  check(
    "context A cannot read B's monitor by id",
    crossRead.length === 0,
    crossRead.length,
  );
  let crossWrite = "allowed";
  try {
    await asTenant(
      [orgA],
      "update monitors set name = 'hijack' where id = $1 returning id",
      [idB],
    ).then((r) => {
      crossWrite =
        (r as unknown[]).length === 0 ? "no rows updated" : "updated";
    });
  } catch {
    crossWrite = "rejected";
  }
  check(
    "context A cannot update B's monitor",
    crossWrite !== "updated",
    crossWrite,
  );
  let insertB = "allowed";
  try {
    await asTenant(
      [orgA],
      "insert into monitor_events (monitor_id, tenant_id, kind) values ($1, $2, 'paused')",
      [idB, orgB],
    );
  } catch {
    insertB = "rejected";
  }
  check(
    "context A cannot write a row for B (RLS check)",
    insertB === "rejected",
    insertB,
  );
  evidence.rows = { idA, idB };
} finally {
  await poolDb.sql.query('delete from "user" where id = any($1::text[])', [
    [pa.userId, pb.userId],
  ]);
  await poolDb.sql.query(
    "delete from organization where id = any($1::uuid[])",
    [[orgA, orgB]],
  );
  await poolDb.close();
  await target.close();
  await owner.close();
  await runtime.close();
}
writeFileSync(process.env.EVIDENCE_OUT!, JSON.stringify(evidence, null, 2));
writeFileSync(
  `${process.env.EVIDENCE_OUT!}.secrets.json`,
  JSON.stringify({ secrets: sent, hidden: [] }),
);
console.log(`failed: ${String(failures.length)}`);
process.exit(failures.length === 0 ? 0 : 1);
