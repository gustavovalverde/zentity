import type { Page } from "@playwright/test";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "./fixtures/synpress";
import { connectWalletIfNeeded } from "./helpers/connect-wallet";
import { confirmSignature, confirmTransaction } from "./helpers/metamask";

// Top-level regex patterns for lint/performance/useTopLevelRegex compliance
const WELCOME_OR_SIGN_IN_PATTERN = /welcome back|sign in/i;
const DASHBOARD_URL_PATTERN = /dashboard/;
const ATTESTATION_URL_PATTERN = /dashboard\/attestation/;
const WELCOME_HEADING_PATTERN = /welcome/i;
const ON_CHAIN_ATTESTATION_HEADING = /On-Chain Attestation/i;
const COMPLETE_VERIFICATION_TEXT = /Complete identity verification first/i;
const REGISTER_ON_BUTTON = /Register on/i;
const UPDATE_ATTESTATION_BUTTON = /Update Attestation/i;
const ATTESTED_ON_TEXT = /Attested on/i;
const TRANSACTION_PENDING_TEXT = /Transaction Pending/i;
const CHECK_STATUS_BUTTON = /Check Status/i;
const DECRYPT_VIEW_BUTTON = /Decrypt & View/i;
const COMPLIANCE_GRANTED_TEXT = /Compliance access granted/i;
const GRANT_COMPLIANCE_BUTTON = /Grant Compliance Access/i;
const TOKENS_MINTED_TEXT = /Tokens minted successfully/i;
const FHE_INITIALIZING_TEXT = /Initializing FHE encryption/i;
const RECIPIENT_NOT_ATTESTED_TEXT = /Recipient not attested/i;
const RECIPIENT_ATTESTED_TEXT = /Recipient is attested/i;
const TRANSFER_BUTTON_PATTERN = /^Transfer$/;
const TRANSFER_SUCCESS_TEXT = /Transfer submitted!/i;
const TRANSFER_REVERTED_TEXT = /transfer.*reverted/i;

const sepoliaRpcUrl =
  process.env.E2E_SEPOLIA_RPC_URL ??
  process.env.NEXT_PUBLIC_FHEVM_RPC_URL ??
  process.env.FHEVM_RPC_URL ??
  "";
const sepoliaChainId = Number(
  process.env.E2E_SEPOLIA_CHAIN_ID ??
    process.env.NEXT_PUBLIC_FHEVM_CHAIN_ID ??
    process.env.FHEVM_CHAIN_ID ??
    11_155_111
);
const sepoliaNetworkName =
  process.env.E2E_SEPOLIA_NETWORK_NAME ??
  process.env.FHEVM_NETWORK_NAME ??
  process.env.NEXT_PUBLIC_FHEVM_NETWORK_NAME ??
  "fhEVM (Sepolia)";
const sepoliaSymbol = process.env.E2E_SEPOLIA_SYMBOL ?? "SepoliaETH";
const sepoliaExplorer = process.env.E2E_SEPOLIA_EXPLORER_URL ?? "";

const senderAddress =
  process.env.E2E_SEPOLIA_SENDER_ADDRESS ??
  process.env.E2E_SENDER_ADDRESS ??
  "";
const recipientAddress =
  process.env.E2E_SEPOLIA_RECIPIENT_ADDRESS ??
  process.env.E2E_RECIPIENT_ADDRESS ??
  "";
const senderAccountName =
  process.env.E2E_SEPOLIA_ACCOUNT_NAME ??
  process.env.E2E_ACCOUNT_NAME ??
  process.env.SYNPRESS_ACCOUNT_NAME ??
  "Account 2";

const sepoliaNetwork = {
  name: sepoliaNetworkName,
  rpcUrl: sepoliaRpcUrl,
  chainId: sepoliaChainId,
  symbol: sepoliaSymbol,
  ...(sepoliaExplorer ? { blockExplorerUrl: sepoliaExplorer } : {}),
};

const sepoliaEnabled =
  process.env.E2E_SEPOLIA === "true" &&
  Boolean(sepoliaRpcUrl) &&
  Boolean(
    process.env.FHEVM_REGISTRAR_PRIVATE_KEY || process.env.REGISTRAR_PRIVATE_KEY
  ) &&
  Boolean(process.env.FHEVM_IDENTITY_REGISTRY) &&
  Boolean(process.env.FHEVM_COMPLIANCE_RULES) &&
  Boolean(process.env.FHEVM_COMPLIANT_ERC20);
