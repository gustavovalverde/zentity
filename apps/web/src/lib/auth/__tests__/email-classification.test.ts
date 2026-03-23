import { describe, expect, it } from "vitest";

import { isSyntheticEmail } from "../email-classification";

describe("isSyntheticEmail", () => {
  it("returns true for anonymous placeholder emails", () => {
    expect(isSyntheticEmail("temp-abc123@anon.zentity.app")).toBe(true);
  });

  it("returns true for wallet-derived emails", () => {
    expect(isSyntheticEmail("a1b2c3d4@wallet.zentity.app")).toBe(true);
  });

  it("returns false for real email addresses", () => {
    expect(isSyntheticEmail("alice@gmail.com")).toBe(false);
    expect(isSyntheticEmail("user@example.com")).toBe(false);
  });

  it("returns false for emails with synthetic-like substrings in local part", () => {
    expect(isSyntheticEmail("anon.zentity.app@gmail.com")).toBe(false);
    expect(isSyntheticEmail("wallet.zentity.app@example.com")).toBe(false);
  });

  it("returns false for empty or malformed strings", () => {
    expect(isSyntheticEmail("")).toBe(false);
    expect(isSyntheticEmail("no-at-sign")).toBe(false);
  });
});
