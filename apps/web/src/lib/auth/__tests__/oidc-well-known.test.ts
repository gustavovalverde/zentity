import { describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/auth";

describe("oidc4vci well-known metadata", () => {
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
    const config = await auth.api.getOpenIdConfig();

    expect(config.issuer).toBe("http://localhost:3000/api/auth");
    expect(config.token_endpoint).toBe(
      "http://localhost:3000/api/auth/oauth2/token"
    );
  });
});
