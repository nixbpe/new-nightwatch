import { beforeEach, describe, expect, it, vi } from "vitest";

const { drizzleMock, poolConstructorMock, poolEndMock } = vi.hoisted(() => ({
  drizzleMock: vi.fn(() => ({ kind: "database" })),
  poolConstructorMock: vi.fn(),
  poolEndMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: drizzleMock }));
vi.mock("pg", () => ({
  Pool: class {
    constructor(config: unknown) {
      poolConstructorMock(config);
    }

    end = poolEndMock;
  },
}));

import {
  createDatabase,
  DB_POOL_CONNECTION_TIMEOUT_MS,
  DB_POOL_MAX,
  DB_QUERY_TIMEOUT_MS,
} from "../src/client";

describe("createDatabase", () => {
  beforeEach(() => {
    drizzleMock.mockClear();
    poolConstructorMock.mockClear();
    poolEndMock.mockClear();
  });

  it("bounds pool acquisition and ordinary database statements", async () => {
    const database = createDatabase(
      "postgres://runtime:pw@localhost:5432/nightwatch",
    );

    expect(poolConstructorMock).toHaveBeenCalledWith({
      connectionString: "postgres://runtime:pw@localhost:5432/nightwatch",
      max: DB_POOL_MAX,
      connectionTimeoutMillis: DB_POOL_CONNECTION_TIMEOUT_MS,
      query_timeout: DB_QUERY_TIMEOUT_MS,
      statement_timeout: DB_QUERY_TIMEOUT_MS,
    });
    await database.close();
    expect(poolEndMock).toHaveBeenCalledOnce();
  });
});
