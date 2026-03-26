import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/connection";
import { dcrClient } from "@/lib/db/schema";

const PROVIDER_IDS = [
  "bank",
  "exchange",
  "wine",
  "aid",
  "veripass",
  "aether",
  "x402",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isValidProviderId(id: string): id is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(id);
}

export async function readDcrClientId(
  providerId: ProviderId
): Promise<string | null> {
  try {
    const row = await getDb()
      .select({ clientId: dcrClient.clientId })
      .from(dcrClient)
      .where(eq(dcrClient.providerId, providerId))
      .limit(1)
      .get();
    return row?.clientId ?? null;
  } catch {
    return null;
  }
}

export async function readDcrClient(
  providerId: ProviderId
): Promise<{ clientId: string; clientSecret: string | null } | null> {
  try {
    const row = await getDb()
      .select({
        clientId: dcrClient.clientId,
        clientSecret: dcrClient.clientSecret,
      })
      .from(dcrClient)
      .where(eq(dcrClient.providerId, providerId))
      .limit(1)
      .get();
    return row ?? null;
  } catch {
    return null;
  }
}

export async function saveDcrClientId(
  providerId: ProviderId,
  clientId: string,
  clientSecret?: string
): Promise<void> {
  await getDb()
    .insert(dcrClient)
    .values({ providerId, clientId, clientSecret: clientSecret ?? null })
    .onConflictDoUpdate({
      target: dcrClient.providerId,
      set: { clientId, clientSecret: clientSecret ?? null },
    });
}

export async function currentClientIdKey(): Promise<string> {
  const parts = await Promise.all(
    PROVIDER_IDS.map(async (id) => {
      const clientId = await readDcrClientId(id);
      return `${id}:${clientId ?? ""}`;
    })
  );
  return parts.join("|");
}

export async function findProviderByClientId(
  clientId: string
): Promise<ProviderId | null> {
  const row = await getDb()
    .select({ providerId: dcrClient.providerId })
    .from(dcrClient)
    .where(eq(dcrClient.clientId, clientId))
    .limit(1)
    .get();
  return row?.providerId && isValidProviderId(row.providerId)
    ? row.providerId
    : null;
}

export { PROVIDER_IDS };
