/**
 * BBS+ Wallet Credentials Router (RFC-0020)
 *
 * tRPC procedures for wallet identity credentials:
 * - issueWalletCredential: Issue wallet binding credential during wallet auth
 * - createPresentation: Derive selective disclosure presentation for identity circuit
 * - verifyPresentation: Verify a presentation (public)
 * - getIssuerPublicKey: Get issuer public key for verification
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

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
import { bytesToBase64 } from "@/lib/utils/base64";

import { protectedProcedure, publicProcedure, router } from "../../server";

const ISSUER_DID = "did:web:zentity.xyz";
const BBS_KEY_CONTEXT = "zentity-bbs-issuer-v1";

// Module-level cache for expensive BLS12-381 keypair derivation
let cachedKeyPairPromise: Promise<
  Awaited<ReturnType<typeof deriveBbsKeyPair>>
> | null = null;

/**
 * Get issuer keypair with module-level caching.
 * BLS12-381 derivation is expensive; cache the promise to avoid re-derivation.
 */
function getIssuerKeyPair() {
  if (cachedKeyPairPromise) {
    return cachedKeyPairPromise;
  }

  const issuerSecret = process.env.BBS_ISSUER_SECRET;
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

      // Verify holder owns this credential
      const expectedHolderDid = `did:key:user-${ctx.userId}`;
      if (credential.holder !== expectedHolderDid) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Credential does not belong to authenticated user",
        });
      }

      // Verify credential is valid before deriving proof
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
