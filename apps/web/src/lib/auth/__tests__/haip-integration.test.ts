/**
 * HAIP Compliance Integration Tests
 *
 * Validates that HAIP-specific features are correctly wired into the auth config:
 * - DPoP metadata in discovery
 * - PAR endpoint exposure
 * - HAIP plugin metadata injection
 * - JARM decryption key provisioning
 */

import { describe, expect, it } from "vitest";

import { GET as getCredentialIssuerMetadata } from "@/app/.well-known/openid-credential-issuer/[[...issuer]]/route";
import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/oauth-provider";

import { auth } from "../auth-config";
import {
  callAuthApi,
  enrichDiscoveryMetadata,
  unwrapMetadata,
} from "../oidc/well-known";

async function buildJwksFromDb(): Promise<Record<string, unknown>[]> {
  const allKeys = await db.select().from(jwks);
  return allKeys.map((row) => ({
    ...(JSON.parse(row.publicKey) as Record<string, unknown>),
    kid: row.id,
    ...(row.alg ? { alg: row.alg } : {}),
    ...(row.crv ? { crv: row.crv } : {}),
  }));
}

describe("HAIP — discovery metadata", () => {
  async function getEnrichedOpenIdConfig(): Promise<Record<string, unknown>> {
    const raw = unwrapMetadata(await callAuthApi(auth.api, "getOpenIdConfig"));
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

  it("OpenID config does not require PAR", async () => {
    const metadata = await getEnrichedOpenIdConfig();

    expect(metadata.require_pushed_authorization_requests).toBe(false);
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
    const response = await getCredentialIssuerMetadata(
      new Request("http://localhost/.well-known/openid-credential-issuer"),
      { params: Promise.resolve({}) }
    );
    const body = (await response.json()) as Record<string, unknown>;
    const configs = body.credential_configurations_supported as Record<
      string,
      Record<string, unknown>
    >;

    expect(configs).toBeDefined();
    expect(configs.identity_verification).toBeDefined();
    expect(configs.identity_verification?.format).toBe("dc+sd-jwt");
  });
});

describe("HAIP — JARM key provisioning", () => {
  it("getJarmDecryptionKey creates and caches ECDH-ES key", async () => {
    const { getJarmDecryptionKey } = await import("../oidc/haip/jarm-key");
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
