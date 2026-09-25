import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { bootstrapDevServer } from "./dev-server";

const webRoot = process.cwd();
const shouldResetDb =
  process.env.E2E_RESET_DB === "true" || process.env.E2E_OIDC_ONLY === "true";
const fallbackDbPath = path.join(webRoot, "e2e", ".data", "e2e.db");

function resetNextArtifacts() {
  const nextDir = path.join(webRoot, ".next");
  if (existsSync(nextDir)) {
    rmSync(nextDir, { recursive: true, force: true });
  }
}

bootstrapDevServer({
  env: {
    ...process.env,
    NEXT_PUBLIC_ENABLE_HARDHAT: "false",
    NEXT_PUBLIC_ENABLE_CONFIDENTIAL_CHAIN: "false",
    NEXT_PUBLIC_APPKIT_ENABLE_WALLETCONNECT: "false",
    NEXT_PUBLIC_APPKIT_ENABLE_INJECTED: "false",
    NEXT_PUBLIC_APPKIT_ENABLE_EIP6963: "false",
    NEXT_PUBLIC_APPKIT_ANALYTICS: "false",
    NEXT_PUBLIC_COOP: "same-origin-allow-popups",
    TURBOPACK: "",
    NEXT_DISABLE_TURBOPACK: "1",
  },
  resetDb: shouldResetDb,
  dbResetFallback: fallbackDbPath,
  beforeSpawn: resetNextArtifacts,
});
