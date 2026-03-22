/**
 * Vite 8 no longer writes .vite/manifest.json to the client output.
 * The @vercel/react-router builder expects it. Create an empty one
 * so vercel build succeeds.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(__dirname, "../build/client/.vite/manifest.json");

if (!existsSync(resolve(__dirname, "../build/client/.vite"))) {
  mkdirSync(resolve(__dirname, "../build/client/.vite"), { recursive: true });
}

if (!existsSync(target)) {
  writeFileSync(target, "{}\n");
}
