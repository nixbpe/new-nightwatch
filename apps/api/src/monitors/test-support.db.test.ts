import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import {
  openMonitorTestContext,
  type MonitorTestContext,
} from "./test-support";

let ctx: MonitorTestContext;

beforeAll(async () => {
  ctx = await openMonitorTestContext();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await ctx.close();
});

it("creates distinct fixture emails when UUIDs share their first four characters", async () => {
  const firstId = crypto.randomUUID();
  const secondId =
    `${firstId.slice(0, 4)}${crypto.randomUUID().slice(4)}` as ReturnType<
      typeof crypto.randomUUID
    >;
  vi.spyOn(crypto, "randomUUID")
    .mockReturnValueOnce(firstId)
    .mockReturnValueOnce(secondId);

  const first = await ctx.createUser("fixture-prefix");
  const second = await ctx.createUser("fixture-prefix");
  const { rows } = await ctx.owner.sql.query<{ id: string; email: string }>(
    'select id, email from "user" where id = any($1::text[]) order by id',
    [[first, second]],
  );

  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((row) => row.email)).size).toBe(2);
  for (const row of rows) {
    expect(row.email).toBe(`fixture-prefix-${ctx.run}-${row.id}@example.test`);
  }
});

it("creates distinct fixture slugs when UUIDs share their first four characters", async () => {
  const firstId = crypto.randomUUID();
  const secondId =
    `${firstId.slice(0, 4)}${crypto.randomUUID().slice(4)}` as ReturnType<
      typeof crypto.randomUUID
    >;
  const randomUUID = vi.spyOn(crypto, "randomUUID");
  randomUUID.mockReturnValueOnce(firstId);
  const first = await ctx.createOrganization("fixture-prefix");
  randomUUID.mockReturnValueOnce(secondId);
  const second = await ctx.createOrganization("fixture-prefix");
  const { rows } = await ctx.owner.sql.query<{ id: string; slug: string }>(
    "select id, slug from organization where id = any($1::uuid[]) order by id",
    [[first.id, second.id]],
  );

  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((row) => row.slug)).size).toBe(2);
  for (const row of rows) {
    expect(row.slug).toBe(`fixture-prefix-${ctx.run}-${row.id}`);
  }
});
