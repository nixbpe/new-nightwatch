import { expect, test } from "@playwright/test";

test.describe("public auth entry", () => {
  test("login page renders the email/password form in Thai", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "เข้าสู่ระบบ NightWatch" }),
    ).toBeVisible();
    await expect(page.getByLabel("อีเมล")).toBeVisible();
    await expect(page.getByLabel("รหัสผ่าน")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "เข้าสู่ระบบ" }),
    ).toBeVisible();
  });

  test("forgot-password page is reachable from login", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "ลืมรหัสผ่าน" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(
      page.getByRole("heading", { name: "ลืมรหัสผ่าน" }),
    ).toBeVisible();
  });

  test("an invalid invitation link fails safely without tenant data", async ({
    page,
  }) => {
    await page.goto("/accept-invitation/does-not-exist");
    await expect(page.getByRole("heading", { name: "คำเชิญ" })).toBeVisible();
    await expect(
      page.getByText(/ไม่พบคำเชิญนี้|โหลดข้อมูลคำเชิญไม่สำเร็จ/),
    ).toBeVisible();
  });
});
