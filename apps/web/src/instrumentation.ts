export const runtime = "nodejs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTelemetry } = await import("@/lib/observability");
    initTelemetry();

    // Preload Human.js models for faster first liveness request
    const { warmupHumanServer } = await import("@/lib/liveness/human-server");
    await warmupHumanServer();

    // Preload ZK verification keys and CRS cache for faster first proof verification
    const { warmupCRS } = await import("@/lib/zk/noir-verifier");
    await warmupCRS();
  }
}
