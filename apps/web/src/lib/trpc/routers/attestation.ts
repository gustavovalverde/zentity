/**
 * Attestation Router
 *
 * Handles on-chain identity attestation across multiple blockchain networks.
 * Uses a provider-agnostic architecture supporting fhEVM and standard EVM networks.
 *
 * Security model:
 * - User must be fully verified (OCR or NFC/chip verification) to attest
 * - Backend wallet acts as registrar (signs attestation transactions)
 * - Rate limited via DB retry count (survives restarts, works across instances)
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import z from "zod";

import {
  getEnabledNetworks,
  getExplorerTxUrl,
  getNetworkById,
} from "@/lib/blockchain/networks";
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
  updateBlockchainAttestationRevoked,
  updateBlockchainAttestationSubmitted,
  updateBlockchainAttestationWallet,
} from "@/lib/db/queries/attestation";
import {
  getSelectedVerification,
  getVerificationStatus,
} from "@/lib/db/queries/identity";
import { countryCodeToNumeric } from "@/lib/identity/verification/compliance";

import { protectedProcedure, requireFeature, router } from "../server";

const RATE_LIMIT_MAX_ATTEMPTS = 5;

export const attestationRouter = router({
  networks: protectedProcedure.query(async ({ ctx }) => {
    const networks = getEnabledNetworks();
    const attestations =
      (await getBlockchainAttestationsByUserId(ctx.userId)) ?? [];

    const attestationMap = new Map(attestations.map((a) => [a.networkId, a]));

    return {
      networks: networks.map((network) => {
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
      }),
    };
  }),

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

  submit: protectedProcedure
    .use(requireFeature("attestation"))
    .input(
      z.object({
        networkId: z.string(),
        walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        forceUpdate: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [verificationStatus, verification] = await Promise.all([
        getVerificationStatus(ctx.userId),
        getSelectedVerification(ctx.userId),
      ]);

      if (!verification) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "No identity verification found. Complete OCR or NFC verification first.",
        });
      }

      const issuerCountry = verification.issuerCountry || undefined;

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

      const provider = await createProvider(input.networkId);

      const existing = await getBlockchainAttestationByUserAndNetwork(
        ctx.userId,
        input.networkId
      );

      // DB-based rate limiting
      if (existing && existing.retryCount >= RATE_LIMIT_MAX_ATTEMPTS) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many attestation attempts (${RATE_LIMIT_MAX_ATTEMPTS}). Contact support.`,
        });
      }

      const chainStatus = await provider.getAttestationStatus(
        input.walletAddress
      );

      // Already attested on-chain
      if (chainStatus.isAttested) {
        // If forceUpdate requested, revoke first then proceed to re-attest
        if (input.forceUpdate) {
          try {
            const revokeResult = await provider.revokeAttestation(
              input.walletAddress
            );
            // Wait for revocation tx to confirm
            if (revokeResult.txHash) {
              await waitForConfirmation(provider, revokeResult.txHash);
            }
            if (existing) {
              await updateBlockchainAttestationRevoked(existing.id);
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Revocation failed";
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Failed to revoke existing attestation: ${message}`,
            });
          }
          // Fall through to submit new attestation below
        } else {
          // Sync DB and return early
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
      }

      // Block if there's a pending submission
      if (existing?.status === "submitted") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Attestation already submitted. Check status to refresh.",
        });
      }

      // Create or reset attestation record
      const attestation =
        existing ??
        (await createBlockchainAttestation({
          userId: ctx.userId,
          walletAddress: input.walletAddress,
          networkId: input.networkId,
          chainId: network.chainId,
        }));

      if (existing) {
        await updateBlockchainAttestationWallet(
          attestation.id,
          input.walletAddress,
          network.chainId
        );
        if (
          attestation.status === "failed" ||
          attestation.status === "revoked"
        ) {
          await resetBlockchainAttestationForRetry(attestation.id);
        }
      }

      if (verificationStatus.birthYearOffset === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Birth year offset not available. Please re-verify your identity.",
        });
      }
      const birthYearOffset = verificationStatus.birthYearOffset;
      const countryCode = countryCodeToNumeric(issuerCountry || "");
      const complianceLevel = verificationStatus.numericLevel;

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
            code: "BAD_REQUEST",
            message: result.error || "Attestation transaction failed",
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
          code: "BAD_REQUEST",
          message: `Attestation failed: ${message}`,
        });
      }
    }),

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

      try {
        const provider = await createProvider(input.networkId);
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
        return { status: "submitted", pending: true };
      }
    }),
});

async function waitForConfirmation(
  provider: Awaited<ReturnType<typeof createProvider>>,
  txHash: string,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await provider.checkTransaction(txHash);
    if (status.confirmed) {
      return;
    }
    if (status.failed) {
      throw new Error(`Transaction reverted: ${txHash}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Transaction not confirmed after ${maxAttempts} attempts`);
}
