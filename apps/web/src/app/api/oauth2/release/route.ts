import { and, eq } from "drizzle-orm";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { NextResponse } from "next/server";

import { getAuthIssuer, joinAuthIssuerPath } from "@/lib/auth/issuer";
import {
  hashReleaseHandle,
  unsealApprovalPii,
} from "@/lib/auth/oidc/approval-crypto";
import { filterIdentityByScopes } from "@/lib/auth/oidc/identity-scopes";
import { signJwt } from "@/lib/auth/oidc/jwt-signer";
import { db } from "@/lib/db/connection";
import { approvals } from "@/lib/db/schema/approvals";
import { jwks as jwksTable } from "@/lib/db/schema/jwks";

const authIssuer = getAuthIssuer();
const jwksUrl = joinAuthIssuerPath(authIssuer, "pq-jwks");

/**
 * Build a local JWKS keyset from the DB for token verification.
 * Falls back to fetching from the JWKS URL if the kid isn't found locally.
 */
async function getLocalJwks(kid: string) {
  const rows = await db.select().from(jwksTable).all();
  const keys = rows.map((row) => {
    const pub = JSON.parse(row.publicKey) as Record<string, unknown>;
    return { ...pub, kid: row.id, ...(row.alg ? { alg: row.alg } : {}) };
  });

  const jwksObj = { keys };
  const matchesKid = keys.some((k) => k.kid === kid);

  if (!matchesKid) {
    const res = await fetch(jwksUrl, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      return createLocalJWKSet(
        (await res.json()) as { keys: Record<string, unknown>[] }
      );
    }
  }

  return createLocalJWKSet(jwksObj);
}

function extractBearerToken(headers: Headers): string | null {
  const authHeader = headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * POST /api/oauth2/release — Redeem a release handle for PII.
 *
 * The agent presents a CIBA access token containing a `release_handle`
 * claim. This endpoint:
 * 1. Verifies the access token JWT
 * 2. Looks up the approval record by the handle's SHA-256 hash
 * 3. Validates status (approved, not expired, not already redeemed)
 * 4. Decrypts PII using the handle as the AES-GCM key
 * 5. Mints a fresh id_token with the PII claims
 * 6. Marks the approval as redeemed (one-time use)
 */
export async function POST(request: Request): Promise<Response> {
  const token = extractBearerToken(request.headers);
  if (!token) {
    return NextResponse.json(
      { error: "missing_token", error_description: "Bearer token required" },
      { status: 401 }
    );
  }

  let payload: Record<string, unknown>;
  try {
    const header = decodeProtectedHeader(token);
    if (!header.kid) {
      throw new Error("Missing kid in JWT header");
    }
    const jwksKeySet = await getLocalJwks(header.kid);
    const { payload: verified } = await jwtVerify(token, jwksKeySet, {
      issuer: authIssuer,
    });
    payload = verified as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      {
        error: "invalid_token",
        error_description: "Access token invalid or expired",
      },
      { status: 401 }
    );
  }

  const releaseHandle = payload.release_handle;
  if (typeof releaseHandle !== "string") {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: "Token has no release_handle claim",
      },
      { status: 400 }
    );
  }

  const sub = payload.sub as string | undefined;
  const clientId =
    (payload.client_id as string | undefined) ??
    (payload.azp as string | undefined);

  if (!(sub && clientId)) {
    return NextResponse.json(
      {
        error: "invalid_token",
        error_description: "Token missing sub or client_id",
      },
      { status: 400 }
    );
  }

  const handleHash = hashReleaseHandle(releaseHandle);

  const approval = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.releaseHandleHash, handleHash),
        eq(approvals.userId, sub),
        eq(approvals.clientId, clientId)
      )
    )
    .get();

  if (!approval) {
    return NextResponse.json(
      {
        error: "invalid_grant",
        error_description: "No approval found for this release handle",
      },
      { status: 404 }
    );
  }

  if (approval.status === "redeemed") {
    return NextResponse.json(
      {
        error: "invalid_grant",
        error_description: "Release handle already redeemed",
      },
      { status: 410 }
    );
  }

  if (approval.expiresAt < new Date()) {
    await db
      .update(approvals)
      .set({ status: "expired" })
      .where(eq(approvals.id, approval.id))
      .run();

    return NextResponse.json(
      { error: "invalid_grant", error_description: "Approval has expired" },
      { status: 410 }
    );
  }

  if (approval.status !== "approved") {
    return NextResponse.json(
      {
        error: "invalid_grant",
        error_description: `Unexpected approval status: ${approval.status}`,
      },
      { status: 400 }
    );
  }

  let piiJson: string;
  try {
    piiJson = await unsealApprovalPii(
      releaseHandle,
      approval.encryptedPii,
      approval.encryptionIv
    );
  } catch {
    return NextResponse.json(
      { error: "server_error", error_description: "Failed to decrypt PII" },
      { status: 500 }
    );
  }

  const pii = JSON.parse(piiJson) as Record<string, unknown>;
  const approvedScopes = approval.approvedScopes.split(" ");
  const filteredPii = filterIdentityByScopes(pii, approvedScopes);

  const now = Math.floor(Date.now() / 1000);
  const idTokenPayload: Record<string, unknown> = {
    iss: authIssuer,
    sub,
    aud: clientId,
    iat: now,
    exp: now + 300,
    ...filteredPii,
  };

  if (approval.authorizationDetails) {
    idTokenPayload.authorization_details = JSON.parse(
      approval.authorizationDetails
    );
  }

  const idToken = await signJwt(idTokenPayload);

  await db
    .update(approvals)
    .set({ status: "redeemed", redeemedAt: new Date() })
    .where(eq(approvals.id, approval.id))
    .run();

  return NextResponse.json({ id_token: idToken });
}
