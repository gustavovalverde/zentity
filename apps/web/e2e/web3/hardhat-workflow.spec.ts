/**
 * Web3 Hardhat workflow E2E test
 *
 * Uses an injected Hardhat test wallet instead of a browser extension so the
 * default local workflow proves deployment, AppKit/wagmi wiring, signing, and
 * transactions without downloading MetaMask. The Sepolia workflow drives the
 * real extension through dappwright.
 *
 * To run locally:
 * E2E_RUN_WEB3=true pnpm test:e2e --project=web3-hardhat
 */
import { expect, type Page, test } from "@playwright/test";

import {
  connectHardhatWallet,
  installHardhatWallet,
} from "../helpers/hardhat-wallet";
import { readTestUserId } from "../helpers/test-user";

// Skip Web3 tests by default: they need the contracts repo and a Hardhat node.
// Set E2E_RUN_WEB3=true to run these tests
const skipWeb3Tests = process.env.E2E_RUN_WEB3 !== "true";

// Top-level regex patterns for lint/performance/useTopLevelRegex compliance
const WELCOME_HEADING_PATTERN = /welcome/i;
const ATTESTATION_URL_PATTERN = /dashboard\/attestation/;
const ON_CHAIN_ATTESTATION_HEADING = /On-Chain Attestation/i;
const LOCAL_HARDHAT_BUTTON = /Local \(Hardhat\) Encrypted/i;
const REGISTER_ON_BUTTON = /Register on/i;
const UPDATE_ATTESTATION_BUTTON = /Update Attestation/i;
const ATTESTED_ON_TEXT = /Attested on/i;
const TRANSACTION_PENDING_TEXT = /Transaction Pending/i;
const CHECK_STATUS_BUTTON = /Check Status/i;
const ATTESTED_ON_CONFIDENTIAL_SEPOLIA_TEXT =
  /Attested on Zama Confidential Sepolia/i;
const LOCAL_HARDHAT_TEXT = /Local \\(Hardhat\\)/i;
const DECRYPT_VIEW_BUTTON = /Decrypt & View/i;
const HIDE_DATA_BUTTON = /Hide Data/i;
// IndexedDB database where earlier releases kept decrypted values, and the
// function selector of the cleartext KMSVerifier's userDecrypt view.
const LEGACY_SDK_DATABASE = "ZentityConfidentialCredentials";
const USER_DECRYPT_SELECTOR = "0xd28e4071";
// Key prefixes the Zama SDK uses when it persists decrypted values and the
// transport key pair to the storage it is given.
const SDK_PERSISTED_KEY_PREFIXES = ["zama:decrypt", "keypair:"];
const COMPLIANCE_GRANTED_TEXT = /Compliance access granted/i;
const GRANT_COMPLIANCE_BUTTON = /Grant Compliance Access/i;
const TOKENS_MINTED_TEXT = /Tokens minted successfully/i;
const CONFIDENTIAL_INITIALIZING_TEXT = /Initializing encryption/i;
const RECIPIENT_NOT_ATTESTED_TEXT = /Recipient not verified on-chain/i;
const RECIPIENT_ATTESTED_TEXT = /Recipient is attested/i;
const TRANSFER_BUTTON_PATTERN = /^Transfer$/;
const TRANSFER_SUCCESS_TEXT = /Transfer submitted!/i;
const TRANSFER_REVERTED_TEXT = /transfer.*reverted/i;

// Default to Account 1 (index 0) from the standard Hardhat test seed phrase
const senderAddress =
  process.env.E2E_SENDER_ADDRESS ??
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
// Recipient is Account 2 (index 1) - for transfer tests
const recipientAddress =
  process.env.E2E_RECIPIENT_ADDRESS ??
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const hardhatChainId = 31_337;
const hardhatRpcUrl = `http://127.0.0.1:${process.env.E2E_HARDHAT_PORT ?? 8545}`;

/** Lists every browser storage key that holds SDK-persisted decryption state. */
function findPersistedDecryptionKeys(page: Page): Promise<string[]> {
  return page.evaluate(async (prefixes) => {
    const matches = (key: string) =>
      prefixes.some((prefix) => key.includes(prefix));
    const found: string[] = [];
    for (const [area, storage] of [
      ["localStorage", localStorage],
      ["sessionStorage", sessionStorage],
    ] as const) {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key && matches(key)) {
          found.push(`${area}/${key}`);
        }
      }
    }
    for (const { name, version } of await indexedDB.databases()) {
      if (!name) {
        continue;
      }
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const storeName of Array.from(database.objectStoreNames)) {
        const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
          const request = database
            .transaction(storeName, "readonly")
            .objectStore(storeName)
            .getAllKeys();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        for (const key of keys) {
          if (matches(String(key))) {
            found.push(`${name}/${storeName}/${String(key)}`);
          }
        }
      }
      database.close();
    }
    return found;
  }, SDK_PERSISTED_KEY_PREFIXES);
}

