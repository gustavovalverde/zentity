/**
 * E2E Tests for Progressive Sign-Up Flow (RFC-0017)
 *
 * Tests the 2-step sign-up flow:
 * - Step 1: Email entry (optional)
 * - Step 2: Account creation (passkey or password)
 *
 * After account creation, users land on dashboard at Tier 1.
 * Identity verification happens from the dashboard, not during sign-up.
 */
import { expect, test } from "@playwright/test";

// Top-level regex patterns for lint/performance/useTopLevelRegex compliance
const SIGN_UP_URL_PATTERN = /sign-up/;
const DASHBOARD_URL_PATTERN = /\/dashboard/;
const TIER_1_ACCOUNT_PATTERN = /Tier 1: Account/i;
const WELCOME_PATTERN = /welcome/i;
const GET_STARTED_PATTERN = /Get Started/i;
const CREATE_YOUR_ACCOUNT_PATTERN = /Create Your Account/i;
const HOW_WOULD_YOU_LIKE_PATTERN = /How would you like to sign in/i;
const CREATE_YOUR_PASSWORD_PATTERN = /Create Your Password/i;
const CONTINUE_WITHOUT_EMAIL_PATTERN = /Continue without email/i;
const CONTINUE_PATTERN = /Continue/i;
const PASSKEY_PATTERN = /Passkey/i;
const PASSWORD_BUTTON_PATTERN = /^Password$/i;
const PASSWORD_OPTION_PATTERN = /Password/i;
const CREATE_ACCOUNT_PATTERN = /Create Account/i;
const BACK_PATTERN = /Back/i;
const SIGN_IN_PATTERN = /Sign In/i;
const PASSWORD_MIN_LENGTH_PATTERN = /at least 8 characters/i;
const PASSWORDS_MISMATCH_PATTERN = /Passwords do not match/i;
const STEP_1_OF_2_PATTERN = /Step 1 of 2/i;
const STEP_2_OF_2_PATTERN = /Step 2 of 2/i;

