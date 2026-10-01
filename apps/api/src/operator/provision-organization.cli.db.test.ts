import { createDatabase, runMigrations } from "@nightwatch/db";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";

// Spawns the real entry point (`main` is not exported and runs only under
// import.meta.main) against a local SMTP server that records each message, so
// output, exit code, SMTP attempts and logs are those of the CLI itself.

const { ownerUrl } = requireIntegrationDatabaseUrls();
const database = createDatabase(ownerUrl);
const migrationsDir = fileURLToPath(
  new URL("../../../../packages/db/migrations", import.meta.url),
);
const apiDir = fileURLToPath(new URL("../..", import.meta.url));
const run = crypto.randomUUID().slice(0, 8);
const slugs: string[] = [];
const userIds: string[] = [];

const received: string[] = [];
// Whether the invitation id in each received link was already committed, as
// seen from a session other than the CLI's, when the mail was accepted.
const committedAtSend: boolean[] = [];
let smtp: Server;
let smtpPort = 0;

async function recordSend(message: string): Promise<void> {
  const id = /accept-invitation\/([0-9a-f-]{36})/.exec(decoded(message))?.[1];
  const visible = id
    ? await database.sql.query("select 1 from invitation where id = $1", [id])
    : { rows: [] };
  committedAtSend.push(visible.rows.length === 1);
  received.push(message);
}

// Minimal SMTP: enough of the protocol for nodemailer verify() and sendMail().
function startSmtp(): Promise<void> {
  smtp = createServer((socket) => {
    let inData = false;
    let data = "";
    let buffer = "";
    socket.write("220 capture ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          data += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          const message = data;
          data = "";
          // Replies only after the check: a send inside the CLI's transaction
          // would see its own uncommitted row and a fresh session would not.
          void recordSend(message).then(() => socket.write("250 queued\r\n"));
          return;
        }
        const eol = buffer.indexOf("\r\n");
        if (eol === -1) return;
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        const command = line.slice(0, 4).toUpperCase();
        if (command === "EHLO") socket.write("250 capture\r\n");
        else if (command === "DATA") {
          inData = true;
          socket.write("354 go\r\n");
        } else if (command === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve) =>
    smtp.listen(0, "127.0.0.1", () => {
      smtpPort = (smtp.address() as { port: number }).port;
      resolve();
    }),
  );
}

async function closedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) =>
    probe.close(() => {
      resolve();
    }),
  );
  return port;
}

