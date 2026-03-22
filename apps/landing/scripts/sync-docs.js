/**
 * Copies doc content from monorepo docs/ into content/docs/ for builds.
 * In dev, symlinks work; in CI/Vercel, this script copies the real files.
 */
import { cpSync, existsSync, mkdirSync, rmSync, lstatSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const docsRoot = resolve(root, "../../docs");
const target = resolve(root, "content/docs");

const groups = ["(concepts)", "(architecture)", "(protocols)", "(specs)"];

// Clean target (remove symlinks or stale copies)
if (existsSync(target)) {
  rmSync(target, { recursive: true });
}
mkdirSync(target, { recursive: true });

// Copy meta.json
const rootMeta = resolve(docsRoot, "meta.json");
if (existsSync(rootMeta)) {
  cpSync(rootMeta, resolve(target, "meta.json"));
}

// Copy each folder group
for (const group of groups) {
  const src = resolve(docsRoot, group);
  if (existsSync(src)) {
    cpSync(src, resolve(target, group), { recursive: true });
  }
}

console.log(`[sync-docs] Copied ${groups.length} groups to content/docs/`);
