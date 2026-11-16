import { createHash } from "node:crypto";

import { decodeJwt, decodeProtectedHeader } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStubSchemeClient,
  MERCHANT_ORIGIN,
  PAY_TO,
  paymentRequiredResponse,
  RESOURCE_URL,
  requirement,
  TEST_ISSUER,
  testPaymentRequired,
  USDC,
} from "./__fixtures__/x402-merchant";
import { X402PaymentRequirementsSchema } from "./protocol/purchase-authorization";
import { createDpopClient } from "./rp/dpop-client";
import {
  buildAuthHintsExtension,
  buildZentityExtension,
  PAYMENT_SIGNATURE_HEADER,
  parsePaymentSignatureHeader,
  readOAuthAuthHints,
  readZentityExtension,
} from "./rp/payment-required";
import {
  assertApprovedDetails,
  buildX402PurchaseAuthorization,
  type CreateX402FetchOptions,
  createX402Fetch,
  X402PurchaseError,
} from "./x402";

const POH_TOKEN = "header.payload.signature";

function setup(
  overrides: Partial<CreateX402FetchOptions> = {},
  merchant: () => Response = () => paymentRequiredResponse()
) {
  const schemeClient = createStubSchemeClient();
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(() => Promise.resolve(merchant()))
    .mockResolvedValue(new Response(JSON.stringify({ access: "granted" })));
  const approve = vi.fn<CreateX402FetchOptions["approve"]>(async () => ({
    pohToken: POH_TOKEN,
    dpopClient: await createDpopClient(),
  }));
  const x402Fetch = createX402Fetch({
    approve,
    fetch: fetchFn,
    issuer: TEST_ISSUER,
    maxAmount: "1",
    maxIdentityStrength: "cryptographic_chip",
    schemeClient,
    ...overrides,
  });
  return { approve, fetchFn, schemeClient, x402Fetch };
}

async function expectRefusal(
  promise: Promise<Response>,
  code: X402PurchaseError["code"]
) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(X402PurchaseError);
  expect((error as X402PurchaseError).code).toBe(code);
}

