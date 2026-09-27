import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/connection";
import { account, dcrClient } from "@/lib/db/schema";
import {
  getOAuthProviderId,
  isRouteScenarioId,
  type RouteScenarioId,
} from "@/scenarios/route-scenario-registry";

export async function readDcrClientId(
  scenarioId: RouteScenarioId
): Promise<string | null> {
  try {
    const row = await getDb()
      .select({ clientId: dcrClient.clientId })
      .from(dcrClient)
      .where(eq(dcrClient.scenarioId, scenarioId))
      .limit(1)
      .get();
    return row?.clientId ?? null;
  } catch {
    return null;
  }
}

export async function readDcrClient(
  scenarioId: RouteScenarioId
): Promise<{ clientId: string; clientSecret: string | null } | null> {
  try {
    const row = await getDb()
      .select({
        clientId: dcrClient.clientId,
        clientSecret: dcrClient.clientSecret,
      })
      .from(dcrClient)
      .where(eq(dcrClient.scenarioId, scenarioId))
      .limit(1)
      .get();
    return row ?? null;
  } catch {
    return null;
  }
}

export async function saveDcrClientId(
  scenarioId: RouteScenarioId,
  clientId: string,
  clientSecret?: string
): Promise<void> {
  await getDb()
    .insert(dcrClient)
    .values({
      scenarioId,
      clientId,
      clientSecret: clientSecret ?? null,
    })
    .onConflictDoUpdate({
      target: dcrClient.scenarioId,
      set: { clientId, clientSecret: clientSecret ?? null },
    });
}

export async function findRouteScenarioByClientId(
  clientId: string
): Promise<RouteScenarioId | null> {
  const row = await getDb()
    .select({ scenarioId: dcrClient.scenarioId })
    .from(dcrClient)
    .where(eq(dcrClient.clientId, clientId))
    .limit(1)
    .get();
  return row?.scenarioId && isRouteScenarioId(row.scenarioId)
    ? row.scenarioId
    : null;
}

/**
 * The subject identifier Zentity issued to this scenario's client for the
 * signed-in demo user, which is the only login hint Zentity accepts from it.
 */
export async function readZentitySubject(
  scenarioId: RouteScenarioId,
  userId: string
): Promise<string | null> {
  const row = await getDb()
    .select({ accountId: account.accountId })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, getOAuthProviderId(scenarioId))
      )
    )
    .limit(1)
    .get();
  return row?.accountId ?? null;
}
