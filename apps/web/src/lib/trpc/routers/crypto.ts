/**
 * Crypto Router
 *
 * Handles cryptographic operations: FHE encryption, ZK proof verification,
 * and challenge-response anti-replay protection.
 *
 * Key operations:
 * - encryptDob/encryptLiveness: Encrypt sensitive data via TFHE-rs backend
 * - verifyProof: Verify Noir ZK proofs with policy enforcement
 * - createChallenge: Issue nonces for replay-resistant proof generation
 * - storeAgeProof: Persist verified age proofs for authenticated users
 *
 * Policy enforcement:
 * - MIN_AGE_POLICY: Age proofs must verify age >= 18
 * - MIN_FACE_MATCH_THRESHOLD: Face similarity must be >= 60%
 * - Nonce validation prevents proof replay attacks
 */
import "server-only";

import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import z from "zod";

import {
  consumeChallenge,
  createChallenge,
  getActiveChallengeCount,
} from "@/lib/crypto/challenge-store";
import {
  encryptDobFhe,
  encryptLivenessScoreFhe,
  verifyAgeFhe,
  verifyLivenessThresholdFhe,
} from "@/lib/crypto/fhe-client";
import { verifyAttestationClaim } from "@/lib/crypto/signed-claims";
import {
  getLatestIdentityDocumentId,
  getLatestSignedClaimByUserAndType,
  getUserAgeProof,
  getUserAgeProofFull,
  insertEncryptedAttribute,
  insertZkProofRecord,
} from "@/lib/db";
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
const MIN_AGE_POLICY = 18;
const MIN_FACE_MATCH_THRESHOLD = 6000; // 60.00% as fixed-point (threshold / 10000)

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

  /**
   * Encrypts date of birth using TFHE-rs (FHE service).
   * Returns ciphertext that can only be decrypted by the FHE service.
   */
  encryptDob: publicProcedure
    .input(
      z.object({
        dob: z.string().optional(),
        birthYear: z.number().optional(),
        clientKeyId: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const dobValue =
        input.dob || (input.birthYear ? `${input.birthYear}-01-01` : null);
      if (!dobValue) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "dob or birthYear is required",
        });
      }

      const startTime = Date.now();
      const data = await encryptDobFhe({
        dob: String(dobValue),
        clientKeyId: input.clientKeyId || "default",
      });
      const encryptionTimeMs = Date.now() - startTime;

      return {
        ciphertext: data.ciphertext,
        clientKeyId: data.clientKeyId,
        encryptionTimeMs,
      };
    }),

  /**
   * Verifies age threshold on FHE-encrypted birth year.
   * Computation happens on ciphertext; result is decrypted server-side.
   */
  verifyAgeFhe: publicProcedure
    .input(
      z.object({
        ciphertext: z.string().min(1, "ciphertext is required"),
        currentYear: z.number().optional(),
        minAge: z.number().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const startTime = Date.now();
      const data = await verifyAgeFhe({
        ciphertext: input.ciphertext,
        currentYear: input.currentYear || new Date().getFullYear(),
        minAge: input.minAge ?? 18,
      });

      return {
        isOver18: data.isOver18,
        computationTimeMs: Date.now() - startTime,
      };
    }),

  encryptLiveness: protectedProcedure
    .input(
      z.object({
        score: z.number().min(0).max(1),
        clientKeyId: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await encryptLivenessScoreFhe({
        score: input.score,
        clientKeyId: input.clientKeyId || "default",
      });

      return {
        ciphertext: result.ciphertext,
        clientKeyId: result.clientKeyId,
        score: result.score,
      };
    }),

  verifyLivenessThreshold: protectedProcedure
    .input(
      z.object({
        ciphertext: z.string().min(1, "ciphertext is required"),
        threshold: z.number().min(0).max(1).optional(),
        clientKeyId: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await verifyLivenessThresholdFhe({
        ciphertext: input.ciphertext,
        threshold: input.threshold ?? 0.3,
        clientKeyId: input.clientKeyId || "default",
      });

      return {
        passesThreshold: result.passesThreshold,
        threshold: result.threshold,
        computationTimeMs: result.computationTimeMs,
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const circuitType = input.circuitType;
      const circuitSpec = CIRCUIT_SPECS[circuitType];

      // Nonce validation is mandatory for all proofs (replay resistance).
      if (input.publicInputs.length <= circuitSpec.nonceIndex) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Missing nonce at public input index ${circuitSpec.nonceIndex}`,
        });
      }

      const nonceHex = normalizeChallengeNonce(
        input.publicInputs[circuitSpec.nonceIndex],
      );
      const challenge = consumeChallenge(nonceHex, circuitType, ctx.userId);
      if (!challenge) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired challenge nonce",
        });
      }

      // Policy enforcement for age verification
      if (circuitType === "age_verification") {
        if (input.publicInputs.length < circuitSpec.minPublicInputs) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `age_verification requires ${circuitSpec.minPublicInputs} public inputs`,
          });
        }

        const providedYear = parsePublicInputToNumber(input.publicInputs[0]);
        const providedMinAge = parsePublicInputToNumber(input.publicInputs[1]);
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
      }

      // Policy enforcement for doc validity
      if (circuitType === "doc_validity") {
        if (input.publicInputs.length < circuitSpec.minPublicInputs) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `doc_validity requires ${circuitSpec.minPublicInputs} public inputs`,
          });
        }

        const providedDate = parsePublicInputToNumber(input.publicInputs[0]);
        const actualDate = getTodayAsInt();
        if (providedDate !== actualDate) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid current_date: ${providedDate} (expected ${actualDate})`,
          });
        }
      }

      // Verify the proof cryptographically using Noir/UltraHonk.
      const result = await verifyNoirProof({
        proof: input.proof,
        publicInputs: input.publicInputs,
        circuitType,
      });

      if (!result.isValid) return result;

      // Enforce circuit output values (is_old_enough / is_valid / is_member / is_match).
      if (circuitType === "age_verification") {
        const isOldEnough = parsePublicInputToNumber(
          input.publicInputs[circuitSpec.resultIndex],
        );
        if (isOldEnough !== 1) {
          return {
            isValid: false,
            reason: "Age requirement not met",
            verificationTimeMs: result.verificationTimeMs,
          };
        }
      }

      if (circuitType === "doc_validity") {
        const isDocValid = parsePublicInputToNumber(
          input.publicInputs[circuitSpec.resultIndex],
        );
        if (isDocValid !== 1) {
          return {
            isValid: false,
            reason: "Document expired",
            verificationTimeMs: result.verificationTimeMs,
          };
        }
      }

      if (circuitType === "nationality_membership") {
        if (input.publicInputs.length < circuitSpec.minPublicInputs) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `nationality_membership requires ${circuitSpec.minPublicInputs} public inputs`,
          });
        }
        const isMember = parsePublicInputToNumber(
          input.publicInputs[circuitSpec.resultIndex],
        );
        if (isMember !== 1) {
          return {
            isValid: false,
            reason: "Nationality not in group",
            verificationTimeMs: result.verificationTimeMs,
          };
        }
      }

      if (circuitType === "face_match") {
        if (input.publicInputs.length < circuitSpec.minPublicInputs) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `face_match requires ${circuitSpec.minPublicInputs} public inputs`,
          });
        }

        const userId = ctx.userId;

        const providedThreshold = parsePublicInputToNumber(
          input.publicInputs[0],
        );

        if (providedThreshold < MIN_FACE_MATCH_THRESHOLD) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `threshold ${providedThreshold} below policy minimum ${MIN_FACE_MATCH_THRESHOLD} (60.00%)`,
          });
        }

        if (providedThreshold > 10000) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `threshold ${providedThreshold} exceeds maximum 10000 (100.00%)`,
          });
        }

        const signedClaim = getLatestSignedClaimByUserAndType(
          userId,
          "face_match_score",
        );
        if (!signedClaim) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Missing signed face match claim",
          });
        }

        let claimPayload: Awaited<ReturnType<typeof verifyAttestationClaim>>;
        try {
          claimPayload = await verifyAttestationClaim(
            signedClaim.signature,
            "face_match_score",
            userId,
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "Invalid signed face match claim",
          });
        }
        const claimData = claimPayload.data as {
          confidence?: number;
          confidenceFixed?: number;
        };
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
          return {
            isValid: false,
            reason: "Face match threshold not met (signed claim)",
            verificationTimeMs: 0,
          };
        }

        const isMatch = parsePublicInputToNumber(
          input.publicInputs[circuitSpec.resultIndex],
        );
        if (isMatch !== 1) {
          return {
            isValid: false,
            reason: "Face match threshold not met",
            verificationTimeMs: result.verificationTimeMs,
          };
        }
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
   * Stores a verified age proof for the authenticated user.
   *
   * Validates:
   * - Public signals format matches age_verification circuit
   * - Proof year is within ±1 of current year
   * - min_age meets policy minimum (18)
   * - Cryptographic proof is valid
   * - Challenge nonce is valid and unconsumed
   */
  storeAgeProof: protectedProcedure
    .input(
      z.object({
        proof: z.string().min(1),
        publicSignals: z.array(z.string()),
        generationTimeMs: z.number().optional(),
        dobCiphertext: z.string().optional(),
        fheClientKeyId: z.string().optional(),
        fheEncryptionTimeMs: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ageSpec = CIRCUIT_SPECS.age_verification;
      if (input.publicSignals.length < ageSpec.minPublicInputs) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `publicSignals must have at least ${ageSpec.minPublicInputs} elements: [current_year, min_age, nonce, is_old_enough]`,
        });
      }

      const providedYear = parsePublicInputToNumber(input.publicSignals[0]);
      const providedMinAge = parsePublicInputToNumber(input.publicSignals[1]);
      const isOldEnough = parsePublicInputToNumber(
        input.publicSignals[ageSpec.resultIndex],
      );
      const actualYear = new Date().getFullYear();

      if (Math.abs(providedYear - actualYear) > 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid proof year: ${providedYear} (expected ~${actualYear})`,
        });
      }

      if (providedMinAge < MIN_AGE_POLICY) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `min_age ${providedMinAge} below policy minimum ${MIN_AGE_POLICY}`,
        });
      }

      const verificationResult = await verifyNoirProof({
        proof: input.proof,
        publicInputs: input.publicSignals,
        circuitType: "age_verification",
      });

      if (!verificationResult.isValid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Proof verification failed: invalid cryptographic proof",
        });
      }

      if (isOldEnough !== 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Age requirement not met: proof shows user is not over 18",
        });
      }

      const nonceHex = normalizeChallengeNonce(
        input.publicSignals[ageSpec.nonceIndex],
      );
      const challenge = consumeChallenge(
        nonceHex,
        "age_verification",
        ctx.userId,
      );
      if (!challenge) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired challenge nonce",
        });
      }

      const isOver18 = true;
      const proofId = crypto.randomUUID();

      const proofHash = crypto
        .createHash("sha256")
        .update(input.proof)
        .digest("hex");
      insertZkProofRecord({
        id: proofId,
        userId: ctx.userId,
        documentId: getLatestIdentityDocumentId(ctx.userId),
        proofType: "age_verification",
        proofHash,
        proofPayload: input.proof,
        publicInputs: JSON.stringify(input.publicSignals),
        isOver18,
        generationTimeMs: input.generationTimeMs,
        nonce: nonceHex,
        policyVersion: null,
        circuitType: verificationResult.circuitType,
        noirVersion: verificationResult.noirVersion,
        circuitHash: verificationResult.circuitHash,
        bbVersion: verificationResult.bbVersion,
        verified: true,
      });

      if (input.dobCiphertext) {
        insertEncryptedAttribute({
          id: crypto.randomUUID(),
          userId: ctx.userId,
          source: "web3_tfhe",
          attributeType: "birth_year",
          ciphertext: input.dobCiphertext,
          keyId: input.fheClientKeyId ?? null,
          encryptionTimeMs: input.fheEncryptionTimeMs ?? null,
        });
      }

      return {
        success: true,
        proofId,
        isOver18,
        verificationTimeMs: verificationResult.verificationTimeMs,
        circuitType: verificationResult.circuitType,
        noirVersion: verificationResult.noirVersion,
        circuitHash: verificationResult.circuitHash,
        bbVersion: verificationResult.bbVersion,
      };
    }),
});
