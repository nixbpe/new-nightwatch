import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { schema } from "./schema";

export const DB_POOL_MAX = 10;
export const DB_POOL_CONNECTION_TIMEOUT_MS = 5_000;
export const DB_QUERY_TIMEOUT_MS = 10_000;
export const DB_READINESS_TIMEOUT_MS = 2_000;

/** Process-wide database handle: Drizzle ORM face plus the raw pg pool. */
export type Database = {
  db: NodePgDatabase<typeof schema>;
  sql: Pool;
  close: () => Promise<void>;
};

export function createDatabase(url: string): Database {
  const pool = new Pool({
    connectionString: url,
    max: DB_POOL_MAX,
    connectionTimeoutMillis: DB_POOL_CONNECTION_TIMEOUT_MS,
    query_timeout: DB_QUERY_TIMEOUT_MS,
    statement_timeout: DB_QUERY_TIMEOUT_MS,
  });
  const db = drizzle(pool, { schema });
  return {
    db,
    sql: pool,
    close: () => pool.end(),
  };
}
