import { createDatabase } from "../../packages/db/src/index.ts";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type Route,
  type TestInfo,
} from "@playwright/test";

import { resetFixture } from "../../apps/api/src/operator/provision-e2e-fixture";
import { resolveDevEnv } from "../../scripts/dev-env.mjs";

const { env, ports } = resolveDevEnv();
const password = `notification-ui-${randomUUID()}`;
let currentPrimaryPassword = password;
const email = `notification-${randomUUID()}@nightwatch.invalid`;
const primaryOrganizationName = "NightWatch E2E Settings";
const secondaryOrganization = {
  id: randomUUID(),
  memberId: randomUUID(),
  name: `NightWatch E2E Alternate ${randomUUID()}`,
  slug: `notification-alternate-${randomUUID()}`,
};
const secondaryRole = "admin,viewer";

const seededItems = {
  personal: randomUUID(),
  primary: randomUUID(),
  secondary: randomUUID(),
  primaryReadOne: randomUUID(),
  primaryReadTwo: randomUUID(),
  primaryReadThree: randomUUID(),
};
const primaryActor = `Primary actor ${randomUUID()}`;
const secondaryActor = `Secondary actor ${randomUUID()}`;
const identity = {
  userId: randomUUID(),
  accountId: randomUUID(),
  organizationId: randomUUID(),
  memberId: randomUUID(),
  organizationSlug: `notification-${randomUUID()}`,
};
const alternateIdentity = {
  userId: randomUUID(),
  accountId: randomUUID(),
  organizationId: randomUUID(),
  memberId: randomUUID(),
  organizationSlug: `notification-identity-${randomUUID()}`,
};
const alternateEmail = `notification-identity-${randomUUID()}@nightwatch.invalid`;
const alternatePassword = `notification-identity-${randomUUID()}`;
const alternatePrimaryMemberId = randomUUID();
const deferredPrimaryActor = `Deferred primary actor ${randomUUID()}`;
const deferredSecondaryActor = `Deferred secondary actor ${randomUUID()}`;
const database = createDatabase(env.DATABASE_OWNER_URL!);

async function signIn(page: Page, value: string) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(email);
  await page.locator("#login-password").fill(value);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL(/\/workspace/);
}

async function seedItem(
  client: PoolClient,
  input: {
    id: string;
    scope: "account" | "tenant";
    organizationId?: string;
    actorDisplayName?: string;
    occurredAt?: string;
    readAt?: string;
  },
) {
  const origin = `notification-e2e:${input.id}`;
  const tenantId = input.scope === "tenant" ? input.organizationId! : null;
  const userId = input.scope === "account" ? identity.userId : null;
  const eventType =
    input.scope === "tenant"
      ? "ORG-NOTIFICATION-SETTINGS-CHANGED"
      : "PASSWORD_CHANGED";
  await client.query(
    `insert into notification_intents
      (id, scope_kind, tenant_id, user_id, origin, event_type, occurred_at, actor_display_name)
     values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), $8)`,
    [
      input.id,
      input.scope,
      tenantId,
      userId,
      origin,
      eventType,
      input.occurredAt ?? null,
      input.actorDisplayName ?? null,
    ],
  );
  await client.query(
    `insert into notification_intent_recipients
      (intent_id, origin, recipient_user_id, scope_kind, tenant_id, user_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [input.id, origin, identity.userId, input.scope, tenantId, userId],
  );
  await client.query(
    `insert into notification_inbox_items
      (id, intent_id, origin, recipient_user_id, scope_kind, tenant_id, user_id,
       event_type, occurred_at, actor_display_name, read_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now()), $10, $11)`,
    [
      input.id,
      input.id,
      origin,
      identity.userId,
      input.scope,
      tenantId,
      userId,
      eventType,
      input.occurredAt ?? null,
      input.actorDisplayName ?? null,
      input.readAt ?? null,
    ],
  );
  await client.query(
    `insert into notification_dispatch_ledger
      (id, intent_id, scope_kind, tenant_id, user_id, status)
     values ($1, $2, $3, $4, $5, 'completed')`,
    [`dispatch:${input.id}`, input.id, input.scope, tenantId, userId],
  );
}

async function seedNotificationFixtures() {
  const client = await database.sql.connect();
  try {
    await seedItem(client, { id: seededItems.personal, scope: "account" });
    await seedItem(client, {
      id: seededItems.primary,
      scope: "tenant",
      organizationId: identity.organizationId,
      actorDisplayName: primaryActor,
    });
    await seedItem(client, {
      id: seededItems.secondary,
      scope: "tenant",
      organizationId: secondaryOrganization.id,
      actorDisplayName: secondaryActor,
    });
    for (const id of [
      seededItems.primaryReadOne,
      seededItems.primaryReadTwo,
      seededItems.primaryReadThree,
    ]) {
      await seedItem(client, {
        id,
        scope: "tenant",
        organizationId: identity.organizationId,
        actorDisplayName: primaryActor,
        readAt: new Date().toISOString(),
      });
    }
  } finally {
    client.release();
  }
}

test.beforeAll(async () => {
  const client = await database.sql.connect();
  try {
    await resetFixture(client, email, await hashPassword(password), identity);
    await resetFixture(
      client,
      alternateEmail,
      await hashPassword(alternatePassword),
      alternateIdentity,
    );
    await client.query(
      `insert into organization (id, name, slug, created_at, updated_at)
       values ($1, $2, $3, now(), now())`,
      [
        secondaryOrganization.id,
        secondaryOrganization.name,
        secondaryOrganization.slug,
      ],
    );
    await client.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, $4, now(), now())`,
      [
        secondaryOrganization.memberId,
        secondaryOrganization.id,
        identity.userId,
        secondaryRole,
      ],
    );
    await client.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'viewer', now(), now())`,
      [
        alternatePrimaryMemberId,
        identity.organizationId,
        alternateIdentity.userId,
      ],
    );
  } finally {
    client.release();
  }
  const response = await fetch(
    `http://localhost:${ports.apiPort}/api/auth/sign-in/email`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: `http://localhost:${ports.webPort}`,
      },
      body: JSON.stringify({ email, password }),
    },
  );
  expect(response.status).toBe(200);
});

