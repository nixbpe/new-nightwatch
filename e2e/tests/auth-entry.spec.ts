import { expect, test } from "@playwright/test";

test.describe("public auth entry", () => {
  test("login page renders the email/password form in Thai", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "เข้าสู่ระบบ" }),
    ).toBeVisible();
    await expect(page.getByLabel("อีเมล")).toBeVisible();
    await expect(page.getByLabel("รหัสผ่าน")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "เข้าสู่ระบบ" }),
    ).toBeVisible();
  });

  test("invalid login stays client-side with accessible field errors", async ({
    page,
  }) => {
    let signInRequestCount = 0;
    await page.route("**/api/auth/sign-in/email", async (route) => {
      signInRequestCount += 1;
      await route.abort();
    });

    await page.goto("/login");
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();

    const email = page.getByLabel("อีเมล");
    const password = page.getByLabel("รหัสผ่าน");
    await expect(page).toHaveURL(/\/login$/);
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAttribute(
      "aria-describedby",
      "login-email-error",
    );
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(password).toHaveAttribute(
      "aria-describedby",
      "login-password-error",
    );
    await expect(
      page.getByText("กรุณากรอกอีเมล", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("กรุณากรอกรหัสผ่าน", { exact: true }),
    ).toBeVisible();
    expect(signInRequestCount).toBe(0);
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
