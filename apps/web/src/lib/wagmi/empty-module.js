/**
 * Empty module stub for optional wallet SDKs.
 * Used by Turbopack to resolve optional dependencies that we don't use.
 * @wagmi/connectors dynamically imports wallet SDKs, but we use Reown AppKit instead.
 */

// Coinbase Wallet SDK stub
export function createCoinbaseWalletSDK() {
  throw new Error("@coinbase/wallet-sdk is not installed");
}

// Generic default export
export default {};
