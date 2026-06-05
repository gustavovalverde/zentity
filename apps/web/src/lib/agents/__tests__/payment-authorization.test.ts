/**
 * Conformance for the `payment_authorization` RAR Zod schema.
 *
 * The schema validates the wire shape the issuer mints and the wallet
 * verifies (Proposal-0003 D-1, D-10, D-14). Each invariant has a test;
 * a failure here is a wire-shape break either side will reject in prod.
 */

import { describe, expect, it } from "vitest";

import {
  AmountSchema,
  ChainIdSchema,
  ExpiresAtSchema,
  PAYMENT_AUTHORIZATION_TYPE,
  type PaymentAuthorization,
  PaymentAuthorizationDetailsSchema,
  PaymentAuthorizationSchema,
  parsePaymentAuthorization,
} from "../payment-authorization";

const RAR_TOO_MANY_ENTRIES = /rar_too_many_entries/;

const VALID_AUTHORIZATION: PaymentAuthorization = {
  type: PAYMENT_AUTHORIZATION_TYPE,
  chain: { namespace: "zcash", reference: "test" },
  recipient: "zcash:test:utest1qq0",
  amount: { currency: "ZEC", value: "50000000", unit: "base" },
  payment_id: "01KT9A0V431VGD5YH7R7G635HC",
  intent_hash: "v1:sha256:tH5IGJbnV6NxSl9nmwbFc8EWDF6rfYcXgOfHFmmIjUQ",
  expires_at: { kind: "block_height", value: 4_047_100 },
};

describe("payment-authorization", () => {
  it("parses a well-formed authorization", () => {
    expect(() =>
      PaymentAuthorizationSchema.parse(VALID_AUTHORIZATION)
    ).not.toThrow();
  });

  it("rejects an unknown type tag", () => {
    const bad = { ...VALID_AUTHORIZATION, type: "subscription" };
    expect(() => PaymentAuthorizationSchema.parse(bad)).toThrow();
  });

  it("rejects an amount.value with a leading sign", () => {
    const bad = {
      ...VALID_AUTHORIZATION,
      amount: { ...VALID_AUTHORIZATION.amount, value: "-100" },
    };
    expect(() => PaymentAuthorizationSchema.parse(bad)).toThrow();
  });

  it("rejects an amount.value in scientific notation", () => {
    const bad = {
      ...VALID_AUTHORIZATION,
      amount: { ...VALID_AUTHORIZATION.amount, value: "5e7" },
    };
    expect(() => PaymentAuthorizationSchema.parse(bad)).toThrow();
  });

  it("rejects an intent_hash without the v1:sha256: prefix", () => {
    const bad = {
      ...VALID_AUTHORIZATION,
      intent_hash: "sha256:abcdef",
    };
    expect(() => PaymentAuthorizationSchema.parse(bad)).toThrow();
  });

  it("rejects an intent_hash with a wrong-length payload", () => {
    const bad = {
      ...VALID_AUTHORIZATION,
      intent_hash: "v1:sha256:tooshort",
    };
    expect(() => PaymentAuthorizationSchema.parse(bad)).toThrow();
  });

  it("rejects a recipient that is not CAIP-10", () => {
    const bad = { ...VALID_AUTHORIZATION, recipient: "utest1qq0" };
    expect(() => PaymentAuthorizationSchema.parse(bad)).toThrow();
  });

  it("rejects an empty authorization_details array", () => {
    expect(() => PaymentAuthorizationDetailsSchema.parse([])).toThrow();
  });

  it("rejects an authorization_details array with two entries (rar_too_many_entries)", () => {
    expect(() =>
      PaymentAuthorizationDetailsSchema.parse([
        VALID_AUTHORIZATION,
        VALID_AUTHORIZATION,
      ])
    ).toThrow(RAR_TOO_MANY_ENTRIES);
  });

  it("parsePaymentAuthorization returns the single entry", () => {
    const out = parsePaymentAuthorization([VALID_AUTHORIZATION]);
    expect(out).toEqual(VALID_AUTHORIZATION);
  });

  it("accepts every ExpiresAt kind", () => {
    const kinds: (
      | "block_height"
      | "slot"
      | "block_number"
      | "timestamp_seconds"
    )[] = ["block_height", "slot", "block_number", "timestamp_seconds"];
    for (const kind of kinds) {
      const entry = { ...VALID_AUTHORIZATION, expires_at: { kind, value: 1 } };
      expect(() => PaymentAuthorizationSchema.parse(entry)).not.toThrow();
    }
  });

  it("rejects negative expires_at.value", () => {
    const bad = {
      ...VALID_AUTHORIZATION,
      expires_at: { kind: "block_height" as const, value: -1 },
    };
    expect(() => PaymentAuthorizationSchema.parse(bad)).toThrow();
  });

  it("ChainIdSchema rejects an uppercase namespace", () => {
    expect(() =>
      ChainIdSchema.parse({ namespace: "ZCASH", reference: "test" })
    ).toThrow();
  });

  it("AmountSchema accepts a fractional decimal-string value", () => {
    expect(() =>
      AmountSchema.parse({ currency: "ZEC", value: "0.5", unit: "display" })
    ).not.toThrow();
  });

  it("ExpiresAtSchema rejects an unknown kind", () => {
    expect(() => ExpiresAtSchema.parse({ kind: "epoch", value: 1 })).toThrow();
  });
});
