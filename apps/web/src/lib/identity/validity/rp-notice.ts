import "server-only";

import type { IdentityValidityEvent } from "@/lib/db/schema/identity";

import { and, eq, inArray } from "drizzle-orm";

import { signJwt } from "@/lib/auth/oidc/jwt-signer";
import {
  resolveSubForClient,
  resolveUserIdFromSub,
} from "@/lib/auth/oidc/pairwise";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import {
  getIdentityValiditySnapshot,
  getLatestIdentityValidityEvent,
} from "@/lib/db/queries/identity-validity";
import {
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
} from "@/lib/db/schema/oauth-provider";

const RP_VALIDITY_EVENT_URI = "https://zentity.xyz/events/validity-change";
const RP_NOTICE_EXPIRY_SECONDS = 5 * 60;
const RP_NOTICE_JWT_TYP = "secevent+jwt";

interface RpValidityNoticeClient {
  clientId: string;
  redirectUris: string[];
  rpValidityNoticeUri: string;
  subjectType: string | null;
}

function parseClientMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  try {
    return JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function listAuthorizedClientIds(userId: string): Promise<string[]> {
  const [consents, accessTokens, refreshTokens] = await Promise.all([
    db
      .select({ clientId: oauthConsents.clientId })
      .from(oauthConsents)
      .where(eq(oauthConsents.userId, userId))
      .all(),
    db
      .select({ clientId: oauthAccessTokens.clientId })
      .from(oauthAccessTokens)
      .where(eq(oauthAccessTokens.userId, userId))
      .all(),
    db
      .select({ clientId: oauthRefreshTokens.clientId })
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.userId, userId))
      .all(),
  ]);
  return [
    ...new Set(
      [...consents, ...accessTokens, ...refreshTokens].map(
        (row) => row.clientId
      )
    ),
  ];
}

/**
 * Clients that asked for validity notices and that this user authorized
 * through a consent or a token grant. Other registered clients never learn
 * about the user.
 */
export async function listRpValidityNoticeClients(
  userId: string
): Promise<RpValidityNoticeClient[]> {
  const authorizedClientIds = await listAuthorizedClientIds(userId);
  if (authorizedClientIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      clientId: oauthClients.clientId,
      metadata: oauthClients.metadata,
      redirectUris: oauthClients.redirectUris,
      rpValidityNoticeEnabled: oauthClients.rpValidityNoticeEnabled,
      rpValidityNoticeUri: oauthClients.rpValidityNoticeUri,
      subjectType: oauthClients.subjectType,
    })
    .from(oauthClients)
    .where(
      and(
        eq(oauthClients.disabled, false),
        inArray(oauthClients.clientId, authorizedClientIds)
      )
    )
    .all();

  return rows.flatMap((row) => {
    const metadata = parseClientMetadata(row.metadata);
    const enabled =
      row.rpValidityNoticeEnabled ||
      metadata.rp_validity_notice_enabled === true ||
      metadata.rpValidityNoticeEnabled === true;
    const uri =
      nonEmptyString(row.rpValidityNoticeUri) ??
      nonEmptyString(metadata.rp_validity_notice_uri) ??
      nonEmptyString(metadata.rpValidityNoticeUri);
    return enabled && uri
      ? [
          {
            clientId: row.clientId,
            redirectUris: parseStoredStringArray(row.redirectUris),
            rpValidityNoticeUri: uri,
            subjectType: row.subjectType,
          },
        ]
      : [];
  });
}

async function buildRpValidityNoticeJwt(args: {
  clientId: string;
  deliveryId: string;
  event: IdentityValidityEvent;
  userId: string;
}): Promise<string> {
  const clients = await listRpValidityNoticeClients(args.userId);
  const client = clients.find(
    (candidate) => candidate.clientId === args.clientId
  );

  if (!client) {
    throw new Error(
      `RP validity notice client ${args.clientId} is not registered`
    );
  }

  const sub = await resolveSubForClient(args.userId, {
    subjectType: client.subjectType,
    redirectUris: client.redirectUris,
  });
  const issuer = getAuthIssuer();
  const now = Math.floor(Date.now() / 1000);

  return await signJwt(
    {
      iss: issuer,
      aud: args.clientId,
      sub,
      iat: now,
      exp: now + RP_NOTICE_EXPIRY_SECONDS,
      jti: args.deliveryId,
      events: {
        [RP_VALIDITY_EVENT_URI]: {
          eventId: args.event.id,
          eventKind: args.event.eventKind,
          validityStatus: args.event.validityStatus,
          occurredAt: args.event.createdAt,
          ...(args.event.reason ? { reason: args.event.reason } : {}),
        },
      },
    },
    { typ: RP_NOTICE_JWT_TYP }
  );
}

export async function postRpValidityNotice(args: {
  clientId: string;
  deliveryId: string;
  event: IdentityValidityEvent;
  userId: string;
}): Promise<void> {
  const clients = await listRpValidityNoticeClients(args.userId);
  const client = clients.find(
    (candidate) => candidate.clientId === args.clientId
  );

  if (!client) {
    return;
  }

  const token = await buildRpValidityNoticeJwt(args);
  const response = await fetch(client.rpValidityNoticeUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/jwt",
    },
    body: token,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `RP validity notice delivery to ${args.clientId} failed with HTTP ${response.status}`
    );
  }
}

export async function getRpValidityState(args: {
  clientId: string;
  sub: string;
}): Promise<{
  eventId: string | null;
  eventKind: IdentityValidityEvent["eventKind"] | null;
  occurredAt: string | null;
  reason: string | null;
  validityStatus: IdentityValidityEvent["validityStatus"];
}> {
  const userId = await resolveUserIdFromSub(args.sub, args.clientId);
  if (!userId) {
    throw new Error("Unknown subject for RP validity snapshot");
  }

  const [snapshot, latestEvent] = await Promise.all([
    getIdentityValiditySnapshot(userId),
    getLatestIdentityValidityEvent(userId),
  ]);

  return {
    eventId: latestEvent?.id ?? null,
    eventKind: latestEvent?.eventKind ?? null,
    occurredAt: latestEvent?.createdAt ?? null,
    reason: latestEvent?.reason ?? null,
    validityStatus: snapshot?.validityStatus ?? "pending",
  };
}
