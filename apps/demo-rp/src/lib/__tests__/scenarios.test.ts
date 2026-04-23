import { describe, expect, it } from "vitest";

import { ROUTE_SCENARIOS } from "@/scenarios/route-scenario-registry";

describe("scenario structural invariants", () => {
  it("every scenario with stepUpScopes has stepUpClaimKeys", () => {
    for (const scenario of ROUTE_SCENARIOS) {
      if (scenario.stepUpScopes.length > 0) {
        expect(
          scenario.stepUpClaimKeys.length,
          `${scenario.id}: stepUpScopes set but stepUpClaimKeys empty`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("dcr.requestedScopes includes all signInScopes and stepUpScopes", () => {
    for (const scenario of ROUTE_SCENARIOS) {
      const dcrScopes = new Set(scenario.dcr.requestedScopes.split(" "));
      for (const scope of scenario.signInScopes) {
        expect(
          dcrScopes.has(scope),
          `${scenario.id}: dcr.requestedScopes missing signInScope "${scope}"`
        ).toBe(true);
      }
      for (const scope of scenario.stepUpScopes) {
        expect(
          dcrScopes.has(scope),
          `${scenario.id}: dcr.requestedScopes missing stepUpScope "${scope}"`
        ).toBe(true);
      }
    }
  });

  it("no scenario has a stepUpProviderId field", () => {
    for (const scenario of ROUTE_SCENARIOS) {
      expect(
        "stepUpProviderId" in scenario,
        `${scenario.id}: stepUpProviderId must not exist`
      ).toBe(false);
    }
  });

  it("stepUpClaimKeys use OIDC userinfo field names (not profile secret fields)", () => {
    const invalidKeys = ["given_name", "family_name"];
    for (const scenario of ROUTE_SCENARIOS) {
      for (const key of scenario.stepUpClaimKeys) {
        expect(
          invalidKeys.includes(key),
          `${scenario.id}: stepUpClaimKey "${key}" is a profile secret field, not an OIDC userinfo field`
        ).toBe(false);
      }
    }
  });
});
