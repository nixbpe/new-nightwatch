import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  openTestPostgres,
  type MigrationTarget,
  type TestPostgres,
} from "./support/postgres";

const execute = promisify(execFile);
const canonicalDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const helperPath = fileURLToPath(
  new URL("./support/postgres.ts", import.meta.url),
);
const docker = async (args: string[]) =>
  (await execute("docker", args, { timeout: 20_000 })).stdout.trim();
const uniqueLabel = (purpose: string) =>
  `${purpose}-${randomUUID().slice(0, 8)}`;

async function containerFor(label: string) {
  const name = await docker([
    "container",
    "ls",
    "--all",
    "--format",
    "{{.Names}}",
    "--filter",
    `name=^/nightwatch-test-${label}-`,
  ]);
  expect(name.split("\n")).toHaveLength(1);
  expect(name).toMatch(new RegExp(`^nightwatch-test-${label}-[a-f0-9-]{36}$`));
  console.info(JSON.stringify({ ownedContainer: name }));
  return name;
}

async function assertAbsent(name: string) {
  expect(
    await docker([
      "container",
      "ls",
      "--all",
      "--quiet",
      "--filter",
      `name=^/${name}$`,
    ]),
  ).toBe("");
  const run = name.slice(-36);
  expect(
    (await readdir(tmpdir())).filter((entry) =>
      entry.startsWith(`nightwatch-postgres-${run}-`),
    ),
  ).toEqual([]);
  console.info(JSON.stringify({ absentContainer: name, absentPrefix: run }));
}

async function assertLedger(
  fixture: TestPostgres,
  through: MigrationTarget,
  containerName: string,
) {
  const names = (await readdir(canonicalDir))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const count =
    through === "latest" ? names.length : names.indexOf(through) + 1;
  expect(count).toBeGreaterThan(0);
  const expected = await Promise.all(
    names.slice(0, count).map(async (name) => ({
      name,
      sha256: createHash("sha256")
        .update(await readFile(join(canonicalDir, name)))
        .digest("hex"),
    })),
  );
  const { rows } = await fixture.owner.sql.query(
    "select name, sha256 from __nightwatch_migrations order by name",
  );
  expect(rows).toEqual(expected);
  const directories = (await readdir(tmpdir())).filter((entry) =>
    entry.startsWith(`nightwatch-postgres-${containerName.slice(-36)}-`),
  );
  expect(directories).toHaveLength(1);
  const directory = join(tmpdir(), String(directories.at(0)));
  const copied = await Promise.all(
    (await readdir(directory)).sort().map(async (name) => ({
      name,
      sha256: createHash("sha256")
        .update(await readFile(join(directory, name)))
        .digest("hex"),
    })),
  );
  expect(copied).toEqual(expected);
  console.info(JSON.stringify({ boundary: through, ledger: rows }));
}

async function hasColumn(fixture: TestPostgres, table: string, column: string) {
  const result = await fixture.owner.sql.query<{ present: boolean }>(
    "select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2) as present",
    [table, column],
  );
  return result.rows.at(0)?.present;
}

