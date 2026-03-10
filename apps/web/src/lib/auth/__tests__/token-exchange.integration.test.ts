import crypto from "node:crypto";

import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { getAuthIssuer } from "@/lib/auth/issuer";
import { resetSigningKeyCache } from "@/lib/auth/oidc/jwt-signer";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";
import { db } from "@/lib/db/connection";
import { jwks as jwksTable } from "@/lib/db/schema/jwks";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

import { auth } from "../auth";

const TOKEN_URL = "http://localhost:3000/api/auth/oauth2/token";
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const ID_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id_token";
const TEST_CLIENT_ID = "exchange-test-agent";
const authIssuer = getAuthIssuer();

let testKeyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let testKid: string;

async function ensureSigningKey() {
  testKeyPair = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  testKid = crypto.randomUUID();
  const publicJwk = await exportJWK(testKeyPair.publicKey);
  const privateJwk = await exportJWK(testKeyPair.privateKey);
  await db
    .insert(jwksTable)
    .values({
      id: testKid,
      publicKey: JSON.stringify(publicJwk),
      privateKey: JSON.stringify(privateJwk),
      alg: "EdDSA",
      crv: "Ed25519",
    })
    .run();
}

async function createTestClient(clientId = TEST_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "Exchange Test Agent",
      redirectUris: ["http://localhost/callback"],
      grantTypes: [TOKEN_EXCHANGE_GRANT_TYPE],
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

function mintAccessToken(
  sub: string,
  opts: { scope?: string; act?: Record<string, unknown> } = {}
): Promise<string> {
  const payload: Record<string, unknown> = {
    iss: authIssuer,
    sub,
    aud: authIssuer,
    scope: opts.scope ?? "openid",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  if (opts.act) {
    payload.act = opts.act;
  }
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: testKid })
    .sign(testKeyPair.privateKey);
}

function mintIdToken(
  sub: string,
  aud: string = TEST_CLIENT_ID
): Promise<string> {
  const payload: Record<string, unknown> = {
    iss: authIssuer,
    sub,
    aud,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: testKid })
    .sign(testKeyPair.privateKey);
}

async function postToken(
  body: Record<string, string>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await auth.handler(
    new Request(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    })
  );

  const text = await response.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      json =
        parsed && typeof parsed === "object" && "response" in parsed
          ? (parsed.response as Record<string, unknown>)
          : parsed;
    } catch {
      json = { raw: text };
    }
  }

  return { status: response.status, json };
}

