import type { NextConfig } from "next";

import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
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

    // Logging (thread-stream ships test files that break bundling)
    "pino",
    "thread-stream",
    "pino-pretty",
  ],

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

    return [...wasmHeaders, { source: "/(.*)", headers: baseHeaders }];
  },
};

export default withBundleAnalyzer(nextConfig);
