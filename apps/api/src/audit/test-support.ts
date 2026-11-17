import type { Database } from "@nightwatch/db";
import { openTestPostgres, type TestPostgres } from "@nightwatch/db/testing";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

function partitionName(month: Date): string {
  const year = month.getUTCFullYear();
  const number = String(month.getUTCMonth() + 1).padStart(2, "0");
  return `audit_events_p${String(year)}${number}`;
}

/**
 * Creates the `audit_events` partition holding `at` (UTC month) with the
 * owner connection, so a test can seed events older than the months
 * `ensure_audit_event_partitions` creates. Returns the partition name and
 * whether this call created it; drop only what you created.
 *
 * Creating or dropping a partition locks the parent table. Call it only on a
 * database no other suite writes to.
 */
export async function createAuditPartitionFor(
  owner: Client,
  at: Date,
): Promise<{ name: string; created: boolean }> {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  const name = partitionName(start);
  const exists = await owner.query<{ present: boolean }>(
    "select to_regclass($1) is not null as present",
    [`public.${name}`],
  );
  if (exists.rows[0]?.present) return { name, created: false };
  await owner.query(
    `create table public.${name} partition of public.audit_events
       for values from ('${start.toISOString()}') to ('${end.toISOString()}')`,
  );
  await owner.query(`alter table public.${name} enable row level security`);
  await owner.query(`alter table public.${name} force row level security`);
  return { name, created: true };
}

/** Owns a fresh cluster because audit partition DDL locks the parent table. */
export async function openIsolatedAuditDatabase(options?: {
  history: "before-audit-log";
}): Promise<{
  database: Database;
  ownerDatabase: Database;
  owner: Client;
  urls: TestPostgres["urls"];
  advanceTo: TestPostgres["advanceTo"];
  close: () => Promise<void>;
}> {
  const fixture = await openTestPostgres(
    "api-audit",
    options?.history === "before-audit-log"
      ? "0019_monitor_event_feed.sql"
      : "latest",
  );
  let owner: Client | undefined;
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => {
      const errors: unknown[] = [];
      try {
        await owner?.end();
      } catch (error) {
        errors.push(error);
      }
      try {
        await fixture.close();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length)
        throw new AggregateError(errors, "Audit cleanup failed");
    })();
    return closing;
  }
  try {
    owner = new Client({
      connectionString: fixture.urls.ownerUrl,
      connectionTimeoutMillis: 5_000,
    });
    await owner.connect();
    return {
      database: fixture.runtime,
      ownerDatabase: fixture.owner,
      owner,
      urls: fixture.urls,
      advanceTo: (target) => fixture.advanceTo(target),
      close,
    };
  } catch (primary) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError(
        [primary, cleanup],
        "Audit setup and cleanup failed",
        {
          cause: cleanup,
        },
      );
    }
    throw primary;
  }
}

/**
 * Makes every insert into `audit_events` for one Organization fail, to prove a
 * mutation rolls back with its event. Pass the owner URL of a database
 * of its own (`openIsolatedAuditDatabase`): creating and dropping a trigger
 * takes a table lock that deadlocks with the inserts of suites that run in
 * parallel on the shared database, and the trigger stays scoped to the
 * Organization so nothing else in that database is affected. Returns the
 * function that removes the trigger.
 */
export async function blockAuditInserts(
  ownerUrl: string,
  tenantId: string,
): Promise<() => Promise<void>> {
  const name = `audit_events_block_${randomUUID().replaceAll("-", "")}`;
  const run = async (statements: string[]) => {
    const client = new Client({
      connectionString: ownerUrl,
      connectionTimeoutMillis: 5_000,
    });
    const errors: unknown[] = [];
    try {
      await client.connect();
      // One simple-query message makes function and trigger DDL atomic.
      await client.query(statements.join(";\n"));
    } catch (error) {
      errors.push(error);
    }
    try {
      await client.end();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(
        errors,
        "Audit trigger operation and cleanup failed",
      );
  };
  await run([
    `create function ${name}() returns trigger language plpgsql as $$
     begin
       if new.tenant_id = '${tenantId}'::uuid then
         raise exception 'audit insert blocked by test';
       end if;
       return new;
     end $$`,
    `create trigger ${name} before insert on audit_events
     for each row execute function ${name}()`,
  ]);
  return () =>
    run([
      `drop trigger if exists ${name} on audit_events`,
      `drop function if exists ${name}()`,
    ]);
}
