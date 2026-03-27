import type { X402Resource } from "@/data/x402";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildRouteConfig: vi.fn(),
  checkOnChainAttestation: vi.fn(),
  findResource: vi.fn(),
  getRegistryAddress: vi.fn(),
  getStoredDpopJkt: vi.fn(),
  settlePayment: vi.fn(),
  verifyPayment: vi.fn(),
  verifyPohToken: vi.fn(),
}));

vi.mock("@/data/x402", () => ({
  findResource: mocks.findResource,
}));

vi.mock("@/lib/chain", () => ({
  checkOnChainAttestation: mocks.checkOnChainAttestation,
  getRegistryAddress: mocks.getRegistryAddress,
}));

vi.mock("@/lib/facilitator", () => ({
  settlePayment: mocks.settlePayment,
  verifyPayment: mocks.verifyPayment,
}));

vi.mock("@/lib/poh-client", () => ({
  getStoredDpopJkt: mocks.getStoredDpopJkt,
}));

vi.mock("@/lib/poh-verifier", () => ({
  verifyPohToken: mocks.verifyPohToken,
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

describe("/api/x402/access POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.getRegistryAddress.mockReturnValue(
      "0xa90723A47A14437500645Ece6049d0128A2f256D"
    );
    mocks.verifyPayment.mockResolvedValue({
      isValid: true,
      payer: WALLET_A,
    });
    mocks.verifyPohToken.mockResolvedValue({
      sub: "user-123",
      exp: 1_800_000_000,
      poh: {
        tier: 3,
        verified: true,
        sybil_resistant: true,
        method: "ocr",
      },
    });
    mocks.checkOnChainAttestation.mockResolvedValue(true);
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
        { "PAYMENT-SIGNATURE": Buffer.from("{}").toString("base64") }
      )
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "compliance_required",
      required: 2,
    });
    expect(mocks.settlePayment).not.toHaveBeenCalled();
  });

  it("rejects on-chain requests when the caller-provided wallet mismatches the payer", async () => {
    mocks.findResource.mockReturnValue(makeResource());

    const response = await POST(
      makeRequest(
        {
          resourceId: "resource-1",
          pohToken: "poh-token",
          walletAddress: WALLET_B,
        },
        { "PAYMENT-SIGNATURE": Buffer.from("{}").toString("base64") }
      )
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "wallet_address_mismatch",
      detail: "On-chain attestation must match the wallet that signed the payment.",
      payer: WALLET_A,
    });
    expect(mocks.checkOnChainAttestation).not.toHaveBeenCalled();
    expect(mocks.settlePayment).not.toHaveBeenCalled();
  });

  it("checks on-chain attestation against the verified payer wallet", async () => {
    mocks.findResource.mockReturnValue(makeResource());

    const response = await POST(
      makeRequest(
        {
          resourceId: "resource-1",
          pohToken: "poh-token",
        },
        { "PAYMENT-SIGNATURE": Buffer.from("{}").toString("base64") }
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.checkOnChainAttestation).toHaveBeenCalledWith(WALLET_A);
    expect(mocks.settlePayment).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      access: "granted",
      onChain: {
        status: "attested",
        address: WALLET_A,
      },
    });
  });
});
