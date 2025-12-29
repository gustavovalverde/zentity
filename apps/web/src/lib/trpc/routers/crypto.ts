/**
 * Crypto Router
 *
 * Handles cryptographic operations: FHE encryption, ZK proof verification,
 * and challenge-response anti-replay protection.
 *
 * Key operations:
 * - encryptLiveness: Encrypt sensitive data via TFHE-rs backend
 * - verifyProof: Verify Noir ZK proofs with policy enforcement
 * - createChallenge: Issue nonces for replay-resistant proof generation
 * - storeProof: Persist verified ZK proofs for authenticated users
 *
 * Policy enforcement:
 * - MIN_AGE_POLICY: Age proofs must verify age >= 18
 * - MIN_FACE_MATCH_THRESHOLD: Face similarity must be >= FACE_MATCH_MIN_CONFIDENCE
 * - Nonce validation prevents proof replay attacks
 */
import "server-only";

import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import z from "zod";

import {
  ISSUER_ID,
  MIN_AGE_POLICY,
  POLICY_VERSION,
} from "@/lib/attestation/policy";
import { POLICY_HASH } from "@/lib/attestation/policy-hash";
import {
  consumeChallenge,
  createChallenge,
  getActiveChallengeCount,
} from "@/lib/crypto/challenge-store";
import {
  encryptComplianceLevelFhe,
  encryptLivenessScoreFhe,
  registerFheKey,
  verifyAgeFhe,
  verifyLivenessThresholdFhe,
} from "@/lib/crypto/fhe-client";
import {
  type FaceMatchClaimData,
  type OcrClaimData,
  verifyAttestationClaim,
} from "@/lib/crypto/signed-claims";
import {
  getIdentityBundleByUserId,
  getLatestSignedClaimByUserTypeAndDocument,
  getProofHashesByUserAndDocument,
  getSelectedIdentityDocumentByUserId,
  getUserAgeProof,
  getUserAgeProofFull,
  getVerificationStatus,
  insertEncryptedAttribute,
  insertZkProofRecord,
  updateIdentityBundleStatus,
  upsertAttestationEvidence,
} from "@/lib/db";
import { getComplianceLevel } from "@/lib/identity/compliance";
import { FACE_MATCH_MIN_CONFIDENCE } from "@/lib/liveness/liveness-policy";
import { getFheServiceUrl } from "@/lib/utils/service-urls";
import {
  CIRCUIT_SPECS,
  getTodayAsInt,
  normalizeChallengeNonce,
  parsePublicInputToNumber,
} from "@/lib/zk";
import {
  getBbJsVersion,
  getCircuitMetadata,
  verifyNoirProof,
} from "@/lib/zk/noir-verifier";

import { protectedProcedure, publicProcedure, router } from "../server";

const FHE_SERVICE_URL = getFheServiceUrl();

const circuitTypeSchema = z.enum([
  "age_verification",
  "doc_validity",
  "nationality_membership",
  "face_match",
]);

// Server-enforced policy minimums (cannot be bypassed by client).
// TODO(zk/fhe): Raise FACE_MATCH_MIN_CONFIDENCE to 0.60 once model quality improves.
const MIN_FACE_MATCH_THRESHOLD = Math.round(FACE_MATCH_MIN_CONFIDENCE * 10000);
const MIN_FACE_MATCH_PERCENT = Math.round(FACE_MATCH_MIN_CONFIDENCE * 100);

/** Checks if a backend service is reachable via its /health endpoint. */
async function checkService(url: string, timeoutMs = 5000): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;
    return await response.json();
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

function parseFieldToBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid field element in public inputs",
    });
  }
}

type NoirVerificationResult = Awaited<ReturnType<typeof verifyNoirProof>>;
type ProofVerificationResult = NoirVerificationResult & { reason?: string };

