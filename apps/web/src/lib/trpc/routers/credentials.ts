/**
 * Credentials Router
 *
 * Handles verifiable credential issuance for authenticated users via OIDC4VCI.
 * Only SD-JWT credentials are exposed externally; BBS+ is used internally for
 * wallet binding (RFC-0020) via the zk.bbs router.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { auth } from "@/lib/auth/auth-config";
import {
  buildProofClaims,
  PROOF_DISCLOSURE_KEYS,
} from "@/lib/auth/oidc/disclosure/claims";
import {
  canRedeemCredentialOffers,
  ensureWalletClientExists,
} from "@/lib/auth/oidc/wallet-dcr";
import { getComplianceStatus } from "@/lib/identity/verification/read-model";

import { protectedProcedure, router } from "../server";

const DEFAULT_CREDENTIAL_CONFIG_ID = "identity_verification";

/** Credential offer expiration in seconds (5 minutes) */
const OFFER_EXPIRES_IN_SECONDS = 300;

export const credentialsRouter = router({
  /**
   * Get credential status for the authenticated user.
   * Returns verification level and available credential types.
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    const [status, claims] = await Promise.all([
      getComplianceStatus(ctx.userId),
      buildProofClaims(ctx.userId),
    ]);

    // Extract which claims are verified (true values)
    const verifiedClaims = PROOF_DISCLOSURE_KEYS.filter((key) => {
      const value = claims[key];
      return value === true || (typeof value === "string" && value.length > 0);
    });

    return {
      verified: status.identity.verified,
      level: status.identity.strength,
      checks: status.policy.checks,
      humanityProven: status.humanity.proven,
      verifiedClaims,
    };
  }),

  /**
   * Create a credential offer for the authenticated user.
   * Returns an OIDC4VCI credential offer URI for wallet scanning. The offer
   * is bound to one wallet client: the built-in one, or a registered wallet
   * the user names.
   */
  createOffer: protectedProcedure
    .input(
      z
        .object({ walletClientId: z.string().trim().min(1).max(255) })
        .partial()
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      // Verify user has completed identity verification
      const status = await getComplianceStatus(ctx.userId);
      if (!status.identity.verified) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Complete identity verification before requesting credentials.",
        });
      }

      const requestedClientId = input?.walletClientId;
      if (
        requestedClientId &&
        !(await canRedeemCredentialOffers(requestedClientId))
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No wallet with this client ID can receive credentials.",
        });
      }
      const walletClientId =
        requestedClientId ?? (await ensureWalletClientExists());

      let responseData: {
        credential_offer?: Record<string, unknown>;
        credential_offer_uri?: string;
      };
      try {
        responseData = await auth.api.createCredentialOffer({
          headers: ctx.req.headers,
          body: {
            client_id: walletClientId,
            credential_configuration_id: DEFAULT_CREDENTIAL_CONFIG_ID,
            expires_in: OFFER_EXPIRES_IN_SECONDS,
          },
        });
      } catch (error) {
        ctx.log.error(
          { error: error instanceof Error ? error.message : String(error) },
          "Failed to create credential offer"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create credential offer. Please try again.",
        });
      }

      if (!responseData.credential_offer) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Invalid credential offer response.",
        });
      }

      // Build the credential offer URI for QR code
      const offerUri = responseData.credential_offer_uri
        ? `openid-credential-offer://?credential_offer_uri=${encodeURIComponent(responseData.credential_offer_uri)}`
        : `openid-credential-offer://?credential_offer=${encodeURIComponent(JSON.stringify(responseData.credential_offer))}`;

      return {
        offerUri,
        offer: responseData.credential_offer,
        expiresIn: OFFER_EXPIRES_IN_SECONDS,
      };
    }),
});
