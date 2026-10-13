import { createHmac } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

/**
 * Personal settings (/settings/*).
 *
 * The public cases run everywhere. The credentialed cases need a real
 * database plus a dedicated QA account passed as E2E_EMAIL / E2E_PASSWORD;
 * E2E_REQUIRE_CREDENTIALS=1 makes their absence a module-setup failure.
 * They enable and then disable MFA and change the password and change it
 * back, so never point them at a shared account.
 */

const EMAIL = process.env.E2E_EMAIL?.trim();
const PASSWORD = process.env.E2E_PASSWORD?.trim();
const credentialsRequired = process.env.E2E_REQUIRE_CREDENTIALS === "1";
const credentialed = Boolean(EMAIL && PASSWORD);

if (credentialsRequired && !credentialed) {
  throw new Error(
    "E2E_REQUIRE_CREDENTIALS=1 requires non-empty E2E_EMAIL and E2E_PASSWORD",
  );
}

test.describe("public entry", () => {
  test("anonymous visits bounce to login carrying the intended tab", async ({
    page,
  }) => {
    await page.goto("/settings/sessions");
    await expect(page).toHaveURL(/\/login\?from=%2Fsettings%2Fsessions$/);
  });

  test("anonymous /settings carries the first tab (deepest redirect wins)", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?from=%2Fsettings%2Fprofile$/);
  });
});

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of input.toUpperCase()) {
    const value = alphabet.indexOf(ch);
    if (value >= 0) {
      bits += value.toString(2).padStart(5, "0");
    }
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — what every authenticator app computes. */
function totp(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1]! & 0xf;
  const code =
    (((digest[offset]! & 0x7f) << 24) |
      (digest[offset + 1]! << 16) |
      (digest[offset + 2]! << 8) |
      digest[offset + 3]!) %
    1_000_000;
  return String(code).padStart(6, "0");
}

async function signIn(page: Page, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(EMAIL!);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(
    /\/(?:workspace$|organizations\/[^/]+\/projects(?:\/|$))/,
  );
}

