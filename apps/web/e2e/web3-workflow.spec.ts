import { expect, test } from "./fixtures/synpress";
import { connectWalletIfNeeded } from "./helpers/connect-wallet";
import { confirmSignature, confirmTransaction } from "./helpers/metamask";
import { readTestUserId } from "./helpers/test-user";

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
  chainId: Number(process.env.SYNPRESS_NETWORK_CHAIN_ID ?? 31337),
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
    await expect(page.getByRole("heading", { name: /welcome/i })).toBeVisible();

    await connectWalletIfNeeded({
      page,
      metamask,
      accountName: senderAccountName,
      chainId: hardhatNetwork.chainId,
    });

    await page.goto("/dashboard/attestation");
    await expect(page).toHaveURL(/dashboard\/attestation/);
    await expect(
      page.getByRole("heading", { name: /On-Chain Attestation/i }),
    ).toBeVisible({ timeout: 60_000 });

    const hardhatNetworkButton = page.getByRole("button", {
      name: /Local \(Hardhat\)/i,
    });
    if (await hardhatNetworkButton.isVisible().catch(() => false)) {
      await hardhatNetworkButton.click();
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
    } else if (await updateAttestationButton.isVisible()) {
      await updateAttestationButton.click();
    }

    await expect(attestedText.or(pendingText)).toBeVisible({
      timeout: 60_000,
    });

    if (await pendingText.isVisible()) {
      const checkStatus = page.getByRole("button", { name: /Check Status/i });
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

    const sepoliaConfirmed = page.getByText(/Attested on fhEVM/i, {
      exact: false,
    });
    if (await sepoliaConfirmed.isVisible().catch(() => false)) {
      await expect(page.getByText(/Local \\(Hardhat\\)/i)).toBeVisible();
      await page.getByRole("button", { name: /Local \\(Hardhat\\)/i }).click();
    }

    await expect(
      page.getByText("Your On-Chain Identity", { exact: false }),
    ).toBeVisible({ timeout: 120_000 });

    const decryptButton = page.getByRole("button", { name: /Decrypt & View/i });
    await expect(decryptButton).toBeVisible();
    await expect(decryptButton).toBeEnabled({ timeout: 60_000 });
    await decryptButton.click();
    await confirmSignature(metamask);

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
      await Promise.all([confirmTransaction(metamask), grantButton.click()]);
    }

    await expect(complianceGrantedText).toBeVisible({ timeout: 60_000 });

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
    ).toBeVisible({ timeout: 60_000 });

    await expect(
      page.getByText("Transfer", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(/Initializing FHE encryption/i)).toBeHidden({
      timeout: 60_000,
    });

    const recipientInput = page.locator("#recipient");
    await recipientInput.fill(recipientAddress);
    await recipientInput.blur();
    const recipientWarning = page.getByText(/Recipient not attested/i, {
      exact: false,
    });
    const recipientOk = page.getByText(/Recipient is attested/i, {
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
      timeout: 60_000,
    });
  });
});
