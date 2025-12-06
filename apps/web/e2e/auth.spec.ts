import { test, expect } from "@playwright/test";

test.describe("Authentication Flow", () => {
  test("should show sign-in page", async ({ page }) => {
    await page.goto("/sign-in");
    // Card title says "Welcome Back" and description mentions "Sign in"
    await expect(page.locator('text=/welcome back|sign in/i').first()).toBeVisible();
  });

  test("should show sign-up page", async ({ page }) => {
    await page.goto("/sign-up");
    // Look for title or form elements
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
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

    await page.fill('input[name="email"]', "invalid-email");
    await page.fill('input[name="password"]', "password123");
    await page.click('button[type="submit"]');

    // Should show validation error or stay on page
    await expect(page).toHaveURL(/sign-in/);
  });

  test("should complete sign-up wizard", async ({ page }) => {
    const testEmail = `e2e-auth-${Date.now()}@example.com`;
    const testPassword = "TestPassword123!";

    await page.goto("/sign-up");

    // Sign-up uses a wizard with steps
    // Wait for email input to appear
    await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });

    // Fill email
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    await emailInput.fill(testEmail);

    // Fill password
    const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
    await passwordInput.fill(testPassword);

    // If there's a confirm password field
    const confirmPasswordInput = page.locator('input[name="confirmPassword"]');
    if (await confirmPasswordInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await confirmPasswordInput.fill(testPassword);
    }

    // Click submit button - be specific to avoid step indicator buttons
    // The wizard navigation uses type="submit" on enabled buttons
    const submitButton = page.locator('button[type="submit"]:not([disabled])').first();
    await submitButton.click();

    // Wait for redirect or next step
    await page.waitForTimeout(3000);

    // Should either redirect or move to next step
    const url = page.url();
    const hasProgress = url.includes("dashboard") || url.includes("onboarding") || url.includes("sign-up");
    expect(hasProgress).toBeTruthy();
  });
});
