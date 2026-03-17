/**
 * Vitest configuration for integration tests.
 *
 * Integration tests use real database connections and run serially
 * to avoid conflicts. Use `pnpm test:integration` to run these tests.
 *
 * For unit tests (parallel, no DB), use `pnpm test:unit`.
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
        "./src/test/client-only.ts"
      ),
      "server-only": resolve(
        fileURLToPath(new URL(".", import.meta.url)),
        "./src/test/server-only.ts"
      ),
    },
  },
  test: {
    environment: "node",
    globals: true,
    globalSetup: ["./vitest.global-setup.ts"],
    setupFiles: ["./vitest.setup.mts"],

    // Integration tests: only .integration.test.ts files
    include: ["src/**/*.integration.test.ts", "src/**/*.integration.test.tsx"],
    exclude: ["node_modules", ".next"],

    // Integration tests run serially to avoid DB conflicts
    pool: "threads",
    fileParallelism: false,
    maxWorkers: 1,
    isolate: true,

    // Longer timeouts for DB operations
    testTimeout: 30_000,
    hookTimeout: 10_000,
    teardownTimeout: 5000,

    // Retry flaky tests in CI only
    retry: isCI ? 1 : 0,

    // Clear mocks between tests
    clearMocks: true,
    restoreMocks: true,

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
