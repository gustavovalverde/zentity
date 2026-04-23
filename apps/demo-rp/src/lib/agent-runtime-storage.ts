export type TrustTier = "anonymous" | "registered" | "attested";

export type PersistedTrustTier = Exclude<TrustTier, "anonymous">;

export function buildAgentRuntimePartitionKey(
  scenarioId: string,
  trustTier: PersistedTrustTier
): string {
  // Version the partition key so rows created before trust-tier isolation
  // cannot leak state into the new registered/attested runtimes.
  return `${scenarioId}::agent-runtime:v2:${trustTier}`;
}
