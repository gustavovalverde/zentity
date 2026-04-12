/**
 * ZK Router
 *
 * Handles ZK proof verification, BBS+ credentials, and challenge-response
 * anti-replay protection.
 *
 * Key operations:
 * - verifyProof: Verify Noir ZK proofs with policy enforcement
 * - createChallenge: Issue nonces for replay-resistant proof generation
 * - storeProof: Persist verified ZK proofs for authenticated users
 * - bbs.*: BBS+ credential issuance, presentation creation, and verification
 *
 * Policy enforcement:
 * - MIN_AGE_POLICY: Age proofs must verify age >= 18
 * - MIN_FACE_MATCH_THRESHOLD: Face similarity must be >= FACE_MATCH_MIN_CONFIDENCE
 * - Nonce validation prevents proof replay attacks
 *
 * The large verifyProof/storeProof procedures live in `./zk-proof.ts` to keep
 * this file focused on the router shape + thin procedures.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "@/env";
import { createPresentation } from "@/lib/bbs/holder";
import { deriveBbsKeyPair } from "@/lib/bbs/keygen";
import {
  deserializeCredential,
  deserializePresentation,
  type SerializedBbsCredential,
  type SerializedBbsPresentation,
  serializeCredential,
  serializePresentation,
} from "@/lib/bbs/serialization";
import { createWalletCredential, verifyCredential } from "@/lib/bbs/signer";
import { WALLET_CREDENTIAL_CLAIM_ORDER } from "@/lib/bbs/types";
import { verifyPresentation as verifyBbsPresentation } from "@/lib/bbs/verifier";
import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import {
  createProofSession,
  getProofSessionById,
} from "@/lib/db/queries/crypto";
import { getSelectedVerification } from "@/lib/db/queries/identity";
import {
  createChallenge,
  getActiveChallengeCount,
} from "@/lib/privacy/zk/challenge-store";
import {
  getBbJsVersion,
  getCircuitMetadata,
  prewarmVerificationKeys,
} from "@/lib/privacy/zk/noir-verifier";
import { bytesToBase64 } from "@/lib/utils/base64";
import { resolveAudience } from "@/lib/utils/http";

import { protectedProcedure, publicProcedure, router } from "../server";
import {
  circuitTypeSchema,
  getChecksProcedure,
  getProofsProcedure,
  getSignedClaimsProcedure,
  storeProofProcedure,
  verifyProofProcedure,
} from "./zk-proof";

const FHE_SERVICE_URL = env.FHE_SERVICE_URL;
const PROOF_SESSION_TTL_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

async function checkServiceUncached(
  url: string,
  timeoutMs = 5000
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/health`, {
      signal: controller.signal,
      headers: {
        "X-Zentity-Healthcheck": "true",
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

async function checkService(url: string, timeoutMs = 5000): Promise<unknown> {
  const { unstable_cache } = await import("next/cache");
  const cachedCheck = unstable_cache(
    () => checkServiceUncached(url, timeoutMs),
    [`health-check-${url}`],
    { revalidate: 15 }
  );
  return cachedCheck();
}

const healthProcedure = publicProcedure.query(async () => {
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

  if (allHealthy) {
    prewarmVerificationKeys().catch(() => {
      // Best-effort: warm cache without impacting health response.
    });
  }

  return {
    fhe: fheHealth,
    zk,
    allHealthy,
  };
});

// ---------------------------------------------------------------------------
// Challenge / proof session
// ---------------------------------------------------------------------------

const createProofSessionProcedure = protectedProcedure
  .input(z.object({ verificationId: z.string().optional() }).optional())
  .mutation(async ({ ctx, input }) => {
    const selectedVerification = await getSelectedVerification(ctx.userId);
    const verificationId =
      input?.verificationId ?? selectedVerification?.id ?? null;
    if (!verificationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing verification context for proof session",
      });
    }

    const now = Date.now();
    const expiresAt = now + PROOF_SESSION_TTL_MS;
    const proofSessionId = crypto.randomUUID();
    const audience = resolveAudience(ctx.req);

    await createProofSession({
      id: proofSessionId,
      userId: ctx.userId,
      verificationId,
      msgSender: ctx.userId,
      audience,
      policyVersion: POLICY_VERSION,
      createdAt: now,
      expiresAt,
    });

    return {
      proofSessionId,
      verificationId,
      expiresAt: new Date(expiresAt).toISOString(),
      policyVersion: POLICY_VERSION,
    };
  });

/**
 * Creates a challenge nonce for replay-resistant proof generation.
 * The nonce must be included in the proof's public inputs and will
 * be consumed on verification (single-use).
 */
