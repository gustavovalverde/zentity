import * as path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const authFile = path.join(__dirname, "e2e", ".auth", "user.json");
const e2eDbPath =
  process.env.E2E_DATABASE_PATH ??
  path.join(__dirname, "e2e", ".data", "e2e.db");
const useWebServer =
  process.env.E2E_EXTERNAL_WEB_SERVER !== "true" &&
  process.env.E2E_SEPOLIA !== "true";

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
          command: "bun e2e/automation/start-web3-dev.ts",
          url: "http://localhost:3000",
          reuseExistingServer: true,
          timeout: 240 * 1000,
          env: {
            DATABASE_PATH: e2eDbPath,
            E2E_DATABASE_PATH: e2eDbPath,
            BETTER_AUTH_SECRET:
              process.env.BETTER_AUTH_SECRET ??
              "test-secret-32-chars-minimum........",
            BETTER_AUTH_URL: "http://localhost:3000",
          },
        },
      }
    : {}),
});
