export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTelemetry } = await import("@/lib/observability/telemetry");
    await initTelemetry();

    const { markWarmupComplete } = await import(
      "@/lib/observability/warmup-state"
    );

    // Parallel group: Human.js models + Barretenberg + backend service checks
    // (warmupCRS depends on Barretenberg so it runs after BB completes)
    const [{ warmupHumanServer }, { warmupBarretenberg }, { warmupServices }] =
      await Promise.all([
        import("@/lib/identity/liveness/human-server"),
        import("@/lib/privacy/primitives/barretenberg"),
        import("@/lib/observability/service-warmup"),
      ]);

    const [, bbResult] = await Promise.allSettled([
      warmupHumanServer(),
      warmupBarretenberg(),
      warmupServices(),
    ]);

    // CRS + ZK checks depend on the shared Barretenberg instance
    if (bbResult.status === "fulfilled") {
      const { warmupCRS } = await import("@/lib/privacy/zk/noir-verifier");
      await warmupCRS();

      // ZKPassport verifier shares the Barretenberg WASM instance
      const { warmupZkPassportVerifier } = await import(
        "@/lib/privacy/zk/zkpassport-verifier"
      );
      await warmupZkPassportVerifier();
    }

    const { logNoirWasmAssetStatus } = await import(
      "@/lib/privacy/zk/asset-integrity"
    );
    logNoirWasmAssetStatus();

    const { checkNoirVersions } = await import(
      "@/lib/privacy/zk/version-check"
    );
    await checkNoirVersions();

    markWarmupComplete();
  }
}
