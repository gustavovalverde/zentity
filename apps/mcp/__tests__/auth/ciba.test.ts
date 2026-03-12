import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DpopKeyPair } from "../../src/auth/dpop.js";

vi.mock("../../src/auth/dpop.js", () => ({
  createDpopProof: vi.fn().mockResolvedValue("mock-dpop-proof"),
  extractDpopNonce: vi.fn().mockReturnValue(undefined),
}));

import {
  CibaDeniedError,
  CibaTimeoutError,
  requestCibaApproval,
} from "../../src/auth/ciba.js";

const mockDpopKey: DpopKeyPair = {
  privateJwk: { kty: "EC", crv: "P-256" },
  publicJwk: { kty: "EC", crv: "P-256" },
};

const BASE_PARAMS = {
  cibaEndpoint: "http://localhost:3000/api/auth/oauth2/bc-authorize",
  tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
  clientId: "test-client",
  dpopKey: mockDpopKey,
  loginHint: "user-sub-123",
  scope: "openid",
  bindingMessage: "Approve test action",
};

describe("CIBA", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("completes approval flow with immediate token response", async () => {
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

    const promise = requestCibaApproval(BASE_PARAMS);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.accessToken).toBe("ciba-token");
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

  it("includes authorization_details in result when present", async () => {
    const authzDetails = [{ type: "purchase", merchant: "Acme" }];

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
            authorization_details: authzDetails,
          }),
          { status: 200 }
        )
      );

    const promise = requestCibaApproval({
      ...BASE_PARAMS,
      authorizationDetails: authzDetails,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.authorizationDetails).toEqual(authzDetails);
  });
});
