import { describe, expect, it, vi } from "vitest";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type PaymentRequiredPayload,
} from "./rp/payment-required.js";
import { createX402Fetch } from "./x402.js";

function encodeHeader(payload: PaymentRequiredPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function createPaymentRequiredPayload(
  minComplianceLevel = 2
): PaymentRequiredPayload {
  return {
    x402Version: 2,
    accepts: {
      scheme: "exact",
      network: "eip155:84532",
      payTo: "0x000000000000000000000000000000000000dEaD",
      amount: "1",
      maxTimeoutSeconds: 300,
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    },
    resource: { url: "https://merchant.example/api/purchase" },
    extensions: {
      zentity: {
        minComplianceLevel,
        pohIssuer: "https://issuer.example",
      },
    },
  };
}

describe("createX402Fetch", () => {
  it("attaches a PoH token after a Zentity-gated PAYMENT-REQUIRED response", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("payment required", {
          status: 402,
          headers: {
            [PAYMENT_REQUIRED_HEADER]: encodeHeader(
              createPaymentRequiredPayload(3)
            ),
          },
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    const getPohToken = vi.fn().mockResolvedValue("poh-token");

    const fetchWithX402 = createX402Fetch(fetchFn, { getPohToken });
    const response = await fetchWithX402("https://merchant.example/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceId: "resource-1" }),
    });

    expect(response.status).toBe(200);
    expect(getPohToken).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        requirement: expect.objectContaining({ minComplianceLevel: 3 }),
      })
    );
    const retryRequest = fetchFn.mock.calls[1]?.[0] as Request;
    expect(retryRequest.headers.get(PAYMENT_SIGNATURE_HEADER)).toBeTruthy();
    await expect(retryRequest.json()).resolves.toEqual({
      resourceId: "resource-1",
      pohToken: "poh-token",
    });
  });

  it("passes through non-Zentity 402 responses unchanged", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("payment required", {
        status: 402,
        headers: {
          [PAYMENT_REQUIRED_HEADER]: encodeHeader({
            ...createPaymentRequiredPayload(),
            extensions: {},
          }),
        },
      })
    );
    const getPohToken = vi.fn();

    const fetchWithX402 = createX402Fetch(fetchFn, { getPohToken });
    const response = await fetchWithX402("https://merchant.example/api");

    expect(response.status).toBe(402);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(getPohToken).not.toHaveBeenCalled();
  });

  it("passes through Zentity 402 responses without an explicit PoH issuer", async () => {
    const paymentRequired = createPaymentRequiredPayload();
    paymentRequired.extensions = {
      zentity: {
        minComplianceLevel: 2,
      },
    };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("payment required", {
        status: 402,
        headers: {
          [PAYMENT_REQUIRED_HEADER]: encodeHeader(paymentRequired),
        },
      })
    );
    const getPohToken = vi.fn();

    const fetchWithX402 = createX402Fetch(fetchFn, { getPohToken });
    const response = await fetchWithX402("https://merchant.example/api");

    expect(response.status).toBe(402);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(getPohToken).not.toHaveBeenCalled();
  });

  it("passes through 402 responses without PAYMENT-REQUIRED", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("payment required", { status: 402 }));
    const getPohToken = vi.fn();

    const fetchWithX402 = createX402Fetch(fetchFn, { getPohToken });
    const response = await fetchWithX402("https://merchant.example/api");

    expect(response.status).toBe(402);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(getPohToken).not.toHaveBeenCalled();
  });

  it("notifies the caller when the retry is forbidden", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("payment required", {
          status: 402,
          headers: {
            [PAYMENT_REQUIRED_HEADER]: encodeHeader(
              createPaymentRequiredPayload(2)
            ),
          },
        })
      )
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    const onRetryForbidden = vi.fn();

    const fetchWithX402 = createX402Fetch(fetchFn, {
      getPohToken: vi.fn().mockResolvedValue("poh-token"),
      onRetryForbidden,
    });
    const response = await fetchWithX402("https://merchant.example/api");

    expect(response.status).toBe(403);
    expect(onRetryForbidden).toHaveBeenCalledWith(
      expect.objectContaining({
        requirement: expect.objectContaining({ minComplianceLevel: 2 }),
      })
    );
  });
});
