import { describe, expect, it } from "vitest";

import { SCENARIOS } from "../scenarios";

describe("scenario structural invariants", () => {
  it("every scenario with stepUpScopes has stepUpClaimKeys", () => {
    for (const [id, scenario] of Object.entries(SCENARIOS)) {
      if (scenario.stepUpScopes.length > 0) {
        expect(
          scenario.stepUpClaimKeys.length,
          `${id}: stepUpScopes set but stepUpClaimKeys empty`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("dcr.defaultScopes includes all signInScopes and stepUpScopes", () => {
    for (const [id, scenario] of Object.entries(SCENARIOS)) {
      const dcrScopes = new Set(scenario.dcr.defaultScopes.split(" "));
      for (const scope of scenario.signInScopes) {
        expect(
          dcrScopes.has(scope),
          `${id}: dcr.defaultScopes missing signInScope "${scope}"`
        ).toBe(true);
      }
      for (const scope of scenario.stepUpScopes) {
        expect(
          dcrScopes.has(scope),
          `${id}: dcr.defaultScopes missing stepUpScope "${scope}"`
        ).toBe(true);
      }
    }
  });

  it("no scenario has a stepUpProviderId field", () => {
    for (const [id, scenario] of Object.entries(SCENARIOS)) {
      expect(
        "stepUpProviderId" in scenario,
        `${id}: stepUpProviderId must not exist`
      ).toBe(false);
    }
  });

  it("stepUpClaimKeys use OIDC userinfo field names (not profile secret fields)", () => {
    const invalidKeys = ["given_name", "family_name"];
    for (const [id, scenario] of Object.entries(SCENARIOS)) {
      for (const key of scenario.stepUpClaimKeys) {
        expect(
          invalidKeys.includes(key),
          `${id}: stepUpClaimKey "${key}" is a profile secret field, not an OIDC userinfo field`
        ).toBe(false);
      }
    }
  });
});