// Clear storage to ensure fresh sign-up state
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Progressive Sign-Up - 2-Step Flow", () => {
  test.describe("Step 1: Email Entry", () => {
    test("should show email step on fresh sign-up", async ({ page }) => {
      await page.goto("/sign-up?fresh=1", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      await expect(page).toHaveURL(SIGN_UP_URL_PATTERN, { timeout: 30_000 });

      // Should show "Get Started" heading
      await expect(
        page.getByRole("heading", { name: GET_STARTED_PATTERN })
      ).toBeVisible({ timeout: 30_000 });

      // Should have email input
      const emailInput = page.locator('input[type="email"]');
      await expect(emailInput).toBeVisible({ timeout: 10_000 });

      // Should have "Continue without email" option
      await expect(
        page.getByRole("button", { name: CONTINUE_WITHOUT_EMAIL_PATTERN })
      ).toBeVisible();
    });

    test("should have Continue and Skip buttons", async ({ page }) => {
      await page.goto("/sign-up?fresh=1", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      await page.waitForSelector('input[type="email"]', { timeout: 30_000 });

      // Continue button
      const continueBtn = page.getByRole("button", { name: CONTINUE_PATTERN });
      await expect(continueBtn).toBeVisible();

      // Skip button (Continue without email)
      const skipBtn = page.getByRole("button", {
        name: CONTINUE_WITHOUT_EMAIL_PATTERN,
      });
      await expect(skipBtn).toBeVisible();
    });

    test("should advance to account step with valid email", async ({
      page,
    }) => {
      const testEmail = `e2e-sign-up-${Date.now()}@example.com`;

      await page.goto("/sign-up?fresh=1", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      const emailInput = page
        .locator('input[type="email"], input[name="email"]')
        .first();
      await emailInput.waitFor({ timeout: 30_000 });
      await emailInput.fill(testEmail);
      await emailInput.blur();

      // No validation error should appear
      await expect(
        page.locator("text=Please enter a valid email address")
      ).toHaveCount(0);

      // Submit the form
      await page
        .locator("form")
        .first()
        .evaluate((form) => (form as HTMLFormElement).requestSubmit());

      // Should advance to account step
      await expect(
        page.getByRole("heading", { name: CREATE_YOUR_ACCOUNT_PATTERN })
      ).toBeVisible({ timeout: 15_000 });
    });

    test("should advance to account step when skipping email", async ({
      page,
    }) => {
      await page.goto("/sign-up?fresh=1", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      await page.waitForSelector('input[type="email"]', { timeout: 30_000 });

      // Click "Continue without email"
      await page
        .getByRole("button", { name: CONTINUE_WITHOUT_EMAIL_PATTERN })
        .click();

      // Should advance to account step
      await expect(
        page.getByRole("heading", { name: CREATE_YOUR_ACCOUNT_PATTERN })
      ).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe("Step 2: Account Creation", () => {
    test("should show credential choice after skipping email", async ({
      page,
    }) => {
      await page.goto("/sign-up?fresh=1", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      await page.waitForSelector('input[type="email"]', { timeout: 30_000 });
      await page
        .getByRole("button", { name: CONTINUE_WITHOUT_EMAIL_PATTERN })
        .click();

      // Should show "Create Your Account" heading
      await expect(
        page.getByRole("heading", { name: CREATE_YOUR_ACCOUNT_PATTERN })
      ).toBeVisible({ timeout: 15_000 });

      // Should show credential choice heading
      await expect(
        page.getByRole("heading", { name: HOW_WOULD_YOU_LIKE_PATTERN })
      ).toBeVisible({ timeout: 10_000 });

      // Should have passkey and password options
      const passkeyBtn = page.getByRole("button", { name: PASSKEY_PATTERN });
      const passwordBtn = page.getByRole("button", {
        name: PASSWORD_OPTION_PATTERN,
      });

      await expect(passkeyBtn).toBeVisible();
      await expect(passwordBtn).toBeVisible();
    });

    test("should show password form when selecting password option", async ({
      page,
    }) => {
      await page.goto("/sign-up?fresh=1", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      await page.waitForSelector('input[type="email"]', { timeout: 30_000 });
      await page
        .getByRole("button", { name: CONTINUE_WITHOUT_EMAIL_PATTERN })
        .click();

      await expect(
        page.getByRole("heading", { name: HOW_WOULD_YOU_LIKE_PATTERN })
      ).toBeVisible({ timeout: 15_000 });

      // Click password option (the one without "Recommended" badge)
      const passwordBtn = page.getByRole("button", {
        name: PASSWORD_BUTTON_PATTERN,
        exact: false,
      });
      await passwordBtn.click();

      // Should show "Create Your Password" heading
      await expect(
        page.getByRole("heading", { name: CREATE_YOUR_PASSWORD_PATTERN })
      ).toBeVisible({ timeout: 10_000 });

      // Should have password and confirm password fields
      const passwordInput = page.getByPlaceholder("Enter password");
      const confirmInput = page.getByPlaceholder("Confirm password");

      await expect(passwordInput).toBeVisible();
      await expect(confirmInput).toBeVisible();

      // Should have Create Account button
      await expect(
        page.getByRole("button", { name: CREATE_ACCOUNT_PATTERN })
      ).toBeVisible();
    });

    test("should have Back button in password form", async ({ page }) => {
      await page.goto("/sign-up?fresh=1", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      await page.waitForSelector('input[type="email"]', { timeout: 30_000 });
      await page
        .getByRole("button", { name: CONTINUE_WITHOUT_EMAIL_PATTERN })
        .click();

      await expect(
        page.getByRole("heading", { name: HOW_WOULD_YOU_LIKE_PATTERN })
      ).toBeVisible({ timeout: 15_000 });

      // Click password option
      await page.getByRole("button", { name: PASSWORD_BUTTON_PATTERN }).click();

      await expect(
        page.getByRole("heading", { name: CREATE_YOUR_PASSWORD_PATTERN })
      ).toBeVisible({ timeout: 10_000 });

      // Should have Back button
      const backBtn = page.getByRole("button", { name: BACK_PATTERN });
      await expect(backBtn).toBeVisible();

      // Clicking Back should return to credential choice
      await backBtn.click();
      await expect(
        page.getByRole("heading", { name: HOW_WOULD_YOU_LIKE_PATTERN })
      ).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe("Step 2: Password Account Creation (Full Flow)", () => {
    test("should validate password requirements", async ({ page }) => {
      await page.goto("/sign-up?fresh=1", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      // Skip email
      await page.waitForSelector('input[type="email"]', { timeout: 30_000 });
      await page
        .getByRole("button", { name: CONTINUE_WITHOUT_EMAIL_PATTERN })
        .click();

      // Wait for credential choice
      await expect(
        page.getByRole("heading", { name: HOW_WOULD_YOU_LIKE_PATTERN })
      ).toBeVisible({ timeout: 15_000 });

      // Select password option
      await page.getByRole("button", { name: PASSWORD_BUTTON_PATTERN }).click();

      // Wait for password form
      await expect(
        page.getByRole("heading", { name: CREATE_YOUR_PASSWORD_PATTERN })
      ).toBeVisible({ timeout: 10_000 });

      // Fill with short password
      const passwordInput = page.getByPlaceholder("Enter password");
      await passwordInput.fill("short");
      await passwordInput.blur();

      // Should show validation error about minimum length
      await expect(page.getByText(PASSWORD_MIN_LENGTH_PATTERN)).toBeVisible({
        timeout: 5000,
      });
    });

    test("should validate password confirmation match", async ({ page }) => {
      await page.goto("/sign-up?fresh=1", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      // Skip email
      await page.waitForSelector('input[type="email"]', { timeout: 30_000 });
      await page
        .getByRole("button", { name: CONTINUE_WITHOUT_EMAIL_PATTERN })
        .click();

      // Select password option
      await expect(
        page.getByRole("heading", { name: HOW_WOULD_YOU_LIKE_PATTERN })
      ).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: PASSWORD_BUTTON_PATTERN }).click();

      // Wait for password form
      await expect(
        page.getByRole("heading", { name: CREATE_YOUR_PASSWORD_PATTERN })
      ).toBeVisible({ timeout: 10_000 });

      // Fill passwords that don't match
      const passwordInput = page.getByPlaceholder("Enter password");
      const confirmInput = page.getByPlaceholder("Confirm password");

      await passwordInput.fill("SecurePassword123!");
      await confirmInput.fill("DifferentPassword456!");
      await confirmInput.blur();

      // Should show mismatch error
      await expect(page.getByText(PASSWORDS_MISMATCH_PATTERN)).toBeVisible({
        timeout: 5000,
      });
    });

    test("should create account with valid password and redirect to dashboard", async ({
      page,
    }) => {
      test.setTimeout(120_000);

      await page.goto("/sign-up?fresh=1", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      // Skip email
      await page.waitForSelector('input[type="email"]', { timeout: 30_000 });
      await page
        .getByRole("button", { name: CONTINUE_WITHOUT_EMAIL_PATTERN })
        .click();

      // Select password option
      await expect(
        page.getByRole("heading", { name: HOW_WOULD_YOU_LIKE_PATTERN })
      ).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: PASSWORD_BUTTON_PATTERN }).click();

      // Wait for password form
      await expect(
        page.getByRole("heading", { name: CREATE_YOUR_PASSWORD_PATTERN })
      ).toBeVisible({ timeout: 10_000 });

      // Fill valid matching passwords
      const password = `E2eTest${Date.now()}!`;
      const passwordInput = page.getByPlaceholder("Enter password");
      const confirmInput = page.getByPlaceholder("Confirm password");

      await passwordInput.fill(password);
      await confirmInput.fill(password);
      await confirmInput.blur();

      // Wait for breach check to complete (might show "checking" briefly)
      await page.waitForTimeout(2000);

      // Submit
      const createAccountBtn = page.getByRole("button", {
        name: CREATE_ACCOUNT_PATTERN,
      });
      await expect(createAccountBtn).toBeEnabled({ timeout: 10_000 });
      await createAccountBtn.click();

      // Should redirect to dashboard after account creation
      await expect(page).toHaveURL(DASHBOARD_URL_PATTERN, { timeout: 60_000 });

      // Should show welcome message
      await expect(
        page.getByRole("heading", { name: WELCOME_PATTERN })
      ).toBeVisible({ timeout: 30_000 });
    });
  });
});

test.describe("Progressive Onboarding - Dashboard After Creation", () => {
  test("should show Tier 1 badge on dashboard after password signup", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.goto("/sign-up?fresh=1", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    // Complete sign-up flow
    await page.waitForSelector('input[type="email"]', { timeout: 30_000 });
    await page
      .getByRole("button", { name: CONTINUE_WITHOUT_EMAIL_PATTERN })
      .click();

    await expect(
      page.getByRole("heading", { name: HOW_WOULD_YOU_LIKE_PATTERN })
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: PASSWORD_BUTTON_PATTERN }).click();

    await expect(
      page.getByRole("heading", { name: CREATE_YOUR_PASSWORD_PATTERN })
    ).toBeVisible({ timeout: 10_000 });

    const password = `E2eTier${Date.now()}!`;
    await page.getByPlaceholder("Enter password").fill(password);
    await page.getByPlaceholder("Confirm password").fill(password);
    await page.waitForTimeout(2000);

    await page.getByRole("button", { name: CREATE_ACCOUNT_PATTERN }).click();

    // Wait for dashboard
    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN, { timeout: 60_000 });
    await expect(
      page.getByRole("heading", { name: WELCOME_PATTERN })
    ).toBeVisible({ timeout: 30_000 });

    // RFC-0017: User should be at Tier 1 after account creation
    // (no identity verification required during sign-up)
    const tierBadge = page.getByText(TIER_1_ACCOUNT_PATTERN);
    await expect(tierBadge.first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Progressive Onboarding - Navigation", () => {
  test("should show step counter", async ({ page }) => {
    await page.goto("/sign-up?fresh=1", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await page.waitForSelector('input[type="email"]', { timeout: 30_000 });

    // Should show "Step 1 of 2"
    await expect(page.getByText(STEP_1_OF_2_PATTERN)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("should update step counter when advancing", async ({ page }) => {
    await page.goto("/sign-up?fresh=1", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await page.waitForSelector('input[type="email"]', { timeout: 30_000 });

    // Skip email to advance
    await page
      .getByRole("button", { name: CONTINUE_WITHOUT_EMAIL_PATTERN })
      .click();

    // Should now show "Step 2 of 2"
    await expect(page.getByText(STEP_2_OF_2_PATTERN)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("should have link to sign-in page", async ({ page }) => {
    await page.goto("/sign-up?fresh=1", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await page.waitForSelector('input[type="email"]', { timeout: 30_000 });

    // Should have "Already have an account? Sign In" link
    const signInLink = page.getByRole("link", { name: SIGN_IN_PATTERN });
    await expect(signInLink).toBeVisible();

    const href = await signInLink.getAttribute("href");
    expect(href).toContain("/sign-in");
  });
});
