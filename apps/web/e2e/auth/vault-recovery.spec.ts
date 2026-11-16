import { createClient } from "@libsql/client";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { MailCapture } from "../helpers/mail-capture";
import { createPasswordVaultUser } from "../helpers/vault-user";
import {
  addPrfAuthenticator,
  registerPasskeyForUser,
} from "../helpers/virtual-authenticator";
import {
  cibaLoginHint,
  findCibaRequestId,
  registerCibaClient,
} from "../oidc/oidc-helpers";

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
const CONFIRM_PASSKEY = /^use passkey$/i;
const EMAIL_ME_A_LINK = /^email me a link$/i;
const LINK_SENT = /we sent a sign-in link/i;
const START_OVER = /^start over with new keys$/i;
const CANT_USE_ANY = /^i can't use any of these$/i;
const BREACH_CHECK_DONE =
  /not found in known breaches|couldn't check breaches/i;
const SAVE_NEW_RECOVERY_KEY = /save your new recovery key/i;
const CONFIRM = /^confirm$/i;
const CANCEL = /^cancel$/i;
const USE_YOUR_PASSWORD = /^use your password$/i;
const CONFIRM_ITS_YOU = /confirm it's you/i;
const NOTHING_CHANGED = /nothing was changed/i;
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
const DASHBOARD_URL = /\/dashboard/;
const SETTINGS_URL = /\/dashboard\/settings/;
const USE_PASSKEY_AFTER_ALL = /^use a passkey after all$/i;
const PASSKEY_NOT_VERIFIED = /didn't ask for your PIN, fingerprint, or face/i;
const GO_TO_SETTINGS = /^go to settings$/i;
const CREATE_NEW_PASSKEY = /^create new passkey$/i;
const USE_YOUR_WALLET = /^use your wallet$/i;
const EMAIL_LINK_HELD = /you confirmed with an email link/i;
const BASE_URL = (
  process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

test.use({ storageState: { cookies: [], origins: [] } });

let mail: MailCapture;

test.beforeAll(async () => {
  mail = await MailCapture.start();
});

test.afterAll(async () => {
  await mail.close();
});

async function withDatabase<T>(
  run: (client: ReturnType<typeof createClient>) => Promise<T>
): Promise<T> {
  const url =
    process.env.E2E_TURSO_DATABASE_URL ?? process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error("E2E database URL is not configured.");
  }
  const client = createClient({ url });
  try {
    await client.execute("PRAGMA busy_timeout = 5000");
    return await run(client);
  } finally {
    client.close();
  }
}

/** Moves the account's password back 8 days, as if it were set last week. */
async function agePassword(email: string): Promise<void> {
  await withDatabase((client) =>
    client.execute({
      sql: `UPDATE account SET updatedAt = ?
        WHERE providerId = 'opaque'
          AND userId = (SELECT id FROM "user" WHERE email = ?)`,
      args: [Date.now() - EIGHT_DAYS_MS, email],
    })
  );
}

type Wallet = ReturnType<typeof privateKeyToAccount>;

/**
 * An account that signed up with a wallet 8 days ago, verified a real email
 * address, and holds one passkey, which this browser does not have.
 */
async function createWalletPasskeyAccount(email: string): Promise<Wallet> {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const userId = crypto.randomUUID();
  const linkedAt = Date.now() - EIGHT_DAYS_MS;
  await withDatabase((client) =>
    client.batch(
      [
        {
          sql: `INSERT INTO "user" (id, name, email, emailVerified, is_anonymous, createdAt, updatedAt)
            VALUES (?, '', ?, 1, 0, ?, ?)`,
          args: [userId, email, linkedAt, linkedAt],
        },
        {
          sql: `INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt)
            VALUES (?, ?, 'eip712', ?, ?, ?)`,
          args: [crypto.randomUUID(), userId, userId, linkedAt, linkedAt],
        },
        {
          sql: `INSERT INTO wallet_address (id, user_id, address, chain_id, is_primary, created_at)
            VALUES (?, ?, ?, 1, 1, ?)`,
          args: [
            crypto.randomUUID(),
            userId,
            wallet.address,
            new Date(linkedAt).toISOString(),
          ],
        },
        {
          sql: `INSERT INTO passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, createdAt)
            VALUES (?, 'Lost passkey', 'lost', ?, ?, 0, 'singleDevice', 0, ?)`,
          args: [crypto.randomUUID(), userId, crypto.randomUUID(), linkedAt],
        },
      ],
      "write"
    )
  );
  return wallet;
}

