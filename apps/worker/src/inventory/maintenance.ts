import { purgeExpiredInventoryPreviews, type Database } from "@nightwatch/db";
import type { Logger } from "@nightwatch/shared";

/** A preview lives 30 minutes (Q-19); a minute's lag past that is the longest one is kept. */
export const INVENTORY_MAINTENANCE_INTERVAL_MS = 60_000;
export const INVENTORY_PREVIEW_PURGE_LIMIT = 1000;
export const INVENTORY_PURGE_MAX_BATCHES_PER_RUN = 100;

/**
 * Deletes expired import previews, so the rows of a customer's file do not stay when nobody
 * opens the page (R-07). The deletion is by the database's clock and is idempotent. Returns how
 * many it deleted.
 */
export async function runInventoryMaintenance(
  database: Database,
  logger: Logger,
): Promise<number> {
  let total = 0;
  try {
    for (
      let batch = 1;
      batch <= INVENTORY_PURGE_MAX_BATCHES_PER_RUN;
      batch += 1
    ) {
      const purged = await purgeExpiredInventoryPreviews(database, {
        limit: INVENTORY_PREVIEW_PURGE_LIMIT,
      });
      total += purged;
      if (purged < INVENTORY_PREVIEW_PURGE_LIMIT) return total;
    }
    logger.warn(
      { batches: INVENTORY_PURGE_MAX_BATCHES_PER_RUN },
      "inventory preview purge stopped at the batch guard; the rest is left for the next run",
    );
  } catch {
    logger.error({}, "inventory preview purge failed");
  }
  return total;
}

export function startInventoryMaintenance(
  database: Database,
  logger: Logger,
): () => void {
  const run = () => {
    void runInventoryMaintenance(database, logger);
  };
  run();
  const timer = setInterval(run, INVENTORY_MAINTENANCE_INTERVAL_MS);
  logger.info({}, "inventory maintenance ready");
  return () => {
    clearInterval(timer);
  };
}
