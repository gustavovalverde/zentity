import {
  base64url,
  decodeJwt,
  decodeProtectedHeader,
  EmbeddedJWK,
  jwtVerify,
} from "jose";
import { describe, expect, it, vi } from "vitest";

import {
  createDpopClient,
  createDpopClientFromKeyPair,
  generateDpopKeyPair,
} from "./dpop-client";

const TOKEN_URL = "https://issuer.example/oauth2/token";
const RESOURCE_URL = "https://issuer.example/api/resource";

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return base64url.encode(new Uint8Array(digest));
}

function sent(transport: ReturnType<typeof vi.fn>, call: number) {
  const [url, init] = transport.mock.calls[call] as [string, RequestInit];
  const headers = new Headers(init.headers);
  const proof = headers.get("DPoP") ?? "";
  return { url, init, headers, proof, claims: decodeJwt(proof) };
}

function jsonError(
  status: number,
  error: string,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify({ error }), { status, headers });
}

describe("generateDpopKeyPair", () => {
  it("returns an ES256 key pair as JWKs", async () => {
    const { privateJwk, publicJwk } = await generateDpopKeyPair();

    expect(privateJwk).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(privateJwk.d).toEqual(expect.any(String));
    expect(publicJwk).toEqual({
      kty: "EC",
      crv: "P-256",
      x: privateJwk.x,
      y: privateJwk.y,
    });
  });
});

describe("proofFor", () => {
  it("signs a proof with the client's key", async () => {
    const keyPair = await generateDpopKeyPair();
    const client = await createDpopClientFromKeyPair(keyPair);

    const proof = await client.proofFor(
      "get",
      "https://issuer.example/userinfo?scope=openid",
      "access-token",
      "server-nonce"
    );

    const { payload, protectedHeader } = await jwtVerify(proof, EmbeddedJWK, {
      typ: "dpop+jwt",
      algorithms: ["ES256"],
    });
    expect(protectedHeader.jwk).toEqual(keyPair.publicJwk);
    expect(payload).toMatchObject({
      htm: "GET",
      htu: "https://issuer.example/userinfo",
      nonce: "server-nonce",
      ath: await sha256("access-token"),
    });
    expect(payload.jti).toEqual(expect.any(String));
    expect(payload.iat).toEqual(expect.any(Number));
  });

  it("omits ath and nonce when they are not given", async () => {
    const client = await createDpopClient();

    const claims = decodeJwt(await client.proofFor("POST", TOKEN_URL));

    expect(claims.ath).toBeUndefined();
    expect(claims.nonce).toBeUndefined();
  });

  it("gives every proof a new jti", async () => {
    const client = await createDpopClient();

    const first = decodeJwt(await client.proofFor("POST", TOKEN_URL));
    const second = decodeJwt(await client.proofFor("POST", TOKEN_URL));

    expect(first.jti).not.toBe(second.jti);
  });

  it("drops the query and fragment from htu instead of rejecting the URL", async () => {
    const client = await createDpopClient();

    for (const url of [
      `${TOKEN_URL}#frag`,
      `${TOKEN_URL}#`,
      `${TOKEN_URL}?client_id=abc#frag`,
      new URL(`${TOKEN_URL}#frag`),
    ]) {
      const claims = decodeJwt(await client.proofFor("POST", url));
      expect(claims.htu).toBe(TOKEN_URL);
    }
  });
});

