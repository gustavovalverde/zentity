import "server-only";

import type { JWTPayload } from "jose";

import { jwtVerify, SignJWT } from "jose";

import { getClaimSigningKey } from "@/lib/privacy/primitives/derived-keys";

const CLAIMS_ISSUER = "zentity-attestation";
const CLAIMS_AUDIENCE = "zentity-claims";

type AttestationClaimType =
  | "liveness_score"
  | "face_match_score"
  | "ocr_result"
  | "chip_verification";

interface LivenessClaimData {
  antispoofScore: number;
  antispoofScoreFixed: number;
  liveScore: number;
  liveScoreFixed: number;
  passed: boolean;
}

export interface FaceMatchClaimData {
  claimHash: string | null;
  confidence: number;
  confidenceFixed: number;
  passed: boolean;
  thresholdFixed: number;
}

export interface OcrClaimData {
  claimHashes: {
    age?: string | null;
    docValidity?: string | null;
    nationality?: string | null;
  };
  confidence?: number | null;
  documentType?: string | null;
  issuerCountry?: string | null;
}

interface ChipVerificationClaimData {
  ageVerified: boolean;
  faceMatchPassed: boolean;
  hasDob: boolean;
  hasName: boolean;
  hasNationality: boolean;
  livenessScore: number;
  sanctionsCleared: boolean;
}

interface AttestationClaimPayload {
  data:
    | LivenessClaimData
    | FaceMatchClaimData
    | OcrClaimData
    | ChipVerificationClaimData;
  documentHash?: string | null;
  documentHashField?: string | null;
  issuedAt: string;
  policyVersion: string;
  type: AttestationClaimType;
  userId: string;
  version: number;
}

function getSigningKey(): Uint8Array {
  return getClaimSigningKey();
}

export async function signAttestationClaim(
  payload: AttestationClaimPayload
): Promise<string> {
  const key = getSigningKey();
  return await new SignJWT(payload as unknown as JWTPayload)
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
  expectedUserId?: string
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

  if (
    !(
      claim.type &&
      claim.userId &&
      claim.issuedAt &&
      claim.policyVersion &&
      claim.data
    )
  ) {
    throw new Error("Claim payload missing required fields");
  }

  return claim as AttestationClaimPayload;
}