async function getVerifiedClaim(
  userId: string,
  claimType: "ocr_result" | "face_match_score" | "liveness_score",
  documentId: string | null,
) {
  if (!documentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Missing document context for signed claim verification",
    });
  }

  const signedClaim = getLatestSignedClaimByUserTypeAndDocument(
    userId,
    claimType,
    documentId,
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
      userId,
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

function assertPolicyVersion(
  claim: { policyVersion?: string },
  claimType: string,
): void {
  if (!claim.policyVersion || claim.policyVersion !== POLICY_VERSION) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${claimType} policy version mismatch`,
    });
  }
}

function computeProofHash(args: {
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

function computeProofSetHash(args: {
  proofHashes: string[];
  policyHash: string;
}): string {
  const hash = crypto.createHash("sha256");
  const normalized = [...args.proofHashes].sort();
  hash.update(JSON.stringify(normalized));
  hash.update(args.policyHash);
  return hash.digest("hex");
}

async function verifyProofInternal(args: {
  userId: string;
  circuitType: z.infer<typeof circuitTypeSchema>;
  proof: string;
  publicInputs: string[];
  documentId: string | null;
}): Promise<{ result: ProofVerificationResult; nonceHex: string }> {
  const circuitType = args.circuitType;
  const circuitSpec = CIRCUIT_SPECS[circuitType];
  const circuitMeta = getCircuitMetadata(circuitType);
  const bbVersion = getBbJsVersion();

  if (args.publicInputs.length < circuitSpec.minPublicInputs) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${circuitType} requires ${circuitSpec.minPublicInputs} public inputs`,
    });
  }

  const nonceHex = normalizeChallengeNonce(
    args.publicInputs[circuitSpec.nonceIndex],
  );

  const failure = (reason: string, verificationTimeMs = 0) => ({
    result: {
      isValid: false,
      reason,
      verificationTimeMs,
      circuitType,
      noirVersion: circuitMeta.noirVersion,
      circuitHash: circuitMeta.circuitHash,
      circuitId: null,
      verificationKeyHash: null,
      bbVersion,
    },
    nonceHex,
  });
  const claimHashInput = args.publicInputs[circuitSpec.claimHashIndex];
  if (!claimHashInput) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Missing claim hash in public inputs",
    });
  }
  const claimHashBigInt = parseFieldToBigInt(claimHashInput);

  if (circuitType === "age_verification") {
    const providedYear = parsePublicInputToNumber(args.publicInputs[0]);
    const providedMinAge = parsePublicInputToNumber(args.publicInputs[1]);
    const actualYear = new Date().getFullYear();

    if (Math.abs(providedYear - actualYear) > 1) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid current_year: ${providedYear} (expected ~${actualYear})`,
      });
    }

    if (providedMinAge < MIN_AGE_POLICY) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `min_age ${providedMinAge} below policy minimum ${MIN_AGE_POLICY}`,
      });
    }

    const ocrClaim = await getVerifiedClaim(
      args.userId,
      "ocr_result",
      args.documentId,
    );
    assertPolicyVersion(ocrClaim, "ocr_result");
    const claimData = ocrClaim.data as OcrClaimData;
    const expectedHash = claimData.claimHashes?.age;
    if (!expectedHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing age claim hash in OCR claim",
      });
    }
    if (parseFieldToBigInt(expectedHash) !== claimHashBigInt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Age claim hash mismatch",
      });
    }
  }

  if (circuitType === "doc_validity") {
    const providedDate = parsePublicInputToNumber(args.publicInputs[0]);
    const actualDate = getTodayAsInt();
    if (providedDate !== actualDate) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid current_date: ${providedDate} (expected ${actualDate})`,
      });
    }

    const ocrClaim = await getVerifiedClaim(
      args.userId,
      "ocr_result",
      args.documentId,
    );
    assertPolicyVersion(ocrClaim, "ocr_result");
    const claimData = ocrClaim.data as OcrClaimData;
    const expectedHash = claimData.claimHashes?.docValidity;
    if (!expectedHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing document validity claim hash in OCR claim",
      });
    }
    if (parseFieldToBigInt(expectedHash) !== claimHashBigInt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Document validity claim hash mismatch",
      });
    }
  }

  if (circuitType === "nationality_membership") {
    const ocrClaim = await getVerifiedClaim(
      args.userId,
      "ocr_result",
      args.documentId,
    );
    assertPolicyVersion(ocrClaim, "ocr_result");
    const claimData = ocrClaim.data as OcrClaimData;
    const expectedHash = claimData.claimHashes?.nationality;
    if (!expectedHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing nationality claim hash in OCR claim",
      });
    }
    if (parseFieldToBigInt(expectedHash) !== claimHashBigInt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Nationality claim hash mismatch",
      });
    }
  }

  if (circuitType === "face_match") {
    const providedThreshold = parsePublicInputToNumber(args.publicInputs[0]);

    if (providedThreshold < MIN_FACE_MATCH_THRESHOLD) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `threshold ${providedThreshold} below policy minimum ${MIN_FACE_MATCH_THRESHOLD} (${MIN_FACE_MATCH_PERCENT}.00%)`,
      });
    }

    if (providedThreshold > 10000) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `threshold ${providedThreshold} exceeds maximum 10000 (100.00%)`,
      });
    }

    const faceClaim = await getVerifiedClaim(
      args.userId,
      "face_match_score",
      args.documentId,
    );
    assertPolicyVersion(faceClaim, "face_match_score");
    const claimData = faceClaim.data as FaceMatchClaimData;
    if (!claimData.claimHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing face match claim hash",
      });
    }
    if (parseFieldToBigInt(claimData.claimHash) !== claimHashBigInt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Face match claim hash mismatch",
      });
    }

    const confidenceFixed =
      typeof claimData.confidenceFixed === "number"
        ? claimData.confidenceFixed
        : typeof claimData.confidence === "number"
          ? Math.round(claimData.confidence * 10000)
          : null;
    if (confidenceFixed === null || Number.isNaN(confidenceFixed)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid face match claim payload",
      });
    }

    if (confidenceFixed < providedThreshold) {
      return failure("Face match threshold not met (signed claim)");
    }
  }

  const verificationResult = await verifyNoirProof({
    proof: args.proof,
    publicInputs: args.publicInputs,
    circuitType,
  });

  if (!verificationResult.isValid) {
    return { result: verificationResult, nonceHex };
  }

  if (circuitType === "age_verification") {
    const isOldEnough = parsePublicInputToNumber(
      args.publicInputs[circuitSpec.resultIndex],
    );
    if (isOldEnough !== 1) {
      return failure(
        "Age requirement not met",
        verificationResult.verificationTimeMs,
      );
    }
  }

  if (circuitType === "doc_validity") {
    const isDocValid = parsePublicInputToNumber(
      args.publicInputs[circuitSpec.resultIndex],
    );
    if (isDocValid !== 1) {
      return failure("Document expired", verificationResult.verificationTimeMs);
    }
  }

  if (circuitType === "nationality_membership") {
    const isMember = parsePublicInputToNumber(
      args.publicInputs[circuitSpec.resultIndex],
    );
    if (isMember !== 1) {
      return failure(
        "Nationality not in group",
        verificationResult.verificationTimeMs,
      );
    }
  }

  if (circuitType === "face_match") {
    const isMatch = parsePublicInputToNumber(
      args.publicInputs[circuitSpec.resultIndex],
    );
    if (isMatch !== 1) {
      return failure(
        "Face match threshold not met",
        verificationResult.verificationTimeMs,
      );
    }
  }

  return { result: verificationResult, nonceHex };
}