test.afterAll(async () => {
  try {
    await database.sql.query('delete from "user" where id = any($1::text[])', [
      [identity.userId, alternateIdentity.userId],
    ]);
  } finally {
    try {
      await database.sql.query(
        "delete from organization where id = any($1::uuid[])",
        [
          [
            identity.organizationId,
            secondaryOrganization.id,
            alternateIdentity.organizationId,
          ],
        ],
      );
    } finally {
      await database.close();
    }
  }
});
test.setTimeout(190_000);

async function notificationState() {
  const result = await database.sql.query<{
    dispatchStatus: string | null;
    scopeKind: string | null;
    userId: string | null;
    recipientUserId: string | null;
    occurredAt: string | null;
    expiresAt: string | null;
    readAt: string | null;
  }>(
    `select ledger.status as "dispatchStatus", inbox.scope_kind as "scopeKind",
            inbox.user_id as "userId", inbox.recipient_user_id as "recipientUserId",
            inbox.occurred_at as "occurredAt", inbox.expires_at as "expiresAt",
            inbox.read_at as "readAt"
       from notification_intents as intent
       left join notification_dispatch_ledger as ledger on ledger.intent_id = intent.id
       left join notification_inbox_items as inbox on inbox.intent_id = intent.id
       where intent.user_id = $1`,
    [identity.userId],
  );
  return result.rows;
}

async function browserNotificationState(page: Page) {
  return page.evaluate(async (expectedUserId) => {
    const [session, list, unread] = await Promise.all([
      fetch("/api/auth/get-session").then((response) => response.json()),
      fetch("/api/notifications"),
      fetch("/api/notifications/unread-count"),
    ]);
    return {
      sessionMatchesFixture: session.user?.id === expectedUserId,
      list: { status: list.status, body: await list.json() },
      unread: { status: unread.status, body: await unread.json() },
      unreadBadgeLabels: Array.from(
        document.querySelectorAll('[aria-label$="รายการยังไม่อ่าน"]'),
      ).map((element) => element.getAttribute("aria-label")),
    };
  }, identity.userId);
}

async function browserMeContext(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/me/context");
    return { status: response.status, body: await response.json() };
  });
}

async function expectUnreadBadge(page: Page, unreadCount: number) {
  try {
    await expect(
      page.getByLabel(`${unreadCount} รายการยังไม่อ่าน`),
    ).toBeVisible();
  } catch {
    const inbox = await database.sql.query<{
      id: string;
      scopeKind: string;
      tenantId: string | null;
      userId: string | null;
      readAt: string | null;
      expiresAt: string;
      dispatchStatus: string | null;
    }>(
      `select inbox.id, inbox.scope_kind as "scopeKind",
              inbox.tenant_id as "tenantId", inbox.user_id as "userId",
              inbox.read_at as "readAt", inbox.expires_at as "expiresAt",
              ledger.status as "dispatchStatus"
         from notification_inbox_items as inbox
         left join notification_dispatch_ledger as ledger
           on ledger.intent_id = inbox.intent_id
        where inbox.recipient_user_id = $1
        order by inbox.occurred_at desc, inbox.id desc`,
      [identity.userId],
    );
    throw new Error(
      `scoped unread badge mismatch: ${JSON.stringify({
        browser: await browserNotificationState(page),
        inbox: inbox.rows,
      })}`,
    );
  }
}

