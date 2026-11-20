import { describe, expect, it, vi } from "vitest";

import {
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  jwtVerify,
} from "jose";

import {
  createStubSchemeClient,
  paymentRequiredResponse,
  RESOURCE_URL,
  requirement,
  TEST_ISSUER,
} from "./__fixtures__/x402-merchant";
import { createAgent } from "./agent";
import { createDpopClient } from "./rp/dpop-client";
import { PAYMENT_SIGNATURE_HEADER } from "./rp/payment-required";

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

const MERCHANT_POH_TOKEN = encodeJwtPayload({
  aud: "https://merchant.example",
  exp: FUTURE_EXP,
  poh: {
    identity: { strength_at_least: "documentary_full" },
    policy: { version: "v1.0" },
  },
});

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

describe("createAgent", () => {
  it("authenticates CIBA initiation and polling against the discovered issuer", async () => {
    const keys = await generateKeyPair("ES256", { extractable: true });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createDiscoveryResponse())
      .mockResolvedValueOnce(cibaAuthResponse())
      .mockResolvedValueOnce(cibaTokenResponse("approved"));
    const agent = createAgent({
      clientAuth: { privateJwk: await exportJWK(keys.privateKey) },
      clientId: "registered-install",
      issuerUrl: "https://issuer.example",
      dpopClient: await createDpopClient(),
      fetch: fetchFn,
      loginHint: "approved-subject",
    });
    await agent.requestApproval({
      scope: "openid",
      bindingMessage: "Confirm sign-in",
    });
    for (const [, init] of fetchFn.mock.calls.slice(1)) {
      const params = new URLSearchParams(String(init?.body));
      const { payload } = await jwtVerify(
        params.get("client_assertion") as string,
        keys.publicKey,
        { audience: "https://issuer.example", issuer: "registered-install" }
      );
      expect(payload.sub).toBe("registered-install");
    }
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

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

  // R16 and R11: the agent sends the strict x402_purchase entry, one CIBA
  // request per purchase, each under its own key.
  it("approves each x402 purchase under a fresh key with the merchant's requirement", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const cibaBodies: URLSearchParams[] = [];
    const proofKeys: Record<string, string[]> = {};
    function recordProofKey(path: string, headers: Headers) {
      const proof = headers.get("DPoP");
      if (proof) {
        const jwk = decodeProtectedHeader(proof).jwk as { x: string };
        proofKeys[path] = [...(proofKeys[path] ?? []), jwk.x];
      }
    }
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const headers = new Headers(init?.headers ?? request.headers);
      if (url.pathname.endsWith("/.well-known/openid-configuration")) {
        return new Response(
          JSON.stringify({
            issuer: TEST_ISSUER,
            authorization_endpoint: `${TEST_ISSUER}/oauth2/authorize`,
            backchannel_authentication_endpoint: `${TEST_ISSUER}/oauth2/bc-authorize`,
            token_endpoint: `${TEST_ISSUER}/oauth2/token`,
          })
        );
      }
      if (url.pathname.endsWith("/oauth2/bc-authorize")) {
        cibaBodies.push(init?.body as URLSearchParams);
        return cibaAuthResponse(`auth-${cibaBodies.length}`);
      }
      if (url.pathname.endsWith("/oauth2/token")) {
        recordProofKey("token", headers);
        const sent = cibaBodies.at(-1)?.get("authorization_details") as string;
        return cibaTokenResponse("opaque-x402-token", {
          authorization_details: JSON.parse(sent),
          oversight: { method: "user_verification", approved_at: 1 },
        });
      }
      if (url.pathname.endsWith("/proof-of-human")) {
        recordProofKey("mint", headers);
        return new Response(
          JSON.stringify({
            token: MERCHANT_POH_TOKEN,
            token_type: "DPoP",
            expires_in: 300,
          })
        );
      }
      if (headers.get(PAYMENT_SIGNATURE_HEADER)) {
        recordProofKey("merchant", headers);
        return new Response(JSON.stringify({ access: "granted" }));
      }
      return paymentRequiredResponse();
    });
    const installation = await createDpopClient();

    const agent = createAgent({
      issuerUrl: TEST_ISSUER,
      clientId: "client-1",
      dpopClient: installation,
      fetch: fetchFn,
      loginHint: "pairwise-sub",
      resource: "https://issuer.example",
      x402SchemeClient: createStubSchemeClient(),
    });
    const x402 = {
      maxAmount: "1",
      maxIdentityStrength: "documentary_full",
    } as const;

    const first = await settle(agent.fetch(RESOURCE_URL, { x402 }));
    const second = await settle(agent.fetch(RESOURCE_URL, { x402 }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(cibaBodies).toHaveLength(2);
    for (const body of cibaBodies) {
      expect(body.get("scope")).toBe("openid poh");
      expect(body.get("binding_message")).toBe(
        "Proof-of-Human for merchant.example"
      );
      expect(body.has("resource")).toBe(false);
      const [entry] = JSON.parse(body.get("authorization_details") as string);
      expect(entry).toEqual({
        type: "x402_purchase",
        resource_url: RESOURCE_URL,
        resource_description: "Financial analytics",
        payment_requirements: requirement(),
        min_identity_strength: "documentary_full",
      });
      expect(entry).not.toHaveProperty("resource");
    }

    const installationKey = installation.keyPair.publicJwk.x;
    const [firstKey, secondKey] = proofKeys.token ?? [];
    expect(firstKey).toBeDefined();
    expect(secondKey).not.toBe(firstKey);
    expect(proofKeys.mint).toEqual([firstKey, secondKey]);
    expect(proofKeys.merchant).toEqual([firstKey, secondKey]);
    expect(Object.values(proofKeys).flat()).not.toContain(installationKey);
    vi.useRealTimers();
  });

  it("refuses a purchase whose approved details differ from the request", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/.well-known/openid-configuration")) {
        return new Response(
          JSON.stringify({
            issuer: TEST_ISSUER,
            authorization_endpoint: `${TEST_ISSUER}/oauth2/authorize`,
            backchannel_authentication_endpoint: `${TEST_ISSUER}/oauth2/bc-authorize`,
            token_endpoint: `${TEST_ISSUER}/oauth2/token`,
          })
        );
      }
      if (url.pathname.endsWith("/oauth2/bc-authorize")) {
        return cibaAuthResponse();
      }
      if (url.pathname.endsWith("/oauth2/token")) {
        return cibaTokenResponse("opaque-x402-token", {
          authorization_details: [{ type: "x402_purchase", changed: true }],
        });
      }
      return paymentRequiredResponse();
    });
    const agent = createAgent({
      issuerUrl: TEST_ISSUER,
      clientId: "client-1",
      dpopClient: await createDpopClient(),
      fetch: fetchFn,
      loginHint: "pairwise-sub",
      x402SchemeClient: createStubSchemeClient(),
    });

    await expect(
      settle(
        agent.fetch(RESOURCE_URL, {
          x402: { maxAmount: "1", maxIdentityStrength: "documentary_full" },
        })
      )
    ).rejects.toMatchObject({ code: "approval_mismatch" });
    vi.useRealTimers();
  });
});