const runFullFlow = process.env.E2E_SEPOLIA_FULL === "true";

function readAuthSeed() {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const seedPath = path.join(currentDir, ".auth", "seed.json");
    const payload = fs.readFileSync(seedPath, "utf8");
    return JSON.parse(payload) as { email: string; password: string };
  } catch {
    return null;
  }
}

async function ensureSignedIn(page: Page) {
  const signInHeading = page
    .locator(`text=${WELCOME_OR_SIGN_IN_PATTERN.source}`)
    .first();
  if (!(await signInHeading.isVisible().catch(() => false))) {
    return;
  }

  console.log("[e2e] ensureSignedIn: signing in with seed user");
  const seed = readAuthSeed();
  if (!seed) {
    throw new Error("Missing auth seed for E2E sign-in fallback.");
  }

  await page.locator('input[type="email"]').fill(seed.email);
  await page.locator('input[type="password"]').fill(seed.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(DASHBOARD_URL_PATTERN, { timeout: 30_000 });
}

test.describe("Web3 workflow (Sepolia)", () => {
  test.describe.configure({ timeout: 300_000 });
  test.skip(
    !sepoliaEnabled,
    "Set E2E_SEPOLIA=true and configure FHEVM_* contract addresses + RPC URL to run Sepolia E2E."
  );

  test("attest, decrypt, grant compliance (and optionally mint + transfer)", async ({
    page,
    metamask,
  }) => {
    test.setTimeout(300_000);

    if (!sepoliaNetwork.rpcUrl) {
      test.skip(true, "Sepolia RPC URL is missing for MetaMask setup.");
    }

    await metamask.page.bringToFront();
    try {
      await metamask.addNetwork(sepoliaNetwork);
    } catch {
      // Network may already exist (MetaMask ships with Sepolia when testnets are enabled).
    }
    try {
      await metamask.switchNetwork(sepoliaNetwork.name, true);
    } catch {
      // Fall back to the default Sepolia network if the custom name isn't available.
      await metamask.switchNetwork("Sepolia", true);
    }

    console.log("[e2e] navigated to dashboard");
    await page.goto("/dashboard");
    if (page.url().includes("/sign-in")) {
      await ensureSignedIn(page);
    }
    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);
    await expect(
      page.getByRole("heading", { name: WELCOME_HEADING_PATTERN })
    ).toBeVisible({
      timeout: 60_000,
    });

    console.log("[e2e] attempting wallet connection");
    await connectWalletIfNeeded({
      page,
      metamask,
      accountName: senderAccountName,
      chainId: sepoliaChainId,
    });

    await page.goto("/dashboard/attestation");
    await expect(page).toHaveURL(ATTESTATION_URL_PATTERN);
    const attestationTitle = page.getByRole("heading", {
      name: ON_CHAIN_ATTESTATION_HEADING,
    });
    await expect(attestationTitle).toBeVisible({ timeout: 60_000 });
    const lockedText = page.getByText(COMPLETE_VERIFICATION_TEXT, {
      exact: false,
    });
    if (await lockedText.isVisible().catch(() => false)) {
      throw new Error(
        "Attestation UI is locked because the identity verification data is missing. " +
          "Ensure the Next.js server is using the seeded E2E database " +
          "(set DATABASE_PATH=apps/web/e2e/.data/e2e.db or run Playwright with " +
          "E2E_DATABASE_PATH pointing to the same file as the server)."
      );
    }

    const networkButton = page.getByRole("button", {
      name: new RegExp(sepoliaNetworkName, "i"),
    });
    if (await networkButton.isVisible().catch(() => false)) {
      await networkButton.click();
    }

    const registerButton = page.getByRole("button", {
      name: REGISTER_ON_BUTTON,
    });
    const updateAttestationButton = page.getByRole("button", {
      name: UPDATE_ATTESTATION_BUTTON,
    });
    const attestedText = page.getByText(ATTESTED_ON_TEXT, { exact: false });
    const pendingText = page.getByText(TRANSACTION_PENDING_TEXT, {
      exact: false,
    });

    await expect(
      registerButton
        .or(updateAttestationButton)
        .or(attestedText)
        .or(pendingText)
    ).toBeVisible({ timeout: 60_000 });

    if (await registerButton.isVisible()) {
      await registerButton.click();
      await confirmTransaction(metamask, {
        allowMissing: true,
        timeoutMs: 4000,
      });
    } else if (await updateAttestationButton.isVisible()) {
      await updateAttestationButton.click();
      await confirmTransaction(metamask, {
        allowMissing: true,
        timeoutMs: 4000,
      });
    }

    await expect(attestedText.or(pendingText)).toBeVisible({
      timeout: 120_000,
    });

    if (await pendingText.isVisible()) {
      const checkStatus = page.getByRole("button", {
        name: CHECK_STATUS_BUTTON,
      });
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await checkStatus.click();
        try {
          await expect(attestedText).toBeVisible({ timeout: 15_000 });
          break;
        } catch {
          await page.waitForTimeout(2000);
        }
      }
    }

    await expect(attestedText).toBeVisible({ timeout: 120_000 });

    await expect(
      page.getByText("Your On-Chain Identity", { exact: false })
    ).toBeVisible({ timeout: 120_000 });

    const decryptButton = page.getByRole("button", {
      name: DECRYPT_VIEW_BUTTON,
    });
    await expect(decryptButton).toBeVisible();
    await expect(decryptButton).toBeEnabled({ timeout: 60_000 });
    await decryptButton.click();
    await confirmSignature(metamask).catch(() => undefined);

    await expect(page.getByText("1990")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Level 3")).toBeVisible();

    const complianceGrantedText = page.getByText(COMPLIANCE_GRANTED_TEXT, {
      exact: false,
    });
    if (!(await complianceGrantedText.isVisible())) {
      const grantButton = page.getByRole("button", {
        name: GRANT_COMPLIANCE_BUTTON,
      });
      await expect(grantButton).toBeVisible({ timeout: 30_000 });
      if (!(await grantButton.isEnabled().catch(() => false))) {
        test.skip(
          true,
          "Grant Compliance Access is disabled (likely insufficient SepoliaETH). Fund the wallet and rerun."
        );
      }
      await Promise.all([
        confirmTransaction(metamask, { allowMissing: true, timeoutMs: 5000 }),
        grantButton.click(),
      ]);
    }

    await expect(complianceGrantedText).toBeVisible({ timeout: 120_000 });

    if (!runFullFlow) {
      return;
    }

    await page.goto("/dashboard/defi-demo");
    await expect(
      page.getByRole("heading", { name: "DeFi Compliance Demo" })
    ).toBeVisible();

    await expect(page.getByText("Mint Tokens", { exact: false })).toBeVisible();

    await page.locator("#mint-amount").fill("5");
    const mintButton = page.getByRole("button", { name: "Mint" });
    await expect(mintButton).toBeEnabled({ timeout: 60_000 });
    await mintButton.click();

    await expect(
      page.getByText(TOKENS_MINTED_TEXT, { exact: false })
    ).toBeVisible({ timeout: 120_000 });

    await expect(
      page.getByText("Transfer", { exact: true }).first()
    ).toBeVisible();
    await expect(page.getByText(FHE_INITIALIZING_TEXT)).toBeHidden({
      timeout: 60_000,
    });

    const recipientInput = page.locator("#recipient");
    if (recipientAddress) {
      await recipientInput.fill(recipientAddress);
      await recipientInput.blur();
    } else if (senderAddress) {
      await recipientInput.fill(senderAddress);
      await recipientInput.blur();
    }

    const recipientWarning = page.getByText(RECIPIENT_NOT_ATTESTED_TEXT, {
      exact: false,
    });
    const recipientOk = page.getByText(RECIPIENT_ATTESTED_TEXT, {
      exact: false,
    });

    await expect(recipientOk.or(recipientWarning)).toBeVisible({
      timeout: 30_000,
    });

    if (await recipientWarning.isVisible().catch(() => false)) {
      if (senderAddress) {
        await recipientInput.fill(senderAddress);
        await recipientInput.blur();
        await expect(recipientOk).toBeVisible({ timeout: 30_000 });
      } else {
        test.skip(true, "Recipient not attested and no fallback sender.");
      }
    }

    await page.locator("#transfer-amount").fill("2");
    const transferButton = page.getByRole("button", {
      name: TRANSFER_BUTTON_PATTERN,
    });
    await expect(transferButton).toBeEnabled({ timeout: 60_000 });
    await Promise.all([confirmTransaction(metamask), transferButton.click()]);

    const transferSuccess = page.getByText(TRANSFER_SUCCESS_TEXT, {
      exact: false,
    });
    const transferError = page.getByText(TRANSFER_REVERTED_TEXT, {
      exact: false,
    });
    await expect(transferSuccess.or(transferError)).toBeVisible({
      timeout: 120_000,
    });
  });
});
