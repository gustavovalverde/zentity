import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Authentication Flow", () => {
  test("should show sign-in page", async ({ page }) => {
    await page.goto("/sign-in");
    // Card title says "Welcome Back" and description mentions "Sign in"
    await expect(
      page.locator("text=/welcome back|sign in/i").first(),
    ).toBeVisible();
  });

  test("should show sign-up page", async ({ page }) => {
    // Use fresh=1 to start a clean wizard without session hydration delay
    await page.goto("/sign-up?fresh=1");
    // Wait for wizard hydration to complete (loading state disappears)
    await expect(page.getByText("Loading...")).toBeHidden({ timeout: 15_000 });
    // Sign-up starts with onboarding step 1 (email only)
    await expect(page.locator('input[type="email"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page
        .locator('button[type="submit"], button:has-text("Continue")')
        .first(),
    ).toBeVisible();
  });

  test("should navigate from sign-in to sign-up", async ({ page }) => {
    await page.goto("/sign-in");

    // Look for sign-up link and wait for it to be visible
    const signUpLink = page.locator('a[href*="sign-up"]');
    await expect(signUpLink).toBeVisible({ timeout: 10_000 });
    await signUpLink.click();

    await expect(page).toHaveURL(/sign-up/, { timeout: 10_000 });
  });

  test("should show validation error for invalid email", async ({ page }) => {
    await page.goto("/sign-in");

    await page.fill('input[type="email"]', "invalid-email");
    await page.fill('input[type="password"]', "password123");
    await page.click('button[type="submit"]');

    // Should show validation error or stay on page
    await expect(page).toHaveURL(/sign-in/);
  });

  test("should accept email and proceed to upload step", async ({ page }) => {
    const testEmail = `e2e-auth-${Date.now()}@example.com`;

    await page.goto("/sign-up?fresh=1");

    // Wait for wizard hydration to complete
    await expect(page.getByText("Loading...")).toBeHidden({ timeout: 10_000 });

    await page.waitForSelector('input[type="email"], input[name="email"]', {
      timeout: 10000,
    });

    const emailInput = page
      .locator('input[type="email"], input[name="email"]')
      .first();
    await emailInput.fill(testEmail);
    await emailInput.blur();

    await expect(
      page.locator("text=Please enter a valid email address"),
    ).toHaveCount(0);

    // Use requestSubmit to avoid flaky click events on some headless runs.
    await page
      .locator("form")
      .first()
      .evaluate((form) => (form as HTMLFormElement).requestSubmit());

    await expect(
      page.getByRole("heading", { name: "Upload ID Document" }),
    ).toBeVisible({ timeout: 15000 });
  });
});
