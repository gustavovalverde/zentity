import { eq } from "drizzle-orm";
import { createLocalJWKSet, jwtVerify } from "jose";
import { NextResponse } from "next/server";

import { reportRejection } from "@/lib/async-handler";
import {
  revokePendingCibaOnLogout,
  sendBackchannelLogout,
} from "@/lib/auth/oidc/backchannel-logout";
import { resolveUserIdFromSubForClient } from "@/lib/auth/oidc/pairwise";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { sessions } from "@/lib/db/schema/auth";
import { jwks, oauthClients } from "@/lib/db/schema/oauth-provider";

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
 * post_logout_redirect_uri if registered for the client.
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
  let sid: string | undefined;
  let tokenAzp: string | undefined;
  let tokenAudiences: string[] = [];
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
    if (typeof payload.sid === "string") {
      sid = payload.sid;
    }
    if (typeof payload.azp === "string") {
      tokenAzp = payload.azp;
    }
    if (typeof payload.aud === "string") {
      tokenAudiences = [payload.aud];
    } else if (Array.isArray(payload.aud)) {
      tokenAudiences = payload.aud.filter(
        (value): value is string => typeof value === "string"
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid id_token_hint" },
      { status: 400 }
    );
  }

  // The id_token MUST identify the RP it was issued for. Resolve a single
  // client either from azp, a single-element aud, or an explicit client_id
  // query parameter that is also present in aud. Tokens without a resolvable
  // client cannot be safely used to terminate sessions or to fire BCL.
  let effectiveClientId: string | null = null;
  if (clientId) {
    if (tokenAzp && tokenAzp !== clientId) {
      return NextResponse.json(
        { error: "client_id does not match id_token_hint" },
        { status: 400 }
      );
    }
    if (tokenAudiences.length > 0 && !tokenAudiences.includes(clientId)) {
      return NextResponse.json(
        { error: "client_id is not in id_token_hint aud" },
        { status: 400 }
      );
    }
    effectiveClientId = clientId;
  } else if (tokenAzp) {
    effectiveClientId = tokenAzp;
  } else if (tokenAudiences.length === 1) {
    effectiveClientId = tokenAudiences[0] ?? null;
  } else if (tokenAudiences.length > 1) {
    return NextResponse.json(
      {
        error:
          "id_token_hint with multiple audiences requires an explicit client_id",
      },
      { status: 400 }
    );
  }

  if (!effectiveClientId) {
    return NextResponse.json(
      { error: "id_token_hint must identify a client" },
      { status: 400 }
    );
  }

  const client = await db
    .select({
      subjectType: oauthClients.subjectType,
      redirectUris: oauthClients.redirectUris,
      postLogoutRedirectUris: oauthClients.postLogoutRedirectUris,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, effectiveClientId))
    .limit(1)
    .get();

  if (!client) {
    // When a redirect was supplied, return the same error shape as a
    // legitimate redirect mismatch so we do not disclose whether the
    // client_id exists.
    if (postLogoutRedirectUri) {
      return NextResponse.json(
        { error: "post_logout_redirect_uri not registered" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "id_token_hint references an unknown client" },
      { status: 400 }
    );
  }

  // Strict redirect URI validation (OIDC RP-Initiated Logout 1.0 §2):
  // post_logout_redirect_uri MUST be validated against registered values.
  // Reject when the client has no registered URIs or is unknown.
  if (postLogoutRedirectUri) {
    if (!client?.postLogoutRedirectUris) {
      return NextResponse.json(
        { error: "post_logout_redirect_uri not registered" },
        { status: 400 }
      );
    }
    const registeredUris = parseStoredStringArray(
      client.postLogoutRedirectUris
    );
    if (!registeredUris.includes(postLogoutRedirectUri)) {
      return NextResponse.json(
        { error: "post_logout_redirect_uri not registered" },
        { status: 400 }
      );
    }
  }

  // Resolve pairwise sub → raw userId for session/BCL/CIBA operations
  const userId = await resolveUserIdFromSubForClient(sub, {
    subjectType: client.subjectType,
    redirectUris: parseStoredStringArray(client.redirectUris),
  });

  if (!userId) {
    return NextResponse.json(
      { error: "Unable to resolve user from id_token_hint" },
      { status: 400 }
    );
  }

  // Terminate all sessions for this user
  await db.delete(sessions).where(eq(sessions.userId, userId)).run();

  // Fire-and-forget: BCL delivery + CIBA revocation
  sendBackchannelLogout(userId, sid).catch(reportRejection);
  revokePendingCibaOnLogout(userId).catch(reportRejection);

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
