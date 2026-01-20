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
    // Security headers applied to all routes.
    // COEP/COOP are set server-side for proper SharedArrayBuffer support in nested workers.
    // Service worker approach (coi-serviceworker) cannot intercept nested worker requests.
    // See: https://github.com/w3c/ServiceWorker/issues/1529

    // Base security headers (shared across all routes)
    const securityHeaders: { key: string; value: string }[] = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(self), microphone=(), geolocation=()",
      },
      // "credentialless" is more lenient than "require-corp" - allows cross-origin resources
      // without explicit CORP headers while still enabling crossOriginIsolated
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
    ];

    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      });
    } else {
      securityHeaders.push({
        key: "Content-Security-Policy",
        value:
          "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' 'unsafe-inline'; " +
          "worker-src 'self' blob:;",
      });
    }

    // Cross-origin isolated headers for routes needing SharedArrayBuffer (WASM multi-threading)
    // Used by: TFHE keygen (sign-up), Barretenberg ZK proving (verification)
    const isolatedHeaders = [
      ...securityHeaders,
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ];

    // Wallet-friendly headers for routes with Web3 popup flows (no WASM needed)
    // "same-origin-allow-popups" allows wallet SDKs (e.g., Coinbase Smart Wallet) to
    // communicate via popups while maintaining COOP security for same-origin windows
    const walletHeaders = [
      ...securityHeaders,
      { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    ];

    const wasmHeaders = [
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
    ];

    return [
      ...wasmHeaders,
      // Wallet routes: allow popups for Web3 SDK flows
      // Note: Coinbase Smart Wallet is disabled globally (enableCoinbase: false in
      // web3-provider.tsx) because its popup flow conflicts with COOP: same-origin
      // required for SharedArrayBuffer/WASM on FHE routes like /sign-up.
      { source: "/dashboard/attestation/:path*", headers: walletHeaders },
      { source: "/dashboard/defi-demo/:path*", headers: walletHeaders },
      // All other routes: cross-origin isolated for SharedArrayBuffer (WASM multi-threading)
      { source: "/(.*)", headers: isolatedHeaders },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
