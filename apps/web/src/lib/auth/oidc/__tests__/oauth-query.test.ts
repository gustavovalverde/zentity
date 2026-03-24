import { describe, expect, it } from "vitest";

import { computeOAuthRequestKey } from "../oauth-query";

describe("computeOAuthRequestKey", () => {
  it("normalizes equivalent OAuth queries to the same request key", () => {
    const queryA = {
      client_id: "client-a",
      response_type: "code",
      scope: "openid identity.name",
      claims: {
        id_token: { acr: null, auth_time: null },
        userinfo: { email: null, name: null },
      },
      exp: 123,
      sig: "signature-a",
    };

    const queryB = {
      scope: "openid identity.name",
      claims: {
        userinfo: { name: null, email: null },
        id_token: { auth_time: null, acr: null },
      },
      response_type: "code",
      client_id: "client-a",
      sig: "signature-b",
      exp: 999,
    };

    expect(computeOAuthRequestKey(queryA)).toBe(computeOAuthRequestKey(queryB));
  });

  it("produces a stable request key across parameter ordering", () => {
    const keyA = computeOAuthRequestKey(
      new URLSearchParams([
        ["scope", "openid identity.name"],
        ["client_id", "client-a"],
        ["response_type", "code"],
        ["sig", "ignored"],
        ["exp", "123"],
      ])
    );
    const keyB = computeOAuthRequestKey(
      new URLSearchParams([
        ["response_type", "code"],
        ["client_id", "client-a"],
        ["scope", "openid identity.name"],
        ["exp", "456"],
        ["sig", "different"],
      ])
    );

    expect(keyA).toBe(keyB);
  });

  it("distinguishes materially different OAuth requests", () => {
    const base = computeOAuthRequestKey({
      client_id: "client-a",
      response_type: "code",
      scope: "openid identity.name",
    });
    const altered = computeOAuthRequestKey({
      client_id: "client-a",
      response_type: "code",
      scope: "openid identity.dob",
    });

    expect(base).not.toBe(altered);
  });
});
