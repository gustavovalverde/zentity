import { eq } from "drizzle-orm";
import { createLocalJWKSet, jwtVerify } from "jose";
import { NextResponse } from "next/server";

import { getAuthIssuer } from "@/lib/auth/issuer";
import {
  revokePendingCibaOnLogout,
  sendBackchannelLogout,
} from "@/lib/auth/oidc/backchannel-logout";
import { db } from "@/lib/db/connection";
import { sessions } from "@/lib/db/schema/auth";
import { jwks } from "@/lib/db/schema/jwks";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

const authIssuer = getAuthIssuer();

async function getLocalJwks() {
  const rows = await db.select().from(jwks).all();
  const keys = rows.map((row) => {
    const pub = JSON.parse(row.publicKey) as Record<string, unknown>;
    return { ...pub, kid: row.id, ...(row.alg ? { alg: row.alg } : {}) };
  });
  return createLocalJWKSet({ keys });
}

/**
 * OIDC RP-Initiated Logout 1.0.
 *
 * GET /api/auth/oauth2/end-session?id_token_hint=...&post_logout_redirect_uri=...&client_id=...&state=...
 *
 * Validates the id_token_hint, terminates the user's sessions,
 * triggers BCL delivery to all registered RPs, and redirects to
 * post_logout_redirect_uri if valid.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const idTokenHint = url.searchParams.get("id_token_hint");
  const postLogoutRedirectUri = url.searchParams.get(
    "post_logout_redirect_uri"
  );
  const clientId = url.searchParams.get("client_id");
  const state = url.searchParams.get("state");

  if (!idTokenHint) {
    return NextResponse.json(
      { error: "id_token_hint is required" },
      { status: 400 }
    );
  }

  // Verify the id_token_hint JWT
  let sub: string;
  try {
    const jwksResolver = await getLocalJwks();
    const { payload } = await jwtVerify(idTokenHint, jwksResolver, {
      issuer: authIssuer,
    });
    if (typeof payload.sub !== "string") {
      return NextResponse.json(
        { error: "id_token_hint has no sub claim" },
        { status: 400 }
      );
    }
    sub = payload.sub;
  } catch {
    return NextResponse.json(
      { error: "Invalid id_token_hint" },
      { status: 400 }
    );
  }

  // Validate post_logout_redirect_uri against client's registered URIs
  if (postLogoutRedirectUri && clientId) {
    const client = await db
      .select({ postLogoutRedirectUris: oauthClients.postLogoutRedirectUris })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
      .limit(1)
      .get();

    if (client?.postLogoutRedirectUris) {
      const registeredUris: string[] = JSON.parse(
        client.postLogoutRedirectUris
      );
      if (!registeredUris.includes(postLogoutRedirectUri)) {
        return NextResponse.json(
          { error: "post_logout_redirect_uri not registered" },
          { status: 400 }
        );
      }
    }
  }

  // Terminate all sessions for this user
  const userSessions = await db
    .select({ token: sessions.token })
    .from(sessions)
    .where(eq(sessions.userId, sub))
    .all();

  for (const s of userSessions) {
    await db.delete(sessions).where(eq(sessions.token, s.token)).run();
  }

  // Fire-and-forget: BCL delivery + CIBA revocation
  sendBackchannelLogout(sub);
  revokePendingCibaOnLogout(sub);

  // Redirect or return success
  if (postLogoutRedirectUri) {
    const redirectUrl = new URL(postLogoutRedirectUri);
    if (state) {
      redirectUrl.searchParams.set("state", state);
    }
    return NextResponse.redirect(redirectUrl.toString(), 302);
  }

  return NextResponse.json({ success: true });
}
