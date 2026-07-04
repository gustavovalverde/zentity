import { expect, type Page, test } from "@playwright/test";

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
const PASSKEY_SUPPORT_PATTERN = /Checking passkey support/i;

test.use({ storageState: { cookies: [], origins: [] } });

async function openInlinePasswordSignUp(page: Page) {
  const passwordOption = page.getByRole("button", {
    name: PASSWORD_OPTION_PATTERN,
  });
  const passwordInput = page.getByLabel(PASSWORD_LABEL_PATTERN);

  await expect(passwordOption).toBeVisible();

  // The button toggles the inline form, so click only while it is closed and
  // retry to absorb a click that lands before the handler is wired.
  await expect(async () => {
    if (!(await passwordInput.isVisible().catch(() => false))) {
      await passwordOption.click();
    }
    await expect(passwordInput).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  await expect(page.getByLabel(CONFIRM_PASSWORD_PATTERN)).toBeVisible({
    timeout: 15_000,
  });
}

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

    // The passkey-support probe renders "Checking passkey support…" until its
    // client effect runs; waiting for it to clear confirms the form hydrated,
    // so the fill below is not reverted when React takes over the controlled
    // email input.
    await expect(page.getByText(PASSKEY_SUPPORT_PATTERN)).toHaveCount(0, {
      timeout: 15_000,
    });

    const emailInput = page.getByRole("textbox", {
      name: EMAIL_ADDRESS_PATTERN,
    });
    await emailInput.fill(testEmail);
    await expect(emailInput).toHaveValue(testEmail);
    await emailInput.blur();

    await expect(
      page.locator("text=Please enter a valid email address")
    ).toHaveCount(0);

    await openInlinePasswordSignUp(page);
    await expect(emailInput).toHaveValue(testEmail);
  });
});
