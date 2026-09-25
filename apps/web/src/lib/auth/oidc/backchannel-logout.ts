import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, isNotNull } from "drizzle-orm";

import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { logError } from "@/lib/logging/error-logger";

import { signJwt } from "./jwt-signer";
import { resolveSubForClient } from "./pairwise";
import { getAuthIssuer } from "./well-known";

interface BclClient {
  backchannelLogoutSessionRequired: boolean;
  backchannelLogoutUri: string;
  clientId: string;
  redirectUris: string[];
  subjectType: string | null;
}

/**
 * Find all OAuth clients that have registered a backchannel_logout_uri.
 */
export async function listBackchannelLogoutClients(): Promise<BclClient[]> {
  const clients = await db
    .select({
      clientId: oauthClients.clientId,
      backchannelLogoutUri: oauthClients.backchannelLogoutUri,
      backchannelLogoutSessionRequired:
        oauthClients.backchannelLogoutSessionRequired,
      redirectUris: oauthClients.redirectUris,
      subjectType: oauthClients.subjectType,
    })
    .from(oauthClients)
    .where(
      and(
        isNotNull(oauthClients.backchannelLogoutUri),
        eq(oauthClients.disabled, false)
      )
    )
    .all();

  return clients.flatMap((client) =>
    client.backchannelLogoutUri
      ? [
          {
            clientId: client.clientId,
            backchannelLogoutUri: client.backchannelLogoutUri,
            backchannelLogoutSessionRequired:
              client.backchannelLogoutSessionRequired === true,
            redirectUris: parseStoredStringArray(client.redirectUris),
            subjectType: client.subjectType,
          },
        ]
      : []
  );
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
async function postLogoutToken(
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

      throw new Error(
        `Back-channel logout delivery to ${clientId} failed with HTTP ${response.status}`
      );
    } catch (err) {
      if (attempt < RETRY_DELAYS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}

export async function sendBackchannelLogoutToClient(args: {
  clientId: string;
  sessionId?: string;
  userId: string;
}): Promise<void> {
  const clients = await listBackchannelLogoutClients();
  const client = clients.find(
    (candidate) => candidate.clientId === args.clientId
  );

  if (!client) {
    return;
  }

  const resolvedSub = await resolveSubForClient(args.userId, {
    subjectType: client.subjectType,
    redirectUris: client.redirectUris,
  });
  const token = await buildLogoutToken(
    resolvedSub,
    client.clientId,
    args.sessionId,
    client.backchannelLogoutSessionRequired
  );

  await postLogoutToken(client.backchannelLogoutUri, token, client.clientId);
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