describe("fetch", () => {
  it("calls the transport with (url, init), the DPoP header, and the original body on both attempts", async () => {
    const client = await createDpopClient();
    const body = new URLSearchParams({ grant_type: "client_credentials" });
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonError(400, "use_dpop_nonce", { "DPoP-Nonce": "nonce-1" })
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const response = await client.fetch(new URL(TOKEN_URL), {
      method: "post",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      fetch: transport,
    });

    expect(response.status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(2);
    for (const call of [0, 1]) {
      const attempt = sent(transport, call);
      expect(attempt.url).toBe(TOKEN_URL);
      expect(attempt.init.method).toBe("POST");
      expect(attempt.init.body).toBe(body);
      expect(attempt.headers.get("Content-Type")).toBe(
        "application/x-www-form-urlencoded"
      );
      await expect(
        jwtVerify(attempt.proof, EmbeddedJWK, { typ: "dpop+jwt" })
      ).resolves.toBeDefined();
    }
    expect(sent(transport, 0).claims.nonce).toBeUndefined();
    expect(sent(transport, 1).claims).toMatchObject({
      htm: "POST",
      htu: TOKEN_URL,
      nonce: "nonce-1",
    });
    expect(sent(transport, 1).claims.jti).not.toBe(
      sent(transport, 0).claims.jti
    );
  });

  it("refreshes endpoint credentials before retrying a nonce challenge", async () => {
    const client = await createDpopClient();
    const body = new URLSearchParams({ client_assertion: "first" });
    const headers: Record<string, string> = {};
    const attempts: { body: string; authorization: string | null }[] = [];
    const transport = vi.fn<typeof fetch>((_input, init) => {
      if (!init) {
        throw new Error("Transport received no request options");
      }
      attempts.push({
        body: (init.body as URLSearchParams).toString(),
        authorization: new Headers(init.headers).get("Authorization"),
      });
      return Promise.resolve(
        attempts.length === 1
          ? jsonError(400, "use_dpop_nonce", { "DPoP-Nonce": "nonce-1" })
          : new Response("{}", { status: 200 })
      );
    });
    const onNonceRetry = vi.fn(() => {
      body.set("client_assertion", "fresh");
      headers.Authorization = "Basic refreshed";
    });

    await client.fetch(TOKEN_URL, {
      method: "POST",
      body,
      headers,
      fetch: transport,
      onNonceRetry,
    });

    expect(onNonceRetry).toHaveBeenCalledOnce();
    expect(Object.fromEntries(new URLSearchParams(attempts[0]?.body))).toEqual({
      client_assertion: "first",
    });
    expect(attempts[0]?.authorization).toBeNull();
    expect(Object.fromEntries(new URLSearchParams(attempts[1]?.body))).toEqual({
      client_assertion: "fresh",
    });
    expect(attempts[1]?.authorization).toBe("Basic refreshed");
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
    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
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

  it("does not retry when the challenge repeats the nonce the proof carried", async () => {
    const client = await createDpopClient();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "DPoP-Nonce": "nonce-1" },
        })
      )
      .mockResolvedValueOnce(
        jsonError(400, "use_dpop_nonce", { "DPoP-Nonce": "nonce-1" })
      );

    await client.fetch(TOKEN_URL, { method: "POST", fetch: transport });
    const response = await client.fetch(TOKEN_URL, {
      method: "POST",
      fetch: transport,
    });

    expect(response.status).toBe(400);
    expect(sent(transport, 1).claims.nonce).toBe("nonce-1");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("sends the nonce cached from an earlier success, per origin", async () => {
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
    await client.fetch("https://other.example/resource", { fetch: transport });

    const userinfo = sent(transport, 1);
    expect(userinfo.claims).toMatchObject({
      htm: "GET",
      nonce: "nonce-1",
      ath: await sha256("access-token"),
    });
    expect(userinfo.headers.get("Authorization")).toBe("DPoP access-token");
    expect(sent(transport, 2).claims.nonce).toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("keeps nonces separate for each client", async () => {
    const first = await createDpopClient();
    const second = await createDpopClient();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "DPoP-Nonce": "nonce-1" },
        })
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await first.fetch(TOKEN_URL, { method: "POST", fetch: transport });
    await second.fetch(TOKEN_URL, { method: "POST", fetch: transport });

    expect(sent(transport, 1).claims.nonce).toBeUndefined();
  });

  it("retries a resource-server 401 only for a DPoP use_dpop_nonce challenge", async () => {
    const client = await createDpopClient();
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
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          headers: {
            "DPoP-Nonce": "nonce-3",
            "WWW-Authenticate": 'Bearer error="use_dpop_nonce"',
          },
        })
      );

    const first = await client.fetch(RESOURCE_URL, {
      accessToken: "access-token",
      fetch: transport,
    });
    const second = await client.fetch(RESOURCE_URL, {
      accessToken: "access-token",
      fetch: transport,
    });
    const third = await client.fetch(RESOURCE_URL, {
      accessToken: "access-token",
      fetch: transport,
    });

    expect(first.status).toBe(200);
    expect(sent(transport, 1).claims.nonce).toBe("nonce-1");
    expect(second.status).toBe(401);
    expect(third.status).toBe(401);
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it("retries when the transport keeps an unread clone of the challenge", async () => {
    const client = await createDpopClient();
    const kept: Response[] = [];
    let attempts = 0;
    const transport = vi.fn<typeof fetch>(async () => {
      attempts += 1;
      const response: Response =
        attempts === 1
          ? new Response("challenge", {
              status: 401,
              headers: {
                "DPoP-Nonce": "nonce-1",
                "WWW-Authenticate": 'DPoP error="use_dpop_nonce"',
              },
            })
          : new Response("{}", { status: 200 });
      kept.push(response.clone());
      return response;
    });

    const response = await client.fetch(RESOURCE_URL, {
      accessToken: "access-token",
      fetch: transport,
    });

    expect(response.status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(2);
    await expect(kept[0]?.text()).resolves.toBe("challenge");
  });

  it("leaves a URL's fragment out of the proof's htu", async () => {
    const client = await createDpopClient();
    const transport = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 200 })
    );

    const response = await client.fetch(`${TOKEN_URL}#frag`, {
      method: "POST",
      fetch: transport,
    });

    expect(response.status).toBe(200);
    expect(sent(transport, 0).claims.htu).toBe(TOKEN_URL);
  });

  it("puts the client's public key in every proof", async () => {
    const keyPair = await generateDpopKeyPair();
    const client = await createDpopClientFromKeyPair(keyPair);
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await client.fetch(RESOURCE_URL, { fetch: transport });

    expect(decodeProtectedHeader(sent(transport, 0).proof).jwk).toEqual(
      keyPair.publicJwk
    );
  });
});
