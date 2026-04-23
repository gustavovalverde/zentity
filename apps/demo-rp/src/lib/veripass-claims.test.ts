import { describe, expect, it } from "vitest";

import { VERIFIER_SCENARIOS } from "@/scenarios/veripass/verifier-registry";

import {
  getMissingVeripassClaims,
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

  it("reports missing canonical claims", () => {
    expect(
      getMissingVeripassClaims(
        ["verified", "verification_level", "nationality_verified"],
        ["verified", "verification_level"]
      )
    ).toEqual(["nationality_verified"]);
  });
});
