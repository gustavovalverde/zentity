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

    // Pool: forks is more compatible with Bun (threads has issues)
    pool: "forks",
    fileParallelism: false,

    // Workers: limit in CI to prevent resource exhaustion
    maxWorkers: isCI ? 2 : undefined,

    // Timeouts: prevent hanging tests
    testTimeout: 30_000,
    hookTimeout: 10_000,
    teardownTimeout: 5000,

    // Retry flaky tests in CI only
    retry: isCI ? 1 : 0,

    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/app/api/**"],
    },
  },
});
