import "server-only";

import { NextResponse } from "next/server";

import { env } from "@/env";
import { verifyAccessToken } from "@/lib/auth/jwt";
import {
  loadOpaqueAccessToken,
  validateOpaqueAccessTokenDpop,
} from "@/lib/auth/oidc/haip/opaque-access-token";
import { signJwt } from "@/lib/auth/oidc/jwt-signer";
import { getUnifiedVerificationModel } from "@/lib/identity/verification/unified-model";

const AUTH_HEADER_RE = /^(DPoP|Bearer)\s+(.+)$/i;
const TRAILING_SLASHES = /\/+$/;

interface TokenPrincipal {
  clientId: string;
  dpopJkt: string | null;
  scopes: string[];
  sub: string;
  userId: string;
}

async function resolveJwtToken(
  token: string,
  request: Request,
  scheme: string
): Promise<TokenPrincipal | null> {
  const payload = await verifyAccessToken(token);
  if (!payload?.sub) {
    return null;
  }

  const clientId =
    (payload.client_id as string | undefined) ??
    (payload.azp as string | undefined);
  if (!clientId) {
    return null;
  }

  const { resolveUserIdFromSub } = await import("@/lib/auth/oidc/pairwise");
  const userId = await resolveUserIdFromSub(payload.sub, clientId);
  if (!userId) {
    return null;
  }

  const cnf = payload.cnf as { jkt?: string } | undefined;

  if (cnf?.jkt) {
    if (scheme.toLowerCase() !== "dpop") {
      return null;
    }

    const valid = await validateOpaqueAccessTokenDpop(request, cnf.jkt);
    if (!valid) {
      return null;
    }
  }

  return {
    sub: payload.sub,
    userId,
    clientId,
    scopes:
      typeof payload.scope === "string"
        ? payload.scope.split(" ").filter(Boolean)
        : [],
    dpopJkt: cnf?.jkt ?? null,
  };
}

async function resolveOpaqueToken(
  token: string,
  request: Request,
  scheme: string
): Promise<TokenPrincipal | null> {
  const { resolveSubForClient } = await import("@/lib/auth/oidc/pairwise");

  const row = await loadOpaqueAccessToken(token);
  if (!(row?.userId && row.clientId)) {
    return null;
  }

  if (row.expiresAt.getTime() < Date.now()) {
    return null;
  }

  // Enforce DPoP proof-of-possession for DPoP-bound tokens
  if (row.dpopJkt) {
    if (scheme.toLowerCase() !== "dpop") {
      return null;
    }
    const valid = await validateOpaqueAccessTokenDpop(request, row.dpopJkt);
    if (!valid) {
      return null;
    }
  }

  const { parseStoredStringArray } = await import("@/lib/db/adapter-compat");
  const { oauthClients } = await import("@/lib/db/schema/oauth-provider");
  const { db } = await import("@/lib/db/connection");
  const { eq } = await import("drizzle-orm");

  const client = await db
    .select({
      subjectType: oauthClients.subjectType,
      redirectUris: oauthClients.redirectUris,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, row.clientId))
    .limit(1)
    .get();

  if (!client) {
    return null;
  }

  const redirectUris = parseStoredStringArray(client.redirectUris);

  const sub = await resolveSubForClient(row.userId, {
    subjectType: client.subjectType,
    redirectUris,
  });

  return {
    sub,
    userId: row.userId,
    clientId: row.clientId,
    scopes: row.scopes,
    dpopJkt: row.dpopJkt ?? null,
  };
}

async function resolveToken(request: Request): Promise<TokenPrincipal | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(AUTH_HEADER_RE);
  if (!(match?.[1] && match[2])) {
    return null;
  }

  const scheme = match[1];
  const token = match[2];

  if (token.startsWith("eyJ")) {
    return await resolveJwtToken(token, request, scheme);
  }

  return await resolveOpaqueToken(token, request, scheme);
}

/**
 * POST /api/auth/oauth2/proof-of-human
 *
 * Issues a compact, DPoP-bound Proof-of-Human JWT.
 * Requires an access token with the `poh` scope.
 *
 * The PoH token asserts the user's verification tier without PII:
 * - `poh.tier` — numeric assurance level (1–4)
 * - `poh.verified` — whether the user meets full compliance
 * - `poh.sybil_resistant` — whether a uniqueness check passed
 * - `poh.method` — verification method ("ocr" | "nfc_chip" | null)
 */
export async function POST(request: Request) {
  const principal = await resolveToken(request);

  if (!principal) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  if (!principal.scopes.includes("poh")) {
    return NextResponse.json({ error: "insufficient_scope" }, { status: 403 });
  }

  const model = await getUnifiedVerificationModel(principal.userId);

  if (!model.verificationId) {
    return NextResponse.json({ error: "not_verified" }, { status: 403 });
  }

  // Use the access token's sub (already pairwise if client is configured for it)
  const sub = principal.sub;
  const now = Math.floor(Date.now() / 1000);
  const issuer = env.NEXT_PUBLIC_APP_URL.replace(TRAILING_SLASHES, "");

  const pohPayload: Record<string, unknown> = {
    iss: issuer,
    sub,
    iat: now,
    exp: now + 3600,
    scope: "poh",
    poh: {
      tier: model.compliance.numericLevel,
      verified: model.compliance.verified,
      sybil_resistant: model.compliance.checks.sybilResistant,
      method: model.method ?? null,
    },
  };

  if (principal.dpopJkt) {
    pohPayload.cnf = { jkt: principal.dpopJkt };
  }

  const token = await signJwt(pohPayload);

  return NextResponse.json(
    { token },
    { headers: { "Cache-Control": "no-store" } }
  );
}