describe("owned PostgreSQL fixture", () => {
  it("replays full canonical SQL into independent role-separated clusters and removes only its own cluster", async () => {
    const labelA = uniqueLabel("full-a");
    const labelB = uniqueLabel("full-b");
    const started = performance.now();
    const a = await openTestPostgres(labelA);
    const readyA = performance.now();
    console.info(
      JSON.stringify({
        phase: "setup-a",
        runtime: process.versions.bun
          ? `Bun ${process.versions.bun}`
          : `Node ${process.version}`,
        milliseconds: readyA - started,
      }),
    );
    let b: TestPostgres | undefined;
    let nameA: string | undefined;
    let nameB: string | undefined;
    try {
      nameA = await containerFor(labelA);
      const startedB = performance.now();
      b = await openTestPostgres(labelB);
      console.info(
        JSON.stringify({
          phase: "setup-b",
          milliseconds: performance.now() - startedB,
        }),
      );
      nameB = await containerFor(labelB);
      expect(a.urls.runtimeUrl).not.toBe(b.urls.runtimeUrl);
      await assertLedger(a, "latest", nameA);
      await assertLedger(b, "latest", nameB);
      const { rows } = await a.runtime.sql
        .query(`select current_user, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
        (select tableowner from pg_tables where schemaname = 'public' and tablename = 'organization') as tableowner
        from pg_roles where rolname = current_user`);
      expect(rows).toEqual([
        {
          current_user: "nightwatch",
          rolsuper: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
          tableowner: "nightwatch_owner",
        },
      ]);
      expect(
        (
          await a.owner.sql.query(
            "select current_user, current_database() as database, current_setting('server_version_num') as server_version_num",
          )
        ).rows,
      ).toEqual([
        {
          current_user: "nightwatch_owner",
          database: "nightwatch",
          server_version_num: "170011",
        },
      ]);
      expect(
        (
          await a.owner.sql.query(
            "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'monitors'::regclass",
          )
        ).rows,
      ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      await expect(
        a.runtime.sql.query("create table forbidden_fixture_ddl (id int)"),
      ).rejects.toMatchObject({ code: "42501" });
      const tenantId = randomUUID();
      await a.owner.sql.query(
        "insert into organization (id, name, slug) values ($1, 'fixture sentinel', $2)",
        [tenantId, tenantId],
      );
      expect(
        (
          await a.runtime.sql.query(
            "select name from organization where id = $1",
            [tenantId],
          )
        ).rows,
      ).toEqual([{ name: "fixture sentinel" }]);
      expect(
        (
          await b.owner.sql.query(
            "select name from organization where id = $1",
            [tenantId],
          )
        ).rows,
      ).toEqual([]);
      console.info(JSON.stringify({ clusters: [nameA, nameB], roles: rows }));
      await a.close();
      await assertAbsent(nameA);
      expect((await b.runtime.sql.query("select current_user")).rows).toEqual([
        { current_user: "nightwatch" },
      ]);
    } finally {
      const outcomes = await Promise.allSettled([a.close(), b?.close()]);
      expect(
        outcomes.filter((outcome) => outcome.status === "rejected"),
      ).toEqual([]);
    }
    await assertAbsent(nameB);
  }, 180_000);

  it("exposes exact historical boundaries before later schema and preserves data across accumulated replay", async () => {
    const label = uniqueLabel("stages");
    let name: string;
    const fixture = await openTestPostgres(
      label,
      "0019_monitor_event_feed.sql",
    );
    try {
      name = await containerFor(label);
      await assertLedger(fixture, "0019_monitor_event_feed.sql", name);
      expect(
        (
          await fixture.owner.sql.query(
            "select to_regclass('public.audit_events') as table_name",
          )
        ).rows,
      ).toEqual([{ table_name: null }]);
      const id = randomUUID();
      await fixture.owner.sql.query(
        "insert into organization (id, name, slug) values ($1, 'legacy fixture', $2)",
        [id, id],
      );
      const stages: MigrationTarget[] = [
        "0020_organization_audit_log.sql",
        "0021_audit_exports.sql",
        "0022_monitor_alert_settings.sql",
        "0025_member_last_project.sql",
        "0026_project_monitors.sql",
        "0027_notification_monitor_hostname.sql",
        "0028_aws_connections.sql",
        "0029_aws_connections_v2.sql",
        "0030_project_inventory.sql",
        "0031_identifier_mappings.sql",
        "0032_vulnerability_matching.sql",
        "0033_vulnerability_monitoring.sql",
      ];
      for (const stage of stages) {
        const started = performance.now();
        const result = await fixture.advanceTo(stage);
        console.info(
          JSON.stringify({
            phase: "advance",
            stage,
            milliseconds: performance.now() - started,
          }),
        );
        expect(result.applied.at(-1)).toBe(stage);
        await assertLedger(fixture, stage, name);
        expect(
          (
            await fixture.owner.sql.query(
              "select name from organization where id = $1",
              [id],
            )
          ).rows,
        ).toEqual([{ name: "legacy fixture" }]);
        if (stage === "0020_organization_audit_log.sql") {
          expect(
            (
              await fixture.owner.sql.query(
                "select to_regclass('public.audit_events')::text as table_name, to_regclass('public.audit_exports') as later",
              )
            ).rows,
          ).toEqual([{ table_name: "audit_events", later: null }]);
        }
        if (stage === "0021_audit_exports.sql")
          expect(
            await hasColumn(fixture, "monitors", "alert_failure_threshold"),
          ).toBe(false);
        if (stage === "0022_monitor_alert_settings.sql")
          expect(
            await hasColumn(fixture, "monitors", "alert_failure_threshold"),
          ).toBe(true);
        if (stage === "0025_member_last_project.sql")
          expect(await hasColumn(fixture, "monitors", "project_id")).toBe(
            false,
          );
        if (stage === "0026_project_monitors.sql") {
          expect(await hasColumn(fixture, "monitors", "project_id")).toBe(true);
          expect(
            await hasColumn(
              fixture,
              "notification_intents",
              "subject_monitor_hostname",
            ),
          ).toBe(false);
        }
        if (stage === "0027_notification_monitor_hostname.sql") {
          expect(
            await hasColumn(
              fixture,
              "notification_intents",
              "subject_monitor_hostname",
            ),
          ).toBe(true);
          expect(
            await hasColumn(fixture, "org_aws_connections", "revision"),
          ).toBe(false);
        }
        if (stage === "0033_vulnerability_monitoring.sql") {
          expect(
            (
              await fixture.owner.sql.query(
                `select c.relname, c.relforcerowsecurity as forced
                 from pg_class c
                 where c.relname in ('vulnerability_components', 'vulnerability_schedules', 'vulnerability_seen')
                 order by c.relname`,
              )
            ).rows,
          ).toEqual([
            { relname: "vulnerability_components", forced: true },
            { relname: "vulnerability_schedules", forced: true },
            { relname: "vulnerability_seen", forced: true },
          ]);
        }
        if (stage === "0032_vulnerability_matching.sql") {
          expect(
            (
              await fixture.owner.sql.query(
                "select to_regclass('public.vulnerability_runs')::text as runs, to_regclass('public.vulnerability_matches')::text as matches",
              )
            ).rows,
          ).toEqual([
            { runs: "vulnerability_runs", matches: "vulnerability_matches" },
          ]);
        }
        if (stage === "0031_identifier_mappings.sql") {
          expect(
            (
              await fixture.owner.sql.query(
                "select to_regclass('public.inventory_mappings')::text as mappings, to_regclass('public.catalog_product_mappings')::text as catalog",
              )
            ).rows,
          ).toEqual([
            {
              mappings: "inventory_mappings",
              catalog: "catalog_product_mappings",
            },
          ]);
        }
        if (stage === "0030_project_inventory.sql") {
          expect(
            (
              await fixture.owner.sql.query(
                "select to_regclass('public.inventory_systems')::text as systems, to_regclass('public.inventory_rows')::text as rows",
              )
            ).rows,
          ).toEqual([{ systems: "inventory_systems", rows: "inventory_rows" }]);
        }
        if (stage === "0028_aws_connections.sql") {
          expect(
            await hasColumn(fixture, "org_aws_connections", "revision"),
          ).toBe(true);
          expect(
            await hasColumn(fixture, "org_aws_connections", "verified_arn"),
          ).toBe(false);
          // A saved connection and audit events written under 0028.
          await fixture.owner.sql.query(
            `insert into org_aws_connections
               (tenant_id, external_id, role_arn, account_id, last_test_at)
             values ($1, 'nw-org-legacy', 'arn:aws:iam::123456789012:role/Hub',
               '123456789012', now())`,
            [id],
          );
          await fixture.owner.sql.query(
            `insert into audit_events
               (tenant_id, actor_user_id, actor_role, category, action, target_type)
             values ($1, 'legacy-user', 'owner', 'aws_connection',
               'organization.aws_connection.update', 'aws_connection'),
               ($1, 'legacy-user', 'owner', 'project',
               'organization.project.aws_connection.delete', 'project')`,
            [id],
          );
        }
        if (stage === "0029_aws_connections_v2.sql") {
          expect(
            await hasColumn(fixture, "org_aws_connections", "verified_arn"),
          ).toBe(true);
          expect(
            (
              await fixture.owner.sql.query(
                "select action from audit_events where tenant_id = $1 order by action",
                [id],
              )
            ).rows,
          ).toEqual([
            { action: "organization.aws_connection.update" },
            { action: "organization.project.aws_connection.delete" },
          ]);
          // The saved connection is discarded by decision; RLS is rebuilt.
          expect(
            (
              await fixture.owner.sql.query(
                "select count(*)::int as n from org_aws_connections",
              )
            ).rows,
          ).toEqual([{ n: 0 }]);
          expect(
            (
              await fixture.owner.sql.query(
                `select c.relname, c.relforcerowsecurity as forced,
                   (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
                 from pg_class c
                 where c.relname in ('org_aws_connections', 'project_aws_connections')
                 order by c.relname`,
              )
            ).rows,
          ).toEqual([
            { relname: "org_aws_connections", forced: true, policies: 2 },
            { relname: "project_aws_connections", forced: true, policies: 2 },
          ]);
        }
      }
      expect((await fixture.advanceTo("latest")).applied).toEqual([]);
      await expect(
        fixture.advanceTo("0020_organization_audit_log.sql"),
      ).rejects.toThrow("backwards");
      await fixture.owner.sql.query(
        "delete from __nightwatch_migrations where name = '0022_monitor_alert_settings.sql'",
      );
      await expect(fixture.advanceTo("latest")).rejects.toThrow(
        "canonical prefix",
      );
      await expect(fixture.advanceTo("latest")).rejects.toThrow("failed");
    } finally {
      await fixture.close();
    }
    await assertAbsent(name);
  }, 180_000);

  it("bounds a real blocked canonical migration, preserves its error and closes the failed fixture", async () => {
    const label = uniqueLabel("blocked");
    let name: string;
    const fixture = await openTestPostgres(
      label,
      "0019_monitor_event_feed.sql",
    );
    try {
      name = await containerFor(label);
      let replay: Promise<unknown> | undefined;
      const holder = await fixture.owner.sql.connect();
      try {
        await holder.query("begin");
        await holder.query("lock table organization in access exclusive mode");
        const { rows: holders } = await holder.query<{ pid: number }>(
          "select pg_backend_pid() as pid",
        );
        const holderPid = holders.at(0)?.pid;
        const started = performance.now();
        replay = fixture.advanceTo("0020_organization_audit_log.sql").then(
          () => "unexpected success",
          (error: unknown) => error,
        );
        let blocked: { application_name: string; wait_event_type: string }[] =
          [];
        const deadline = Date.now() + 5_000;
        do {
          const result = await fixture.owner.sql.query<{
            application_name: string;
            wait_event_type: string;
          }>(
            "select application_name, wait_event_type from pg_stat_activity where application_name = $1 and $2::int = any(pg_blocking_pids(pid))",
            [`fixture-${name.slice(-36)}`, holderPid],
          );
          blocked = result.rows;
          if (blocked.length) break;
          await delay(25);
        } while (Date.now() < deadline);
        expect(blocked).toEqual([
          {
            application_name: `fixture-${name.slice(-36)}`,
            wait_event_type: "Lock",
          },
        ]);
        await expect(replay).resolves.toMatchObject({ code: "55P03" });
        console.info(
          JSON.stringify({
            phase: "blocked-migration",
            name,
            blocker: holderPid,
            observed: blocked,
            milliseconds: performance.now() - started,
            code: "55P03",
          }),
        );
        await holder.query("rollback");
        const ledger = await fixture.owner.sql.query(
          "select name from __nightwatch_migrations order by name desc limit 1",
        );
        expect(ledger.rows).toEqual([{ name: "0019_monitor_event_feed.sql" }]);
        expect(
          (
            await fixture.owner.sql.query(
              "select to_regclass('public.audit_events') as table_name",
            )
          ).rows,
        ).toEqual([{ table_name: null }]);
        await expect(fixture.advanceTo("latest")).rejects.toThrow("failed");
      } finally {
        try {
          await holder.query("rollback");
        } finally {
          holder.release();
          await replay;
        }
      }
    } finally {
      await fixture.close();
    }
    await assertAbsent(name);
  }, 180_000);

  it.each(["start", "cleanup"])(
    "reports real %s failure and verifies exact-owned cleanup",
    async (fault) => {
      const directory = await mkdtemp(
        join(tmpdir(), "nightwatch-fixture-fault-"),
      );
      const nameFile = join(directory, "container-name");
      const realDocker = (await execute("which", ["docker"])).stdout.trim();
      const label = uniqueLabel(`fault-${fault}`);
      let name: string | undefined;
      try {
        await writeFile(
          join(directory, "docker"),
          `#!/bin/sh
set -eu
if [ "$1" = create ]; then
  previous=''
  for argument in "$@"; do
    if [ "$previous" = --name ]; then printf '%s' "$argument" > "$FIXTURE_NAME_FILE"; fi
    previous="$argument"
  done
fi
if [ "$FIXTURE_FAULT" = start ] && [ "$1" = start ]; then "$FIXTURE_REAL_DOCKER" "$@" >/dev/null; exit 73; fi
if [ "$FIXTURE_FAULT" = cleanup ] && [ "$1" = rm ]; then exit 74; fi
exec "$FIXTURE_REAL_DOCKER" "$@"
`,
          { mode: 0o700 },
        );
        const probe = join(directory, "probe.ts");
        await writeFile(
          probe,
          `import { openTestPostgres } from ${JSON.stringify(helperPath)};
try {
  const fixture = await openTestPostgres(${JSON.stringify(label)}, "0001_auth_foundation.sql");
  const closing = fixture.close();
  if (fixture.close() !== closing) throw new Error("close outcome not memoized");
  await closing;
  throw new Error("fault was not detected");
} catch (error) {
  console.log(JSON.stringify({ message: error.message, errors: error instanceof AggregateError ? error.errors.map((item) => item.message) : [] }));
}
`,
        );
        const { stdout } = await execute("bun", [probe], {
          timeout: 150_000,
          env: {
            ...process.env,
            PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
            FIXTURE_REAL_DOCKER: realDocker,
            FIXTURE_NAME_FILE: nameFile,
            FIXTURE_FAULT: fault,
          },
        });
        name = await readFile(nameFile, "utf8");
        const result = JSON.parse(stdout) as {
          message: string;
          errors: string[];
        };
        if (fault === "start") {
          expect(result.message).toBe("docker start failed");
          await assertAbsent(name);
        } else {
          expect(result.message).toContain("PostgreSQL fixture cleanup failed");
          expect(result.errors).toEqual([`Unresolved owned container ${name}`]);
          expect(
            await docker([
              "inspect",
              "--format",
              '{{index .Config.Labels "nightwatch.test-postgres"}}',
              name,
            ]),
          ).toBe(name.slice(-36));
          expect(
            await docker(["inspect", "--format", "{{.State.Running}}", name]),
          ).toBe("true");
        }
        console.info(JSON.stringify({ fault, name, result }));
      } finally {
        name ??= await readFile(nameFile, "utf8").catch(() => undefined);
        if (name) {
          const exists = await docker([
            "container",
            "ls",
            "--all",
            "--quiet",
            "--filter",
            `name=^/${name}$`,
          ]);
          if (exists) {
            expect(
              await docker([
                "inspect",
                "--format",
                '{{index .Config.Labels "nightwatch.test-postgres"}}',
                name,
              ]),
            ).toBe(name.slice(-36));
            await docker(["rm", "--force", "--volumes", name]);
          }
          await assertAbsent(name);
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
