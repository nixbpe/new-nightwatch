import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";

import { createDatabase } from "../../packages/db/src/index.ts";
import { resetFixture } from "../../apps/api/src/operator/provision-e2e-fixture";
import { resolveDevEnv } from "../../scripts/dev-env.mjs";

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

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(email);
  await page.locator("#login-password").fill(password);
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
