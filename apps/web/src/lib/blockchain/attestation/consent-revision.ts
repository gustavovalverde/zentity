import { getConsentRevision } from "@zentity/fhevm-contracts";

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
