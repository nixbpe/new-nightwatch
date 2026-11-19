import type { Database } from "@nightwatch/db";

/** `YYYYMM` of the next `count` months after the current UTC month. */
export function partitionSuffixesAhead(now: Date, count: number): string[] {
  const suffixes: string[] = [];
  for (let offset = 1; offset <= count; offset += 1) {
    const month = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
    );
    suffixes.push(
      `${String(month.getUTCFullYear())}${String(month.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  return suffixes;
}

export async function missingPartitionNames(
  database: Database,
  parents: readonly string[],
  now: Date,
  count: number,
): Promise<string[]> {
  const result = await database.sql.query<{ relname: string }>(
    `select c.relname
     from pg_inherits as i
     join pg_class as c on c.oid = i.inhrelid
     join pg_class as parent on parent.oid = i.inhparent
     where parent.relnamespace = 'public'::regnamespace
       and parent.relname = any($1::text[])`,
    [parents],
  );
  const present = new Set(result.rows.map((row) => row.relname));
  const suffixes = partitionSuffixesAhead(now, count);
  return parents.flatMap((parent) =>
    suffixes.flatMap((suffix) => {
      const name = `${parent}_p${suffix}`;
      return present.has(name) ? [] : [name];
    }),
  );
}
