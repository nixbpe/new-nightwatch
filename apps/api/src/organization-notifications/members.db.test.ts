import { createDatabase, runMigrations, type Database } from "@nightwatch/db";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import { listOrganizationMembers } from "./members";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const run = crypto.randomUUID().slice(0, 8);
const organizationId = crypto.randomUUID();
const otherOrganizationId = crypto.randomUUID();
const ownerId = crypto.randomUUID();
const viewerId = crypto.randomUUID();
const duplicateUserA = `user-a-${run}`;
const duplicateUserZ = `user-z-${run}`;
const duplicateMemberA = `member-a-${run}`;
const duplicateMemberZ = `member-z-${run}`;
const database: Database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const migrationsDir = new URL(
  "../../../../packages/db/migrations",
  import.meta.url,
).pathname;

beforeAll(async () => {
  await owner.connect();
  await runMigrations({ url: ownerUrl, migrationsDir });
  await owner.query(
    `insert into organization (id, name, slug, created_at) values ($1, 'Directory ${run}', 'directory-${run}', now()), ($2, 'Other ${run}', 'other-${run}', now())`,
    [organizationId, otherOrganizationId],
  );
  for (const [id, name] of [
    [ownerId, "Owner"],
    [viewerId, "Viewer"],
  ] as const) {
    await owner.query(
      'insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())',
      [id, name, `${id}@example.test`],
    );
  }
  for (let index = 0; index < 51; index += 1) {
    const userId = crypto.randomUUID();
    await owner.query(
      'insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())',
      [
        userId,
        `Member ${String(index).padStart(2, "0")}`,
        `${userId}@example.test`,
      ],
    );
    await owner.query(
      "insert into member (id, organization_id, user_id, role, created_at, updated_at) values ($1, $2, $3, 'viewer', now(), now())",
      [crypto.randomUUID(), organizationId, userId],
    );
  }
  await owner.query(
    "insert into member (id, organization_id, user_id, role, created_at, updated_at) values ($1, $2, $3, 'owner', now(), now()), ($4, $2, $5, 'viewer', now(), now())",
    [
      crypto.randomUUID(),
      organizationId,
      ownerId,
      crypto.randomUUID(),
      viewerId,
    ],
  );
  await owner.query(
    "insert into \"user\" (id, name, email, email_verified, created_at, updated_at) values ($1, 'Same name', $2, true, now(), now()), ($3, 'Same name', $4, true, now(), now())",
    [
      duplicateUserZ,
      `same-z-${run}@example.test`,
      duplicateUserA,
      `same-a-${run}@example.test`,
    ],
  );
  await owner.query(
    "insert into member (id, organization_id, user_id, role, created_at, updated_at) values ($1, $2, $3, 'viewer', now(), now()), ($4, $2, $5, 'viewer', now(), now())",
    [
      duplicateMemberZ,
      organizationId,
      duplicateUserA,
      duplicateMemberA,
      duplicateUserZ,
    ],
  );
});

afterAll(async () => {
  await owner.query("delete from organization where id = any($1::uuid[])", [
    [organizationId, otherOrganizationId],
  ]);
  await owner.end();
  await database.close();
});

describe("listOrganizationMembers", () => {
  it("returns a bounded deterministic page and exact total for an authorized owner", async () => {
    const first = await listOrganizationMembers(database, {
      organizationId,
      actorUserId: ownerId,
      limit: 50,
      offset: 0,
    });
    const second = await listOrganizationMembers(database, {
      organizationId,
      actorUserId: ownerId,
      limit: 50,
      offset: 50,
    });
    expect(first.members).toHaveLength(50);
    expect(first.page).toEqual({ limit: 50, offset: 0, total: 55 });
    expect(second.members).toHaveLength(5);
    expect(second.page.total).toBe(55);
  });

  it("orders duplicate names by member ID rather than conflicting user ID", async () => {
    const all = await listOrganizationMembers(database, {
      organizationId,
      actorUserId: ownerId,
      limit: 55,
      offset: 0,
    });
    expect(
      all.members
        .filter((member) => member.name === "Same name")
        .map((member) => ({ id: member.id, userId: member.userId })),
    ).toEqual([
      { id: duplicateMemberA, userId: duplicateUserZ },
      { id: duplicateMemberZ, userId: duplicateUserA },
    ]);
  });

  it("denies viewers before reading directory data", async () => {
    await expect(
      listOrganizationMembers(database, {
        organizationId,
        actorUserId: viewerId,
        limit: 50,
        offset: 0,
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
