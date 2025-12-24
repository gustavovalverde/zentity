import { expect, test } from "@playwright/test";

test.describe("Workflow automation", () => {
  test("loads dashboard and DeFi demo for authenticated user", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const navigate = async (url: string) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 60_000,
          });
          return;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (!message.includes("ERR_ABORTED") || attempt === 2) {
            throw error;
          }
        }
      }
    };

    await navigate("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: /welcome/i })).toBeVisible();

    await navigate("/dashboard/defi-demo");
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
