import type { NextConfig } from "next";

import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
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
    "node-tfhe",
    "node-tkms",

    // Blockchain / confidential contracts
    "@zama-fhe/sdk",
    "@zentity/contracts",
    "viem",

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
      // Base security headers. More specific rules below override duplicate
      // COOP/COEP keys for routes that need stronger isolation or wallet popups.
      { source: "/(.*)", headers: securityHeaders },
      // Dashboard routes: cross-origin isolated for multi-threaded WASM
      {
        source: "/dashboard/:path*",
        headers: isolatedHeaders,
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
      // Web3 wallet pages — MUST be last so they override the dashboard catch-all.
      // The confidential SDK runs single-threaded (no SharedArrayBuffer), so these
      // pages neither need nor benefit from cross-origin isolation. They DO need:
      //   - same-origin-allow-popups: some wallet flows (Coinbase, WalletConnect
      //     fallback) open a signing popup that uses window.opener to post back.
      //   - unsafe-none COEP: the default `credentialless` strips credentials from
      //     cross-origin requests, which can break browser-extension port messaging
      //     that wallet extensions rely on to talk to their background script.
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