const createChallengeProcedure = protectedProcedure
  .input(
    z.object({
      circuitType: circuitTypeSchema,
      proofSessionId: z.string().uuid(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const audience = resolveAudience(ctx.req);
    const proofSession = await getProofSessionById(input.proofSessionId);
    if (!proofSession) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Unknown proof session",
      });
    }
    if (
      proofSession.userId !== ctx.userId ||
      proofSession.msgSender !== ctx.userId ||
      proofSession.audience !== audience
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Proof session context mismatch",
      });
    }
    if (proofSession.policyVersion !== POLICY_VERSION) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Proof session policy version mismatch",
      });
    }
    if (proofSession.expiresAt < Date.now() || proofSession.closedAt !== null) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Proof session is not active",
      });
    }

    const challenge = await createChallenge(input.circuitType, {
      userId: ctx.userId,
      msgSender: ctx.userId,
      audience,
      proofSessionId: input.proofSessionId,
    });
    ctx.span?.setAttribute("challenge.circuit_type", input.circuitType);
    ctx.span?.setAttribute(
      "challenge.active_count",
      await getActiveChallengeCount()
    );
    if (challenge.audience) {
      ctx.span?.setAttribute("challenge.audience", challenge.audience);
    }
    return {
      nonce: challenge.nonce,
      circuitType: challenge.circuitType,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
    };
  });

const challengeStatusProcedure = protectedProcedure.query(async () => ({
  activeChallenges: await getActiveChallengeCount(),
  supportedCircuitTypes: circuitTypeSchema.options,
  ttlMinutes: 15,
}));

// ---------------------------------------------------------------------------
// BBS+ wallet credentials (RFC-0020)
// ---------------------------------------------------------------------------

const ISSUER_DID = "did:web:zentity.xyz";
const BBS_KEY_CONTEXT = "zentity-bbs-issuer-v1";

let cachedKeyPairPromise: Promise<
  Awaited<ReturnType<typeof deriveBbsKeyPair>>
> | null = null;

function getIssuerKeyPair() {
  if (cachedKeyPairPromise) {
    return cachedKeyPairPromise;
  }

  const issuerSecret = env.BBS_ISSUER_SECRET;
  if (!issuerSecret) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "BBS issuer not configured",
    });
  }

  const seed = Buffer.from(issuerSecret, "hex");
  if (seed.length < 32) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Invalid BBS issuer secret length",
    });
  }

  cachedKeyPairPromise = deriveBbsKeyPair(seed, BBS_KEY_CONTEXT);
  return cachedKeyPairPromise;
}

const issueWalletCredentialInput = z.object({
  walletCommitment: z.string().startsWith("0x"),
  network: z.string().min(1).max(50),
  chainId: z.number().int().positive().optional(),
  tier: z.number().int().min(1).max(3),
});

const createWalletPresentationInput = z.object({
  credential: z.object({
    format: z.literal("bbs+vc"),
    credentialType: z.literal("wallet").optional(),
    issuer: z.string(),
    holder: z.string(),
    issuedAt: z.string(),
    subject: z.object({
      walletCommitment: z.string(),
      network: z.string(),
      chainId: z.number().optional(),
      verifiedAt: z.string(),
      tier: z.number(),
    }),
    signature: z.object({
      signature: z.string(),
      header: z.string().optional(),
      messageCount: z.number(),
    }),
    issuerPublicKey: z.string(),
  }),
  revealClaims: z.array(
    z.enum(WALLET_CREDENTIAL_CLAIM_ORDER as unknown as [string, ...string[]])
  ),
  verifierNonce: z.string().min(1).max(256),
});