async function expectReadStatus(page: Page) {
  const statusValue = page
    .locator("dt", { hasText: /^สถานะ$/ })
    .locator("xpath=following-sibling::dd[1]");
  await expect(statusValue).toHaveText("อ่านแล้ว");
}

async function applyTextZoom(page: Page) {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      ),
    )
    .toBe(32);
}

async function assertVisibleWithoutOverflow(
  page: Page,
  surface: Locator,
  controls: string[],
) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  for (const control of controls) {
    const locator = page.getByRole("button", { name: control });
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  }
  const surfaceBox = await surface.boundingBox();
  expect(surfaceBox).not.toBeNull();
  expect(surfaceBox!.x).toBeGreaterThanOrEqual(0);
  expect(surfaceBox!.x + surfaceBox!.width).toBeLessThanOrEqual(
    viewport!.width,
  );
  if ((await surface.getAttribute("role")) === "dialog") {
    expect(surfaceBox!.y).toBeGreaterThanOrEqual(0);
    expect(surfaceBox!.y + surfaceBox!.height).toBeLessThanOrEqual(
      viewport!.height,
    );
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function attachSurface(
  page: Page,
  testInfo: TestInfo,
  name: string,
  surface: Locator,
  controls: string[],
) {
  await applyTextZoom(page);
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await assertVisibleWithoutOverflow(page, surface, controls);
}

async function assertPopoverListScrollAndFooterFocus(
  page: Page,
  dialog: Locator,
) {
  const list = dialog.locator(":scope > div").nth(1);
  const dimensions = await list.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(
    0,
  );

  const center = dialog.getByRole("link", { name: "ดูการแจ้งเตือนทั้งหมด" });
  const enabledItems = dialog.locator("[data-popover-item]:not([disabled])");
  const enabledItemCount = await enabledItems.count();
  expect(enabledItemCount).toBeGreaterThan(0);
  await expect(
    dialog.locator("[data-popover-item]:not([disabled]):focus"),
  ).toBeVisible();
  for (let step = 0; step < enabledItemCount + 1; step += 1) {
    if (
      await center.evaluate((element) => document.activeElement === element)
    ) {
      break;
    }
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await expect(center).toBeFocused();
}

async function selectTheme(page: Page, theme: "dark" | "light") {
  await page.goto("/settings/display");
  await applyTextZoom(page);
  await page
    .getByRole("button", { name: theme === "dark" ? "มืด" : "สว่าง" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function openNotificationsFromKeyboard(page: Page, bell: Locator) {
  await bell.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "การแจ้งเตือน" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("[data-popover-item]:focus")).toBeVisible();
  const focusStyle = await page
    .locator("[data-popover-item]:focus")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
  expect(focusStyle.outlineStyle).toBe("solid");
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThan(0);
  return dialog;
}

test("password-change notification is materialized, scope switches across organizations, and notification surfaces remain usable at 200% zoom", async ({
  page,
}, testInfo) => {
  const temporary = `${password}-changed`;
  await signIn(page, password);
  await page.goto("/settings/security");
  const card = page.getByRole("region", { name: "รหัสผ่าน" });
  await card.getByLabel("รหัสผ่านปัจจุบัน").fill(password);
  await card.getByLabel("รหัสผ่านใหม่", { exact: true }).fill(temporary);
  await card.getByLabel("ยืนยันรหัสผ่านใหม่").fill(temporary);
  await card.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }).click();
  await expect(card.getByRole("alert")).toContainText("เปลี่ยนรหัสผ่านแล้ว");
  currentPrimaryPassword = temporary;

  const bell = page.getByRole("button", { name: "การแจ้งเตือน" });
  try {
    await expect
      .poll(
        async () => {
          await page.reload();
          await page.waitForTimeout(250);
          return await page.locator('[aria-label$="รายการยังไม่อ่าน"]').count();
        },
        { timeout: 100_000 },
      )
      .toBeGreaterThan(0);
  } catch {
    throw new Error(
      `notification did not materialize after 100 seconds: ${JSON.stringify({
        browser: await browserNotificationState(page),
        inbox: await notificationState(),
      })}`,
    );
  }
  await bell.click();
  await expect(
    page.getByRole("dialog", { name: "การแจ้งเตือน" }),
  ).toContainText("มีการเปลี่ยนรหัสผ่าน");
  await page.keyboard.press("Escape");
  await expect(bell).toBeFocused();
  await bell.click();
  await page
    .getByRole("button", { name: /มีการเปลี่ยนรหัสผ่าน/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expectReadStatus(page);
  await page.reload();
  await expectReadStatus(page);
  await page.getByRole("button", { name: "กลับไปที่การแจ้งเตือน" }).click();

  await seedNotificationFixtures();

  await page.goto("/workspace");
  await page
    .getByRole("button", { name: new RegExp(primaryOrganizationName) })
    .click();
  await page
    .getByRole("menuitemradio", {
      name: new RegExp(secondaryOrganization.name),
    })
    .click();
  await expect
    .poll(() => browserMeContext(page))
    .toMatchObject({
      status: 200,
      body: {
        organizations: expect.arrayContaining([
          expect.objectContaining({
            id: secondaryOrganization.id,
            role: "admin",
          }),
        ]),
        lastActiveTenantId: secondaryOrganization.id,
      },
    });
  await expect(
    page.getByRole("button", { name: new RegExp(secondaryOrganization.name) }),
  ).toContainText("ผู้ดูแล");
  await page.goto(
    `/organizations/${secondaryOrganization.id}/notification-settings`,
  );
  const secondarySetting = page.getByLabel(
    "แจ้งเมื่อมีการเปลี่ยนการตั้งค่าการแจ้งเตือน",
  );
  await expect(secondarySetting).toBeChecked();
  await secondarySetting.uncheck();
  await page.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }).click();
  await page.reload();
  await expect(secondarySetting).not.toBeChecked();
  await secondarySetting.check();
  await page.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }).click();
  await page.reload();
  await expect(secondarySetting).toBeChecked();
  await page.goto("/workspace");
  await expectUnreadBadge(page, 2);
  await bell.click();
  const popover = page.getByRole("dialog", { name: "การแจ้งเตือน" });
  await expect(popover.getByText(secondaryActor)).toBeVisible();
  await expect(popover.getByText(primaryActor)).toHaveCount(0);
  await expect(popover.getByText("มีการเปลี่ยนรหัสผ่าน").first()).toBeVisible();
  await page.keyboard.press("Escape");

  await page
    .getByRole("button", { name: new RegExp(secondaryOrganization.name) })
    .click();
  await page
    .getByRole("menuitemradio", { name: new RegExp(primaryOrganizationName) })
    .click();
  await expectUnreadBadge(page, 2);
  await bell.click();
  await expect(popover.getByText(primaryActor).first()).toBeVisible();
  await expect(popover.getByText(secondaryActor)).toHaveCount(0);
  await expect(popover.getByText("มีการเปลี่ยนรหัสผ่าน").first()).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto(
    `/organizations/${identity.organizationId}/notification-settings`,
  );
  const setting = page.getByLabel(
    "แจ้งเมื่อมีการเปลี่ยนการตั้งค่าการแจ้งเตือน",
  );
  await setting.uncheck();
  await page.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }).click();
  await page.reload();
  await expect(setting).not.toBeChecked();

  await page.setViewportSize({ width: 375, height: 812 });
  for (const theme of ["light", "dark"] as const) {
    await selectTheme(page, theme);

    await page.goto("/workspace");
    await applyTextZoom(page);
    const dialog = await openNotificationsFromKeyboard(page, bell);
    await expect(dialog.getByText(primaryActor).first()).toBeVisible();
    await attachSurface(
      page,
      testInfo,
      `notification-popover-${theme}-375-200`,
      dialog,
      ["ทำเครื่องหมายว่าอ่านทั้งหมด"],
    );
    await assertPopoverListScrollAndFooterFocus(page, dialog);
    await page.getByRole("link", { name: "ดูการแจ้งเตือนทั้งหมด" }).click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByText(primaryActor).first()).toBeVisible();
    await attachSurface(
      page,
      testInfo,
      `notification-center-${theme}-375-200`,
      page.getByRole("main"),
      ["ทำเครื่องหมายว่าอ่านทั้งหมด"],
    );

    await page
      .getByRole("button", { name: new RegExp(primaryActor) })
      .first()
      .click();
    await expectReadStatus(page);
    await attachSurface(
      page,
      testInfo,
      `notification-detail-${theme}-375-200`,
      page.getByRole("main"),
      ["กลับไปที่การแจ้งเตือน"],
    );

    await page.goto(
      `/organizations/${identity.organizationId}/notification-settings`,
    );
    await expect(setting).toBeVisible();
    await attachSurface(
      page,
      testInfo,
      `notification-settings-${theme}-375-200`,
      page.getByRole("main"),
      ["บันทึกการเปลี่ยนแปลง"],
    );
    await expect(setting).not.toBeChecked();
  }
});

