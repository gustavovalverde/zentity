import { describe, expect, it } from "vitest";

import { filterProofClaimsByScopes } from "../proof-scopes";

describe("proof scopes", () => {
  const proofClaims = {
    verification_level: "full",
    verified: true,
    identity_bound: true,
    sybil_resistant: true,
    age_verification: true,
    document_verified: true,
    liveness_verified: true,
    face_match_verified: true,
    nationality_verified: true,
    nationality_group: "GLOBAL",
    policy_version: "policy-1",
    issuer_id: "issuer-1",
    verification_time: "2026-01-02T00:00:00.000Z",
    attestation_expires_at: "2030-01-01T00:00:00.000Z",
  } as const;

  it("includes identity binding status in proof:verification", () => {
    const filtered = filterProofClaimsByScopes(proofClaims, [
      "proof:verification",
    ]);

    expect(filtered).toEqual({
      verification_level: "full",
      verified: true,
      identity_bound: true,
      sybil_resistant: true,
    });
  });

  it("includes identity binding status for proof:identity umbrella scope", () => {
    const filtered = filterProofClaimsByScopes(proofClaims, ["proof:identity"]);

    expect(filtered.identity_bound).toBe(true);
  });
});
