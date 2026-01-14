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
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
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
