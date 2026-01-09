import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { type Download, expect, type Page, test } from "@playwright/test";

const SEED_PATH = fileURLToPath(new URL("./.auth/seed.json", import.meta.url));
const APPROVAL_TEXT_RE = /Approval recorded|Recovery approved/;
const RECOVERY_ID_RE = /^rec_[a-z0-9]+$/;
const BACKUP_CODE_RE = /[A-Za-z0-9]{5}-[A-Za-z0-9]{5}/g;
const INVALID_CODE_RE = /Invalid authenticator or backup code/i;
const RECOVERY_LINK_RE = /https?:\/\/[^\s"]+\/recover-guardian\?token=[^\s"]+/g;
const SHOW_MANUAL_LINKS_RE = /Show manual links/i;
const ENABLE_TWO_FACTOR_RE = /Enable Two-Factor/i;
const TWO_FACTOR_DIALOG_RE = /Two-Factor/i;
const BACKUP_CODES_DIALOG_RE = /Backup Codes/i;
const VERIFY_2FA_URL_RE = /\/verify-2fa/;
const MAILPIT_BASE_URL = (
  process.env.MAILPIT_BASE_URL || "http://localhost:8025"
).replace(/\/$/, "");

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function _getSeedPassword(): string {
  if (process.env.E2E_PASSWORD) {
    return process.env.E2E_PASSWORD;
  }
  try {
    const raw = readFileSync(SEED_PATH, "utf8");
    const parsed = JSON.parse(raw) as { password?: string };
    if (parsed.password) {
      return parsed.password;
    }
  } catch {
    // Fall through.
  }
  throw new Error("E2E seed password not found.");
}

function parseBackupCodes(text: string): string[] {
  const matches = text.match(BACKUP_CODE_RE) ?? [];
  return Array.from(new Set(matches.map((code) => code.trim())));
}

async function readDownload(download: Download): Promise<string> {
  const path = await download.path();
  if (!path) {
    throw new Error("Download path missing.");
  }
  return readFileSync(path, "utf8");
}

async function fetchMailpitApprovalLinks(
  expectedCount: number,
  timeoutMs = 30_000
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  const links = new Set<string>();

  while (Date.now() < deadline && links.size < expectedCount) {
    try {
      const listResponse = await fetch(`${MAILPIT_BASE_URL}/api/v1/messages`);
      if (!listResponse.ok) {
        await sleep(1000);
        continue;
      }

      const listData = (await listResponse.json()) as {
        messages?: Record<string, unknown>[];
        Messages?: Record<string, unknown>[];
        items?: Record<string, unknown>[];
      };
      const messages =
        listData.messages ?? listData.Messages ?? listData.items ?? [];

      for (const message of messages) {
        const id =
          (message.ID as string | undefined) ||
          (message.Id as string | undefined) ||
          (message.id as string | undefined);
        if (!id) {
          continue;
        }
        const detailResponse = await fetch(
          `${MAILPIT_BASE_URL}/api/v1/message/${id}`
        );
        if (!detailResponse.ok) {
          continue;
        }
        const detail = (await detailResponse.json()) as {
          Text?: string;
          text?: string;
          HTML?: string;
          html?: string;
        };
        const body = `${detail.Text ?? detail.text ?? ""}\n${
          detail.HTML ?? detail.html ?? ""
        }`;
        const matches = body.match(RECOVERY_LINK_RE) ?? [];
        for (const match of matches) {
          links.add(match);
        }
      }
    } catch {
      // Ignore transient Mailpit errors and retry.
    }

    if (links.size < expectedCount) {
      await sleep(1000);
    }
  }

  return Array.from(links);
}

async function getGuardianApprovalLinks(
  page: Page,
  expectedCount: number
): Promise<string[]> {
  const showManualButton = page.getByRole("button", {
    name: SHOW_MANUAL_LINKS_RE,
  });
  if (await showManualButton.isVisible().catch(() => false)) {
    await showManualButton.click();
  }

  const approvalInputs = page.locator("input[data-guardian-link]");
  const approvalCount = await approvalInputs.count();
  if (approvalCount > 0) {
    const links: string[] = [];
    for (let i = 0; i < approvalCount; i += 1) {
      links.push(await approvalInputs.nth(i).inputValue());
    }
    return links;
  }

  const mailpitLinks = await fetchMailpitApprovalLinks(expectedCount);
  if (mailpitLinks.length < expectedCount) {
    throw new Error("No guardian approval links available.");
  }
  return mailpitLinks.slice(0, expectedCount);
}

