/**
 * RP Compliance Key Management API
 *
 * REST endpoint for RPs to register and manage their X25519 public keys
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
  isValidX25519PublicKey,
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

const RegisterKeySchema = z.object({
  public_key: z.string().min(40).max(100), // Base64 X25519 key (32 bytes = ~44 chars)
  key_algorithm: z.enum(["x25519", "x25519-ml-kem"]).default("x25519"),
});

const COMPLIANCE_KEY_READ_SCOPE = "compliance:key:read";
const COMPLIANCE_KEY_WRITE_SCOPE = "compliance:key:write";

interface RouteParams {
  params: Promise<{ clientId: string }>;
}

/**
 * GET /api/oauth2/clients/:clientId/compliance-key
 *
 * Retrieve the active encryption key for this client.
 */
export async function GET(
  request: Request,
  { params }: RouteParams
): Promise<Response> {
  const { clientId } = await params;

  // Validate OAuth token
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

  // Ensure client can only access their own keys
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
 *
 * Register a new encryption key. If an active key exists, this rotates it.
 */
export async function POST(
  request: Request,
  { params }: RouteParams
): Promise<Response> {
  const { clientId } = await params;

  // Validate OAuth token
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

  // Parse and validate request body
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

  const { public_key, key_algorithm } = parseResult.data;

  // Validate key format
  if (key_algorithm === "x25519" && !isValidX25519PublicKey(public_key)) {
    return NextResponse.json(
      { error: "Invalid X25519 public key (must be 32 bytes base64-encoded)" },
      { status: 400 }
    );
  }

  // Compute fingerprint
  const keyFingerprint = await computeKeyFingerprint(public_key);

  // Check if a key already exists (rotate) or create new
  const existingKey = await getActiveRpEncryptionKey(clientId, key_algorithm);

  let newKey: Awaited<ReturnType<typeof createRpEncryptionKey>>;
  if (existingKey) {
    // Rotate: mark old key as rotated, create new one
    newKey = await rotateRpEncryptionKey(
      clientId,
      public_key,
      keyFingerprint,
      key_algorithm
    );
    logger.info(
      {
        clientId: hashIdentifier(clientId),
        previousKeyId: hashIdentifier(existingKey.id),
        newKeyId: hashIdentifier(newKey.id),
      },
      "RP encryption key rotated"
    );
  } else {
    // Create first key
    newKey = await createRpEncryptionKey({
      clientId,
      publicKey: public_key,
      keyAlgorithm: key_algorithm,
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
 *
 * Revoke the active encryption key.
 */
export async function DELETE(
  request: Request,
  { params }: RouteParams
): Promise<Response> {
  const { clientId } = await params;

  // Validate OAuth token
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
