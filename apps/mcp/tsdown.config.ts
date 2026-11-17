import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node24",
  sourcemap: false,
  outDir: "dist",
  // The bin and start scripts point at dist/index.js, not dist/index.mjs.
  fixedExtension: false,
});
