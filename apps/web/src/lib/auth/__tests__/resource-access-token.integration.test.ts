import crypto from "node:crypto";

import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { GET as authRouteGet } from "@/app/api/auth/[...all]/route";
import { GET as getValidity } from "@/app/api/auth/oauth2/validity/route";
import { mintOpaqueAccessToken } from "@/lib/auth/oidc/haip/opaque-access-token";
import { encryptPrivateKey } from "@/lib/auth/oidc/jwt-signer";
import {
  resolveProtectedResourcePrincipal,
  verifyResourceRequest,
} from "@/lib/auth/oidc/resource-principal";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { requireClientCredentials } from "@/lib/auth/resource-auth";
import { db } from "@/lib/db/connection";
import {
  jwks as jwksTable,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import { revokedTokens } from "@/lib/db/schema/revoked-tokens";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  createTestDpopKeyPair,
  type DpopKeyPair,
} from "@/test-utils/dpop-test-utils";

const authIssuer = getAuthIssuer();
const CLIENT_ID = "resource-test-client";
const RP_API_AUDIENCE = `${authIssuer}/resource/rp-api`;
const VALIDITY_URL = `${authIssuer}/oauth2/validity`;
const RESOURCE_URL = "http://localhost:3000/api/trpc/assurance.profile";
const USERINFO_URL = `${authIssuer}/oauth2/userinfo`;
const RESOURCE_METADATA_URL =
  "http://localhost:3000/.well-known/oauth-protected-resource";

let signingKey: Awaited<ReturnType<typeof generateKeyPair>>;
let signingKid: string;
let hasSigningKey = false;

// One key for the whole file: the provider caches the JWKS and refetches it
// for an unknown kid at most every 30 seconds, as for real key rotation.
async function ensureSigningKey() {
  if (!hasSigningKey) {
    signingKey = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    signingKid = crypto.randomUUID();
    hasSigningKey = true;
  }
  await db
    .insert(jwksTable)
    .values({
      id: signingKid,
      publicKey: JSON.stringify(await exportJWK(signingKey.publicKey)),
      privateKey: encryptPrivateKey(
        JSON.stringify(await exportJWK(signingKey.privateKey))
      ),
      alg: "EdDSA",
      crv: "Ed25519",
    })
    .onConflictDoNothing()
    .run();
}

function mintJwt(
  claims: Record<string, unknown>,
  options: { key?: CryptoKey; typ?: string } = {}
): Promise<string> {
  return new SignJWT({
    iss: authIssuer,
    aud: RP_API_AUDIENCE,
    azp: CLIENT_ID,
    sub: CLIENT_ID,
    scope: "agent:introspect",
    jti: crypto.randomUUID(),
    ...claims,
  })
    .setProtectedHeader({
      alg: "EdDSA",
      typ: options.typ ?? "at+jwt",
      kid: signingKid,
    })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(options.key ?? signingKey.privateKey);
}

async function resourceRequest(
  token: string,
  options: {
    dpop?: DpopKeyPair;
    method?: string;
    proof?: string;
    proofUrl?: string;
    url?: string;
  } = {}
): Promise<Request> {
  const url = options.url ?? RESOURCE_URL;
  const method = options.method ?? "GET";
  const headers = new Headers({
    authorization: `${options.dpop || options.proof ? "DPoP" : "Bearer"} ${token}`,
  });
  const proof =
    options.proof ??
    (options.dpop
      ? await buildDpopProof(
          options.dpop,
          method,
          options.proofUrl ?? url,
          token
        )
      : undefined);
  if (proof) {
    headers.set("DPoP", proof);
  }
  return new Request(url, { method, headers });
}

function jkt(keyPair: DpopKeyPair): Promise<string> {
  return calculateJwkThumbprint(keyPair.jwk);
}

