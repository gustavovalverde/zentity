import {
  intentHash,
  intentHashToWireString,
  networkToChainReference,
  paymentUriToCaip10,
} from "@zentity/sdk/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  readDcrClient: vi.fn(),
  prepareAgentAssertion: vi.fn(),
  requestCibaApproval: vi.fn(),
  createWalletSpendRequest: vi.fn(),
  settlePayment: vi.fn(),
  proofFor: vi.fn(async () => "settle-dpop-proof"),
  // A single shared client instance, mirroring getZpayDpopClient's
  // memoization, so the test can assert CIBA and the wallet call use one key.
  dpopClient: {} as { keyPair: unknown; proofFor: unknown },
}));
mocks.dpopClient = {
  keyPair: { privateJwk: {}, publicJwk: {} },
  proofFor: mocks.proofFor,
};

// `server-only` throws when imported outside an RSC; stub it so the route's
// real problem-json + zpay-client (ZpayError) modules load under vitest.
vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: vi.fn(async () => ({ api: { getSession: mocks.getSession } })),
}));

vi.mock("@/lib/dcr", () => ({ readDcrClient: mocks.readDcrClient }));

vi.mock("@/lib/agent-runtime", () => ({
  prepareAgentAssertionForScenario: mocks.prepareAgentAssertion,
}));

vi.mock("@/lib/zpay-dpop", () => ({
  getZpayDpopClient: vi.fn(async () => mocks.dpopClient),
}));

vi.mock("@/lib/env", () => ({
  env: {
    ZPAY_URL: "http://zpay:8080",
    ZSPEND_URL: "http://zspend:8090",
    ZENTITY_URL: "http://zentity:3000",
  },
}));

vi.mock("@zentity/sdk", async () => {
  const actual = await vi.importActual<typeof import("@zentity/sdk")>(
    "@zentity/sdk"
  );
  return { ...actual, requestCibaApproval: mocks.requestCibaApproval };
});

vi.mock("@zentity/sdk/rp", async () => {
  const actual = await vi.importActual<typeof import("@zentity/sdk/rp")>(
    "@zentity/sdk/rp"
  );
  return { ...actual, createWalletSpendRequest: mocks.createWalletSpendRequest };
});

vi.mock("@/lib/zpay-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/zpay-client")>(
    "@/lib/zpay-client"
  );
  return { ...actual, settlePayment: mocks.settlePayment };
});

import { POST } from "./route";
import { ZpayError } from "@/lib/zpay-client";

const PAYMENT_URI = "zcash:utest1qqexampleshieldedaddress0000";
const VALID_BODY = {
  payment_uri: PAYMENT_URI,
  payment_id: "pay_1",
  network: "testnet" as const,
  target_expiry_height: 4_056_276,
  amount_zat: 100_000,
  merchant: "Aether",
};

const SIGNED_PAYLOAD = {
  format: "raw-zcash-v5",
  bytes: "AQID",
  tx_id: "deadbeef",
  fee: { currency: "ZEC", value: "1000", unit: "base" },
  expires_at: { kind: "block_height", value: 4_056_276 },
};

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://demo-rp/api/aether/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function expectedIntentHash(): string {
  const reference = networkToChainReference("testnet");
  return intentHashToWireString(
    intentHash({
      chainNamespace: "zcash",
      chainReference: reference,
      recipientCaip10: paymentUriToCaip10(PAYMENT_URI, reference),
      amountValue: BigInt(VALID_BODY.amount_zat),
      amountUnit: "base",
      paymentId: VALID_BODY.payment_id,
      expiryHeight: BigInt(VALID_BODY.target_expiry_height),
    })
  );
}

describe("POST /api/aether/sign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });
    mocks.readDcrClient.mockResolvedValue({ clientId: "aether-client" });
    mocks.prepareAgentAssertion.mockResolvedValue("agent-assertion-jwt");
    mocks.requestCibaApproval.mockResolvedValue({ accessToken: "at.jwt" });
    mocks.createWalletSpendRequest.mockResolvedValue({
      headers: { authorization: "DPoP at.jwt", dpop: "wallet-dpop-proof" },
      body: {},
    });
    mocks.proofFor.mockResolvedValue("settle-dpop-proof");
    mocks.settlePayment.mockResolvedValue({
      payment_id: "pay_1",
      broadcast_outcome: { kind: "accepted", transaction_id: "tx_abc" },
    });
  });

  it("rejects a body missing amount_zat/target_expiry_height (locks the client contract)", async () => {
    const res = await post({
      payment_uri: PAYMENT_URI,
      payment_id: "pay_1",
      network: "testnet",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
  });

  it("requires a session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await post(VALID_BODY);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("session_required");
  });

  it("rebuilds the RAR server-side and settles on the happy path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ signed_payload: SIGNED_PAYLOAD }, { status: 200 })
      )
    );

    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transaction_id).toBe("tx_abc");
    expect(body.broadcast_kind).toBe("accepted");

    // The RAR handed to CIBA is rebuilt server-side with the canonical intent hash.
    const cibaArgs = mocks.requestCibaApproval.mock.calls.at(0)?.[0] as {
      authorizationDetails: Array<{ intent_hash: string; type: string }>;
      dpopSigner: unknown;
      scope: string;
    };
    expect(cibaArgs.scope).toContain("payment_authorization:sign");
    const rar = cibaArgs.authorizationDetails[0];
    expect(rar?.type).toBe("payment_authorization");
    expect(rar?.intent_hash).toBe(expectedIntentHash());

    // CIBA and the wallet call use the same seed-derived DPoP client.
    const walletSpendArgs = mocks.createWalletSpendRequest.mock.calls.at(0)?.[0] as {
      dpopClient: unknown;
    };
    expect(walletSpendArgs.dpopClient).toBe(cibaArgs.dpopSigner);

    vi.unstubAllGlobals();
  });

  it("passes a wallet problem+json through verbatim (D-H)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { kind: "intent_mismatch", title: "intent mismatch", detail: "drift" },
          {
            status: 403,
            headers: { "content-type": "application/problem+json" },
          }
        )
      )
    );

    const res = await post(VALID_BODY);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("intent_mismatch");
    expect(body.error_description).toBe("drift");

    vi.unstubAllGlobals();
  });

  it("passes a settle ZpayError problem through verbatim (D-H)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ signed_payload: SIGNED_PAYLOAD }, { status: 200 })
      )
    );
    mocks.settlePayment.mockRejectedValue(
      new ZpayError({
        endpoint: "/x402/v2/settle",
        status: 409,
        problem: { kind: "rejected", title: "double spend" },
        message: "rejected",
      })
    );

    const res = await post(VALID_BODY);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("rejected");

    vi.unstubAllGlobals();
  });
});