export const cryptoRouter = router({
  /**
   * Health check for crypto subsystems.
   * Returns status of FHE service and available ZK circuits.
   */
  health: publicProcedure.query(async () => {
    const fheHealth = await checkService(FHE_SERVICE_URL);

    const zk = {
      bbVersion: getBbJsVersion(),
      circuits: {
        age_verification: getCircuitMetadata("age_verification"),
        doc_validity: getCircuitMetadata("doc_validity"),
        nationality_membership: getCircuitMetadata("nationality_membership"),
        face_match: getCircuitMetadata("face_match"),
      },
    };

    const allHealthy =
      (fheHealth as { status?: unknown } | null)?.status === "ok" &&
      Boolean(zk.bbVersion);

    return {
      fhe: fheHealth,
      zk,
      allHealthy,
    };
  }),

  registerFheKey: protectedProcedure
    .input(
      z.object({
        serverKey: z.string().min(1, "serverKey is required"),
      }),
    )
    .mutation(async ({ input }) => {
      return await registerFheKey({ serverKey: input.serverKey });
    }),

  /**
   * Verifies age threshold on FHE-encrypted birth year offset.
   * Computation happens on ciphertext; result is returned encrypted for client decryption.
   */
  verifyAgeFhe: publicProcedure
    .input(
      z.object({
        ciphertext: z.string().min(1, "ciphertext is required"),
        currentYear: z.number().optional(),
        minAge: z.number().optional(),
        keyId: z.string().min(1, "keyId is required"),
      }),
    )
    .mutation(async ({ input }) => {
      const startTime = Date.now();
      const data = await verifyAgeFhe({
        ciphertext: input.ciphertext,
        currentYear: input.currentYear || new Date().getFullYear(),
        minAge: input.minAge ?? 18,
        keyId: input.keyId,
      });

      return {
        resultCiphertext: data.resultCiphertext,
        computationTimeMs: Date.now() - startTime,
      };
    }),

  encryptLiveness: protectedProcedure
    .input(
      z.object({
        score: z.number().min(0).max(1),
        publicKey: z.string().min(1, "publicKey is required"),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await encryptLivenessScoreFhe({
        score: input.score,
        publicKey: input.publicKey,
      });

      return {
        ciphertext: result.ciphertext,
        score: result.score,
      };
    }),

  verifyLivenessThreshold: protectedProcedure
    .input(
      z.object({
        ciphertext: z.string().min(1, "ciphertext is required"),
        threshold: z.number().min(0).max(1).optional(),
        keyId: z.string().min(1, "keyId is required"),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await verifyLivenessThresholdFhe({
        ciphertext: input.ciphertext,
        threshold: input.threshold ?? 0.3,
        keyId: input.keyId,
      });

      return {
        passesCiphertext: result.passesCiphertext,
        threshold: result.threshold,
      };
    }),

  /**
   * Verifies a Noir ZK proof using UltraHonk (Barretenberg).
   *
   * Performs:
   * 1. Nonce validation (replay prevention)
   * 2. Policy enforcement (min age, current date, thresholds)
   * 3. Cryptographic proof verification
   * 4. Circuit output validation (is_old_enough, is_valid, etc.)
   */
  verifyProof: protectedProcedure
    .input(
      z.object({
        proof: z.string().min(1),
        publicInputs: z.array(z.string()),
        circuitType: circuitTypeSchema,
        documentId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const selectedDocument = getSelectedIdentityDocumentByUserId(ctx.userId);
      const documentId = input.documentId ?? selectedDocument?.id ?? null;
      const { result, nonceHex } = await verifyProofInternal({
        userId: ctx.userId,
        circuitType: input.circuitType,
        proof: input.proof,
        publicInputs: input.publicInputs,
        documentId,
      });

      if (!result.isValid) return result;

      const challenge = consumeChallenge(
        nonceHex,
        input.circuitType,
        ctx.userId,
      );
      if (!challenge) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired challenge nonce",
        });
      }

      return result;
    }),

  /**
   * Creates a challenge nonce for replay-resistant proof generation.
   * The nonce must be included in the proof's public inputs and will
   * be consumed on verification (single-use).
   */
  createChallenge: protectedProcedure
    .input(z.object({ circuitType: circuitTypeSchema }))
    .mutation(async ({ ctx, input }) => {
      const challenge = createChallenge(input.circuitType, ctx.userId);
      return {
        nonce: challenge.nonce,
        circuitType: challenge.circuitType,
        expiresAt: new Date(challenge.expiresAt).toISOString(),
      };
    }),

  challengeStatus: protectedProcedure.query(() => {
    return {
      activeChallenges: getActiveChallengeCount(),
      supportedCircuitTypes: circuitTypeSchema.options,
      ttlMinutes: 15,
    };
  }),

  getUserProof: protectedProcedure
    .input(z.object({ full: z.boolean().optional() }).optional())
    .query(({ ctx, input }) => {
      return input?.full === true
        ? getUserAgeProofFull(ctx.userId)
        : getUserAgeProof(ctx.userId);
    }),

  /**
   * Fetch latest signed claims for proof generation (OCR + face match + liveness).
   */
  getSignedClaims: protectedProcedure
    .input(z.object({ documentId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const selectedDocument = getSelectedIdentityDocumentByUserId(ctx.userId);
      const documentId = input?.documentId ?? selectedDocument?.id ?? null;
      if (!documentId) {
        return {
          documentId: null,
          ocr: null,
          faceMatch: null,
          liveness: null,
        };
      }

      const ocr = getLatestSignedClaimByUserTypeAndDocument(
        ctx.userId,
        "ocr_result",
        documentId,
      );
      const faceMatch = getLatestSignedClaimByUserTypeAndDocument(
        ctx.userId,
        "face_match_score",
        documentId,
      );
      const liveness = getLatestSignedClaimByUserTypeAndDocument(
        ctx.userId,
        "liveness_score",
        documentId,
      );

      return {
        documentId,
        ocr: ocr
          ? await verifyAttestationClaim(
              ocr.signature,
              "ocr_result",
              ctx.userId,
            )
          : null,
        faceMatch: faceMatch
          ? await verifyAttestationClaim(
              faceMatch.signature,
              "face_match_score",
              ctx.userId,
            )
          : null,
        liveness: liveness
          ? await verifyAttestationClaim(
              liveness.signature,
              "liveness_score",
              ctx.userId,
            )
          : null,
      };
    }),

  /**
   * Stores a verified ZK proof for the authenticated user.
   *
   * Validates:
   * - Public signals format matches circuit spec
   * - Policy enforcement (age/current date/thresholds)
   * - Signed claim binding via claim_hash
   * - Cryptographic proof validity
   * - Challenge nonce is valid and unconsumed
   */
  storeProof: protectedProcedure
    .input(
      z.object({
        circuitType: circuitTypeSchema,
        proof: z.string().min(1),
        publicSignals: z.array(z.string()),
        generationTimeMs: z.number().optional(),
        documentId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const selectedDocument = getSelectedIdentityDocumentByUserId(ctx.userId);
      const documentId = input.documentId ?? selectedDocument?.id ?? null;
      if (!documentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Missing document context for proof storage",
        });
      }

      const { result, nonceHex } = await verifyProofInternal({
        userId: ctx.userId,
        circuitType: input.circuitType,
        proof: input.proof,
        publicInputs: input.publicSignals,
        documentId,
      });

      if (!result.isValid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.reason || "Proof verification failed",
        });
      }

      const challenge = consumeChallenge(
        nonceHex,
        input.circuitType,
        ctx.userId,
      );
      if (!challenge) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired challenge nonce",
        });
      }

      const proofId = crypto.randomUUID();
      const proofHash = computeProofHash({
        proof: input.proof,
        publicInputs: input.publicSignals,
        policyVersion: POLICY_VERSION,
      });

      insertZkProofRecord({
        id: proofId,
        userId: ctx.userId,
        documentId,
        proofType: input.circuitType,
        proofHash,
        proofPayload: input.proof,
        publicInputs: JSON.stringify(input.publicSignals),
        isOver18: input.circuitType === "age_verification" ? true : null,
        generationTimeMs: input.generationTimeMs,
        nonce: nonceHex,
        policyVersion: POLICY_VERSION,
        circuitType: result.circuitType,
        noirVersion: result.noirVersion,
        circuitHash: result.circuitHash,
        bbVersion: result.bbVersion,
        verified: true,
      });

      const proofHashes = getProofHashesByUserAndDocument(
        ctx.userId,
        documentId,
      );
      const proofSetHash = computeProofSetHash({
        proofHashes,
        policyHash: POLICY_HASH,
      });
      upsertAttestationEvidence({
        userId: ctx.userId,
        documentId,
        policyVersion: POLICY_VERSION,
        policyHash: POLICY_HASH,
        proofSetHash,
      });

      const bundle = getIdentityBundleByUserId(ctx.userId);
      if (bundle?.fhePublicKey) {
        try {
          const verificationStatus = getVerificationStatus(ctx.userId);
          const complianceLevel = getComplianceLevel(verificationStatus);
          const startTime = Date.now();
          const encrypted = await encryptComplianceLevelFhe({
            complianceLevel,
            publicKey: bundle.fhePublicKey,
          });
          insertEncryptedAttribute({
            id: crypto.randomUUID(),
            userId: ctx.userId,
            source: "web2_tfhe",
            attributeType: "compliance_level",
            ciphertext: encrypted.ciphertext,
            keyId: bundle.fheKeyId ?? null,
            encryptionTimeMs: Date.now() - startTime,
          });
        } catch (error) {
          // Compliance level encryption is best-effort; proof storage should still succeed.
          // biome-ignore lint/suspicious/noConsole: surface non-blocking FHE errors in server logs.
          console.warn(
            "[crypto.storeProof] compliance level encryption failed:",
            error,
          );
        }
      }

      const verificationStatus = getVerificationStatus(ctx.userId);
      if (verificationStatus.verified) {
        updateIdentityBundleStatus({
          userId: ctx.userId,
          status: "verified",
          policyVersion: POLICY_VERSION,
          issuerId: ISSUER_ID,
        });
      }

      return {
        success: true,
        proofId,
        proofHash,
        verificationTimeMs: result.verificationTimeMs,
        circuitType: result.circuitType,
        noirVersion: result.noirVersion,
        circuitHash: result.circuitHash,
        bbVersion: result.bbVersion,
      };
    }),
});
