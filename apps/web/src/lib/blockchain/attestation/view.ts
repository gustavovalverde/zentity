/**
 * On-chain attestation view helpers.
 *
 * Pure functions that derive UI and on-chain state for the attestation
 * flow. Safe to import from both client and server contexts.
 */

import { getConsentRevision } from "@zentity/contracts";

type OnChainAttestationStatus = "attested" | "not_attested" | "unknown";

interface ResolveOnChainAttestationViewStateOptions {
  attestedWalletAddress?: string | null;
  connectedWalletAddress?: string | null;
  isCheckingOnChain: boolean;
  onChainStatus: { status: OnChainAttestationStatus } | null | undefined;
  showComplianceAccess: boolean;
}

export function resolveOnChainAttestationViewState({
  attestedWalletAddress,
  connectedWalletAddress,
  isCheckingOnChain,
  onChainStatus,
  showComplianceAccess,
}: ResolveOnChainAttestationViewStateOptions) {
  const normalizedAttestedWalletAddress = attestedWalletAddress?.toLowerCase();
  const normalizedConnectedWalletAddress =
    connectedWalletAddress?.toLowerCase();

  const walletMismatch = Boolean(
    normalizedAttestedWalletAddress &&
      normalizedConnectedWalletAddress &&
      normalizedAttestedWalletAddress !== normalizedConnectedWalletAddress
  );

  const needsReAttestation = Boolean(
    showComplianceAccess &&
      !walletMismatch &&
      onChainStatus?.status === "not_attested"
  );

  const showComplianceCard = Boolean(
    showComplianceAccess &&
      !walletMismatch &&
      !needsReAttestation &&
      !isCheckingOnChain
  );

  return {
    needsReAttestation,
    showComplianceCard,
    walletMismatch,
  };
}

interface ResolveAttestationConsentRevisionOptions {
  attestedWalletAddress?: string | null;
  currentRevision: bigint | number;
  needsReAttestation: boolean;
  status?: string | null;
  walletAddress: string;
}

export function resolveAttestationConsentRevision({
  attestedWalletAddress,
  currentRevision,
  needsReAttestation,
  status,
  walletAddress,
}: ResolveAttestationConsentRevisionOptions): bigint {
  const normalizedRevision =
    typeof currentRevision === "bigint"
      ? currentRevision
      : BigInt(currentRevision);
  const normalizedAttestedWalletAddress = attestedWalletAddress?.toLowerCase();

  const isCurrentWalletAttested =
    status === "confirmed" &&
    !needsReAttestation &&
    Boolean(normalizedAttestedWalletAddress) &&
    normalizedAttestedWalletAddress === walletAddress.toLowerCase();

  return getConsentRevision(
    normalizedRevision,
    isCurrentWalletAttested
  ) as bigint;
}
