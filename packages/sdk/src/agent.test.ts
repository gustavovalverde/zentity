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

function cibaAuthResponse(authReqId = "auth-1"): Response {
  return new Response(
    JSON.stringify({ auth_req_id: authReqId, expires_in: 300, interval: 0 }),
    { status: 200 }
  );
}

function cibaTokenResponse(
  accessToken: string,
  members: Record<string, unknown> = {}
): Response {
  return new Response(
    JSON.stringify({
      access_token: accessToken,
      token_type: "DPoP",
      expires_in: 3600,
      ...members,
    }),
    { status: 200 }
  );
}

const AGENT_AUTHORIZATION = {
  capabilities: [{ action: "purchase" }],
  delegation: { depth: 0, max_depth: 1 },
  oversight: { method: "capability_grant", approved_at: 1_763_200_000 },
  aap_claims_version: 2,
};

const MANUAL_AGENT_AUTHORIZATION = {
  ...AGENT_AUTHORIZATION,
  oversight: { method: "user_verification", approved_at: 1_763_200_000 },
};

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
  // R16: an opaque access token carries no capabilities to read, and a
  // client must not read a JWT one either (RFC 9068 §6).
  it("caches an opaque grant-approved token by the token response's capabilities", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createDiscoveryResponse())
      .mockResolvedValueOnce(cibaAuthResponse())
      .mockResolvedValueOnce(
        cibaTokenResponse("opaque-capability-token", AGENT_AUTHORIZATION)
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

    expect(firstResult).toEqual(
      expect.objectContaining({
        accessToken: "opaque-capability-token",
        capabilities: [{ action: "purchase" }],
        delegation: { depth: 0, max_depth: 1 },
        aapClaimsVersion: 2,
      })
    );
    expect(secondResult).toBe(firstResult);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  // I4: a manual approval binds exactly the request the user saw.
  it("never reuses a manually approved token", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createDiscoveryResponse())
      .mockResolvedValueOnce(cibaAuthResponse("auth-1"))
      .mockResolvedValueOnce(
        cibaTokenResponse("manual-token-1", MANUAL_AGENT_AUTHORIZATION)
      )
      .mockResolvedValueOnce(cibaAuthResponse("auth-2"))
      .mockResolvedValueOnce(
        cibaTokenResponse("manual-token-2", MANUAL_AGENT_AUTHORIZATION)
      );

    const agent = createAgent({
      issuerUrl: "https://issuer.example",
      clientId: "client-1",
      dpopClient: await createDpopClient(),
      fetch: fetchFn,
      loginHint: "user@example.com",
    });
    const options = {
      action: "purchase",
      audience: "https://merchant.example",
      bindingMessage: "Authorize purchase",
      scope: "openid poh",
    };

    const first = await settle(agent.requestCapability(options));
    const second = await settle(agent.requestCapability(options));

    expect(first.accessToken).toBe("manual-token-1");
    expect(second.accessToken).toBe("manual-token-2");
    expect(fetchFn).toHaveBeenCalledTimes(5);
    vi.useRealTimers();
  });

  it("asks again when the authorization details differ from a cached grant approval", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createDiscoveryResponse())
      .mockResolvedValueOnce(cibaAuthResponse("auth-1"))
      .mockResolvedValueOnce(
        cibaTokenResponse("grant-token-1", AGENT_AUTHORIZATION)
      )
      .mockResolvedValueOnce(cibaAuthResponse("auth-2"))
      .mockResolvedValueOnce(
        cibaTokenResponse("grant-token-2", AGENT_AUTHORIZATION)
      );

    const agent = createAgent({
      issuerUrl: "https://issuer.example",
      clientId: "client-1",
      dpopClient: await createDpopClient(),
      fetch: fetchFn,
      loginHint: "user@example.com",
    });
    const request = (amount: string) => ({
      action: "purchase",
      audience: "https://merchant.example",
      authorizationDetails: [{ type: "purchase", amount }],
      bindingMessage: "Authorize purchase",
      scope: "openid poh",
    });

    const first = await settle(agent.requestCapability(request("10")));
    const second = await settle(agent.requestCapability(request("99")));
    const repeated = await agent.requestCapability(request("10"));

    expect(first.accessToken).toBe("grant-token-1");
    expect(second.accessToken).toBe("grant-token-2");
    expect(repeated).toBe(first);
    expect(fetchFn).toHaveBeenCalledTimes(5);
    const secondBody = fetchFn.mock.calls[3]?.[1]?.body as URLSearchParams;
    expect(JSON.parse(secondBody.get("authorization_details") ?? "")).toEqual([
      { type: "purchase", amount: "99" },
    ]);
    vi.useRealTimers();
  });

  it("does not read capabilities from the access token", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const jwtClaimingCapability = encodeJwtPayload({
      exp: FUTURE_EXP,
      capabilities: [{ action: "purchase" }],
    });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createDiscoveryResponse())
      .mockResolvedValueOnce(cibaAuthResponse("auth-1"))
      .mockResolvedValueOnce(cibaTokenResponse(jwtClaimingCapability))
      .mockResolvedValueOnce(cibaAuthResponse("auth-2"))
      .mockResolvedValueOnce(cibaTokenResponse(jwtClaimingCapability));

    const agent = createAgent({
      issuerUrl: "https://issuer.example",
      clientId: "client-1",
      dpopClient: await createDpopClient(),
      fetch: fetchFn,
      loginHint: "user@example.com",
    });
    const options = {
      action: "purchase",
      audience: "https://merchant.example",
      bindingMessage: "Authorize purchase",
      scope: "openid poh",
    };

    await settle(agent.requestCapability(options));
    await settle(agent.requestCapability(options));

    expect(fetchFn).toHaveBeenCalledTimes(5);
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
      .mockResolvedValueOnce(cibaAuthResponse())
      .mockResolvedValueOnce(
        cibaTokenResponse("opaque-capability-token", AGENT_AUTHORIZATION)
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
