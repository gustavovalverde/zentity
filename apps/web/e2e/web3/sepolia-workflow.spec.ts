import type { Dappwright } from "@tenkeylabs/dappwright";

import { expect } from "@playwright/test";

import { appUrl, test } from "../fixtures/metamask";
import { connectWalletIfNeeded } from "../helpers/connect-wallet";
import {
  approveAttestationPrompts,
  confirmTransactionIfPrompted,
} from "../helpers/wallet-popup";

// Top-level regex patterns for lint/performance/useTopLevelRegex compliance
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
const CONFIDENTIAL_INITIALIZING_TEXT = /Initializing encryption/i;
const RECIPIENT_NOT_ATTESTED_TEXT = /Recipient not attested/i;
const RECIPIENT_ATTESTED_TEXT = /Recipient is attested/i;
const TRANSFER_BUTTON_PATTERN = /^Transfer$/;
const TRANSFER_SUCCESS_TEXT = /Transfer submitted!/i;
const TRANSFER_REVERTED_TEXT = /transfer.*reverted/i;

const RPC_UNREACHABLE_PATTERN = /could not get an answer/i;
const SEPOLIA_CHAIN_ID = 11_155_111;

const sepoliaRpcUrl =
  process.env.E2E_SEPOLIA_RPC_URL ??
  process.env.NEXT_PUBLIC_CONFIDENTIAL_CHAIN_RPC_URL ??
  process.env.CONFIDENTIAL_CHAIN_RPC_URL ??
  "";
const sepoliaChainId = Number(
  process.env.E2E_SEPOLIA_CHAIN_ID ??
    process.env.NEXT_PUBLIC_CONFIDENTIAL_CHAIN_ID ??
    process.env.CONFIDENTIAL_CHAIN_ID ??
    SEPOLIA_CHAIN_ID
);
const sepoliaNetworkName =
  process.env.E2E_SEPOLIA_NETWORK_NAME ??
  process.env.CONFIDENTIAL_CHAIN_NETWORK_NAME ??
  process.env.NEXT_PUBLIC_CONFIDENTIAL_CHAIN_NETWORK_NAME ??
  "Zama Confidential Sepolia";
const sepoliaSymbol = process.env.E2E_SEPOLIA_SYMBOL ?? "SepoliaETH";

const senderAddress =
  process.env.E2E_SEPOLIA_SENDER_ADDRESS ??
  process.env.E2E_SENDER_ADDRESS ??
  "";
const recipientAddress =
  process.env.E2E_SEPOLIA_RECIPIENT_ADDRESS ??
  process.env.E2E_RECIPIENT_ADDRESS ??
  "";
// MetaMask starts on "Account 1" of the seed phrase. Set a name to switch to
// another account before connecting.
const senderAccountName =
  process.env.E2E_SEPOLIA_ACCOUNT_NAME ?? process.env.E2E_ACCOUNT_NAME ?? "";

const sepoliaNetwork = {
  networkName: sepoliaNetworkName,
  rpc: sepoliaRpcUrl,
  chainId: sepoliaChainId,
  symbol: sepoliaSymbol,
};

const sepoliaEnabled =
  process.env.E2E_SEPOLIA === "true" &&
  Boolean(sepoliaRpcUrl) &&
  Boolean(process.env.CONFIDENTIAL_CHAIN_REGISTRAR_PRIVATE_KEY) &&
  Boolean(process.env.CONFIDENTIAL_CHAIN_IDENTITY_REGISTRY) &&
  Boolean(process.env.CONFIDENTIAL_CHAIN_COMPLIANCE_RULES) &&
  Boolean(process.env.CONFIDENTIAL_CHAIN_COMPLIANT_ERC20);
const runFullFlow = process.env.E2E_SEPOLIA_FULL === "true";

// MetaMask ships Sepolia (chain 11155111) as a built-in network, so a custom
// RPC for that chain edits the built-in entry instead of adding a second one.
async function selectSepolia(wallet: Dappwright) {
  if (await wallet.hasNetwork(sepoliaNetwork.networkName)) {
    await wallet.switchNetwork(sepoliaNetwork.networkName);
    return;
  }
  try {
    await wallet.addNetwork(sepoliaNetwork);
  } catch (error) {
    // Only the duplicate built-in chain falls back; an unreachable RPC or a
    // different chain ID is a configuration error to surface.
    if (
      sepoliaNetwork.chainId !== SEPOLIA_CHAIN_ID ||
      (error instanceof Error && RPC_UNREACHABLE_PATTERN.test(error.message))
    ) {
      throw error;
    }
    await wallet.updateNetworkRpc({
      chainId: sepoliaNetwork.chainId,
      rpc: sepoliaNetwork.rpc,
    });
    await wallet.switchNetwork("Sepolia");
  }
}

test.describe("Web3 workflow (Sepolia)", () => {
  test.describe.configure({ timeout: 300_000 });
  test.skip(
    !sepoliaEnabled,
    "Set E2E_SEPOLIA=true and configure CONFIDENTIAL_CHAIN_* contract addresses + RPC URL to run Sepolia E2E."
  );

  test("attest, decrypt, grant compliance (and optionally mint + transfer)", async ({
    context,
    page,
    wallet,
  }) => {
    test.setTimeout(300_000);

    if (!sepoliaNetwork.rpc) {
      test.skip(true, "Sepolia RPC URL is missing for MetaMask setup.");
    }

    await selectSepolia(wallet);
    if (senderAccountName) {
      await wallet.switchAccount(senderAccountName);
    }

    console.log("[e2e] navigated to dashboard");
    await page.goto(appUrl("/dashboard"));
    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);
    await expect(
      page.getByRole("heading", { name: WELCOME_HEADING_PATTERN })
    ).toBeVisible({
      timeout: 60_000,
    });

    await page.goto(appUrl("/dashboard/attestation"));
    await expect(page).toHaveURL(ATTESTATION_URL_PATTERN);
    const attestationTitle = page.getByRole("heading", {
      name: ON_CHAIN_ATTESTATION_HEADING,
    });
    await expect(attestationTitle).toBeVisible({ timeout: 60_000 });

    // The AppKit connect button lives on the attestation page, not the dashboard.
    console.log("[e2e] attempting wallet connection");
    await connectWalletIfNeeded({ page, wallet });
    const lockedText = page.getByText(COMPLETE_VERIFICATION_TEXT, {
      exact: false,
    });
    if (await lockedText.isVisible().catch(() => false)) {
      throw new Error(
        "Attestation UI is locked because the identity verification data is missing. " +
          "Ensure the Next.js server is using the seeded E2E database " +
          "(set TURSO_DATABASE_URL=file:apps/web/e2e/.data/e2e.db or run Playwright with " +
          "E2E_TURSO_DATABASE_URL pointing to the same file as the server)."
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
      await approveAttestationPrompts(wallet);
    } else if (await updateAttestationButton.isVisible()) {
      await updateAttestationButton.click();
      await approveAttestationPrompts(wallet);
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
    await wallet.sign();

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
        confirmTransactionIfPrompted(wallet, context, 10_000),
        grantButton.click(),
      ]);
    }

    await expect(complianceGrantedText).toBeVisible({ timeout: 120_000 });

    if (!runFullFlow) {
      return;
    }

    await page.goto(appUrl("/dashboard/defi-demo"));
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
    await expect(page.getByText(CONFIDENTIAL_INITIALIZING_TEXT)).toBeHidden({
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
    await Promise.all([wallet.confirmTransaction(), transferButton.click()]);

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
