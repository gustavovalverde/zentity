import { describe, expect, it } from "vitest";

import { GET as getAuthorizationServerMetadata } from "@/app/.well-known/oauth-authorization-server/[[...issuer]]/route";
import { GET as getOpenIdConfiguration } from "@/app/.well-known/openid-configuration/[[...issuer]]/route";
import { GET as getCredentialIssuerMetadata } from "@/app/.well-known/openid-credential-issuer/[[...issuer]]/route";
import { auth } from "@/lib/auth/auth-config";
import {
  IDENTITY_SCOPES,
  PROOF_SCOPES,
} from "@/lib/auth/oidc/disclosure/registry";

type DiscoveryKind = "openid-configuration" | "oauth-authorization-server";

const routes = {
  "openid-configuration": getOpenIdConfiguration,
  "oauth-authorization-server": getAuthorizationServerMetadata,
};

async function servedDocument(
  kind: DiscoveryKind,
  issuer?: string[]
): Promise<Record<string, unknown>> {
  const response = await routes[kind](
    new Request(`http://localhost:3000/.well-known/${kind}`),
    { params: Promise.resolve(issuer ? { issuer } : {}) }
  );
  if (response.status !== 200) {
    throw new Error(`${kind} returned HTTP ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
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
    const config = await servedDocument("openid-configuration");

    expect(config.issuer).toBe("http://localhost:3000/api/auth");
    expect(config.token_endpoint).toBe(
      "http://localhost:3000/api/auth/oauth2/token"
    );
  });

  it("points jwks_uri to the combined JWKS endpoint", async () => {
    const config = await servedDocument("openid-configuration");

    expect(config.jwks_uri).toBe("http://localhost:3000/api/auth/oauth2/jwks");
  });

  it.each(["openid-configuration", "oauth-authorization-server"] as const)(
    "serves the provider's own %s document at the root",
    async (kind) => {
      const provided = await auth.handler(
        new Request(`http://localhost:3000/api/auth/.well-known/${kind}`)
      );

      expect(await servedDocument(kind, ["api", "auth"])).toEqual(
        await provided.json()
      );
      expect(provided.headers.get("Cache-Control")).toBe(
        "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400"
      );
    }
  );

  it("rejects a discovery path for another issuer", async () => {
    const response = await getOpenIdConfiguration(
      new Request("http://localhost:3000/.well-known/openid-configuration/x"),
      { params: Promise.resolve({ issuer: ["x"] }) }
    );

    expect(response.status).toBe(404);
  });
});

describe("oidc discovery — signing algorithm advertisement", () => {
  it("advertises only the ID token algorithm the provider signs with", async () => {
    const config = await servedDocument("openid-configuration");

    expect(config.id_token_signing_alg_values_supported).toEqual(["RS256"]);
  });
});

describe.each(["openid-configuration", "oauth-authorization-server"] as const)(
  "oidc discovery — %s",
  (kind) => {
    it("includes HAIP fields", async () => {
      const metadata = await servedDocument(kind);

      expect(metadata.pushed_authorization_request_endpoint).toContain(
        "oauth2/par"
      );
      expect(metadata.require_pushed_authorization_requests).toBe(false);
      expect(metadata.dpop_signing_alg_values_supported).toContain("ES256");
    });

    it("includes CIBA fields and grant type", async () => {
      const metadata = await servedDocument(kind);

      expect(metadata.backchannel_authentication_endpoint).toBe(
        "http://localhost:3000/api/auth/oauth2/bc-authorize"
      );
      expect(metadata.backchannel_token_delivery_modes_supported).toEqual([
        "poll",
        "ping",
      ]);
      expect(metadata.backchannel_user_code_parameter_supported).toBe(false);
      expect(metadata.grant_types_supported).toContain(
        "urn:openid:params:grant-type:ciba"
      );
    });

    it("includes MCP capability flags", async () => {
      const metadata = await servedDocument(kind);

      expect(metadata.client_id_metadata_document_supported).toBe(true);
      expect(metadata.resource_indicators_supported).toBe(true);
    });

    it("lists every authorization_details type the server accepts", async () => {
      const metadata = await servedDocument(kind);

      expect(metadata.authorization_details_types_supported).toEqual([
        "openid_credential",
        "payment_authorization",
      ]);
    });

    it("includes Zentity's endpoints", async () => {
      const metadata = await servedDocument(kind);

      expect(metadata).toMatchObject({
        authorization_challenge_endpoint:
          "http://localhost:3000/api/oauth2/authorize-challenge",
        poh_endpoint: "http://localhost:3000/api/auth/oauth2/proof-of-human",
        poh_issuer_uri:
          "http://localhost:3000/api/auth/.well-known/proof-of-human",
        validity_endpoint: "http://localhost:3000/api/auth/oauth2/validity",
      });
    });
  }
);

describe("oidc discovery — assurance & grant type completeness", () => {
  it("acr_values_supported contains all 4 tier URIs", async () => {
    const config = await servedDocument("openid-configuration");

    expect(config.acr_values_supported).toEqual([
      "urn:zentity:assurance:tier-0",
      "urn:zentity:assurance:tier-1",
      "urn:zentity:assurance:tier-2",
      "urn:zentity:assurance:tier-3",
    ]);
  });

  it("claims_supported includes assurance claims", async () => {
    const config = await servedDocument("openid-configuration");

    expect(config.claims_supported).toEqual(
      expect.arrayContaining([
        "acr",
        "amr",
        "auth_time",
        "acr_eidas",
        "at_hash",
      ])
    );
  });

  it("grant_types_supported includes token-exchange", async () => {
    const config = await servedDocument("openid-configuration");

    expect(config.grant_types_supported).toContain(
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
    expect(scopes).toContain("compliance:read");
    expect(scopes).toContain("identity_verification");
  });

  it("advertises header tokens and the DPoP proof algorithm", async () => {
    const { GET } = await import(
      "@/app/.well-known/oauth-protected-resource/route"
    );
    const body = (await GET().json()) as Record<string, unknown>;

    expect(body.bearer_methods_supported).toEqual(["header"]);
    expect(body.dpop_signing_alg_values_supported).toEqual(["ES256"]);
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
