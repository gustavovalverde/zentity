import type { BrowserContext } from "@playwright/test";
import type { Dappwright } from "@tenkeylabs/dappwright";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test as base } from "@playwright/test";
import { bootstrap, MetaMaskWallet } from "@tenkeylabs/dappwright";

// Hardhat's public mnemonic. Override it with a funded seed phrase to run
// against a live network.
const DEFAULT_SEED_PHRASE =
  "test test test test test test test test test test test junk";
const DEFAULT_WALLET_PASSWORD = "Tester@1234";
const AUTH_STATE_PATH = join(import.meta.dirname, "..", ".auth", "user.json");

interface WalletSession {
  context: BrowserContext;
  wallet: Dappwright;
}

/** Resolves an app path against the base URL the Playwright config selected. */
export function appUrl(path: string): string {
  const baseUrl = process.env.PLAYWRIGHT_TEST_BASE_URL;
  if (!baseUrl) {
    throw new Error("PLAYWRIGHT_TEST_BASE_URL is not set");
  }
  return new URL(path, baseUrl).href;
}

/**
 * dappwright launches the persistent Chromium context that holds the MetaMask
 * extension, so Playwright's `baseURL` and `storageState` options do not reach
 * it. The seeded session cookies are added here, and specs build absolute URLs
 * with `appUrl`.
 */
async function applySeededSession(context: BrowserContext) {
  try {
    const state = JSON.parse(readFileSync(AUTH_STATE_PATH, "utf8")) as {
      cookies?: Parameters<BrowserContext["addCookies"]>[0];
    };
    await context.addCookies(state.cookies ?? []);
  } catch {
    // Specs that need a signed-in user fail on their own assertions.
  }
}

export const test = base.extend<
  { wallet: Dappwright },
  { walletSession: WalletSession }
>({
  walletSession: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured first argument
    async ({}, use) => {
      const [wallet, , context] = await bootstrap("", {
        wallet: "metamask",
        version: MetaMaskWallet.recommendedVersion,
        seed: process.env.E2E_WALLET_SEED_PHRASE ?? DEFAULT_SEED_PHRASE,
        password: process.env.E2E_WALLET_PASSWORD ?? DEFAULT_WALLET_PASSWORD,
        showTestNets: true,
      });
      await applySeededSession(context);
      await use({ context, wallet });
      await context.close();
    },
    { scope: "worker" },
  ],
  context: async ({ walletSession }, use) => {
    await use(walletSession.context);
  },
  wallet: async ({ walletSession }, use) => {
    await use(walletSession.wallet);
  },
});
