/**
 * HAIP Compliance Integration Tests
 *
 * Validates that HAIP-specific features are correctly wired into the auth config:
 * - ES256 signing key creation and usage
 * - DPoP metadata in discovery
 * - PAR endpoint exposure
 * - HAIP plugin metadata injection
 * - JARM decryption key provisioning
 */

import { createLocalJWKSet, jwtVerify } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/jwks";

import { auth } from "../auth";
import { enrichDiscoveryMetadata, unwrapMetadata } from "../well-known-utils";

let signJwt: typeof import("../oidc/jwt-signer").signJwt;

async function buildJwksFromDb(): Promise<Record<string, unknown>[]> {
  const allKeys = await db.select().from(jwks);
  return allKeys.map((row) => ({
    ...(JSON.parse(row.publicKey) as Record<string, unknown>),
    kid: row.id,
    ...(row.alg ? { alg: row.alg } : {}),
    ...(row.crv ? { crv: row.crv } : {}),
  }));
}

describe("HAIP — ES256 signing support", () => {
  beforeAll(async () => {
    const mod = await import("../oidc/jwt-signer");
    signJwt = mod.signJwt;

    // Warm up: create ES256 key by inserting a client with ES256 preference
    // then signing a token for that client
    await db
      .insert((await import("@/lib/db/schema/oauth-provider")).oauthClients)
      .values({
        clientId: "haip-test-es256",
        name: "HAIP ES256 Test Client",
        clientSecret: "test-secret",
        redirectUris: ["http://localhost/callback"],
        metadata: JSON.stringify({
          id_token_signed_response_alg: "ES256",
        }),
      })
      .onConflictDoNothing()
      .run();

    // Trigger lazy ES256 key creation
    await signJwt({ aud: "haip-test-es256", sub: "test" });
  });

  it("creates ES256 key on first use and serves it in JWKS", async () => {
    const keys = await buildJwksFromDb();
    const es256Key = keys.find((k) => k.alg === "ES256");

    expect(es256Key).toBeDefined();
    expect(es256Key?.kty).toBe("EC");
    expect(es256Key?.crv).toBe("P-256");
    expect(es256Key?.kid).toBeDefined();
  });

  it("signs id_token with ES256 when client opts in", async () => {
    const token = await signJwt({
      aud: "haip-test-es256",
      sub: "user-haip",
      iss: "http://localhost:3000/api/auth",
    });

    const keys = await buildJwksFromDb();
    const localJwks = createLocalJWKSet({ keys });
    const { protectedHeader } = await jwtVerify(token, localJwks);

    expect(protectedHeader.alg).toBe("ES256");
  });

  it("access tokens still use EdDSA regardless of client ES256 preference", async () => {
    const token = await signJwt({
      scope: "openid",
      azp: "haip-test-es256",
      sub: "user-haip",
    });

    const keys = await buildJwksFromDb();
    const localJwks = createLocalJWKSet({ keys });
    const { protectedHeader } = await jwtVerify(token, localJwks);

    expect(protectedHeader.alg).toBe("EdDSA");
  });
});

describe("HAIP — discovery metadata", () => {
  async function getEnrichedOpenIdConfig(): Promise<Record<string, unknown>> {
    const raw = unwrapMetadata(await auth.api.getOpenIdConfig());
    const parsed =
      raw instanceof Response
        ? ((await raw.json()) as Record<string, unknown>)
        : (raw as Record<string, unknown>);
    return enrichDiscoveryMetadata(parsed);
  }

  it("OpenID config includes pushed_authorization_request_endpoint", async () => {
    const metadata = await getEnrichedOpenIdConfig();

    expect(metadata.pushed_authorization_request_endpoint).toContain(
      "oauth2/par"
    );
  });

  it("OpenID config advertises require_pushed_authorization_requests", async () => {
    const metadata = await getEnrichedOpenIdConfig();

    expect(metadata.require_pushed_authorization_requests).toBe(true);
  });

  it("OpenID config includes DPoP signing algorithm support", async () => {
    const metadata = await getEnrichedOpenIdConfig();

    const algs = metadata.dpop_signing_alg_values_supported;
    expect(Array.isArray(algs)).toBe(true);
    expect(algs).toContain("ES256");
  });
});

describe("HAIP — credential issuer metadata", () => {
  it("credential issuer includes identity_verification configuration", async () => {
    if (!auth.publicHandler) {
      throw new Error("publicHandler is not configured");
    }

    const response = await auth.publicHandler(
      new Request("http://localhost/.well-known/openid-credential-issuer")
    );
    const body = (await response.json()) as Record<string, unknown>;
    const configs = body.credential_configurations_supported as Record<
      string,
      Record<string, unknown>
    >;

    expect(configs).toBeDefined();
    expect(configs.identity_verification).toBeDefined();
    expect(configs.identity_verification.format).toBe("dc+sd-jwt");
  });
});

describe("HAIP — JARM key provisioning", () => {
  it("getJarmDecryptionKey creates and caches ECDH-ES key", async () => {
    const { getJarmDecryptionKey } = await import("../oidc/jarm-key");
    const jwk = await getJarmDecryptionKey();

    expect(jwk.kty).toBe("EC");
    expect(jwk.crv).toBe("P-256");
    // Private key material must be present for decryption
    expect(jwk.d).toBeDefined();

    // Second call should return cached result
    const jwk2 = await getJarmDecryptionKey();
    expect(jwk2).toBe(jwk);
  });

  it("ECDH-ES key is persisted in jwks table", async () => {
    const keys = await buildJwksFromDb();
    const ecdhKey = keys.find((k) => k.alg === "ECDH-ES");

    expect(ecdhKey).toBeDefined();
    expect(ecdhKey?.kty).toBe("EC");
    expect(ecdhKey?.crv).toBe("P-256");
    // Public JWKS should NOT expose private key material
    expect(ecdhKey?.d).toBeUndefined();
  });
});
