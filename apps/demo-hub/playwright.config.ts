import { join } from "node:path";

import { defineConfig } from "@playwright/test";

const demoDbPath = join(__dirname, "..", "web", "e2e", ".data", "demo.db");
const demoDbUrl = `file:${demoDbPath}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm exec tsx scripts/start-demo-stack.ts",
    url: "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 240_000,
    env: {
      // Demo credentials
      DEMO_SEED_SECRET: "demo-seed-secret",
      DEMO_SUBJECT_EMAIL: "demo-subject@zentity.dev",
      DEMO_SUBJECT_PASSWORD: "demo-subject-password",
      DEMO_ISSUER_EMAIL: "demo-issuer@zentity.dev",
      DEMO_ISSUER_PASSWORD: "demo-issuer-password",
      // Service URLs
      NEXT_PUBLIC_DEMO_HUB_URL: "http://localhost:3100",
      NEXT_PUBLIC_WALLET_URL: "http://localhost:3101",
      NEXT_PUBLIC_ZENTITY_BASE_URL: "http://localhost:3000",
      NEXT_PUBLIC_DEMO_SUBJECT_EMAIL: "demo-subject@zentity.dev",
      ZENTITY_BASE_URL: "http://localhost:3000",
      // Auth configuration (required for better-auth)
      BETTER_AUTH_SECRET: "test-secret-32-chars-minimum-for-demo-e2e........",
      BETTER_AUTH_URL: "http://localhost:3000/api/auth",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      TRUSTED_ORIGINS: "http://localhost:3100,http://localhost:3101",
      // Database configuration
      E2E_DATABASE_PATH: demoDbPath,
      E2E_TURSO_DATABASE_URL: demoDbUrl,
      TURSO_DATABASE_URL: demoDbUrl,
      // E2E mode flags
      E2E_OIDC_ONLY: "true",
      NEXT_PUBLIC_ENABLE_FHEVM: "false",
      NEXT_PUBLIC_ENABLE_HARDHAT: "false",
    },
  },
});
