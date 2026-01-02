import { expect, test } from "@playwright/test";

// Top-level regex patterns for lint/performance/useTopLevelRegex compliance
const DEFI_DEMO_URL_PATTERN = /dashboard\/defi-demo/;

test.describe("DeFi Demo", () => {
  test("loads the compliance demo page", async ({ page }) => {
    await page.goto("/dashboard/defi-demo");
    await expect(page).toHaveURL(DEFI_DEMO_URL_PATTERN);
    await expect(
      page.getByRole("heading", { name: "DeFi Compliance Demo" })
    ).toBeVisible();
  });
});
