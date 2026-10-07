import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";

import { createDatabase } from "../../packages/db/src/index.ts";
import { resetFixture } from "../../apps/api/src/operator/provision-e2e-fixture";
import { resolveDevEnv } from "../../scripts/dev-env.mjs";

// Enrollment and final login proof must never persist secrets or cookies.
test.use({ trace: "off", screenshot: "off", video: "off" });

const { env } = resolveDevEnv();
if (
  !env.DATABASE_OWNER_URL ||
  !new URL(env.DATABASE_OWNER_URL).pathname.startsWith("/nw_e2e_")
) {
  throw new Error(
    "Active-organization browser proof requires a runner-owned isolated E2E database",
  );
}
const database = createDatabase(env.DATABASE_OWNER_URL);
const identity = {
  userId: randomUUID(),
  accountId: randomUUID(),
  organizationId: randomUUID(),
  memberId: randomUUID(),
  organizationSlug: `bootstrap-${randomUUID()}`,
};
const email = `bootstrap-${randomUUID()}@nightwatch.invalid`;
const password = `Bootstrap-${randomUUID()}!`;

test.beforeEach(async () => {
  const client = await database.sql.connect();
  try {
    await resetFixture(client, email, await hashPassword(password), identity);
    await client.query(
      'update "user" set last_active_tenant_id = null where id = $1',
      [identity.userId],
    );
  } finally {
    client.release();
  }
});
test.afterAll(async () => {
  await database.close();
});

async function signIn(
  page: Page,
  loginEmail = email,
  loginPassword = password,
) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(loginEmail);
  await page.locator("#login-password").fill(loginPassword);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL(/\/workspace$/);
}

async function selection() {
  const result = await database.sql.query<{
    last_active_tenant_id: string | null;
    mirrors_match: boolean;
  }>(
    `select last_active_tenant_id, not exists (
       select 1 from session where user_id = $1
       and active_organization_id is distinct from "user".last_active_tenant_id::text
     ) as mirrors_match from "user" where id = $1`,
    [identity.userId],
  );
  return result.rows[0];
}

test("single-member cold login and existing-session reload resolve before tenant requests in both themes", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path === "/api/me/resolve-active-org" ||
      path.startsWith("/api/organizations/") ||
      path.startsWith("/api/notifications")
    )
      requests.push(path);
  });
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "ภาพรวม", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "ตำแหน่งปัจจุบัน" }),
  ).toContainText("NightWatch E2E Settings");
  expect(requests[0]).toBe("/api/me/resolve-active-org");
  expect(await selection()).toEqual({
    last_active_tenant_id: identity.organizationId,
    mirrors_match: true,
  });
  for (const colorScheme of ["dark", "light"] as const) {
    await database.sql.query(
      'update "user" set last_active_tenant_id = null where id = $1',
      [identity.userId],
    );
    await database.sql.query(
      "update session set active_organization_id = null where user_id = $1",
      [identity.userId],
    );
    await page.emulateMedia({ colorScheme });
    requests.length = 0;
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "ภาพรวม", exact: true }),
    ).toBeVisible();
    expect(requests[0]).toBe("/api/me/resolve-active-org");
    expect(await selection()).toEqual({
      last_active_tenant_id: identity.organizationId,
      mirrors_match: true,
    });
    await page
      .getByRole("button", { name: "การแจ้งเตือน", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "การแจ้งเตือน" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "การแจ้งเตือน", exact: true }),
    ).toBeFocused();
  }
});

test("bootstrap failure blocks tenant and inbox requests until keyboard retry succeeds", async ({
  page,
}) => {
  let tenantRequests = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith("/api/organizations/") ||
      path.startsWith("/api/notifications")
    )
      tenantRequests++;
  });
  await page.route("**/api/me/resolve-active-org", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "INTERNAL_ERROR", message: "Unavailable" },
      }),
    }),
  );
  await signIn(page);
  await expect(page.getByRole("alert")).toContainText(
    "โหลดข้อมูลองค์กรไม่สำเร็จ",
  );
  expect(tenantRequests).toBe(0);
  expect(await selection()).toEqual({
    last_active_tenant_id: null,
    mirrors_match: true,
  });
  await page.unroute("**/api/me/resolve-active-org");
  await page.getByRole("button", { name: "ลองใหม่", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "ภาพรวม", exact: true }),
  ).toBeVisible();
  expect(await selection()).toEqual({
    last_active_tenant_id: identity.organizationId,
    mirrors_match: true,
  });
});

