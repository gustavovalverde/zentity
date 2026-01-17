import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";

import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import { getLatestSignedClaimByUserTypeAndDocument } from "@/lib/db/queries/crypto";
import { verifyAttestationClaim } from "@/lib/privacy/crypto/signed-claims";

export function parseFieldToBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid field element in public inputs",
    });
  }
}

export async function getVerifiedClaim(
  userId: string,
  claimType: "ocr_result" | "face_match_score" | "liveness_score",
  documentId: string | null
) {
  if (!documentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Missing document context for signed claim verification",
    });
  }

  const signedClaim = await getLatestSignedClaimByUserTypeAndDocument(
    userId,
    claimType,
    documentId
  );
  if (!signedClaim) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Missing signed ${claimType} claim for document`,
    });
  }

  try {
    return await verifyAttestationClaim(
      signedClaim.signature,
      claimType,
      userId
    );
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error
          ? error.message
          : `Invalid signed ${claimType} claim`,
    });
  }
}

export function assertPolicyVersion(
  claim: { policyVersion?: string },
  claimType: string
): void {
  if (!claim.policyVersion || claim.policyVersion !== POLICY_VERSION) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${claimType} policy version mismatch`,
    });
  }
}

export function computeProofHash(args: {
  proof: string;
  publicInputs: string[];
  policyVersion: string;
}): string {
  const hash = crypto.createHash("sha256");
  hash.update(Buffer.from(args.proof, "base64"));
  hash.update(JSON.stringify(args.publicInputs));
  hash.update(args.policyVersion);
  return hash.digest("hex");
}

export function computeProofSetHash(args: {
  proofHashes: string[];
  policyHash: string;
}): string {
  const hash = crypto.createHash("sha256");
  const normalized = [...args.proofHashes].sort((a, b) => a.localeCompare(b));
  hash.update(JSON.stringify(normalized));
  hash.update(args.policyHash);
  return hash.digest("hex");
}

export type {
  FaceMatchClaimData,
  OcrClaimData,
} from "@/lib/privacy/crypto/signed-claims";
