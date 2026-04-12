import { describe, expect, it } from "vitest";

import { resolveAttestationConsentRevision } from "../consent-revision";

const WALLET_A = "0x0000000000000000000000000000000000000001";
const WALLET_B = "0x0000000000000000000000000000000000000002";

describe("resolveAttestationConsentRevision", () => {
  it("keeps the current revision when the connected wallet changed", () => {
    expect(
      resolveAttestationConsentRevision({
        walletAddress: WALLET_B,
        attestedWalletAddress: WALLET_A,
        currentRevision: 0n,
        status: "confirmed",
        needsReAttestation: false,
      })
    ).toBe(0n);
  });

  it("keeps the current revision when re-attestation is required", () => {
    expect(
      resolveAttestationConsentRevision({
        walletAddress: WALLET_A,
        attestedWalletAddress: WALLET_A,
        currentRevision: 4n,
        status: "confirmed",
        needsReAttestation: true,
      })
    ).toBe(4n);
  });

  it("increments the revision for the currently attested wallet", () => {
    expect(
      resolveAttestationConsentRevision({
        walletAddress: WALLET_A,
        attestedWalletAddress: WALLET_A,
        currentRevision: 7n,
        status: "confirmed",
        needsReAttestation: false,
      })
    ).toBe(8n);
  });
});