async function ensureRecoveryEnabled(page: Page) {
  await page.goto("/dashboard/settings", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle");
  if (page.url().includes("/sign-in")) {
    throw new Error(
      "E2E storage state missing. Ensure global setup logs in successfully."
    );
  }

  const socialRecoveryHeading = page
    .getByText("Social recovery", { exact: true })
    .first();
  await expect(socialRecoveryHeading).toBeVisible();
  await socialRecoveryHeading.scrollIntoViewIfNeeded();

  const enableButton = page.getByRole("button", { name: "Enable recovery" });
  if (await enableButton.isVisible()) {
    await enableButton.click();
    const guardianInput = page.getByPlaceholder("guardian@example.com");
    try {
      await expect(guardianInput).toBeVisible();
    } catch (error) {
      const stillEnabled = await enableButton.isVisible().catch(() => false);
      if (stillEnabled) {
        throw new Error(
          "Recovery setup did not complete. Ensure signer coordinator and signer endpoints are running."
        );
      }
      throw error;
    }
  }
}

async function getRecoveryId(page: Page): Promise<string> {
  const recoveryIdInput = page.locator('input[readonly][value^="rec_"]');
  await recoveryIdInput.first().scrollIntoViewIfNeeded();
  await expect(recoveryIdInput).toBeVisible();
  const value = await recoveryIdInput.first().inputValue();
  if (!RECOVERY_ID_RE.test(value)) {
    throw new Error(`Unexpected recovery ID: ${value}`);
  }
  return value;
}

async function ensureGuardianEmails(page: Page, emails: string[]) {
  await page.getByText("Guardians", { exact: true }).scrollIntoViewIfNeeded();
  for (const email of emails) {
    const alreadyVisible = await page
      .getByText(email, { exact: false })
      .isVisible()
      .catch(() => false);
    if (alreadyVisible) {
      continue;
    }

    const input = page.getByPlaceholder("guardian@example.com");
    await input.fill(email);
    await page.getByRole("button", { name: "Add guardian" }).click();
    await expect(page.getByText(email)).toBeVisible();
  }
}

async function ensureTwoFactorEnabled(
  page: Page,
  password: string
): Promise<{
  totpUri: string | null;
  backupCodes: string[];
}> {
  const enableButton = page.getByRole("button", {
    name: ENABLE_TWO_FACTOR_RE,
  });
  await enableButton.first().scrollIntoViewIfNeeded();

  const canEnable = await enableButton
    .first()
    .isVisible()
    .catch(() => false);
  if (!canEnable) {
    throw new Error("Two-factor authentication is already enabled.");
  }

  await enableButton.first().click();

  const setupDialog = page
    .getByRole("dialog")
    .filter({ hasText: TWO_FACTOR_DIALOG_RE })
    .first();
  await expect(setupDialog).toBeVisible();

  const passwordInput = setupDialog.getByLabel("Password");
  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(password);
  }
  await setupDialog.getByRole("button", { name: ENABLE_TWO_FACTOR_RE }).click();

  const backupDialog = page
    .getByRole("dialog")
    .filter({ hasText: BACKUP_CODES_DIALOG_RE })
    .first();
  await expect(backupDialog).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await backupDialog.getByRole("button", { name: "Download codes" }).click();
  const download = await downloadPromise;
  const contents = await readDownload(download);
  const backupCodes = parseBackupCodes(contents);
  if (backupCodes.length === 0) {
    throw new Error("No backup codes found in download.");
  }
  await backupDialog.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(VERIFY_2FA_URL_RE, { timeout: 30_000 });
  const totpUri = new URL(page.url()).searchParams.get("totpURI");
  if (!totpUri) {
    throw new Error("TOTP URI not found in verify flow.");
  }

  const totpCode = await computeTotpFromUri(totpUri);
  await fillOtpCode(page, totpCode);
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL("/dashboard/settings", { timeout: 30_000 });

  return { totpUri, backupCodes };
}

async function linkAuthenticatorGuardian(page: Page) {
  const guardianRow = page.getByText("Authenticator app", { exact: true });
  if (await guardianRow.isVisible().catch(() => false)) {
    return;
  }

  const linkButton = page.getByRole("button", {
    name: "Link authenticator guardian",
  });
  await linkButton.scrollIntoViewIfNeeded();
  await expect(linkButton).toBeEnabled();
  await linkButton.click();
  await expect(guardianRow).toBeVisible();
}

async function computeTotpFromUri(totpUri: string): Promise<string> {
  const url = new URL(totpUri);
  const secretBase32 = url.searchParams.get("secret");
  if (!secretBase32) {
    throw new Error("TOTP URI missing secret.");
  }
  const decoded = base32.decode(secretBase32);
  const secret = new TextDecoder().decode(decoded);
  return await createOTP(secret, { digits: 6, period: 30 }).totp();
}

async function fillOtpCode(page: Page, code: string) {
  const otpContainer = page.locator('[data-slot="input-otp"]');
  await otpContainer.click();
  await page.keyboard.type(code);
}

