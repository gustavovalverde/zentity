import type {
  RecoveryFactorChange,
  RecoveryFactorState,
} from "@/lib/auth/recovery-factors";

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_RECOVERY_WINDOW_MS,
  decideRecoveryFactorChange,
  heldRecoveryProofs,
  PASSKEY_REVERIFICATION_WINDOW_MS,
  RECOVERY_KEY_REVERIFICATION_WINDOW_MS,
  SETTLED_FACTOR_AGE_MS,
} from "@/lib/auth/recovery-factors";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function ago(ms: number): Date {
  return new Date(NOW - ms);
}

const SETTLED = ago(8 * DAY_MS);
const RECENT = ago(6 * DAY_MS);

function state(overrides: Partial<RecoveryFactorState> = {}) {
  return {
    email: "owner@example.com",
    emailVerified: true,
    factors: {
      passwordSetAt: null,
      passwordSetMethod: null,
      recoveryKey: false,
      walletLinkedAt: null,
    },
    hasPasskey: true,
    isAnonymous: false,
    magicLinkProof: null,
    recoveryAddedPasskey: false,
    recoveryKeyProof: null,
    signIns: [],
    ...overrides,
  } satisfies RecoveryFactorState;
}

/** Proofs this session holds, `age` ago. */
function proofs(
  kinds: ("magic_link" | "password" | "recovery_key" | "wallet")[],
  age = 60_000
): Partial<RecoveryFactorState> {
  const expiresAt = new Date(NOW - age + ACCOUNT_RECOVERY_WINDOW_MS);
  const signIns: RecoveryFactorState["signIns"] = [];
  if (kinds.includes("password")) {
    signIns.push({
      authenticatedAt: ago(age),
      method: "opaque",
      userVerified: false,
    });
  }
  if (kinds.includes("wallet")) {
    signIns.push({
      authenticatedAt: ago(age),
      method: "eip712",
      userVerified: false,
    });
  }
  return {
    magicLinkProof: kinds.includes("magic_link")
      ? { email: "owner@example.com", expiresAt }
      : null,
    recoveryKeyProof: kinds.includes("recovery_key") ? { expiresAt } : null,
    signIns,
  };
}

const ALL_FACTORS: RecoveryFactorState["factors"] = {
  passwordSetAt: SETTLED,
  passwordSetMethod: "sign_up",
  recoveryKey: true,
  walletLinkedAt: SETTLED,
};

function decide(
  overrides: Partial<RecoveryFactorState>,
  change: RecoveryFactorChange = "passkey_enrollment"
) {
  return decideRecoveryFactorChange(state(overrides), change, NOW);
}