describe("protected resource access tokens", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    await ensureSigningKey();
    userId = await createTestUser();
    await db
      .insert(oauthClients)
      .values({
        clientId: CLIENT_ID,
        redirectUris: JSON.stringify(["https://rp.example/callback"]),
        grantTypes: JSON.stringify(["client_credentials"]),
        tokenEndpointAuthMethod: "client_secret_post",
      })
      .run();
  });

  describe("JWT access tokens", () => {
    it("accepts a bearer token the provider issued", async () => {
      const result = await verifyResourceRequest(
        await resourceRequest(await mintJwt({}))
      );
      expect(result.ok && result.format).toBe("jwt");
    });

    it("rejects a forged signature", async () => {
      const attacker = await generateKeyPair("EdDSA", {
        crv: "Ed25519",
        extractable: true,
      });
      const token = await mintJwt({}, { key: attacker.privateKey });
      expect(
        (await verifyResourceRequest(await resourceRequest(token))).ok
      ).toBe(false);
    });

    it("rejects a JWT that is not typed as an access token", async () => {
      for (const typ of ["JWT", "logout+jwt"]) {
        const token = await mintJwt({}, { typ });
        expect(
          (await verifyResourceRequest(await resourceRequest(token))).ok
        ).toBe(false);
      }
    });

    it("rejects a revoked token", async () => {
      const jti = crypto.randomUUID();
      const token = await mintJwt({ jti });
      await db.insert(revokedTokens).values({ jti }).run();
      expect(
        (await verifyResourceRequest(await resourceRequest(token))).ok
      ).toBe(false);
    });

    it("rejects an audience the provider does not serve", async () => {
      const token = await mintJwt({ aud: "https://unknown.example" });
      expect(
        (await verifyResourceRequest(await resourceRequest(token))).ok
      ).toBe(false);
    });
  });

  describe("DPoP-bound access tokens", () => {
    let keyPair: DpopKeyPair;
    let token: string;

    beforeEach(async () => {
      keyPair = await createTestDpopKeyPair();
      token = await mintJwt({ cnf: { jkt: await jkt(keyPair) } });
    });

    it("accepts a fresh proof for this request", async () => {
      const result = await verifyResourceRequest(
        await resourceRequest(token, { dpop: keyPair })
      );
      expect(result.ok).toBe(true);
    });

    it("refuses the token without a proof", async () => {
      const result = await verifyResourceRequest(await resourceRequest(token));
      expect(result.ok).toBe(false);
    });

    it("refuses a proof signed for another URL", async () => {
      const result = await verifyResourceRequest(
        await resourceRequest(token, {
          dpop: keyPair,
          proofUrl: "http://localhost:3000/api/trpc/other.procedure",
        })
      );
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.body?.error).toBe("invalid_dpop_proof");
    });

    it("refuses a replayed proof", async () => {
      const proof = await buildDpopProof(keyPair, "GET", RESOURCE_URL, token);
      const first = await verifyResourceRequest(
        await resourceRequest(token, { proof })
      );
      expect(first.ok).toBe(true);

      const replay = await verifyResourceRequest(
        await resourceRequest(token, { proof })
      );
      expect(replay.ok).toBe(false);
      expect(!replay.ok && replay.error.body?.error).toBe("invalid_dpop_proof");
    });

    it("refuses a proof from another key", async () => {
      const result = await verifyResourceRequest(
        await resourceRequest(token, { dpop: await createTestDpopKeyPair() })
      );
      expect(result.ok).toBe(false);
    });
  });

  describe("Zentity-hosted endpoints", () => {
    async function mintUserToken(keyPair: DpopKeyPair) {
      return mintOpaqueAccessToken({
        act: { sub: CLIENT_ID },
        clientId: CLIENT_ID,
        dpopJkt: await jkt(keyPair),
        exchangeClaims: {},
        expiresAt: new Date(Date.now() + 3_600_000),
        referenceId: crypto.randomUUID(),
        scopes: ["openid", "poh"],
        userId,
      });
    }

    it("resolves the user behind a DPoP-bound opaque token", async () => {
      const keyPair = await createTestDpopKeyPair();
      const token = await mintUserToken(keyPair);
      const result = await resolveProtectedResourcePrincipal(
        await resourceRequest(token, { dpop: keyPair })
      );
      expect(result.ok && result.principal.userId).toBe(userId);
      expect(result.ok && result.principal.clientId).toBe(CLIENT_ID);
    });

    it("refuses a JWT audienced to another resource", async () => {
      const keyPair = await createTestDpopKeyPair();
      const jwt = await mintJwt({
        sub: userId,
        cnf: { jkt: await jkt(keyPair) },
      });
      const result = await resolveProtectedResourcePrincipal(
        await resourceRequest(jwt, { dpop: keyPair })
      );
      expect(result.ok).toBe(false);
    });

    it("rejects a wrong htu and a replayed jti at the validity endpoint", async () => {
      const keyPair = await createTestDpopKeyPair();
      const token = await mintUserToken(keyPair);

      const wrongHtu = await getValidity(
        await resourceRequest(token, {
          dpop: keyPair,
          url: VALIDITY_URL,
          proofUrl: `${authIssuer}/oauth2/userinfo`,
        })
      );
      expect(wrongHtu.status).toBe(401);

      const proof = await buildDpopProof(keyPair, "GET", VALIDITY_URL, token);
      const accepted = await getValidity(
        await resourceRequest(token, { proof, url: VALIDITY_URL })
      );
      expect(accepted.status).toBe(200);

      const replayed = await getValidity(
        await resourceRequest(token, { proof, url: VALIDITY_URL })
      );
      expect(replayed.status).toBe(401);
    });
  });

  describe("resource challenges", () => {
    async function mintUserToken(keyPair: DpopKeyPair, scopes: string[]) {
      return mintOpaqueAccessToken({
        act: { sub: CLIENT_ID },
        clientId: CLIENT_ID,
        dpopJkt: await jkt(keyPair),
        exchangeClaims: {},
        expiresAt: new Date(Date.now() + 3_600_000),
        referenceId: crypto.randomUUID(),
        scopes,
        userId,
      });
    }

    it("points a request without a token at the resource metadata", async () => {
      const response = await getValidity(new Request(VALIDITY_URL));

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe(
        `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`
      );
    });

    it("answers a bad DPoP proof with a DPoP challenge", async () => {
      const keyPair = await createTestDpopKeyPair();
      const token = await mintUserToken(keyPair, ["openid", "poh"]);

      const response = await getValidity(
        await resourceRequest(token, {
          dpop: keyPair,
          url: VALIDITY_URL,
          proofUrl: USERINFO_URL,
        })
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe(
        'DPoP error="invalid_dpop_proof", error_description="DPoP proof htu does not match the request URL", algs="ES256"'
      );
      await expect(response.json()).resolves.toMatchObject({
        error: "invalid_dpop_proof",
      });
    });

    it("names the missing scope in a 403 challenge", async () => {
      const keyPair = await createTestDpopKeyPair();
      const token = await mintUserToken(keyPair, ["openid"]);

      const response = await getValidity(
        await resourceRequest(token, { dpop: keyPair, url: VALIDITY_URL })
      );

      expect(response.status).toBe(403);
      const challenge = response.headers.get("WWW-Authenticate");
      expect(challenge?.startsWith('Bearer error="insufficient_scope"')).toBe(
        true
      );
      expect(challenge).toContain('scope="poh"');
      expect(challenge).toContain(
        `resource_metadata="${RESOURCE_METADATA_URL}"`
      );
    });

    it("keeps the provider's own UserInfo challenge", async () => {
      const response = await authRouteGet(
        new Request(USERINFO_URL, {
          headers: { authorization: "Bearer unknown-opaque-token" },
        })
      );

      expect(response.status).toBe(401);
      const challenge = response.headers.get("WWW-Authenticate");
      expect(challenge?.startsWith('Bearer error="invalid_token"')).toBe(true);
      expect(challenge).not.toContain("resource_metadata");
    });
  });

  describe("RP API client credentials", () => {
    it("accepts a client_credentials token for the RP API", async () => {
      const result = await requireClientCredentials(
        await resourceRequest(await mintJwt({})),
        ["agent:introspect"]
      );
      expect(result.ok && result.principal.clientId).toBe(CLIENT_ID);
    });

    it("refuses a user token", async () => {
      const result = await requireClientCredentials(
        await resourceRequest(await mintJwt({ sub: userId }))
      );
      expect(result.ok).toBe(false);
    });

    it("refuses a token without the required scope", async () => {
      const result = await requireClientCredentials(
        await resourceRequest(await mintJwt({ scope: "openid" })),
        ["agent:introspect"]
      );
      expect(result.ok).toBe(false);
      expect(!result.ok && result.response.status).toBe(403);
      expect(
        !result.ok && result.response.headers.get("WWW-Authenticate")
      ).toContain('scope="agent:introspect"');
    });

    it("refuses opaque tokens", async () => {
      const keyPair = await createTestDpopKeyPair();
      const token = await mintOpaqueAccessToken({
        act: { sub: CLIENT_ID },
        clientId: CLIENT_ID,
        dpopJkt: await jkt(keyPair),
        exchangeClaims: {},
        expiresAt: new Date(Date.now() + 3_600_000),
        referenceId: crypto.randomUUID(),
        scopes: ["agent:introspect"],
        userId,
      });
      const result = await requireClientCredentials(
        await resourceRequest(token, { dpop: keyPair }),
        ["agent:introspect"]
      );
      expect(result.ok).toBe(false);
    });
  });
});
