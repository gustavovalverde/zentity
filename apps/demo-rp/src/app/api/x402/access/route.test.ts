// @vitest-environment node
import {
  createDpopClient,
  type DpopClient,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  parsePaymentRequiredHeader,
} from "@zentity/sdk/rp";
import {
  fixtureKeys,
  mockMerchantPohToken,
  mockPohToken,
} from "@zentity/sdk/testing";
import { calculateJwkThumbprint } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { X402Resource } from "@/data/x402";

const mocks = vi.hoisted(() => ({
  acquirePohToken: vi.fn(),
  findResource: vi.fn(),
  getMirrorAddress: vi.fn(),
  getProofOfHumanBinding: vi.fn(),
  readOnChainCompliance: vi.fn(),
  settleViaFacilitator: vi.fn(),
  verifyViaFacilitator: vi.fn(),
}));

vi.mock("server-only", () => ({}));

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
  settleViaFacilitator: mocks.settleViaFacilitator,
  verifyViaFacilitator: mocks.verifyViaFacilitator,
}));

// One store for the whole file stands in for the database the deployed
// merchant's instances share.
vi.mock("@/lib/presentation-replay", async () => ({
  presentationReplayStore: (
    await import("@zentity/sdk/rp")
  ).createInMemoryProofOfHumanReplayStore(),
}));

vi.mock("@/lib/poh-client", () => ({
  acquirePohToken: mocks.acquirePohToken,
  getProofOfHumanBinding: mocks.getProofOfHumanBinding,
  isPohError: (result: object) => "status" in result,
}));

import { GET, POST } from "./route";

const ISSUER = "https://app.zentity.xyz";
const MERCHANT = "http://localhost:3102";
const WALLET_A = "0x0000000000000000000000000000000000000001";
const WALLET_B = "0x0000000000000000000000000000000000000002";
const CLIENT_ID = "x402-client";
const COMPACT_JWT = /eyJ[A-Za-z0-9_-]+\./;

function makeResource(overrides: Partial<X402Resource> = {}): X402Resource {
  return {
    id: "verified-identity",
    name: "Verified Identity",
    description: "Financial analytics",
    endpoint: "/api/analytics/market",
    icon: {} as X402Resource["icon"],
    price: "$0.000001",
    amount: "1",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    eip712Name: "USDC",
    eip712Version: "2",
    network: "eip155:84532",
    payTo: "0x000000000000000000000000000000000000dEaD",
    requiredIdentityStrength: "documentary_full",
    requireOnChain: false,
    responseData: { ok: true },
    ...overrides,
  };
}

const ROUTE_REQUIREMENT = {
  scheme: "exact",
  network: "eip155:84532",
  payTo: "0x000000000000000000000000000000000000dEaD",
  amount: "1",
  maxTimeoutSeconds: 300,
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  extra: { name: "USDC", version: "2" },
};

function resourceUrl(id = "verified-identity") {
  return `${MERCHANT}/api/x402/access?resourceId=${id}`;
}

function paymentSignature(accepted: unknown = ROUTE_REQUIREMENT): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      resource: { url: resourceUrl() },
      accepted,
      payload: { signature: "0xsigned", authorization: { from: WALLET_A } },
    })
  ).toString("base64");
}

