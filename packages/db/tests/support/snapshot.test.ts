import assert from "node:assert/strict";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  listMigrations: vi.fn(),
}));
vi.mock("../../src/client", () => ({ createDatabase: mocks.createDatabase }));
vi.mock("../../src/migrator", () => ({ listMigrations: mocks.listMigrations }));
import { prepareTestDatabase } from "./snapshot";

const ledger = [
  { name: "0001_test.sql", sha256: "digest", applied_at: new Date(0) },
];
const query = vi.fn((sql: string) =>
  Promise.resolve({
    rows: sql.includes("pg_export_snapshot")
      ? [{ snapshot: "snapshot-id" }]
      : ledger,
  }),
);
const release = vi.fn();
const owner = {
  sql: {
    connect: vi.fn(() => Promise.resolve({ query, release })),
    query: vi.fn(),
  },
  close: vi.fn(),
};
const target = { sql: { query: vi.fn() }, close: vi.fn() };
const command = vi.fn(() => Promise.resolve("schema SQL"));
const options = {
  ownerUrl: "postgres://nightwatch_owner@localhost/nightwatch",
  name: `nw_plan_${"a".repeat(32)}`,
  migrationsDir: "/migrations",
  command,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createDatabase.mockReturnValueOnce(owner).mockReturnValueOnce(target);
  mocks.listMigrations.mockResolvedValue(ledger);
});
it("copies only schema and the exact ledger while retaining the exported snapshot", async () => {
  await prepareTestDatabase(options);
  expect(command.mock.calls[0]).toEqual([
    [
      "pg_dump",
      "-U",
      "nightwatch_owner",
      "-d",
      "nightwatch",
      "--schema-only",
      "--snapshot=snapshot-id",
    ],
  ]);
  expect(command.mock.calls[1]).toEqual([
    [
      "psql",
      "-U",
      "nightwatch_owner",
      "-d",
      options.name,
      "-v",
      "ON_ERROR_STOP=1",
    ],
    "schema SQL",
  ]);
  expect(target.sql.query).toHaveBeenCalledWith(
    expect.stringContaining("insert into __nightwatch_migrations"),
    ["0001_test.sql", "digest", new Date(0)],
  );
  const insertOrder = target.sql.query.mock.invocationCallOrder[0];
  assert(insertOrder !== undefined);
  expect(query.mock.invocationCallOrder.at(-1)).toBeGreaterThan(insertOrder);
  expect(query).toHaveBeenLastCalledWith("rollback");
  expect(release).toHaveBeenCalledOnce();
  expect(owner.close).toHaveBeenCalledOnce();
  expect(target.close).toHaveBeenCalledOnce();
});
it("rejects ledger drift before creating a database", async () => {
  mocks.listMigrations.mockResolvedValue([
    { name: "0001_test.sql", sha256: "changed" },
  ]);
  await expect(prepareTestDatabase(options)).rejects.toThrow(
    "match repository migrations",
  );
  expect(owner.sql.query).not.toHaveBeenCalled();
  expect(command).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
  expect(owner.close).toHaveBeenCalledOnce();
});
it("drains pools and snapshot after restore failure without dropping another caller's objects", async () => {
  command
    .mockResolvedValueOnce("schema SQL")
    .mockRejectedValueOnce(new Error("restore failed"));
  await expect(prepareTestDatabase(options)).rejects.toThrow("restore failed");
  expect(query).toHaveBeenLastCalledWith("rollback");
  expect(release).toHaveBeenCalledOnce();
  expect(target.close).toHaveBeenCalledOnce();
  expect(owner.close).toHaveBeenCalledOnce();
});
it("closes both pools if source connection fails", async () => {
  owner.sql.connect.mockRejectedValueOnce(new Error("connect failed"));
  await expect(prepareTestDatabase(options)).rejects.toThrow("connect failed");
  expect(target.close).toHaveBeenCalledOnce();
  expect(owner.close).toHaveBeenCalledOnce();
});
it("rejects an unowned name before opening pools", async () => {
  await expect(
    prepareTestDatabase({ ...options, name: "nightwatch" }),
  ).rejects.toThrow("Invalid disposable");
  expect(mocks.createDatabase).not.toHaveBeenCalled();
});
