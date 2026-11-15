import type { AccountTier } from "@zentity/sdk/protocol";

import { describe, expect, it } from "vitest";

import {
  ACR_VALUES_SUPPORTED,
  buildNamespacedAssuranceClaim,
  computeAcr,
  loginMethodToAmr,
} from "../oidc-claims";

describe("computeAcr", () => {
  it.each([
    [0, "urn:zentity:assurance:tier-0"],
    [1, "urn:zentity:assurance:tier-1"],
    [2, "urn:zentity:assurance:tier-2"],
    [3, "urn:zentity:assurance:tier-3"],
  ] as [AccountTier, string][])("maps tier %d to %s", (tier, expectedUri) => {
    expect(computeAcr(tier)).toBe(expectedUri);
  });

  it("ACR_VALUES_SUPPORTED contains all tier URIs", () => {
    expect(ACR_VALUES_SUPPORTED).toHaveLength(4);
    for (const tier of [0, 1, 2, 3] as AccountTier[]) {
      expect(ACR_VALUES_SUPPORTED).toContain(computeAcr(tier));
    }
  });
});

describe("buildNamespacedAssuranceClaim", () => {
  it.each([
    [0, "http://eidas.europa.eu/LoA/low"],
    [1, "http://eidas.europa.eu/LoA/low"],
    [2, "http://eidas.europa.eu/LoA/substantial"],
    [3, "http://eidas.europa.eu/LoA/high"],
  ] as [AccountTier, string][])(
    "maps tier %d to %s for acr_eidas",
    (tier, expectedUri) => {
      expect(
        buildNamespacedAssuranceClaim({ tier }, { amr: ["pwd"] })
          .zentity_assurance.acr_eidas
      ).toBe(expectedUri);
    }
  );

  it("omits amr when the auth method cannot be normalized", () => {
    expect(buildNamespacedAssuranceClaim({ tier: 1 }, { amr: [] })).toEqual({
      zentity_assurance: {
        acr: "urn:zentity:assurance:tier-1",
        acr_eidas: "http://eidas.europa.eu/LoA/low",
      },
    });
  });
});

// R9: amr states only observed methods.
describe("loginMethodToAmr", () => {
  it("maps a passkey without observed user verification to pop + user", () => {
    expect(loginMethodToAmr("passkey")).toEqual(["pop", "user"]);
    expect(loginMethodToAmr("passkey", { userVerified: false })).toEqual([
      "pop",
      "user",
    ]);
  });

  it("maps a passkey with observed user verification to pop + user + mfa", () => {
    expect(loginMethodToAmr("passkey", { userVerified: true })).toEqual([
      "pop",
      "user",
      "mfa",
    ]);
  });

  it("maps opaque to pwd", () => {
    expect(loginMethodToAmr("opaque")).toEqual(["pwd"]);
  });

  it("maps magic-link to otp", () => {
    expect(loginMethodToAmr("magic-link")).toEqual(["otp"]);
  });

  it("maps oauth to an empty AMR set", () => {
    expect(loginMethodToAmr("oauth")).toEqual([]);
  });

  it("maps eip712 to pop", () => {
    expect(loginMethodToAmr("eip712")).toEqual(["pop"]);
  });

  it("maps credential to pwd", () => {
    expect(loginMethodToAmr("credential")).toEqual(["pwd"]);
  });

  it.each([null, undefined, "none"] as const)(
    "claims no method for %j",
    (method) => {
      expect(loginMethodToAmr(method)).toEqual([]);
    }
  );

  it("never claims a hardware-secured key", () => {
    for (const method of [
      "passkey",
      "opaque",
      "magic-link",
      "oauth",
      "eip712",
      "credential",
      "none",
    ] as const) {
      for (const userVerified of [true, false]) {
        expect(loginMethodToAmr(method, { userVerified })).not.toContain("hwk");
      }
    }
  });
});