// Soft line breaks and =XX escapes of quoted-printable bodies.
const decoded = (raw: string) =>
  raw
    .replace(/=\r\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_m, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
// One id per message: the link repeats in the text and HTML parts.
const linkIds = () =>
  received.flatMap((raw) => [
    ...new Set(
      [...decoded(raw).matchAll(/accept-invitation\/([0-9a-f-]{36})/g)].map(
        (match) => match[1] ?? "",
      ),
    ),
  ]);

async function cli(
  slug: string,
  ownerEmail: string,
  port = smtpPort,
): Promise<{ code: number; stdout: string; stderr: string }> {
  slugs.push(slug);
  const child = spawn(
    "bun",
    [
      "src/operator/provision-organization.ts",
      "--name",
      `CLI ${slug}`,
      "--slug",
      slug,
      "--owner-email",
      ownerEmail,
    ],
    {
      cwd: apiDir,
      // A hung child must not keep its database connection open.
      timeout: 60_000,
      killSignal: "SIGKILL",
      env: {
        ...process.env,
        DATABASE_URL: ownerUrl,
        DATABASE_OWNER_URL: ownerUrl,
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(port),
        SMTP_FROM: "NightWatch <no-reply@example.test>",
        LOG_LEVEL: "info",
        NODE_ENV: "test",
      },
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number>((resolve) =>
    child.on("close", (exitCode) => {
      resolve(exitCode ?? -1);
    }),
  );
  return { code, stdout, stderr };
}

const slug = (label: string) => `nw-provcli-${run}-${label}`;
const address = (label: string) => `provcli-${run}-${label}@example.test`;

async function orgId(aSlug: string) {
  const result = await database.sql.query<{ id: string }>(
    "select id from organization where slug = $1",
    [aSlug],
  );
  return result.rows[0]?.id ?? "";
}
async function seedOrg(aSlug: string) {
  const id = crypto.randomUUID();
  slugs.push(aSlug);
  await database.sql.query(
    "insert into organization (id, name, slug) values ($1, $2, $3)",
    [id, `CLI ${aSlug}`, aSlug],
  );
  return id;
}
async function seedInvitation(
  org: string,
  anEmail: string,
  options: { role?: string; expiresIn?: string } = {},
) {
  await database.sql.query(
    `insert into "user" (id, name, email, email_verified, created_at, updated_at)
     values ('nw-internal-provisioning', 'NightWatch provisioning',
             'provisioning@nightwatch.internal.invalid', false, now(), now())
     on conflict (id) do nothing`,
  );
  const id = crypto.randomUUID();
  await database.sql.query(
    `insert into invitation
       (id, organization_id, email, role, status, inviter_id, expires_at, created_at, sent_at)
     values ($1, $2, $3, $4, 'pending', 'nw-internal-provisioning',
             clock_timestamp() + $5::interval, clock_timestamp(), clock_timestamp())`,
    [id, org, anEmail, options.role ?? "owner", options.expiresIn ?? "1 day"],
  );
  return id;
}
async function seedLive(org: string, count: number) {
  await database.sql.query(
    `insert into invitation (id, organization_id, email, role, status, inviter_id, expires_at, created_at, sent_at)
     select gen_random_uuid()::text, $1, 'live-' || n || $2, 'viewer', 'pending',
            'nw-internal-provisioning', now() + interval '1 day', now(), now()
     from generate_series(1, $3::int) n`,
    [org, `-${run}@example.test`, count],
  );
}
async function invitationRows(org: string) {
  return (
    await database.sql.query<{ id: string; status: string; role: string }>(
      "select id, status, role from invitation where organization_id = $1 order by id",
      [org],
    )
  ).rows;
}
async function linkStatus(id: string) {
  const result = await database.sql.query(
    `select 1 from invitation
     where id = $1 and status = 'pending' and expires_at > clock_timestamp()`,
    [id],
  );
  return result.rows.length === 1 ? 200 : 404;
}
const leaksNoIdentifier = (text: string, ids: string[]) => {
  expect(text).not.toContain("accept-invitation");
  for (const id of ids) expect(text).not.toContain(id);
};

beforeAll(async () => {
  await runMigrations({ url: ownerUrl, migrationsDir });
  await startSmtp();
}, 120_000);
beforeEach(() => {
  received.length = 0;
  committedAtSend.length = 0;
});
afterAll(async () => {
  try {
    for (const aSlug of slugs) {
      await database.sql.query("delete from organization where slug = $1", [
        aSlug,
      ]);
    }
    for (const id of userIds) {
      await database.sql.query('delete from "user" where id = $1', [id]);
    }
  } finally {
    await database.close();
    await new Promise<void>((resolve) =>
      smtp.close(() => {
        resolve();
      }),
    );
  }
}, 30_000);

describe("bun run provision:organization against an existing organization", () => {
  it("creates the owner invitation, sends one mail and prints no link or id", async () => {
    const aSlug = slug("create");
    const org = await seedOrg(aSlug);
    const result = await cli(aSlug, address("create"));

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      `Provisioned organization "${aSlug}" and sent the owner invitation to ${address("create")}.`,
    );
    const rows = await invitationRows(org);
    expect(rows).toHaveLength(1);
    expect(received).toHaveLength(1);
    expect(linkIds()).toEqual([rows[0]?.id]);
    expect(committedAtSend).toEqual([true]);
    leaksNoIdentifier(result.stdout + result.stderr, [rows[0]?.id ?? ""]);
  });

  it("re-send sends one mail whose link works and whose predecessor is dead", async () => {
    const aSlug = slug("resend");
    const org = await seedOrg(aSlug);
    const oldId = await seedInvitation(org, address("resend"));
    const result = await cli(aSlug, address("resend"));

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      `Re-sent the pending owner invitation for organization "${aSlug}" to ${address("resend")}.`,
    );
    const rows = await invitationRows(org);
    expect(rows).toHaveLength(1);
    expect(received).toHaveLength(1);
    const [mailed] = linkIds();
    expect(mailed).toBe(rows[0]?.id);
    expect(committedAtSend).toEqual([true]);
    expect(await linkStatus(oldId)).toBe(404);
    expect(await linkStatus(mailed ?? "")).toBe(200);
    leaksNoIdentifier(result.stdout + result.stderr, [oldId, mailed ?? ""]);
  });

  it.each([
    ["100 live rows", false],
    ["100 live rows plus an expired row", true],
  ])(
    "at %s prints the quota message, exits 1 and sends nothing",
    async (_l, withExpired) => {
      const aSlug = slug(`quota-${String(withExpired)}`);
      const org = await seedOrg(aSlug);
      await seedLive(org, 100);
      if (withExpired) {
        await seedInvitation(org, address(`quota-${String(withExpired)}`), {
          expiresIn: "-1 hour",
        });
      }
      const before = await invitationRows(org);
      const result = await cli(aSlug, address(`quota-${String(withExpired)}`));

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("provision-organization: failed");
      expect(result.stderr).toContain(
        `Organization "${aSlug}" already has 100 pending invitations; no invitation was created.`,
      );
      expect(received).toHaveLength(0);
      expect(await invitationRows(org)).toEqual(before);
    },
  );

  it("with a live admin invitation exits 1, leaves the row and sends nothing", async () => {
    const aSlug = slug("admin");
    const org = await seedOrg(aSlug);
    await seedInvitation(org, address("admin"), { role: "admin" });
    const before = await invitationRows(org);
    const result = await cli(aSlug, address("admin"));

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("non-owner role");
    expect(received).toHaveLength(0);
    expect(await invitationRows(org)).toEqual(before);
    leaksNoIdentifier(
      result.stdout + result.stderr,
      before.map((row) => row.id),
    );
  });

  it("when SMTP fails keeps the committed row, tells the operator to re-run and exits 1", async () => {
    const aSlug = slug("smtpfail");
    const org = await seedOrg(aSlug);
    const result = await cli(aSlug, address("smtpfail"), await closedPort());

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      `Organization "${aSlug}" is provisioned, but the invitation email could not be delivered. Re-run the same command to resend the pending invitation.`,
    );
    const rows = await invitationRows(org);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
    leaksNoIdentifier(result.stdout + result.stderr, [rows[0]?.id ?? ""]);

    // The re-run re-sends with a fresh id.
    const rerun = await cli(aSlug, address("smtpfail"));
    expect(rerun.code).toBe(0);
    expect(rerun.stdout).toContain("Re-sent the pending owner invitation");
    expect(committedAtSend).toEqual([true]);
    expect(received).toHaveLength(1);
  });

  it("reports an existing member without sending mail", async () => {
    const aSlug = slug("member");
    const org = await seedOrg(aSlug);
    const userId = crypto.randomUUID();
    userIds.push(userId);
    await database.sql.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, 'CLI member', $2, true, now(), now())`,
      [userId, address("member")],
    );
    await database.sql.query(
      "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')",
      [crypto.randomUUID(), org, userId],
    );
    const result = await cli(aSlug, address("member"));

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      `${address("member")} is already a member of organization "${aSlug}"; nothing to do.`,
    );
    expect(received).toHaveLength(0);
  });

  it("still creates a new organization with its owner invitation", async () => {
    const aSlug = slug("new");
    const result = await cli(aSlug, address("new"));

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      `Provisioned organization "${aSlug}" and sent the owner invitation to ${address("new")}.`,
    );
    expect(received).toHaveLength(1);
    expect(await invitationRows(await orgId(aSlug))).toHaveLength(1);
  });
});
