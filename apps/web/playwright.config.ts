/**
 * Playwright configuration with feature-based test projects.
 *
 * Run specific projects:
 *   pnpm test:e2e --project=auth
 *   pnpm test:e2e --project=onboarding
 *   pnpm test:e2e --project=web3-hardhat
 *   pnpm test:e2e --project=web3-sepolia
 *   pnpm test:e2e --project=oidc
 *   pnpm test:e2e --project=recovery
 *   pnpm test:e2e --project=dashboard
 */
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const authFile = join(__dirname, "e2e", ".auth", "user.json");
const isOidcOnly = process.env.E2E_OIDC_ONLY === "true";
const useExternalServer = process.env.E2E_EXTERNAL_WEB_SERVER === "true";
const useWebServer = !useExternalServer && process.env.E2E_SEPOLIA !== "true";

// When using an external web server, use the dev server's database (defaults to .data/dev.db)
// When starting our own server, use the isolated E2E database (e2e/.data/e2e.db)
const devDbPath = join(__dirname, ".data", "dev.db");
const e2eDbPath =
  process.env.E2E_DATABASE_PATH ??
  (useExternalServer ? devDbPath : join(__dirname, "e2e", ".data", "e2e.db"));
const e2eDbUrl =
  process.env.E2E_TURSO_DATABASE_URL ??
  (e2eDbPath.startsWith("file:") ? e2eDbPath : `file:${e2eDbPath}`);

process.env.E2E_DATABASE_PATH ??= e2eDbPath;
process.env.E2E_TURSO_DATABASE_URL ??= e2eDbUrl;
process.env.TURSO_DATABASE_URL ??= e2eDbUrl;
const webServerEnv = {
  TURSO_DATABASE_URL: e2eDbUrl,
  E2E_DATABASE_PATH: e2eDbPath,
  E2E_TURSO_DATABASE_URL: e2eDbUrl,
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET ?? "test-secret-32-chars-minimum........",
  BETTER_AUTH_URL: "http://localhost:3000",
  ...(process.env.E2E_OIDC_ONLY
    ? { E2E_OIDC_ONLY: process.env.E2E_OIDC_ONLY }
    : {}),
};

const chromeOptions = { ...devices["Desktop Chrome"] };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    storageState: authFile,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // Auth tests - foundational, no dependencies
    {
      name: "auth",
      testMatch: /e2e\/auth\/.*\.spec\.ts/,
      use: chromeOptions,
    },
    // Dashboard tests - requires authenticated session
    {
      name: "dashboard",
      testMatch: /e2e\/dashboard\/.*\.spec\.ts/,
      use: chromeOptions,
    },
    // Onboarding flow tests
    {
      name: "onboarding",
      testMatch: /e2e\/onboarding\/.*\.spec\.ts/,
      use: chromeOptions,
    },
    // Web3 tests with local Hardhat
    {
      name: "web3-hardhat",
      testMatch: /e2e\/web3\/(?!sepolia).*\.spec\.ts/,
      use: chromeOptions,
    },
    // Web3 tests with Sepolia testnet
    {
      name: "web3-sepolia",
      testMatch: /e2e\/web3\/sepolia.*\.spec\.ts/,
      use: chromeOptions,
    },
    // OIDC protocol tests
    {
      name: "oidc",
      testMatch: /e2e\/oidc\/.*\.spec\.ts/,
      use: chromeOptions,
    },
    // BBS+ credential tests
    {
      name: "bbs",
      testMatch: /e2e\/bbs\/.*\.spec\.ts/,
      use: chromeOptions,
    },
    // Recovery flow tests
    {
      name: "recovery",
      testMatch: /e2e\/recovery\/.*\.spec\.ts/,
      use: chromeOptions,
    },
    // Automation validation (internal tooling tests)
    {
      name: "automation",
      testMatch: /e2e\/automation\/.*\.spec\.ts/,
      use: chromeOptions,
    },
  ],
  ...(useWebServer
    ? {
        webServer: {
          command: isOidcOnly
            ? "pnpm exec tsx e2e/automation/start-oidc-dev.ts"
            : "pnpm exec tsx e2e/automation/start-web3-dev.ts",
          url: "http://localhost:3000",
          reuseExistingServer: true,
          timeout: 240 * 1000,
          env: webServerEnv,
        },
      }
    : {}),
});
