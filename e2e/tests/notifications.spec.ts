import { notificationListResponseSchema } from "../../packages/api-contract/src/index.ts";
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
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(value);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(
    /\/(?:workspace$|organizations\/[^/]+\/projects(?:\/|$))/,
  );
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
  const state = await page.evaluate(async (expectedUserId) => {
    const [session, list, unread] = await Promise.all([
      fetch("/api/auth/get-session").then((response) => response.json()),
      fetch("/api/notifications"),
      fetch("/api/notifications/unread-count"),
    ]);
    return {
      sessionMatchesFixture: session.user?.id === expectedUserId,
      list: { status: list.status, body: await list.json() },
      unread: { status: unread.status, body: await unread.json() },
    };
  }, identity.userId);
  return {
    ...state,
    unreadBadgeLabels: await page
      .getByTestId("shell-notifications-unread-count")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("aria-label")),
      ),
  };
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
      page.getByTestId("shell-notifications-unread-count"),
    ).toHaveText(String(unreadCount));
    await expect(
      page.getByTestId("shell-notifications-unread-count"),
    ).toHaveAttribute("aria-label", new RegExp(`\\b${String(unreadCount)}\\b`));
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
  await expect(page.getByTestId("notification-detail-read")).toHaveText(/\S/);
  await expect(page.getByTestId("notification-detail-unread")).toHaveCount(0);
  await expect(page.getByTestId("notification-detail-read-at")).toHaveAttribute(
    "datetime",
    /\S/,
  );
}

async function notificationList(page: Page) {
  const reply = await page.evaluate(async () => {
    const response = await fetch("/api/notifications");
    return { status: response.status, body: await response.json() };
  });
  expect(reply.status).toBe(200);
  return notificationListResponseSchema.parse(reply.body);
}

async function applyTextZoom(page: Page) {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
}

async function attachSurface(
  page: Page,
  testInfo: TestInfo,
  name: string,
  surface: Locator,
) {
  await applyTextZoom(page);
  await expect(surface).toBeVisible();
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
}

