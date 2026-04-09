/**
 * Attestation Router (v2 — permit-based)
 *
 * Handles on-chain identity attestation with the EIP-712 permit model:
 * - Server signs permits (registrar authorization)
 * - Client encrypts via FHEVM SDK and submits from their own wallet
 * - Server records tx hashes and tracks confirmation
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import z from "zod";

import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import { POLICY_HASH } from "@/lib/blockchain/attestation/policy-hash";
import { computeProofSetHash } from "@/lib/blockchain/attestation/proof-set-hash";
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
  resetBlockchainAttestation,
  updateBlockchainAttestationConfirmed,
  updateBlockchainAttestationFailed,
  updateBlockchainAttestationSubmitted,
  updateBlockchainAttestationWallet,
  upsertAttestationEvidence,
} from "@/lib/db/queries/attestation";
import { getIdentityBundleByUserId } from "@/lib/db/queries/identity";
import { countryCodeToNumeric } from "@/lib/identity/verification/compliance";
import { getUnifiedVerificationModel } from "@/lib/identity/verification/unified-model";

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
        attestation: { ...attestation, explorerUrl },
      };
    }),

  /**
   * Sign an EIP-712 attestation permit.
   * Returns the permit + identity data for client-side encryption.
   */
  createPermit: protectedProcedure
    .use(requireFeature("attestation"))
    .input(
      z.object({
        networkId: z.string(),
        walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        consentScope: z
          .string()
          .regex(/^0x[0-9a-fA-F]{1,2}$/)
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const model = await getUnifiedVerificationModel(ctx.userId);

      if (!model.verificationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "No identity verification found. Complete OCR or NFC verification first.",
        });
      }

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
          message: `Network ${input.networkId} is not configured.`,
        });
      }

      const provider = await createProvider(input.networkId);

      // Rate limiting
      const existing = await getBlockchainAttestationByUserAndNetwork(
        ctx.userId,
        input.networkId
      );
      if (existing && existing.retryCount >= RATE_LIMIT_MAX_ATTEMPTS) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many attestation attempts (${RATE_LIMIT_MAX_ATTEMPTS}). Contact support.`,
        });
      }

      // Check on-chain status
      const chainStatus = await provider.getAttestationStatus(
        input.walletAddress
      );
      if (chainStatus.isAttested) {
        const attestation =
          existing ??
          (await createBlockchainAttestation({
            userId: ctx.userId,
            walletAddress: input.walletAddress,
            networkId: input.networkId,
            chainId: network.chainId,
          }));

        if (existing) {
          const walletChanged =
            existing.walletAddress.toLowerCase() !==
            input.walletAddress.toLowerCase();

          await updateBlockchainAttestationWallet(
            attestation.id,
            input.walletAddress,
            network.chainId
          );

          if (walletChanged || existing.status !== "pending") {
            await resetBlockchainAttestation(attestation.id);
          }
        }

        if (chainStatus.txHash) {
          await updateBlockchainAttestationSubmitted(
            attestation.id,
            chainStatus.txHash
          );
        }

        await updateBlockchainAttestationConfirmed(
          attestation.id,
          chainStatus.blockNumber ?? null
        );

        return {
          status: "confirmed" as const,
          alreadyAttested: true,
          txHash: chainStatus.txHash,
          explorerUrl: chainStatus.txHash
            ? getExplorerTxUrl(input.networkId, chainStatus.txHash)
            : undefined,
        };
      }

      // Block if there's a pending submission
      if (existing?.status === "submitted") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Attestation already submitted. Check status to refresh.",
        });
      }

      // Validate identity data
      if (model.compliance.birthYearOffset === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Birth year offset not available. Please re-verify your identity.",
        });
      }

      // Derive blacklist status from PEP/sanctions screening
      const bundle = await getIdentityBundleByUserId(ctx.userId);
      const isBlacklisted =
        bundle?.pepScreeningResult === "match" ||
        bundle?.sanctionsScreeningResult === "match";

      const identityData = {
        birthYearOffset: model.compliance.birthYearOffset,
        countryCode: countryCodeToNumeric(model.issuerCountry || ""),
        complianceLevel: model.compliance.numericLevel,
        isBlacklisted,
      };

      // Create or reset DB record
      const attestation =
        existing ??
        (await createBlockchainAttestation({
          userId: ctx.userId,
          walletAddress: input.walletAddress,
          networkId: input.networkId,
          chainId: network.chainId,
        }));

      if (existing) {
        const walletChanged =
          existing.walletAddress.toLowerCase() !==
          input.walletAddress.toLowerCase();

        await updateBlockchainAttestationWallet(
          attestation.id,
          input.walletAddress,
          network.chainId
        );

        if (walletChanged || attestation.status !== "pending") {
          await resetBlockchainAttestation(attestation.id);
        }
      }

      const proofSetHash =
        (await computeProofSetHash(ctx.userId, model.verificationId)) ??
        undefined;

      // Sign EIP-712 permit
      const permitResult = await provider.signPermit({
        userAddress: input.walletAddress,
        identityData,
        ...(proofSetHash ? { proofSetHash } : {}),
      });

      await upsertAttestationEvidence({
        userId: ctx.userId,
        verificationId: model.verificationId,
        policyVersion: POLICY_VERSION,
        policyHash: POLICY_HASH,
        proofSetHash,
        consentScope: input.consentScope,
      });

      return {
        permit: permitResult.permit,
        identityData: permitResult.identityData,
        networkConfig: {
          chainId: network.chainId,
          registryAddress: network.contracts.identityRegistry,
        },
      };
    }),

  /**
   * Record a client-submitted attestation transaction.
   * Called after the client encrypts and submits attestWithPermit.
   */
  recordSubmission: protectedProcedure
    .input(
      z.object({
        networkId: z.string(),
        txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const attestation = await getBlockchainAttestationByUserAndNetwork(
        ctx.userId,
        input.networkId
      );

      if (!attestation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No attestation record found. Call createPermit first.",
        });
      }

      if (attestation.status === "submitted") {
        if (attestation.txHash === input.txHash) {
          return {
            status: "submitted" as const,
            txHash: input.txHash,
            explorerUrl: getExplorerTxUrl(input.networkId, input.txHash),
          };
        }

        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Attestation submission already recorded. Refresh status instead.",
        });
      }

      if (attestation.status !== "pending") {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "No pending attestation submission. Call createPermit first.",
        });
      }

      const provider = await createProvider(input.networkId);
      const validation = await provider.validateAttestationTransaction({
        txHash: input.txHash,
        userAddress: attestation.walletAddress,
      });

      if (validation === "invalid") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Transaction hash does not match an attestation submitted from your wallet.",
        });
      }

      await updateBlockchainAttestationSubmitted(attestation.id, input.txHash);

      const explorerUrl = getExplorerTxUrl(input.networkId, input.txHash);

      return {
        status: "submitted" as const,
        txHash: input.txHash,
        explorerUrl,
        validationPending: validation === "pending_lookup",
      };
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

        if (txStatus.confirmed) {
          const chainStatus = await provider.getAttestationStatus(
            attestation.walletAddress
          );

          if (!chainStatus.isAttested) {
            const errorMessage =
              "Transaction confirmed without an active on-chain attestation";

            await updateBlockchainAttestationFailed(
              attestation.id,
              errorMessage
            );

            return { status: "failed", error: errorMessage };
          }

          await updateBlockchainAttestationConfirmed(
            attestation.id,
            txStatus.blockNumber ?? null
          );
          return { status: "confirmed", blockNumber: txStatus.blockNumber };
        }

        return { status: "submitted", pending: true };
      } catch {
        return { status: "submitted", pending: true };
      }
    }),
});