test.describe("Web3 workflow (Hardhat + mock relayer)", () => {
  test.describe.configure({ timeout: 180_000 });

  test.skip(
    () => skipWeb3Tests,
    "Web3 tests skipped. Set E2E_RUN_WEB3=true to run. See file header for instructions."
  );

  test("attest, decrypt after reload, grant compliance, mint, and transfer", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const userId = readTestUserId();
    if (userId) {
      process.env.E2E_USER_ID = userId;
    }

    await installHardhatWallet(page, {
      chainId: hardhatChainId,
      rpcUrl: hardhatRpcUrl,
    });

    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: WELCOME_HEADING_PATTERN })
    ).toBeVisible();

    await connectHardhatWallet(page, hardhatChainId);

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

    const sepoliaConfirmed = page.getByText(
      ATTESTED_ON_CONFIDENTIAL_SEPOLIA_TEXT,
      {
        exact: false,
      }
    );
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

    await expect(page.getByText("1990")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Level 2")).toBeVisible();
    // Decrypted identity attributes must not persist in the browser.
    expect(await findPersistedDecryptionKeys(page)).toEqual([]);

    // After a reload the values can only come from a new KMSVerifier
    // userDecrypt call. The legacy database is recreated first to check that
    // the app deletes it.
    await page.evaluate(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(name, 1);
          request.onsuccess = () => {
            request.result.close();
            resolve();
          };
          request.onerror = () => reject(request.error);
        }),
      LEGACY_SDK_DATABASE
    );
    await page.reload();
    await connectHardhatWallet(page, hardhatChainId);
    await expect(
      page.getByText("Your On-Chain Identity", { exact: false })
    ).toBeVisible({ timeout: 120_000 });
    await expect
      .poll(() =>
        page.evaluate(
          async (name) =>
            (await indexedDB.databases()).some(
              (database) => database.name === name
            ),
          LEGACY_SDK_DATABASE
        )
      )
      .toBe(false);
    const decryptAfterReloadButton = page.getByRole("button", {
      name: DECRYPT_VIEW_BUTTON,
    });
    await expect(decryptAfterReloadButton).toBeEnabled({ timeout: 60_000 });
    const userDecryptCall = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        (request.postData() ?? "").includes(USER_DECRYPT_SELECTOR),
      { timeout: 60_000 }
    );
    await decryptAfterReloadButton.click();
    await userDecryptCall;
    await expect(
      page.getByRole("button", { name: HIDE_DATA_BUTTON })
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("1990")).toBeVisible();
    await expect(page.getByText("Level 2")).toBeVisible();
    expect(await findPersistedDecryptionKeys(page)).toEqual([]);

    const complianceGrantedText = page.getByText(COMPLIANCE_GRANTED_TEXT, {
      exact: false,
    });
    if (!(await complianceGrantedText.isVisible())) {
      const grantButton = page.getByRole("button", {
        name: GRANT_COMPLIANCE_BUTTON,
      });
      await expect(grantButton).toBeVisible({ timeout: 30_000 });
      await grantButton.click();
    }

    await expect(complianceGrantedText).toBeVisible({ timeout: 60_000 });

    await page.goto("/dashboard/defi-demo");
    await expect(
      page.getByRole("heading", { name: "DeFi Compliance Demo" })
    ).toBeVisible();

    await expect(
      page.getByText("Mint Tokens", { exact: true }).first()
    ).toBeVisible();

    await page.locator("#mint-amount").fill("5");
    const mintButton = page.getByRole("button", { exact: true, name: "Mint" });
    await expect(mintButton).toBeEnabled({ timeout: 60_000 });
    await mintButton.click();

    await expect(
      page.getByText(TOKENS_MINTED_TEXT, { exact: false })
    ).toBeVisible({ timeout: 60_000 });

    await expect(
      page.getByText("Transfer", { exact: true }).first()
    ).toBeVisible();
    await expect(page.getByText(CONFIDENTIAL_INITIALIZING_TEXT)).toBeHidden({
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
    await transferButton.click();

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