describe("decideRecoveryFactorChange", () => {
  it("keeps today's rules for an account without a passkey", () => {
    expect(decide({ hasPasskey: false })).toEqual({
      allowed: true,
      reason: "no_passkey",
    });
  });

  it("lets sign-up bind the first factors of an anonymous account", () => {
    expect(decide({ isAnonymous: true })).toEqual({
      allowed: true,
      reason: "sign_up",
    });
  });

  it("refuses a passkey account whose session has no qualifying sign-in", () => {
    expect(decide({ factors: ALL_FACTORS })).toEqual({
      allowed: false,
      reason: "reverification_required",
    });
  });

  describe("a passkey sign-in", () => {
    const signIn = (age: number, userVerified = true) => ({
      signIns: [
        { authenticatedAt: ago(age), method: "passkey" as const, userVerified },
      ],
    });

    it("counts within 5 minutes when it verified the user", () => {
      expect(decide(signIn(PASSKEY_REVERIFICATION_WINDOW_MS))).toEqual({
        allowed: true,
        reason: "passkey_reverified",
      });
      expect(
        decide(signIn(PASSKEY_REVERIFICATION_WINDOW_MS + 1000)).allowed
      ).toBe(false);
    });

    it("does not count without user verification", () => {
      expect(decide(signIn(1000, false)).allowed).toBe(false);
    });

    it("counts for 15 minutes toward a recovery key change only", () => {
      const tenMinutes = signIn(10 * 60 * 1000);
      expect(decide(tenMinutes, "recovery_key")).toEqual({
        allowed: true,
        reason: "passkey_reverified",
      });
      expect(decide(tenMinutes, "email").allowed).toBe(false);
      expect(
        decide(
          signIn(RECOVERY_KEY_REVERIFICATION_WINDOW_MS + 1000),
          "recovery_key"
        ).allowed
      ).toBe(false);
    });
  });

  describe("an account recovery", () => {
    it.each([
      [["recovery_key", "password"]],
      [["recovery_key", "wallet"]],
      [["magic_link", "recovery_key"]],
      [["magic_link", "password"]],
      [["magic_link", "wallet"]],
    ] as const)("accepts %j within 10 minutes", (kinds) => {
      expect(decide({ factors: ALL_FACTORS, ...proofs([...kinds]) })).toEqual({
        allowed: true,
        reason: "account_recovery",
      });
      expect(
        decide({
          factors: ALL_FACTORS,
          ...proofs([...kinds], ACCOUNT_RECOVERY_WINDOW_MS + 1000),
        }).allowed
      ).toBe(false);
    });

    it.each([
      [["magic_link"]],
      [["recovery_key"]],
      [["password"]],
      [["wallet"]],
      [["password", "wallet"]],
    ] as const)("refuses %j", (kinds) => {
      expect(
        decide({ factors: ALL_FACTORS, ...proofs([...kinds]) }).allowed
      ).toBe(false);
    });

    it.each([
      "sign_up",
      "no_passkey",
      "passkey_reverified",
      "account_recovery",
    ] as const)("counts a password set through %s at once", (method) => {
      expect(
        decide({
          factors: {
            ...ALL_FACTORS,
            passwordSetAt: ago(1000),
            passwordSetMethod: method,
          },
          ...proofs(["magic_link", "password"]),
        }).allowed
      ).toBe(true);
    });

    it.each(["password_reset", "email_only_recovery"] as const)(
      "never counts a password a mailbox set through %s",
      (method) => {
        expect(
          decide({
            factors: {
              ...ALL_FACTORS,
              passwordSetAt: ago(10 * SETTLED_FACTOR_AGE_MS),
              passwordSetMethod: method,
            },
            ...proofs(["magic_link", "password"]),
          }).allowed
        ).toBe(false);
      }
    );

    it("counts a password set before its method was recorded once it is 7 days old", () => {
      const recovery = proofs(["magic_link", "password"]);
      const unrecorded = (passwordSetAt: Date) => ({
        ...ALL_FACTORS,
        passwordSetAt,
        passwordSetMethod: null,
      });

      expect(decide({ factors: unrecorded(RECENT), ...recovery }).allowed).toBe(
        false
      );
      expect(
        decide({
          factors: unrecorded(ago(SETTLED_FACTOR_AGE_MS + 1000)),
          ...recovery,
        }).allowed
      ).toBe(true);
    });

    it("refuses a wallet linked in the last 7 days", () => {
      expect(
        decide({
          factors: { ...ALL_FACTORS, walletLinkedAt: RECENT },
          ...proofs(["recovery_key", "wallet"]),
        }).allowed
      ).toBe(false);
    });

    it("refuses a magic link to an address that changed or was unverified", () => {
      const recovery = proofs(["magic_link", "recovery_key"]);

      expect(
        decide({
          factors: ALL_FACTORS,
          ...recovery,
          email: "other@example.com",
        }).allowed
      ).toBe(false);
      expect(
        decide({ factors: ALL_FACTORS, ...recovery, emailVerified: false })
          .allowed
      ).toBe(false);
    });

    it("adds one passkey, and still allows the other changes", () => {
      const spent = {
        factors: ALL_FACTORS,
        ...proofs(["magic_link", "recovery_key"]),
        recoveryAddedPasskey: true,
      };

      expect(decide(spent).allowed).toBe(false);
      expect(decide(spent, "recovery_key")).toEqual({
        allowed: true,
        reason: "account_recovery",
      });
      expect(decide(spent, "passkey").allowed).toBe(true);
    });
  });

  describe("a magic link alone", () => {
    it("recovers an account that has nothing else", () => {
      expect(decide(proofs(["magic_link"]))).toEqual({
        allowed: true,
        reason: "email_only_recovery",
      });
    });

    it.each([
      ["a password, however recent", { passwordSetAt: RECENT }],
      [
        "a password a reset by email set",
        { passwordSetAt: RECENT, passwordSetMethod: "password_reset" as const },
      ],
      ["a wallet", { walletLinkedAt: RECENT }],
      ["a recovery key", { recoveryKey: true }],
    ])("refuses an account that also has %s", (_label, factor) => {
      expect(
        decide({
          factors: { ...state().factors, ...factor },
          ...proofs(["magic_link"]),
        }).allowed
      ).toBe(false);
    });

    it("refuses once the window has passed", () => {
      expect(
        decide(proofs(["magic_link"], ACCOUNT_RECOVERY_WINDOW_MS)).allowed
      ).toBe(false);
    });

    it("adds one passkey", () => {
      expect(
        decide({ ...proofs(["magic_link"]), recoveryAddedPasskey: true })
          .allowed
      ).toBe(false);
    });
  });
});

describe("heldRecoveryProofs", () => {
  it("lists only proofs that would count", () => {
    expect(
      heldRecoveryProofs(
        state({
          factors: { ...ALL_FACTORS, walletLinkedAt: RECENT },
          ...proofs(["magic_link", "password", "wallet"]),
        }),
        NOW
      )
    ).toEqual(["magic_link", "password"]);
  });
});
