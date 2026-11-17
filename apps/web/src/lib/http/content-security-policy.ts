// External domains required by @zkpassport/sdk and bb.js/Noir CRS downloads.
const ZKPASSPORT_DOMAINS = [
  "https://cdn.zkpassport.id",
  "https://certificates.zkpassport.id",
  "https://circuits.zkpassport.id",
  "https://circuits2.zkpassport.id",
  "https://ipfs.zkpassport.id",
  "https://crs.aztec.network",
  "https://crs.aztec-cdn.foundation",
  "https://crs.aztec-labs.com",
  "https://*.g.alchemy.com",
  "https://ethereum-sepolia-rpc.publicnode.com",
].join(" ");

// Relayer traffic is proxied through /api/confidential/relayer, so the relayer
// host needs no connect-src entry. The SDK still reaches cdn.zama.org and S3
// directly from its Web Worker, plus WalletConnect / Reown / Coinbase.
const WEB3_DOMAINS = [
  "https://cdn.zama.org",
  "https://*.s3.eu-west-1.amazonaws.com",
  "https://rpc.walletconnect.org",
  "https://pulse.walletconnect.org",
  "https://api.web3modal.org",
  "https://secure.walletconnect.org",
  "https://*.walletconnect.com",
  "https://cca-lite.coinbase.com",
].join(" ");

// IDKit uses the World ID Wallet Bridge from the browser.
const WORLD_ID_DOMAINS = "https://bridge.worldcoin.org";

// 127.0.0.1 and localhost are different CSP sources; the app's default local
// Hardhat RPC uses 127.0.0.1.
const DEFAULT_LOCAL_RPC_URL = "http://127.0.0.1:8545";

export const CSP_NONCE_HEADER = "x-nonce";

export function createCspNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * Production scripts run only from this origin or with the per-request nonce
 * Next.js stamps on its inline scripts. Development keeps 'unsafe-inline' and
 * 'unsafe-eval' for fast refresh, and lets the browser reach the local Hardhat
 * RPC at `localRpcUrl`.
 */
export function buildContentSecurityPolicy(
  nonce: string,
  isProduction: boolean,
  localRpcUrl?: string
): string {
  if (!isProduction) {
    // The proxy reads the raw variable, so a value env.ts would reject must
    // not throw on every page. `localhost:8545` parses with the scheme
    // `localhost:` and has the origin "null".
    const parsedRpcUrl = localRpcUrl ? URL.parse(localRpcUrl) : null;
    const localRpcOrigin =
      parsedRpcUrl?.protocol === "http:" || parsedRpcUrl?.protocol === "https:"
        ? parsedRpcUrl.origin
        : new URL(DEFAULT_LOCAL_RPC_URL).origin;
    return [
      "script-src 'self' blob: 'unsafe-eval' 'wasm-unsafe-eval' 'unsafe-inline'",
      `connect-src 'self' ws: wss: data: ${localRpcOrigin} ${ZKPASSPORT_DOMAINS} ${WEB3_DOMAINS} ${WORLD_ID_DOMAINS}`,
      "worker-src 'self' blob:",
    ].join("; ");
  }

  return [
    "default-src 'self'",
    // blob: for worker bootstrap scripts; 'wasm-unsafe-eval' for ZK/FHE WASM
    `script-src 'self' 'nonce-${nonce}' blob: 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data: https://fonts.reown.com",
    // wss: for the WalletConnect/Reown relay; data: for inline WASM (bb.js)
    `connect-src 'self' wss: data: ${ZKPASSPORT_DOMAINS} ${WEB3_DOMAINS} ${WORLD_ID_DOMAINS}`,
    "img-src 'self' data: blob: https://react-circle-flags.pages.dev",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join("; ");
}