async function openRecoveryFlow(page: Page, identifier: string) {
  await page.goto("/recover-social", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Email or Recovery ID").fill(identifier);
  await page.getByRole("button", { name: "Start guardian recovery" }).click();
  await expect(page.getByText("Step 2 of 3 · Guardian approvals")).toBeVisible({
    timeout: 30_000,
  });
}

test.describe
  .serial("Social Recovery", () => {
    let recoveryId = "";
    let backupCodes: string[] = [];
    let usedBackupCode = "";
    let totpUri: string | null = null;

    test("setup recovery ID + authenticator guardian + backup codes", async ({
      page,
    }) => {
      const guardianEmails = [
        "guardian.one@example.com",
        "guardian.two@example.com",
      ];
      const seedPassword = _getSeedPassword();

      await ensureRecoveryEnabled(page);
      await ensureGuardianEmails(page, guardianEmails);
      const backupAuth = await ensureTwoFactorEnabled(page, seedPassword);
      await linkAuthenticatorGuardian(page);

      recoveryId = await getRecoveryId(page);
      totpUri = backupAuth.totpUri;
      backupCodes = backupAuth.backupCodes;
      expect(backupCodes.length).toBeGreaterThan(0);
    });

    test("rejects missing or invalid identifiers", async ({ page }) => {
      await page.goto("/recover-social", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForLoadState("networkidle");
      const identifierInput = page.getByLabel("Email or Recovery ID");
      await expect(identifierInput).toBeEnabled();
      await page
        .getByRole("button", { name: "Start guardian recovery" })
        .click();
      await expect(
        page.locator("text=Step 1 of 3 · Verify your account")
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByText("Email or Recovery ID is required")
      ).toBeVisible();

      await identifierInput.fill("not-an-email");
      const startButton = page.getByRole("button", {
        name: "Start guardian recovery",
      });
      await startButton.click();
      await expect(
        page.getByText("Enter a valid email or Recovery ID")
      ).toBeVisible();
    });

    test("recovers with Recovery ID + authenticator approval + guardian links", async ({
      page,
    }) => {
      if (!recoveryId) {
        throw new Error("Recovery ID was not initialized.");
      }
      if (backupCodes.length === 0) {
        throw new Error("Backup codes were not initialized.");
      }

      await openRecoveryFlow(page, recoveryId);
      const approvalLinks = await getGuardianApprovalLinks(page, 2);

      await expect(page.getByText("Authenticator approval")).toBeVisible({
        timeout: 30_000,
      });

      await fillOtpCode(page, "000000");
      await page
        .getByRole("button", { name: "Approve with authenticator" })
        .click();
      await expect(page.getByText(INVALID_CODE_RE).first()).toBeVisible({
        timeout: 10_000,
      });

      await page.getByRole("button", { name: "Use a backup code" }).click();
      usedBackupCode = backupCodes[0] ?? "";
      await page.getByPlaceholder("XXXXX-XXXXX").fill(usedBackupCode);
      await page
        .getByRole("button", { name: "Approve with backup code" })
        .click();
      await expect(page.getByText("Approved")).toBeVisible();

      const guardianPage = await page.context().newPage();
      for (const link of approvalLinks) {
        await guardianPage.goto(link, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        await guardianPage
          .getByRole("button", { name: "Approve recovery" })
          .click();
        await expect(guardianPage.getByText(APPROVAL_TEXT_RE)).toBeVisible({
          timeout: 30_000,
        });
      }
      await guardianPage.close();

      await expect(
        page.getByRole("button", { name: "Register new passkey" })
      ).toBeVisible({ timeout: 30_000 });
    });

    test("authenticator guardian accepts TOTP codes when available", async ({
      page,
    }) => {
      test.skip(!totpUri, "TOTP URI not available for TOTP test.");

      const totp = await computeTotpFromUri(totpUri as string);
      await openRecoveryFlow(page, recoveryId);

      await fillOtpCode(page, totp);
      await page
        .getByRole("button", { name: "Approve with authenticator" })
        .click();
      await expect(page.getByText("Approved")).toBeVisible({ timeout: 30_000 });
    });

    test("rejects reused backup codes", async ({ page }) => {
      if (!(recoveryId && usedBackupCode)) {
        throw new Error(
          "Recovery ID or used backup code missing for reuse test."
        );
      }

      await openRecoveryFlow(page, recoveryId);

      await page.getByRole("button", { name: "Use a backup code" }).click();
      await page.getByPlaceholder("XXXXX-XXXXX").fill(usedBackupCode);
      await page
        .getByRole("button", { name: "Approve with backup code" })
        .click();
      await expect(page.getByText(INVALID_CODE_RE).first()).toBeVisible({
        timeout: 10_000,
      });
    });
  });
