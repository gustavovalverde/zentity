import { and, eq, inArray } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/connection";
import { account, session } from "@/lib/db/schema";
import {
  findProviderByClientId,
  PROVIDER_IDS,
  readDcrClientId,
} from "@/lib/dcr";
import { env } from "@/lib/env";

const BCL_EVENT_URI = "http://schemas.openid.net/event/backchannel-logout";
const DEFAULT_LOGOUT_TOKEN_REPLAY_TTL_MS = 5 * 60 * 1000;
const OIDC_DISCOVERY_TTL_MS = 5 * 60 * 1000;

interface OidcDiscovery {
  issuer: string;
  jwks: ReturnType<typeof createRemoteJWKSet>;
}

let cached: {
  expiresAt: number;
  value: OidcDiscovery;
} | null = null;
const logoutTokenReplayExpiryByJti = new Map<string, number>();

function pruneExpiredLogoutTokenReplayEntries(now: number) {
  for (const [jti, expiresAt] of logoutTokenReplayExpiryByJti.entries()) {
    if (expiresAt <= now) {
      logoutTokenReplayExpiryByJti.delete(jti);
    }
  }
}

function resolveLogoutTokenReplayExpiry(payload: { exp?: unknown }): number {
  if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
    return payload.exp * 1000;
  }

  return Date.now() + DEFAULT_LOGOUT_TOKEN_REPLAY_TTL_MS;
}

async function getOidcConfig(): Promise<OidcDiscovery> {
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }
  const discoveryUrl = `${env.ZENTITY_URL}/.well-known/openid-configuration`;
  const res = await fetch(discoveryUrl);
  const meta = (await res.json()) as { issuer: string; jwks_uri: string };
  cached = {
    value: {
      issuer: meta.issuer,
      jwks: createRemoteJWKSet(new URL(meta.jwks_uri)),
    },
    expiresAt: Date.now() + OIDC_DISCOVERY_TTL_MS,
  };
  return cached.value;
}

async function getAllClientIds(): Promise<string[]> {
  const ids: string[] = [];
  for (const providerId of PROVIDER_IDS) {
    const clientId = await readDcrClientId(providerId);
    if (clientId) {
      ids.push(clientId);
    }
  }
  return ids;
}

/**
 * OIDC Back-Channel Logout endpoint.
 * Receives POST with application/x-www-form-urlencoded body containing logout_token JWT.
 * Verifies the JWT, extracts sub, and invalidates matching sessions.
 */
export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return new Response(null, { status: 415 });
  }

  const formData = await request.text();
  const params = new URLSearchParams(formData);
  const logoutToken = params.get("logout_token");

  if (!logoutToken) {
    return NextResponse.json(
      { error: "logout_token is required" },
      { status: 400 }
    );
  }

  try {
    const oidc = await getOidcConfig();
    const clientIds = await getAllClientIds();
    if (clientIds.length === 0) {
      return NextResponse.json(
        { error: "No registered clients — cannot validate logout token" },
        { status: 503 }
      );
    }
    const { payload } = await jwtVerify(logoutToken, oidc.jwks, {
      issuer: oidc.issuer,
      audience: clientIds,
    });

    // Validate BCL event claim (OIDC BCL §2.4)
    const events = payload.events as Record<string, unknown> | undefined;
    if (!(events && BCL_EVENT_URI in events)) {
      return NextResponse.json(
        { error: "Missing backchannel-logout event" },
        { status: 400 }
      );
    }

    if (typeof payload.nonce === "string" && payload.nonce) {
      return NextResponse.json(
        { error: "Logout token must not contain nonce" },
        { status: 400 }
      );
    }

    if (typeof payload.jti === "string" && payload.jti) {
      const now = Date.now();
      pruneExpiredLogoutTokenReplayEntries(now);

      const replayExpiry = logoutTokenReplayExpiryByJti.get(payload.jti);
      if (replayExpiry && replayExpiry > now) {
        return NextResponse.json(
          { error: "Logout token has already been used" },
          { status: 400 }
        );
      }

      logoutTokenReplayExpiryByJti.set(
        payload.jti,
        resolveLogoutTokenReplayExpiry(payload)
      );
    }

    const sub = payload.sub;
    if (!sub) {
      return NextResponse.json({ error: "Missing sub claim" }, { status: 400 });
    }

    const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    const provider = aud ? await findProviderByClientId(aud) : null;

    const db = getDb();
    const accountFilter = provider
      ? and(
          eq(account.accountId, sub),
          eq(account.providerId, `zentity-${provider}`)
        )
      : eq(account.accountId, sub);
    const matchingAccounts = await db
      .select({ userId: account.userId })
      .from(account)
      .where(accountFilter)
      .all();
    const userIds = [...new Set(matchingAccounts.map((row) => row.userId))];

    await db
      .update(account)
      .set({
        accessToken: null,
        refreshToken: null,
        idToken: null,
      })
      .where(accountFilter)
      .run();

    if (userIds.length > 0) {
      await db.delete(session).where(inArray(session.userId, userIds)).run();
    }

    return new Response(null, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Invalid logout token" },
      { status: 400 }
    );
  }
}
