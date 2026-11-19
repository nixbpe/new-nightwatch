import {
  pendingInvitationListResponseSchema,
  type PendingInvitationListResponse,
} from "@nightwatch/api-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Mailer, OutboundMail } from "../auth/mailer";
import { createInvitationTestApp } from "./invitation-test-app";
import {
  createInvitationFixture,
  invitationSeed,
} from "./invitation-test-support";

const orgA = crypto.randomUUID();
const orgB = crypto.randomUUID();
const orgEmpty = crypto.randomUUID();
const orgPage = crypto.randomUUID();
const orgCreate = crypto.randomUUID();
const absentOrg = crypto.randomUUID();
const allOrgs = [orgA, orgB, orgEmpty, orgPage, orgCreate];
const fixture = createInvitationFixture([
  "owner",
  "admin",
  "viewer",
  "auditor",
  "other",
  "both",
  "bOnly",
]);
const { runtimeUrl, runtime, owner, run, actorIds, email } = fixture;
const mail: OutboundMail[] = [];
const mailer: Mailer = {
  send: (message) => {
    mail.push(message);
    return Promise.resolve();
  },
  verify: () => Promise.resolve(),
};
const { app, logs } = createInvitationTestApp({
  database: runtime,
  runtimeUrl,
  secret: `list-${run}`,
  actorIds,
  actorEmail: email,
  loggerName: "invitation-list-db-test",
  mailer,
});

