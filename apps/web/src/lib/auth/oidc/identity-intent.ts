import "server-only";

import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import { constantTimeEqual, makeSignature } from "better-auth/crypto";
import { z } from "zod";

import { getBetterAuthSecret } from "@/lib/utils/env";

const IDENTITY_INTENT_TTL_SECONDS = 120;

const IntentPayloadSchema = z.object({
  jti: z.string().min(1),
  userId: z.string().min(1),
  clientId: z.string().min(1),
  scopeHash: z.string().length(64),
  exp: z.number().int().positive(),
});

export interface IdentityIntentPayload {
  jti: string;
  userId: string;
  clientId: string;
  scopeHash: string;
  exp: number;
}

function normalizeScopes(scopes: string[]): string[] {
  return [
    ...new Set(scopes.map((scope) => scope.trim()).filter(Boolean)),
  ].sort();
}

export function createScopeHash(scopes: string[]): string {
  const normalized = normalizeScopes(scopes);
  return createHash("sha256").update(normalized.join(" ")).digest("hex");
}

export async function createIdentityIntentToken(input: {
  userId: string;
  clientId: string;
  scopes: string[];
  ttlSeconds?: number;
}): Promise<{
  intentToken: string;
  expiresAt: number;
  jti: string;
  scopeHash: string;
}> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (input.ttlSeconds ?? IDENTITY_INTENT_TTL_SECONDS);
  const jti = randomUUID();
  const scopeHash = createScopeHash(input.scopes);
  const payload: IdentityIntentPayload = {
    jti,
    userId: input.userId,
    clientId: input.clientId,
    scopeHash,
    exp: expiresAt,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signature = await makeSignature(encodedPayload, getBetterAuthSecret());

  return {
    intentToken: `${encodedPayload}.${signature}`,
    expiresAt,
    jti,
    scopeHash,
  };
}

export async function verifyIdentityIntentToken(
  intentToken: string
): Promise<IdentityIntentPayload> {
  const [encodedPayload, signature, extra] = intentToken.split(".");
  if (!(encodedPayload && signature) || extra) {
    throw new Error("invalid_intent_token");
  }

  const expectedSignature = await makeSignature(
    encodedPayload,
    getBetterAuthSecret()
  );
  if (!constantTimeEqual(signature, expectedSignature)) {
    throw new Error("invalid_intent_token");
  }

  let payloadRaw: unknown;
  try {
    payloadRaw = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    );
  } catch {
    throw new Error("invalid_intent_token");
  }

  const parsedPayload = IntentPayloadSchema.safeParse(payloadRaw);
  if (!parsedPayload.success) {
    throw new Error("invalid_intent_token");
  }

  if (parsedPayload.data.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("expired_intent_token");
  }

  return parsedPayload.data;
}
