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
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", ".next"],

    // Pool: threads shares memory more efficiently than forks
    pool: "threads",
    fileParallelism: false,

    // Single worker to reduce memory usage
    maxWorkers: 1,
    // Isolation ensures tests don't share module state
    isolate: true,

    // Timeouts: prevent hanging tests
    testTimeout: 30_000,
    hookTimeout: 10_000,
    teardownTimeout: 5000,

    // Retry flaky tests in CI only
    retry: isCI ? 1 : 0,

    // Clear mocks between tests to prevent memory accumulation
    clearMocks: true,
    restoreMocks: true,

    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/app/api/**"],
    },
  },
});