async function list(actor: string, org: string, query = "") {
  const response = await app.request(
    `/api/organizations/${org}/invitations${query}`,
    { headers: { "x-test-actor": actor } },
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}
async function listOk(actor: string, org: string, query = "") {
  const result = await list(actor, org, query);
  expect(result.status).toBe(200);
  return pendingInvitationListResponseSchema.parse(
    result.body,
  ) satisfies PendingInvitationListResponse;
}
async function create(
  actor: string,
  org: string,
  address: string,
  role = "viewer",
) {
  const response = await app.request(`/api/organizations/${org}/invitations`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-actor": actor },
    body: JSON.stringify({ email: address, role }),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}
// expiresIn / sentAgo are SQL interval literals relative to clock_timestamp().
const seed = invitationSeed(owner, actorIds.owner, {
  sentAgo: "0 seconds",
  backdateCreated: true,
});
async function statusesOf(org: string, address: string) {
  return (
    await owner.sql.query<{ status: string }>(
      "select status from invitation where organization_id = $1 and lower(email) = lower($2) order by created_at",
      [org, address],
    )
  ).rows.map((row) => row.status);
}
async function previewStatus(invitationId: string) {
  return (await app.request(`/api/onboarding/invitations/${invitationId}`))
    .status;
}

beforeAll(async () => {
  await fixture.initialize(
    [
      [orgA, "List A", `list-a-${run}`],
      [orgB, "List B", `list-b-${run}`],
      [orgEmpty, "List Empty", `list-e-${run}`],
      [orgPage, "List Page", `list-p-${run}`],
      [orgCreate, "List Create", `list-c-${run}`],
    ],
    [
      ...["owner", "admin", "viewer", "auditor", "both"].flatMap(
        (role): [string, string, string][] => [
          [orgA, role, role === "both" ? "owner" : role],
          [orgEmpty, role, role === "both" ? "owner" : role],
        ],
      ),
      [orgPage, "owner", "owner"],
      [orgPage, "viewer", "viewer"],
      [orgCreate, "owner", "owner"],
      [orgCreate, "viewer", "viewer"],
      [orgB, "both", "admin"],
      [orgB, "bOnly", "admin"],
    ],
  );
}, 120_000);

afterAll(async () => {
  await fixture.close(allOrgs);
});

describe("first-party pending invitation list", () => {
  it("lists only the selected organization's pending invitations to owner and admin and denies other roles", async () => {
    const a = await seed(orgA, email("only-a"));
    const b = await seed(orgB, email("only-b"));
    for (const actor of ["owner", "admin", "both"]) {
      const body = await listOk(actor, orgA);
      expect(body.invitations.map((row) => row.publicId)).toEqual([a.publicId]);
      expect(body.organizationId).toBe(orgA);
    }
    const bodyB = await listOk("both", orgB);
    expect(bodyB.invitations.map((row) => row.publicId)).toEqual([b.publicId]);
    const onlyB = await listOk("bOnly", orgB);
    expect(onlyB.invitations.map((row) => row.publicId)).toEqual([b.publicId]);
    expect(await list("bOnly", orgA)).toMatchObject({
      status: 403,
      body: { error: { code: "MEMBERSHIP_DENIED" } },
    });
    for (const actor of ["viewer", "auditor"]) {
      expect(await list(actor, orgA)).toMatchObject({
        status: 403,
        body: { error: { code: "PERMISSION_DENIED" } },
      });
    }
    expect(await list("other", orgA)).toMatchObject({
      status: 403,
      body: { error: { code: "MEMBERSHIP_DENIED" } },
    });
    // A member of A who is not a member of B gets no rows of B.
    expect(await list("owner", orgB)).toMatchObject({
      status: 403,
      body: { error: { code: "MEMBERSHIP_DENIED" } },
    });
    expect(await list("owner", orgA, "")).not.toMatchObject({ status: 401 });
    const unauthenticated = await app.request(
      `/api/organizations/${orgA}/invitations`,
    );
    expect(unauthenticated.status).toBe(401);
  });

  it("returns no invitation id, inviter or other private field and no data when denied", async () => {
    const seeded = await seed(orgA, email("no-id"));
    const ok = await list("owner", orgA);
    expect(ok.body.invitations).not.toHaveLength(0);
    const text = JSON.stringify(ok.body);
    expect(text).not.toContain(seeded.id);
    expect(text).not.toContain(actorIds.owner);
    for (const row of ok.body.invitations as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual([
        "email",
        "expired",
        "expiresAt",
        "manageable",
        "publicId",
        "resendAvailableAt",
        "role",
        "sentAt",
      ]);
    }
    for (const actor of ["viewer", "auditor", "other"]) {
      const denied = JSON.stringify(await list(actor, orgA));
      expect(denied).not.toContain(email("no-id"));
      expect(denied).not.toContain("activeCount");
      expect(denied).not.toContain("invitations");
    }
  });

  it("returns identical denied bodies for organizations with and without invitations and for absent organizations", async () => {
    await seed(orgA, email("denied-body"));
    for (const actor of ["viewer", "auditor"]) {
      expect(await list(actor, orgA)).toEqual(await list(actor, orgEmpty));
    }
    expect(await list("other", orgA)).toEqual(await list("other", orgEmpty));
    expect(await list("other", orgA)).toEqual(await list("other", absentOrg));
    expect(await list("owner", orgB)).toEqual(await list("owner", absentOrg));
  });

  it("counts only live pending rows in activeCount and lists pending rows with expired ones flagged", async () => {
    const org = orgEmpty;
    const live = await seed(org, email("live"), { sentAgo: "10 seconds" });
    const expired = await seed(org, email("expired"), {
      expiresIn: "-1 second",
      sentAgo: "20 seconds",
    });
    const neverExpires = await seed(org, email("null-exp"), {
      expiresIn: null,
      sentAgo: "30 seconds",
      role: "owner",
    });
    await seed(org, email("accepted"), { status: "accepted" });
    await seed(org, email("canceled"), { status: "canceled" });
    await seed(org, email("rejected"), { status: "rejected" });
    const asOwner = await listOk("owner", org);
    expect(asOwner.activeCount).toBe(1);
    expect(asOwner.activeLimit).toBe(100);
    expect(asOwner.page).toEqual({ limit: 50, offset: 0, total: 3 });
    expect(
      asOwner.invitations.map((row) => [row.publicId, row.expired]),
    ).toEqual([
      [live.publicId, false],
      [expired.publicId, true],
      [neverExpires.publicId, true],
    ]);
    expect(asOwner.invitations[2]?.expiresAt).toBeNull();
    expect(asOwner.invitations.map((row) => row.manageable)).toEqual([
      true,
      true,
      true,
    ]);
    const asAdmin = await listOk("admin", org);
    expect(asAdmin.invitations.map((row) => row.manageable)).toEqual([
      true,
      true,
      false,
    ]);
    const emails = asOwner.invitations.map((row) => row.email);
    expect(emails).not.toContain(email("accepted"));
    expect(emails).not.toContain(email("canceled"));
    expect(emails).not.toContain(email("rejected"));
  });

  it("rejects limit outside 1..50 and a negative or non-integer offset with 400", async () => {
    for (const query of [
      "?limit=0",
      "?limit=51",
      "?limit=abc",
      "?limit=1.5",
      "?offset=-1",
      "?offset=x",
    ]) {
      expect(await list("owner", orgA, query)).toMatchObject({
        status: 400,
        body: { error: { code: "VALIDATION_ERROR" } },
      });
    }
    expect((await list("owner", orgA, "?limit=1&offset=0")).status).toBe(200);
    expect((await list("owner", orgA, "?limit=50")).status).toBe(200);
  });

  it("pages 49, 50 and 51 rows with stable order, total and activeCount independent of the page", async () => {
    // Rows 1-9 share one sent_at so the public_id tiebreak decides their order.
    await owner.sql.query(
      `insert into invitation (id, organization_id, email, role, status, inviter_id, expires_at, created_at, sent_at)
       select gen_random_uuid()::text, $1, 'page-' || n || $2, 'viewer', 'pending', $3,
              case when n % 10 = 0 then now() - interval '1 hour' else now() + interval '1 day' end,
              now(),
              case when n <= 9 then timestamptz '2026-01-01 00:00:00+00'
                   else timestamptz '2026-01-01 00:00:00+00' + n * interval '1 minute' end
       from generate_series(1, 49) n`,
      [orgPage, `-${run}@example.test`, actorIds.owner],
    );
    const first49 = await listOk("owner", orgPage);
    expect(first49.page.total).toBe(49);
    expect(first49.invitations).toHaveLength(49);

    await seed(orgPage, email("page-50"), { sentAgo: "1 second" });
    const at50 = await listOk("owner", orgPage);
    expect(at50.page.total).toBe(50);
    expect(at50.invitations).toHaveLength(50);
    expect(await listOk("owner", orgPage, "?offset=50")).toMatchObject({
      invitations: [],
      page: { limit: 50, offset: 50, total: 50 },
    });

    await seed(orgPage, email("page-51"), { sentAgo: "2 seconds" });
    const page1 = await listOk("owner", orgPage);
    const page2 = await listOk("owner", orgPage, "?offset=50");
    expect(page1.invitations).toHaveLength(50);
    expect(page2.invitations).toHaveLength(1);
    for (const body of [page1, page2]) {
      expect(body.page.total).toBe(51);
      expect(body.activeCount).toBe(page1.activeCount);
    }
    expect(page1.activeCount).toBe(47);

    const all = [...page1.invitations, ...page2.invitations];
    expect(new Set(all.map((row) => row.publicId)).size).toBe(51);
    const expected = [...all].sort(
      (left, right) =>
        Date.parse(right.sentAt) - Date.parse(left.sentAt) ||
        (left.publicId < right.publicId ? -1 : 1),
    );
    expect(all.map((row) => row.publicId)).toEqual(
      expected.map((row) => row.publicId),
    );
    // Small pages walk the same sequence.
    const walked: string[] = [];
    for (let offset = 0; offset < 51; offset += 7) {
      const part = await listOk(
        "owner",
        orgPage,
        `?limit=7&offset=${String(offset)}`,
      );
      expect(part.page).toEqual({ limit: 7, offset, total: 51 });
      walked.push(...part.invitations.map((row) => row.publicId));
    }
    expect(walked).toEqual(all.map((row) => row.publicId));

    const beyond = await listOk("owner", orgPage, "?offset=51");
    expect(beyond.invitations).toEqual([]);
    expect(beyond.page.total).toBe(51);
    expect(beyond.activeCount).toBe(47);
  });
});

describe("invitation create with management columns", () => {
  it("writes sent_at = created_at, lists the new row first and sets resendAvailableAt to sent_at + 300 s", async () => {
    await seed(orgCreate, email("older"), { sentAgo: "1 hour" });
    const address = email("fresh");
    expect((await create("owner", orgCreate, address)).status).toBe(201);
    const stored = await owner.sql.query<{ sentAt: Date; createdAt: Date }>(
      `select sent_at as "sentAt", created_at as "createdAt" from invitation
       where organization_id = $1 and email = $2`,
      [orgCreate, address],
    );
    expect(stored.rows[0]?.sentAt.getTime()).toBe(
      stored.rows[0]?.createdAt.getTime(),
    );
    const body = await listOk("owner", orgCreate);
    const top = body.invitations[0];
    expect(top?.email).toBe(address);
    expect(Date.parse(top?.sentAt ?? "")).toBe(
      stored.rows[0]?.sentAt.getTime(),
    );
    expect(
      Date.parse(top?.resendAvailableAt ?? "") - Date.parse(top?.sentAt ?? ""),
    ).toBe(300_000);
    expect(top?.expired).toBe(false);
  });

  it("cancels every expired pending row of the same email, including legacy and case variants, and kills their links", async () => {
    const address = email("recycle");
    const expiredA = await seed(orgCreate, address, {
      expiresIn: "-1 hour",
      sentAgo: "3 hours",
    });
    const expiredNull = await seed(orgCreate, address.toUpperCase(), {
      expiresIn: null,
      sentAgo: "2 hours",
    });
    await seed(orgCreate, email("recycle-other"), {
      expiresIn: "-1 hour",
    });
    await seed(orgA, address, { expiresIn: "-1 hour" });
    await seed(orgCreate, address, {
      status: "accepted",
      expiresIn: "-1 hour",
    });
    expect((await create("owner", orgCreate, address)).status).toBe(201);
    expect(await statusesOf(orgCreate, address)).toEqual([
      "canceled",
      "canceled",
      "accepted",
      "pending",
    ]);
    expect(await previewStatus(expiredA.id)).toBe(404);
    expect(await previewStatus(expiredNull.id)).toBe(404);
    expect(await statusesOf(orgCreate, email("recycle-other"))).toEqual([
      "pending",
    ]);
    expect(await statusesOf(orgA, address)).toEqual(["pending"]);
    const live = await owner.sql.query<{ count: number }>(
      `select count(*)::int as count from invitation
       where organization_id = $1 and lower(email) = lower($2) and status = 'pending'`,
      [orgCreate, address],
    );
    expect(live.rows[0]?.count).toBe(1);
  });

  it("leaves expired rows pending when create is rejected with 409 or 403", async () => {
    const duplicate = email("reject-dup");
    const member = email("viewer");
    const denied = email("reject-denied");
    await seed(orgCreate, duplicate, {
      expiresIn: "-1 hour",
      sentAgo: "2 hours",
    });
    await seed(orgCreate, duplicate, { sentAgo: "1 hour" });
    await seed(orgCreate, member, { expiresIn: "-1 hour" });
    await seed(orgCreate, denied, { expiresIn: "-1 hour" });
    expect(await create("owner", orgCreate, duplicate)).toMatchObject({
      status: 409,
      body: { error: { code: "INVITATION_ALREADY_PENDING" } },
    });
    expect(await create("owner", orgCreate, member)).toMatchObject({
      status: 409,
      body: { error: { code: "USER_ALREADY_MEMBER" } },
    });
    expect(await create("viewer", orgCreate, denied)).toMatchObject({
      status: 403,
      body: { error: { code: "PERMISSION_DENIED" } },
    });
    expect(await create("other", orgCreate, denied)).toMatchObject({
      status: 403,
      body: { error: { code: "MEMBERSHIP_DENIED" } },
    });
    expect(await statusesOf(orgCreate, duplicate)).toEqual([
      "pending",
      "pending",
    ]);
    expect(await statusesOf(orgCreate, member)).toEqual(["pending"]);
    expect(await statusesOf(orgCreate, denied)).toEqual(["pending"]);
  });

  it("leaves expired rows pending when the quota of 100 live rows rejects create", async () => {
    const address = email("reject-cap");
    await seed(orgCreate, address, { expiresIn: "-1 hour" });
    const live = await owner.sql.query<{ count: number }>(
      "select count(*)::int as count from invitation where organization_id = $1 and status = 'pending' and expires_at > clock_timestamp()",
      [orgCreate],
    );
    await owner.sql.query(
      `insert into invitation (id, organization_id, email, role, status, inviter_id, expires_at)
       select gen_random_uuid()::text, $1, 'cap-' || n || $2, 'viewer', 'pending', $3, now() + interval '1 day'
       from generate_series(1, $4::int) n`,
      [
        orgCreate,
        `-${run}@example.test`,
        actorIds.owner,
        100 - (live.rows[0]?.count ?? 0),
      ],
    );
    expect(await create("owner", orgCreate, address)).toMatchObject({
      status: 409,
      body: { error: { code: "INVITATION_LIMIT_REACHED" } },
    });
    expect(await statusesOf(orgCreate, address)).toEqual(["pending"]);
  });
});

describe("invitation list logging", () => {
  it("logs route templates and no organization id, publicId, email or session token", async () => {
    const row = await seed(orgA, email("log"));
    logs.length = 0;
    await list("owner", orgA, "?limit=5");
    await list("viewer", orgA);
    await app.request(
      `/api/organizations/${orgA}/invitations/${row.publicId}/resend`,
      { method: "POST", headers: { "x-test-actor": "owner" } },
    );
    await app.request(
      `/api/organizations/${orgA}/invitations/${row.publicId}`,
      {
        method: "DELETE",
        headers: { "x-test-actor": "owner" },
      },
    );
    const captured = logs.join("\n");
    for (const privateValue of [
      orgA,
      row.publicId,
      row.id,
      email("log"),
      run,
      "test-session",
    ]) {
      expect(captured).not.toContain(privateValue);
    }
    const completions = logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.msg === "request completed")
      .map((line) => `${String(line.method)} ${String(line.path)}`);
    expect(completions).toEqual([
      "GET /api/organizations/:organizationId/invitations",
      "GET /api/organizations/:organizationId/invitations",
      "POST /api/organizations/:organizationId/invitations/:publicId/resend",
      "DELETE /api/organizations/:organizationId/invitations/:publicId",
    ]);
    const audits = logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.msg === "organization access denied");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: actorIds.viewer,
      action: "organization.invitation.list",
      code: "PERMISSION_DENIED",
    });
  });
});
