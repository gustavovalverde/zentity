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
      // @wagmi/core@3.4.5's tempo module has `await import("accounts").catch(...)`
      // for the optional Tempo Accounts SDK. Turbopack analyzes statically and
      // fails to resolve even though the runtime catches the miss. Alias to an
      // empty stub so the bundle builds; tempoWallet is never referenced here.
      accounts: "./src/lib/turbopack-stubs/accounts.ts",
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

    // Blockchain / FHEVM (Hardhat utils, contract ABIs, viem)
    "@fhevm/mock-utils",
    "@zentity/contracts",
    "viem",

    // Post-quantum cryptography
    "@noble/post-quantum",

    // OpenTelemetry (auto-instrumentations alone imports ~30 Node modules)
    "@opentelemetry/sdk-node",
    "@opentelemetry/auto-instrumentations-node",
    "@opentelemetry/exporter-metrics-otlp-http",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/sdk-metrics",
    "@opentelemetry/resources",

    // Auth protocol libraries (WASM/native bindings)
    "@serenity-kit/opaque",
    "web-push",

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

    // External domains required by @zkpassport/sdk and bb.js/Noir CRS downloads.
    const zkPassportDomains = [
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
            "font-src 'self' data: https://fonts.reown.com",
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
            // http://127.0.0.1:8545 for local Hardhat RPC (127.0.0.1 !== localhost in CSP)
            `connect-src 'self' ws: wss: data: http://127.0.0.1:8545 ${zkPassportDomains} ${web3Domains}`,
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

    // Verify pages: require-corp COEP guarantees crossOriginIsolated on all
    // browsers (Firefox/Safari don't grant it with credentialless).
    // Cross-origin resources on verify pages need crossorigin="anonymous".
    const verifyIsolatedHeaders = isolatedHeaders.map((h) =>
      h.key === "Cross-Origin-Embedder-Policy"
        ? { key: h.key, value: "require-corp" }
        : h
    );

    return [
      // Service worker: no-cache ensures users always get the latest version
      {
        source: "/push-sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
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
      // Verify routes: require-corp COEP for guaranteed multi-threaded WASM.
      // The bare path must be listed explicitly — :path* requires ≥1 segment.
      {
        source: "/dashboard/verify",
        headers: verifyIsolatedHeaders,
      },
      {
        source: "/dashboard/verify/:path*",
        headers: verifyIsolatedHeaders,
      },
      // Dashboard routes: cross-origin isolated for multi-threaded WASM
      {
        source: "/dashboard/:path*",
        headers: isolatedHeaders,
      },
      // All other routes: standard security headers (no COOP restriction)
      { source: "/(.*)", headers: securityHeaders },
      // Web3 wallet pages — MUST be last so they override both catch-alls.
      // Relaxed COOP (same-origin-allow-popups) for MetaMask popup signing.
      // COEP: unsafe-none because these pages don't need SharedArrayBuffer
      // and credentialless COEP can interfere with extension port messaging.
      ...(
        [
          "/dashboard/attestation",
          "/dashboard/defi-demo",
          "/dashboard/defi-demo/:path*",
        ] as const
      ).map((source) => ({
        source,
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "unsafe-none",
          },
        ],
      })),
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
