import { defineWalletSetup } from "@synthetixio/synpress";
import { getExtensionId, MetaMask } from "@synthetixio/synpress/playwright";

const SEED_PHRASE =
  process.env.SYNPRESS_SEED_PHRASE ??
  "test test test test test test test test test test test junk";
const WALLET_PASSWORD = process.env.SYNPRESS_WALLET_PASSWORD ?? "Password123!";
const E2E_ACCOUNT_NAME = process.env.SYNPRESS_ACCOUNT_NAME ?? "Account 2";
const HARDHAT_NETWORK_NAME =
  process.env.SYNPRESS_NETWORK_NAME ?? "Hardhat Local";
const HARDHAT_NETWORK_RPC_URL =
  process.env.SYNPRESS_NETWORK_RPC_URL ?? "http://127.0.0.1:8545";
const HARDHAT_NETWORK_CHAIN_ID = Number(
  process.env.SYNPRESS_NETWORK_CHAIN_ID ?? 31_337
);
const HARDHAT_NETWORK_SYMBOL = process.env.SYNPRESS_NETWORK_SYMBOL ?? "ETH";
const HARDHAT_NETWORK_EXPLORER_URL =
  process.env.SYNPRESS_NETWORK_EXPLORER_URL ?? "";

type ExtensionContext = Parameters<typeof getExtensionId>[0];
type MetaMaskContext = ConstructorParameters<typeof MetaMask>[0];
type MetaMaskPage = ConstructorParameters<typeof MetaMask>[1];

export default defineWalletSetup(
  WALLET_PASSWORD,
  async (context, walletPage) => {
    console.log("[synpress] wallet setup start", {
      hasSeedPhrase: Boolean(SEED_PHRASE),
      hasWalletPassword: Boolean(WALLET_PASSWORD),
      accountName: E2E_ACCOUNT_NAME,
      networkName: HARDHAT_NETWORK_NAME,
    });

    const extensionId = await getExtensionId(
      context as unknown as ExtensionContext,
      "MetaMask"
    );
    console.log("[synpress] extension id", extensionId);
    const metaMask = new MetaMask(
      context as unknown as MetaMaskContext,
      walletPage as unknown as MetaMaskPage,
      WALLET_PASSWORD,
      extensionId
    );

    await metaMask.importWallet(SEED_PHRASE);

    const hardhatNetwork = {
      name: HARDHAT_NETWORK_NAME,
      rpcUrl: HARDHAT_NETWORK_RPC_URL,
      chainId: HARDHAT_NETWORK_CHAIN_ID,
      symbol: HARDHAT_NETWORK_SYMBOL,
      ...(HARDHAT_NETWORK_EXPLORER_URL
        ? { blockExplorerUrl: HARDHAT_NETWORK_EXPLORER_URL }
        : {}),
    };

    try {
      await metaMask.addNetwork(hardhatNetwork);
    } catch {
      // Network may already exist from a previous run.
    }

    try {
      await metaMask.addNewAccount(E2E_ACCOUNT_NAME);
    } catch {
      // Account may already exist from a previous run.
    }

    await metaMask.switchAccount(E2E_ACCOUNT_NAME);
  }
);
