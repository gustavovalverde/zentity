import type { TrustTier } from "@/data/aether";

export type PersistedTrustTier = Exclude<TrustTier, "anonymous">;

export function buildAgentRuntimePartitionKey(
  providerId: string,
  trustTier: PersistedTrustTier
): string {
  // Version the partition key so rows created before trust-tier isolation
  // cannot leak state into the new registered/attested runtimes.
  return `${providerId}::agent-runtime:v2:${trustTier}`;
}
