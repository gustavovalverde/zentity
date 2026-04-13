import { describe, expect, it } from "vitest";

import { computeConsentHmac } from "@/lib/auth/oidc/disclosure/claims";

const SECRET = "test-secret-at-least-32-characters-long";

describe("computeConsentHmac", () => {
  it("produces deterministic output for same inputs", () => {
    const a = computeConsentHmac(SECRET, "u1", "c1", null, [
      "openid",
      "profile",
    ]);
    const b = computeConsentHmac(SECRET, "u1", "c1", null, [
      "openid",
      "profile",
    ]);
    expect(a).toBe(b);
  });

  it("is order-independent for scopes", () => {
    const a = computeConsentHmac(SECRET, "u1", "c1", null, [
      "openid",
      "profile",
    ]);
    const b = computeConsentHmac(SECRET, "u1", "c1", null, [
      "profile",
      "openid",
    ]);
    expect(a).toBe(b);
  });

  it("differs when userId changes", () => {
    const a = computeConsentHmac(SECRET, "u1", "c1", null, ["openid"]);
    const b = computeConsentHmac(SECRET, "u2", "c1", null, ["openid"]);
    expect(a).not.toBe(b);
  });

  it("differs when clientId changes", () => {
    const a = computeConsentHmac(SECRET, "u1", "c1", null, ["openid"]);
    const b = computeConsentHmac(SECRET, "u1", "c2", null, ["openid"]);
    expect(a).not.toBe(b);
  });

  it("differs when scopes change", () => {
    const a = computeConsentHmac(SECRET, "u1", "c1", null, ["openid"]);
    const b = computeConsentHmac(SECRET, "u1", "c1", null, [
      "openid",
      "profile",
    ]);
    expect(a).not.toBe(b);
  });

  it("differs when referenceId changes", () => {
    const a = computeConsentHmac(SECRET, "u1", "c1", null, ["openid"]);
    const b = computeConsentHmac(SECRET, "u1", "c1", "org-1", ["openid"]);
    expect(a).not.toBe(b);
  });

  it("differs when secret changes", () => {
    const a = computeConsentHmac(SECRET, "u1", "c1", null, ["openid"]);
    const b = computeConsentHmac(
      "different-secret-key-value-here!",
      "u1",
      "c1",
      null,
      ["openid"]
    );
    expect(a).not.toBe(b);
  });

  it("prevents concatenation collision via length-prefixed encoding", () => {
    // "u1" + "c12" vs "u1c" + "12" — should differ
    const a = computeConsentHmac(SECRET, "u1", "c12", null, ["openid"]);
    const b = computeConsentHmac(SECRET, "u1c", "12", null, ["openid"]);
    expect(a).not.toBe(b);
  });
});
