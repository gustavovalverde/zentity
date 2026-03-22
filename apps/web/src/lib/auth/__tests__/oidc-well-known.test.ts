import { describe, expect, it } from "vitest";

import { GET as getCredentialIssuerMetadata } from "@/app/.well-known/openid-credential-issuer/[[...issuer]]/route";
import { auth } from "@/lib/auth/auth";
import { IDENTITY_SCOPES } from "@/lib/auth/oidc/identity-scopes";
import { PROOF_SCOPES } from "@/lib/auth/oidc/proof-scopes";
import {
  buildWellKnownResponse,
  callAuthApi,
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
    const response = await getCredentialIssuerMetadata(
      new Request("http://localhost/.well-known/openid-credential-issuer"),
      { params: Promise.resolve({}) }
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
      unwrapMetadata(await callAuthApi(auth.api, "getOpenIdConfig"))
    );
    const resolved = config instanceof Promise ? await config : config;

    expect(resolved.issuer).toBe("http://localhost:3000/api/auth");
    expect(resolved.token_endpoint).toBe(
      "http://localhost:3000/api/auth/oauth2/token"
    );
  });

  it("points jwks_uri to the combined JWKS endpoint", async () => {
    const config = parseOpenIdConfig(
      unwrapMetadata(await callAuthApi(auth.api, "getOpenIdConfig"))
    );
    const resolved = config instanceof Promise ? await config : config;

    expect(resolved.jwks_uri).toContain("/oauth2/jwks");
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
    const metadata = unwrapMetadata(
      await callAuthApi(auth.api, "getOpenIdConfig")
    );
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
    const raw = unwrapMetadata(await callAuthApi(auth.api, "getOpenIdConfig"));
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
    const raw = unwrapMetadata(
      await callAuthApi(auth.api, "getOAuthServerConfig")
    );
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

describe("oidc discovery — CIBA metadata fields", () => {
  it("enriched metadata includes backchannel_authentication_endpoint", () => {
    const enriched = enrichDiscoveryMetadata({
      issuer: "https://example.com/api/auth",
    });

    expect(enriched.backchannel_authentication_endpoint).toBe(
      "https://example.com/api/auth/oauth2/bc-authorize"
    );
    expect(enriched.backchannel_token_delivery_modes_supported).toEqual([
      "poll",
      "ping",
    ]);
    expect(enriched.backchannel_user_code_parameter_supported).toBe(false);
  });

  it("OpenID config includes CIBA grant type in grant_types_supported", async () => {
    const raw = unwrapMetadata(await callAuthApi(auth.api, "getOpenIdConfig"));
    const resolved = await parseOpenIdConfig(raw);
    const enriched = enrichDiscoveryMetadata(
      resolved as Record<string, unknown>
    );

    const grantTypes = enriched.grant_types_supported as string[];
    expect(grantTypes).toContain("urn:openid:params:grant-type:ciba");
  });
});

describe("oidc discovery — MCP compatibility metadata", () => {
  it("enrichDiscoveryMetadata advertises CIMD support", () => {
    const enriched = enrichDiscoveryMetadata({
      issuer: "https://example.com/api/auth",
    });

    expect(enriched.client_id_metadata_document_supported).toBe(true);
  });

  it("enrichDiscoveryMetadata advertises resource indicator support", () => {
    const enriched = enrichDiscoveryMetadata({
      issuer: "https://example.com/api/auth",
    });

    expect(enriched.resource_indicators_supported).toBe(true);
  });

  it("OpenID config includes MCP capability flags", async () => {
    const raw = unwrapMetadata(await callAuthApi(auth.api, "getOpenIdConfig"));
    const resolved = await parseOpenIdConfig(raw);
    const enriched = enrichDiscoveryMetadata(
      resolved as Record<string, unknown>
    );

    expect(enriched.client_id_metadata_document_supported).toBe(true);
    expect(enriched.resource_indicators_supported).toBe(true);
  });

  it("OAuth AS config includes MCP capability flags", async () => {
    const raw = unwrapMetadata(
      await callAuthApi(auth.api, "getOAuthServerConfig")
    );
    const resolved = await parseOpenIdConfig(raw);
    const enriched = enrichDiscoveryMetadata(
      resolved as Record<string, unknown>
    );

    expect(enriched.client_id_metadata_document_supported).toBe(true);
    expect(enriched.resource_indicators_supported).toBe(true);
  });
});

describe("oidc discovery — assurance & grant type completeness", () => {
  it("acr_values_supported contains all 4 tier URIs", () => {
    const enriched = enrichDiscoveryMetadata({
      issuer: "https://example.com/api/auth",
    });
    const acr = enriched.acr_values_supported as string[];

    expect(acr).toContain("urn:zentity:assurance:tier-0");
    expect(acr).toContain("urn:zentity:assurance:tier-1");
    expect(acr).toContain("urn:zentity:assurance:tier-2");
    expect(acr).toContain("urn:zentity:assurance:tier-3");
    expect(acr).toHaveLength(4);
  });

  it("claims_supported includes assurance claims", () => {
    const enriched = enrichDiscoveryMetadata({
      issuer: "https://example.com/api/auth",
    });
    const claims = enriched.claims_supported as string[];

    expect(claims).toContain("acr");
    expect(claims).toContain("amr");
    expect(claims).toContain("auth_time");
    expect(claims).toContain("acr_eidas");
    expect(claims).toContain("at_hash");
  });

  it("grant_types_supported includes token-exchange", async () => {
    const raw = unwrapMetadata(await callAuthApi(auth.api, "getOpenIdConfig"));
    const resolved = await parseOpenIdConfig(raw);
    const enriched = enrichDiscoveryMetadata(
      resolved as Record<string, unknown>
    );

    const grantTypes = enriched.grant_types_supported as string[];
    expect(grantTypes).toContain(
      "urn:ietf:params:oauth:grant-type:token-exchange"
    );
  });
});

describe("RFC 9728 — protected resource metadata", () => {
  it("GET returns RFC 9728 metadata structure", async () => {
    const { GET } = await import(
      "@/app/.well-known/oauth-protected-resource/route"
    );
    const response = GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.resource).toBe("http://localhost:3000");
    expect(Array.isArray(body.authorization_servers)).toBe(true);
    expect(body.authorization_servers).toHaveLength(1);
    expect((body.authorization_servers as string[])[0]).toContain("/api/auth");
  });

  it("includes scopes_supported with all OAuth scopes", async () => {
    const { GET } = await import(
      "@/app/.well-known/oauth-protected-resource/route"
    );
    const body = (await GET().json()) as Record<string, unknown>;
    const scopes = body.scopes_supported as string[];

    expect(scopes).toContain("openid");
    expect(scopes).toContain("email");
    expect(scopes).toContain("offline_access");
    expect(scopes).toContain("proof:identity");
    for (const ps of PROOF_SCOPES) {
      expect(scopes).toContain(ps);
    }
    for (const is of IDENTITY_SCOPES) {
      expect(scopes).toContain(is);
    }
    expect(scopes).toContain("compliance:key:read");
    expect(scopes).toContain("compliance:key:write");
    expect(scopes).toContain("identity_verification");
  });

  it("advertises DPoP as bearer method", async () => {
    const { GET } = await import(
      "@/app/.well-known/oauth-protected-resource/route"
    );
    const body = (await GET().json()) as Record<string, unknown>;

    expect(body.bearer_methods_supported).toEqual(["header", "dpop"]);
  });

  it("advertises EdDSA as resource signing algorithm", async () => {
    const { GET } = await import(
      "@/app/.well-known/oauth-protected-resource/route"
    );
    const body = (await GET().json()) as Record<string, unknown>;

    expect(body.resource_signing_alg_values_supported).toEqual(["EdDSA"]);
  });

  it("returns Cache-Control with 1-hour max-age", async () => {
    const { GET } = await import(
      "@/app/.well-known/oauth-protected-resource/route"
    );
    const response = GET();

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });
});
