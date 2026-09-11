import { expect, test } from "@playwright/test";

test.describe("hello journey", () => {
  test("API serves the typed greeting at its intended endpoint", async ({
    page,
  }) => {
    // The SPA no longer renders the scaffold greeting; coverage of the
    // hello contract stays at the API endpoint (same-origin via the dev proxy).
    const response = await page.request.get("/api/v1/hello");
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as {
      message: string;
      timestamp: string;
    };
    expect(body.message).toBe("Hello from NightWatch");
    expect(Date.parse(body.timestamp)).not.toBeNaN();
  });

  test("SPA root bounces anonymous visitors to the login entry", async ({
    page,
  }) => {
    await page.goto("/");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
    await expect(
      page.getByRole("heading", { name: "เข้าสู่ระบบ" }),
    ).toBeVisible();
  });
});
