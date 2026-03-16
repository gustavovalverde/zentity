import { eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/connection";
import { account, session } from "@/lib/db/schema";
import { env } from "@/lib/env";

const BCL_EVENT_URI =
  "http://schemas.openid.net/event/backchannel-logout";

let jwksPromise: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwksPromise) {
    const jwksUrl =
      env.ZENTITY_JWKS_URL ??
      `${env.ZENTITY_URL}/.well-known/jwks.json`;
    jwksPromise = createRemoteJWKSet(new URL(jwksUrl));
  }
  return jwksPromise;
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
    const jwks = getJwks();
    const { payload } = await jwtVerify(logoutToken, jwks, {
      issuer: env.ZENTITY_URL,
    });

    // Validate BCL event claim (OIDC BCL §2.4)
    const events = payload.events as Record<string, unknown> | undefined;
    if (!events || !(BCL_EVENT_URI in events)) {
      return NextResponse.json(
        { error: "Missing backchannel-logout event" },
        { status: 400 }
      );
    }

    const sub = payload.sub;
    if (!sub) {
      return NextResponse.json(
        { error: "Missing sub claim" },
        { status: 400 }
      );
    }

    // Find the local user by their Zentity accountId (sub)
    const db = getDb();
    const userAccount = await db
      .select({ userId: account.userId })
      .from(account)
      .where(eq(account.accountId, sub))
      .limit(1)
      .get();

    if (userAccount) {
      // Delete all sessions for this user
      await db
        .delete(session)
        .where(eq(session.userId, userAccount.userId))
        .run();
    }

    return new Response(null, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Invalid logout token" },
      { status: 400 }
    );
  }
}