async function passkeyEnrollmentMethods(email: string): Promise<unknown[]> {
  const result = await withDatabase((client) =>
    client.execute({
      sql: `SELECT enrollment_method FROM passkey
        WHERE userId = (SELECT id FROM "user" WHERE email = ?)
        ORDER BY createdAt`,
      args: [email],
    })
  );
  return result.rows.map((row) => row.enrollment_method);
}

/**
 * Confirms the wallet in the page's session as its "Use your wallet" button
 * does. The test browser has no wallet extension, so the test signs.
 */
async function confirmWalletInSession(page: Page, wallet: Wallet) {
  const challenge = await page.request.post(
    "/api/auth/wallet/siwe/verify/challenge",
    {
      data: { address: wallet.address, chainId: 1 },
      headers: { Origin: BASE_URL },
    }
  );
  expect(challenge.ok(), await challenge.text()).toBeTruthy();
  const { message } = (await challenge.json()) as { message: string };
  const complete = await page.request.post(
    "/api/auth/wallet/siwe/verify/complete",
    {
      data: { message, signature: await wallet.signMessage({ message }) },
      headers: { Origin: BASE_URL },
    }
  );
  expect(complete.ok(), await complete.text()).toBeTruthy();
}

async function signInWithPassword(
  page: Page,
  credentials: { email: string; password: string },
  callbackURL = "/dashboard"
) {
  await page.goto(`/sign-in?callbackURL=${encodeURIComponent(callbackURL)}`);
  await page
    .getByRole("textbox", { name: EMAIL_LABEL })
    .fill(credentials.email);
  await page.getByLabel(PASSWORD_LABEL).fill(credentials.password);
  await page.getByRole("button", { name: SIGN_IN }).click();
}

/** Enters the recovery key on the account recovery page. */
async function confirmWithRecoveryKey(page: Page, phrase: string) {
  await page.getByRole("button", { name: USE_RECOVERY_KEY }).click();
  await page.getByLabel("Recovery key").fill(phrase);
  await page.getByRole("button", { name: CONFIRM }).click();
}

async function createRecoveryKeyWithPasskey(page: Page): Promise<string> {
  await page.goto("/dashboard/settings");
  await page.getByRole("button", { name: CREATE_RECOVERY_KEY }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: USE_PASSKEY })
    .click();
  // The account holds a passkey, and the session signed in with the
  // password, so the recovery key needs a passkey confirmation.
  return saveRecoveryKey(page, { confirmWithPasskey: true });
}

/** Approves a CIBA request on the approval page with the page's passkey. */
async function approveWithPasskey(page: Page, request: APIRequestContext) {
  const session = (await (
    await page.request.get("/api/auth/get-session")
  ).json()) as { user: { id: string } };
  const clientId = await registerCibaClient(request, "recovery-e2e");
  const response = await request.post("/api/auth/oauth2/bc-authorize", {
    form: {
      client_id: clientId,
      login_hint: await cibaLoginHint(clientId, session.user.id),
      scope: "openid identity.name",
      binding_message: "Recovered passkey E2E",
    },
    headers: { Origin: BASE_URL },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { auth_req_id } = (await response.json()) as { auth_req_id: string };

  await page.goto(`/approve/${await findCibaRequestId(auth_req_id)}`);
  await page.getByRole("button", { name: "Approve with passkey" }).click();
  await expect(page.getByText("Request Approved")).toBeVisible({
    timeout: 30_000,
  });
}

async function unlockWithPassword(page: Page, password: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: USE_PASSWORD }).click();
  await dialog.getByLabel(PASSWORD_LABEL).fill(password);
  await dialog.getByRole("button", { name: UNLOCK }).click();
}

/** Answers the dialog that asks the user to confirm a recovery change. */
function confirmationDialog(page: Page) {
  return page.getByRole("alertdialog");
}

async function saveRecoveryKey(
  page: Page,
  options: { confirmWithPasskey?: boolean } = {}
): Promise<string> {
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
  if (options.confirmWithPasskey) {
    await confirmationDialog(page)
      .getByRole("button", { name: CONFIRM_PASSKEY })
      .click();
  }
  await expect(page.getByText(RECOVERY_KEY_CREATED)).toBeVisible();
  return phrase;
}

