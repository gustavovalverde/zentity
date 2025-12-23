import type { NextConfig } from "next";

import path from "node:path";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployments
  output: "standalone",

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
  ],

  // Webpack fallback configuration (for --webpack builds)
  webpack: (config, { isServer }) => {
    const webpack = require("webpack");
    // Enable top-level await + layers for webpack builds
    config.experiments = {
      ...config.experiments,
      topLevelAwait: true,
      layers: true,
    };

    // Treat WASM as an emitted asset so wasm-bindgen JS loaders can fetch it.
    // This avoids Webpack trying to resolve "wbg" imports inside wasm modules.
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });

    // Polyfill node:buffer for browser bundles (noir worker uses node:buffer)
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "node:buffer": "buffer",
      "@coinbase/wallet-sdk": path.resolve(
        __dirname,
        "src/lib/wagmi/empty-module",
      ),
      "@gemini-wallet/core": path.resolve(
        __dirname,
        "src/lib/wagmi/empty-module",
      ),
      "@metamask/sdk": path.resolve(__dirname, "src/lib/wagmi/empty-module"),
      "@react-native-async-storage/async-storage": path.resolve(
        __dirname,
        "src/lib/wagmi/empty-module",
      ),
      porto: path.resolve(__dirname, "src/lib/wagmi/empty-module"),
      "porto/internal": path.resolve(
        __dirname,
        "src/lib/wagmi/empty-module/internal",
      ),
    };
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      buffer: require.resolve("buffer/"),
    };
    config.plugins = config.plugins || [];
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^node:/,
        (resource: { request?: string }) => {
          // Strip node: scheme so webpack resolves browser fallbacks.
          // Example: node:buffer -> buffer
          if (resource.request) {
            resource.request = resource.request.replace(/^node:/, "");
          }
        },
      ),
      new webpack.ProvidePlugin({
        Buffer: ["buffer", "Buffer"],
      }),
    );

    // Official Reown AppKit recommendation for WalletConnect
    // https://docs.reown.com/appkit/next/core/installation
    config.externals.push("pino-pretty", "lokijs", "encoding");

    // On server, bb.js is loaded from node_modules at runtime
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        "@aztec/bb.js": "commonjs @aztec/bb.js",
        "@zama-fhe/relayer-sdk": "commonjs @zama-fhe/relayer-sdk",
        "@zama-fhe/relayer-sdk/node": "commonjs @zama-fhe/relayer-sdk/node",
        "node-tfhe": "commonjs node-tfhe",
        "node-tkms": "commonjs node-tkms",
      });
    }

    return config;
  },

  async headers() {
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(self), microphone=(), geolocation=()",
      },
    ];

    if (process.env.NODE_ENV === "production") {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      });
    }

    return [
      {
        source: "/(.*)",
        headers,
      },
    ];
  },
};

export default nextConfig;
