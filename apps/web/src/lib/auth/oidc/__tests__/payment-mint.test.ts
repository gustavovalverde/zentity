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

import { approvalPolicy } from "@/lib/agents/capability";
import { pinPaymentRequest } from "@/lib/auth/oidc/payment-mint";

function refusal(run: () => void) {
  try {
    run();
  } catch (error) {
    return (error as { body?: Record<string, unknown> }).body;
  }
  throw new Error("expected a refusal");
}

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

  it("refuses more than one entry as invalid authorization details", () => {
    mockEnv.WALLET_AUDIENCE = WALLET_AUDIENCE;
    expect(
      refusal(() =>
        pinPaymentRequest({ authorization_details: JSON.stringify([RAR, RAR]) })
      )
    ).toEqual({
      error: "invalid_authorization_details",
      error_description: expect.stringContaining("rar_too_many_entries"),
    });
  });

  it("refuses a malformed payment RAR as invalid authorization details", () => {
    mockEnv.WALLET_AUDIENCE = WALLET_AUDIENCE;
    expect(
      refusal(() =>
        pinPaymentRequest({
          authorization_details: JSON.stringify([
            { ...RAR, intent_hash: "nope" },
          ]),
        })
      )
    ).toMatchObject({ error: "invalid_authorization_details" });
  });

  it("refuses the wallet audience without a payment entry", () => {
    mockEnv.WALLET_AUDIENCE = WALLET_AUDIENCE;
    expect(
      refusal(() =>
        pinPaymentRequest({ scope: "openid", resource: WALLET_AUDIENCE })
      )
    ).toEqual({
      error: "invalid_target",
      error_description: "the wallet audience accepts only payment requests",
    });
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

describe("capability wiring", () => {
  it("maps a payment RAR to payment_authorization:sign without a payment scope", () => {
    expect(
      approvalPolicy({
        scope: "openid",
        authorizationDetails: [RAR],
      }).grantCapability
    ).toBe("payment_authorization:sign");
  });
});