describe("createX402Fetch", () => {
  let harness: ReturnType<typeof setup>;

  beforeEach(() => {
    harness = setup();
  });

  it("returns a response that is not a 402 unchanged", async () => {
    const { fetchFn, approve, x402Fetch } = setup({}, () => new Response("ok"));

    const response = await x402Fetch(RESOURCE_URL);

    expect(await response.text()).toBe("ok");
    expect(approve).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("asks for approval of the merchant's requirement, then pays and presents the token", async () => {
    const { approve, fetchFn, schemeClient, x402Fetch } = harness;

    const response = await x402Fetch(RESOURCE_URL);

    expect(response.status).toBe(200);
    expect(approve).toHaveBeenCalledOnce();
    const [approved, context] = approve.mock.calls[0] ?? [];
    expect(approved).toEqual(requirement());
    expect(context).toEqual(
      expect.objectContaining({
        authorizationServer: TEST_ISSUER,
        minIdentityStrength: "documentary_full",
        resourceDescription: "Financial analytics",
        resourceUrl: RESOURCE_URL,
      })
    );
    // The payment is signed only after the approval.
    expect(schemeClient.createPaymentPayload).toHaveBeenCalledOnce();
    expect(
      approve.mock.invocationCallOrder[0] as number
    ).toBeLessThan(
      schemeClient.createPaymentPayload.mock.invocationCallOrder[0] as number
    );

    const [, init] = fetchFn.mock.calls[1] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(`DPoP ${POH_TOKEN}`);
    const proof = headers.get("DPoP") as string;
    expect(decodeProtectedHeader(proof).typ).toBe("dpop+jwt");
    expect(decodeJwt(proof)).toEqual(
      expect.objectContaining({
        htm: "GET",
        htu: `${MERCHANT_ORIGIN}/api/x402/access`,
        ath: createHash("sha256").update(POH_TOKEN).digest("base64url"),
      })
    );

    const payment = parsePaymentSignatureHeader(
      headers.get(PAYMENT_SIGNATURE_HEADER) as string
    );
    expect(payment.accepted).toEqual(requirement());
    // R8 (client part): the payment payload carries no Zentity token.
    expect(JSON.stringify(payment)).not.toContain(POH_TOKEN);
    expect(JSON.stringify(payment)).not.toContain("pohToken");
  });

  // R6: an unpayable accepts[0] is skipped, not paid with an empty payload.
  it("selects the first requirement on the registered network", async () => {
    const accepts = [
      requirement({ network: "eip155:8453" }),
      requirement({ amount: "2" }),
    ];
    const { approve, x402Fetch } = setup(
      { maxAmount: "5" },
      () => paymentRequiredResponse({ accepts })
    );

    await x402Fetch(RESOURCE_URL);

    expect(approve.mock.calls[0]?.[0]).toEqual(requirement({ amount: "2" }));
  });

  it("refuses with payment_not_configured and sends no retry without a scheme client", async () => {
    const { approve, fetchFn, x402Fetch } = setup({ schemeClient: undefined });

    await expectRefusal(x402Fetch(RESOURCE_URL), "payment_not_configured");
    expect(approve).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  // R5: atomic amounts compare with display amounts in the asset's units.
  it.each([
    ["1.00", "2000000", false],
    ["1.00", "1000000", true],
    [1, "1000001", false],
  ] as const)(
    "with maxAmount %s, a requirement of %s atomic units is affordable: %s",
    async (maxAmount, amount, affordable) => {
      const { approve, x402Fetch } = setup({ maxAmount }, () =>
        paymentRequiredResponse({ accepts: [requirement({ amount })] })
      );

      const outcome = x402Fetch(RESOURCE_URL);
      if (affordable) {
        expect((await outcome).status).toBe(200);
      } else {
        await expectRefusal(outcome, "payment_bounds_exceeded");
        expect(approve).not.toHaveBeenCalled();
      }
    }
  );

  // R33: the caller's bound replaces @x402/core's default $1 cap.
  it("pays 2 USDC under maxAmount 5", async () => {
    const { schemeClient, x402Fetch } = setup({ maxAmount: 5 }, () =>
      paymentRequiredResponse({ accepts: [requirement({ amount: "2000000" })] })
    );

    const response = await x402Fetch(RESOURCE_URL);

    expect(response.status).toBe(200);
    expect(schemeClient.createPaymentPayload).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ amount: "2000000" }),
      expect.objectContaining({ maxAmountPerPayment: "5000000" })
    );
  });

  // R22: the agent checks what the merchant names before Zentity hears of it.
  it("refuses a resource on another origin with merchant_mismatch", async () => {
    const { approve, fetchFn, x402Fetch } = setup({}, () =>
      paymentRequiredResponse({ resourceUrl: "https://other.example/x" })
    );

    await expectRefusal(x402Fetch(RESOURCE_URL), "merchant_mismatch");
    expect(approve).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refuses another authorization server with untrusted_issuer", async () => {
    const { approve, x402Fetch } = setup({}, () =>
      paymentRequiredResponse({
        authorizationServer: "https://evil.example/api/auth",
      })
    );

    await expectRefusal(x402Fetch(RESOURCE_URL), "untrusted_issuer");
    expect(approve).not.toHaveBeenCalled();
  });

  // R35, R7, and R31: what the agent cannot use is unsupported.
  it.each([
    [
      "no auth-hints",
      {
        extensions: {
          zentity: buildZentityExtension({ minIdentityStrength: "documentary" }),
        },
      },
    ],
    [
      "the flat zentity shape",
      {
        extensions: {
          "auth-hints": buildAuthHintsExtension({
            acceptIndexes: [0],
            authorizationServer: TEST_ISSUER,
            tokenEndpoint: `${TEST_ISSUER}/oauth2/token`,
          }),
          zentity: { minComplianceLevel: 2, pohIssuer: TEST_ISSUER },
        },
      },
    ],
    [
      "an on-chain identity check",
      { identityRegistryMirror: "0x0000000000000000000000000000000000000001" },
    ],
    [
      "only an unregistered asset",
      { accepts: [requirement({ asset: PAY_TO })] },
    ],
  ])("refuses a 402 with %s as unsupported_resource", async (_case, options) => {
    const { approve, x402Fetch } = setup({}, () =>
      paymentRequiredResponse(options)
    );

    await expectRefusal(x402Fetch(RESOURCE_URL), "unsupported_resource");
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses a merchant that needs more identity than the agent allows", async () => {
    const { approve, x402Fetch } = setup(
      { maxIdentityStrength: "documentary" },
      () => paymentRequiredResponse({ minIdentityStrength: "documentary_full" })
    );

    await expectRefusal(
      x402Fetch(RESOURCE_URL),
      "identity_strength_bound_exceeded"
    );
    expect(approve).not.toHaveBeenCalled();
  });

  it("resends a binary request body byte for byte", async () => {
    const { fetchFn, x402Fetch } = harness;
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0xc3]);

    await x402Fetch(RESOURCE_URL, { method: "POST", body: bytes });

    const [, init] = fetchFn.mock.calls[1] as [string, RequestInit];
    expect(
      new Uint8Array(await new Response(init.body).arrayBuffer())
    ).toEqual(bytes);
  });

  it("neither signs nor pays once the caller aborts during approval", async () => {
    const controller = new AbortController();
    const { approve, fetchFn, schemeClient, x402Fetch } = harness;
    approve.mockImplementationOnce(async () => {
      controller.abort();
      return { pohToken: POH_TOKEN, dpopClient: await createDpopClient() };
    });

    await expect(
      x402Fetch(RESOURCE_URL, { signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(schemeClient.createPaymentPayload).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("passes the caller's signal to the paid retry", async () => {
    const controller = new AbortController();
    const { fetchFn, x402Fetch } = harness;

    await x402Fetch(RESOURCE_URL, { signal: controller.signal });

    const [, init] = fetchFn.mock.calls[1] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    controller.abort();
    expect(init.signal?.aborted).toBe(true);
  });

  it("propagates an approval failure without paying", async () => {
    const { approve, fetchFn, schemeClient, x402Fetch } = harness;
    approve.mockRejectedValueOnce(new Error("denied"));

    await expect(x402Fetch(RESOURCE_URL)).rejects.toThrow("denied");
    expect(schemeClient.createPaymentPayload).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("x402 extensions", () => {
  // R7: the extension values round-trip through the client's readers.
  it("reads back the auth-hints and zentity extensions it builds", () => {
    const paymentRequired = testPaymentRequired({
      accepts: [requirement(), requirement({ amount: "2" })],
      acceptIndexes: [1, 7],
      identityRegistryMirror: "0x0000000000000000000000000000000000000001",
    });

    expect(readOAuthAuthHints(paymentRequired)).toEqual([
      {
        type: "oauth2",
        tokenType: "DPoP",
        authorizationServer: TEST_ISSUER,
        tokenEndpoint: `${TEST_ISSUER}/oauth2/token`,
        acceptIndexes: [1],
      },
    ]);
    expect(readZentityExtension(paymentRequired)).toEqual({
      minIdentityStrength: "documentary_full",
      identityRegistryMirror: "0x0000000000000000000000000000000000000001",
    });
    expect(paymentRequired.extensions?.zentity).toEqual({
      info: expect.any(Object),
      schema: expect.objectContaining({ additionalProperties: false }),
    });
  });

  it.each([
    ["a numeric level", { info: { minIdentityStrength: 2 } }],
    ["the flat shape", { minIdentityStrength: "documentary" }],
    [
      "an unknown member",
      { info: { minIdentityStrength: "documentary", tier: 2 } },
    ],
  ])("refuses a zentity extension with %s", (_case, zentity) => {
    expect(
      readZentityExtension({ extensions: { zentity } })
    ).toBeNull();
  });
});

describe("x402_purchase helpers", () => {
  it("builds the entry from the requirement verbatim", () => {
    expect(
      buildX402PurchaseAuthorization(
        X402PaymentRequirementsSchema.parse(requirement()),
        {
        minIdentityStrength: "documentary",
        resourceDescription: "Financial analytics",
        resourceUrl: RESOURCE_URL,
        }
      )
    ).toEqual({
      type: "x402_purchase",
      resource_url: RESOURCE_URL,
      resource_description: "Financial analytics",
      payment_requirements: requirement(),
      min_identity_strength: "documentary",
    });
  });

  it("accepts approved details that differ only in key order", () => {
    const sent = [{ type: "x402_purchase", b: 1, a: { d: "x", c: "y" } }];
    const approved = [{ a: { c: "y", d: "x" }, b: 1, type: "x402_purchase" }];

    expect(() => assertApprovedDetails(sent, approved)).not.toThrow();
  });

  it.each([
    ["other details", [{ type: "x402_purchase", amount: "2" }]],
    ["no details", undefined],
  ])("refuses %s as approval_mismatch", (_case, approved) => {
    expect(() =>
      assertApprovedDetails([{ type: "x402_purchase", amount: "1" }], approved)
    ).toThrow(
      expect.objectContaining({ code: "approval_mismatch" }) as unknown as Error
    );
  });

  it("keeps the registered asset address as the merchant wrote it", () => {
    expect(requirement().asset).toBe(USDC);
  });
});
