/**
 * RP Compliance Key Management API
 *
 * REST endpoint for RPs to register and manage their ML-KEM-768 public keys
 * for encrypted compliance data.
 *
 * Authentication: OAuth 2.0 client_credentials bearer token
 *
 * Endpoints:
 * - GET: Retrieve current active key
 * - POST: Register new key (or rotate existing)
 * - DELETE: Revoke a key
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  computeKeyFingerprint,
  extractBearerToken,
  validateOAuthAccessToken,
} from "@/lib/auth/oauth-token-validation";
import {
  createRpEncryptionKey,
  getActiveRpEncryptionKey,
  revokeRpEncryptionKey,
  rotateRpEncryptionKey,
} from "@/lib/db/queries/compliance";
import { logger } from "@/lib/logging/logger";
import { hashIdentifier } from "@/lib/observability/telemetry";
import { isValidMlKemPublicKey } from "@/lib/privacy/primitives/ml-kem";

// ML-KEM-768 public key: 1184 bytes raw → ~1580 chars base64
const RegisterKeySchema = z.object({
  public_key: z.string().min(1500).max(1700),
});

const COMPLIANCE_KEY_READ_SCOPE = "compliance:key:read";
const COMPLIANCE_KEY_WRITE_SCOPE = "compliance:key:write";

interface RouteParams {
  params: Promise<{ clientId: string }>;
}

/**
 * GET /api/oauth2/clients/:clientId/compliance-key
 */
export async function GET(
  request: Request,
  { params }: RouteParams
): Promise<Response> {
  const { clientId } = await params;

  const token = extractBearerToken(request.headers);
  if (!token) {
    return NextResponse.json(
      { error: "Missing Authorization header" },
      { status: 401 }
    );
  }

  const validation = await validateOAuthAccessToken(token, {
    requiredScopes: [COMPLIANCE_KEY_READ_SCOPE],
  });
  if (!validation.valid) {
    const status = validation.error?.includes("invalid scope") ? 403 : 401;
    return NextResponse.json({ error: validation.error }, { status });
  }

  if (validation.clientId !== clientId) {
    return NextResponse.json(
      { error: "Cannot access keys for other clients" },
      { status: 403 }
    );
  }

  const key = await getActiveRpEncryptionKey(clientId);
  if (!key) {
    return NextResponse.json({ error: "No active key found" }, { status: 404 });
  }

  return NextResponse.json({
    id: key.id,
    public_key: key.publicKey,
    key_algorithm: key.keyAlgorithm,
    key_fingerprint: key.keyFingerprint,
    status: key.status,
    created_at: key.createdAt,
  });
}

/**
 * POST /api/oauth2/clients/:clientId/compliance-key
 */
export async function POST(
  request: Request,
  { params }: RouteParams
): Promise<Response> {
  const { clientId } = await params;

  const token = extractBearerToken(request.headers);
  if (!token) {
    return NextResponse.json(
      { error: "Missing Authorization header" },
      { status: 401 }
    );
  }

  const validation = await validateOAuthAccessToken(token, {
    requiredScopes: [COMPLIANCE_KEY_WRITE_SCOPE],
  });
  if (!validation.valid) {
    const status = validation.error?.includes("invalid scope") ? 403 : 401;
    return NextResponse.json({ error: validation.error }, { status });
  }

  if (validation.clientId !== clientId) {
    return NextResponse.json(
      { error: "Cannot register keys for other clients" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parseResult = RegisterKeySchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parseResult.error.flatten() },
      { status: 400 }
    );
  }

  const { public_key } = parseResult.data;

  if (!isValidMlKemPublicKey(public_key)) {
    return NextResponse.json(
      {
        error:
          "Invalid ML-KEM-768 public key (must be 1184 bytes base64-encoded)",
      },
      { status: 400 }
    );
  }

  const keyFingerprint = await computeKeyFingerprint(public_key);

  const existingKey = await getActiveRpEncryptionKey(clientId);

  let newKey: Awaited<ReturnType<typeof createRpEncryptionKey>>;
  if (existingKey) {
    newKey = await rotateRpEncryptionKey(clientId, public_key, keyFingerprint);
    logger.info(
      {
        clientId: hashIdentifier(clientId),
        previousKeyId: hashIdentifier(existingKey.id),
        newKeyId: hashIdentifier(newKey.id),
      },
      "RP encryption key rotated"
    );
  } else {
    newKey = await createRpEncryptionKey({
      clientId,
      publicKey: public_key,
      keyFingerprint,
    });
    logger.info(
      {
        clientId: hashIdentifier(clientId),
        keyId: hashIdentifier(newKey.id),
      },
      "RP encryption key registered"
    );
  }

  return NextResponse.json(
    {
      id: newKey.id,
      public_key: newKey.publicKey,
      key_algorithm: newKey.keyAlgorithm,
      key_fingerprint: newKey.keyFingerprint,
      status: newKey.status,
      created_at: newKey.createdAt,
      previous_key_id: newKey.previousKeyId,
    },
    { status: existingKey ? 200 : 201 }
  );
}

/**
 * DELETE /api/oauth2/clients/:clientId/compliance-key
 */
export async function DELETE(
  request: Request,
  { params }: RouteParams
): Promise<Response> {
  const { clientId } = await params;

  const token = extractBearerToken(request.headers);
  if (!token) {
    return NextResponse.json(
      { error: "Missing Authorization header" },
      { status: 401 }
    );
  }

  const validation = await validateOAuthAccessToken(token, {
    requiredScopes: [COMPLIANCE_KEY_WRITE_SCOPE],
  });
  if (!validation.valid) {
    const status = validation.error?.includes("invalid scope") ? 403 : 401;
    return NextResponse.json({ error: validation.error }, { status });
  }

  if (validation.clientId !== clientId) {
    return NextResponse.json(
      { error: "Cannot revoke keys for other clients" },
      { status: 403 }
    );
  }

  const key = await getActiveRpEncryptionKey(clientId);
  if (!key) {
    return NextResponse.json({ error: "No active key found" }, { status: 404 });
  }

  await revokeRpEncryptionKey(key.id);

  logger.info(
    {
      clientId: hashIdentifier(clientId),
      keyId: hashIdentifier(key.id),
    },
    "RP encryption key revoked"
  );

  return new Response(null, { status: 204 });
}
