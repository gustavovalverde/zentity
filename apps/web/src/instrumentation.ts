export const runtime = "nodejs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTelemetry } = await import("@/lib/observability/telemetry");
    initTelemetry();

    // Preload Human.js models for faster first liveness request
    const { warmupHumanServer } = await import("@/lib/liveness/human-server");
    await warmupHumanServer();

    // Preload ZK verification keys and CRS cache for faster first proof verification
    const { warmupCRS } = await import("@/lib/zk/noir-verifier");
    await warmupCRS();

    // Preload Barretenberg for server-side hashing (claim hashes, Merkle trees)
    const { warmupBarretenberg } = await import("@/lib/crypto/barretenberg");
    await warmupBarretenberg();

    // Check backend services health and establish connections
    const { warmupServices } = await import(
      "@/lib/observability/service-warmup"
    );
    await warmupServices();
  }
}
