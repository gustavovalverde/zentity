import { beforeEach, describe, expect, it, vi } from "vitest";

const joseMocks = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(() => "jwks"),
  jwtVerify: vi.fn(),
}));

vi.mock("jose", () => joseMocks);
vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", () => ({
  env: {
    ZENTITY_URL: "http://zentity-internal:3000",
    NEXT_PUBLIC_ZENTITY_URL: "https://app.zentity.xyz",
  },
}));

import { verifyPohToken } from "./poh-verifier";

describe("verifyPohToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    joseMocks.jwtVerify.mockResolvedValue({
      payload: {
        sub: "pairwise-sub",
        exp: 1_800_000_000,
        poh: {
          tier: 3,
          verified: true,
          sybil_resistant: true,
          method: "ocr",
        },
      },
    });
  });

  it("verifies PoH tokens against the public issuer", async () => {
    await verifyPohToken("poh-token");

    expect(joseMocks.jwtVerify).toHaveBeenCalledWith("poh-token", "jwks", {
      issuer: "https://app.zentity.xyz",
      algorithms: ["EdDSA"],
    });
  });
});
