import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV !== "production";

function buildContentSecurityPolicy() {
  const scriptSources = ["'self'", "'unsafe-inline'"];
  const connectSources = ["'self'"];

  if (isDevelopment) {
    scriptSources.push("'unsafe-eval'");
    connectSources.push("ws:", "wss:");
  }

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSources.join(" ")}`,
    "img-src 'self' data:",
    "frame-ancestors 'none'",
  ].join("; ");
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy(),
  },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  output: "standalone",
  turbopack: {
    resolveAlias: {
      // @wagmi/core's Tempo connector probes the optional Accounts SDK with
      // await import("accounts"). Turbopack resolves that statically, so keep
      // the optional connector absent and point the probe at an empty module.
      accounts: "./src/lib/turbopack-stubs/accounts.ts",
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