describe("/api/x402/access", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Zentity's JWKS, served with the SDK's fixture signing key.
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ keys: [fixtureKeys.ed25519.publicJwk] })
        )
      );
    mocks.findResource.mockImplementation((id: string) =>
      id === "verified-identity" || id === "resource-1"
        ? makeResource()
        : undefined
    );
    mocks.getMirrorAddress.mockReturnValue(
      "0xa90723A47A14437500645Ece6049d0128A2f256D"
    );
    mocks.verifyViaFacilitator.mockResolvedValue({
      isValid: true,
      payer: WALLET_A,
    });
    mocks.settleViaFacilitator.mockResolvedValue({
      success: true,
      transaction: `0x${"1".repeat(64)}`,
      network: "eip155:84532",
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("GET, for agents", () => {
    let purchaseKey: DpopClient;

    beforeEach(async () => {
      purchaseKey = await createDpopClient();
    });

    async function merchantToken(
      overrides: {
        approved?: Record<string, unknown>;
        strengthAtLeast?: "documentary" | "documentary_full";
      } = {}
    ) {
      return mockMerchantPohToken({
        authorizationDetails: [
          {
            type: "x402_purchase",
            resource_url: resourceUrl(),
            payment_requirements: ROUTE_REQUIREMENT,
            min_identity_strength: "documentary_full",
            ...overrides.approved,
          },
        ],
        confirmationJkt: await calculateJwkThumbprint(
          purchaseKey.keyPair.publicJwk,
          "sha256"
        ),
        issuer: ISSUER,
        merchant: MERCHANT,
        strengthAtLeast: overrides.strengthAtLeast ?? "documentary_full",
        subject: "user-pairwise",
      });
    }

    async function paidRequest(token: string, accepted?: unknown) {
      return new Request(resourceUrl(), {
        headers: {
          authorization: `DPoP ${token}`,
          dpop: await purchaseKey.proofFor("GET", resourceUrl(), token),
          [PAYMENT_SIGNATURE_HEADER]: paymentSignature(accepted),
        },
      });
    }

    // R12 and R15: the 402 tells an agent what it needs, by name.
    it("answers an unpaid request with a 402 for the absolute resource URL", async () => {
      const response = await GET(new Request(resourceUrl()));

      expect(response.status).toBe(402);
      expect(response.headers.get("WWW-Authenticate")).toBe(
        'DPoP algs="ES256"'
      );
      const paymentRequired = parsePaymentRequiredHeader(
        response.headers.get(PAYMENT_REQUIRED_HEADER) as string
      );
      expect(paymentRequired.resource.url).toBe(resourceUrl());
      expect(paymentRequired.extensions).toEqual({
        "auth-hints": expect.objectContaining({ info: expect.any(Object) }),
        zentity: {
          info: { minIdentityStrength: "documentary_full" },
          schema: expect.any(Object),
        },
      });
      expect(JSON.stringify(paymentRequired)).not.toContain(
        "minComplianceLevel"
      );
    });

    // R12 and R8: a merchant-mode token is accepted, and the facilitator
    // sees no Zentity token.
    it("accepts a merchant-mode token and keeps it from the facilitator", async () => {
      const token = await merchantToken();

      const response = await GET(await paidRequest(token));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(
        expect.objectContaining({
          access: "granted",
          poh: {
            identity: { strength_at_least: "documentary_full" },
            policy: { version: "v1.0" },
          },
        })
      );
      const sentToFacilitator = JSON.stringify([
        mocks.verifyViaFacilitator.mock.calls,
        mocks.settleViaFacilitator.mock.calls,
      ]);
      expect(sentToFacilitator).not.toContain(token);
      expect(sentToFacilitator).not.toMatch(COMPACT_JWT);
    });

    it("refuses the token a second time", async () => {
      const token = await merchantToken();
      expect((await GET(await paidRequest(token))).status).toBe(200);

      const replayed = await GET(await paidRequest(token));

      expect(replayed.status).toBe(401);
      expect(replayed.headers.get("WWW-Authenticate")).toContain(
        'error="invalid_token"'
      );
    });

    // R26: a refused payment does not spend the approval.
    it("keeps the token usable after the facilitator refuses the payment", async () => {
      const token = await merchantToken();
      mocks.verifyViaFacilitator.mockResolvedValueOnce({
        isValid: false,
        invalidReason: "insufficient_funds",
      });

      const refused = await GET(await paidRequest(token));
      const retried = await GET(await paidRequest(token));

      expect(refused.status).toBe(402);
      expect(retried.status).toBe(200);
      expect(mocks.settleViaFacilitator).toHaveBeenCalledOnce();
    });

    it("refuses terms that differ from the route's", async () => {
      const token = await merchantToken({
        approved: {
          payment_requirements: { ...ROUTE_REQUIREMENT, amount: "2" },
        },
      });

      const response = await GET(await paidRequest(token));

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("approval_mismatch");
      expect(mocks.verifyViaFacilitator).not.toHaveBeenCalled();
    });

    it("refuses a token below the resource's identity strength", async () => {
      const token = await merchantToken({ strengthAtLeast: "documentary" });

      const response = await GET(await paidRequest(token));

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe(
        "insufficient_identity_strength"
      );
    });

    it("refuses a payment without a DPoP-presented token", async () => {
      const response = await GET(
        new Request(resourceUrl(), {
          headers: { [PAYMENT_SIGNATURE_HEADER]: paymentSignature() },
        })
      );

      expect(response.status).toBe(401);
      expect(mocks.verifyViaFacilitator).not.toHaveBeenCalled();
    });

    // R31: an on-chain resource has no agent path.
    it("refuses a merchant-mode token for an on-chain resource", async () => {
      mocks.findResource.mockReturnValue(
        makeResource({
          requiredIdentityStrength: "cryptographic_chip",
          requireOnChain: true,
        })
      );
      const token = await merchantToken();

      const response = await GET(await paidRequest(token));

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toContain(
        'error="invalid_token"'
      );
      expect(mocks.verifyViaFacilitator).not.toHaveBeenCalled();
    });
  });

  describe("POST, for the browser demo", () => {
    function postRequest(
      body: Record<string, unknown> = { resourceId: "verified-identity" },
      headers: Record<string, string> = {
        [PAYMENT_SIGNATURE_HEADER]: paymentSignature(),
      }
    ) {
      return new Request(`${MERCHANT}/api/x402/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    }

    function clientToken(
      overrides: { audience?: string; subject?: string } = {}
    ) {
      return mockPohToken({
        audience: overrides.audience ?? CLIENT_ID,
        confirmationJkt: "sign-in-jkt",
        issuer: ISSUER,
        subject: overrides.subject ?? "user-123",
        identityStrength: "cryptographic_chip",
        humanityProven: true,
      });
    }

    beforeEach(() => {
      mocks.getProofOfHumanBinding.mockResolvedValue({
        clientId: CLIENT_ID,
        jkt: "sign-in-jkt",
        subject: "user-123",
      });
    });

    // R37: the route obtains and checks the token; the browser sends none.
    it("obtains the user's client-mode token server side and grants access", async () => {
      mocks.acquirePohToken.mockResolvedValue({ token: await clientToken() });

      const response = await POST(postRequest());

      expect(response.status).toBe(200);
      expect(mocks.acquirePohToken).toHaveBeenCalledOnce();
      expect((await response.json()).poh).toEqual(
        expect.objectContaining({
          identity: { verified: true, strength: "cryptographic_chip" },
        })
      );
    });

    // R12: a token for another demo-rp user is refused.
    it("refuses a token issued to another user of this deployment", async () => {
      mocks.acquirePohToken.mockResolvedValue({
        token: await clientToken({ subject: "user-456" }),
      });

      const response = await POST(postRequest());

      expect(response.status).toBe(401);
      expect((await response.json()).error).toBe("poh_subject_mismatch");
      expect(mocks.verifyViaFacilitator).not.toHaveBeenCalled();
    });

    it("refuses a token audienced to another client", async () => {
      mocks.acquirePohToken.mockResolvedValue({
        token: await clientToken({ audience: "other-client" }),
      });

      const response = await POST(postRequest());

      expect(response.status).toBe(401);
      expect((await response.json()).error).toBe("invalid_poh_token");
    });

    it("rejects a malformed payment signature before calling the facilitator", async () => {
      const response = await POST(
        postRequest(undefined, { [PAYMENT_SIGNATURE_HEADER]: "not-base64" })
      );

      expect(response.status).toBe(402);
      expect(mocks.verifyViaFacilitator).not.toHaveBeenCalled();
      expect(mocks.acquirePohToken).not.toHaveBeenCalled();
    });

    it("checks on-chain compliance against the verified payer wallet", async () => {
      mocks.findResource.mockReturnValue(
        makeResource({
          requiredIdentityStrength: "cryptographic_chip",
          requireOnChain: true,
        })
      );
      mocks.acquirePohToken.mockResolvedValue({ token: await clientToken() });
      mocks.readOnChainCompliance.mockResolvedValue({
        address: WALLET_A,
        compliant: true,
      });

      const response = await POST(
        postRequest({
          resourceId: "verified-identity",
          walletAddress: WALLET_A,
        })
      );

      expect(response.status).toBe(200);
      expect(mocks.readOnChainCompliance).toHaveBeenCalledWith(WALLET_A, 3);
    });

    it("rejects on-chain requests when the caller's wallet is not the payer", async () => {
      mocks.findResource.mockReturnValue(
        makeResource({
          requiredIdentityStrength: "cryptographic_chip",
          requireOnChain: true,
        })
      );
      mocks.acquirePohToken.mockResolvedValue({ token: await clientToken() });

      const response = await POST(
        postRequest({
          resourceId: "verified-identity",
          walletAddress: WALLET_B,
        })
      );

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("wallet_address_mismatch");
      expect(mocks.settleViaFacilitator).not.toHaveBeenCalled();
    });
  });
});