describe("Token Exchange (RFC 8693)", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    resetSigningKeyCache();
    userId = await createTestUser();
    await ensureSigningKey();
    await createTestClient();
  });

  describe("access token → access token", () => {
    it("exchanges with scope attenuation", async () => {
      const subjectToken = await mintAccessToken(userId, {
        scope: "openid identity.name identity.dob",
      });

      const { status, json } = await postToken({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        scope: "openid identity.name",
      });

      expect(status).toBe(200);
      expect(json.issued_token_type).toBe(ACCESS_TOKEN_TYPE);
      expect(json.token_type).toBe("Bearer");
      expect(json.scope).toBe("openid identity.name");

      const payload = decodeJwt(json.access_token as string);
      expect(payload.scope).toBe("openid identity.name");
      expect(payload.act).toEqual({ sub: TEST_CLIENT_ID });
    });

    it("binds audience to resource parameter", async () => {
      const subjectToken = await mintAccessToken(userId);
      const merchantApi = "https://merchant.example.com/api";

      const { status, json } = await postToken({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        resource: merchantApi,
      });

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);
      expect(payload.aud).toBe(merchantApi);
    });

    it("binds audience to audience parameter when resource is absent", async () => {
      const subjectToken = await mintAccessToken(userId);
      const targetService = "https://target.example.com";

      const { status, json } = await postToken({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        audience: targetService,
      });

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);
      expect(payload.aud).toBe(targetService);
    });

    it("prefers resource over audience for aud binding", async () => {
      const subjectToken = await mintAccessToken(userId);

      const { status, json } = await postToken({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        resource: "https://resource.example.com",
        audience: "https://audience.example.com",
      });

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);
      expect(payload.aud).toBe("https://resource.example.com");
    });

    it("inherits subject scopes when none requested", async () => {
      const subjectToken = await mintAccessToken(userId, {
        scope: "openid identity.name",
      });

      const { status, json } = await postToken({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
      });

      expect(status).toBe(200);
      expect(json.scope).toBe("openid identity.name");
    });
  });

  describe("access token → id_token", () => {
    it("returns a valid id_token with act claim", async () => {
      const subjectToken = await mintAccessToken(userId);

      const { status, json } = await postToken({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        requested_token_type: ID_TOKEN_TYPE,
      });

      expect(status).toBe(200);
      expect(json.issued_token_type).toBe(ID_TOKEN_TYPE);
      expect(json.token_type).toBe("N_A");

      const payload = decodeJwt(json.access_token as string);
      expect(payload.sub).toBe(userId);
      expect(payload.iss).toBe(authIssuer);
      expect(payload.aud).toBe(TEST_CLIENT_ID);
      expect(payload.act).toEqual({ sub: TEST_CLIENT_ID });
    });
  });

  describe("id_token → access token", () => {
    it("mints an access token from a valid id_token", async () => {
      const subjectIdToken = await mintIdToken(userId);

      const { status, json } = await postToken({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectIdToken,
        subject_token_type: ID_TOKEN_TYPE,
        requested_token_type: ACCESS_TOKEN_TYPE,
      });

      expect(status).toBe(200);
      expect(json.issued_token_type).toBe(ACCESS_TOKEN_TYPE);
      expect(json.token_type).toBe("Bearer");

      const payload = decodeJwt(json.access_token as string);
      expect(payload.sub).toBe(userId);
      expect(payload.act).toEqual({ sub: TEST_CLIENT_ID });
    });
  });

  describe("scope attenuation enforcement", () => {
    it("rejects scope broadening on access token subjects", async () => {
      const subjectToken = await mintAccessToken(userId, {
        scope: "openid",
      });

      const { status, json } = await postToken({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        scope: "openid identity.name",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_scope");
    });

    it("rejects non-openid scopes on id_token subjects", async () => {
      const subjectIdToken = await mintIdToken(userId);

      const { status, json } = await postToken({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectIdToken,
        subject_token_type: ID_TOKEN_TYPE,
        scope: "openid identity.name",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_scope");
    });
  });

  describe("act claim nesting", () => {
    it("nests act claims across multiple exchanges", async () => {
      // First exchange: agent A gets a token with act: { sub: "agent-a" }
      const agentAId = "agent-a";
      await createTestClient(agentAId);

      const originalToken = await mintAccessToken(userId, {
        scope: "openid identity.name",
      });

      const { json: firstExchange } = await postToken({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: agentAId,
        subject_token: originalToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        scope: "openid identity.name",
      });

      const firstPayload = decodeJwt(firstExchange.access_token as string);
      expect(firstPayload.act).toEqual({ sub: agentAId });

      // Second exchange: agent B exchanges agent A's token
      const agentBId = "agent-b";
      await createTestClient(agentBId);

      const { status, json: secondExchange } = await postToken({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: agentBId,
        subject_token: firstExchange.access_token as string,
        subject_token_type: ACCESS_TOKEN_TYPE,
        scope: "openid",
      });

      expect(status).toBe(200);
      const secondPayload = decodeJwt(secondExchange.access_token as string);
      expect(secondPayload.act).toEqual({
        sub: agentBId,
        act: { sub: agentAId },
      });
    });
  });

  describe("error cases", () => {
    it("rejects missing subject_token", async () => {
      const { status, json } = await postToken({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token_type: ACCESS_TOKEN_TYPE,
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_request");
    });

    it("rejects invalid/expired subject token", async () => {
      const expired = await new SignJWT({
        iss: authIssuer,
        sub: userId,
        scope: "openid",
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600,
      })
        .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: testKid })
        .sign(testKeyPair.privateKey);

      const { status, json } = await postToken({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: expired,
        subject_token_type: ACCESS_TOKEN_TYPE,
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_grant");
    });

    it("rejects unsupported subject_token_type", async () => {
      const subjectToken = await mintAccessToken(userId);

      const { status, json } = await postToken({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:refresh_token",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_request");
    });
  });
});