test("notification center distinguishes loading, content, empty, denied, and failure from real responses", async ({
  page,
}) => {
  const stateItem = randomUUID();
  let releaseListResponse = () => {};
  const listResponseReleased = new Promise<void>((resolve) => {
    releaseListResponse = resolve;
  });
  let capturedListResponse = false;
  const holdListResponse = async (route: Route) => {
    const response = await route.fetch();
    capturedListResponse = response.status() === 200;
    await listResponseReleased;
    await route.fulfill({ response });
  };
  const abortListRequest = async (route: Route) => {
    await route.abort("failed");
  };

  try {
    const client = await database.sql.connect();
    try {
      await seedItem(client, {
        id: stateItem,
        scope: "tenant",
        organizationId: identity.organizationId,
        actorDisplayName: deferredPrimaryActor,
      });
    } finally {
      client.release();
    }

    await signIn(page, currentPrimaryPassword);
    await page.route("**/api/notifications?*", holdListResponse);
    await page.goto("/notifications");
    await expect.poll(() => capturedListResponse).toBe(true);
    await expect(
      page.getByRole("status").filter({ hasText: "กำลังเปิดหน้า…" }),
    ).toBeVisible();
    await expect(page.getByText("ยังไม่มีการแจ้งเตือน")).toHaveCount(0);

    releaseListResponse();
    await expect(page.getByText(deferredPrimaryActor)).toBeVisible();
    await page.unroute("**/api/notifications?*", holdListResponse);

    const identitySwitch = await page.evaluate(
      async ({
        alternateEmail: nextEmail,
        alternatePassword: nextPassword,
      }) => {
        // This executes in the browser realm, where the Node test's static
        // imports cannot access the application's reactive auth client.
        const { authClient } = await import("/src/lib/auth-client.ts");
        const signedOut = await authClient.signOut();
        if (signedOut.error !== null) return "sign-out";
        const signedIn = await authClient.signIn.email({
          email: nextEmail,
          password: nextPassword,
        });
        return signedIn.error === null ? "ok" : "sign-in";
      },
      { alternateEmail, alternatePassword },
    );
    expect(identitySwitch).toBe("ok");
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const response = await fetch("/api/auth/get-session");
          const body = (await response.json()) as { user?: { id?: string } };
          return { status: response.status, userId: body.user?.id };
        }),
      )
      .toEqual({ status: 200, userId: alternateIdentity.userId });
    await page.goto("/notifications");
    await expect(page.getByText("ยังไม่มีการแจ้งเตือน")).toBeVisible();

    await page.route("**/api/notifications?*", abortListRequest);
    await page.reload();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "โหลดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }),
    ).toBeVisible();
    await expect(page.getByText("ยังไม่มีการแจ้งเตือน")).toHaveCount(0);
    await page.unroute("**/api/notifications?*");

    await page.goto(
      `/organizations/${identity.organizationId}/notification-settings`,
    );
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "คุณไม่มีสิทธิ์จัดการการตั้งค่านี้" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("แจ้งเมื่อมีการเปลี่ยนการตั้งค่าการแจ้งเตือน"),
    ).toHaveCount(0);
  } finally {
    releaseListResponse();
    await page.unroute("**/api/notifications?*", holdListResponse);
    await page.unroute("**/api/notifications?*", abortListRequest);
    await database.sql.query("delete from notification_intents where id = $1", [
      stateItem,
    ]);
  }
});

