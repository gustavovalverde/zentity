import { describe, expect, it } from "vitest";

import { filterProofClaimsByScopes } from "../registry";

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
    const filtered = filterProofClaimsByScopes(
      proofClaims,
      ["proof:verification"],
      "userinfo"
    );

    expect(filtered).toEqual({
      verification_level: "full",
      verified: true,
      identity_bound: true,
      sybil_resistant: true,
    });
  });

  it("includes identity binding status for proof:identity umbrella scope", () => {
    const filtered = filterProofClaimsByScopes(
      proofClaims,
      ["proof:identity"],
      "userinfo"
    );

    expect(filtered.identity_bound).toBe(true);
  });

  it("excludes per-RP nullifiers from id_token and userinfo surfaces", () => {
    const claimsWithPerRpIds = {
      ...proofClaims,
      sybil_nullifier: "nullifier-abc",
      humanity_proven: true,
      rp_unique_humanity_id: "humanity-rp-id-abc",
    };

    const idToken = filterProofClaimsByScopes(
      claimsWithPerRpIds,
      [
        "proof:identity",
        "proof:sybil",
        "proof:humanity",
        "proof:humanity:rp_unique",
      ],
      "id_token"
    );
    const userinfo = filterProofClaimsByScopes(
      claimsWithPerRpIds,
      [
        "proof:identity",
        "proof:sybil",
        "proof:humanity",
        "proof:humanity:rp_unique",
      ],
      "userinfo"
    );

    expect(idToken).not.toHaveProperty("sybil_nullifier");
    expect(idToken).not.toHaveProperty("rp_unique_humanity_id");
    expect(userinfo).not.toHaveProperty("sybil_nullifier");
    expect(userinfo).not.toHaveProperty("rp_unique_humanity_id");
    // The proven boolean IS allowed in id_token/userinfo
    expect(idToken).toHaveProperty("humanity_proven", true);
    expect(userinfo).toHaveProperty("humanity_proven", true);
  });
});
