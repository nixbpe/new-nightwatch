import { expect, test } from "@playwright/test";

test.describe("public auth entry", () => {
  test("login page renders the email/password form in Thai", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "th");
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.getByTestId("login-email")).toBeVisible();
    await expect(page.getByTestId("login-password")).toBeVisible();
    await expect(page.getByTestId("login-submit")).toBeVisible();
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
    await page.getByTestId("login-submit").click();

    const email = page.getByTestId("login-email");
    const password = page.getByTestId("login-password");
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
    await expect(page.getByTestId("login-email-error")).toBeVisible();
    await expect(page.getByTestId("login-email-error")).toHaveText(/\S/);
    await expect(page.getByTestId("login-password-error")).toBeVisible();
    await expect(page.getByTestId("login-password-error")).toHaveText(/\S/);
    expect(signInRequestCount).toBe(0);
  });

  test("forgot-password page is reachable from login", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-forgot-password").click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByTestId("forgot-password-email")).toBeVisible();
    await expect(page.getByTestId("forgot-password-submit")).toBeEnabled();
  });

  test("an invalid invitation link fails safely without tenant data", async ({
    page,
  }) => {
    const previewResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
        "/api/onboarding/invitations/does-not-exist",
    );
    await page.goto("/accept-invitation/does-not-exist");
    expect((await previewResponse).status()).toBe(404);
    await expect(page.getByTestId("invitation-page")).toBeVisible();
    await expect(page.getByTestId("invitation-preview-error")).toBeVisible();
    await expect(page.getByTestId("invitation-preview-error")).toHaveText(/\S/);
    await expect(page.getByTestId("invitation-organization")).toHaveCount(0);
    await expect(page.getByTestId("invitation-recipient")).toHaveCount(0);
    await expect(page.getByTestId("invitation-accept")).toHaveCount(0);
  });
});
