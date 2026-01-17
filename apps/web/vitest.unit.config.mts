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

    // Unit tests: exclude integration tests
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: [
      "node_modules",
      ".next",
      "src/**/*.integration.test.ts",
      "src/**/*.integration.test.tsx",
    ],

    // Use vmThreads pool with explicit memory limit support
    pool: "vmThreads",
    fileParallelism: false,
    maxWorkers: 1,
    isolate: true,
    // Memory limit for VM pools - recycle worker when exceeded
    vmMemoryLimit: 0.8, // 80% of available memory

    // Timeouts
    testTimeout: 15_000,
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
    },
  },
});
