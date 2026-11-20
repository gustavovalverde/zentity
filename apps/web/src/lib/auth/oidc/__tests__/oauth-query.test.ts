import { describe, expect, it } from "vitest";

import {
  computeOAuthDisclosureRequestKey,
  computeOAuthRequestKey,
} from "../oauth-request";

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

  it("ignores Better Auth signed-query bookkeeping", () => {
    const signedBrowserQuery = new URLSearchParams([
      ["client_id", "client-a"],
      ["response_type", "code"],
      ["scope", "openid identity.name"],
      ["ba_iat", "1786633057395"],
      ["ba_pl", "session-a"],
      ["ba_param", "ba_iat"],
      ["ba_param", "ba_param"],
      ["ba_param", "ba_pl"],
      ["ba_param", "client_id"],
      ["sig", "signature"],
      ["exp", "1786633657"],
    ]);
    const storedAuthorizationQuery = {
      client_id: "client-a",
      response_type: "code",
      scope: "openid identity.name",
    };

    expect(computeOAuthRequestKey(signedBrowserQuery)).toBe(
      computeOAuthRequestKey(storedAuthorizationQuery)
    );
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

describe("computeOAuthDisclosureRequestKey", () => {
  it("matches the consent query after identity scopes are stripped", () => {
    const stagedQuery = new URLSearchParams({
      client_id: "client-a",
      response_type: "code",
      scope: "openid identity.name proof:age identity.address",
      state: "state-a",
    });
    const consentQuery = new URLSearchParams({
      client_id: "client-a",
      response_type: "code",
      scope: "openid proof:age",
      state: "state-a",
    });

    expect(computeOAuthDisclosureRequestKey(stagedQuery)).toBe(
      computeOAuthRequestKey(consentQuery)
    );
  });

  it("preserves beta.10 normalization for existing pending stages", () => {
    const stagedQuery = new URLSearchParams({
      client_id: "client-a",
      response_type: "code",
      scope: "openid identity.name proof:age openid identity.address",
    });
    const legacyNormalizedQuery = new URLSearchParams({
      client_id: "client-a",
      response_type: "code",
      scope: "openid proof:age",
    });

    expect(computeOAuthDisclosureRequestKey(stagedQuery)).toBe(
      computeOAuthRequestKey(legacyNormalizedQuery)
    );
  });
});
