import { describe, expect, it } from "vitest";

import { resolveOnChainAttestationViewState } from "../view";

const WALLET_A = "0x0000000000000000000000000000000000000001";
const WALLET_B = "0x0000000000000000000000000000000000000002";

describe("resolveOnChainAttestationViewState", () => {
  it("shows compliance access for a confirmed wallet with an attested status", () => {
    expect(
      resolveOnChainAttestationViewState({
        attestedWalletAddress: WALLET_A,
        connectedWalletAddress: WALLET_A,
        isCheckingOnChain: false,
        onChainStatus: { status: "attested" },
        showComplianceAccess: true,
      })
    ).toEqual({
      needsReAttestation: false,
      showComplianceCard: true,
      walletMismatch: false,
    });
  });

  it("requires re-attestation when the confirmed wallet is no longer attested", () => {
    expect(
      resolveOnChainAttestationViewState({
        attestedWalletAddress: WALLET_A,
        connectedWalletAddress: WALLET_A,
        isCheckingOnChain: false,
        onChainStatus: { status: "not_attested" },
        showComplianceAccess: true,
      })
    ).toEqual({
      needsReAttestation: true,
      showComplianceCard: false,
      walletMismatch: false,
    });
  });

  it("keeps wallet mismatch separate from re-attestation", () => {
    expect(
      resolveOnChainAttestationViewState({
        attestedWalletAddress: WALLET_A,
        connectedWalletAddress: WALLET_B,
        isCheckingOnChain: false,
        onChainStatus: { status: "attested" },
        showComplianceAccess: true,
      })
    ).toEqual({
      needsReAttestation: false,
      showComplianceCard: false,
      walletMismatch: true,
    });
  });

  it("does not mark the attestation revoked when chain status is unknown", () => {
    expect(
      resolveOnChainAttestationViewState({
        attestedWalletAddress: WALLET_A,
        connectedWalletAddress: WALLET_A,
        isCheckingOnChain: false,
        onChainStatus: { status: "unknown" },
        showComplianceAccess: true,
      })
    ).toEqual({
      needsReAttestation: false,
      showComplianceCard: true,
      walletMismatch: false,
    });
  });
});