test("warm-cache scope change withdraws tenant and inbox use until deferred resolver failure and retry", async ({
  page,
}) => {
  await signIn(page);
  const overview = page.getByRole("heading", { name: "ภาพรวม", exact: true });
  await expect(overview).toBeVisible();
  const resolverStarted = Promise.withResolvers<void>();
  const releaseResolver = Promise.withResolvers<void>();
  await page.route("**/api/me/resolve-active-org", async (route) => {
    resolverStarted.resolve();
    await releaseResolver.promise;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "INTERNAL_ERROR", message: "Unavailable" },
      }),
    });
  });
  await page.route("**/api/notifications?*", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "INBOX_SCOPE_CHANGED", message: "changed" },
      }),
    }),
  );
  await page.getByRole("button", { name: "การแจ้งเตือน", exact: true }).click();
  await resolverStarted.promise;
  await expect(overview).not.toBeVisible();
  await expect(page.getByText("กำลังโหลดข้อมูลองค์กร…")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "การแจ้งเตือน", exact: true }),
  ).toBeDisabled();
  let scopeRequests = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith("/api/organizations/") ||
      path.startsWith("/api/notifications")
    )
      scopeRequests++;
  });
  // Assertions hold while the response is still under this test's barrier.
  expect(scopeRequests).toBe(0);
  releaseResolver.resolve();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "โหลดข้อมูลองค์กรไม่สำเร็จ",
  );
  expect(scopeRequests).toBe(0);
  await page.unroute("**/api/me/resolve-active-org");
  await page.unroute("**/api/notifications?*");
  await page
    .getByRole("main")
    .getByRole("button", { name: "ลองใหม่", exact: true })
    .click();
  await expect(overview).toBeVisible();
  expect(await selection()).toEqual({
    last_active_tenant_id: identity.organizationId,
    mirrors_match: true,
  });
});

test("no membership admits account settings and account-only notifications without tenant requests", async ({
  page,
}) => {
  await database.sql.query("delete from member where id = $1", [
    identity.memberId,
  ]);
  let tenantRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/organizations/"))
      tenantRequests++;
  });
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ออกจากระบบ", exact: true }),
  ).toBeVisible();
  expect(await selection()).toEqual({
    last_active_tenant_id: null,
    mirrors_match: true,
  });
  await page.goto("/settings/profile");
  await expect(page.getByLabel("ชื่อที่แสดง")).toBeVisible();
  await page.goto("/notifications");
  await expect(
    page.getByRole("heading", { name: "การแจ้งเตือน", exact: true }),
  ).toBeVisible();
  expect(tenantRequests).toBe(0);
});

