import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/agent-contract.ts",
    "src/fpa/index.ts",
    "src/node/index.ts",
    "src/protocol/index.ts",
    "src/rp/index.ts",
    "src/testing/index.ts",
  ],
  format: ["esm", "cjs"],
  // Same ES2022 output the tsup build took from the tsconfig target.
  target: "es2022",
  // The package files list excludes dist/**/*.map, so no map may be referenced.
  sourcemap: false,
  dts: { sourcemap: false },
  outDir: "dist",
  // Keep the .js (ESM) and .cjs output names that the exports map points to.
  fixedExtension: false,
  deps: {
    // Better Auth's DPoP client is inlined so consumers do not install a
    // prerelease @better-auth/core and its server peers. See
    // THIRD_PARTY_NOTICES.md for its license.
    alwaysBundle: [/^@better-auth\/core/],
    // Fail the build if any other dependency is inlined.
    onlyBundle: [/^@better-auth\/core/],
  },
});
