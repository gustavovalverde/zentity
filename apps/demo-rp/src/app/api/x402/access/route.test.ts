import {
  buildPaymentRequiredPayload,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from "@zentity/sdk/rp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { X402Resource } from "@/data/x402";

const mocks = vi.hoisted(() => ({
  buildRouteConfig: vi.fn(),
  createProofOfHumanTokenVerifier: vi.fn(),
  findResource: vi.fn(),
  getMirrorAddress: vi.fn(),
  readOnChainCompliance: vi.fn(),
  getStoredDpopJkt: vi.fn(),
  settlePayment: vi.fn(),
  verifyPayment: vi.fn(),
  verifyProofOfHumanToken: vi.fn(),
}));

vi.mock("@zentity/sdk/rp", async () => {
  const actual =
    await vi.importActual<typeof import("@zentity/sdk/rp")>("@zentity/sdk/rp");
  return {
    ...actual,
    createProofOfHumanTokenVerifier: mocks.createProofOfHumanTokenVerifier,
  };
});

vi.mock("@/data/x402", () => ({
  findResource: mocks.findResource,
}));

vi.mock("@/lib/on-chain-compliance", () => ({
  getMirrorAddress: mocks.getMirrorAddress,
  readOnChainCompliance: mocks.readOnChainCompliance,
}));

vi.mock("@/lib/env", () => ({
  env: {
    ZENTITY_URL: "http://zentity-internal:3000",
    NEXT_PUBLIC_ZENTITY_URL: "https://app.zentity.xyz",
  },
}));

vi.mock("@/lib/facilitator", () => ({
  settlePayment: mocks.settlePayment,
  verifyPayment: mocks.verifyPayment,
}));

vi.mock("@/lib/poh-client", () => ({
  getStoredDpopJkt: mocks.getStoredDpopJkt,
}));

vi.mock("@/lib/x402-server", () => ({
  buildRouteConfig: mocks.buildRouteConfig,
}));

import { POST } from "./route";

const WALLET_A = "0x0000000000000000000000000000000000000001";
const WALLET_B = "0x0000000000000000000000000000000000000002";

function makeResource(overrides: Partial<X402Resource> = {}): X402Resource {
  return {
    id: "resource-1",
    name: "Regulated API",
    description: "Tier-gated resource",
    endpoint: "/api/x402/access",
    icon: {} as X402Resource["icon"],
    price: "$0.01",
    amount: "1",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    eip712Name: "USDC",
    eip712Version: "2",
    network: "eip155:84532",
    payTo: "0x000000000000000000000000000000000000dEaD",
    requiredTier: 3,
    requireOnChain: true,
    responseData: { ok: true },
    ...overrides,
  };
}

function makeRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Request {
  return new Request("http://localhost:3102/api/x402/access", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function makePaymentSignatureHeader(pohToken = "poh-token"): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:84532",
        payTo: "0x000000000000000000000000000000000000dEaD",
        amount: "1",
        maxTimeoutSeconds: 300,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        extra: {},
      },
      payload: {},
      extensions: {
        zentity: {
          pohToken,
        },
      },
    })
  ).toString("base64");
}

describe("/api/x402/access POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createProofOfHumanTokenVerifier.mockReturnValue({
      verify: mocks.verifyProofOfHumanToken,
    });
    mocks.buildRouteConfig.mockReturnValue({
      accepts: {
        scheme: "exact",
        network: "eip155:84532",
        payTo: "0x000000000000000000000000000000000000dEaD",
        amount: "1",
        maxTimeoutSeconds: 300,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        extra: {},
      },
    });
    mocks.getMirrorAddress.mockReturnValue(
      "0xa90723A47A14437500645Ece6049d0128A2f256D"
    );
    mocks.verifyPayment.mockResolvedValue({
      isValid: true,
      payer: WALLET_A,
    });
    mocks.verifyProofOfHumanToken.mockResolvedValue({
      sub: "user-123",
      exp: 1_800_000_000,
      poh: {
        tier: 3,
        verified: true,
        sybil_resistant: true,
        method: "ocr",
      },
    });
    mocks.readOnChainCompliance.mockResolvedValue({
      address: WALLET_A,
      compliant: true,
      contract: "0xa90723A47A14437500645Ece6049d0128A2f256D",
      minComplianceLevel: 3,
      network: "eip155:84532",
    });
    mocks.settlePayment.mockResolvedValue({
      success: true,
      transaction: `0x${"1".repeat(64)}`,
      network: "eip155:84532",
    });
  });

  it("does not settle tier-gated requests before PoH succeeds", async () => {
    mocks.findResource.mockReturnValue(
      makeResource({ requiredTier: 2, requireOnChain: false })
    );

    const response = await POST(
      makeRequest(
        { resourceId: "resource-1" },
        { [PAYMENT_SIGNATURE_HEADER]: Buffer.from("{}").toString("base64") }
      )
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "compliance_required",
      required: 2,
    });
    expect(mocks.settlePayment).not.toHaveBeenCalled();
  });

  it("emits an x402 v2 PAYMENT-REQUIRED header before payment", async () => {
    mocks.findResource.mockReturnValue(
      makeResource({ requiredTier: 2, requireOnChain: false })
    );

    const response = await POST(makeRequest({ resourceId: "resource-1" }));

    expect(response.status).toBe(402);
    const body = await response.json();
    const header = response.headers.get(PAYMENT_REQUIRED_HEADER);

    expect(body).toEqual(
      buildPaymentRequiredPayload({
        accepts: [
          {
            scheme: "exact",
            network: "eip155:84532",
            payTo: "0x000000000000000000000000000000000000dEaD",
            amount: "1",
            maxTimeoutSeconds: 300,
            asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            extra: {},
          },
        ],
        resource: { url: "/api/x402/access" },
      })
    );
    expect(header).toBe(Buffer.from(JSON.stringify(body)).toString("base64"));
  });

  it("rejects on-chain requests when the caller-provided wallet mismatches the payer", async () => {
    mocks.findResource.mockReturnValue(makeResource());

    const response = await POST(
      makeRequest(
        {
          resourceId: "resource-1",
          walletAddress: WALLET_B,
        },
        { [PAYMENT_SIGNATURE_HEADER]: makePaymentSignatureHeader() }
      )
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "wallet_address_mismatch",
      detail:
        "On-chain compliance must match the wallet that signed the payment.",
      payer: WALLET_A,
    });
    expect(mocks.readOnChainCompliance).not.toHaveBeenCalled();
    expect(mocks.settlePayment).not.toHaveBeenCalled();
  });

  it("checks on-chain compliance against the verified payer wallet", async () => {
    mocks.findResource.mockReturnValue(makeResource());

    const response = await POST(
      makeRequest(
        {
          resourceId: "resource-1",
        },
        { [PAYMENT_SIGNATURE_HEADER]: makePaymentSignatureHeader() }
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.readOnChainCompliance).toHaveBeenCalledWith(WALLET_A, 3);
    expect(mocks.settlePayment).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      access: "granted",
      onChain: {
        status: "compliant",
        address: WALLET_A,
      },
    });
  });
});