const verifyWalletPresentationInput = z.object({
  presentation: z.object({
    format: z.literal("bbs+vp"),
    credentialType: z.literal("wallet").optional(),
    issuer: z.string(),
    proof: z.object({
      proof: z.string(),
      revealedIndices: z.array(z.number()),
      revealedMessages: z.array(z.string()),
      presentationHeader: z.string().optional(),
    }),
    revealedClaims: z.object({
      walletCommitment: z.string().optional(),
      network: z.string().optional(),
      chainId: z.number().optional(),
      verifiedAt: z.string().optional(),
      tier: z.number().optional(),
    }),
    issuerPublicKey: z.string(),
    header: z.string().optional(),
  }),
});

export const bbsRouter = router({
  /**
   * Issue a BBS+ wallet credential for identity circuit binding (RFC-0020).
   * Called during wallet authentication to bind wallet to verified identity.
   * Requires authentication.
   */
  issueWalletCredential: protectedProcedure
    .input(issueWalletCredentialInput)
    .mutation(async ({ ctx, input }) => {
      const issuerKeyPair = await getIssuerKeyPair();

      const subject = {
        walletCommitment: input.walletCommitment,
        network: input.network,
        chainId: input.chainId,
        verifiedAt: new Date().toISOString(),
        tier: input.tier,
      };

      const holderDid = `did:key:user-${ctx.userId}`;

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        ISSUER_DID,
        holderDid
      );

      return {
        credential: serializeCredential(credential),
      };
    }),

  /**
   * Create a selective disclosure presentation from a wallet credential.
   * Used for identity circuit inputs.
   * Requires authentication (holder must own the credential).
   */
  createPresentation: protectedProcedure
    .input(createWalletPresentationInput)
    .mutation(async ({ ctx, input }) => {
      const credential = deserializeCredential(
        input.credential as SerializedBbsCredential
      );

      const expectedHolderDid = `did:key:user-${ctx.userId}`;
      if (credential.holder !== expectedHolderDid) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Credential does not belong to authenticated user",
        });
      }

      const isValid = await verifyCredential(credential);
      if (!isValid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid credential signature",
        });
      }

      const presentation = await createPresentation(
        credential,
        input.revealClaims as (typeof WALLET_CREDENTIAL_CLAIM_ORDER)[number][],
        input.verifierNonce
      );

      return {
        presentation: serializePresentation(presentation),
      };
    }),

  /**
   * Verify a BBS+ wallet presentation.
   * Public endpoint - anyone can verify.
   */
  verifyPresentation: publicProcedure
    .input(verifyWalletPresentationInput)
    .mutation(async ({ input }) => {
      const presentation = deserializePresentation(
        input.presentation as SerializedBbsPresentation
      );

      const result = await verifyBbsPresentation(presentation);

      return {
        verified: result.verified,
        error: result.error,
        revealedClaims: result.verified ? presentation.revealedClaims : null,
      };
    }),

  /**
   * Get the issuer's public key.
   * Public endpoint for verifiers to cache the issuer key.
   */
  getIssuerPublicKey: publicProcedure.query(async () => {
    const issuerKeyPair = await getIssuerKeyPair();
    return {
      did: ISSUER_DID,
      publicKey: bytesToBase64(issuerKeyPair.publicKey),
    };
  }),
});

export const zkRouter = router({
  health: healthProcedure,
  verifyProof: verifyProofProcedure,
  createProofSession: createProofSessionProcedure,
  createChallenge: createChallengeProcedure,
  challengeStatus: challengeStatusProcedure,
  getChecks: getChecksProcedure,
  getProofs: getProofsProcedure,
  getSignedClaims: getSignedClaimsProcedure,
  storeProof: storeProofProcedure,
  bbs: bbsRouter,
});
