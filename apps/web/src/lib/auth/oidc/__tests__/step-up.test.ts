import type { AccountTier } from "@/lib/assurance/types";

import { describe, expect, it } from "vitest";

import {
  buildOAuthErrorUrl,
  extractTierFromAcr,
  findSatisfiedAcr,
  isMaxAgeExceeded,
  parseAcrValues,
} from "@/lib/auth/oidc/step-up";

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

describe("isMaxAgeExceeded", () => {
  it("returns true when session is older than max_age", () => {
    const tenMinutesAgo = new Date(Date.now() - 600_000).toISOString();
    expect(isMaxAgeExceeded(tenMinutesAgo, 300)).toBe(true);
  });

  it("returns false when session is within max_age", () => {
    const now = new Date().toISOString();
    expect(isMaxAgeExceeded(now, 300)).toBe(false);
  });

  it("max_age=0 always returns true (force re-auth)", () => {
    const now = new Date().toISOString();
    expect(isMaxAgeExceeded(now, 0)).toBe(true);
  });

  it("accepts Date objects", () => {
    const tenMinutesAgo = new Date(Date.now() - 600_000);
    expect(isMaxAgeExceeded(tenMinutesAgo, 300)).toBe(true);
  });
});

describe("buildOAuthErrorUrl", () => {
  it("builds redirect URL with error params", () => {
    const url = buildOAuthErrorUrl(
      "http://localhost/callback",
      "state-123",
      "interaction_required",
      "Tier mismatch"
    );
    const parsed = new URL(url);
    expect(parsed.origin).toBe("http://localhost");
    expect(parsed.pathname).toBe("/callback");
    expect(parsed.searchParams.get("error")).toBe("interaction_required");
    expect(parsed.searchParams.get("error_description")).toBe("Tier mismatch");
    expect(parsed.searchParams.get("state")).toBe("state-123");
  });

  it("omits state when undefined", () => {
    const url = buildOAuthErrorUrl(
      "http://localhost/callback",
      undefined,
      "login_required",
      "Session too old"
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.has("state")).toBe(false);
  });
});
