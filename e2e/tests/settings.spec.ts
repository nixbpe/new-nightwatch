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
  await page.getByLabel("อีเมล").fill(EMAIL!);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL(/\/workspace/);
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
    await expect(
      page.getByRole("heading", { name: "การตั้งค่าส่วนตัว" }),
    ).toBeVisible();

    for (const [label, path] of [
      ["ความปลอดภัย", "/settings/security"],
      ["เซสชันและอุปกรณ์", "/settings/sessions"],
      ["การแสดงผล", "/settings/display"],
      ["โปรไฟล์", "/settings/profile"],
    ] as const) {
      await page.getByRole("tab", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("tab", { name: label })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }

    // Breadcrumb is rooted at the organization and names the settings page.
    await expect(
      page.getByRole("navigation", { name: "ตำแหน่งปัจจุบัน" }),
    ).toContainText("การตั้งค่าส่วนตัว");

    // Account menu → settings; ⌘K → a tab.
    await page.goto("/workspace");
    await page.getByRole("button", { name: "เมนูบัญชีผู้ใช้" }).click();
    await page.getByRole("menuitem", { name: "การตั้งค่าส่วนตัว" }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox", { name: "ค้นหาทั้งหมด" }).fill("เซสชัน");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings\/sessions$/);
  });

  test("MFA can be enabled with a real TOTP and disabled again", async ({
    page,
  }) => {
    await signIn(page, PASSWORD!);
    await page.goto("/settings/security");
    const mfa = page.getByRole("region", { name: "ยืนยันสองขั้นตอน (MFA)" });
    await expect(mfa.getByText("ปิดอยู่", { exact: true })).toBeVisible();

    await mfa.getByRole("button", { name: "เปิดใช้งาน", exact: true }).click();
    await mfa.getByLabel("รหัสผ่านปัจจุบัน").fill(PASSWORD!);
    await mfa.getByRole("button", { name: /ถัดไป: สแกนคิวอาร์โค้ด/ }).click();

    await expect(
      mfa.getByRole("img", { name: "คิวอาร์โค้ดสำหรับแอปยืนยันตัวตน" }),
    ).toBeVisible();
    const secret = (await mfa.locator("code").first().innerText()).replace(
      /\s+/g,
      "",
    );
    expect(secret.length).toBeGreaterThan(16);
    await mfa.getByRole("checkbox").check();
    await mfa.getByRole("button", { name: /ถัดไป: ยืนยันรหัสแรก/ }).click();

    await mfa.locator('input[name="first-totp"]').fill("000000");
    await mfa.getByRole("button", { name: /ยืนยันและเปิดใช้งาน/ }).click();
    await expect(mfa.getByRole("alert")).toBeVisible();
    await expect(mfa.getByText("กำลังตั้งค่า")).toBeVisible();

    await mfa.locator('input[name="first-totp"]').fill(totp(secret));
    await mfa.getByRole("button", { name: /ยืนยันและเปิดใช้งาน/ }).click();
    await expect(mfa.getByText("เปิดอยู่", { exact: true })).toBeVisible();

    // Leave the account as we found it.
    await mfa.getByRole("button", { name: "ปิดใช้งาน", exact: true }).click();
    await mfa
      .getByLabel("ยืนยันรหัสผ่านปัจจุบันเพื่อปิดใช้งาน")
      .fill(PASSWORD!);
    await mfa
      .getByRole("button", { name: "ปิดใช้งานยืนยันสองขั้นตอน" })
      .click();
    await expect(mfa.getByText("ปิดอยู่", { exact: true })).toBeVisible();
  });

  test("password change signs other devices out and is reverted", async ({
    page,
    browser,
  }) => {
    const temporary = `${PASSWORD!}-e2e`;
    await signIn(page, PASSWORD!);
    await page.goto("/settings/security");
    const card = page.getByRole("region", { name: "รหัสผ่าน" });

    await card.getByLabel("รหัสผ่านปัจจุบัน").fill("not-the-password-1!");
    await card.getByLabel("รหัสผ่านใหม่", { exact: true }).fill(temporary);
    await card.getByLabel("ยืนยันรหัสผ่านใหม่").fill(temporary);
    await card.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }).click();
    await expect(card.getByLabel("รหัสผ่านปัจจุบัน")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    await card.getByLabel("รหัสผ่านปัจจุบัน").fill(PASSWORD!);
    await card.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }).click();
    await expect(card.getByRole("alert")).toContainText("เปลี่ยนรหัสผ่านแล้ว");

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto("/login");
    await otherPage.getByLabel("อีเมล").fill(EMAIL!);
    await otherPage.locator("#login-password").fill(PASSWORD!);
    await otherPage.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await expect(otherPage).toHaveURL(/\/login/);
    await otherPage.locator("#login-password").fill(temporary);
    await otherPage.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await expect(otherPage).toHaveURL(/\/workspace/);
    await other.close();

    // Revert from the still-signed-in session.
    await card.getByLabel("รหัสผ่านปัจจุบัน").fill(temporary);
    await card.getByLabel("รหัสผ่านใหม่", { exact: true }).fill(PASSWORD!);
    await card.getByLabel("ยืนยันรหัสผ่านใหม่").fill(PASSWORD!);
    await card.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }).click();
    await expect(card.getByRole("alert")).toContainText("เปลี่ยนรหัสผ่านแล้ว");
  });
});
