import { defineConfig } from "tsup";

export default defineConfig((options) => ({
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
  dts: true,
  clean: !options.watch,
  outDir: "dist",
  // Better Auth's DPoP client is inlined so consumers do not install a
  // prerelease @better-auth/core and its server peers. See
  // THIRD_PARTY_NOTICES.md for its license.
  noExternal: [/^@better-auth\/core/],
}));
