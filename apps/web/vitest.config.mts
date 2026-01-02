import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

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
    setupFiles: ["./vitest.setup.mts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", ".next"],
    pool: "forks",
    fileParallelism: false,
    dangerouslyIgnoreUnhandledErrors: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/app/api/**"],
    },
  },
});
