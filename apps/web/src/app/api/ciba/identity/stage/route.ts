import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";
import { sealApprovalPii } from "@/lib/auth/oidc/approval-crypto";
import { stageReleaseHandle } from "@/lib/auth/oidc/ephemeral-release-handles";
import {
  IdentityFieldsSchema,
  normalizeIdentityFields,
} from "@/lib/auth/oidc/identity-fields-schema";
import {
  createScopeHash,
  verifyIdentityIntentToken,
} from "@/lib/auth/oidc/identity-intent";
import {
  extractIdentityScopes,
  filterIdentityByScopes,
} from "@/lib/auth/oidc/identity-scopes";
import { db } from "@/lib/db/connection";
import { approvals } from "@/lib/db/schema/approvals";
import { cibaRequests } from "@/lib/db/schema/ciba";

const StageSchema = z.object({
  auth_req_id: z.string().min(1),
  scopes: z.array(z.string()).min(1),
  identity: IdentityFieldsSchema.optional(),
  intent_token: z.string().min(1),
});

/**
 * POST /api/ciba/identity/stage — Seal and store PII for a CIBA request.
 *
 * Encrypts PII with a per-approval AES-GCM key, writes a durable record
 * to the `approvals` table, and stages the release handle for embedding
 * in the access token via customAccessTokenClaims. The RP redeems PII
 * by calling POST /api/oauth2/release with the access token.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = StageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { auth_req_id, scopes, identity, intent_token } = parsed.data;

  // Look up the CIBA request for context
  const cibaRequest = await db
    .select({
      clientId: cibaRequests.clientId,
      userId: cibaRequests.userId,
      scope: cibaRequests.scope,
      status: cibaRequests.status,
    })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, auth_req_id))
    .get();

  if (!cibaRequest) {
    return NextResponse.json({ error: "Unknown auth_req_id" }, { status: 404 });
  }

  if (cibaRequest.userId !== session.user.id) {
    return NextResponse.json(
      { error: "CIBA request does not belong to current user" },
      { status: 403 }
    );
  }

  if (cibaRequest.status !== "pending") {
    return NextResponse.json(
      { error: "CIBA request is no longer pending" },
      { status: 400 }
    );
  }

  // Verify scopes are within the CIBA request
  const cibaScopes = new Set(cibaRequest.scope.split(" "));
  for (const scope of scopes) {
    if (!cibaScopes.has(scope)) {
      return NextResponse.json(
        { error: `Scope not in CIBA request: ${scope}` },
        { status: 400 }
      );
    }
  }

  const identityScopes = extractIdentityScopes(scopes);
  if (identityScopes.length === 0) {
    return NextResponse.json({ staged: false });
  }

  // Verify the intent token
  let intentPayload: Awaited<ReturnType<typeof verifyIdentityIntentToken>>;
  try {
    intentPayload = await verifyIdentityIntentToken(intent_token);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired intent token" },
      { status: 400 }
    );
  }

  if (intentPayload.userId !== session.user.id) {
    return NextResponse.json(
      { error: "Intent token does not match current user" },
      { status: 403 }
    );
  }

  const scopeHash = createScopeHash(scopes);
  if (
    intentPayload.clientId !== cibaRequest.clientId ||
    intentPayload.scopeHash !== scopeHash
  ) {
    return NextResponse.json(
      { error: "Intent token does not match request context" },
      { status: 400 }
    );
  }

  const normalizedIdentity = normalizeIdentityFields(identity ?? {});
  const filteredIdentity = filterIdentityByScopes(
    normalizedIdentity,
    identityScopes
  );

  if (Object.keys(filteredIdentity).length === 0) {
    return NextResponse.json({ staged: false });
  }

  const piiJson = JSON.stringify(filteredIdentity);
  const sealed = await sealApprovalPii(piiJson);

  await db
    .insert(approvals)
    .values({
      authReqId: auth_req_id,
      userId: session.user.id,
      clientId: cibaRequest.clientId,
      approvedScopes: scopes.join(" "),
      encryptedPii: sealed.encryptedPii,
      encryptionIv: sealed.encryptionIv,
      releaseHandleHash: sealed.releaseHandleHash,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    .run();

  stageReleaseHandle(session.user.id, sealed.releaseHandle);

  return NextResponse.json({ staged: true });
}
