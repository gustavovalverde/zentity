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

    // R15: identity strengths by name, and no numeric tier anywhere.
    expect(await response.json()).toEqual({
      issuer: "https://app.zentity.xyz",
      poh_endpoint: "https://app.zentity.xyz/api/auth/oauth2/proof-of-human",
      jwks_uri: "https://app.zentity.xyz/api/auth/oauth2/jwks",
      identity_strengths_supported: [
        "documentary",
        "documentary_full",
        "cryptographic_chip",
      ],
      token_types_supported: ["poh+jwt"],
      presentation_methods_supported: ["dpop"],
      max_token_lifetime: 300,
      token_signing_alg: "EdDSA",
      dpop_signing_alg_values_supported: ["ES256"],
    });
  });

  it("points jwks_uri to the PoH issuer signing keys", async () => {
    const response = getCanonicalProofOfHuman();
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.jwks_uri).toBe("https://app.zentity.xyz/api/auth/oauth2/jwks");
    expect(body.jwks_uri).not.toContain("pq-jwks");
  });
});
