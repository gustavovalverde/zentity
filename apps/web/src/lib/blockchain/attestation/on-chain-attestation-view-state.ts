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
