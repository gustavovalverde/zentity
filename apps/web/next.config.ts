import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployments
  output: "standalone",

  // Mark better-sqlite3 as external for server-side usage
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
