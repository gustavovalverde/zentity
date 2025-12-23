import { expect, test } from "@playwright/test";

test.describe("DeFi Demo", () => {
  test("loads the compliance demo page", async ({ page }) => {
    await page.goto("/dashboard/defi-demo");
    await expect(page).toHaveURL(/dashboard\/defi-demo/);
    await expect(
      page.getByRole("heading", { name: "DeFi Compliance Demo" }),
    ).toBeVisible();
  });
});
