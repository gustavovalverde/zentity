import { describe, expect, it } from "vitest";

import {
  formatCapabilityName,
  formatConstraints,
  formatGrantSource,
  formatHostTier,
  formatUsageSummary,
} from "./display";

describe("formatCapabilityName", () => {
  it("returns human label for known capabilities", () => {
    expect(formatCapabilityName("whoami")).toBe("View basic account info");
    expect(formatCapabilityName("check_compliance")).toBe(
      "Check verification status"
    );
    expect(formatCapabilityName("my_proofs")).toBe("View verification proofs");
    expect(formatCapabilityName("my_profile")).toBe(
      "Read personal information"
    );
    expect(formatCapabilityName("purchase")).toBe("Make purchases");
  });

  it("passes through unknown capabilities", () => {
    expect(formatCapabilityName("custom_action")).toBe("custom_action");
  });
});

describe("formatGrantSource", () => {
  it("returns human labels for known sources", () => {
    expect(formatGrantSource("host_policy")).toBe("Default");
    expect(formatGrantSource("session_elevation")).toBe("Requested");
    expect(formatGrantSource("session_once")).toBe("One-time");
  });

  it("passes through unknown sources", () => {
    expect(formatGrantSource("manual")).toBe("manual");
  });
});

describe("formatHostTier", () => {
  it("returns human labels", () => {
    expect(formatHostTier("attested")).toBe("Verified");
    expect(formatHostTier("unverified")).toBe("Unverified");
  });

  it("passes through unknown tiers", () => {
    expect(formatHostTier("self-declared")).toBe("self-declared");
  });
});

describe("formatConstraints", () => {
  it("returns null for null/undefined/empty", () => {
    expect(formatConstraints(null)).toBeNull();
    expect(formatConstraints(undefined)).toBeNull();
    expect(formatConstraints([])).toBeNull();
  });

  it("formats max operator", () => {
    expect(
      formatConstraints([{ field: "amount", op: "max", value: 100 }])
    ).toBe("Up to 100 per action");
  });

  it("formats min operator", () => {
    expect(formatConstraints([{ field: "amount", op: "min", value: 10 }])).toBe(
      "At least 10"
    );
  });

  it("formats eq operator", () => {
    expect(
      formatConstraints([{ field: "region", op: "eq", value: "EU" }])
    ).toBe("region is EU");
  });

  it("formats in operator", () => {
    expect(
      formatConstraints([
        { field: "currency", op: "in", values: ["USD", "EUR"] },
      ])
    ).toBe("currency in USD, EUR");
  });

  it("formats not_in operator", () => {
    expect(
      formatConstraints([
        { field: "country", op: "not_in", values: ["RU", "KP"] },
      ])
    ).toBe("country not in RU, KP");
  });

  it("joins multiple constraints with semicolons", () => {
    const result = formatConstraints([
      { field: "amount", op: "max", value: 100 },
      { field: "currency", op: "eq", value: "USD" },
    ]);
    expect(result).toBe("Up to 100 per action; currency is USD");
  });

  it("parses JSON strings", () => {
    const json = JSON.stringify([{ field: "amount", op: "max", value: 50 }]);
    expect(formatConstraints(json)).toBe("Up to 50 per action");
  });

  it("returns null for invalid JSON", () => {
    expect(formatConstraints("not-json")).toBeNull();
  });
});

describe("formatUsageSummary", () => {
  it("formats count without limit", () => {
    expect(formatUsageSummary(5)).toBe("5 actions today");
    expect(formatUsageSummary(1)).toBe("1 action today");
    expect(formatUsageSummary(0)).toBe("0 actions today");
  });

  it("formats count with daily limit", () => {
    expect(formatUsageSummary(5, 50)).toBe("5 of 50 daily actions");
  });

  it("formats count with amount limit", () => {
    expect(formatUsageSummary(3, null, 100)).toBe(
      "3 actions today · $100 daily limit"
    );
  });

  it("formats count with both limits", () => {
    expect(formatUsageSummary(3, 50, 100)).toBe(
      "3 of 50 daily actions · $100 daily limit"
    );
  });
});
