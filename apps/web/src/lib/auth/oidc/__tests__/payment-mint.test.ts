import { describe, expect, it } from "vitest";

import { deriveCapabilityName } from "@/lib/agents/capability";
import {
  buildPaymentAuthorizationClaims,
  canonicalizePaymentRar,
  PAYMENT_AUTHORIZATION_SCOPE,
  PAYMENT_TOKEN_SCOPE_EXPIRATIONS,
} from "@/lib/auth/oidc/payment-mint";

const RAR = {
  type: "payment_authorization",
  chain: { namespace: "zcash", reference: "test" },
  recipient: "zcash:test:utest1qq0",
  amount: { currency: "ZEC", value: "50000000", unit: "base" },
  payment_id: "pay_123",
  intent_hash: `v1:sha256:${"A".repeat(43)}`,
  expires_at: { kind: "block_height", value: 4_056_276 },
};

describe("canonicalizePaymentRar (bc-authorize, D-14)", () => {
  it("returns canonical JSON for a valid single payment RAR", () => {
    const canonical = canonicalizePaymentRar(JSON.stringify([RAR]));
    expect(canonical).not.toBeNull();
    const parsed = JSON.parse(canonical as string);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].recipient).toBe(RAR.recipient);
  });

  it("leaves a non-payment authorization_details untouched (null)", () => {
    expect(
      canonicalizePaymentRar(JSON.stringify([{ type: "openid_x" }]))
    ).toBeNull();
  });

  it("returns null for absent/empty authorization_details", () => {
    expect(canonicalizePaymentRar(undefined)).toBeNull();
    expect(canonicalizePaymentRar("")).toBeNull();
  });

  it("rejects more than one entry (rar_too_many_entries)", () => {
    // The thrown APIError carries `rar_too_many_entries` in its body's
    // error_description (not its .message), so assert it throws at all.
    expect(() => canonicalizePaymentRar(JSON.stringify([RAR, RAR]))).toThrow();
  });

  it("rejects a malformed payment RAR", () => {
    expect(() =>
      canonicalizePaymentRar(JSON.stringify([{ ...RAR, intent_hash: "nope" }]))
    ).toThrow();
  });
});

describe("buildPaymentAuthorizationClaims (mint, D-1)", () => {
  it("emits exactly one canonical authorization_details entry", () => {
    const claims = buildPaymentAuthorizationClaims(JSON.stringify([RAR]));
    expect(claims?.authorization_details).toHaveLength(1);
    expect(claims?.authorization_details[0]?.intent_hash).toBe(RAR.intent_hash);
  });

  it("returns null when the stored RAR is not a payment grant", () => {
    expect(
      buildPaymentAuthorizationClaims(JSON.stringify([{ type: "other" }]))
    ).toBeNull();
  });

  it("fails loud on a corrupt stored RAR", () => {
    expect(() =>
      buildPaymentAuthorizationClaims(JSON.stringify([{ ...RAR, amount: {} }]))
    ).toThrow();
  });
});

describe("capability + scope wiring", () => {
  it("derives payment_authorization:sign from a payment RAR", () => {
    expect(
      deriveCapabilityName([RAR], "openid payment_authorization:sign")
    ).toBe("payment_authorization:sign");
  });

  it("uses a duration string (not a number) for the 120s lifetime", () => {
    // toExpJWT treats a number as an absolute epoch timestamp; the value must
    // be a duration string so exp = iat + 120.
    expect(PAYMENT_TOKEN_SCOPE_EXPIRATIONS[PAYMENT_AUTHORIZATION_SCOPE]).toBe(
      "120s"
    );
  });
});
