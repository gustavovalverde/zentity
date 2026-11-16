import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_SESSION_INACTIVE_DESCRIPTION } from "./agent-contract";
import {
  beginCibaApproval,
  CibaAuthorizationError,
  CibaDeniedError,
  CibaTimeoutError,
  pollCibaToken,
  isAgentSessionInactiveError,
  pollCibaTokenOnce,
  requestCibaApproval,
} from "./ciba";
import { createDpopClient, type DpopClient } from "./rp/dpop-client";

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

let dpopClient: DpopClient;
let BASE_PARAMS: {
  bindingMessage: string;
  cibaEndpoint: string;
  clientId: string;
  dpopClient: DpopClient;
  loginHint: string;
  scope: string;
  tokenEndpoint: string;
};

function sentProofNonce(callIndex: number): unknown {
  const init = vi.mocked(fetch).mock.calls[callIndex]?.[1];
  return decodeJwt(new Headers(init?.headers).get("DPoP") ?? "").nonce;
}

function nonceChallenge(nonce: string): Response {
  return new Response(JSON.stringify({ error: "use_dpop_nonce" }), {
    status: 400,
    headers: { "DPoP-Nonce": nonce },
  });
}

describe("CIBA", () => {
  beforeEach(async () => {
    dpopClient = await createDpopClient();
    BASE_PARAMS = {
      cibaEndpoint: "http://localhost:3000/api/auth/oauth2/bc-authorize",
      tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
      clientId: "test-client",
      dpopClient,
      loginHint: "user-sub-123",
      scope: "openid",
      bindingMessage: "Approve test action",
    };
    vi.useFakeTimers(FAKE_TIMERS);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects an authorization response without auth_req_id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ expires_in: 300 }), { status: 200 })
    );

    await expect(beginCibaApproval(BASE_PARAMS)).rejects.toThrow(
      "Invalid CIBA authorization response"
    );
  });

  it("throws a status-only error when the poll error body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html>Bad Gateway</html>", { status: 502 })
    );

    await expect(
      pollCibaTokenOnce(BASE_PARAMS, {
        authReqId: "req-abc",
        expiresIn: 300,
        intervalSeconds: 5,
      })
    ).rejects.toThrow("CIBA poll error: HTTP 502");
  });

  it.each([
    [AGENT_SESSION_INACTIVE_DESCRIPTION, true],
    ["Agent-Assertion does not match this request", false],
  ])(
    "reports a refusal described as %j as an inactive session: %s",
    async (description, inactive) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        Response.json(
          { error: "invalid_request", error_description: description },
          { status: 400 }
        )
      );

      const error = await beginCibaApproval(BASE_PARAMS).catch(
        (caught: unknown) => caught
      );

      expect(error).toBeInstanceOf(CibaAuthorizationError);
      expect(error).toMatchObject({
        status: 400,
        error: "invalid_request",
        errorDescription: description,
      });
      expect(isAgentSessionInactiveError(error)).toBe(inactive);
    }
  );

  it("keeps a refusal without an OAuth error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Bad Gateway", { status: 502 })
    );

    const error = await beginCibaApproval(BASE_PARAMS).catch(
      (caught: unknown) => caught
    );

    expect(error).toMatchObject({
      message: "CIBA authorization failed: 502 Bad Gateway",
      status: 502,
      error: undefined,
    });
    expect(isAgentSessionInactiveError(error)).toBe(false);
  });

  it("rejects an approved token response without access_token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ token_type: "DPoP" }), { status: 200 })
    );

    await expect(
      pollCibaTokenOnce(BASE_PARAMS, {
        authReqId: "req-abc",
        expiresIn: 300,
        intervalSeconds: 5,
      })
    ).rejects.toThrow("Invalid CIBA token response");
  });

  it("begins approval and returns pending authorization metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          auth_req_id: "req-abc",
          expires_in: 300,
          interval: 7,
        }),
        { status: 200 }
      )
    );

    const result = await beginCibaApproval(BASE_PARAMS);

    expect(result).toEqual({
      authReqId: "req-abc",
      expiresIn: 300,
      intervalSeconds: 7,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // A confidential client (MCP HTTP) authenticates with client_secret_basic.
  it("sends a client secret as HTTP Basic on the request and the poll", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ auth_req_id: "req-abc", expires_in: 300, interval: 5 })
      )
      .mockResolvedValueOnce(
        Response.json({ error: "authorization_pending" }, { status: 400 })
      );
    const confidential = {
      ...BASE_PARAMS,
      clientId: "mcp server",
      clientSecret: "s3cr:et",
    };

    const pending = await beginCibaApproval(confidential);
    await pollCibaTokenOnce(confidential, pending);

    for (const [, init] of vi.mocked(fetch).mock.calls) {
      const headers = new Headers(init?.headers);
      // RFC 6749 §2.3.1: both values are form-url-encoded before base64.
      expect(headers.get("Authorization")).toBe(
        `Basic ${btoa("mcp+server:s3cr%3Aet")}`
      );
      expect(new URLSearchParams(String(init?.body)).has("client_id")).toBe(
        false
      );
    }
  });

  it("retries the authorization request once with a DPoP nonce", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "use_dpop_nonce" }), {
          status: 400,
          headers: { "DPoP-Nonce": "nonce-1" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_req_id: "req-abc",
            expires_in: 300,
            interval: 7,
          }),
          { status: 200 }
        )
      );

    const result = await beginCibaApproval(BASE_PARAMS);

    expect(result.authReqId).toBe("req-abc");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sentProofNonce(0)).toBeUndefined();
    expect(sentProofNonce(1)).toBe("nonce-1");
  });

  it("keeps polling when a pending error carries a null error_description", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "authorization_pending",
          error_description: null,
        }),
        { status: 400 }
      )
    );

    const result = await pollCibaTokenOnce(BASE_PARAMS, {
      authReqId: "req-pending",
      expiresIn: 300,
      intervalSeconds: 5,
    });

    expect(result.status).toBe("pending");
  });

  it("polls once and returns pending metadata without blocking", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "authorization_pending" }), {
        status: 400,
      })
    );

    const result = await pollCibaTokenOnce(
      {
        clientId: BASE_PARAMS.clientId,
        dpopClient: BASE_PARAMS.dpopClient,
        tokenEndpoint: BASE_PARAMS.tokenEndpoint,
      },
      {
        authReqId: "req-pending",
        expiresIn: 300,
        intervalSeconds: 5,
      }
    );

    expect(result).toEqual({
      status: "pending",
      pendingAuthorization: {
        authReqId: "req-pending",
        expiresIn: 300,
        intervalSeconds: 5,
      },
    });
  });

  it("requests approval, emits handoff metadata, and polls the token endpoint", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_req_id: "req-abc",
            expires_in: 300,
            interval: 0,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "ciba-token",
            token_type: "DPoP",
            expires_in: 3600,
          }),
          { status: 200 }
        )
      );

    const onPendingApproval = vi.fn().mockImplementation((pending) => {
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(pending).toEqual({
        approvalUrl: "http://localhost:3000/approve/req-abc?source=cli_handoff",
        authReqId: "req-abc",
        expiresIn: 300,
        intervalSeconds: 0,
      });
    });

    const promise = requestCibaApproval({
      ...BASE_PARAMS,
      resource: "https://merchant.example",
      onPendingApproval,
    });
    const result = await settle(promise);

    expect(result.accessToken).toBe("ciba-token");
    expect(onPendingApproval).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("polls through authorization_pending then succeeds", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_req_id: "req-poll",
            expires_in: 300,
            interval: 0,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "authorization_pending" }), {
          status: 400,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "polled-token",
            token_type: "DPoP",
          }),
          { status: 200 }
        )
      );

    const promise = requestCibaApproval(BASE_PARAMS);
    const result = await settle(promise);

    expect(result.accessToken).toBe("polled-token");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("increases interval on slow_down", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_req_id: "req-slow",
            expires_in: 300,
            interval: 0,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "slow_down" }), { status: 400 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "slow-token",
            token_type: "DPoP",
          }),
          { status: 200 }
        )
      );

    const promise = requestCibaApproval(BASE_PARAMS);
    const result = await settle(promise);

    expect(result.accessToken).toBe("slow-token");
  });

  it("throws CibaDeniedError on access_denied", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_req_id: "req-deny",
            expires_in: 300,
            interval: 0,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "access_denied",
            error_description: "User clicked deny",
          }),
          { status: 403 }
        )
      );

    const promise = requestCibaApproval(BASE_PARAMS);
    const assertion = expect(promise).rejects.toThrow(CibaDeniedError);
    await settle(promise).catch(() => undefined);
    await assertion;
  });

  it("throws CibaTimeoutError on expired_token", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_req_id: "req-expire",
            expires_in: 300,
            interval: 0,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "expired_token" }), {
          status: 400,
        })
      );

    const promise = requestCibaApproval(BASE_PARAMS);
    const assertion = expect(promise).rejects.toThrow(CibaTimeoutError);
    await settle(promise).catch(() => undefined);
    await assertion;
  });

  it("includes authorization_details in the approved result", async () => {
    const authorizationDetails = [{ type: "purchase", merchant: "Acme" }];

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_req_id: "req-ad",
            expires_in: 300,
            interval: 0,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "ad-token",
            token_type: "DPoP",
            authorization_details: authorizationDetails,
          }),
          { status: 200 }
        )
      );

    const promise = requestCibaApproval({
      ...BASE_PARAMS,
      authorizationDetails,
    });
    const result = await settle(promise);

    expect(result.authorizationDetails).toEqual(authorizationDetails);
  });

  it.each([
    [
      "states how the user approved",
      { method: "user_verification", approved_at: 1_763_200_000 },
      { method: "user_verification", approved_at: 1_763_200_000 },
    ],
    [
      "ignores an oversight member it does not understand",
      { method: "biometric", approved_at: 1_763_200_000 },
      undefined,
    ],
  ])("%s", async (_case, oversight, expected) => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ auth_req_id: "req-ov", expires_in: 300, interval: 0 }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "ov-token",
            token_type: "DPoP",
            oversight,
          }),
          { status: 200 }
        )
      );

    const result = await settle(requestCibaApproval(BASE_PARAMS));

    expect(result.oversight).toEqual(expected);
  });

  it("reads a verified agent's authorization from the token response", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ auth_req_id: "req-ag", expires_in: 300, interval: 0 }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "opaque-agent-token",
            token_type: "DPoP",
            oversight: { method: "capability_grant", approved_at: 1 },
            capabilities: [
              { action: "check_compliance" },
              { action: "purchase", constraints: [{ field: "x", op: "max", value: 5 }] },
            ],
            delegation: { depth: 0, max_depth: 1 },
            aap_claims_version: 2,
          }),
          { status: 200 }
        )
      );

    const result = await settle(requestCibaApproval(BASE_PARAMS));

    expect(result).toEqual(
      expect.objectContaining({
        accessToken: "opaque-agent-token",
        capabilities: [
          { action: "check_compliance" },
          {
            action: "purchase",
            constraints: [{ field: "x", op: "max", value: 5 }],
          },
        ],
        delegation: { depth: 0, max_depth: 1 },
        aapClaimsVersion: 2,
      })
    );
  });

  it("ignores agent members of another claims version", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ auth_req_id: "req-v1", expires_in: 300, interval: 0 }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "token",
            token_type: "DPoP",
            capabilities: "purchase",
            aap_claims_version: 1,
          }),
          { status: 200 }
        )
      );

    const result = await settle(requestCibaApproval(BASE_PARAMS));

    expect(result).not.toHaveProperty("capabilities");
    expect(result).not.toHaveProperty("aapClaimsVersion");
  });

  it("pollCibaToken completes approval with an immediate token response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "ciba-token",
          token_type: "DPoP",
          expires_in: 3600,
        }),
        { status: 200 }
      )
    );

    const promise = pollCibaToken(
      {
        clientId: BASE_PARAMS.clientId,
        dpopClient: BASE_PARAMS.dpopClient,
        tokenEndpoint: BASE_PARAMS.tokenEndpoint,
      },
      {
        authReqId: "req-abc",
        expiresIn: 300,
        intervalSeconds: 0,
      }
    );
    const result = await settle(promise);

    expect(result.accessToken).toBe("ciba-token");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("survives an expired DPoP nonce while polling", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_req_id: "req-nonce",
            expires_in: 300,
            interval: 0,
          }),
          { status: 200, headers: { "DPoP-Nonce": "nonce-1" } }
        )
      )
      .mockResolvedValueOnce(nonceChallenge("nonce-2"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "nonce-token", token_type: "DPoP" }),
          { status: 200 }
        )
      );

    const promise = requestCibaApproval(BASE_PARAMS);
    const result = await settle(promise);

    expect(result.accessToken).toBe("nonce-token");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sentProofNonce(1)).toBe("nonce-1");
    expect(sentProofNonce(2)).toBe("nonce-2");
  });

  it("keeps polling when the nonce retry is also rejected", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nonceChallenge("nonce-1"))
      .mockResolvedValueOnce(nonceChallenge("nonce-2"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "late-token", token_type: "DPoP" }),
          { status: 200 }
        )
      );

    const promise = pollCibaToken(
      {
        clientId: BASE_PARAMS.clientId,
        dpopClient: BASE_PARAMS.dpopClient,
        tokenEndpoint: BASE_PARAMS.tokenEndpoint,
      },
      { authReqId: "req-stale", expiresIn: 300, intervalSeconds: 5 }
    );
    const result = await settle(promise);

    expect(result.accessToken).toBe("late-token");
    expect(sentProofNonce(2)).toBe("nonce-2");
  });
});
