/**
 * Credentials Router
 *
 * Handles verifiable credential issuance for authenticated users.
 * Creates OIDC4VCI credential offers that can be scanned by any compliant wallet.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { buildVcClaims, VC_DISCLOSURE_KEYS } from "@/lib/auth/oidc/claims";
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${appUrl}/api/auth`;
}

export const credentialsRouter = router({
  /**
   * Get credential status for the authenticated user.
   * Returns verification level and available credential types.
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    const [status, claims] = await Promise.all([
      getVerificationStatus(ctx.userId),
      buildVcClaims(ctx.userId),
    ]);

    // Extract which claims are verified (true values)
    const verifiedClaims = VC_DISCLOSURE_KEYS.filter((key) => {
      const value = claims[key];
      return value === true || (typeof value === "string" && value.length > 0);
    });

    return {
      verified: status.verified,
      level: status.level,
      checks: status.checks,
      verifiedClaims,
      availableCredentials:
        status.verified || status.level !== "none"
          ? [
              {
                id: DEFAULT_CREDENTIAL_CONFIG_ID,
                name: "Zentity Identity Credential",
                description: "SD-JWT credential with selective disclosure",
                format: "dc+sd-jwt",
              },
            ]
          : [],
    };
  }),

  /**
   * Create a credential offer for the authenticated user.
   * Returns an OIDC4VCI credential offer URI for wallet scanning.
   */
  createOffer: protectedProcedure
    .input(
      z.object({
        credentialConfigurationId: z
          .string()
          .default(DEFAULT_CREDENTIAL_CONFIG_ID),
      })
    )
    .mutation(async ({ ctx, input }) => {
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

      // Create credential offer via OIDC4VCI endpoint
      // The user authenticates themselves (self-service issuance)
      // Include Origin header for better-auth CSRF protection
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
            credential_configuration_id: input.credentialConfigurationId,
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

      const offerData = (await offerResponse.json()) as {
        credential_offer?: Record<string, unknown>;
        credential_offer_uri?: string;
      };

      if (!offerData.credential_offer) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Invalid credential offer response.",
        });
      }

      // Build the credential offer URI for QR code
      // Format: openid-credential-offer://?credential_offer={encoded_offer}
      const offerUri = offerData.credential_offer_uri
        ? `openid-credential-offer://?credential_offer_uri=${encodeURIComponent(offerData.credential_offer_uri)}`
        : `openid-credential-offer://?credential_offer=${encodeURIComponent(JSON.stringify(offerData.credential_offer))}`;

      return {
        offerUri,
        offer: offerData.credential_offer,
        expiresIn: OFFER_EXPIRES_IN_SECONDS,
        credentialConfigurationId: input.credentialConfigurationId,
      };
    }),
});
