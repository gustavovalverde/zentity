import "server-only";

import type { JWTPayload } from "jose";

import { jwtVerify, SignJWT } from "jose";

import { getBetterAuthSecret } from "@/lib/utils/env";

const CLAIMS_ISSUER = "zentity-attestation";
const CLAIMS_AUDIENCE = "zentity-claims";

export type AttestationClaimType = "liveness_score" | "face_match_score";

export type LivenessClaimData = {
  antispoofScore: number;
  liveScore: number;
  passed: boolean;
  antispoofScoreFixed: number;
  liveScoreFixed: number;
};

export type FaceMatchClaimData = {
  confidence: number;
  confidenceFixed: number;
  thresholdFixed: number;
  passed: boolean;
};

export type AttestationClaimPayload = {
  type: AttestationClaimType;
  userId: string;
  issuedAt: string;
  version: number;
  documentHash?: string | null;
  data: LivenessClaimData | FaceMatchClaimData;
};

function getSigningKey(): Uint8Array {
  const secret = getBetterAuthSecret();
  return new TextEncoder().encode(secret);
}

export async function signAttestationClaim(
  payload: AttestationClaimPayload,
): Promise<string> {
  const key = getSigningKey();
  return new SignJWT(payload as JWTPayload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(CLAIMS_ISSUER)
    .setAudience(CLAIMS_AUDIENCE)
    .setSubject(payload.userId)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .sign(key);
}

export async function verifyAttestationClaim(
  token: string,
  expectedType?: AttestationClaimType,
  expectedUserId?: string,
): Promise<AttestationClaimPayload> {
  const key = getSigningKey();
  const { payload } = await jwtVerify(token, key, {
    issuer: CLAIMS_ISSUER,
    audience: CLAIMS_AUDIENCE,
  });

  const claim = payload as unknown as Partial<AttestationClaimPayload>;
  if (!claim || typeof claim !== "object") {
    throw new Error("Invalid claim payload");
  }

  if (expectedType && claim.type !== expectedType) {
    throw new Error(`Claim type mismatch: expected ${expectedType}`);
  }

  if (expectedUserId && claim.userId !== expectedUserId) {
    throw new Error("Claim user mismatch");
  }

  if (!claim.type || !claim.userId || !claim.issuedAt || !claim.data) {
    throw new Error("Claim payload missing required fields");
  }

  return claim as AttestationClaimPayload;
}
