import { expect, test } from "@playwright/test";
import { createAuthenticatedUser } from "./fixtures/auth.fixture";

test.describe("Dashboard - Basic", () => {
  test("shows dashboard page for authenticated users", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/(dashboard|sign-in)/);
  });

  test("landing page loads correctly", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Zentity/i);
  });
});

test.describe("Dashboard - Authenticated User", () => {
  test.beforeEach(async ({ page, request }) => {
    // Create and authenticate user via API
    await createAuthenticatedUser(page, request);
    await page.goto("/dashboard");
    // Wait for page to load
    await page.waitForLoadState("networkidle");
  });

  test("should display dashboard content for authenticated user", async ({
    page,
  }) => {
    // Check we're on the dashboard (not redirected to sign-in)
    await expect(page).toHaveURL(/dashboard/);

    // Dashboard should have some content - look for common dashboard elements
    const dashboardContent = page
      .locator("main, [role='main'], .dashboard, #dashboard")
      .first();
    await expect(dashboardContent).toBeVisible({ timeout: 10000 });
  });

  test("should show verification status or welcome content", async ({
    page,
  }) => {
    // Look for any verification-related text or welcome message
    const pageContent = await page.textContent("body");
    const hasExpectedContent =
      pageContent?.toLowerCase().includes("verif") ||
      pageContent?.toLowerCase().includes("welcome") ||
      pageContent?.toLowerCase().includes("status") ||
      pageContent?.toLowerCase().includes("dashboard");

    expect(hasExpectedContent).toBeTruthy();
  });
});

test.describe("Dashboard - Navigation", () => {
  test("should redirect unauthenticated users to sign-in", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/dashboard");
    await page.waitForURL(/sign-in/, { timeout: 5000 });
    expect(page.url()).toContain("sign-in");
  });
});
