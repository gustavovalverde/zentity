import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : dirname(fileURLToPath(import.meta.url));
const webRoot = join(currentDir, "..", "..", "web");

export default function globalSetup() {
  process.env.E2E_IDENTITY_SEED_VARIANT ??= "verified_with_profile";

  const result = spawnSync("pnpm", ["exec", "tsx", "e2e/run-global-setup.ts"], {
    cwd: webRoot,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(
      `web global setup failed with exit code ${result.status ?? "unknown"}`
    );
  }
}