for (const action of ["switch", "leave", "revoke"] as const) {
  for (const remaining of action === "switch" ? [true] : [true, false]) {
    test(`two sessions ${action} during inbox operation, remaining membership ${remaining}`, async ({
      page,
      browser,
    }) => {
      const actorIdentity = {
        userId: randomUUID(),
        accountId: randomUUID(),
        organizationId: randomUUID(),
        memberId: randomUUID(),
        organizationSlug: `actor-${randomUUID()}`,
      };
      const actorEmail = `${randomUUID()}@nightwatch.invalid`;
      const client = await database.sql.connect();
      try {
        await resetFixture(
          client,
          actorEmail,
          await hashPassword(password),
          actorIdentity,
        );
      } finally {
        client.release();
      }
      await database.sql.query(
        "update organization set name = 'Replacement org' where id = $1",
        [actorIdentity.organizationId],
      );
      await database.sql.query(
        "insert into member (id, user_id, organization_id, role) values ($1, $2, $3, 'owner')",
        [randomUUID(), actorIdentity.userId, identity.organizationId],
      );
      await database.sql.query(
        "update member set role = 'viewer' where id = $1",
        [identity.memberId],
      );
      if (remaining)
        await database.sql.query(
          "insert into member (id, user_id, organization_id, role) values ($1, $2, $3, 'viewer')",
          [randomUUID(), identity.userId, actorIdentity.organizationId],
        );
      const second = await browser.newContext();
      const otherPage = await second.newPage();
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      try {
        await signIn(page);
        await expect(
          page.getByRole("heading", { name: "ภาพรวม", exact: true }),
        ).toBeVisible();
        await signIn(otherPage, action === "revoke" ? actorEmail : email);
        await expect(
          otherPage.getByRole("heading", { name: "ภาพรวม", exact: true }),
        ).toBeVisible();
        await page.route(
          "**/api/notifications?*",
          async (route) => {
            started.resolve();
            await release.promise;
            await route.continue();
          },
          { times: 1 },
        );
        await page
          .getByRole("button", { name: "การแจ้งเตือน", exact: true })
          .click();
        await started.promise;
        const status = await otherPage.evaluate(
          async ({ action, original, target, member }) => {
            const response = await fetch(
              action === "switch"
                ? "/api/me/active-org"
                : `/api/organizations/${original}/members/${action === "leave" ? "me" : member}`,
              {
                method: action === "switch" ? "PATCH" : "DELETE",
                credentials: "include",
                headers: { "content-type": "application/json" },
                ...(action === "switch"
                  ? { body: JSON.stringify({ organizationId: target }) }
                  : {}),
              },
            );
            return response.status;
          },
          {
            action,
            original: identity.organizationId,
            target: actorIdentity.organizationId,
            member: identity.memberId,
          },
        );
        expect(status).toBe(200);
        release.resolve();
        if (remaining) {
          await expect(
            page.getByRole("navigation", { name: "ตำแหน่งปัจจุบัน" }),
          ).toContainText("Replacement org");
          await expect
            .poll(async () => (await selection())?.last_active_tenant_id)
            .toBe(actorIdentity.organizationId);
          // The context's replacement is usable only after the scope-change resolver.
          await expect(
            page.getByRole("heading", { name: "ภาพรวม", exact: true }),
          ).toBeVisible();
        } else {
          await expect(
            page.getByRole("heading", {
              name: "ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร",
            }),
          ).toBeVisible();
        }
        expect(await selection()).toEqual({
          last_active_tenant_id: remaining
            ? actorIdentity.organizationId
            : null,
          mirrors_match: true,
        });
        if (action !== "switch") {
          const denied = await page.evaluate(
            async (org) =>
              (
                await fetch(`/api/organizations/${org}/monitors`, {
                  credentials: "include",
                })
              ).status,
            identity.organizationId,
          );
          expect(denied).toBe(403);
        }
      } finally {
        release.resolve();
        await second.close();
        await database.sql.query("delete from organization where id = $1", [
          actorIdentity.organizationId,
        ]);
        await database.sql.query('delete from "user" where id = $1', [
          actorIdentity.userId,
        ]);
      }
    });
  }
}

test("successful invitation retains pending selection then explicitly switches before tenant bootstrap", async ({
  page,
}) => {
  const invitedOrg = randomUUID();
  const inviter = randomUUID();
  const invitation = randomUUID();
  const name = `Invited ${randomUUID()}`;
  await database.sql.query(
    'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
    [inviter, "Inviter fixture", `${inviter}@nightwatch.invalid`],
  );
  await database.sql.query(
    "insert into organization (id, name, slug) values ($1, $2, $3)",
    [invitedOrg, name, `invite-${randomUUID()}`],
  );
  await database.sql.query(
    "insert into member (id, user_id, organization_id, role) values ($1, $2, $3, 'owner')",
    [randomUUID(), inviter, invitedOrg],
  );
  await database.sql.query(
    "insert into invitation (id, organization_id, email, role, inviter_id, expires_at) values ($1, $2, $3, 'viewer', $4, now() + interval '1 day')",
    [invitation, invitedOrg, email, inviter],
  );
  try {
    await signIn(page);
    await expect(
      page.getByRole("heading", { name: "ภาพรวม", exact: true }),
    ).toBeVisible();
    await page.goto(`/accept-invitation/${invitation}`);
    await expect(
      page.getByRole("button", { name: "เข้าร่วมองค์กร", exact: true }),
    ).toBeVisible();
    expect((await selection())?.last_active_tenant_id).toBe(
      identity.organizationId,
    );
    const operations: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        path.endsWith("/accept") ||
        path === "/api/me/active-org" ||
        path === "/api/me/resolve-active-org"
      )
        operations.push(path);
    });
    await page
      .getByRole("button", { name: "เข้าร่วมองค์กร", exact: true })
      .click();
    await page.waitForURL(/\/workspace$/);
    await expect(
      page.getByRole("navigation", { name: "ตำแหน่งปัจจุบัน" }),
    ).toContainText(name);
    expect(operations.slice(0, 4)).toEqual([
      `/api/onboarding/invitations/${invitation}/accept`,
      "/api/me/resolve-active-org",
      "/api/me/active-org",
      "/api/me/resolve-active-org",
    ]);
    expect(await selection()).toEqual({
      last_active_tenant_id: invitedOrg,
      mirrors_match: true,
    });
  } finally {
    await database.sql.query("delete from organization where id = $1", [
      invitedOrg,
    ]);
    await database.sql.query('delete from "user" where id = $1', [inviter]);
  }
});