test("deferred notification responses cannot cross confirmed organization or identity boundaries", async ({
  page,
}) => {
  const deferredPrimaryItem = randomUUID();
  const deferredSecondaryItem = randomUUID();
  let releaseOrganizationResponse = () => {};
  const organizationResponseReleased = new Promise<void>((resolve) => {
    releaseOrganizationResponse = resolve;
  });
  let deferOrganizationResponse = true;
  let organizationResponseCaptured = false;
  let organizationResponseFulfilled = false;
  let organizationRequest: Request | undefined;
  let organizationRequestFailure: string | undefined;
  const onOrganizationRequestFailed = (request: Request) => {
    if (request === organizationRequest) {
      organizationRequestFailure = request.failure()?.errorText ?? "failed";
    }
  };
  const holdOrganizationResponse = async (route: Route) => {
    const response = await route.fetch();
    if (!deferOrganizationResponse) {
      await route.fulfill({ response });
      return;
    }
    deferOrganizationResponse = false;
    organizationRequest = route.request();
    organizationResponseCaptured = response.status() === 200;
    await organizationResponseReleased;
    await route.fulfill({ response });
    organizationResponseFulfilled = true;
  };

  let releaseIdentityResponse = () => {};
  const identityResponseReleased = new Promise<void>((resolve) => {
    releaseIdentityResponse = resolve;
  });
  let deferIdentityResponse = true;
  let identityResponseCaptured = false;
  let identityResponseFulfilled = false;
  let identityRequest: Request | undefined;
  let identityRequestFailure: string | undefined;
  const onIdentityRequestFailed = (request: Request) => {
    if (request === identityRequest) {
      identityRequestFailure = request.failure()?.errorText ?? "failed";
    }
  };
  const holdIdentityResponse = async (route: Route) => {
    const response = await route.fetch();
    if (!deferIdentityResponse) {
      await route.fulfill({ response });
      return;
    }
    deferIdentityResponse = false;
    identityRequest = route.request();
    identityResponseCaptured = response.status() === 200;
    await identityResponseReleased;
    await route.fulfill({ response });
    identityResponseFulfilled = true;
  };

  try {
    const client = await database.sql.connect();
    try {
      await seedItem(client, {
        id: deferredPrimaryItem,
        scope: "tenant",
        organizationId: identity.organizationId,
        actorDisplayName: deferredPrimaryActor,
      });
      await seedItem(client, {
        id: deferredSecondaryItem,
        scope: "tenant",
        organizationId: secondaryOrganization.id,
        actorDisplayName: deferredSecondaryActor,
      });
    } finally {
      client.release();
    }

    await signIn(page, currentPrimaryPassword);
    page.on("requestfailed", onOrganizationRequestFailed);
    await page.route("**/api/notifications?*", holdOrganizationResponse);
    const organizationBell = page.getByRole("button", { name: "การแจ้งเตือน" });
    await organizationBell.click();
    await expect.poll(() => organizationResponseCaptured).toBe(true);
    await page.keyboard.press("Escape");

    await page
      .getByRole("button", { name: new RegExp(primaryOrganizationName) })
      .click();
    await page
      .getByRole("menuitemradio", {
        name: new RegExp(secondaryOrganization.name),
      })
      .click();
    await expect
      .poll(() => browserMeContext(page))
      .toMatchObject({
        status: 200,
        body: { lastActiveTenantId: secondaryOrganization.id },
      });
    await organizationBell.click();
    const organizationPopover = page.getByRole("dialog", {
      name: "การแจ้งเตือน",
    });
    await expect(
      organizationPopover.getByText(deferredSecondaryActor),
    ).toBeVisible();
    await expect(
      organizationPopover.getByText(deferredPrimaryActor),
    ).toHaveCount(0);

    releaseOrganizationResponse();
    await expect
      .poll(
        () =>
          organizationResponseFulfilled ||
          organizationRequestFailure !== undefined,
      )
      .toBe(true);
    await expect(
      organizationPopover.getByText(deferredSecondaryActor),
    ).toBeVisible();
    await expect(
      organizationPopover.getByText(deferredPrimaryActor),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.unroute("**/api/notifications?*", holdOrganizationResponse);
    page.off("requestfailed", onOrganizationRequestFailed);

    await page
      .getByRole("button", { name: new RegExp(secondaryOrganization.name) })
      .click();
    await page
      .getByRole("menuitemradio", { name: new RegExp(primaryOrganizationName) })
      .click();
    await expect
      .poll(() => browserMeContext(page))
      .toMatchObject({
        status: 200,
        body: { lastActiveTenantId: identity.organizationId },
      });
    page.on("requestfailed", onIdentityRequestFailed);
    await page.route("**/api/notifications?*", holdIdentityResponse);
    await organizationBell.click();
    await expect.poll(() => identityResponseCaptured).toBe(true);
    await page.keyboard.press("Escape");

    const identitySwitch = await page.evaluate(
      async ({
        alternateEmail: nextEmail,
        alternatePassword: nextPassword,
      }) => {
        // This executes in the browser realm, where the Node test's static
        // imports cannot access the application's reactive auth client.
        const { authClient } = await import("/src/lib/auth-client.ts");
        const signedOut = await authClient.signOut();
        if (signedOut.error !== null) return "sign-out";
        const signedIn = await authClient.signIn.email({
          email: nextEmail,
          password: nextPassword,
        });
        return signedIn.error === null ? "ok" : "sign-in";
      },
      { alternateEmail, alternatePassword },
    );
    expect(identitySwitch).toBe("ok");
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const response = await fetch("/api/auth/get-session");
          const body = (await response.json()) as { user?: { id?: string } };
          return { status: response.status, userId: body.user?.id };
        }),
      )
      .toEqual({ status: 200, userId: alternateIdentity.userId });
    await page.goto("/workspace");
    await organizationBell.click();
    const identityPopover = page.getByRole("dialog", {
      name: "การแจ้งเตือน",
    });
    await expect(
      identityPopover.getByText("ยังไม่มีการแจ้งเตือน"),
    ).toBeVisible();
    await expect(identityPopover.getByText(deferredPrimaryActor)).toHaveCount(
      0,
    );
    await page.getByRole("link", { name: "ดูการแจ้งเตือนทั้งหมด" }).click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByText("ยังไม่มีการแจ้งเตือน")).toBeVisible();
    await expect(page.getByText(deferredPrimaryActor)).toHaveCount(0);

    releaseIdentityResponse();
    await expect
      .poll(
        () => identityResponseFulfilled || identityRequestFailure !== undefined,
      )
      .toBe(true);
    await expect(page.getByText("ยังไม่มีการแจ้งเตือน")).toBeVisible();
    await expect(page.getByText(deferredPrimaryActor)).toHaveCount(0);
    await page.getByRole("link", { name: "ภาพรวม" }).click();
    await expect(page).toHaveURL(/\/workspace$/);
    await organizationBell.click();
    await expect(
      identityPopover.getByText("ยังไม่มีการแจ้งเตือน"),
    ).toBeVisible();
    await expect(identityPopover.getByText(deferredPrimaryActor)).toHaveCount(
      0,
    );
  } finally {
    releaseOrganizationResponse();
    releaseIdentityResponse();
    if (!page.isClosed()) {
      await page.unroute("**/api/notifications?*", holdOrganizationResponse);
      await page.unroute("**/api/notifications?*", holdIdentityResponse);
    }
    page.off("requestfailed", onOrganizationRequestFailed);
    page.off("requestfailed", onIdentityRequestFailed);
    await database.sql.query(
      "delete from notification_intents where id = any($1::text[])",
      [[deferredPrimaryItem, deferredSecondaryItem]],
    );
  }
});

