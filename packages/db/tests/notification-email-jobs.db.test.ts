import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  claimNotificationEmailJobs,
  finishNotificationEmailJob,
  insertVulnerabilityNotificationIntent,
  withTenantContextRaw,
} from "../src";
import { openTestPostgres } from "./support/postgres";

async function seed(
  fixture: Awaited<ReturnType<typeof openTestPostgres>>,
): Promise<{
  tenant: string;
  project: string;
  owner: string;
  member: string;
  intent: string;
}> {
  const owner = fixture.owner.sql;
  const ids = {
    tenant: randomUUID(),
    project: randomUUID(),
    owner: randomUUID(),
    member: randomUUID(),
    outsider: randomUUID(),
  };
  await owner.query(
    "insert into organization (id, name, slug) values ($1, 'Mail', $2)",
    [ids.tenant, `mail-${ids.tenant}`],
  );
  for (const [role, id] of [
    ["owner", ids.owner],
    ["viewer", ids.member],
    ["viewer", ids.outsider],
  ] as const) {
    await owner.query(
      `insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)`,
      [id, id, `${id}@example.test`],
    );
    await owner.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, $4, now(), now())`,
      [randomUUID(), ids.tenant, id, role],
    );
  }
  await owner.query(
    "insert into projects (id, tenant_id, name, slug) values ($1, $2, 'P', 'mail-project')",
    [ids.project, ids.tenant],
  );
  await owner.query(
    "insert into project_members (project_id, tenant_id, user_id, role) values ($1, $2, $3, 'member')",
    [ids.project, ids.tenant, ids.member],
  );
  await withTenantContextRaw(fixture.runtime, ids.tenant, (client) =>
    insertVulnerabilityNotificationIntent(client, {
      tenantId: ids.tenant,
      projectId: ids.project,
      projectName: "P",
      runId: randomUUID(),
      cveCount: 1,
      componentCount: 1,
      occurredAt: new Date(),
    }),
  );
  const intent = await owner.query<{ id: string }>(
    "select id from notification_intents where tenant_id = $1",
    [ids.tenant],
  );
  return { ...ids, intent: intent.rows[0]?.id ?? "" };
}

describe("notification email jobs", () => {
  it("queues one mail per recipient with the intent, claims each once per lease and ends it with the claim's token", async () => {
    const fixture = await openTestPostgres("email-jobs");
    try {
      const ids = await seed(fixture);
      const queued = await fixture.owner.sql.query<{
        recipient_user_id: string;
        state: string;
      }>(
        "select recipient_user_id, state from notification_email_jobs where intent_id = $1 order by recipient_user_id",
        [ids.intent],
      );
      expect(queued.rows.map((row) => row.recipient_user_id).sort()).toEqual(
        [ids.owner, ids.member].sort(),
      );
      expect(new Set(queued.rows.map((row) => row.state))).toEqual(
        new Set(["pending"]),
      );

      const claimed = await claimNotificationEmailJobs(fixture.runtime, {
        limit: 10,
      });
      expect(claimed).toHaveLength(2);
      expect(claimed.every((claim) => claim.attemptCount === 1)).toBe(true);
      // A live lease is not claimed again.
      expect(
        await claimNotificationEmailJobs(fixture.runtime, { limit: 10 }),
      ).toEqual([]);

      const first = claimed[0];
      if (!first) throw new Error("no claim");
      const base = {
        intentId: first.intentId,
        recipientUserId: first.recipientUserId,
      };
      expect(
        await finishNotificationEmailJob(fixture.runtime, {
          ...base,
          claimToken: randomUUID(),
          outcome: "sent",
        }),
      ).toBe(false);
      expect(
        await finishNotificationEmailJob(fixture.runtime, {
          ...base,
          claimToken: first.claimToken,
          outcome: "sent",
        }),
      ).toBe(true);
      // Ended: the same token no longer ends it again.
      expect(
        await finishNotificationEmailJob(fixture.runtime, {
          ...base,
          claimToken: first.claimToken,
          outcome: "failed",
        }),
      ).toBe(false);
      const row = await fixture.owner.sql.query<{
        state: string;
        sent: boolean;
      }>(
        "select state, sent_at is not null as sent from notification_email_jobs where intent_id = $1 and recipient_user_id = $2",
        [first.intentId, first.recipientUserId],
      );
      expect(row.rows[0]).toEqual({ state: "sent", sent: true });
    } finally {
      await fixture.close();
    }
  }, 120_000);

  it("retries after 5 minutes times the attempts, claims again after a lease runs out, and ends a job that used its 5 attempts", async () => {
    const fixture = await openTestPostgres("email-jobs-retry");
    try {
      const ids = await seed(fixture);
      const owner = fixture.owner.sql;
      await owner.query(
        "delete from notification_email_jobs where recipient_user_id <> $1",
        [ids.owner],
      );
      const minutes = async () =>
        (
          await owner.query<{ m: number; state: string; n: number }>(
            "select round(extract(epoch from next_attempt_at - now()) / 60)::int as m, state, attempt_count as n from notification_email_jobs",
          )
        ).rows[0];
      const due = () =>
        owner.query(
          "update notification_email_jobs set next_attempt_at = now() - interval '1 minute'",
        );

      for (const attempt of [1, 2]) {
        const [claim] = await claimNotificationEmailJobs(fixture.runtime, {
          limit: 1,
        });
        expect(claim?.attemptCount).toBe(attempt);
        await finishNotificationEmailJob(fixture.runtime, {
          intentId: ids.intent,
          recipientUserId: ids.owner,
          claimToken: claim?.claimToken ?? "",
          outcome: "retry",
        });
        expect(await minutes()).toEqual({
          m: 5 * attempt,
          state: "pending",
          n: attempt,
        });
        // Not due yet: nothing to claim.
        expect(
          await claimNotificationEmailJobs(fixture.runtime, { limit: 1 }),
        ).toEqual([]);
        await due();
      }

      // A Worker that stopped after claiming: the lease runs out and the job is claimed again.
      const third = await claimNotificationEmailJobs(fixture.runtime, {
        limit: 1,
      });
      expect(third[0]?.attemptCount).toBe(3);
      await owner.query(
        "update notification_email_jobs set claimed_until = now() - interval '1 minute'",
      );
      const fourth = await claimNotificationEmailJobs(fixture.runtime, {
        limit: 1,
      });
      expect(fourth[0]?.attemptCount).toBe(4);
      expect(fourth[0]?.claimToken).not.toBe(third[0]?.claimToken);
      // The first claim's token is stale now.
      expect(
        await finishNotificationEmailJob(fixture.runtime, {
          intentId: ids.intent,
          recipientUserId: ids.owner,
          claimToken: third[0]?.claimToken ?? "",
          outcome: "sent",
        }),
      ).toBe(false);

      await owner.query(
        "update notification_email_jobs set claimed_until = now() - interval '1 minute'",
      );
      expect(
        (await claimNotificationEmailJobs(fixture.runtime, { limit: 1 }))[0]
          ?.attemptCount,
      ).toBe(5);
      await owner.query(
        "update notification_email_jobs set claimed_until = now() - interval '1 minute'",
      );
      // Out of attempts: ended as failed, not claimed.
      expect(
        await claimNotificationEmailJobs(fixture.runtime, { limit: 1 }),
      ).toEqual([]);
      expect((await minutes())?.state).toBe("failed");
      await expect(
        finishNotificationEmailJob(fixture.runtime, {
          intentId: ids.intent,
          recipientUserId: ids.owner,
          claimToken: randomUUID(),
          outcome: "later" as never,
        }),
      ).rejects.toThrow(/outcome/);
    } finally {
      await fixture.close();
    }
  }, 120_000);

  it("keeps the rows out of reach of the runtime role outside its Organization and out of its direct updates", async () => {
    const fixture = await openTestPostgres("email-jobs-rls");
    try {
      const ids = await seed(fixture);
      const runtime = fixture.runtime.sql;
      expect(
        (await runtime.query("select * from notification_email_jobs")).rowCount,
      ).toBe(0);
      await expect(
        withTenantContextRaw(fixture.runtime, ids.tenant, (client) =>
          client.query("update notification_email_jobs set state = 'sent'"),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withTenantContextRaw(fixture.runtime, ids.tenant, (client) =>
          client.query("delete from notification_email_jobs"),
        ),
      ).rejects.toThrow(/permission denied/);
      const own = await withTenantContextRaw(
        fixture.runtime,
        ids.tenant,
        (client) => client.query("select * from notification_email_jobs"),
      );
      expect(own.rowCount).toBe(2);
      const other = await withTenantContextRaw(
        fixture.runtime,
        randomUUID(),
        (client) => client.query("select * from notification_email_jobs"),
      );
      expect(other.rowCount).toBe(0);
      const privilege = async (column: string) =>
        (
          await fixture.owner.sql.query<{ ok: boolean }>(
            "select has_column_privilege('nightwatch_email_job_owner', 'notification_email_jobs', $1, 'UPDATE') as ok",
            [column],
          )
        ).rows[0]?.ok;
      expect(await privilege("state")).toBe(true);
      expect(await privilege("claim_token")).toBe(true);
      expect(await privilege("recipient_user_id")).toBe(false);
      expect(await privilege("tenant_id")).toBe(false);
    } finally {
      await fixture.close();
    }
  }, 120_000);
});
