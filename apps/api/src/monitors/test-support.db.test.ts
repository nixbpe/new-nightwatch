import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import {
  defaultProjectId,
  openMonitorTestContext,
  type MonitorTestContext,
} from "./test-support";

let ctx: MonitorTestContext;

beforeAll(async () => {
  ctx = await openMonitorTestContext({ defaultProject: true });
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

it("attempts every owned delete and closes both pools while retaining cleanup failures", async () => {
  const failing = await openMonitorTestContext({ defaultProject: true });
  let organization:
    Awaited<ReturnType<typeof failing.createOrganization>> | undefined;
  let closing: Promise<void> | undefined;
  const errors: unknown[] = [];
  try {
    organization = await failing.createOrganization("cleanup-failure");
    const survivor = await ctx.createOrganization("cleanup-survivor");
    const deletionError = new Error("owned organization delete rejected");
    const userError = new Error("owned user delete rejected");
    const ownerCloseError = new Error(
      "owner pool close rejected after release",
    );
    const querySpy = vi
      .spyOn(failing.owner.sql, "query")
      .mockRejectedValueOnce(deletionError)
      .mockRejectedValueOnce(userError);
    const closeOwner = failing.owner.close;
    vi.spyOn(failing.owner, "close").mockImplementation(async () => {
      await closeOwner();
      throw ownerCloseError;
    });
    closing = failing.close();
    expect(failing.close()).toBe(closing);
    const error: unknown = await closing.catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      deletionError,
      userError,
      ownerCloseError,
    ]);
    expect(querySpy.mock.calls).toEqual([
      [
        "delete from organization where id = any($1::uuid[])",
        [[organization.id]],
      ],
      [
        'delete from "user" where id = any($1::text[])',
        [Object.values(organization.users)],
      ],
    ]);
    await expect(failing.owner.sql.query("select 1")).rejects.toThrow(
      "Cannot use a pool after calling end",
    );
    await expect(failing.runtime.sql.query("select 1")).rejects.toThrow(
      "Cannot use a pool after calling end",
    );
    const organizationId = organization.id;
    expect(() => defaultProjectId(organizationId)).toThrow(
      "no fixture Project",
    );
    expect(defaultProjectId(survivor.id)).toBe(survivor.projectId);
    expect(
      (
        await ctx.owner.sql.query("select id from organization where id = $1", [
          survivor.id,
        ])
      ).rows,
    ).toEqual([{ id: survivor.id }]);
  } catch (error) {
    errors.push(error);
  } finally {
    vi.restoreAllMocks();
    const cleanups: (() => unknown)[] = [
      () => (closing ? undefined : failing.close()),
      () =>
        organization
          ? ctx.owner.sql.query("delete from organization where id = $1", [
              organization.id,
            ])
          : undefined,
      () =>
        organization
          ? ctx.owner.sql.query(
              'delete from "user" where id = any($1::text[])',
              [Object.values(organization.users)],
            )
          : undefined,
    ];
    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length)
    throw new AggregateError(errors, "Cleanup regression failed");
});
