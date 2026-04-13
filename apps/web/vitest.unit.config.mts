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

    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: [
      "node_modules",
      ".next",
      "src/**/*.integration.test.ts",
      "src/**/*.integration.test.tsx",
    ],

    // `forks` = fresh Node process per file. With 115 files + heavy ESM graph
    // (better-auth, drizzle, noble/post-quantum, noir-js), `vmThreads` accumulates
    // module caches across VM contexts in a single worker until the heap dies
    // silently mid-run. Process-per-file releases memory unconditionally.
    //
    // Vitest 4 flattened pool options to top-level: `execArgv`, `maxWorkers`,
    // `isolate` live directly on `test` instead of under `poolOptions.forks.*`.
    pool: "forks",
    execArgv: ["--max-old-space-size=2048"],

    // Serial execution: the shared SQLite test DB cannot tolerate parallel writes,
    // and deterministic ordering makes cross-file state bugs reproducible.
    fileParallelism: false,
    maxWorkers: 1,
    isolate: true,

    testTimeout: 15_000,
    hookTimeout: 10_000,
    teardownTimeout: 5000,

    retry: isCI ? 1 : 0,

    clearMocks: true,
    restoreMocks: true,

    // `default` reporter hides worker crashes (exits 0 without a summary).
    // `verbose` + `hanging-process` surface both lost tests and stuck teardowns.
    reporters: isCI
      ? ["default", "hanging-process", "github-actions"]
      : ["default", "hanging-process"],

    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/app/api/**"],
      // Baseline for the `forks` pool chosen in ADR-0005. `vmThreads` reported
      // higher percentages because a shared worker aggregated v8 coverage across
      // all files, while forks capture per-process and merge only executed ranges.
      // The tests and assertions haven't regressed; the measurement floor moved.
      // Treat these as the new ratchet, not as a code-quality target.
      thresholds: {
        statements: 25,
        branches: 20,
        functions: 31,
        lines: 26,
      },
    },
  },
});
