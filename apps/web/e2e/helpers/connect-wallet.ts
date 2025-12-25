import type { Page } from "@playwright/test";
import type { MetaMask } from "@synthetixio/synpress/playwright";

type BrowserEthereum = {
  request?: (args: { method: string }) => Promise<unknown>;
};

type BrowserAppKit = {
  open?: () => void;
  close?: () => void;
  setCaipAddress?: (
    address: string,
    namespace?: string,
    sync?: boolean,
  ) => void;
  setStatus?: (status: string, namespace?: string) => void;
  getActiveChainNamespace?: () => string;
  getAccount?: (namespace?: string) => { isConnected?: boolean } | undefined;
};

type BrowserWindow = Window & {
  ethereum?: BrowserEthereum;
  __appkit?: BrowserAppKit;
};

type ConnectWalletOptions = {
  page: Page;
  metamask: MetaMask;
  accountName?: string;
  chainId: number;
};

function escapeRegExp(value: string) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getNotificationPage(metamask: MetaMask, timeoutMs = 15_000) {
  const extensionId = metamask.extensionId;
  if (!extensionId) return null;
  const notificationUrl = `chrome-extension://${extensionId}/notification.html`;
  const existing = metamask.context
    .pages()
    .find((page) => page.url().includes(notificationUrl));
  if (existing) return existing;
  try {
    return await metamask.context.waitForEvent("page", {
      predicate: (page) => page.url().includes(notificationUrl),
      timeout: timeoutMs,
    });
  } catch {
    return null;
  }
}

async function approveNetworkSwitch(metamask: MetaMask) {
  const notification = await getNotificationPage(metamask, 5_000);
  if (!notification) return false;
  const switchButton = notification.getByRole("button", {
    name: /switch network/i,
  });
  if (await switchButton.isVisible().catch(() => false)) {
    await switchButton.click();
    return true;
  }
  return false;
}

async function manualConnect(
  metamask: MetaMask,
  accountName?: string,
): Promise<boolean> {
  const notification = await getNotificationPage(metamask);
  if (!notification) return false;

  await notification.bringToFront();
  await notification
    .waitForLoadState("domcontentloaded")
    .catch(() => undefined);

  if (accountName) {
    const accountText = notification
      .getByText(new RegExp(`^${escapeRegExp(accountName)}`, "i"))
      .first();
    if (await accountText.isVisible().catch(() => false)) {
      const checkbox = accountText
        .locator("xpath=ancestor-or-self::*[self::li or self::div][1]")
        .locator("input[type=checkbox]")
        .first();
      if (await checkbox.isVisible().catch(() => false)) {
        const isChecked = await checkbox.isChecked().catch(() => true);
        if (!isChecked) {
          await checkbox.check();
        }
      }
    }
  }

  const nextButton = notification.getByRole("button", { name: /next/i });
  if (await nextButton.isVisible().catch(() => false)) {
    await nextButton.click();
  }

  const connectButton = notification.getByRole("button", { name: /connect/i });
  if (await connectButton.isVisible().catch(() => false)) {
    await connectButton.click();
    return true;
  }

  return false;
}

async function getAccounts(page: Page) {
  return page.evaluate(async () => {
    try {
      const appWindow = window as BrowserWindow;
      const ethereum = appWindow.ethereum;
      if (!ethereum?.request) return [] as string[];
      const result = await ethereum.request({ method: "eth_accounts" });
      return Array.isArray(result) ? (result as string[]) : [];
    } catch {
      return [] as string[];
    }
  });
}

async function ensureAppKitConnected(
  page: Page,
  chainId: number,
  address?: string,
) {
  if (!address) return;
  const isConnected = await page
    .evaluate(() => {
      const appWindow = window as BrowserWindow;
      const appkit = appWindow.__appkit;
      if (!appkit?.getAccount) return false;
      const account = appkit.getAccount("eip155") ?? appkit.getAccount();
      return Boolean(account?.isConnected);
    })
    .catch(() => false);

  if (isConnected) return;

  await page
    .evaluate(
      ({ addr, activeChainId }) => {
        const appWindow = window as BrowserWindow;
        const appkit = appWindow.__appkit;
        if (!appkit?.setCaipAddress || !appkit?.setStatus) return false;
        const namespace = appkit.getActiveChainNamespace?.() ?? "eip155";
        const caipAddress = `eip155:${activeChainId}:${addr}`;
        appkit.setCaipAddress(caipAddress, namespace, true);
        appkit.setStatus("connected", namespace);
        return true;
      },
      { addr: address, activeChainId: chainId },
    )
    .catch(() => undefined);
}

export async function connectWalletIfNeeded({
  page,
  metamask,
  accountName,
  chainId,
}: ConnectWalletOptions) {
  await page.bringToFront();
  await page
    .waitForFunction(() => Boolean((window as BrowserWindow).__appkit), null, {
      timeout: 10_000,
    })
    .catch(() => undefined);

  try {
    await Promise.race([metamask.unlock(), page.waitForTimeout(5_000)]);
  } catch {
    // Ignore if already unlocked.
  }

  const existingAccounts = await getAccounts(page);
  if (existingAccounts.length > 0) {
    await ensureAppKitConnected(page, chainId, existingAccounts[0]);
    return;
  }

  // Open AppKit modal and choose MetaMask.
  const hasAppKit = await page.evaluate(() =>
    Boolean((window as BrowserWindow).__appkit),
  );
  if (hasAppKit) {
    await page.evaluate(() => {
      const appWindow = window as BrowserWindow;
      appWindow.__appkit?.open?.();
    });
  } else {
    await page.locator("appkit-button").first().click();
  }

  const metaMaskOption = page.getByRole("button", { name: /MetaMask/i });
  const injectedOption = page.getByRole("button", {
    name: /Browser Wallet|Injected/i,
  });
  await Promise.race([
    metaMaskOption.waitFor({ state: "visible", timeout: 15_000 }),
    injectedOption.waitFor({ state: "visible", timeout: 15_000 }),
    page.waitForTimeout(15_000),
  ]);
  if (await metaMaskOption.isVisible().catch(() => false)) {
    await metaMaskOption.click();
  } else if (await injectedOption.isVisible().catch(() => false)) {
    await injectedOption.click();
  } else {
    // Modal may not show options (already connected or auto-injected).
    await page
      .evaluate(() => {
        const appWindow = window as BrowserWindow;
        appWindow.__appkit?.close?.();
      })
      .catch(() => undefined);
  }

  // Handle MetaMask switch network requests if they appear.
  await approveNetworkSwitch(metamask);

  // Try synpress MetaMask helper, fall back to manual popup.
  let connected = false;
  try {
    if (accountName) {
      await metamask.connectToDapp([accountName]);
    } else {
      await metamask.connectToDapp();
    }
    connected = true;
  } catch {
    connected = await manualConnect(metamask, accountName);
  }

  if (!connected) {
    throw new Error("MetaMask connect flow did not complete");
  }

  // Wait for injected accounts.
  let accounts: string[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    accounts = await getAccounts(page);
    if (accounts.length > 0) break;
    await page.waitForTimeout(1000);
  }
  if (accounts.length === 0) {
    throw new Error("Wallet connection did not produce accounts");
  }

  await ensureAppKitConnected(page, chainId, accounts[0]);
  await page
    .evaluate(() => {
      const appWindow = window as BrowserWindow;
      return appWindow.__appkit?.close?.();
    })
    .catch(() => undefined);
  const appkitModal = page.locator("w3m-modal");
  if ((await appkitModal.count()) > 0) {
    await appkitModal
      .first()
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => undefined);
  }
  await page.waitForTimeout(1000);
}
