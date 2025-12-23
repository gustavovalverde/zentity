import { expect, test } from "@playwright/test";

test.describe("Workflow automation", () => {
  test("loads dashboard and DeFi demo for authenticated user", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: /welcome/i })).toBeVisible();

    await page.goto("/dashboard/defi-demo");
    await expect(page).toHaveURL(/dashboard\/defi-demo/);
    await expect(
      page.getByRole("heading", { name: "DeFi Compliance Demo" }),
    ).toBeVisible();
  });

  test("renders the landing page content", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Privacy-First Identity Verification",
      }),
    ).toBeVisible();
  });
});
