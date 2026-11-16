import type { RecoveryFactorState } from "@/lib/auth/recovery-factors";

import { describe, expect, it } from "vitest";

import {
  decideRecoveryFactorChange,
  MAGIC_LINK_REVERIFICATION_WINDOW_MS,
  PASSKEY_REVERIFICATION_WINDOW_MS,
} from "@/lib/auth/recovery-factors";

const NOW = Date.parse("2026-11-16T12:00:00Z");

function state(overrides: Partial<RecoveryFactorState> = {}) {
  return {
    email: "owner@example.com",
    emailVerified: true,
    hasPasskey: true,
    isAnonymous: false,
    magicLinkProof: null,
    passkeySignIns: [],
    ...overrides,
  } satisfies RecoveryFactorState;
}

function ago(ms: number): Date {
  return new Date(NOW - ms);
}

describe("decideRecoveryFactorChange", () => {
  it("keeps today's rules for an account without a passkey", () => {
    expect(
      decideRecoveryFactorChange(state({ hasPasskey: false }), NOW)
    ).toEqual({ allowed: true, reason: "no_passkey" });
  });

  it("lets sign-up bind the first factors of an anonymous account", () => {
    expect(
      decideRecoveryFactorChange(state({ isAnonymous: true }), NOW)
    ).toEqual({ allowed: true, reason: "sign_up" });
  });

  it("refuses a passkey account whose session has no qualifying sign-in", () => {
    expect(decideRecoveryFactorChange(state(), NOW)).toEqual({
      allowed: false,
      reason: "reverification_required",
    });
  });

  it("accepts a user-verified passkey sign-in within 5 minutes", () => {
    const signIn = {
      authenticatedAt: ago(PASSKEY_REVERIFICATION_WINDOW_MS),
      userVerified: true,
    };

    expect(
      decideRecoveryFactorChange(state({ passkeySignIns: [signIn] }), NOW)
    ).toEqual({ allowed: true, reason: "passkey_reverified" });
  });

  it("refuses a passkey sign-in older than 5 minutes", () => {
    const signIn = {
      authenticatedAt: ago(PASSKEY_REVERIFICATION_WINDOW_MS + 1000),
      userVerified: true,
    };

    expect(
      decideRecoveryFactorChange(state({ passkeySignIns: [signIn] }), NOW)
        .allowed
    ).toBe(false);
  });

  it("refuses a passkey sign-in that did not observe user verification", () => {
    const signIn = { authenticatedAt: ago(1000), userVerified: false };

    expect(
      decideRecoveryFactorChange(state({ passkeySignIns: [signIn] }), NOW)
        .allowed
    ).toBe(false);
  });

  it("accepts a magic-link sign-in to the verified, unchanged address", () => {
    const magicLinkProof = {
      email: "owner@example.com",
      expiresAt: new Date(NOW + MAGIC_LINK_REVERIFICATION_WINDOW_MS - 1000),
    };

    expect(decideRecoveryFactorChange(state({ magicLinkProof }), NOW)).toEqual({
      allowed: true,
      reason: "magic_link_reverified",
    });
  });

  it("refuses a magic-link sign-in whose window has passed", () => {
    const magicLinkProof = {
      email: "owner@example.com",
      expiresAt: new Date(NOW),
    };

    expect(
      decideRecoveryFactorChange(state({ magicLinkProof }), NOW).allowed
    ).toBe(false);
  });

  it("refuses a magic-link sign-in once the address changed", () => {
    const magicLinkProof = {
      email: "owner@example.com",
      expiresAt: new Date(NOW + 60_000),
    };

    expect(
      decideRecoveryFactorChange(
        state({ email: "other@example.com", magicLinkProof }),
        NOW
      ).allowed
    ).toBe(false);
    expect(
      decideRecoveryFactorChange(
        state({ emailVerified: false, magicLinkProof }),
        NOW
      ).allowed
    ).toBe(false);
  });
});
