import type { Page } from "@playwright/test";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "./fixtures/synpress";
import { connectWalletIfNeeded } from "./helpers/connect-wallet";
import { confirmSignature, confirmTransaction } from "./helpers/metamask";

const sepoliaRpcUrl =
  process.env.E2E_SEPOLIA_RPC_URL ??
  process.env.NEXT_PUBLIC_FHEVM_RPC_URL ??
  process.env.FHEVM_RPC_URL ??
  "";
const sepoliaChainId = Number(
  process.env.E2E_SEPOLIA_CHAIN_ID ??
    process.env.NEXT_PUBLIC_FHEVM_CHAIN_ID ??
    process.env.FHEVM_CHAIN_ID ??
    11155111,
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
    process.env.FHEVM_REGISTRAR_PRIVATE_KEY ||
      process.env.REGISTRAR_PRIVATE_KEY,
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
  const signInHeading = page.locator("text=/welcome back|sign in/i").first();
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
  await page.waitForURL(/dashboard/, { timeout: 30_000 });
}

test.describe("Web3 workflow (Sepolia)", () => {
  test.describe.configure({ timeout: 300_000 });
  test.skip(
    !sepoliaEnabled,
    "Set E2E_SEPOLIA=true and configure FHEVM_* contract addresses + RPC URL to run Sepolia E2E.",
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
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByRole("heading", { name: /welcome/i })).toBeVisible({
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
    await expect(page).toHaveURL(/dashboard\/attestation/);
    const attestationTitle = page.getByRole("heading", {
      name: /On-Chain Attestation/i,
    });
    await expect(attestationTitle).toBeVisible({ timeout: 60_000 });
    const lockedText = page.getByText(/Complete identity verification first/i, {
      exact: false,
    });
    if (await lockedText.isVisible().catch(() => false)) {
      throw new Error(
        "Attestation UI is locked because the identity verification data is missing. " +
          "Ensure the Next.js server is using the seeded E2E database " +
          "(set DATABASE_PATH=apps/web/e2e/.data/e2e.db or run Playwright with " +
          "E2E_DATABASE_PATH pointing to the same file as the server).",
      );
    }

    const networkButton = page.getByRole("button", {
      name: new RegExp(sepoliaNetworkName, "i"),
    });
    if (await networkButton.isVisible().catch(() => false)) {
      await networkButton.click();
    }

    const registerButton = page.getByRole("button", { name: /Register on/i });
    const updateAttestationButton = page.getByRole("button", {
      name: /Update Attestation/i,
    });
    const attestedText = page.getByText(/Attested on/i, { exact: false });
    const pendingText = page.getByText(/Transaction Pending/i, {
      exact: false,
    });

    await expect(
      registerButton
        .or(updateAttestationButton)
        .or(attestedText)
        .or(pendingText),
    ).toBeVisible({ timeout: 60_000 });

    if (await registerButton.isVisible()) {
      await registerButton.click();
      await confirmTransaction(metamask, {
        allowMissing: true,
        timeoutMs: 4_000,
      });
    } else if (await updateAttestationButton.isVisible()) {
      await updateAttestationButton.click();
      await confirmTransaction(metamask, {
        allowMissing: true,
        timeoutMs: 4_000,
      });
    }

    await expect(attestedText.or(pendingText)).toBeVisible({
      timeout: 120_000,
    });

    if (await pendingText.isVisible()) {
      const checkStatus = page.getByRole("button", { name: /Check Status/i });
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
      page.getByText("Your On-Chain Identity", { exact: false }),
    ).toBeVisible({ timeout: 120_000 });

    const decryptButton = page.getByRole("button", { name: /Decrypt & View/i });
    await expect(decryptButton).toBeVisible();
    await expect(decryptButton).toBeEnabled({ timeout: 60_000 });
    await decryptButton.click();
    await confirmSignature(metamask).catch(() => undefined);

    await expect(page.getByText("1990")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Level 3")).toBeVisible();

    const complianceGrantedText = page.getByText(/Compliance access granted/i, {
      exact: false,
    });
    if (!(await complianceGrantedText.isVisible())) {
      const grantButton = page.getByRole("button", {
        name: /Grant Compliance Access/i,
      });
      await expect(grantButton).toBeVisible({ timeout: 30_000 });
      if (!(await grantButton.isEnabled().catch(() => false))) {
        test.skip(
          true,
          "Grant Compliance Access is disabled (likely insufficient SepoliaETH). Fund the wallet and rerun.",
        );
      }
      await Promise.all([
        confirmTransaction(metamask, { allowMissing: true, timeoutMs: 5_000 }),
        grantButton.click(),
      ]);
    }

    await expect(complianceGrantedText).toBeVisible({ timeout: 120_000 });

    if (!runFullFlow) {
      return;
    }

    await page.goto("/dashboard/defi-demo");
    await expect(
      page.getByRole("heading", { name: "DeFi Compliance Demo" }),
    ).toBeVisible();

    await expect(page.getByText("Mint Tokens", { exact: false })).toBeVisible();

    await page.locator("#mint-amount").fill("5");
    const mintButton = page.getByRole("button", { name: "Mint" });
    await expect(mintButton).toBeEnabled({ timeout: 60_000 });
    await mintButton.click();

    await expect(
      page.getByText(/Tokens minted successfully/i, { exact: false }),
    ).toBeVisible({ timeout: 120_000 });

    await expect(
      page.getByText("Transfer", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(/Initializing FHE encryption/i)).toBeHidden({
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

    const recipientWarning = page.getByText(/Recipient not attested/i, {
      exact: false,
    });
    const recipientOk = page.getByText(/Recipient is attested/i, {
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
    const transferButton = page.getByRole("button", { name: /^Transfer$/ });
    await expect(transferButton).toBeEnabled({ timeout: 60_000 });
    await Promise.all([confirmTransaction(metamask), transferButton.click()]);

    const transferSuccess = page.getByText(/Transfer submitted!/i, {
      exact: false,
    });
    const transferError = page.getByText(/transfer.*reverted/i, {
      exact: false,
    });
    await expect(transferSuccess.or(transferError)).toBeVisible({
      timeout: 120_000,
    });
  });
});
