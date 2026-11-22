import type { Database } from "@nightwatch/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INVENTORY_MAINTENANCE_INTERVAL_MS,
  INVENTORY_PREVIEW_PURGE_LIMIT,
  runInventoryMaintenance,
  startInventoryMaintenance,
} from "./maintenance";

function setup(...batches: number[]) {
  const purge = vi.fn(() => Promise.resolve(batches.shift() ?? 0));
  const query = vi.fn(async (text: string, values: unknown[]) => {
    if (text !== "select purge_expired_inventory_previews($1) as purged") {
      throw new Error(`unexpected query: ${text}`);
    }
    expect(values).toEqual([INVENTORY_PREVIEW_PURGE_LIMIT]);
    return { rows: [{ purged: await purge() }] };
  });
  const database = { sql: { query } } as unknown as Database;
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  return { database, logger, purge };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runInventoryMaintenance", () => {
  it("purges full batches until one comes back short and reports the total", async () => {
    const f = setup(INVENTORY_PREVIEW_PURGE_LIMIT, 3);
    expect(await runInventoryMaintenance(f.database, f.logger as never)).toBe(
      INVENTORY_PREVIEW_PURGE_LIMIT + 3,
    );
    expect(f.purge).toHaveBeenCalledTimes(2);
  });

  it("logs a failure without the database's message and stays alive", async () => {
    const f = setup();
    f.purge.mockRejectedValueOnce(new Error("secret connection string"));
    expect(await runInventoryMaintenance(f.database, f.logger as never)).toBe(
      0,
    );
    expect(f.logger.error).toHaveBeenCalledExactlyOnceWith(
      {},
      "inventory preview purge failed",
    );
  });

  it("leaves the rest of a very large backlog to the next run", async () => {
    const f = setup();
    f.purge.mockResolvedValue(INVENTORY_PREVIEW_PURGE_LIMIT);
    await runInventoryMaintenance(f.database, f.logger as never);
    expect(f.purge).toHaveBeenCalledTimes(100);
    expect(f.logger.warn).toHaveBeenCalledOnce();
  });
});

describe("startInventoryMaintenance", () => {
  it("runs at start and every minute, and stops future runs when disposed", async () => {
    vi.useFakeTimers();
    const f = setup();
    const stop = startInventoryMaintenance(f.database, f.logger as never);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(f.purge).toHaveBeenCalledTimes(1);
      expect(f.logger.info).toHaveBeenCalledExactlyOnceWith(
        {},
        "inventory maintenance ready",
      );
      await vi.advanceTimersByTimeAsync(INVENTORY_MAINTENANCE_INTERVAL_MS - 1);
      expect(f.purge).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(f.purge).toHaveBeenCalledTimes(2);
      stop();
      await vi.advanceTimersByTimeAsync(INVENTORY_MAINTENANCE_INTERVAL_MS * 3);
      expect(f.purge).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });
});
