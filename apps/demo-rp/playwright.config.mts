import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const currentDir =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : dirname(fileURLToPath(import.meta.url));
const webRoot = join(currentDir, "..", "web");
const authStatePath = join(webRoot, "e2e", ".auth", "user.json");
const issuerBaseURL =
  process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://127.0.0.1:3100";
const demoRpBaseURL =
  process.env.PLAYWRIGHT_DEMO_RP_BASE_URL ?? "http://localhost:3102";
const useExternalIssuerServer = process.env.E2E_EXTERNAL_WEB_SERVER === "true";
const useExternalDemoRpServer =
  process.env.E2E_EXTERNAL_DEMO_RP_SERVER === "true";

process.env.PLAYWRIGHT_TEST_BASE_URL ??= issuerBaseURL;
process.env.PLAYWRIGHT_DEMO_RP_BASE_URL ??= demoRpBaseURL;

const issuerUrl = new URL(issuerBaseURL);
const demoRpUrl = new URL(demoRpBaseURL);
const issuerPort =
  issuerUrl.port || (issuerUrl.protocol === "https:" ? "443" : "80");
const demoRpPort =
  demoRpUrl.port || (demoRpUrl.protocol === "https:" ? "443" : "80");
const issuerDbPath = join(webRoot, "e2e", ".data", "e2e.db");
const issuerDbUrl = `file:${issuerDbPath}`;
const demoRpDbPath = join(currentDir, ".data", "e2e.db");
const demoRpDbUrl = `file:${demoRpDbPath}`;

const chromeOptions = { ...devices["Desktop Chrome"] };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 120_000,
  workers: 1,
  reporter: "html",
  globalSetup: "./e2e/global-setup.mts",
  use: {
    ...chromeOptions,
    baseURL: demoRpBaseURL,
    storageState: authStatePath,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: [
    ...(useExternalIssuerServer
      ? []
      : [
          {
            command: "pnpm exec tsx e2e/automation/start-oidc-dev.ts",
            cwd: webRoot,
            url: issuerBaseURL,
            reuseExistingServer: false,
            timeout: 240 * 1000,
            env: {
              ...process.env,
              E2E_RESET_DB: "true",
              PLAYWRIGHT_TEST_BASE_URL: issuerBaseURL,
              TURSO_DATABASE_URL: issuerDbUrl,
              E2E_TURSO_DATABASE_URL: issuerDbUrl,
              E2E_DATABASE_PATH: issuerDbPath,
              BETTER_AUTH_SECRET:
                process.env.BETTER_AUTH_SECRET ??
                "test-secret-32-chars-minimum........",
              BETTER_AUTH_URL: issuerBaseURL,
              NEXT_PUBLIC_APP_URL: issuerBaseURL,
              HOSTNAME: issuerUrl.hostname,
              PORT: issuerPort,
              NEXT_PUBLIC_ENABLE_HARDHAT: "false",
              NEXT_PUBLIC_ENABLE_FHEVM: "false",
            },
          },
        ]),
    ...(useExternalDemoRpServer
      ? []
      : [
          {
            command: "pnpm exec tsx e2e/start-demo-rp-dev.ts",
            cwd: currentDir,
            url: `${demoRpBaseURL}/api/health`,
            reuseExistingServer: false,
            timeout: 240 * 1000,
            env: {
              ...process.env,
              E2E_RESET_DB: "true",
              PLAYWRIGHT_TEST_BASE_URL: issuerBaseURL,
              PLAYWRIGHT_DEMO_RP_BASE_URL: demoRpBaseURL,
              NEXT_PUBLIC_APP_URL: demoRpBaseURL,
              NEXT_PUBLIC_ZENTITY_URL: issuerBaseURL,
              ZENTITY_URL: issuerBaseURL,
              DATABASE_URL: demoRpDbUrl,
              BETTER_AUTH_SECRET:
                process.env.BETTER_AUTH_SECRET ??
                "demo-rp-e2e-secret-at-least-32-chars",
              HOSTNAME: demoRpUrl.hostname,
              PORT: demoRpPort,
            },
          },
        ]),
  ],
});
