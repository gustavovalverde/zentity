import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://app.zentity.xyz",
  },
}));

import { GET as getCanonicalProofOfHuman } from "./route";

describe("proof-of-human discovery metadata", () => {
  it("returns valid canonical discovery metadata", async () => {
    const response = getCanonicalProofOfHuman();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.issuer).toBe("https://app.zentity.xyz");
    expect(body.poh_endpoint).toBe(
      "https://app.zentity.xyz/api/auth/oauth2/proof-of-human"
    );
    expect(body.tiers_supported).toEqual([1, 2, 3, 4]);
    expect(body.token_signing_alg).toBe("EdDSA");
    expect(body.x402_compatible).toBe(true);
  });

  it("points jwks_uri to the PoH issuer signing keys", async () => {
    const response = getCanonicalProofOfHuman();
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.jwks_uri).toBe("https://app.zentity.xyz/api/auth/oauth2/jwks");
    expect(body.jwks_uri).not.toContain("pq-jwks");
  });
});
