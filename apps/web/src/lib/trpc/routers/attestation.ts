/**
 * Attestation Router
 *
 * Handles on-chain identity attestation across multiple blockchain networks.
 * Uses a provider-agnostic architecture supporting fhEVM and standard EVM networks.
 *
 * Key flows:
 * - List available networks with user's attestation status on each
 * - Submit attestation to a specific network (server signs as registrar)
 * - Refresh pending attestation status (check tx confirmation)
 *
 * Security model:
 * - User must be fully verified (document + liveness + face match) to attest
 * - Backend wallet acts as registrar (signs attestation transactions)
 * - Rate limited to prevent spam (3 attempts per hour per network)
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import z from "zod";

import {
  getEnabledNetworks,
  getExplorerTxUrl,
  getNetworkById,
  isDemoMode,
} from "@/lib/blockchain/config/networks";
import {
  canCreateProvider,
  createProvider,
} from "@/lib/blockchain/providers/factory";
import {
  createBlockchainAttestation,
  getBlockchainAttestationByUserAndNetwork,
  getBlockchainAttestationsByUserId,
  resetBlockchainAttestationForRetry,
  updateBlockchainAttestationConfirmed,
  updateBlockchainAttestationFailed,
  updateBlockchainAttestationSubmitted,
  updateBlockchainAttestationWallet,
} from "@/lib/db/queries/attestation";
import {
  getSelectedIdentityDocumentByUserId,
  getVerificationStatus,
} from "@/lib/db/queries/identity";
import {
  countryCodeToNumeric,
  getComplianceLevel,
} from "@/lib/identity/compliance";

import { protectedProcedure, router } from "../server";

// Rate limiting: max 3 attestation attempts per hour per network
const RATE_LIMIT_MAX_ATTEMPTS = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Track recent attempts in memory (simple implementation)
// In production, use Redis or database for distributed rate limiting
const attemptTracker = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string, networkId: string): boolean {
  const key = `${userId}:${networkId}`;
  const now = Date.now();
  const entry = attemptTracker.get(key);

  if (!entry || now > entry.resetAt) {
    attemptTracker.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    return false;
  }

  entry.count++;
  return true;
}

// countryCodeToNumeric / getComplianceLevel moved to lib/identity/compliance

export const attestationRouter = router({
  /**
   * List all enabled networks with user's attestation status on each.
   * Used to show network selector UI.
   * Returns demo flag to indicate if running in demo mode.
   */
  networks: protectedProcedure.query(async ({ ctx }) => {
    const networks = getEnabledNetworks();
    const isDemo = isDemoMode();

    // In demo mode, skip DB lookup (no real attestations)
    const attestations = isDemo
      ? []
      : ((await getBlockchainAttestationsByUserId(ctx.userId)) ?? []);

    // Map attestations by network ID for quick lookup
    const attestationMap = new Map(attestations.map((a) => [a.networkId, a]));

    const mappedNetworks = networks.map((network) => {
      const attestation = attestationMap.get(network.id);
      const explorerUrl = attestation?.txHash
        ? getExplorerTxUrl(network.id, attestation.txHash)
        : undefined;

      return {
        id: network.id,
        name: network.name,
        chainId: network.chainId,
        type: network.type,
        features: network.features,
        explorer: network.explorer,
        // Contract address for client-side reads (public info)
        identityRegistry: network.contracts.identityRegistry || null,
        complianceRules: network.contracts.complianceRules || null,
        attestation: attestation
          ? {
              id: attestation.id,
              status: attestation.status,
              txHash: attestation.txHash,
              blockNumber: attestation.blockNumber,
              confirmedAt: attestation.confirmedAt,
              errorMessage: attestation.errorMessage,
              explorerUrl,
              walletAddress: attestation.walletAddress,
            }
          : null,
      };
    });

    return {
      networks: mappedNetworks,
      demo: isDemo,
    };
  }),

  /**
   * Get attestation status for a specific network.
   */
  status: protectedProcedure
    .input(z.object({ networkId: z.string() }))
    .query(async ({ ctx, input }) => {
      const attestation = await getBlockchainAttestationByUserAndNetwork(
        ctx.userId,
        input.networkId
      );

      if (!attestation) {
        return { attested: false, attestation: null };
      }

      const explorerUrl = attestation.txHash
        ? getExplorerTxUrl(input.networkId, attestation.txHash)
        : undefined;

      return {
        attested: attestation.status === "confirmed",
        attestation: {
          ...attestation,
          explorerUrl,
        },
      };
    }),

  /**
   * Submit attestation to a specific network.
   *
   * Requirements:
   * - User must be fully verified
   * - Network must be enabled and provider available
   * - No existing confirmed attestation on this network
   * - Rate limit not exceeded
   *
   * In demo mode, simulates a successful submission.
   */
  submit: protectedProcedure
    .input(
      z.object({
        networkId: z.string(),
        walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        birthYearOffset: z.number().int().min(0).max(255),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Demo mode: simulate successful attestation
      if (isDemoMode()) {
        // Simulate network delay (1-2 seconds)
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 + Math.random() * 1000)
        );

        // Generate mock transaction hash
        const mockTxHash =
          `0xdemo${Date.now().toString(16)}${"0".repeat(40)}`.slice(0, 66);

        return {
          success: true,
          status: "confirmed" as const,
          txHash: mockTxHash,
          explorerUrl: `https://sepolia.etherscan.io/tx/${mockTxHash}`,
          demo: true,
        };
      }

      // Check verification status
      const verificationStatus = await getVerificationStatus(ctx.userId);
      if (!verificationStatus?.verified) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Complete identity verification before attesting on-chain",
        });
      }

      // Get latest identity document for attestation data
      const identityDocument = await getSelectedIdentityDocumentByUserId(
        ctx.userId
      );
      if (!identityDocument) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Identity document not found",
        });
      }

      // Check network availability
      const network = getNetworkById(input.networkId);
      if (!network?.enabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Network ${input.networkId} is not available`,
        });
      }

      if (!canCreateProvider(input.networkId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Network ${input.networkId} is not configured. Check contract addresses.`,
        });
      }

      const provider = createProvider(input.networkId);

      // Check for existing attestation (DB)
      const existing = await getBlockchainAttestationByUserAndNetwork(
        ctx.userId,
        input.networkId
      );

      // If on-chain already attested, sync DB and return early (no re-attest).
      const chainStatus = await provider.getAttestationStatus(
        input.walletAddress
      );
      if (chainStatus.isAttested) {
        let attestation = existing;
        if (attestation) {
          await updateBlockchainAttestationWallet(
            attestation.id,
            input.walletAddress,
            network.chainId
          );
        } else {
          attestation = await createBlockchainAttestation({
            userId: ctx.userId,
            walletAddress: input.walletAddress,
            networkId: input.networkId,
            chainId: network.chainId,
          });
        }

        if (attestation.status !== "confirmed") {
          await updateBlockchainAttestationConfirmed(
            attestation.id,
            chainStatus.blockNumber ?? null
          );
        }

        const explorerUrl = chainStatus.txHash
          ? getExplorerTxUrl(input.networkId, chainStatus.txHash)
          : undefined;

        return {
          success: true,
          status: "confirmed" as const,
          txHash: chainStatus.txHash,
          explorerUrl,
        };
      }

      // Block if there's a pending submission
      if (existing?.status === "submitted") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Attestation already submitted. Check status to refresh.",
        });
      }

      // Rate limit check
      if (!checkRateLimit(ctx.userId, input.networkId)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Rate limit exceeded. Try again in an hour.",
        });
      }

      // Create or reset attestation record
      let attestation = existing;
      if (attestation) {
        // Sync wallet/chain for re-attestation (may have changed)
        await updateBlockchainAttestationWallet(
          attestation.id,
          input.walletAddress,
          network.chainId
        );
        // Reset status if failed
        if (attestation.status === "failed") {
          await resetBlockchainAttestationForRetry(attestation.id);
        }
      } else {
        attestation = await createBlockchainAttestation({
          userId: ctx.userId,
          walletAddress: input.walletAddress,
          networkId: input.networkId,
          chainId: network.chainId,
        });
      }

      // Extract identity data for attestation
      const birthYearOffset = input.birthYearOffset;
      if (
        !Number.isInteger(birthYearOffset) ||
        birthYearOffset < 0 ||
        birthYearOffset > 255
      ) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Invalid birth year offset in identity proof",
        });
      }
      const countryCode = countryCodeToNumeric(
        identityDocument.issuerCountry || ""
      );
      const complianceLevel = getComplianceLevel(verificationStatus);

      // Submit attestation via provider
      try {
        const result = await provider.submitAttestation({
          userAddress: input.walletAddress,
          identityData: {
            birthYearOffset,
            countryCode,
            complianceLevel,
            isBlacklisted: false,
          },
        });

        if (result.status === "failed") {
          await updateBlockchainAttestationFailed(
            attestation.id,
            result.error || "Unknown error"
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: result.error || "Attestation failed",
          });
        }

        if (result.txHash) {
          await updateBlockchainAttestationSubmitted(
            attestation.id,
            result.txHash
          );
        }

        const explorerUrl = result.txHash
          ? getExplorerTxUrl(input.networkId, result.txHash)
          : undefined;

        return {
          success: true,
          status: "submitted",
          txHash: result.txHash,
          explorerUrl,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        const message =
          error instanceof Error ? error.message : "Unknown error";
        await updateBlockchainAttestationFailed(attestation.id, message);

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Attestation failed: ${message}`,
        });
      }
    }),

  /**
   * Refresh pending attestation status by checking transaction confirmation.
   */
  refresh: protectedProcedure
    .input(z.object({ networkId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const attestation = await getBlockchainAttestationByUserAndNetwork(
        ctx.userId,
        input.networkId
      );

      if (!attestation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No attestation found for this network",
        });
      }

      if (attestation.status === "confirmed") {
        return { status: "confirmed", blockNumber: attestation.blockNumber };
      }

      if (attestation.status !== "submitted" || !attestation.txHash) {
        return { status: attestation.status };
      }

      // Check transaction status
      try {
        const provider = createProvider(input.networkId);
        const txStatus = await provider.checkTransaction(attestation.txHash);

        if (txStatus.confirmed && txStatus.blockNumber) {
          await updateBlockchainAttestationConfirmed(
            attestation.id,
            txStatus.blockNumber
          );
          return { status: "confirmed", blockNumber: txStatus.blockNumber };
        }

        return { status: "submitted", pending: true };
      } catch {
        // Transaction check failed, might still be pending
        return { status: "submitted", pending: true };
      }
    }),

  /**
   * Retry a failed attestation.
   */
  retry: protectedProcedure
    .input(z.object({ networkId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const attestation = await getBlockchainAttestationByUserAndNetwork(
        ctx.userId,
        input.networkId
      );

      if (!attestation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No attestation found for this network",
        });
      }

      if (attestation.status !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only retry failed attestations",
        });
      }

      // Reset and submit again
      await resetBlockchainAttestationForRetry(attestation.id);

      // Re-use submit logic by calling the mutation with same wallet
      // For simplicity, just return and let client call submit again
      return {
        reset: true,
        message: "Attestation reset. Call submit to retry.",
      };
    }),
});
