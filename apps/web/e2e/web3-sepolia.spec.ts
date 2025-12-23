import type { Page } from "@playwright/test";
import type { MetaMask } from "@synthetixio/synpress/playwright";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "./fixtures/synpress";
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

type BrowserEthereum = {
  request?: (args: { method: string }) => Promise<unknown>;
};

type BrowserAppKitControllers = {
  OptionsController?: {
    state?: {
      enableInjected?: boolean;
      enableWallets?: boolean;
      enableEIP6963?: boolean;
    };
  };
  ConnectorController?: {
    state?: {
      connectors?: Array<{
        type?: string;
        id?: string;
        info?: unknown;
        provider?: unknown;
      }>;
      allConnectors?: Array<{ type?: string }>;
    };
  };
};

type BrowserAppKit = {
  open?: () => void;
  setCaipAddress?: (
    address: string,
    namespace?: string,
    sync?: boolean,
  ) => void;
  setStatus?: (status: string, namespace?: string) => void;
  getActiveChainNamespace?: () => string;
  connectionControllerClient?: {
    connectExternal?: (args: {
      id?: string;
      type?: string;
      info?: unknown;
      provider?: unknown;
    }) => Promise<void>;
  };
};

type BrowserWindow = Window & {
  ethereum?: BrowserEthereum;
  __appkit?: BrowserAppKit;
  __appkitControllers?: BrowserAppKitControllers;
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

async function connectWalletIfNeeded(
  page: Page,
  metamask: MetaMask,
  accountName?: string,
) {
  console.log("[e2e] connectWalletIfNeeded: start");
  await page.bringToFront();
  try {
    console.log("[e2e] connectWalletIfNeeded: attempting MetaMask unlock");
    await Promise.race([metamask.unlock(), page.waitForTimeout(5_000)]);
  } catch {
    // Ignore if already unlocked or unlock times out.
  }
  console.log("[e2e] connectWalletIfNeeded: unlock step complete");
  const getAccounts = async () =>
    page.evaluate(async () => {
      try {
        const appWindow = window as BrowserWindow;
        if (!appWindow.ethereum?.request) return [];
        const result = await appWindow.ethereum.request({
          method: "eth_accounts",
        });
        return Array.isArray(result) ? result : [];
      } catch {
        return [];
      }
    });
  const hasEthereum = await page.evaluate(() =>
    Boolean((window as BrowserWindow).ethereum?.request),
  );

  const accounts = await getAccounts();
  console.log(`[e2e] connectWalletIfNeeded: accounts=${accounts.length}`);
  if (accounts.length > 0) {
    console.log("[e2e] connectWalletIfNeeded: already connected");
    return;
  }

  const appkitOptions = await page.evaluate(() => {
    const controllers = (window as BrowserWindow).__appkitControllers;
    if (!controllers) return null;
    return {
      enableInjected: controllers.OptionsController?.state?.enableInjected,
      enableWallets: controllers.OptionsController?.state?.enableWallets,
      enableEIP6963: controllers.OptionsController?.state?.enableEIP6963,
    };
  });
  console.log(
    `[e2e] connectWalletIfNeeded: appkit options ${JSON.stringify(appkitOptions)}`,
  );

  if (hasEthereum) {
    console.log(
      "[e2e] connectWalletIfNeeded: requesting accounts via injected",
    );
    await page.evaluate(() => {
      const appWindow = window as BrowserWindow;
      appWindow.ethereum
        ?.request?.({ method: "eth_requestAccounts" })
        .catch(() => undefined);
    });
    try {
      if (accountName) {
        await metamask.connectToDapp([accountName]);
      } else {
        await metamask.connectToDapp();
      }
      console.log("[e2e] connectWalletIfNeeded: MetaMask connect requested");
    } catch {
      console.log("[e2e] connectWalletIfNeeded: no MetaMask notification");
    }
    const injectedAccounts = await getAccounts();
    if (injectedAccounts.length > 0) {
      const appkitSyncResult = await page.evaluate(async () => {
        const appWindow = window as BrowserWindow;
        const appkit = appWindow.__appkit;
        const controllers = appWindow.__appkitControllers;
        const connectorTypes =
          controllers?.ConnectorController?.state?.connectors?.map(
            (connector: { type?: string }) => connector.type,
          ) ?? [];
        const allConnectorTypes =
          controllers?.ConnectorController?.state?.allConnectors?.map(
            (connector: { type?: string }) => connector.type,
          ) ?? [];
        if (!appkit || !controllers) {
          return {
            synced: false,
            reason: "missing-appkit",
            connectorTypes,
            allConnectorTypes,
          };
        }
        const connectorState = controllers.ConnectorController?.state;
        const injected = connectorState?.connectors?.find(
          (connector: { type?: string }) => connector.type === "INJECTED",
        );
        if (!injected) {
          return {
            synced: false,
            reason: "no-injected",
            connectorTypes,
            allConnectorTypes,
          };
        }
        const connectExternal =
          appkit.connectionControllerClient?.connectExternal;
        if (!connectExternal) {
          return {
            synced: false,
            reason: "no-connector-client",
            connectorTypes,
            allConnectorTypes,
          };
        }
        await connectExternal({
          id: injected.id,
          type: injected.type,
          info: injected.info,
          provider: injected.provider,
        });
        return { synced: true, reason: "ok", connectorTypes };
      });
      console.log(
        `[e2e] connectWalletIfNeeded: appkit sync result = ${JSON.stringify(appkitSyncResult)}`,
      );
      if (!appkitSyncResult?.synced) {
        const forced = await page.evaluate(
          ({ address, chainId }) => {
            const appkit = (window as BrowserWindow).__appkit;
            if (!appkit?.setCaipAddress || !appkit?.setStatus) return false;
            const namespace = appkit.getActiveChainNamespace?.() ?? "eip155";
            const caipAddress = `eip155:${chainId}:${address}`;
            appkit.setCaipAddress(caipAddress, namespace, true);
            appkit.setStatus("connected", namespace);
            return true;
          },
          { address: injectedAccounts[0], chainId: sepoliaChainId },
        );
        console.log(
          `[e2e] connectWalletIfNeeded: forced appkit state = ${forced}`,
        );
      }
      console.log("[e2e] connectWalletIfNeeded: connected via injected");
      return;
    }
  }

  const triggerConnect = async () => {
    console.log("[e2e] connectWalletIfNeeded: opening AppKit modal");
    const hasAppkit = await page.evaluate(() =>
      Boolean((window as BrowserWindow).__appkit),
    );
    console.log(`[e2e] connectWalletIfNeeded: appkit=${hasAppkit}`);
    if (hasAppkit) {
      await page.evaluate(() => {
        const appkit = (window as BrowserWindow).__appkit;
        appkit?.open?.();
      });
    } else {
      await page.locator("appkit-button").first().click();
    }
    const injectedOption = page.getByRole("button", {
      name: /Browser Wallet|Injected/i,
    });
    const metaMaskOption = page.getByRole("button", { name: /MetaMask/i });
    await Promise.race([
      injectedOption.waitFor({ state: "visible", timeout: 15_000 }),
      metaMaskOption.waitFor({ state: "visible", timeout: 15_000 }),
    ]);
    if (await injectedOption.isVisible().catch(() => false)) {
      console.log("[e2e] connectWalletIfNeeded: using injected connector");
      await injectedOption.click();
      return;
    }

    console.log("[e2e] connectWalletIfNeeded: using MetaMask wallet option");
    await metaMaskOption.click();
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    console.log(`[e2e] connectWalletIfNeeded: attempt ${attempt + 1}`);
    await triggerConnect();

    try {
      if (accountName) {
        await metamask.connectToDapp([accountName]);
      } else {
        await metamask.connectToDapp();
      }
      console.log("[e2e] connectWalletIfNeeded: MetaMask connect requested");
    } catch {
      // AppKit may auto-connect without a MetaMask notification.
      console.log("[e2e] connectWalletIfNeeded: no MetaMask notification");
    }

    const modalRetry = page.getByRole("button", { name: /Try again/i });
    if (await modalRetry.isVisible().catch(() => false)) {
      await modalRetry.click();
    }

    await page.evaluate(async () => {
      try {
        const appWindow = window as BrowserWindow;
        await appWindow.ethereum?.request?.({ method: "eth_requestAccounts" });
      } catch {
        // Ignore if the provider rejects the request.
      }
    });

    try {
      if (accountName) {
        await metamask.connectToDapp([accountName]);
      } else {
        await metamask.connectToDapp();
      }
      console.log(
        "[e2e] connectWalletIfNeeded: MetaMask connect requested (retry)",
      );
    } catch {
      // Ignore if the notification still does not appear.
      console.log(
        "[e2e] connectWalletIfNeeded: MetaMask connect retry skipped",
      );
    }

    const length = await getAccounts().then((list) => list.length);
    if (length > 0) {
      console.log("[e2e] connectWalletIfNeeded: connected");
      return;
    }
  }

  throw new Error("Wallet connection did not produce accounts");
}

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
    await connectWalletIfNeeded(page, metamask, senderAccountName);

    const attestationTitle = page
      .locator("[data-slot='card-title']", {
        hasText: "On-Chain Attestation",
      })
      .first();
    await attestationTitle.scrollIntoViewIfNeeded();
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
