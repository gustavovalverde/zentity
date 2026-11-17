import type { Page } from "@playwright/test";
import type { Dappwright } from "@tenkeylabs/dappwright";

import { expect } from "@playwright/test";

// Top-level regex patterns for lint/performance/useTopLevelRegex compliance
const METAMASK_BUTTON = /MetaMask/i;
const BROWSER_WALLET_BUTTON = /Browser Wallet|Injected/i;

type EthereumWindow = Window & {
  ethereum?: { request: (args: { method: string }) => Promise<unknown> };
};

async function getAccounts(page: Page) {
  return await page.evaluate(async () => {
    try {
      const result = await (
        globalThis as unknown as EthereumWindow
      ).ethereum?.request({ method: "eth_accounts" });
      return Array.isArray(result) ? (result as string[]) : [];
    } catch {
      return [] as string[];
    }
  });
}

/**
 * Revokes the site's access to every wallet account and reloads, so the next
 * connection prompt offers the account MetaMask has selected.
 */
export async function revokeWalletConnection(page: Page) {
  await page.evaluate(() =>
    (
      globalThis as unknown as {
        ethereum: {
          request: (args: {
            method: string;
            params: unknown[];
          }) => Promise<unknown>;
        };
      }
    ).ethereum.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    })
  );
  await page.reload();
}

/**
 * Opens the AppKit modal on a page that shows `<appkit-button>`, picks the
 * MetaMask extension, and approves the connection request in MetaMask. Returns
 * immediately when the page already has an authorized account.
 */
export async function connectWalletIfNeeded({
  page,
  wallet,
}: {
  page: Page;
  wallet: Dappwright;
}) {
  await page.bringToFront();
  if ((await getAccounts(page)).length > 0) {
    return;
  }

  await page.locator("appkit-button").first().click();
  const metaMaskOption = page.getByRole("button", { name: METAMASK_BUTTON });
  const injectedOption = page.getByRole("button", {
    name: BROWSER_WALLET_BUTTON,
  });
  await metaMaskOption.or(injectedOption).first().click({ timeout: 15_000 });

  await wallet.approve();

  await expect
    .poll(() => getAccounts(page), {
      message: "Wallet connection did not produce accounts",
      timeout: 20_000,
    })
    .not.toHaveLength(0);
  // After a reconnect the modal sometimes stays on "Continue in MetaMask" even
  // though the account is connected, and it then blocks later clicks.
  const modal = page.locator("w3m-modal.open");
  const closed = await modal
    .waitFor({ state: "hidden", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!closed) {
    await page.keyboard.press("Escape");
    await modal.waitFor({ state: "hidden", timeout: 10_000 });
  }
}
