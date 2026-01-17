import { expect, test } from "@playwright/test";

// Top-level regex patterns for lint/performance/useTopLevelRegex compliance
const DASHBOARD_URL_PATTERN = /\/dashboard/;
const ZENTITY_TITLE_PATTERN = /Zentity/i;
const WELCOME_HEADING_PATTERN = /welcome/i;
const SIGN_IN_URL_PATTERN = /sign-in/;

test.describe("Dashboard - Basic", () => {
  test("shows dashboard page for authenticated users", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);
  });

  test("landing page loads correctly", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(ZENTITY_TITLE_PATTERN);
  });
});

test.describe("Dashboard - Authenticated User", () => {
  test("should display dashboard content for authenticated user", async ({
    page,
  }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    // Check we're on the dashboard (not redirected to sign-in)
    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: WELCOME_HEADING_PATTERN })
    ).toBeVisible({
      timeout: 60_000,
    });

    // Dashboard should have some content - look for common dashboard elements
    const dashboardContent = page
      .locator("main, [role='main'], .dashboard, #dashboard")
      .first();
    await expect(dashboardContent).toBeVisible({ timeout: 10_000 });
  });

  test("shows on-chain attestation section", async ({ page }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page.locator("text=On-Chain Attestation").first()).toBeVisible(
      { timeout: 60_000 }
    );
  });

  test("should show verification status or welcome content", async ({
    page,
  }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await expect(
      page.getByRole("heading", { name: WELCOME_HEADING_PATTERN })
    ).toBeVisible({
      timeout: 60_000,
    });

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
    await page.waitForURL(SIGN_IN_URL_PATTERN, { timeout: 5000 });
    expect(page.url()).toContain("sign-in");
  });
});
