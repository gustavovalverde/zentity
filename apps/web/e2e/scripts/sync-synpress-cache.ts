/**
 * Synpress cache sync script
 *
 * Works around the hash mismatch bug in synpress v4 (https://github.com/Synthetixio/synpress/issues/1103)
 * by ensuring the cache directory is named with the hash expected by tests.
 *
 * Usage: pnpm exec tsx e2e/scripts/sync-synpress-cache.ts
 */
import { existsSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

import hardhatSetup from "../wallet-setup/hardhat.setup";

const CACHE_DIR = ".cache-synpress";

// Get the hash that tests will look for
const expectedHash = hardhatSetup.hash;
console.log(`Expected cache hash: ${expectedHash}`);

const cacheDir = join(process.cwd(), CACHE_DIR);
const expectedPath = join(cacheDir, expectedHash);

// Check if expected cache already exists
if (existsSync(expectedPath)) {
  console.log(`Cache already exists at ${expectedPath}`);
  process.exit(0);
}

// Find any existing cache directories (excluding metamask extension files)
const entries = readdirSync(cacheDir).filter(
  (entry) =>
    !(
      entry.startsWith("metamask-chrome-") ||
      entry.endsWith(".zip") ||
      entry.startsWith(".")
    )
);

if (entries.length === 0) {
  console.error(
    "No cache directory found. Run 'pnpm exec synpress e2e/wallet-setup' first."
  );
  process.exit(1);
}

// Rename the first cache directory to expected hash
const firstEntry = entries[0];
if (!firstEntry) {
  console.error("No valid cache entry found.");
  process.exit(1);
}
const existingCache = join(cacheDir, firstEntry);
console.log(`Renaming ${existingCache} -> ${expectedPath}`);
renameSync(existingCache, expectedPath);
console.log("Cache synced successfully!");
