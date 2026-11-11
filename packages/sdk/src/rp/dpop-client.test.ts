import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const joseMocks = vi.hoisted(() => {
  class MockSignJWT {
    claims: Record<string, unknown>;
    header: Record<string, unknown> | undefined;

    constructor(claims: Record<string, unknown>) {
      this.claims = { ...claims };
    }

    setIssuedAt() {
      return this;
    }

    setProtectedHeader(header: Record<string, unknown>) {
      this.header = header;
      return this;
    }

    async sign() {
      return JSON.stringify({
        claims: this.claims,
        header: this.header,
      });
    }
  }

  return {
    base64url: {
      encode: (input: Uint8Array | string) =>
        Buffer.from(input as Uint8Array).toString("base64url"),
    },
    exportJWK: vi.fn(async (key: unknown) =>
      key === "private-key"
        ? { crv: "P-256", d: "private", kty: "EC", x: "pub-x", y: "pub-y" }
        : { crv: "P-256", kty: "EC", x: "pub-x", y: "pub-y" }
    ),
    generateKeyPair: vi.fn(async () => ({
      privateKey: "private-key",
      publicKey: "public-key",
    })),
    importJWK: vi.fn(async () => "imported-private-key"),
    SignJWT: MockSignJWT,
  };
});

vi.mock("jose", () => joseMocks);

import {
  createDpopClient,
  createDpopClientFromKeyPair,
  generateDpopKeyPair,
} from "./dpop-client";

