import { expect, test } from "@playwright/test";

// Top-level regex patterns for lint/performance/useTopLevelRegex compliance
const WELCOME_BACK_PATTERN = /welcome back/i;
const SIGN_UP_LINK_PATTERN = /sign up/i;
const SIGN_UP_URL_PATTERN = /sign-up/;
const CREATE_ACCOUNT_PATTERN = /create account/i;
const EMAIL_ADDRESS_PATTERN = /Email Address/i;
const EMAIL_OR_RECOVERY_ID_PATTERN = /Email or Recovery ID/i;
const PASSWORD_LABEL_PATTERN = /^Password$/i;
const CONFIRM_PASSWORD_PATTERN = /Confirm Password/i;
const SIGN_IN_BUTTON_PATTERN = /^sign in$/i;
const PASSWORD_OPTION_PATTERN = /Password Use a secure password/i;

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Authentication Flow", () => {
  test("should show sign-in page", async ({ page }) => {
    await page.goto("/sign-in");
    // Card title says "Welcome Back" - passkey-first sign-in
    await expect(page.getByText(WELCOME_BACK_PATTERN).first()).toBeVisible();
  });

  test("should show sign-up page", async ({ page }) => {
    await page.goto("/sign-up?fresh=1", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page.getByText(CREATE_ACCOUNT_PATTERN).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("textbox", { name: EMAIL_ADDRESS_PATTERN })
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: PASSWORD_OPTION_PATTERN })
    ).toBeVisible();
  });

  test("should navigate from sign-in to sign-up", async ({ page }) => {
    await page.goto("/sign-in");

    // Look for sign-up link and wait for it to be visible
    const signUpLink = page.getByRole("link", { name: SIGN_UP_LINK_PATTERN });
    await expect(signUpLink).toBeVisible({ timeout: 10_000 });
    await expect(signUpLink).toHaveAttribute("href", SIGN_UP_URL_PATTERN);

    const href = await signUpLink.getAttribute("href");
    if (!href) {
      throw new Error("Sign-up link missing href");
    }

    await page.goto(href, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page).toHaveURL(SIGN_UP_URL_PATTERN, { timeout: 30_000 });
  });

  test("should show password sign-in controls", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(
      page.getByRole("textbox", { name: EMAIL_OR_RECOVERY_ID_PATTERN })
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel(PASSWORD_LABEL_PATTERN)).toBeVisible();
    await expect(
      page.getByRole("button", { name: SIGN_IN_BUTTON_PATTERN })
    ).toBeVisible();
  });

  test("should accept email and open the inline password form", async ({
    page,
  }) => {
    const testEmail = `e2e-auth-${Date.now()}@example.com`;

    await page.goto("/sign-up?fresh=1", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const emailInput = page.getByRole("textbox", {
      name: EMAIL_ADDRESS_PATTERN,
    });
    await emailInput.fill(testEmail);
    await emailInput.blur();

    await expect(
      page.locator("text=Please enter a valid email address")
    ).toHaveCount(0);

    await page.getByRole("button", { name: PASSWORD_OPTION_PATTERN }).click();

    await expect(page.getByLabel(PASSWORD_LABEL_PATTERN)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel(CONFIRM_PASSWORD_PATTERN)).toBeVisible({
      timeout: 15_000,
    });
    await expect(emailInput).toHaveValue(testEmail);
  });
});
