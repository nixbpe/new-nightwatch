import type { Database } from "./client";

/** Deletes at most `limit` expired import previews, oldest first, and returns how many. */
export async function purgeExpiredInventoryPreviews(
  database: Database,
  input: { limit: number },
): Promise<number> {
  const result = await database.sql.query<{ purged: number }>(
    "select purge_expired_inventory_previews($1) as purged",
    [input.limit],
  );
  return result.rows[0]?.purged ?? 0;
}
