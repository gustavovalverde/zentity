import { describe, expect, it, vi } from "vitest";

import { createAgent } from "./agent";
import { createDpopClient } from "./rp/dpop-client";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  parsePaymentSignatureHeader,
} from "./rp/payment-required";

const FAKE_TIMERS = {
  toFake: ["setTimeout", "clearTimeout", "Date"],
} satisfies Parameters<typeof vi.useFakeTimers>[0];

// DPoP proofs are signed with real WebCrypto, which resolves outside the
// fake clock, so timers are drained until the promise settles.
async function settle<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  while (!settled) {
    await vi.runAllTimersAsync();
    await new Promise((resolve) => setImmediate(resolve));
  }
  return promise;
}

const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;

function encodeJwtPayload(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
    "base64url"
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

function createDiscoveryResponse(): Response {
  return new Response(
    JSON.stringify({
      issuer: "https://issuer.example",
      authorization_endpoint: "https://issuer.example/oauth2/authorize",
      backchannel_authentication_endpoint:
        "https://issuer.example/oauth2/bc-authorize",
      token_endpoint: "https://issuer.example/oauth2/token",
    }),
    { status: 200 }
  );
}

function createCapabilityToken(action = "purchase"): string {
  return encodeJwtPayload({
    exp: FUTURE_EXP,
    capabilities: [{ action }],
  });
}

function createPaymentRequiredHeader(): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
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
      resource: { url: "https://merchant.example/api/purchase" },
      extensions: {
        zentity: {
          minComplianceLevel: 2,
          pohIssuer: "https://issuer.example",
        },
      },
    })
  ).toString("base64");
}

describe("createAgent", () => {
  it("caches capability tokens by client, audience, and action", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createDiscoveryResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_req_id: "auth-1",
            expires_in: 300,
            interval: 0,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: createCapabilityToken("purchase"),
            token_type: "DPoP",
            expires_in: 3600,
          }),
          { status: 200 }
        )
      );

    const agent = createAgent({
      issuerUrl: "https://issuer.example",
      clientId: "client-1",
      dpopClient: await createDpopClient(),
      fetch: fetchFn,
      loginHint: "user@example.com",
    });

    const first = agent.requestCapability({
      action: "purchase",
      audience: "https://merchant.example",
      bindingMessage: "Authorize purchase",
      scope: "openid poh",
    });
    const firstResult = await settle(first);

    const secondResult = await agent.requestCapability({
      action: "purchase",
      audience: "https://merchant.example",
      bindingMessage: "Authorize purchase",
      scope: "openid poh",
    });

    expect(secondResult.accessToken).toBe(firstResult.accessToken);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("auto-retries x402 responses with a proof-of-human token", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("payment required", {
          status: 402,
          headers: { [PAYMENT_REQUIRED_HEADER]: createPaymentRequiredHeader() },
        })
      )
      .mockResolvedValueOnce(createDiscoveryResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_req_id: "auth-1",
            expires_in: 300,
            interval: 0,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: createCapabilityToken("purchase"),
            token_type: "DPoP",
            expires_in: 3600,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: encodeJwtPayload({
              sub: "user-1",
              exp: FUTURE_EXP,
              poh: {
                identity: {
                  verified: true,
                  strength: "documentary_full",
                },
                humanity: { proven: false },
                policy: { version: "v1.0" },
              },
            }),
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access: "granted" }))
      );

    const agent = createAgent({
      issuerUrl: "https://issuer.example",
      clientId: "client-1",
      dpopClient: await createDpopClient(),
      fetch: fetchFn,
      loginHint: "user@example.com",
    });

    const responsePromise = agent.fetch("https://merchant.example/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceId: "resource-1" }),
      x402: { autoPayWithProofOfHuman: true },
    });
    const response = await settle(responsePromise);

    expect(response.status).toBe(200);
    const cibaBody = fetchFn.mock.calls[2]?.[1]?.body as URLSearchParams;
    expect(cibaBody.get("resource")).toBe("https://issuer.example");
    const retryRequest = fetchFn.mock.calls[5]?.[0] as Request;
    await expect(retryRequest.json()).resolves.toEqual({
      resourceId: "resource-1",
    });
    const paymentPayload = parsePaymentSignatureHeader(
      retryRequest.headers.get(PAYMENT_SIGNATURE_HEADER) as string
    );
    expect(paymentPayload.extensions?.zentity).toMatchObject({
      pohToken: expect.any(String),
    });
    vi.useRealTimers();
  });
});
