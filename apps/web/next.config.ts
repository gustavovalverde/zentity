import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployments
  output: "standalone",

  // Mark packages as external for server-side usage
  // These are loaded at runtime from node_modules, not bundled
  serverExternalPackages: [
    "@vladmandic/human",
    "@tensorflow/tfjs-node",
    // bb.js works on both browser and Node.js
    // - Browser: Used by Web Worker for proof generation
    // - Server: Used by noir-verifier.ts for proof verification
    "@aztec/bb.js",
  ],

  // Turbopack configuration (Next.js 16 default)
  turbopack: {
    // Turbopack has built-in WASM support
  },

  // Configure webpack for WASM support (Noir/Barretenberg) - fallback for webpack builds
  webpack: (config, { isServer }) => {
    // Enable WebAssembly
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      topLevelAwait: true,
      layers: true,
    };

    // Handle WASM files
    config.module.rules.push({
      test: /\.wasm$/,
      type: "webassembly/async",
    });

    // On server, bb.js is loaded from node_modules at runtime (via serverExternalPackages)
    // This prevents webpack from trying to bundle the WASM files
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        "@aztec/bb.js": "commonjs @aztec/bb.js",
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
