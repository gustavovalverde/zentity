import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { logError, logWarn } from "@/lib/logging/error-logger";

import { getAuthIssuer } from "../issuer";
import { signJwt } from "./jwt-signer";

interface BclClient {
  backchannelLogoutSessionRequired: boolean;
  backchannelLogoutUri: string;
  clientId: string;
}

/**
 * Find all OAuth clients that have registered a backchannel_logout_uri.
 */
async function getBclClients(): Promise<BclClient[]> {
  const clients = await db
    .select({
      clientId: oauthClients.clientId,
      metadata: oauthClients.metadata,
    })
    .from(oauthClients)
    .where(isNotNull(oauthClients.metadata))
    .all();

  const result: BclClient[] = [];
  for (const c of clients) {
    if (!c.metadata) {
      continue;
    }
    try {
      const meta = JSON.parse(c.metadata) as Record<string, unknown>;
      const uri = meta.backchannel_logout_uri;
      if (typeof uri === "string" && uri.length > 0) {
        result.push({
          clientId: c.clientId,
          backchannelLogoutUri: uri,
          backchannelLogoutSessionRequired:
            meta.backchannel_logout_session_required === true,
        });
      }
    } catch {
      // Ignore invalid metadata JSON
    }
  }
  return result;
}

/**
 * Build a logout token JWT per OIDC Back-Channel Logout 1.0 §2.4.
 */
async function buildLogoutToken(
  sub: string,
  clientId: string,
  sessionId?: string,
  sessionRequired?: boolean
): Promise<string> {
  const issuer = getAuthIssuer();
  const now = Math.floor(Date.now() / 1000);

  const payload: Record<string, unknown> = {
    iss: issuer,
    sub,
    aud: clientId,
    iat: now,
    jti: randomUUID(),
    events: {
      "http://schemas.openid.net/event/backchannel-logout": {},
    },
  };

  if (sessionRequired && sessionId) {
    payload.sid = sessionId;
  }

  return await signJwt(payload);
}

const RETRY_DELAYS = [1000, 3000]; // 1s, 3s exponential backoff

/**
 * POST a logout_token to an RP's backchannel_logout_uri.
 * Retries on 5xx with exponential backoff. Fire-and-forget — never blocks.
 */
async function deliverLogoutToken(
  uri: string,
  logoutToken: string,
  clientId: string
): Promise<void> {
  const body = new URLSearchParams({ logout_token: logoutToken });

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const response = await fetch(uri, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        return;
      }

      if (response.status >= 500 && attempt < RETRY_DELAYS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }

      logWarn(`BCL delivery to ${clientId} failed: HTTP ${response.status}`, {
        clientId,
        status: response.status,
      });
      return;
    } catch (err) {
      if (attempt < RETRY_DELAYS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      logError(err instanceof Error ? err : new Error(String(err)), {
        operation: `bcl-delivery:${clientId}`,
      });
    }
  }
}

/**
 * Send backchannel logout tokens to all registered RPs for a user.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function sendBackchannelLogout(
  userId: string,
  sessionId?: string
): Promise<void> {
  try {
    const clients = await getBclClients();
    if (clients.length === 0) {
      return;
    }

    const deliveries = clients.map(async (client) => {
      const token = await buildLogoutToken(
        userId,
        client.clientId,
        sessionId,
        client.backchannelLogoutSessionRequired
      );
      await deliverLogoutToken(
        client.backchannelLogoutUri,
        token,
        client.clientId
      );
    });

    await Promise.allSettled(deliveries);
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)), {
      userId,
      operation: "bcl-notification",
    });
  }
}

/**
 * Reject pending CIBA requests for a user on logout.
 */
export async function revokePendingCibaOnLogout(userId: string): Promise<void> {
  try {
    await db
      .update(cibaRequests)
      .set({ status: "rejected" })
      .where(
        and(eq(cibaRequests.userId, userId), eq(cibaRequests.status, "pending"))
      )
      .run();
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)), {
      userId,
      operation: "bcl-notification",
    });
  }
}
