import { exportJWK, generateKeyPair, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { authenticateClientRequest } from "./token-request";

const BASIC_AUTH_HEADER_RE = /^Basic /;

describe("private_key_jwt client authentication", () => {
  it("preserves public and client-secret-basic forms", async () => {
    const publicBody = new URLSearchParams();
    const publicHeaders: Record<string, string> = {};
    await authenticateClientRequest(
      { clientId: "public-client" },
      publicBody,
      publicHeaders
    );
    expect(publicBody.get("client_id")).toBe("public-client");
    expect(publicHeaders.Authorization).toBeUndefined();

    const confidentialBody = new URLSearchParams();
    const confidentialHeaders: Record<string, string> = {};
    await authenticateClientRequest(
      { clientId: "confidential-client", clientSecret: "secret" },
      confidentialBody,
      confidentialHeaders
    );
    expect(confidentialBody.has("client_id")).toBe(false);
    expect(confidentialHeaders.Authorization).toMatch(BASIC_AUTH_HEADER_RE);
  });

  it("signs an ES256 assertion for the configured issuer audience", async () => {
    const keys = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = await exportJWK(keys.privateKey);
    const body = new URLSearchParams({ grant_type: "refresh_token" });
    const headers: Record<string, string> = {};
    const endpoint = "https://issuer.example/api/auth/oauth2/token";
    const issuer = "https://issuer.example/api/auth";

    await authenticateClientRequest(
      {
        clientId: "install-client",
        privateJwk,
        signingAlgorithm: "ES256",
        clientAssertionAudience: issuer,
      },
      body,
      headers,
      endpoint
    );

    expect(body.get("client_id")).toBe("install-client");
    expect(body.get("client_assertion_type")).toBe(
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
    );
    expect(headers.Authorization).toBeUndefined();
    const { payload, protectedHeader } = await jwtVerify(
      body.get("client_assertion") as string,
      keys.publicKey,
      { audience: issuer }
    );
    expect(protectedHeader.alg).toBe("ES256");
    expect(payload.iss).toBe("install-client");
    expect(payload.sub).toBe("install-client");
    expect(typeof payload.jti).toBe("string");
    expect(typeof payload.exp).toBe("number");
  });
});
