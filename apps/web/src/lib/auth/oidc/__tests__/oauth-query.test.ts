import { makeSignature } from "better-auth/crypto";
import { describe, expect, it } from "vitest";

import { env } from "@/env";

import {
  computeOAuthRequestKey,
  verifySignedOAuthQuery,
} from "../oauth-request";

async function makeBetterAuth17SignedQuery(): Promise<string> {
  const params = new URLSearchParams({
    client_id: "client-a",
    exp: String(Math.floor(Date.now() / 1000) + 600),
    redirect_uri: "https://rp.example.com/callback",
    response_type: "code",
    scope: "openid identity.name",
  });
  const signedNames = [...new Set([...params.keys(), "ba_param"])].sort();
  for (const name of signedNames) {
    params.append("ba_param", name);
  }
  const canonical = new URLSearchParams(
    [...params.entries()].sort(([keyA, valueA], [keyB, valueB]) =>
      keyA === keyB ? valueA.localeCompare(valueB) : keyA.localeCompare(keyB)
    )
  );
  params.set(
    "sig",
    await makeSignature(canonical.toString(), env.BETTER_AUTH_SECRET)
  );
  return params.toString();
}

describe("verifySignedOAuthQuery", () => {
  it("accepts Better Auth 1.7 signed-query envelopes", async () => {
    const verified = await verifySignedOAuthQuery(
      await makeBetterAuth17SignedQuery()
    );

    expect(verified.get("client_id")).toBe("client-a");
    expect(verified.get("scope")).toBe("openid identity.name");
    expect(verified.has("sig")).toBe(false);
    expect(verified.has("exp")).toBe(false);
  });

  it("rejects a tampered Better Auth 1.7 signed query", async () => {
    const tampered = new URLSearchParams(await makeBetterAuth17SignedQuery());
    tampered.set("client_id", "client-b");

    await expect(verifySignedOAuthQuery(tampered.toString())).rejects.toThrow(
      "invalid_signature"
    );
  });
});

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

  it("ignores Better Auth signed-envelope metadata", () => {
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
