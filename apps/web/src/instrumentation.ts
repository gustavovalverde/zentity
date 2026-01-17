export const runtime = "nodejs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTelemetry } = await import("@/lib/observability/telemetry");
    initTelemetry();

    // Preload Human.js models for faster first liveness request
    const { warmupHumanServer } = await import(
      "@/lib/identity/liveness/human-server"
    );
    await warmupHumanServer();

    // Preload ZK verification keys and CRS cache for faster first proof verification
    const { warmupCRS } = await import("@/lib/privacy/zk/noir-verifier");
    await warmupCRS();

    // Preload Barretenberg for server-side hashing (claim hashes, Merkle trees)
    const { warmupBarretenberg } = await import(
      "@/lib/privacy/crypto/barretenberg"
    );
    await warmupBarretenberg();

    // Check Noir/bb.js WASM assets presence
    const { logNoirWasmAssetStatus } = await import(
      "@/lib/privacy/zk/asset-integrity"
    );
    logNoirWasmAssetStatus();

    // Warn if Noir runtime version mismatches compiled artifacts
    const { checkNoirVersionDrift } = await import(
      "@/lib/privacy/zk/noir-version-check"
    );
    const versionCheck = checkNoirVersionDrift();
    if (!versionCheck.matchesRuntime) {
      const { logger } = await import("@/lib/logging/logger");
      logger.warn(
        {
          runtimeVersion: versionCheck.runtimeVersion,
          artifactVersions: versionCheck.artifactVersions,
        },
        "Noir runtime version does not match compiled circuit artifacts"
      );
    }

    // Check backend services health and establish connections
    const { warmupServices } = await import(
      "@/lib/observability/service-warmup"
    );
    await warmupServices();
  }
}
