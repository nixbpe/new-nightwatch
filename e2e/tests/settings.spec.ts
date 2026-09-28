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
            const tablist = page.getByRole("tablist", {
              name: "หมวดการตั้งค่า",
            });
            const activeTab = tablist.getByRole("tab", {
              selected: true,
            });
            await expect(activeTab).toBeVisible();

            if (
              route === "profile" ||
              (route === "display" && textScale === 200)
            ) {
              await tablist.locator("..").screenshot({
                path: testInfo.outputPath(
                  `${route}-${theme}-${width}-${textScale}.png`,
                ),
              });
            }

            const geometry = await tablist.evaluate((nav) => {
              const tabs = Array.from(
                nav.querySelectorAll<HTMLElement>('[role="tab"]'),
              );
              const selected = tabs.find(
                (tab) => tab.getAttribute("aria-selected") === "true",
              );
              if (!selected) throw new Error("Selected settings tab missing");
              const wrapper = nav.parentElement;
              if (!wrapper) throw new Error("Settings tab wrapper missing");
              const underline = selected.getBoundingClientRect();
              const hairline = wrapper.getBoundingClientRect();
              const bounds = nav.getBoundingClientRect();
              return {
                pageWidth: document.documentElement.scrollWidth,
                viewportWidth: window.innerWidth,
                scrollWidth: nav.scrollWidth,
                clientWidth: nav.clientWidth,
                scrollHeight: nav.scrollHeight,
                clientHeight: nav.clientHeight,
                tabs: tabs.map((tab) => ({
                  label: tab.textContent?.trim(),
                  selected: tab.getAttribute("aria-selected"),
                  left: tab.getBoundingClientRect().left,
                  right: tab.getBoundingClientRect().right,
                  bottom: tab.getBoundingClientRect().bottom,
                })),
                navLeft: bounds.left,
                navRight: bounds.right,
                underlineWidth: getComputedStyle(selected).borderBottomWidth,
                hairlineWidth: getComputedStyle(wrapper).borderBottomWidth,
                underlineBottom: underline.bottom,
                hairlineBottom: hairline.bottom,
              };
            });
            if (route === "profile") {
              console.log(
                `settings geometry ${theme} ${width}x${height} ${textScale}% ` +
                  JSON.stringify({
                    page: [geometry.pageWidth, geometry.viewportWidth],
                    nav: [geometry.scrollWidth, geometry.clientWidth],
                    vertical: [geometry.scrollHeight, geometry.clientHeight],
                  }),
              );
            }
            expect(
              geometry.pageWidth,
              `${theme} ${route} page width`,
            ).toBeLessThanOrEqual(geometry.viewportWidth);
            expect(
              geometry.scrollWidth,
              `${theme} ${route} nav width`,
            ).toBeLessThanOrEqual(geometry.clientWidth);
            expect(geometry.tabs.map((tab) => tab.label)).toEqual([
              "โปรไฟล์",
              "ความปลอดภัย",
              "เซสชันและอุปกรณ์",
              "การแสดงผล",
            ]);
            expect(
              geometry.tabs.filter((tab) => tab.selected === "true"),
            ).toHaveLength(1);
            for (const tab of geometry.tabs) {
              expect(tab.left).toBeGreaterThanOrEqual(geometry.navLeft);
              expect(tab.right).toBeLessThanOrEqual(geometry.navRight);
              expect(tab.bottom).toBeLessThanOrEqual(geometry.hairlineBottom);
            }
            expect
              .soft(
                geometry.scrollHeight,
                `${theme} /settings/${route} ${width}x${height} ${textScale}%`,
              )
              .toBe(geometry.clientHeight);
            expect(geometry.underlineWidth).toBe("2px");
            expect(geometry.hairlineWidth).toBe("1px");
            expect(geometry.underlineBottom).toBeLessThanOrEqual(
              geometry.hairlineBottom,
            );
            if (textScale === 200 && route === "display") {
              expect(geometry.underlineBottom).toBe(geometry.hairlineBottom);
            }
            if (textScale === 200 && route === "profile") {
              expect(geometry.underlineBottom).toBeLessThan(
                geometry.hairlineBottom,
              );
            }
          }
        }
      }

      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/settings/profile");
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      const firstTab = page.getByRole("tab", { name: "โปรไฟล์" });
      await firstTab.focus();
      await expect(firstTab).toBeFocused();
      for (const [index, label] of [
        "ความปลอดภัย",
        "เซสชันและอุปกรณ์",
        "การแสดงผล",
      ].entries()) {
        await page.keyboard.press("Tab");
        const focusedTab = page.getByRole("tab", { name: label });
        await expect(focusedTab).toBeFocused();
        const focus = await focusedTab.evaluate((tab) => {
          const style = getComputedStyle(tab);
          const rect = tab.getBoundingClientRect();
          return {
            style: style.outlineStyle,
            width: style.outlineWidth,
            left: rect.left,
            right: rect.right,
            viewportWidth: window.innerWidth,
          };
        });
        expect(focus.style).not.toBe("none");
        expect(Number.parseFloat(focus.width)).toBeGreaterThanOrEqual(2);
        expect(focus.left).toBeGreaterThan(4);
        expect(focus.right).toBeLessThan(focus.viewportWidth - 4);
        if (index === 0) {
          await page
            .getByRole("tablist", { name: "หมวดการตั้งค่า" })
            .locator("..")
            .screenshot({
              path: testInfo.outputPath(`${theme}-keyboard-focus-375-200.png`),
            });
        }
      }
    }
  });

  test("MFA can be enabled with a real TOTP and disabled again", async ({
    page,
  }, testInfo) => {
    await signIn(page, PASSWORD!);
    await page.goto("/settings/security");
    const mfa = page.getByRole("region", { name: "ยืนยันสองขั้นตอน (MFA)" });
    await expect(mfa.getByText("ปิดอยู่", { exact: true })).toBeVisible();

    async function checkStepper(stage: number) {
      const stepper = mfa.locator('ol[aria-label="ขั้นตอนการเปิดใช้งาน"]');
      const labels = [
        "ยืนยันรหัสผ่าน",
        "สแกนและเก็บรหัสกู้คืน",
        "ยืนยันรหัสแรก",
      ];
      const leftAction = mfa.getByRole("button", {
        name: stage === 1 ? "ยกเลิก" : "ย้อนกลับ",
      });
      const rightAction = mfa.getByRole("button", {
        name:
          stage === 1
            ? /ถัดไป: สแกนคิวอาร์โค้ด/
            : stage === 2
              ? /ถัดไป: ยืนยันรหัสแรก/
              : /ยืนยันและเปิดใช้งาน/,
      });
      const footer = rightAction.locator("..");
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
          const geometry = await stepper.evaluate((list) => {
            const steps = Array.from(list.querySelectorAll("li"));
            const bounds = list.getBoundingClientRect();
            return {
              page: [document.documentElement.scrollWidth, window.innerWidth],
              list: [list.scrollWidth, list.clientWidth],
              labels: steps.map((step) => step.textContent?.trim()),
              active: steps.findIndex(
                (step) => step.getAttribute("aria-current") === "step",
              ),
              withinBounds: steps.every((step) => {
                const rect = step.getBoundingClientRect();
                const label = step
                  .querySelectorAll("span")[1]
                  ?.getBoundingClientRect();
                return (
                  rect.left >= bounds.left &&
                  rect.right <= bounds.right &&
                  label !== undefined &&
                  label.left >= rect.left &&
                  label.right <= rect.right
                );
              }),
            };
          });
          const actions = await footer.evaluate((container) => {
            const bounds = container.getBoundingClientRect();
            const card = container.closest("section");
            if (!card) throw new Error("MFA card missing");
            const buttons = Array.from(container.querySelectorAll("button"));
            return {
              card: [card.scrollWidth, card.clientWidth],
              footer: [container.scrollWidth, container.clientWidth],
              buttons: buttons.map((button) => {
                const rect = button.getBoundingClientRect();
                return {
                  left: rect.left,
                  right: rect.right,
                  withinBounds:
                    rect.left >= bounds.left &&
                    rect.right <= bounds.right &&
                    rect.left >= 0 &&
                    rect.right <= window.innerWidth,
                };
              }),
            };
          });
          console.log(
            `MFA step ${stage} ${theme} ${width}x${height} ${scale}% ` +
              JSON.stringify({
                page: geometry.page,
                list: geometry.list,
                card: actions.card,
                footer: actions.footer,
                buttons: actions.buttons.map(({ left, right }) => [
                  left,
                  right,
                ]),
              }),
          );
          expect(geometry.page[0]).toBeLessThanOrEqual(geometry.page[1]);
          expect(geometry.list[0]).toBeLessThanOrEqual(geometry.list[1]);
          expect(geometry.labels).toHaveLength(3);
          for (const [index, label] of labels.entries()) {
            expect(geometry.labels[index]).toContain(label);
          }
          expect(geometry.active).toBe(stage - 1);
          expect(geometry.withinBounds).toBe(true);
          expect(actions.card[0]).toBeLessThanOrEqual(actions.card[1]);
          expect(actions.footer[0]).toBeLessThanOrEqual(actions.footer[1]);
          expect(actions.buttons).toHaveLength(2);
          expect(actions.buttons.every((button) => button.withinBounds)).toBe(
            true,
          );
          await leftAction.focus();
          await page.keyboard.press("Tab");
          await expect(rightAction).toBeFocused();
          const focus = await rightAction.evaluate((button) => {
            const style = getComputedStyle(button);
            const bounds = button.getBoundingClientRect();
            return {
              style: style.outlineStyle,
              width: Number.parseFloat(style.outlineWidth),
              visible: bounds.top >= 0 && bounds.bottom <= window.innerHeight,
            };
          });
          expect(focus.style).not.toBe("none");
          expect(focus.width).toBeGreaterThanOrEqual(2);
          expect(focus.visible).toBe(true);
          if (scale === 200) {
            // Only the indicator: QR and recovery codes must not enter artifacts.
            await stepper.screenshot({
              path: testInfo.outputPath(
                `mfa-step-${stage}-${theme}-${width}-${scale}.png`,
              ),
            });
            await footer.screenshot({
              path: testInfo.outputPath(
                `mfa-actions-${stage}-${theme}-${width}-${scale}.png`,
              ),
            });
          }
        }
      }
    }

    await mfa.getByRole("button", { name: "เปิดใช้งาน", exact: true }).click();
    await checkStepper(1);
    await mfa.getByLabel("รหัสผ่านปัจจุบัน").fill(PASSWORD!);
    await mfa.getByRole("button", { name: /ถัดไป: สแกนคิวอาร์โค้ด/ }).click();

    await expect(
      mfa.getByRole("img", { name: "คิวอาร์โค้ดสำหรับแอปยืนยันตัวตน" }),
    ).toBeVisible();
    await expect(
      mfa.getByRole("button", { name: /ถัดไป: ยืนยันรหัสแรก/ }),
    ).toBeDisabled();
    const secret = (await mfa.locator("code").first().innerText()).replace(
      /\s+/g,
      "",
    );
    expect(secret.length).toBeGreaterThan(16);
    await mfa.getByRole("checkbox").check();
    await checkStepper(2);
    await mfa.getByRole("button", { name: /ถัดไป: ยืนยันรหัสแรก/ }).click();
    await checkStepper(3);

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
