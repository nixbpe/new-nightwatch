import { expect, test } from "@playwright/test";

test.describe("hello journey", () => {
  test("SPA loads and shows the greeting served by the API", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "NightWatch" }),
    ).toBeVisible();
    await expect(page.getByText("Hello from NightWatch")).toBeVisible();
    await expect(page.getByRole("time")).toHaveAttribute("datetime", /.+/);
  });
});
