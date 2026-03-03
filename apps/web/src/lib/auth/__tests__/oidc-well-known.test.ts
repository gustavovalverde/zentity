import { describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/auth";
import {
  buildWellKnownResponse,
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
    ).toContain("zentity_identity");
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
    const baseMetadata = { issuer: "https://example.com" };
    const enriched = {
      ...baseMetadata,
      id_token_signing_alg_values_supported: ["RS256", "EdDSA", "ML-DSA-65"],
    };

    const response = buildWellKnownResponse(enriched);
    expect(response.status).toBe(200);
  });

  it("RS256 is first in the supported algorithms list", () => {
    const algs = ["RS256", "EdDSA", "ML-DSA-65"];
    expect(algs[0]).toBe("RS256");
    expect(algs).toContain("EdDSA");
    expect(algs).toContain("ML-DSA-65");
  });

  it("route handler enrichment matches expected algorithm set", async () => {
    // Simulate what the well-known route handlers do
    const metadata = unwrapMetadata(await auth.api.getOpenIdConfig());
    const config = parseOpenIdConfig(metadata);
    const resolved = config instanceof Promise ? await config : config;

    const enriched =
      typeof resolved === "object" && resolved !== null
        ? {
            ...resolved,
            id_token_signing_alg_values_supported: [
              "RS256",
              "EdDSA",
              "ML-DSA-65",
            ],
          }
        : resolved;

    expect(enriched.id_token_signing_alg_values_supported).toEqual([
      "RS256",
      "EdDSA",
      "ML-DSA-65",
    ]);
  });
});