test("Center reaches an unread twenty-first item and reauthorizes expired or deleted detail on reload", async ({
  page,
}) => {
  const paginationIds = Array.from({ length: 21 }, () => randomUUID());
  const expiredId = randomUUID();
  const deletedId = randomUUID();
  const pageTwoActor = `Unread page two ${randomUUID()}`;
  const expiredActor = `Expired detail ${randomUUID()}`;
  const deletedActor = `Deleted detail ${randomUUID()}`;
  const allIds = [...paginationIds, expiredId, deletedId];

  try {
    const client = await database.sql.connect();
    try {
      for (const [index, id] of paginationIds.entries()) {
        await seedItem(client, {
          id,
          scope: "tenant",
          organizationId: identity.organizationId,
          actorDisplayName: index === 20 ? pageTwoActor : `Read page ${index}`,
          occurredAt: new Date(
            Date.UTC(2090, 0, 1, 0, 0, paginationIds.length - index),
          ).toISOString(),
          readAt: index === 20 ? undefined : new Date().toISOString(),
        });
      }
    } finally {
      client.release();
    }

    await signIn(page, currentPrimaryPassword);
    await page.goto("/notifications");
    const markAll = page.getByRole("button", {
      name: "ทำเครื่องหมายว่าอ่านทั้งหมด",
    });
    await expect(markAll).toBeEnabled();
    await expect(page.getByText(pageTwoActor)).toHaveCount(0);
    const unreadBefore = await page.evaluate(async () => {
      const response = await fetch("/api/notifications/unread-count");
      return {
        status: response.status,
        body: (await response.json()) as { unreadCount: number },
      };
    });
    expect(unreadBefore.status).toBe(200);
    expect(unreadBefore.body.unreadCount).toBeGreaterThanOrEqual(1);
    const marked = page.waitForResponse(
      (response) =>
        response.url().includes("/api/notifications/read-all") &&
        response.request().method() === "POST",
    );
    await markAll.click();
    expect(await (await marked).json()).toEqual(
      expect.objectContaining({ markedCount: unreadBefore.body.unreadCount }),
    );
    const pageTwo = await database.sql.query<{ readAt: string | null }>(
      'select read_at as "readAt" from notification_inbox_items where id = $1',
      [paginationIds[20]],
    );
    expect(pageTwo.rows[0]?.readAt).not.toBeNull();
    await page
      .getByRole("button", { name: "โหลดการแจ้งเตือนเพิ่มเติม" })
      .click();
    await page.getByRole("button", { name: new RegExp(pageTwoActor) }).click();
    await expectReadStatus(page);
    await page.getByRole("button", { name: "กลับไปที่การแจ้งเตือน" }).click();

    const clientForExpiry = await database.sql.connect();
    try {
      await clientForExpiry.query(
        "delete from notification_intents where id = any($1::text[])",
        [paginationIds],
      );
      await seedItem(clientForExpiry, {
        id: expiredId,
        scope: "tenant",
        organizationId: identity.organizationId,
        actorDisplayName: expiredActor,
        occurredAt: "2091-01-01T00:00:00.000Z",
      });
    } finally {
      clientForExpiry.release();
    }
    await page.goto("/workspace");
    const bell = page.getByRole("button", { name: "การแจ้งเตือน" });
    await bell.click();
    const expiredPopover = page.getByRole("dialog", {
      name: "การแจ้งเตือน",
    });
    await expect(expiredPopover.getByText(expiredActor)).toBeVisible();
    const expiredInitialOpen = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/notifications/${expiredId}/open`) &&
        response.request().method() === "POST" &&
        response.status() === 200,
    );
    await expiredPopover
      .getByRole("button", { name: new RegExp(expiredActor) })
      .click();
    await expiredInitialOpen;
    await expect(page).toHaveURL(/\/notifications$/);
    await expectReadStatus(page);
    await expect(
      page.getByRole("heading", {
        name: `การตั้งค่าการแจ้งเตือนเปลี่ยนโดย ${expiredActor}`,
        exact: true,
      }),
    ).toBeVisible();
    await database.sql.query(
      "update notification_inbox_items set expires_at = now() - interval '1 minute' where id = $1",
      [expiredId],
    );
    const expiredOpen = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/notifications/${expiredId}/open`) &&
        response.request().method() === "POST" &&
        response.status() === 404,
    );
    await page.reload();
    await expiredOpen;
    await expect(page.getByText("ไม่พบการแจ้งเตือนนี้")).toBeVisible();
    await expect(page.getByText(expiredActor)).toHaveCount(0);

    const clientForDeletion = await database.sql.connect();
    try {
      await seedItem(clientForDeletion, {
        id: deletedId,
        scope: "tenant",
        organizationId: identity.organizationId,
        actorDisplayName: deletedActor,
        occurredAt: "2092-01-01T00:00:00.000Z",
      });
    } finally {
      clientForDeletion.release();
    }
    await page.goto("/workspace");
    await bell.click();
    const deletedPopover = page.getByRole("dialog", {
      name: "การแจ้งเตือน",
    });
    await expect(deletedPopover.getByText(deletedActor)).toBeVisible();
    const deletedInitialOpen = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/notifications/${deletedId}/open`) &&
        response.request().method() === "POST" &&
        response.status() === 200,
    );
    await deletedPopover
      .getByRole("button", { name: new RegExp(deletedActor) })
      .click();
    await deletedInitialOpen;
    await expect(page).toHaveURL(/\/notifications$/);
    await expectReadStatus(page);
    await expect(
      page.getByRole("heading", {
        name: `การตั้งค่าการแจ้งเตือนเปลี่ยนโดย ${deletedActor}`,
        exact: true,
      }),
    ).toBeVisible();
    await database.sql.query("delete from notification_intents where id = $1", [
      deletedId,
    ]);
    const deletedOpen = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/notifications/${deletedId}/open`) &&
        response.request().method() === "POST" &&
        response.status() === 404,
    );
    await page.reload();
    await deletedOpen;
    await expect(page.getByText("ไม่พบการแจ้งเตือนนี้")).toBeVisible();
    await expect(page.getByText(deletedActor)).toHaveCount(0);
  } finally {
    await database.sql.query(
      "delete from notification_intents where id = any($1::text[])",
      [allIds],
    );
  }
});
