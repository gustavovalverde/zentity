import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginCibaApproval,
  CibaDeniedError,
  CibaTimeoutError,
  type DpopProofSigner,
  pollCibaToken,
  pollCibaTokenOnce,
  requestCibaApproval,
} from "./ciba";

const dpopSigner: DpopProofSigner = {
  proofFor: vi.fn().mockResolvedValue("mock-dpop-proof"),
};

const BASE_PARAMS = {
  cibaEndpoint: "http://localhost:3000/api/auth/oauth2/bc-authorize",
  tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
  clientId: "test-client",
  dpopSigner,
  loginHint: "user-sub-123",
  scope: "openid",
  bindingMessage: "Approve test action",
};

describe("CIBA", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(dpopSigner.proofFor).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
      dpopNonce: undefined,
      expiresIn: 300,
      intervalSeconds: 7,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
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

    expect(result.dpopNonce).toBe("nonce-1");
    expect(dpopSigner.proofFor).toHaveBeenNthCalledWith(
      2,
      "POST",
      BASE_PARAMS.cibaEndpoint,
      undefined,
      "nonce-1"
    );
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
        dpopSigner: BASE_PARAMS.dpopSigner,
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
        dpopNonce: undefined,
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
    await vi.runAllTimersAsync();
    const result = await promise;

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
    await vi.runAllTimersAsync();
    const result = await promise;

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
    await vi.runAllTimersAsync();
    const result = await promise;

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
    await vi.runAllTimersAsync();
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
    await vi.runAllTimersAsync();
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
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.authorizationDetails).toEqual(authorizationDetails);
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
        dpopSigner: BASE_PARAMS.dpopSigner,
        tokenEndpoint: BASE_PARAMS.tokenEndpoint,
      },
      {
        authReqId: "req-abc",
        expiresIn: 300,
        intervalSeconds: 0,
      }
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.accessToken).toBe("ciba-token");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
