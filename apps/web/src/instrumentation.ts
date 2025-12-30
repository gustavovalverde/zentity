export const runtime = "nodejs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTelemetry } = await import("@/lib/observability");
    initTelemetry();
  }
}
