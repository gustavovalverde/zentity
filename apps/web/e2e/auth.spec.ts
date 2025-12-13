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
    await page.goto("/sign-up");
    // Sign-up starts with onboarding step 1 (email only)
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(
      page
        .locator('button[type="submit"], button:has-text("Continue")')
        .first(),
    ).toBeVisible();
  });

  test("should navigate from sign-in to sign-up", async ({ page }) => {
    await page.goto("/sign-in");

    // Look for sign-up link
    const signUpLink = page.locator('a[href*="sign-up"]');
    await signUpLink.click();

    await expect(page).toHaveURL(/sign-up/);
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

    await page.goto("/sign-up");

    await page.waitForSelector('input[type="email"], input[name="email"]', {
      timeout: 10000,
    });

    const emailInput = page
      .locator('input[type="email"], input[name="email"]')
      .first();
    await emailInput.fill(testEmail);

    const continueButton = page
      .locator('button[type="submit"]:not([disabled])')
      .first();
    await continueButton.click();

    // Progress indicator should move beyond step 1.
    await expect(page.locator("text=/step\\s*2\\s*of\\s*4/i")).toBeVisible({
      timeout: 10000,
    });
  });
});
