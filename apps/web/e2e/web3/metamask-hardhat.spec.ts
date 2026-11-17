/**
 * MetaMask wallet E2E test against the local Hardhat node
 *
 * Drives the real MetaMask extension through dappwright: connecting through
 * AppKit, signing a message, confirming a transaction, and submitting an
 * attestation (a consent signature, then a transaction). It covers the
 * fixture and helpers that the Sepolia workflow relies on, without needing
 * testnet funds. MetaMask is downloaded into the system temp directory on the
 * first run.
 *
 * To run locally:
 * E2E_RUN_WEB3=true pnpm test:e2e --project=web3-hardhat e2e/web3/metamask-hardhat.spec.ts
 */
import { expect } from "@playwright/test";

import { appUrl, test } from "../fixtures/metamask";
import {
  connectWalletIfNeeded,
  revokeWalletConnection,
} from "../helpers/connect-wallet";
import {
  approveAttestationPrompts,
  confirmTransactionIfPrompted,
} from "../helpers/wallet-popup";

const WELCOME_HEADING_PATTERN = /welcome/i;
const SIGNATURE_PATTERN = /^0x[0-9a-f]{130}$/;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const LOCAL_HARDHAT_BUTTON = /Local \(Hardhat\) Encrypted/i;
const REGISTER_ON_BUTTON = /Register on/i;
const UPDATE_ATTESTATION_BUTTON = /Update Attestation/i;
const ATTESTED_ON_TEXT = /Attested on/i;
const TRANSACTION_PENDING_TEXT = /Transaction Pending/i;

const HARDHAT_NETWORK = {
  chainId: 31_337,
  networkName: "Hardhat Local",
  rpc: `http://127.0.0.1:${process.env.E2E_HARDHAT_PORT ?? 8545}`,
  symbol: "ETH",
};
const HARDHAT_SECOND_ACCOUNT_NAME = "Account 2";
// Account 1 of Hardhat's public mnemonic.
const HARDHAT_ACCOUNT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

interface EthereumRequest {
  method: string;
  params?: unknown[];
}

test.describe("MetaMask wallet (Hardhat)", () => {
  test.skip(
    () => process.env.E2E_RUN_WEB3 !== "true",
    "Set E2E_RUN_WEB3=true to run. See file header for instructions."
  );

  test("connects, signs, and sends a transaction", async ({
    context,
    page,
    wallet,
  }) => {
    test.setTimeout(300_000);

    await wallet.addNetwork(HARDHAT_NETWORK);

    await page.goto(appUrl("/dashboard"));
    await expect(
      page.getByRole("heading", { name: WELCOME_HEADING_PATTERN })
    ).toBeVisible({ timeout: 60_000 });

    await page.goto(appUrl("/dashboard/attestation"));
    await expect(page.locator("appkit-button").first()).toBeVisible({
      timeout: 60_000,
    });
    await connectWalletIfNeeded({ page, wallet });

    const request = (payload: EthereumRequest) =>
      page.evaluate(
        (args) =>
          (
            globalThis as unknown as {
              ethereum: { request: (req: EthereumRequest) => Promise<unknown> };
            }
          ).ethereum.request(args),
        payload
      );

    const accounts = (await request({ method: "eth_accounts" })) as string[];
    expect(accounts.map((account) => account.toLowerCase())).toEqual([
      HARDHAT_ACCOUNT,
    ]);

    // With no pending request, the helper reports that no prompt appeared
    // instead of waiting for dappwright's two-minute popup timeout.
    expect(await confirmTransactionIfPrompted(wallet, context, 2000)).toBe(
      false
    );

    const signature = request({
      method: "personal_sign",
      params: ["0x68656c6c6f", HARDHAT_ACCOUNT],
    });
    await wallet.sign();
    expect(await signature).toMatch(SIGNATURE_PATTERN);

    const transactionHash = request({
      method: "eth_sendTransaction",
      params: [{ from: HARDHAT_ACCOUNT, to: HARDHAT_ACCOUNT, value: "0x1" }],
    });
    expect(await confirmTransactionIfPrompted(wallet, context, 15_000)).toBe(
      true
    );
    expect(await transactionHash).toMatch(TRANSACTION_HASH_PATTERN);
  });

  test("submits an attestation through a consent signature and a transaction", async ({
    page,
    wallet,
  }) => {
    test.setTimeout(300_000);

    if (!(await wallet.hasNetwork(HARDHAT_NETWORK.networkName))) {
      await wallet.addNetwork(HARDHAT_NETWORK);
    }
    // The workflow specs attest Account 1. Account 2 is a different wallet, so
    // the page offers "Register" or "Update Attestation", whichever state the
    // database is in. MetaMask lists the mnemonic's first accounts after the
    // import, so this needs no account creation.
    await wallet.switchAccount(HARDHAT_SECOND_ACCOUNT_NAME);

    await page.goto(appUrl("/dashboard/attestation"));
    await expect(page.locator("appkit-button").first()).toBeVisible({
      timeout: 60_000,
    });
    // The first test connected Account 1, so drop that connection and connect
    // the second account instead.
    await revokeWalletConnection(page);
    await expect(page.locator("appkit-button").first()).toBeVisible({
      timeout: 60_000,
    });
    await connectWalletIfNeeded({ page, wallet });

    const hardhatNetworkButton = page.getByRole("button", {
      name: LOCAL_HARDHAT_BUTTON,
    });
    if (await hardhatNetworkButton.isVisible().catch(() => false)) {
      await hardhatNetworkButton.click();
    }

    const submitButton = page
      .getByRole("button", { name: REGISTER_ON_BUTTON })
      .or(page.getByRole("button", { name: UPDATE_ATTESTATION_BUTTON }));
    await expect(submitButton).toBeVisible({ timeout: 60_000 });
    await submitButton.click();
    await approveAttestationPrompts(wallet);

    await expect(
      page
        .getByText(ATTESTED_ON_TEXT, { exact: false })
        .or(page.getByText(TRANSACTION_PENDING_TEXT, { exact: false }))
    ).toBeVisible({ timeout: 120_000 });
  });
});
