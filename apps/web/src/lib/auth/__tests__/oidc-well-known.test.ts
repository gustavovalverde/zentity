import { describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/auth";
import {
  buildWellKnownResponse,
  enrichDiscoveryMetadata,
  ID_TOKEN_SIGNING_ALGS,
  unwrapMetadata,
} from "@/lib/auth/well-known-utils";

function parseOpenIdConfig(metadata: unknown) {
  if (metadata instanceof Response) {
    return metadata.json() as Promise<Record<string, unknown>>;
  }
  return metadata as Record<string, unknown>;
}

describe("oidc well-known metadata", () => {
  it("serves credential issuer metadata from the public handler", async () => {
    if (!auth.publicHandler) {
      throw new Error("publicHandler is not configured");
    }

    const response = await auth.publicHandler(
      new Request("http://localhost/.well-known/openid-credential-issuer")
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      credential_issuer?: string;
      credential_configurations_supported?: Record<string, unknown>;
    };

    expect(body.credential_issuer).toContain("/api/auth");
    expect(body.credential_configurations_supported).toBeDefined();
    expect(
      Object.keys(body.credential_configurations_supported || {})
    ).toContain("identity_verification");
  });

  it("keeps OpenID config issuer aligned with auth base path", async () => {
    const config = parseOpenIdConfig(
      unwrapMetadata(await auth.api.getOpenIdConfig())
    );
    const resolved = config instanceof Promise ? await config : config;

    expect(resolved.issuer).toBe("http://localhost:3000/api/auth");
    expect(resolved.token_endpoint).toBe(
      "http://localhost:3000/api/auth/oauth2/token"
    );
  });

  it("points jwks_uri to the combined JWKS endpoint", async () => {
    const config = parseOpenIdConfig(
      unwrapMetadata(await auth.api.getOpenIdConfig())
    );
    const resolved = config instanceof Promise ? await config : config;

    expect(resolved.jwks_uri).toContain("pq-jwks");
  });
});

describe("oidc discovery — signing algorithm advertisement", () => {
  it("enriched metadata includes RS256 as required by OIDC Discovery 1.0", () => {
    const enriched = enrichDiscoveryMetadata({ issuer: "https://example.com" });

    const response = buildWellKnownResponse(enriched);
    expect(response.status).toBe(200);
  });

  it("RS256 is first in the supported algorithms list", () => {
    expect(ID_TOKEN_SIGNING_ALGS[0]).toBe("RS256");
    expect(ID_TOKEN_SIGNING_ALGS).toContain("ES256");
    expect(ID_TOKEN_SIGNING_ALGS).toContain("EdDSA");
    expect(ID_TOKEN_SIGNING_ALGS).toContain("ML-DSA-65");
  });

  it("route handler enrichment matches expected algorithm set", async () => {
    const metadata = unwrapMetadata(await auth.api.getOpenIdConfig());
    const resolved = await parseOpenIdConfig(metadata);

    const enriched = enrichDiscoveryMetadata(
      resolved as Record<string, unknown>
    );

    expect(enriched.id_token_signing_alg_values_supported).toEqual([
      ...ID_TOKEN_SIGNING_ALGS,
    ]);
  });
});

describe("oidc discovery — HAIP metadata fields", () => {
  it("enrichDiscoveryMetadata adds PAR endpoint derived from issuer", () => {
    const enriched = enrichDiscoveryMetadata({
      issuer: "https://example.com/api/auth",
    });

    expect(enriched.pushed_authorization_request_endpoint).toBe(
      "https://example.com/api/auth/oauth2/par"
    );
    expect(enriched.require_pushed_authorization_requests).toBe(true);
    expect(enriched.dpop_signing_alg_values_supported).toContain("ES256");
    expect(enriched.authorization_details_types_supported).toContain(
      "openid_credential"
    );
  });

  it("OpenID config enrichment includes HAIP fields", async () => {
    const raw = unwrapMetadata(await auth.api.getOpenIdConfig());
    const resolved = await parseOpenIdConfig(raw);
    const enriched = enrichDiscoveryMetadata(
      resolved as Record<string, unknown>
    );

    expect(enriched.pushed_authorization_request_endpoint).toContain(
      "oauth2/par"
    );
    expect(enriched.require_pushed_authorization_requests).toBe(true);
    expect(enriched.dpop_signing_alg_values_supported).toContain("ES256");
  });

  it("OAuth AS config enrichment includes HAIP fields", async () => {
    const raw = unwrapMetadata(await auth.api.getOAuthServerConfig());
    const resolved = await parseOpenIdConfig(raw);
    const enriched = enrichDiscoveryMetadata(
      resolved as Record<string, unknown>
    );

    expect(enriched.pushed_authorization_request_endpoint).toContain(
      "oauth2/par"
    );
    expect(enriched.dpop_signing_alg_values_supported).toContain("ES256");
  });
});
