import { afterEach, describe, expect, it, vi } from "vitest";

const WALLET_AUDIENCE = "urn:zentity:wallet:test-jkt";
const mockEnv = vi.hoisted(() => ({
  WALLET_AUDIENCE: undefined as string | undefined,
}));
vi.mock("@/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/env")>();
  return {
    ...mod,
    env: new Proxy(mod.env, {
      get(target, prop) {
        return prop === "WALLET_AUDIENCE"
          ? mockEnv.WALLET_AUDIENCE
          : Reflect.get(target, prop);
      },
    }),
  };
});

import { deriveCapabilityName } from "@/lib/agents/capability";
import {
  buildPaymentAuthorizationClaims,
  PAYMENT_AUTHORIZATION_SCOPE,
  PAYMENT_TOKEN_SCOPE_EXPIRATIONS,
  pinPaymentRequest,
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

describe("pinPaymentRequest (bc-authorize, D-5 + D-14)", () => {
  afterEach(() => {
    mockEnv.WALLET_AUDIENCE = undefined;
  });

  it("canonicalizes the RAR and pins the resource to the wallet audience", () => {
    mockEnv.WALLET_AUDIENCE = WALLET_AUDIENCE;
    const body: Record<string, unknown> = {
      authorization_details: JSON.stringify([RAR]),
      resource: "http://localhost:3000",
    };

    pinPaymentRequest(body);

    const parsed = JSON.parse(body.authorization_details as string);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].recipient).toBe(RAR.recipient);
    expect(body.resource).toBe(WALLET_AUDIENCE);
  });

  it("leaves a non-payment request untouched", () => {
    mockEnv.WALLET_AUDIENCE = WALLET_AUDIENCE;
    const authorizationDetails = JSON.stringify([{ type: "openid_x" }]);
    const body: Record<string, unknown> = {
      authorization_details: authorizationDetails,
      resource: "http://localhost:3000",
    };

    pinPaymentRequest(body);

    expect(body).toEqual({
      authorization_details: authorizationDetails,
      resource: "http://localhost:3000",
    });
  });

  it("leaves a request without authorization_details untouched", () => {
    const body: Record<string, unknown> = { scope: "openid" };
    pinPaymentRequest(body);
    expect(body).toEqual({ scope: "openid" });
  });

  it("rejects more than one entry (rar_too_many_entries)", () => {
    mockEnv.WALLET_AUDIENCE = WALLET_AUDIENCE;
    // The thrown APIError carries `rar_too_many_entries` in its body's
    // error_description (not its .message), so assert it throws at all.
    expect(() =>
      pinPaymentRequest({ authorization_details: JSON.stringify([RAR, RAR]) })
    ).toThrow();
  });

  it("rejects a malformed payment RAR", () => {
    mockEnv.WALLET_AUDIENCE = WALLET_AUDIENCE;
    expect(() =>
      pinPaymentRequest({
        authorization_details: JSON.stringify([
          { ...RAR, intent_hash: "nope" },
        ]),
      })
    ).toThrow();
  });

  it("fails closed when WALLET_AUDIENCE is unset", () => {
    const body: Record<string, unknown> = {
      authorization_details: JSON.stringify([RAR]),
      resource: "http://localhost:3000",
    };
    expect(() => pinPaymentRequest(body)).toThrow();
    expect(body.resource).toBe("http://localhost:3000");
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