async function resetPassword(page: Page, email: string): Promise<string> {
  await page.goto("/recovery/password");
  await page.getByRole("textbox", { name: EMAIL_LABEL }).fill(email);
  await page.getByRole("button", { name: "Send Reset Link" }).click();
  await page.goto(await mail.waitForLink(email, "/recovery/password/reset"));

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

    const phrase = await createRecoveryKeyWithPasskey(page);

    await authenticator.remove();
    await page.context().clearCookies();

    await page.goto("/recovery/passkey");
    await page.getByLabel(EMAIL_LABEL).fill(email);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await page.goto(await mail.waitForLink(email, "/magic-link/verify"));
    await page.waitForURL(RECOVERY_PASSKEY_URL);

    // The email link alone recovers only an account with nothing else; this
    // one has a password and a recovery key, so it asks for the key too.
    // Entering it also opens the vault.
    await confirmWithRecoveryKey(page, phrase);
    await addPrfAuthenticator(page);
    await page.getByRole("button", { name: "Create new passkey" }).click();

    // The key confirmed this recovery, so the page offers a new one.
    await expect(page.getByText(SAVE_NEW_RECOVERY_KEY)).toBeVisible({
      timeout: 60_000,
    });
    await page.getByLabel(SAVED_CONFIRMATION).check();
    await page.getByRole("button", { name: SAVE_RECOVERY_KEY }).click();

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

    await page.getByRole("button", { name: START_OVER }).click();
    await page.waitForURL(VERIFY_URL);
  });

  test("never lets a password reset by email confirm a recovery, even a week later", async ({
    page,
  }) => {
    await page.goto("/");
    const authenticator = await addPrfAuthenticator(page);
    const { email, password } = await createPasswordVaultUser(page, {
      firstName: "Barbara",
    });
    await page.goto("/dashboard/settings");
    await page.getByRole("button", { name: ADD_PASSKEY }).click();
    await unlockWithPassword(page, password);
    await expect(page.getByText("Passkey 1")).toBeVisible({ timeout: 30_000 });

    await authenticator.remove();
    await page.context().clearCookies();
    const newPassword = await resetPassword(page, email);

    // A password session cannot reset the vault of an account that holds a
    // passkey; the user has no passkey, so they ask for an email link.
    await page.getByRole("button", { name: CANT_USE_ANY }).click();
    await page.getByRole("button", { name: START_OVER }).click();
    const dialog = confirmationDialog(page);
    await expect(dialog).toContainText(email);
    await page.screenshot({
      path: test.info().outputPath("confirm-by-email.png"),
    });
    await dialog.getByRole("button", { name: EMAIL_ME_A_LINK }).click();
    await expect(page.getByText(LINK_SENT)).toBeVisible();

    await page.goto(await mail.waitForLink(email, "/magic-link/verify"));
    await page.waitForURL(RECOVERY_VAULT_URL);
    await page.getByRole("button", { name: CANT_USE_ANY }).click();
    await page.getByRole("button", { name: START_OVER }).click();

    // The same mailbox reset the password, so the password doesn't count,
    // and the email link alone can't confirm the recovery.
    await expect(dialog).toContainText("You confirmed with an email link");
    await expect(
      dialog.getByRole("button", { name: USE_YOUR_PASSWORD })
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: CANCEL }).click();
    await expect(page.getByText(NOTHING_CHANGED)).toBeVisible();

    // Waiting a week changes nothing: a mailbox alone stays one factor.
    await agePassword(email);
    await page.getByRole("button", { name: START_OVER }).click();
    await expect(dialog).toContainText("You confirmed with an email link");
    await expect(
      dialog.getByRole("button", { name: USE_YOUR_PASSWORD })
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: CANCEL }).click();
    await expect(page.getByText(NOTHING_CHANGED)).toBeVisible();

    // The reset password still signs in.
    await page.context().clearCookies();
    await signInWithPassword(
      page,
      { email, password: newPassword },
      "/recovery/vault"
    );
    await page.waitForURL(RECOVERY_VAULT_URL);
  });

  test("recovers a lost passkey with an email link and a wallet confirmed on the page", async ({
    page,
  }) => {
    const email = `wallet-recovery-${crypto.randomUUID()}@example.com`;
    const wallet = await createWalletPasskeyAccount(email);

    await page.goto("/recovery/passkey");
    await page.getByLabel(EMAIL_LABEL).fill(email);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await page.goto(await mail.waitForLink(email, "/magic-link/verify"));
    await page.waitForURL(RECOVERY_PASSKEY_URL);

    // The email link started a session; the wallet confirms inside it
    // instead of signing in again, which would start another.
    await expect(page.getByText(EMAIL_LINK_HELD)).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: USE_YOUR_WALLET })
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("email-link-then-wallet.png"),
    });
    await confirmWalletInSession(page, wallet);

    await page.reload();
    await addPrfAuthenticator(page);
    await page.getByRole("button", { name: CREATE_NEW_PASSKEY }).click();
    await expect
      .poll(() => passkeyEnrollmentMethods(email), { timeout: 30_000 })
      .toEqual([null, "account_recovery"]);
  });

  test("recovers a lost passkey with the password and the recovery key, then approves with the new one", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const authenticator = await addPrfAuthenticator(page);
    const credentials = await createPasswordVaultUser(page, {
      firstName: "Hedy",
    });
    await registerPasskeyForUser(page, credentials.password);
    const phrase = await createRecoveryKeyWithPasskey(page);

    // A new browser: no session, and an authenticator without the passkey.
    await authenticator.remove();
    await page.context().clearCookies();
    await addPrfAuthenticator(page);
    await signInWithPassword(page, credentials, "/recovery/passkey");
    await page.waitForURL(RECOVERY_PASSKEY_URL);

    await expect(
      page.getByText("You confirmed with your password")
    ).toBeVisible({ timeout: 30_000 });
    await confirmWithRecoveryKey(page, phrase);
    await page.getByRole("button", { name: "Create new passkey" }).click();
    await expect(page.getByText(SAVE_NEW_RECOVERY_KEY)).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: CANCEL }).click();
    await expect(page.getByText(DATA_OPEN)).toBeVisible({ timeout: 60_000 });

    await page.goto("/dashboard/settings");
    await expect(page.getByText("Recovery Passkey")).toBeVisible();
    await expect(page.getByText("Passkey 1")).toHaveCount(0);

    await approveWithPasskey(page, request);
  });

  test("a passkey that still works leads to Settings instead of replacing it", async ({
    page,
  }) => {
    await page.goto("/");
    await addPrfAuthenticator(page);
    const credentials = await createPasswordVaultUser(page, {
      firstName: "Grace",
    });
    await registerPasskeyForUser(page, credentials.password);

    await page.context().clearCookies();
    await signInWithPassword(page, credentials, "/recovery/passkey");
    await page.waitForURL(RECOVERY_PASSKEY_URL);

    await page.getByRole("button", { name: USE_PASSKEY_AFTER_ALL }).click();
    await expect(page.getByRole("link", { name: GO_TO_SETTINGS })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: CREATE_NEW_PASSKEY })
    ).toHaveCount(0);

    await page.getByRole("link", { name: GO_TO_SETTINGS }).click();
    await page.waitForURL(SETTINGS_URL);
    await expect(page.getByText("Passkey 1")).toBeVisible({ timeout: 30_000 });
  });

  test("a passkey that does not verify the user can't confirm a recovery", async ({
    page,
  }) => {
    await page.goto("/");
    await addPrfAuthenticator(page, { userVerification: false });
    const credentials = await createPasswordVaultUser(page, {
      firstName: "Barbara",
    });
    await registerPasskeyForUser(page, credentials.password);

    await page.context().clearCookies();
    await signInWithPassword(page, credentials, "/recovery/passkey");
    await page.waitForURL(RECOVERY_PASSKEY_URL);

    await page.getByRole("button", { name: USE_PASSKEY_AFTER_ALL }).click();
    await expect(page.getByText(PASSKEY_NOT_VERIFIED)).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: USE_PASSWORD })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: GO_TO_SETTINGS })).toHaveCount(
      0
    );
  });

  test("a password alone cannot add a passkey to an account that holds one", async ({
    page,
  }) => {
    await page.goto("/");
    const authenticator = await addPrfAuthenticator(page);
    const credentials = await createPasswordVaultUser(page, {
      firstName: "Mallory",
    });
    await registerPasskeyForUser(page, credentials.password);

    await authenticator.remove();
    await page.context().clearCookies();
    const attackerAuthenticator = await addPrfAuthenticator(page);
    await signInWithPassword(page, credentials);
    await page.waitForURL(DASHBOARD_URL);

    const options = await page.request.get(
      "/api/auth/passkey/generate-register-options"
    );
    expect(options.status()).toBe(403);
    expect(await options.json()).toMatchObject({
      code: "REVERIFICATION_REQUIRED",
    });

    await page.goto("/dashboard/settings");
    await page.getByRole("button", { name: ADD_PASSKEY }).click();
    const dialog = confirmationDialog(page);
    await expect(dialog).toContainText(CONFIRM_ITS_YOU);
    await page.screenshot({
      path: test.info().outputPath("add-passkey-refused.png"),
    });
    await dialog.getByRole("button", { name: CANCEL }).click();

    await expect(page.getByText("Passkey 1")).toBeVisible();
    await expect(page.getByText("Passkey 2")).toHaveCount(0);
    expect(await attackerAuthenticator.signCount()).toBe(0);
  });
});
