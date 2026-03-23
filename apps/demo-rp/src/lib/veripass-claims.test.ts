import { describe, expect, it } from "vitest";

import { VERIFIER_SCENARIOS } from "@/data/veripass";

import {
  createVeripassDisclosureKeyMap,
  getMissingVeripassClaims,
  normalizeVeripassClaims,
  VERIPASS_ISSUER_CLAIMS,
} from "./veripass-claims";

describe("VeriPass claim contract", () => {
  it("keeps verifier scenarios aligned with issued credential claims", () => {
    for (const scenario of VERIFIER_SCENARIOS) {
      expect(
        getMissingVeripassClaims(
          scenario.requiredClaims,
          VERIPASS_ISSUER_CLAIMS
        ),
        `${scenario.name} requests claims the issuer does not mint`
      ).toEqual([]);
    }
  });

  it("normalizes legacy credential claim aliases", () => {
    expect(
      normalizeVeripassClaims({
        age_proof_verified: true,
        doc_validity_proof_verified: true,
        identity_binding_verified: true,
        nationality_proof_verified: true,
      })
    ).toEqual({
      age_verification: true,
      document_verified: true,
      identity_bound: true,
      nationality_verified: true,
    });
  });

  it("maps legacy disclosure keys back to canonical verifier claims", () => {
    const keyMap = createVeripassDisclosureKeyMap([
      "age_proof_verified",
      "doc_validity_proof_verified",
      "verified",
    ]);

    expect(Array.from(keyMap.entries())).toEqual([
      ["age_verification", "age_proof_verified"],
      ["document_verified", "doc_validity_proof_verified"],
      ["verified", "verified"],
    ]);
  });

  it("keeps legacy locally stored credentials compatible with verifier scenarios", () => {
    const legacyCredentialClaims = Array.from(
      createVeripassDisclosureKeyMap([
        "age_proof_verified",
        "chip_verified",
        "chip_verification_method",
        "doc_validity_proof_verified",
        "document_verified",
        "face_match_verified",
        "identity_binding_verified",
        "liveness_verified",
        "nationality_proof_verified",
        "policy_version",
        "verification_level",
        "verification_time",
        "verified",
      ]).keys()
    );

    for (const scenario of VERIFIER_SCENARIOS) {
      expect(
        getMissingVeripassClaims(
          scenario.requiredClaims,
          legacyCredentialClaims
        ),
        `${scenario.name} breaks for a previously issued local credential`
      ).toEqual([]);
    }
  });
});
