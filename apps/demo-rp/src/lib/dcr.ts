import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/connection";
import { dcrClient } from "@/lib/db/schema";

const PROVIDER_IDS = ["bank", "exchange", "wine", "aid", "veripass"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isValidProviderId(id: string): id is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(id);
}

export async function readDcrClientId(
  providerId: ProviderId
): Promise<string | null> {
  try {
    const row = await getDb().query.dcrClient.findFirst({
      where: eq(dcrClient.providerId, providerId),
      columns: { clientId: true },
    });
    return row?.clientId ?? null;
  } catch {
    return null;
  }
}

export async function saveDcrClientId(
  providerId: ProviderId,
  clientId: string
): Promise<void> {
  await getDb()
    .insert(dcrClient)
    .values({ providerId, clientId })
    .onConflictDoUpdate({
      target: dcrClient.providerId,
      set: { clientId },
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

export { PROVIDER_IDS };
