import { createDatabase, runMigrations, type Database } from "@nightwatch/db";
import {
  Client,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";
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

  it("denies without returning directory rows when the actor is downgraded after authorization starts", async () => {
    const hook = (client: PoolClient) => {
      const originalQuery = client.query.bind(client);
      const query = client.query.bind(client) as <T extends QueryResultRow>(
        text: string,
        values?: unknown[],
      ) => Promise<QueryResult<T>>;
      const release = client.release.bind(client);
      let downgraded = false;
      client.query = (async (text: string, values?: unknown[]) => {
        if (!downgraded && text.includes("with authorization_state as")) {
          downgraded = true;
          await owner.query(
            "update member set role = 'viewer' where organization_id = $1 and user_id = $2",
            [organizationId, ownerId],
          );
        }
        return query(text, values);
      }) as typeof client.query;
      client.release = (...args: Parameters<typeof client.release>) => {
        client.query = originalQuery;
        client.release = release;
        release(...args);
      };
    };
    database.sql.on("acquire", hook);
    try {
      await expect(
        listOrganizationMembers(database, {
          organizationId,
          actorUserId: ownerId,
          limit: 50,
          offset: 0,
        }),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    } finally {
      database.sql.off("acquire", hook);
      await owner.query(
        "update member set role = 'owner' where organization_id = $1 and user_id = $2",
        [organizationId, ownerId],
      );
    }
  });

  it("keeps exact bounded pages and tenant rows isolated for 49, 50, 51, and 101 members", async () => {
    const counts = [49, 50, 51, 101] as const;
    type Count = (typeof counts)[number];
    type DirectoryFixture = { id: string; count: Count; userIds: string[] };
    const organizations: Record<Count, DirectoryFixture> = {
      49: { id: crypto.randomUUID(), count: 49, userIds: [] },
      50: { id: crypto.randomUUID(), count: 50, userIds: [] },
      51: { id: crypto.randomUUID(), count: 51, userIds: [] },
      101: { id: crypto.randomUUID(), count: 101, userIds: [] },
    };
    const organizationFor = (count: Count): DirectoryFixture =>
      organizations[count];
    const actorA = crypto.randomUUID();
    const actorB = crypto.randomUUID();
    const actorAB = crypto.randomUUID();
    const viewer = crypto.randomUUID();
    const auditor = crypto.randomUUID();
    const insertedUsers = [actorA, actorB, actorAB, viewer, auditor];

    const addUser = async (id: string, name: string) => {
      await owner.query(
        'insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())',
        [id, name, `${id}@example.test`],
      );
    };
    const addMember = async (
      organization: { id: string; userIds: string[] },
      userId: string,
      role: string,
    ) => {
      await owner.query(
        "insert into member (id, organization_id, user_id, role, created_at, updated_at) values ($1, $2, $3, $4, now(), now())",
        [crypto.randomUUID(), organization.id, userId, role],
      );
      organization.userIds.push(userId);
    };

    try {
      for (const user of [
        [actorA, "A-only owner"],
        [actorB, "B-only owner"],
        [actorAB, "A+B admin"],
        [viewer, "Viewer"],
        [auditor, "Auditor"],
      ] as const) {
        await addUser(user[0], user[1]);
      }
      await owner.query(
        "insert into organization (id, name, slug, created_at) values ($1, $2, $3, now()), ($4, $5, $6, now()), ($7, $8, $9, now()), ($10, $11, $12, now())",
        [
          organizationFor(49).id,
          `Count 49 ${run}`,
          `count-49-${run}`,
          organizationFor(50).id,
          `Count 50 ${run}`,
          `count-50-${run}`,
          organizationFor(51).id,
          `Count 51 ${run}`,
          `count-51-${run}`,
          organizationFor(101).id,
          `Count 101 ${run}`,
          `count-101-${run}`,
        ],
      );

      await addMember(organizationFor(49), actorA, "owner");
      await addMember(organizationFor(49), viewer, "viewer");
      await addMember(organizationFor(49), auditor, "auditor");
      await addMember(organizationFor(50), actorB, "owner");
      for (const count of [51, 101] as const) {
        const organization = organizationFor(count);
        const ownerUser = crypto.randomUUID();
        insertedUsers.push(ownerUser);
        await addUser(ownerUser, `Owner ${String(count)}`);
        await addMember(organization, ownerUser, "owner");
        await addMember(organization, actorAB, "admin");
      }
      for (const organization of Object.values(organizations)) {
        while (organization.userIds.length < organization.count) {
          const userId = crypto.randomUUID();
          insertedUsers.push(userId);
          await addUser(
            userId,
            `Tenant-${String(organization.count)}-${String(organization.userIds.length).padStart(3, "0")}`,
          );
          await addMember(organization, userId, "viewer");
        }
      }

      const actorByCount = {
        49: actorA,
        50: actorB,
        51: actorAB,
        101: actorAB,
      } as const;
      for (const count of counts) {
        const organization = organizationFor(count);
        const first = await listOrganizationMembers(database, {
          organizationId: organization.id,
          actorUserId: actorByCount[count],
          limit: 50,
          offset: 0,
        });
        expect(first.organizationId).toBe(organization.id);
        expect(first.members).toHaveLength(Math.min(count, 50));
        expect(first.page).toEqual({
          limit: 50,
          offset: 0,
          total: count,
        });
        expect(
          first.members.every(
            (member) =>
              member.name.includes(String(count)) ||
              member.name.includes("only") ||
              member.name === "A+B admin" ||
              member.name === "Viewer" ||
              member.name === "Auditor",
          ),
        ).toBe(true);

        const next = await listOrganizationMembers(database, {
          organizationId: organization.id,
          actorUserId: actorByCount[count],
          limit: 50,
          offset: 50,
        });
        expect(next.members).toHaveLength(
          Math.min(50, Math.max(0, count - 50)),
        );
        expect(next.members.length).toBeLessThanOrEqual(50);
        expect(next.page).toEqual({ limit: 50, offset: 50, total: count });
        if (count === 101) {
          const finalPage = await listOrganizationMembers(database, {
            organizationId: organization.id,
            actorUserId: actorByCount[count],
            limit: 50,
            offset: 100,
          });
          expect(finalPage.members).toHaveLength(1);
          expect(finalPage.page).toEqual({
            limit: 50,
            offset: 100,
            total: 101,
          });
        }

        const previous = await listOrganizationMembers(database, {
          organizationId: organization.id,
          actorUserId: actorByCount[count],
          limit: 50,
          offset: 0,
        });
        expect(previous.members.map((member) => member.id)).toEqual(
          first.members.map((member) => member.id),
        );

        const beyondLast = await listOrganizationMembers(database, {
          organizationId: organization.id,
          actorUserId: actorByCount[count],
          limit: 50,
          offset: count + 50,
        });
        expect(beyondLast.members).toEqual([]);
        expect(beyondLast.page).toEqual({
          limit: 50,
          offset: count + 50,
          total: count,
        });
      }

      for (const actorUserId of [viewer, auditor]) {
        await expect(
          listOrganizationMembers(database, {
            organizationId: organizationFor(49).id,
            actorUserId,
            limit: 50,
            offset: 0,
          }),
        ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      }
      for (const organizationId of [
        organizationFor(49).id,
        crypto.randomUUID(),
      ]) {
        await expect(
          listOrganizationMembers(database, {
            organizationId,
            actorUserId: actorB,
            limit: 50,
            offset: 0,
          }),
        ).rejects.toMatchObject({ code: "MEMBERSHIP_DENIED" });
      }
    } finally {
      await owner.query("delete from organization where id = any($1::uuid[])", [
        Object.values(organizations).map((organization) => organization.id),
      ]);
      await owner.query('delete from "user" where id = any($1::text[])', [
        insertedUsers,
      ]);
    }
  });
});