async function assertPopoverListScrollAndFooterFocus(
  page: Page,
  dialog: Locator,
) {
  const center = dialog.getByTestId("shell-notifications-all");
  const enabledItemCount = await dialog.evaluate(
    (element) =>
      Array.from(element.querySelectorAll("[data-popover-item]")).filter(
        (control) =>
          !(control instanceof HTMLButtonElement) || !control.disabled,
      ).length,
  );
  expect(enabledItemCount).toBeGreaterThan(0);
  expect(
    await page.evaluate(() =>
      document.activeElement?.hasAttribute("data-popover-item"),
    ),
  ).toBe(true);
  for (let step = 0; step < enabledItemCount + 1; step += 1) {
    if (await center.evaluate((element) => document.activeElement === element))
      break;
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
  await page.getByTestId(`display-theme-${theme}`).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function openNotificationsFromKeyboard(page: Page, bell: Locator) {
  await bell.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByTestId("shell-notifications-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveRole("dialog");
  await expect(dialog).toHaveAccessibleName(/\S/);
  expect(
    await page.evaluate(() =>
      document.activeElement?.hasAttribute("data-popover-item"),
    ),
  ).toBe(true);
  return dialog;
}

test("password-change notification is materialized, scope switches across organizations, and notification surfaces remain usable at 200% zoom", async ({
  page,
}, testInfo) => {
  const temporary = `${password}-changed`;
  await signIn(page, password);
  await page.goto("/settings/security");
  const card = page.getByTestId("password-change-section");
  await expect(card).toHaveRole("region");
  await expect(card).toHaveAccessibleName(/\S/);
  await card.getByTestId("change-current-password").fill(password);
  await card.getByTestId("change-new-password").fill(temporary);
  await card.getByTestId("change-confirm-password").fill(temporary);
  await card.getByTestId("password-change-submit").click();
  await expect(card.getByTestId("password-change-success")).toHaveText(/\S/);
  currentPrimaryPassword = temporary;

  const bell = page.getByTestId("shell-notifications-open");
  let passwordItemId = "";
  try {
    await expect
      .poll(
        async () => {
          await page.reload();
          await page.waitForTimeout(250);
          const list = await notificationList(page);
          const item = list.items.find(
            (item) =>
              item.scope === "account" && item.eventType === "PASSWORD_CHANGED",
          );
          passwordItemId = item?.id ?? "";
          return (
            item !== undefined &&
            (await page
              .getByTestId("shell-notifications-unread-count")
              .count()) > 0
          );
        },
        { timeout: 100_000 },
      )
      .toBe(true);
  } catch {
    throw new Error(
      `notification did not materialize after 100 seconds: ${JSON.stringify({
        browser: await browserNotificationState(page),
        inbox: await notificationState(),
      })}`,
    );
  }
  await bell.click();
  await expect(page.getByTestId("shell-notifications-dialog")).toBeVisible();
  await expect(
    page
      .getByTestId("shell-notifications-dialog")
      .getByTestId(`notification-row-${passwordItemId}`),
  ).toHaveAttribute("data-event-type", "PASSWORD_CHANGED");
  await expect(
    page
      .getByTestId("shell-notifications-dialog")
      .getByTestId(`notification-row-${passwordItemId}`)
      .getByTestId("notification-title"),
  ).toHaveText(/\S/);
  await page.keyboard.press("Escape");
  await expect(bell).toBeFocused();
  await bell.click();
  await page
    .getByTestId("shell-notifications-dialog")
    .getByTestId(`notification-open-${passwordItemId}`)
    .click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expectReadStatus(page);
  await page.reload();
  await expectReadStatus(page);
  await page.getByTestId("notifications-back").click();

  await seedNotificationFixtures();

  await page.goto("/workspace");
  await page.getByTestId("shell-organization-switch").click();
  await page
    .getByTestId("shell-organization-menu")
    .getByTestId(`shell-organization-${secondaryOrganization.id}`)
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
  await expect(page.getByTestId("shell-organization-switch")).toBeVisible();
  await expect(page.getByTestId("shell-organization-role-admin")).toHaveText(
    /\S/,
  );
  await page.goto(
    `/organizations/${secondaryOrganization.id}/notification-settings`,
  );
  const secondarySetting = page.getByTestId(
    "organization-notifications-settings-changed",
  );
  await expect(secondarySetting).toBeChecked();
  await secondarySetting.uncheck();
  await page.getByTestId("organization-notifications-save").click();
  await page.reload();
  await expect(secondarySetting).not.toBeChecked();
  await secondarySetting.check();
  await page.getByTestId("organization-notifications-save").click();
  await page.reload();
  await expect(secondarySetting).toBeChecked();
  await page.goto("/workspace");
  await expectUnreadBadge(page, 2);
  await bell.click();
  const popover = page.getByTestId("shell-notifications-dialog");
  await expect(
    popover.getByTestId(`notification-row-${seededItems.secondary}`),
  ).toContainText(secondaryActor);
  await expect(
    popover.getByTestId(`notification-row-${seededItems.primary}`),
  ).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.body.textContent))
    .not.toContain(primaryActor);
  await expect(
    popover.getByTestId(`notification-row-${seededItems.personal}`),
  ).toHaveAttribute("data-event-type", "PASSWORD_CHANGED");
  await expect(
    popover
      .getByTestId(`notification-row-${seededItems.personal}`)
      .getByTestId("notification-title"),
  ).toHaveText(/\S/);
  await page.keyboard.press("Escape");

  await page.getByTestId("shell-organization-switch").click();
  await page
    .getByTestId("shell-organization-menu")
    .getByTestId(`shell-organization-${identity.organizationId}`)
    .click();
  await expectUnreadBadge(page, 2);
  await bell.click();
  await expect(
    popover.getByTestId(`notification-row-${seededItems.primary}`),
  ).toContainText(primaryActor);
  await expect(
    popover.getByTestId(`notification-row-${seededItems.secondary}`),
  ).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.body.textContent))
    .not.toContain(secondaryActor);
  await expect(
    popover.getByTestId(`notification-row-${seededItems.personal}`),
  ).toHaveAttribute("data-event-type", "PASSWORD_CHANGED");
  await expect(
    popover
      .getByTestId(`notification-row-${seededItems.personal}`)
      .getByTestId("notification-title"),
  ).toHaveText(/\S/);
  await page.keyboard.press("Escape");

  await page.goto(
    `/organizations/${identity.organizationId}/notification-settings`,
  );
  const setting = page.getByTestId(
    "organization-notifications-settings-changed",
  );
  await setting.uncheck();
  await page.getByTestId("organization-notifications-save").click();
  await page.reload();
  await expect(setting).not.toBeChecked();

  await page.setViewportSize({ width: 375, height: 812 });
  for (const theme of ["light", "dark"] as const) {
    await selectTheme(page, theme);

    await page.goto("/workspace");
    await applyTextZoom(page);
    const dialog = await openNotificationsFromKeyboard(page, bell);
    await expect(
      dialog.getByTestId(`notification-row-${seededItems.primary}`),
    ).toContainText(primaryActor);
    await attachSurface(
      page,
      testInfo,
      `notification-popover-${theme}-375-200`,
      dialog,
    );
    await assertPopoverListScrollAndFooterFocus(page, dialog);
    await page.getByTestId("shell-notifications-all").click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(
      page.getByTestId(`notification-row-${seededItems.primary}`),
    ).toContainText(primaryActor);
    await attachSurface(
      page,
      testInfo,
      `notification-center-${theme}-375-200`,
      page.getByTestId("shell-main"),
    );

    await page.getByTestId(`notification-open-${seededItems.primary}`).click();
    await expectReadStatus(page);
    await attachSurface(
      page,
      testInfo,
      `notification-detail-${theme}-375-200`,
      page.getByTestId("shell-main"),
    );

    await page.goto(
      `/organizations/${identity.organizationId}/notification-settings`,
    );
    await expect(setting).toBeVisible();
    await attachSurface(
      page,
      testInfo,
      `notification-settings-${theme}-375-200`,
      page.getByTestId("shell-main"),
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
    await expect(page.getByTestId("route-opening-status")).toHaveText(/\S/);
    await expect(page.getByTestId("notifications-empty")).toHaveCount(0);

    releaseListResponse();
    await expect(
      page.getByTestId(`notification-row-${stateItem}`),
    ).toContainText(deferredPrimaryActor);
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
    await expect(page.getByTestId("notifications-empty")).toHaveText(/\S/);

    await page.route("**/api/notifications?*", abortListRequest);
    await page.reload();
    await expect(page.getByTestId("notifications-list-error")).toHaveText(/\S/);
    await expect(page.getByTestId("notifications-empty")).toHaveCount(0);
    await page.unroute("**/api/notifications?*");

    await page.goto(
      `/organizations/${identity.organizationId}/notification-settings`,
    );
    await expect(
      page.getByTestId("organization-notifications-denied-alert"),
    ).toHaveText(/\S/);
    await expect(
      page.getByTestId("organization-notifications-settings-changed"),
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
    const organizationBell = page.getByTestId("shell-notifications-open");
    await organizationBell.click();
    await expect.poll(() => organizationResponseCaptured).toBe(true);
    await page.keyboard.press("Escape");

    await page.getByTestId("shell-organization-switch").click();
    await page
      .getByTestId("shell-organization-menu")
      .getByTestId(`shell-organization-${secondaryOrganization.id}`)
      .click();
    await expect
      .poll(() => browserMeContext(page))
      .toMatchObject({
        status: 200,
        body: { lastActiveTenantId: secondaryOrganization.id },
      });
    await organizationBell.click();
    const organizationPopover = page.getByTestId("shell-notifications-dialog");
    await expect(
      organizationPopover.getByTestId(
        `notification-row-${deferredSecondaryItem}`,
      ),
    ).toContainText(deferredSecondaryActor);
    await expect(
      organizationPopover.getByTestId(
        `notification-row-${deferredPrimaryItem}`,
      ),
    ).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(deferredPrimaryActor);

    releaseOrganizationResponse();
    await expect
      .poll(
        () =>
          organizationResponseFulfilled ||
          organizationRequestFailure !== undefined,
      )
      .toBe(true);
    await expect(
      organizationPopover.getByTestId(
        `notification-row-${deferredSecondaryItem}`,
      ),
    ).toContainText(deferredSecondaryActor);
    await expect(
      organizationPopover.getByTestId(
        `notification-row-${deferredPrimaryItem}`,
      ),
    ).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(deferredPrimaryActor);
    await page.keyboard.press("Escape");
    await page.unroute("**/api/notifications?*", holdOrganizationResponse);
    page.off("requestfailed", onOrganizationRequestFailed);

    await page.getByTestId("shell-organization-switch").click();
    await page
      .getByTestId("shell-organization-menu")
      .getByTestId(`shell-organization-${identity.organizationId}`)
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
    const identityPopover = page.getByTestId("shell-notifications-dialog");
    await expect(
      identityPopover.getByTestId("shell-notifications-empty"),
    ).toHaveText(/\S/);
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(deferredPrimaryActor);
    await page.getByTestId("shell-notifications-all").click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByTestId("notifications-empty")).toHaveText(/\S/);
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(deferredPrimaryActor);

    releaseIdentityResponse();
    await expect
      .poll(
        () => identityResponseFulfilled || identityRequestFailure !== undefined,
      )
      .toBe(true);
    await expect(page.getByTestId("notifications-empty")).toHaveText(/\S/);
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(deferredPrimaryActor);
    await page
      .getByTestId("shell-nav-/organizations/:organizationId/projects")
      .click();
    await expect(page).toHaveURL(
      `/organizations/${alternateIdentity.organizationId}/projects`,
    );
    await organizationBell.click();
    await expect(
      identityPopover.getByTestId("shell-notifications-empty"),
    ).toHaveText(/\S/);
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(deferredPrimaryActor);
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
    const markAll = page.getByTestId("notifications-mark-all");
    await expect(markAll).toBeEnabled();
    await expect(
      page.getByTestId(`notification-row-${paginationIds[20]}`),
    ).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(pageTwoActor);
    const unreadBefore = await page.evaluate(async () => {
      const response = await fetch("/api/notifications/unread-count");
      return {
        status: response.status,
        body: (await response.json()) as { unreadCount: number },
      };
    });
    expect(unreadBefore.status).toBe(200);
    expect(unreadBefore.body.unreadCount).toBeGreaterThanOrEqual(1);
    await page.route(
      "**/api/notifications?*",
      async (route) => {
        const hasCursor = new URL(route.request().url()).searchParams.has(
          "cursor",
        );
        await new Promise((resolve) =>
          setTimeout(resolve, hasCursor ? 2_000 : 1_000),
        );
        await route.continue();
      },
      { times: 2 },
    );
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
    await expect(page.getByTestId("notifications-mark-all-success")).toHaveText(
      /\S/,
    );
    await expect(page.getByTestId("notifications-mark-all-success")).toHaveRole(
      "status",
    );
    await expect(page.getByTestId("notifications-mark-all")).toBeDisabled();
    await page.getByTestId("notifications-load-more").click();
    await page.getByTestId(`notification-open-${paginationIds[20]}`).click();
    await expectReadStatus(page);
    await page.getByTestId("notifications-back").click();

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
    const bell = page.getByTestId("shell-notifications-open");
    await bell.click();
    const expiredPopover = page.getByTestId("shell-notifications-dialog");
    await expect(
      expiredPopover.getByTestId(`notification-row-${expiredId}`),
    ).toContainText(expiredActor);
    const expiredInitialOpen = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/notifications/${expiredId}/open`) &&
        response.request().method() === "POST" &&
        response.status() === 200,
    );
    await expiredPopover.getByTestId(`notification-open-${expiredId}`).click();
    await expiredInitialOpen;
    await expect(page).toHaveURL(/\/notifications$/);
    await expectReadStatus(page);
    await expect(
      page.getByTestId(`notification-detail-${expiredId}`),
    ).toContainText(expiredActor);
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
    await expect(page.getByTestId("notification-detail-error")).toHaveText(
      /\S/,
    );
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(expiredActor);

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
    const deletedPopover = page.getByTestId("shell-notifications-dialog");
    await expect(
      deletedPopover.getByTestId(`notification-row-${deletedId}`),
    ).toContainText(deletedActor);
    const deletedInitialOpen = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/notifications/${deletedId}/open`) &&
        response.request().method() === "POST" &&
        response.status() === 200,
    );
    await deletedPopover.getByTestId(`notification-open-${deletedId}`).click();
    await deletedInitialOpen;
    await expect(page).toHaveURL(/\/notifications$/);
    await expectReadStatus(page);
    await expect(
      page.getByTestId(`notification-detail-${deletedId}`),
    ).toContainText(deletedActor);
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
    await expect(page.getByTestId("notification-detail-error")).toHaveText(
      /\S/,
    );
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(deletedActor);
  } finally {
    await database.sql.query(
      "delete from notification_intents where id = any($1::text[])",
      [allIds],
    );
  }
});
