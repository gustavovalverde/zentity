import type { BrowserContext, Page } from "@playwright/test";
import type { Dappwright } from "@tenkeylabs/dappwright";

const POLL_INTERVAL_MS = 100;
// The wallet's own tabs. A page on these paths without a query string is not a prompt.
const WALLET_HOME_PATHS = new Set(["/home.html", "/index.html"]);

function walletBase(url: string) {
  // `URL.origin` is opaque for chrome-extension: URLs, so build it by hand.
  const { host, protocol } = new URL(url);
  return `${protocol}//${host}`;
}

function isPrompt(candidate: Page, walletPage: Page, walletOrigin: string) {
  if (candidate === walletPage || candidate.isClosed()) {
    return false;
  }
  const url = new URL(candidate.url());
  return (
    `${url.protocol}//${url.host}` === walletOrigin &&
    (!WALLET_HOME_PATHS.has(url.pathname) || url.search !== "")
  );
}

/**
 * Approves the two prompts that submitting an on-chain attestation raises: the
 * EIP-712 consent signature, then the `attestWithPermit` transaction. Both
 * calls wait for their prompt, so a missing one fails the step instead of
 * surfacing later as a missing "Attested" state.
 */
export async function approveAttestationPrompts(wallet: Dappwright) {
  await wallet.sign();
  await wallet.confirmTransaction();
}

/**
 * Confirms a transaction only when MetaMask opens a prompt for it. dappwright's
 * own `confirmTransaction` waits two minutes for a popup, which is too long for
 * actions that sometimes complete without a wallet transaction.
 */
export async function confirmTransactionIfPrompted(
  wallet: Dappwright,
  context: BrowserContext,
  timeoutMs: number
): Promise<boolean> {
  const walletOrigin = walletBase(wallet.page.url());
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const popup = context
      .pages()
      .find((candidate) => isPrompt(candidate, wallet.page, walletOrigin));
    if (popup) {
      await wallet.confirmTransaction();
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}
