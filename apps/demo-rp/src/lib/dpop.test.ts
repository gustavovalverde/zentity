import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { generateSerializedDpopKeyPair } from "./dpop";

describe("generateSerializedDpopKeyPair", () => {
  it("returns exportable ES256 JWKs", async () => {
    const pair = await generateSerializedDpopKeyPair();

    expect(pair.publicJwk.kty).toBe("EC");
    expect(pair.publicJwk.crv).toBe("P-256");
    expect(pair.publicJwk.x).toBeTypeOf("string");
    expect(pair.publicJwk.y).toBeTypeOf("string");

    expect(pair.privateJwk.kty).toBe("EC");
    expect(pair.privateJwk.crv).toBe("P-256");
    expect(pair.privateJwk.d).toBeTypeOf("string");
  });
});
