import { expect, type Page, test } from "@playwright/test";

import { MailCapture } from "../helpers/mail-capture";
import { createPasswordVaultUser } from "../helpers/vault-user";
import { addPrfAuthenticator } from "../helpers/virtual-authenticator";

const ADD_PASSKEY = /^add passkey$/i;
const CREATE_RECOVERY_KEY = /^create recovery key$/i;
const USE_PASSWORD = /^use your password$/i;
const USE_PASSKEY = /^use a passkey$/i;
const USE_RECOVERY_KEY = /^use your recovery key$/i;
const UNLOCK = /^unlock$/i;
const UNLOCK_WITH_RECOVERY_KEY = /^unlock with recovery key$/i;
const SAVED_CONFIRMATION = /i saved my recovery key somewhere safe/i;
const SAVE_RECOVERY_KEY = /^save recovery key$/i;
const RECOVERY_KEY_CREATED = /^Created /;
const DATA_OPEN = /your encrypted data is open/i;
const DATA_LOCKED = /your encrypted data can't be opened/i;
const RESET_NOTICE = /a new password restores sign-in/i;
const EMAIL_LABEL = /^Email$/i;
const PASSWORD_LABEL = /^Password$/i;
const SIGN_IN = /^sign in$/i;
const RECOVERY_VAULT_URL = /\/recovery\/vault/;
const RECOVERY_PASSKEY_URL = /\/recovery\/passkey/;
const VERIFY_URL = /\/dashboard\/verify/;
const SIGN_IN_URL = /\/sign-in/;
const BREACH_CHECK_DONE =
  /not found in known breaches|couldn't check breaches/i;

test.use({ storageState: { cookies: [], origins: [] } });

let mail: MailCapture;

test.beforeAll(async () => {
  mail = await MailCapture.start();
});

test.afterAll(async () => {
  await mail.close();
});

async function unlockWithPassword(page: Page, password: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: USE_PASSWORD }).click();
  await dialog.getByLabel(PASSWORD_LABEL).fill(password);
  await dialog.getByRole("button", { name: UNLOCK }).click();
}

async function saveRecoveryKey(page: Page): Promise<string> {
  const words = page.getByTestId("recovery-key-words");
  await expect(words.locator("li")).toHaveCount(24, { timeout: 30_000 });
  const phrase = (await words.locator("li span:last-child").allTextContents())
    .map((word) => word.trim())
    .join(" ");
  await page.screenshot({
    path: test.info().outputPath("recovery-key-setup.png"),
  });
  await page.getByLabel(SAVED_CONFIRMATION).check();
  await page.getByRole("button", { name: SAVE_RECOVERY_KEY }).click();
  await expect(page.getByText(RECOVERY_KEY_CREATED)).toBeVisible();
  return phrase;
}

async function resetPassword(page: Page, email: string): Promise<string> {
  await page.goto("/recovery/password");
  await page.getByRole("textbox", { name: EMAIL_LABEL }).fill(email);
  await page.getByRole("button", { name: "Send Reset Link" }).click();
  await page.goto(await mail.waitForLink(email));

  await expect(page.getByText(RESET_NOTICE)).toBeVisible();
  const newPassword = `Reset-${crypto.randomUUID()}`;
  await page.getByLabel("New Password").fill(newPassword);
  await page.getByLabel("Confirm Password").fill(newPassword);
  await page.getByLabel("Confirm Password").blur();
  await expect(page.getByText(BREACH_CHECK_DONE)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Reset Password" }).click();

  await page.waitForURL(SIGN_IN_URL);
  await page.getByRole("textbox", { name: EMAIL_LABEL }).fill(email);
  await page.getByLabel(PASSWORD_LABEL).fill(newPassword);
  await page.getByRole("button", { name: SIGN_IN }).click();
  await page.waitForURL(RECOVERY_VAULT_URL);
  return newPassword;
}

test.describe("Vault recovery", () => {
  test.setTimeout(180_000);

  test("recovers a lost passkey with the recovery key", async ({ page }) => {
    await page.goto("/");
    const authenticator = await addPrfAuthenticator(page);
    const { email, password } = await createPasswordVaultUser(page, {
      firstName: "Ada",
    });

    await page.goto("/dashboard/settings");
    await page.getByRole("button", { name: ADD_PASSKEY }).click();
    await unlockWithPassword(page, password);
    await expect(page.getByText("Passkey 1")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: CREATE_RECOVERY_KEY }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: USE_PASSKEY })
      .click();
    const phrase = await saveRecoveryKey(page);

    await authenticator.remove();
    await page.context().clearCookies();

    await page.goto("/recovery/passkey");
    await page.getByLabel(EMAIL_LABEL).fill(email);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await page.goto(await mail.waitForLink(email));
    await page.waitForURL(RECOVERY_PASSKEY_URL);

    await addPrfAuthenticator(page);
    await page.getByRole("button", { name: "Create new passkey" }).click();
    await page.getByRole("button", { name: USE_RECOVERY_KEY }).click();
    await page.getByLabel("Recovery key").fill(phrase);
    await page.getByRole("button", { name: UNLOCK_WITH_RECOVERY_KEY }).click();

    await expect(page.getByText(DATA_OPEN)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("recovered-secrets")).toContainText(
      "Verified profile"
    );
    await page.screenshot({
      path: test.info().outputPath("lost-passkey-success.png"),
    });

    await page.goto("/dashboard/settings");
    await expect(page.getByText("Recovery Passkey")).toBeVisible();
    await expect(page.getByText("Passkey 1")).toHaveCount(0);

    await page.goto("/dashboard/settings?tab=profile");
    await page
      .getByRole("button", { name: "Show personal information" })
      .click();
    await page.getByRole("button", { name: UNLOCK }).click();
    await expect(page.getByText("Ada", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("reconnects a reset password with the recovery key", async ({
    page,
  }) => {
    await page.goto("/");
    const { email, password } = await createPasswordVaultUser(page, {
      firstName: "Grace",
    });

    await page.goto("/dashboard/settings");
    await page.getByRole("button", { name: CREATE_RECOVERY_KEY }).click();
    await unlockWithPassword(page, password);
    const phrase = await saveRecoveryKey(page);

    await page.context().clearCookies();
    const newPassword = await resetPassword(page, email);

    await page.getByRole("button", { name: USE_RECOVERY_KEY }).click();
    await page.getByLabel("Recovery key").fill(phrase);
    await page.getByRole("button", { name: UNLOCK_WITH_RECOVERY_KEY }).click();

    await page.getByLabel("Your password").fill(newPassword);
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByText("Password connected")).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "Done" }).click();

    await expect(page.getByText(DATA_OPEN)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("recovered-secrets")).toContainText(
      "Verified profile"
    );
  });

  test("says plainly when nothing can open the vault", async ({ page }) => {
    await page.goto("/");
    const { email } = await createPasswordVaultUser(page, {
      firstName: "Linus",
    });

    await page.context().clearCookies();
    await resetPassword(page, email);

    await expect(page.getByText(DATA_LOCKED)).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("no-credential.png"),
    });

    await page
      .getByRole("button", { name: "Start over with new keys" })
      .click();
    await page.waitForURL(VERIFY_URL);
  });
});
