/**
 * Vitest configuration for integration tests.
 *
 * Integration tests hit real services (DB, HTTP, libSQL) and must run
 * in isolated processes to prevent cross-file state bleed. Use
 * `pnpm test:integration` to run these tests.
 *
 * For unit tests, see `vitest.unit.config.mts`.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const isCI = process.env.CI === "true";

export default defineConfig({
  resolve: {
    alias: {
      "@/noir-circuits": resolve(
        fileURLToPath(new URL(".", import.meta.url)),
        "./noir-circuits"
      ),
      "@": resolve(fileURLToPath(new URL(".", import.meta.url)), "./src"),
      "client-only": resolve(
        fileURLToPath(new URL(".", import.meta.url)),
        "./src/test-utils/client-only.ts"
      ),
      "server-only": resolve(
        fileURLToPath(new URL(".", import.meta.url)),
        "./src/test-utils/server-only.ts"
      ),
    },
  },
  test: {
    environment: "node",
    globals: true,
    globalSetup: ["./vitest.global-setup.ts"],
    setupFiles: ["./vitest.setup.mts"],

    include: ["src/**/*.integration.test.ts", "src/**/*.integration.test.tsx"],
    exclude: ["node_modules", ".next"],

    pool: "forks",
    execArgv: ["--max-old-space-size=2048"],
    fileParallelism: false,
    maxWorkers: 1,
    isolate: true,

    testTimeout: 30_000,
    hookTimeout: 10_000,
    teardownTimeout: 5000,

    retry: isCI ? 1 : 0,

    clearMocks: true,
    restoreMocks: true,

    reporters: isCI
      ? ["default", "hanging-process", "github-actions"]
      : ["default", "hanging-process"],

    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/app/api/**"],
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 45,
        lines: 50,
      },
    },
  },
});
