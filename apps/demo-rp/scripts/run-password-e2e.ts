import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function main() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const demoRpRoot = join(currentDir, "..");
  const webRoot = join(demoRpRoot, "..", "web");
  const requireFromWeb = createRequire(join(webRoot, "package.json"));
  const opaqueModuleUrl = pathToFileURL(
    requireFromWeb.resolve("@serenity-kit/opaque")
  ).href;
  const { ready, server: opaqueServer } = await import(opaqueModuleUrl);

  await ready;

  const env = {
    ...process.env,
    E2E_EXTERNAL_ZPAY_SERVER: "true",
    OPAQUE_SERVER_SETUP:
      process.env.OPAQUE_SERVER_SETUP ?? opaqueServer.createSetup(),
    DEDUP_HMAC_SECRET:
      process.env.DEDUP_HMAC_SECRET ??
      "e2e-dedup-hmac-secret-at-least-32-chars",
    PAIRWISE_SECRET:
      process.env.PAIRWISE_SECRET ?? "e2e-pairwise-secret-at-least-32-chars",
    CLAIM_SIGNING_SECRET:
      process.env.CLAIM_SIGNING_SECRET ??
      "e2e-claim-signing-secret-at-least-32-chars",
    CIPHERTEXT_HMAC_SECRET:
      process.env.CIPHERTEXT_HMAC_SECRET ??
      "e2e-ciphertext-hmac-secret-at-least-32-chars",
  };

  const result = spawnSync(
    "pnpm",
    ["exec", "playwright", "test", "e2e/password-user-journey.spec.mts"],
    {
      cwd: demoRpRoot,
      env,
      stdio: "inherit",
    }
  );

  process.exit(result.status ?? 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
