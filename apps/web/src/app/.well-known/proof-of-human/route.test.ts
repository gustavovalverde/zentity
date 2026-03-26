import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /.well-known/proof-of-human", () => {
  it("returns valid discovery metadata", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.issuer).toBe("http://localhost:3000");
    expect(body.poh_endpoint).toBe(
      "http://localhost:3000/api/auth/oauth2/proof-of-human"
    );
    expect(body.tiers_supported).toEqual([1, 2, 3, 4]);
    expect(body.token_signing_alg).toBe("EdDSA");
    expect(body.x402_compatible).toBe(true);
  });

  it("points jwks_uri to the correct JWKS endpoint", async () => {
    const response = GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.jwks_uri).toBe("http://localhost:3000/api/auth/oauth2/jwks");
    // Must NOT point to /api/auth/pq-jwks (which doesn't exist)
    expect(body.jwks_uri).not.toContain("pq-jwks");
  });
});
