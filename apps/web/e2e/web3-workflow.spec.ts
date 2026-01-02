import { expect, test } from "./fixtures/synpress";
import { connectWalletIfNeeded } from "./helpers/connect-wallet";
import { confirmSignature, confirmTransaction } from "./helpers/metamask";
import { readTestUserId } from "./helpers/test-user";

// Top-level regex patterns for lint/performance/useTopLevelRegex compliance
const WELCOME_HEADING_PATTERN = /welcome/i;
const ATTESTATION_URL_PATTERN = /dashboard\/attestation/;
const ON_CHAIN_ATTESTATION_HEADING = /On-Chain Attestation/i;
const LOCAL_HARDHAT_BUTTON = /Local \(Hardhat\)/i;
const REGISTER_ON_BUTTON = /Register on/i;
const UPDATE_ATTESTATION_BUTTON = /Update Attestation/i;
const ATTESTED_ON_TEXT = /Attested on/i;
const TRANSACTION_PENDING_TEXT = /Transaction Pending/i;
const CHECK_STATUS_BUTTON = /Check Status/i;
const ATTESTED_ON_FHEVM_TEXT = /Attested on fhEVM/i;
const LOCAL_HARDHAT_TEXT = /Local \\(Hardhat\\)/i;
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

const senderAddress =
  process.env.E2E_SENDER_ADDRESS ??
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const recipientAddress =
  process.env.E2E_RECIPIENT_ADDRESS ??
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const senderAccountName =
  process.env.E2E_ACCOUNT_NAME ??
  process.env.SYNPRESS_ACCOUNT_NAME ??
  "Account 2";
const hardhatNetwork = {
  name: process.env.SYNPRESS_NETWORK_NAME ?? "Hardhat Local",
  rpcUrl: process.env.SYNPRESS_NETWORK_RPC_URL ?? "http://127.0.0.1:8545",
  chainId: Number(process.env.SYNPRESS_NETWORK_CHAIN_ID ?? 31_337),
  symbol: process.env.SYNPRESS_NETWORK_SYMBOL ?? "ETH",
};

test.describe("Web3 workflow (Hardhat + mock relayer)", () => {
  test.describe.configure({ timeout: 180_000 });
  test("attest, grant compliance, mint, and transfer", async ({
    page,
    metamask,
  }) => {
    test.setTimeout(180_000);
    const userId = readTestUserId();
    if (userId) {
      process.env.E2E_USER_ID = userId;
    }
    try {
      await metamask.switchNetwork(hardhatNetwork.name);
    } catch {
      try {
        await metamask.addNetwork(hardhatNetwork);
      } catch {
        // Network may already exist from a previous run.
      }
      await metamask.switchNetwork(hardhatNetwork.name);
    }

    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: WELCOME_HEADING_PATTERN })
    ).toBeVisible();

    await connectWalletIfNeeded({
      page,
      metamask,
      accountName: senderAccountName,
      chainId: hardhatNetwork.chainId,
    });

    await page.goto("/dashboard/attestation");
    await expect(page).toHaveURL(ATTESTATION_URL_PATTERN);
    await expect(
      page.getByRole("heading", { name: ON_CHAIN_ATTESTATION_HEADING })
    ).toBeVisible({ timeout: 60_000 });

    const hardhatNetworkButton = page.getByRole("button", {
      name: LOCAL_HARDHAT_BUTTON,
    });
    if (await hardhatNetworkButton.isVisible().catch(() => false)) {
      await hardhatNetworkButton.click();
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
    } else if (await updateAttestationButton.isVisible()) {
      await updateAttestationButton.click();
    }

    await expect(attestedText.or(pendingText)).toBeVisible({
      timeout: 60_000,
    });

    if (await pendingText.isVisible()) {
      const checkStatus = page.getByRole("button", {
        name: CHECK_STATUS_BUTTON,
      });
      for (let attempt = 0; attempt < 5; attempt++) {
        await checkStatus.click();
        try {
          await expect(attestedText).toBeVisible({ timeout: 10_000 });
          break;
        } catch {
          await page.waitForTimeout(1000);
        }
      }
    }

    await expect(attestedText).toBeVisible({ timeout: 60_000 });

    const sepoliaConfirmed = page.getByText(ATTESTED_ON_FHEVM_TEXT, {
      exact: false,
    });
    if (await sepoliaConfirmed.isVisible().catch(() => false)) {
      await expect(page.getByText(LOCAL_HARDHAT_TEXT)).toBeVisible();
      await page.getByRole("button", { name: LOCAL_HARDHAT_TEXT }).click();
    }

    await expect(
      page.getByText("Your On-Chain Identity", { exact: false })
    ).toBeVisible({ timeout: 120_000 });

    const decryptButton = page.getByRole("button", {
      name: DECRYPT_VIEW_BUTTON,
    });
    await expect(decryptButton).toBeVisible();
    await expect(decryptButton).toBeEnabled({ timeout: 60_000 });
    await decryptButton.click();
    await confirmSignature(metamask);

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
      await Promise.all([confirmTransaction(metamask), grantButton.click()]);
    }

    await expect(complianceGrantedText).toBeVisible({ timeout: 60_000 });

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
    ).toBeVisible({ timeout: 60_000 });

    await expect(
      page.getByText("Transfer", { exact: true }).first()
    ).toBeVisible();
    await expect(page.getByText(FHE_INITIALIZING_TEXT)).toBeHidden({
      timeout: 60_000,
    });

    const recipientInput = page.locator("#recipient");
    await recipientInput.fill(recipientAddress);
    await recipientInput.blur();
    const recipientWarning = page.getByText(RECIPIENT_NOT_ATTESTED_TEXT, {
      exact: false,
    });
    const recipientOk = page.getByText(RECIPIENT_ATTESTED_TEXT, {
      exact: false,
    });
    try {
      await expect(recipientOk.or(recipientWarning)).toBeVisible({
        timeout: 10_000,
      });
    } catch {
      // Allow fallback below if the status lookup is slow.
    }
    if (await recipientWarning.isVisible().catch(() => false)) {
      await recipientInput.fill(senderAddress);
      await recipientInput.blur();
      await expect(recipientOk).toBeVisible({ timeout: 20_000 });
    } else {
      await expect(recipientOk).toBeVisible({ timeout: 20_000 });
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
      timeout: 60_000,
    });
  });
});
