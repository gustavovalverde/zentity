// @vitest-environment node

import { decodeProtectedHeader, importJWK, type JWK, jwtVerify } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dpopFetch: vi.fn(),
  fetch: vi.fn(),
  requestTokenEndpoint: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: vi.fn(async () => ({
    api: { getSession: vi.fn(async () => ({ user: { id: "user-1" } })) },
  })),
}));
vi.mock("@/lib/env", () => ({
  env: { OIDC4VCI_WALLET_CLIENT_ID: "veripass-wallet" },
}));
vi.mock("@zentity/sdk/rp", () => ({
  createDpopClient: vi.fn(async () => ({ fetch: mocks.dpopFetch })),
  requestTokenEndpoint: mocks.requestTokenEndpoint,
}));

import { POST } from "./route";

const ISSUER = "https://app.zentity.xyz/api/auth";

describe("POST /api/veripass/issue", () => {
  beforeEach(() => {
    mocks.dpopFetch.mockReset();
    mocks.fetch.mockReset();
    mocks.requestTokenEndpoint.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("proves possession of a fresh holder key with an OID4VCI proof JWT", async () => {
    mocks.requestTokenEndpoint.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      body: { access_token: "access-token" },
    });
    mocks.fetch.mockResolvedValue(Response.json({ c_nonce: "c-nonce" }));
    mocks.dpopFetch.mockResolvedValue(
      Response.json({ credentials: [{ credential: "sd-jwt-vc" }] })
    );
    const offer = {
      credential_issuer: ISSUER,
      credential_configuration_ids: ["identity_verification"],
      grants: {
        "urn:ietf:params:oauth:grant-type:pre-authorized_code": {
          "pre-authorized_code": "pre-auth-code",
        },
      },
    };

    const res = await POST(
      new Request("https://rp.example/api/veripass/issue", {
        method: "POST",
        body: JSON.stringify({ offerUri: JSON.stringify(offer) }),
      })
    );
    const body = (await res.json()) as {
      credential: string;
      holderPrivateJwk: JWK;
      holderPublicJwk: JWK;
    };

    expect(res.status).toBe(200);
    expect(body.credential).toBe("sd-jwt-vc");
    const [, init] = mocks.dpopFetch.mock.calls[0] as [
      string,
      { body: string },
    ];
    const {
      proofs: {
        jwt: [proofJwt],
      },
    } = JSON.parse(init.body) as { proofs: { jwt: [string] } };
    const header = decodeProtectedHeader(proofJwt);
    expect(header).toEqual({
      alg: "EdDSA",
      typ: "openid4vci-proof+jwt",
      jwk: body.holderPublicJwk,
    });
    expect(body.holderPublicJwk).not.toHaveProperty("d");
    const { payload } = await jwtVerify(
      proofJwt,
      await importJWK(body.holderPublicJwk, "EdDSA"),
      { audience: ISSUER }
    );
    expect(payload.nonce).toBe("c-nonce");
    expect(typeof payload.iat).toBe("number");
    expect(body.holderPrivateJwk).toMatchObject({
      ...body.holderPublicJwk,
      d: expect.any(String),
    });
  });
});
