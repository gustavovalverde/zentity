// @ts-nocheck — playwright-core version mismatch between synpress (1.48) and installed (1.58)
import { defineWalletSetup } from "@synthetixio/synpress";
import { MetaMask } from "@synthetixio/synpress/playwright";

export const SEED_PHRASE =
  "test test test test test test test test test test test junk";
export const PASSWORD = "Tester@1234";

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);
  await metamask.importWallet(SEED_PHRASE);

  // Click through the "Your wallet is ready!" screen to reach the main wallet interface
  // This is necessary because synpress's importWallet doesn't click through this final screen
  await walletPage.getByRole("button", { name: "Open wallet" }).click();
});
