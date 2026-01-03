import type { NextConfig } from "next";

import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployments
  output: "standalone",

  experimental: {
    // Required for large tRPC payloads (e.g., encrypted secrets) when using proxy.ts
    proxyClientMaxBodySize: "100mb",
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
    "@vladmandic/human",
    "@tensorflow/tfjs-node",
    // tfjs-node transitive deps (Turbopack hash mismatch workaround)
    "@tensorflow/tfjs",
    "@tensorflow/tfjs-core",
    "@tensorflow/tfjs-backend-cpu",
    "@tensorflow/tfjs-converter",
    "@tensorflow/tfjs-layers",
    "@tensorflow/tfjs-data",
    "@mapbox/node-pre-gyp",
    // bb.js works on both browser and Node.js
    // - Browser: Used by Web Worker for proof generation
    // - Server: Used by noir-verifier.ts for proof verification
    "@aztec/bb.js",
    // Zama relayer SDK relies on wasm assets that must stay in node_modules
    "@zama-fhe/relayer-sdk",
    // Include subpath + native deps so Turbopack keeps them external
    "@zama-fhe/relayer-sdk/node",
    "node-tfhe",
    "node-tkms",
    // Optional dependencies for wallet SDKs (avoid bundler resolution issues)
    "pino-pretty",
    // Pino pulls in thread-stream which ships test files that break Next bundling
    "pino",
    "thread-stream",
    "lokijs",
    "encoding",
  ],

  turbopack: {
    resolveAlias: {
      "node:buffer": "buffer",
      "@coinbase/wallet-sdk": "./src/lib/wagmi/empty-module",
      "@gemini-wallet/core": "./src/lib/wagmi/empty-module",
      "@metamask/sdk": "./src/lib/wagmi/empty-module",
      "@react-native-async-storage/async-storage":
        "./src/lib/wagmi/empty-module",
      porto: "./src/lib/wagmi/empty-module",
      "porto/internal": "./src/lib/wagmi/empty-module/internal",
      // Optional deps referenced by wallet tooling
      "pino-pretty": "./src/lib/wagmi/empty-module",
      lokijs: "./src/lib/wagmi/empty-module",
      encoding: "./src/lib/wagmi/empty-module",
    },
  },

  headers() {
    // Security headers applied to all routes.
    // NOTE: COEP/COOP headers are NOT set here - they're handled by coi-serviceworker.js
    // This is intentional: server-side COEP headers conflict with service worker approach.
    // See: https://web.dev/articles/coop-coep
    const baseHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(self), microphone=(), geolocation=()",
      },
    ];

    if (process.env.NODE_ENV === "production") {
      baseHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      });
    } else {
      baseHeaders.push({
        key: "Content-Security-Policy",
        value:
          "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' 'unsafe-inline'; " +
          "worker-src 'self' blob:;",
      });
    }

    return [{ source: "/(.*)", headers: baseHeaders }];
  },
};

export default withBundleAnalyzer(nextConfig);
