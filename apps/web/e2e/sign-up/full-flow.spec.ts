import { expect, type Page, test } from "@playwright/test";

const DASHBOARD_URL_PATTERN = /\/dashboard/;
const ANONYMOUS_TIER_PATTERN = /^Anonymous$/i;
const CREATE_ACCOUNT_PATTERN = /Create Account/i;
const SIGN_IN_PATTERN = /Sign In/i;
const PASSWORD_OPTION_PATTERN = /Password Use a secure password/i;
const PASSKEY_OPTION_PATTERN =
  /Passkey Use fingerprint, face, or security key/i;
const WALLET_OPTION_PATTERN = /Wallet Use your crypto wallet/i;
const PASSWORD_MIN_LENGTH_ERROR_PATTERN =
  /Password must be at least 10 characters/i;
const PASSWORDS_MISMATCH_PATTERN = /Passwords do not match/i;
const READY_TO_VERIFY_PATTERN = /Ready to Verify/i;
const OPTIONAL_EMAIL_ADDRESS_PATTERN = /Email Address \(optional\)/i;
const PASSWORD_LABEL_PATTERN = /^Password$/i;
const CONFIRM_PASSWORD_PATTERN = /Confirm Password/i;
const SIGN_IN_URL_PATTERN = /\/sign-in/;

test.use({ storageState: { cookies: [], origins: [] } });

async function openSignUp(page: Page) {
  await page.goto("/sign-up?fresh=1", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  await expect(page.getByText(CREATE_ACCOUNT_PATTERN).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("textbox", { name: OPTIONAL_EMAIL_ADDRESS_PATTERN })
  ).toBeVisible({ timeout: 10_000 });
}

async function openPasswordSignUp(page: Page, email?: string) {
  await openSignUp(page);

  if (email) {
    await page
      .getByRole("textbox", { name: OPTIONAL_EMAIL_ADDRESS_PATTERN })
      .fill(email);
  }

  const passwordOption = page.getByRole("button", {
    name: PASSWORD_OPTION_PATTERN,
  });
  const passwordInput = page.getByLabel(PASSWORD_LABEL_PATTERN);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await passwordOption.click();
    const visible = await passwordInput.isVisible().catch(() => false);
    if (visible) {
      break;
    }
    await page.waitForTimeout(250);
  }

  await expect(passwordInput).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel(CONFIRM_PASSWORD_PATTERN)).toBeVisible();
}

test.describe("Sign-Up Flow", () => {
  test("shows the current credential choice layout", async ({ page }) => {
    await openSignUp(page);

    await expect(
      page.getByRole("button", { name: PASSKEY_OPTION_PATTERN })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: PASSWORD_OPTION_PATTERN })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: WALLET_OPTION_PATTERN })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: SIGN_IN_PATTERN })
    ).toHaveAttribute("href", SIGN_IN_URL_PATTERN);
  });

  test("reveals the inline password form when password is selected", async ({
    page,
  }) => {
    await openPasswordSignUp(page, `signup-${Date.now()}@example.com`);

    await expect(
      page.getByRole("button", { name: CREATE_ACCOUNT_PATTERN })
    ).toBeVisible();
  });

  test("validates minimum password length", async ({ page }) => {
    await openPasswordSignUp(page);

    const passwordInput = page.getByLabel(PASSWORD_LABEL_PATTERN);
    await passwordInput.fill("short");
    await passwordInput.blur();

    await expect(
      page.getByText(PASSWORD_MIN_LENGTH_ERROR_PATTERN)
    ).toBeVisible();
  });

  test("validates password confirmation match", async ({ page }) => {
    await openPasswordSignUp(page);

    await page.getByLabel(PASSWORD_LABEL_PATTERN).fill("SecurePassword123!");
    const confirmInput = page.getByLabel(CONFIRM_PASSWORD_PATTERN);
    await confirmInput.fill("DifferentPassword456!");
    await confirmInput.blur();

    await expect(page.getByText(PASSWORDS_MISMATCH_PATTERN)).toBeVisible();
  });

  test("creates an account with password and redirects to the dashboard", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await openPasswordSignUp(page, `signup-${Date.now()}@example.com`);

    const password = `E2ePassword${Date.now()}!`;
    await page.getByLabel(PASSWORD_LABEL_PATTERN).fill(password);
    const confirmInput = page.getByLabel(CONFIRM_PASSWORD_PATTERN);
    await confirmInput.fill(password);
    await confirmInput.blur();

    await page.waitForTimeout(2000);
    await page
      .locator("form")
      .evaluate((form) => (form as HTMLFormElement).requestSubmit());

    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN, { timeout: 60_000 });
  });

  test("lands on the verification-ready dashboard after password signup", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await openPasswordSignUp(page, `tier1-${Date.now()}@example.com`);

    const password = `TierOne${Date.now()}!`;
    await page.getByLabel(PASSWORD_LABEL_PATTERN).fill(password);
    const confirmInput = page.getByLabel(CONFIRM_PASSWORD_PATTERN);
    await confirmInput.fill(password);
    await confirmInput.blur();

    await page.waitForTimeout(2000);
    await page
      .locator("form")
      .evaluate((form) => (form as HTMLFormElement).requestSubmit());

    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN, { timeout: 60_000 });
    await expect(page.getByText(ANONYMOUS_TIER_PATTERN).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(READY_TO_VERIFY_PATTERN).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
