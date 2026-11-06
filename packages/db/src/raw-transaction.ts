import type { PoolClient } from "pg";

import type { Database } from "./client";

/** Internal transaction lifecycle; callers validate and set their own scope. */
export async function withRawTransaction<T>(
  database: Database,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await database.sql.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
