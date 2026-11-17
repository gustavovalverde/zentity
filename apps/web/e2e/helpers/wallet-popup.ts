import type { BrowserContext } from "@playwright/test";
import type { Dappwright } from "@tenkeylabs/dappwright";

const POLL_INTERVAL_MS = 100;

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
  const { host, protocol } = new URL(wallet.page.url());
  const walletBase = `${protocol}//${host}/`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const popup = context
      .pages()
      .find(
        (candidate) =>
          candidate !== wallet.page &&
          !candidate.isClosed() &&
          candidate.url().startsWith(walletBase)
      );
    if (popup) {
      await wallet.confirmTransaction();
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}