test.describe("signed-in settings", () => {
  test.skip(
    !credentialed,
    "needs E2E_EMAIL and E2E_PASSWORD against a real database",
  );
  test.describe.configure({ mode: "serial" });

  test("every tab has its own URL, the strip marks it, and the shell links there", async ({
    page,
  }) => {
    await signIn(page, PASSWORD!);

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(page.getByTestId("page-title")).toBeVisible();

    let sessionsLabel = "";
    for (const path of [
      "/settings/security",
      "/settings/sessions",
      "/settings/display",
      "/settings/profile",
    ]) {
      const tab = page.getByTestId(`settings-tab-${path}`);
      await tab.click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(tab).toHaveRole("tab");
      if (path === "/settings/sessions") sessionsLabel = await tab.innerText();
    }
    await expect(page.getByTestId("shell-breadcrumb-current")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("shell-breadcrumb-current")).toHaveText(/\S/);
    // Account menu → settings; ⌘K → a tab.
    await page.goto("/workspace");
    await page.getByTestId("shell-account-open").click();
    await page.getByTestId("shell-account-settings").click();
    await expect(page).toHaveURL(/\/settings\/profile$/);

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("shell-command-query").fill(sessionsLabel);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings\/sessions$/);
  });

  test("settings tabs reflow without horizontal or vertical overflow and retain labels, underline, and keyboard focus", async ({
    page,
  }, testInfo) => {
    await signIn(page, PASSWORD!);

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((value) => {
        localStorage.setItem("nightwatch-theme", value);
      }, theme);

      for (const { width, height, scales } of [
        { width: 1440, height: 900, scales: [100, 200] },
        { width: 375, height: 812, scales: [100, 200] },
      ]) {
        await page.setViewportSize({ width, height });
        for (const textScale of scales) {
          for (const route of ["profile", "security", "sessions", "display"]) {
            await page.goto(`/settings/${route}`);
            await page.evaluate((scale) => {
              document.documentElement.style.fontSize = `${scale}%`;
            }, textScale);
            const tablist = page.getByTestId("settings-tabs");
            const activeTab = tablist.getByTestId(
              `settings-tab-/settings/${route}`,
            );
            await expect(activeTab).toBeVisible();
            await expect(activeTab).toHaveRole("tab");
            await expect(activeTab).toHaveAttribute("aria-selected", "true");
            await expect(activeTab).toHaveAccessibleName(/\S/);
            await expect(activeTab).toHaveAttribute("id", /\S/);
            await expect(page.getByTestId("settings-panel")).toHaveAttribute(
              "aria-labelledby",
              (await activeTab.getAttribute("id")) ?? "",
            );
            if (
              route === "profile" ||
              (route === "display" && textScale === 200)
            ) {
              await tablist.screenshot({
                path: testInfo.outputPath(
                  `${route}-${theme}-${width}-${textScale}.png`,
                ),
              });
            }
          }
        }
      }

      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/settings/profile");
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      const firstTab = page.getByTestId("settings-tab-/settings/profile");
      await firstTab.focus();
      await expect(firstTab).toBeFocused();
      for (const path of ["security", "sessions", "display"]) {
        await page.keyboard.press("Tab");
        await expect(
          page.getByTestId(`settings-tab-/settings/${path}`),
        ).toBeFocused();
        if (path === "security")
          await page.getByTestId("settings-tabs").screenshot({
            path: testInfo.outputPath(`${theme}-keyboard-focus-375-200.png`),
          });
      }
    }
  });

  test("MFA can be enabled with a real TOTP and disabled again", async ({
    page,
  }, testInfo) => {
    await signIn(page, PASSWORD!);
    await page.goto("/settings/security");
    const mfa = page.getByTestId("mfa-card");
    await expect(mfa).toHaveRole("region");
    await expect(mfa).toHaveAccessibleName(/\S/);
    await expect(mfa.getByTestId("mfa-status-disabled")).toHaveText(/\S/);

    async function checkStepper(stage: 1 | 2 | 3) {
      const phase = stage === 1 ? "password" : stage === 2 ? "scan" : "verify";
      const stepper = mfa.getByTestId("mfa-enrollment-progress");
      const leftAction = mfa.getByTestId(
        stage === 1
          ? "mfa-enable-cancel"
          : stage === 2
            ? "mfa-scan-back"
            : "mfa-verify-back",
      );
      const rightAction = mfa.getByTestId(
        stage === 1
          ? "mfa-enable-submit"
          : stage === 2
            ? "mfa-scan-next"
            : "mfa-verify-submit",
      );
      for (const theme of ["light", "dark"] as const) {
        await page.evaluate((value) => {
          document.documentElement.setAttribute("data-theme", value);
        }, theme);
        for (const { width, height, scale } of [
          { width: 375, height: 812, scale: 100 },
          { width: 375, height: 812, scale: 200 },
          { width: 1440, height: 900, scale: 200 },
        ]) {
          await page.setViewportSize({ width, height });
          await page.evaluate((value) => {
            document.documentElement.style.fontSize = `${value}%`;
          }, scale);
          await expect(stepper.getByTestId(/^mfa-step-/)).toHaveCount(3);
          for (const step of ["password", "scan", "verify"]) {
            const indicator = stepper.getByTestId(`mfa-step-${step}`);
            await expect(indicator).toHaveRole("listitem");
            await expect(indicator).toHaveText(/\S/);
            if (step === phase)
              await expect(indicator).toHaveAttribute("aria-current", "step");
            else
              await expect(indicator).not.toHaveAttribute(
                "aria-current",
                "step",
              );
          }
          await leftAction.focus();
          await page.keyboard.press("Tab");
          await expect(rightAction).toBeFocused();
          if (scale === 200) {
            await stepper.screenshot({
              path: testInfo.outputPath(
                `mfa-step-${stage}-${theme}-${width}-${scale}.png`,
              ),
            });
            await rightAction.screenshot({
              path: testInfo.outputPath(
                `mfa-actions-${stage}-${theme}-${width}-${scale}.png`,
              ),
            });
          }
        }
      }
    }

    await mfa.getByTestId("mfa-enable-open").click();
    await checkStepper(1);
    await mfa.getByTestId("mfa-enable-password").fill(PASSWORD!);
    await mfa.getByTestId("mfa-enable-submit").click();

    await expect(mfa.getByTestId("mfa-qr")).toBeVisible();
    await expect(mfa.getByTestId("mfa-scan-next")).toBeDisabled();
    const secret = (await mfa.getByTestId("mfa-secret").innerText()).replace(
      /\s+/g,
      "",
    );
    expect(secret.length).toBeGreaterThan(16);
    await mfa.getByTestId("mfa-recovery-acknowledge").check();
    await checkStepper(2);
    await mfa.getByTestId("mfa-scan-next").click();
    await checkStepper(3);

    await mfa.getByTestId("mfa-verify-code").fill("000000");
    await mfa.getByTestId("mfa-verify-submit").click();
    await expect(mfa.getByTestId("mfa-verify-server-error")).toBeVisible();
    await expect(mfa.getByTestId("mfa-status-pending")).toHaveText(/\S/);

    await mfa.getByTestId("mfa-verify-code").fill(totp(secret));
    await mfa.getByTestId("mfa-verify-submit").click();
    await expect(mfa.getByTestId("mfa-status-enabled")).toHaveText(/\S/);

    // Leave the account as we found it.
    await mfa.getByTestId("mfa-disable-open").click();
    await mfa.getByTestId("mfa-disable-password").fill(PASSWORD!);
    await mfa.getByTestId("mfa-disable-submit").click();
    await expect(mfa.getByTestId("mfa-status-disabled")).toHaveText(/\S/);
  });

  test("password change signs other devices out and is reverted", async ({
    page,
    browser,
  }) => {
    const temporary = `${PASSWORD!}-e2e`;
    await signIn(page, PASSWORD!);
    await page.goto("/settings/security");
    const card = page.getByTestId("password-change-section");
    await expect(card).toHaveRole("region");
    await expect(card).toHaveAccessibleName(/\S/);

    await card
      .getByTestId("change-current-password")
      .fill("not-the-password-1!");
    await card.getByTestId("change-new-password").fill(temporary);
    await card.getByTestId("change-confirm-password").fill(temporary);
    await card.getByTestId("password-change-submit").click();
    await expect(card.getByTestId("change-current-password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signIn(otherPage, PASSWORD!);
    await otherPage.goto("/settings/security");
    await expect(
      otherPage.getByTestId("password-change-section"),
    ).toBeVisible();

    await card.getByTestId("change-current-password").fill(PASSWORD!);
    await card.getByTestId("password-change-submit").click();
    await expect(card.getByTestId("password-change-success")).toHaveText(/\S/);

    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login\?from=%2Fsettings%2Fsecurity$/);
    await otherPage.getByTestId("login-email").fill(EMAIL!);
    await otherPage.getByTestId("login-password").fill(PASSWORD!);
    await otherPage.getByTestId("login-submit").click();
    await expect(otherPage.getByTestId("login-auth-error")).toHaveText(/\S/);
    await expect(otherPage).toHaveURL(/\/login/);
    await otherPage.getByTestId("login-password").fill(temporary);
    await otherPage.getByTestId("login-submit").click();
    await expect(otherPage).toHaveURL(/\/settings\/security$/);
    await other.close();

    // Revert from the still-signed-in session.
    await card.getByTestId("change-current-password").fill(temporary);
    await card.getByTestId("change-new-password").fill(PASSWORD!);
    await card.getByTestId("change-confirm-password").fill(PASSWORD!);
    await card.getByTestId("password-change-submit").click();
    await expect(card.getByTestId("password-change-success")).toHaveText(/\S/);
  });
});