describe("dpop client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "nonce-id"),
      subtle: {
        digest: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("generates a serialized ES256 key pair", async () => {
    const keyPair = await generateDpopKeyPair();

    expect(keyPair).toEqual({
      privateJwk: {
        crv: "P-256",
        d: "private",
        kty: "EC",
        x: "pub-x",
        y: "pub-y",
      },
      publicJwk: {
        crv: "P-256",
        kty: "EC",
        x: "pub-x",
        y: "pub-y",
      },
    });
    expect(joseMocks.generateKeyPair).toHaveBeenCalledWith("ES256", {
      extractable: true,
    });
  });

  it("builds DPoP proofs from a persisted key pair", async () => {
    const client = await createDpopClientFromKeyPair({
      privateJwk: {
        crv: "P-256",
        d: "private",
        kty: "EC",
        x: "pub-x",
        y: "pub-y",
      },
      publicJwk: { crv: "P-256", kty: "EC", x: "pub-x", y: "pub-y" },
    });

    const proof = await client.proofFor(
      "GET",
      "https://issuer.example/userinfo",
      "access-token",
      "retry-nonce"
    );

    expect(proof).toContain("\"htu\":\"https://issuer.example/userinfo\"");
    expect(proof).toContain("\"htm\":\"GET\"");
    expect(proof).toContain("\"nonce\":\"retry-nonce\"");
    expect(proof).toContain("\"jti\":\"nonce-id\"");
    expect(proof).toContain("\"typ\":\"dpop+jwt\"");
  });

  it("normalizes htu to the origin and path", async () => {
    const client = await createDpopClient();

    const proof = await client.proofFor(
      "POST",
      "https://issuer.example/oauth2/token?client_id=abc"
    );

    expect(proof).toContain("\"htu\":\"https://issuer.example/oauth2/token\"");
    await expect(
      client.proofFor("POST", "https://issuer.example/oauth2/token#frag")
    ).rejects.toThrow("fragment");
  });

  describe("fetch", () => {
    const TOKEN_URL = "https://issuer.example/oauth2/token";

    function sent(transport: ReturnType<typeof vi.fn>, call: number) {
      const init = transport.mock.calls[call]?.[1] as RequestInit;
      const headers = new Headers(init.headers);
      const proof = JSON.parse(headers.get("DPoP") ?? "{}") as {
        claims: Record<string, unknown>;
      };
      return { headers, claims: proof.claims, init };
    }

    function jsonError(
      status: number,
      error: string,
      headers: Record<string, string> = {}
    ): Response {
      return new Response(JSON.stringify({ error }), { status, headers });
    }

    it("retries a use_dpop_nonce token error once with the new nonce", async () => {
      const client = await createDpopClient();
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonError(400, "use_dpop_nonce", { "DPoP-Nonce": "nonce-1" })
        )
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));

      const response = await client.fetch(TOKEN_URL, {
        method: "post",
        body: new URLSearchParams({ grant_type: "client_credentials" }),
        fetch: transport,
      });

      expect(response.status).toBe(200);
      expect(transport).toHaveBeenCalledTimes(2);
      expect(sent(transport, 0).claims.nonce).toBeUndefined();
      expect(sent(transport, 1).claims).toMatchObject({
        htm: "POST",
        htu: TOKEN_URL,
        nonce: "nonce-1",
      });
      expect(String(sent(transport, 1).init.body)).toBe(
        "grant_type=client_credentials"
      );
    });

    it("does not retry an invalid_grant error that carries a DPoP-Nonce", async () => {
      const client = await createDpopClient();
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonError(400, "invalid_grant", { "DPoP-Nonce": "nonce-1" })
        )
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));

      const response = await client.fetch(TOKEN_URL, {
        method: "POST",
        fetch: transport,
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "invalid_grant",
      });
      expect(transport).toHaveBeenCalledTimes(1);

      await client.fetch(TOKEN_URL, { method: "POST", fetch: transport });
      expect(sent(transport, 1).claims.nonce).toBe("nonce-1");
    });

    it("retries at most once when the server keeps asking for a nonce", async () => {
      const client = await createDpopClient();
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonError(400, "use_dpop_nonce", { "DPoP-Nonce": "nonce-1" })
        )
        .mockResolvedValueOnce(
          jsonError(400, "use_dpop_nonce", { "DPoP-Nonce": "nonce-2" })
        );

      const response = await client.fetch(TOKEN_URL, {
        method: "POST",
        fetch: transport,
      });

      expect(response.status).toBe(400);
      expect(transport).toHaveBeenCalledTimes(2);
    });

    it("sends the nonce cached from an earlier success on the first attempt", async () => {
      const client = await createDpopClient();
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("{}", {
            status: 200,
            headers: { "DPoP-Nonce": "nonce-1" },
          })
        )
        .mockResolvedValueOnce(new Response("{}", { status: 200 }))
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));

      await client.fetch(TOKEN_URL, { method: "POST", fetch: transport });
      await client.fetch("https://issuer.example/oauth2/userinfo", {
        accessToken: "access-token",
        fetch: transport,
      });
      await client.fetch("https://other.example/resource", {
        fetch: transport,
      });

      const userinfo = sent(transport, 1);
      expect(userinfo.claims).toMatchObject({
        htm: "GET",
        nonce: "nonce-1",
        ath: expect.any(String),
      });
      expect(userinfo.headers.get("Authorization")).toBe("DPoP access-token");
      expect(sent(transport, 2).claims.nonce).toBeUndefined();
      expect(transport).toHaveBeenCalledTimes(3);
    });

    it("retries a resource-server 401 only for a use_dpop_nonce challenge", async () => {
      const client = await createDpopClient();
      const resourceUrl = "https://issuer.example/api/resource";
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 401,
            headers: {
              "DPoP-Nonce": "nonce-1",
              "WWW-Authenticate":
                'DPoP error="use_dpop_nonce", error_description="Resource server requires nonce in DPoP proof"',
            },
          })
        )
        .mockResolvedValueOnce(new Response("{}", { status: 200 }))
        .mockResolvedValueOnce(
          new Response(null, {
            status: 401,
            headers: {
              "DPoP-Nonce": "nonce-2",
              "WWW-Authenticate": 'DPoP error="invalid_token"',
            },
          })
        );

      const first = await client.fetch(resourceUrl, {
        accessToken: "access-token",
        fetch: transport,
      });
      const second = await client.fetch(resourceUrl, {
        accessToken: "access-token",
        fetch: transport,
      });

      expect(first.status).toBe(200);
      expect(sent(transport, 1).claims.nonce).toBe("nonce-1");
      expect(second.status).toBe(401);
      expect(transport).toHaveBeenCalledTimes(3);
    });
  });
});