function totpCode(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase()]
    .map((ch) => alphabet.indexOf(ch).toString(2).padStart(5, "0"))
    .join("");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", Buffer.from(bytes))
    .update(counter)
    .digest();
  const last = digest.at(-1);
  if (last === undefined) throw new Error("Missing TOTP digest");
  const code = digest.readUInt32BE(last & 15) & 0x7fffffff;
  return String(code % 1000000).padStart(6, "0");
}

test.describe("final MFA login bootstrap", () => {
  test("TOTP, recovery and trusted-device login resolve only after final session", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/settings/security");
    const mfa = page.getByRole("region", { name: "ยืนยันสองขั้นตอน (MFA)" });
    await mfa.getByRole("button", { name: "เปิดใช้งาน", exact: true }).click();
    await mfa.getByLabel("รหัสผ่านปัจจุบัน").fill(password);
    await mfa.getByRole("button", { name: /ถัดไป: สแกนคิวอาร์โค้ด/ }).click();
    await expect(
      mfa.getByRole("img", { name: "คิวอาร์โค้ดสำหรับแอปยืนยันตัวตน" }),
    ).toBeVisible();
    const secret = (await mfa.locator("code").first().innerText()).replace(
      /\s+/g,
      "",
    );
    const backupCode = await mfa.locator("ul li").first().innerText();
    await mfa.getByRole("checkbox").check();
    await mfa.getByRole("button", { name: /ถัดไป: ยืนยันรหัสแรก/ }).click();
    await mfa.locator('input[name="first-totp"]').fill(totpCode(secret));
    await mfa.getByRole("button", { name: /ยืนยันและเปิดใช้งาน/ }).click();
    await expect(mfa.getByText("เปิดอยู่", { exact: true })).toBeVisible();
    for (const mode of ["recovery", "totp", "trusted"] as const) {
      await page.evaluate(async () => {
        await fetch("/api/auth/sign-out", {
          method: "POST",
          credentials: "include",
        });
      });
      await database.sql.query(
        'update "user" set last_active_tenant_id = null where id = $1',
        [identity.userId],
      );
      await database.sql.query(
        "update session set active_organization_id = null where user_id = $1",
        [identity.userId],
      );
      await page.goto("/login");
      await page.getByLabel("อีเมล").fill(email);
      await page.locator("#login-password").fill(password);
      await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
      if (mode !== "trusted") {
        await expect(
          page.getByRole("heading", { name: "ยืนยันตัวตนสองขั้นตอน" }),
        ).toBeVisible();
        expect(await selection()).toEqual({
          last_active_tenant_id: null,
          mirrors_match: true,
        });
        if (mode === "recovery")
          await page.getByRole("radio", { name: /รหัสกู้คืนบัญชี/ }).check();
        else
          await page
            .getByRole("checkbox", { name: /เชื่อถืออุปกรณ์นี้/ })
            .check();
        await page
          .locator('input[name="challenge-code"]')
          .fill(mode === "recovery" ? backupCode : totpCode(secret));
        await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();
      }
      await page.waitForURL(/\/workspace$/);
      await expect(
        page.getByRole("heading", { name: "ภาพรวม", exact: true }),
      ).toBeVisible();
      expect(await selection()).toEqual({
        last_active_tenant_id: identity.organizationId,
        mirrors_match: true,
      });
    }
  });
});

test("a bookmarked member organization names its URL scope without switching the account selection", async ({
  page,
}) => {
  const organizationId = randomUUID();
  const name = `Bookmarked ${randomUUID()}`;
  await database.sql.query(
    "insert into organization (id, name, slug, created_at, updated_at) values ($1, $2, $3, now(), now())",
    [organizationId, name, `bookmark-${randomUUID()}`],
  );
  await database.sql.query(
    "insert into member (id, organization_id, user_id, role, created_at, updated_at) values ($1, $2, $3, 'viewer', now(), now())",
    [randomUUID(), organizationId, identity.userId],
  );
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "ภาพรวม", exact: true }),
  ).toBeVisible();
  expect((await selection())?.last_active_tenant_id).toBe(
    identity.organizationId,
  );
  await page.goto(`/organizations/${organizationId}/monitors`);
  await expect(
    page.getByRole("navigation", { name: "ตำแหน่งปัจจุบัน" }),
  ).toContainText(name);
  await expect(
    page.getByRole("button", { name: /NightWatch E2E Settings/ }).first(),
  ).toBeVisible();
  expect(await selection()).toEqual({
    last_active_tenant_id: identity.organizationId,
    mirrors_match: true,
  });
});
