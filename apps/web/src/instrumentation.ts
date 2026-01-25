export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTelemetry } = await import("@/lib/observability/telemetry");
    initTelemetry();

    // Preload Human.js models for faster first liveness request
    const { warmupHumanServer } = await import(
      "@/lib/identity/liveness/human-server"
    );
    await warmupHumanServer();

    // Preload shared Barretenberg instance for server-side crypto (ZK verification, hashing)
    const { warmupBarretenberg } = await import(
      "@/lib/privacy/primitives/barretenberg"
    );
    await warmupBarretenberg();

    // Preload ZK verification keys and CRS cache (uses shared BB instance)
    const { warmupCRS } = await import("@/lib/privacy/zk/noir-verifier");
    await warmupCRS();

    // Check Noir/bb.js WASM assets presence
    const { logNoirWasmAssetStatus } = await import(
      "@/lib/privacy/zk/asset-integrity"
    );
    logNoirWasmAssetStatus();

    // Warn if Noir runtime version mismatches compiled artifacts
    const { checkNoirVersions } = await import(
      "@/lib/privacy/zk/version-check"
    );
    await checkNoirVersions();

    // Check backend services health and establish connections
    const { warmupServices } = await import(
      "@/lib/observability/service-warmup"
    );
    await warmupServices();
  }
}
