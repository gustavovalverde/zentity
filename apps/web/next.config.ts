import type { NextConfig } from "next";

import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  // Turbopack configuration for Buffer polyfill
  // ISSUE: Next.js ships buffer@5.6.0 at "next/dist/compiled/buffer" which LACKS BigInt methods
  // The free variable `Buffer` maps to "node:buffer" which aliases to the compiled buffer
  // We override BOTH to use our buffer@6.0.3 with BigInt methods (writeBigUInt64BE, etc.)
  turbopack: {
    resolveAlias: {
      // Override Next.js's internal buffer alias (v5.6.0 → v6.0.3)
      "next/dist/compiled/buffer": "buffer",
      // Also override direct buffer imports
      "node:buffer": "buffer",
    },
  },

  experimental: {
    // Required for large tRPC payloads (e.g., encrypted secrets) when using proxy.ts
    proxyClientMaxBodySize: "100mb",
    // Allow local workspace packages linked outside apps/web
    externalDir: true,
    // Optimize tree-shaking for large libraries with barrel files
    // Automatically transforms barrel imports to direct imports at build time
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-icons",
      "sonner",
      "@tanstack/react-query",
      "date-fns",
    ],
  },

  // Deterministic build ID for reproducible builds
  // Uses GIT_SHA from CI or falls back to git command
  generateBuildId: async () => {
    if (process.env.GIT_SHA) {
      return process.env.GIT_SHA;
    }
    // Fallback for local builds
    const { execSync } = await import("node:child_process");
    try {
      return execSync("git rev-parse HEAD").toString().trim();
    } catch {
      return `local-${Date.now()}`;
    }
  },

  // Mark packages as external for server-side usage
  // These are loaded at runtime from node_modules, not bundled
  serverExternalPackages: [
    // Face detection & ML (native .node bindings)
    "@vladmandic/human",
    "@tensorflow/tfjs-node",
    "@mapbox/node-pre-gyp",

    // ZK/FHE WASM packages (runtime loading)
    "@aztec/bb.js",
    "@zama-fhe/relayer-sdk",
    "node-tfhe",
    "node-tkms",

    // BBS+ signatures (WASM runtime loading)
    "@mattrglobal/pairing-crypto",

    // Logging (thread-stream ships test files that break bundling)
    "pino",
    "thread-stream",
    "pino-pretty",
  ],

  headers() {
    const securityHeaders: { key: string; value: string }[] = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(self), microphone=(), geolocation=()",
      },
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
    ];

    // External domains required by @zkpassport/sdk (hardcoded in minified bundle).
    const zkPassportDomains = [
      "https://cdn.zkpassport.id",
      "https://certificates.zkpassport.id",
      "https://circuits.zkpassport.id",
      "https://circuits2.zkpassport.id",
      "https://ipfs.zkpassport.id",
      "https://*.g.alchemy.com",
      "https://ethereum-sepolia-rpc.publicnode.com",
    ].join(" ");

    // Web3 domains: Zama fhEVM relayer/KMS + WalletConnect / Reown AppKit + Coinbase
    const web3Domains = [
      "https://relayer.testnet.zama.org",
      "https://relayer.mainnet.zama.org",
      "https://*.s3.eu-west-1.amazonaws.com",
      "https://rpc.walletconnect.org",
      "https://pulse.walletconnect.org",
      "https://api.web3modal.org",
      "https://secure.walletconnect.org",
      "https://*.walletconnect.com",
      "https://cca-lite.coinbase.com",
    ].join(" ");

    // CSP: strict in production; permissive in dev for HMR/fast-refresh
    const cspValue =
      process.env.NODE_ENV === "production"
        ? [
            "default-src 'self'",
            // 'unsafe-inline' required for Next.js hydration scripts; 'wasm-unsafe-eval' for ZK/FHE WASM
            "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
            // ws:/wss: for Socket.io liveness; data: for inline WASM (bb.js in ZKPassport SDK); ZKPassport CDN + RPC
            `connect-src 'self' ws: wss: data: ${zkPassportDomains} ${web3Domains}`,
            // data:/blob: for document scans and selfie processing; react-circle-flags CDN for country flags
            "img-src 'self' data: blob: https://react-circle-flags.pages.dev",
            // blob: for WASM thread workers
            "worker-src 'self' blob:",
            "frame-ancestors 'none'",
            "object-src 'none'",
            "base-uri 'none'",
          ].join("; ")
        : [
            "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' 'unsafe-inline'",
            `connect-src 'self' ws: wss: data: ${zkPassportDomains} ${web3Domains}`,
            "worker-src 'self' blob:",
          ].join("; ");

    securityHeaders.push({ key: "Content-Security-Policy", value: cspValue });

    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      });
    }

    // COOP: same-origin enables crossOriginIsolated → SharedArrayBuffer → multi-threaded WASM.
    // All dashboard routes need it because SPA navigation preserves the initial document's
    // isolation state — users reach /verify via client-side nav from other dashboard pages.
    // Auth routes (/sign-up, /sign-in, /oauth/*) remain outside /dashboard/* and unaffected.
    const isolatedHeaders = [
      ...securityHeaders,
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ];

    return [
      {
        source: "/:path*.wasm",
        headers: [{ key: "Content-Type", value: "application/wasm" }],
      },
      {
        source: "/:path*.wasm.gz",
        headers: [
          { key: "Content-Type", value: "application/wasm" },
          { key: "Content-Encoding", value: "gzip" },
        ],
      },
      // Dashboard routes: cross-origin isolated for multi-threaded WASM
      {
        source: "/dashboard/:path*",
        headers: isolatedHeaders,
      },
      // All other routes: standard security headers (no COOP restriction)
      { source: "/(.*)", headers: securityHeaders },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
