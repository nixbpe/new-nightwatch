import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { schema } from "./schema";

/** Process-wide database handle: Drizzle ORM face plus the raw pg pool. */
export type Database = {
  db: NodePgDatabase<typeof schema>;
  sql: Pool;
  close: () => Promise<void>;
};

export function createDatabase(url: string): Database {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  return {
    db,
    sql: pool,
    close: () => pool.end(),
  };
}
