/**
 * Credentials Router
 *
 * Handles verifiable credential issuance for authenticated users via OIDC4VCI.
 * Only SD-JWT credentials are exposed externally; BBS+ is used internally for
 * wallet binding (RFC-0020) via the crypto.bbs router.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  buildProofClaims,
  PROOF_DISCLOSURE_KEYS,
} from "@/lib/auth/oidc/claims";
import { getVerificationStatus } from "@/lib/db/queries/identity";

import { protectedProcedure, router } from "../server";

/** Default credential configuration for Zentity identity credentials */
const DEFAULT_CREDENTIAL_CONFIG_ID = "zentity_identity";

/** Wallet client ID for dashboard-initiated issuance (must match OIDC4VCI plugin's defaultWalletClientId) */
const WALLET_CLIENT_ID =
  process.env.OIDC4VCI_WALLET_CLIENT_ID || "zentity-wallet";

/** Credential offer expiration in seconds (5 minutes) */
const OFFER_EXPIRES_IN_SECONDS = 300;

function getAuthBaseUrl(): string {
  const baseUrl =
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  return `${baseUrl}/api/auth`;
}

export const credentialsRouter = router({
  /**
   * Get credential status for the authenticated user.
   * Returns verification level and available credential types.
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    const [status, claims] = await Promise.all([
      getVerificationStatus(ctx.userId),
      buildProofClaims(ctx.userId),
    ]);

    // Extract which claims are verified (true values)
    const verifiedClaims = PROOF_DISCLOSURE_KEYS.filter((key) => {
      const value = claims[key];
      return value === true || (typeof value === "string" && value.length > 0);
    });

    return {
      verified: status.verified,
      level: status.level,
      checks: status.checks,
      verifiedClaims,
    };
  }),

  /**
   * Create a credential offer for the authenticated user.
   * Returns an OIDC4VCI credential offer URI for wallet scanning.
   */
  createOffer: protectedProcedure
    .input(z.object({}).optional())
    .mutation(async ({ ctx }) => {
      // Verify user has completed identity verification
      const status = await getVerificationStatus(ctx.userId);
      if (!status.verified && status.level === "none") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Complete identity verification before requesting credentials.",
        });
      }

      const authBaseUrl = getAuthBaseUrl();
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

      const offerResponse = await fetch(
        `${authBaseUrl}/oidc4vci/credential-offer`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: ctx.req.headers.get("cookie") || "",
            Origin: ctx.req.headers.get("origin") || appUrl,
          },
          body: JSON.stringify({
            client_id: WALLET_CLIENT_ID,
            userId: ctx.userId,
            credential_configuration_id: DEFAULT_CREDENTIAL_CONFIG_ID,
          }),
        }
      );

      if (!offerResponse.ok) {
        const errorText = await offerResponse.text();
        ctx.log.error(
          { status: offerResponse.status, error: errorText },
          "Failed to create credential offer"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create credential offer. Please try again.",
        });
      }

      const responseData = (await offerResponse.json()) as {
        credential_offer?: Record<string, unknown>;
        credential_offer_uri?: string;
      };

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
