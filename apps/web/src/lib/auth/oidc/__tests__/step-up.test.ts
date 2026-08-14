import type { AccountTier } from "@/lib/assurance/types";

import { describe, expect, it } from "vitest";

import {
  authenticationContextSatisfies,
  findSatisfiedAcr,
} from "@/lib/auth/oidc/step-up";

const ACR_TIER_PATTERN = /^urn:zentity:assurance:tier-(\d)$/;
const WHITESPACE = /\s+/;

function parseAcrValues(raw: string): string[] {
  return raw.split(WHITESPACE).filter(Boolean);
}

function extractTierFromAcr(acr: string): number | null {
  const match = ACR_TIER_PATTERN.exec(acr);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

describe("parseAcrValues", () => {
  it("splits space-separated values", () => {
    expect(
      parseAcrValues(
        "urn:zentity:assurance:tier-2 urn:zentity:assurance:tier-1"
      )
    ).toEqual(["urn:zentity:assurance:tier-2", "urn:zentity:assurance:tier-1"]);
  });

  it("handles single value", () => {
    expect(parseAcrValues("urn:zentity:assurance:tier-2")).toEqual([
      "urn:zentity:assurance:tier-2",
    ]);
  });

  it("filters empty strings from extra whitespace", () => {
    expect(parseAcrValues("  tier-1  tier-2  ")).toEqual(["tier-1", "tier-2"]);
  });
});

describe("extractTierFromAcr", () => {
  it.each([
    ["urn:zentity:assurance:tier-0", 0],
    ["urn:zentity:assurance:tier-1", 1],
    ["urn:zentity:assurance:tier-2", 2],
    ["urn:zentity:assurance:tier-3", 3],
  ] as const)("%s → %i", (acr, expected) => {
    expect(extractTierFromAcr(acr)).toBe(expected);
  });

  it("returns null for unrecognized URIs", () => {
    expect(extractTierFromAcr("http://eidas.europa.eu/LoA/high")).toBeNull();
    expect(extractTierFromAcr("random-string")).toBeNull();
  });
});

describe("findSatisfiedAcr", () => {
  it("returns first satisfied ACR when user tier matches exactly", () => {
    expect(
      findSatisfiedAcr("urn:zentity:assurance:tier-2", 2 as AccountTier)
    ).toBe("urn:zentity:assurance:tier-2");
  });

  it("returns first satisfied ACR when user tier exceeds request", () => {
    expect(
      findSatisfiedAcr("urn:zentity:assurance:tier-1", 3 as AccountTier)
    ).toBe("urn:zentity:assurance:tier-1");
  });

  it("returns null when user tier is insufficient", () => {
    expect(
      findSatisfiedAcr("urn:zentity:assurance:tier-2", 1 as AccountTier)
    ).toBeNull();
  });

  it("walks preference order and picks first satisfiable", () => {
    const acr = findSatisfiedAcr(
      "urn:zentity:assurance:tier-3 urn:zentity:assurance:tier-2",
      2 as AccountTier
    );
    // tier-3 not satisfied (user is 2), tier-2 satisfied → returns tier-2
    expect(acr).toBe("urn:zentity:assurance:tier-2");
  });

  it("tier-3 satisfies tier-2 in preference order", () => {
    const acr = findSatisfiedAcr(
      "urn:zentity:assurance:tier-2 urn:zentity:assurance:tier-3",
      3 as AccountTier
    );
    // tier-2 satisfied first (user is 3 >= 2)
    expect(acr).toBe("urn:zentity:assurance:tier-2");
  });

  it("returns null for empty acr_values", () => {
    expect(findSatisfiedAcr("", 3 as AccountTier)).toBeNull();
  });
});

describe("authenticationContextSatisfies", () => {
  it("accepts exact and stronger Zentity tiers", () => {
    expect(
      authenticationContextSatisfies("urn:zentity:assurance:tier-3", [
        "urn:zentity:assurance:tier-2",
      ])
    ).toBe(true);
    expect(
      authenticationContextSatisfies("urn:zentity:assurance:tier-2", [
        "urn:zentity:assurance:tier-2",
      ])
    ).toBe(true);
  });

  it("rejects weaker and foreign authentication contexts", () => {
    expect(
      authenticationContextSatisfies("urn:zentity:assurance:tier-1", [
        "urn:zentity:assurance:tier-2",
      ])
    ).toBe(false);
    expect(authenticationContextSatisfies("urn:example:loa:2", [])).toBe(false);
  });
});
