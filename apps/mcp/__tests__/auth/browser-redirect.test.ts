import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
    port: 3200,
    transport: "stdio",
  },
}));

vi.mock("../../src/auth/credentials.js", () => ({
  updateCredentials: vi.fn(),
}));

vi.mock("../../src/auth/dpop.js", () => ({
  createDpopProof: vi.fn().mockResolvedValue("mock-proof"),
  extractDpopNonce: vi.fn().mockReturnValue(undefined),
}));

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

import { authenticateViaBrowser } from "../../src/auth/browser-redirect.js";

const mockDpopKey = {
  privateJwk: { kty: "EC" as const, crv: "P-256" },
  publicJwk: { kty: "EC" as const, crv: "P-256" },
};

/** Use node:http to hit the callback server (not globalThis.fetch, which is mocked). */
function httpGet(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        res.resume();
        res.on("end", resolve);
      })
      .on("error", reject);
  });
}

function extractPortFromOpenedUrl(): number {
  const call = mockExecFile.mock.calls[0];
  const openedUrl = call[1][0] as string;
  const redirectUri = new URL(openedUrl).searchParams.get("redirect_uri");
  if (!redirectUri) {
    throw new Error("No redirect_uri in URL");
  }
  return Number.parseInt(new URL(redirectUri).port, 10);
}

describe("authenticateViaBrowser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockExecFile.mockReset();
  });

  it("starts callback server and exchanges code for tokens", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "browser-at",
            token_type: "DPoP",
            expires_in: 3600,
            refresh_token: "browser-rt",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            email: "user@example.com",
            sub: "pairwise-subject",
          }),
          { status: 200 }
        )
      );

    const resultPromise = authenticateViaBrowser({
      authorizeEndpoint: "http://localhost:3000/api/auth/oauth2/authorize",
      tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
      clientId: "client-1",
      dpopKey: mockDpopKey,
      pkce: {
        codeVerifier: "test-verifier",
        codeChallenge: "test-challenge",
        codeChallengeMethod: "S256",
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    const port = extractPortFromOpenedUrl();
    await httpGet(`http://127.0.0.1:${port}/callback?code=browser-code`);

    const result = await resultPromise;
    expect(result.accessToken).toBe("browser-at");
    expect(result.refreshToken).toBe("browser-rt");
  });

  it("includes resource parameter in authorize URL", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "at",
            token_type: "DPoP",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            email: "user@example.com",
            sub: "pairwise-subject",
          }),
          { status: 200 }
        )
      );

    const resultPromise = authenticateViaBrowser({
      authorizeEndpoint: "http://localhost:3000/api/auth/oauth2/authorize",
      tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
      clientId: "client-1",
      dpopKey: mockDpopKey,
      resource: "http://localhost:3000",
      pkce: {
        codeVerifier: "v",
        codeChallenge: "c",
        codeChallengeMethod: "S256",
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    const openedUrl = new URL(mockExecFile.mock.calls[0][1][0] as string);
    expect(openedUrl.searchParams.get("resource")).toBe(
      "http://localhost:3000"
    );

    const port = extractPortFromOpenedUrl();
    await httpGet(`http://127.0.0.1:${port}/callback?code=c`);
    await resultPromise;
  });

  it("uses PAR when parEndpoint is provided", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      // PAR response
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            request_uri: "urn:par:abc123",
            expires_in: 60,
          }),
          { status: 201 }
        )
      )
      // Token exchange response
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "par-at", token_type: "DPoP" }),
          { status: 200 }
        )
      )
      // Userinfo response
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            email: "user@example.com",
            sub: "pairwise-subject",
          }),
          { status: 200 }
        )
      );

    const resultPromise = authenticateViaBrowser({
      authorizeEndpoint: "http://localhost:3000/api/auth/oauth2/authorize",
      tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
      parEndpoint: "http://localhost:3000/api/auth/oauth2/par",
      clientId: "client-1",
      dpopKey: mockDpopKey,
      pkce: {
        codeVerifier: "v",
        codeChallenge: "c",
        codeChallengeMethod: "S256",
      },
    });

    await new Promise((r) => setTimeout(r, 50));

    // Verify PAR was called
    const parCall = fetchSpy.mock.calls.find(([url]) =>
      (url as string).includes("/par")
    );
    expect(parCall).toBeDefined();

    // Verify browser opens with request_uri
    const openedUrl = new URL(mockExecFile.mock.calls[0][1][0] as string);
    expect(openedUrl.searchParams.get("request_uri")).toBe("urn:par:abc123");

    // Get port from PAR body
    const parBody = new URLSearchParams(
      (parCall?.[1] as RequestInit).body as string
    );
    const redirectUri = parBody.get("redirect_uri") ?? "";
    const port = new URL(redirectUri).port;
    await httpGet(`http://127.0.0.1:${port}/callback?code=par-code`);

    const result = await resultPromise;
    expect(result.accessToken).toBe("par-at");
  });

  it("rejects on authorization error callback", async () => {
    vi.spyOn(globalThis, "fetch");

    // Attach .catch immediately to prevent unhandled rejection
    const resultPromise = authenticateViaBrowser({
      authorizeEndpoint: "http://localhost:3000/api/auth/oauth2/authorize",
      tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
      clientId: "client-1",
      dpopKey: mockDpopKey,
      pkce: {
        codeVerifier: "v",
        codeChallenge: "c",
        codeChallengeMethod: "S256",
      },
    }).catch((e: Error) => e);

    await new Promise((r) => setTimeout(r, 50));
    const port = extractPortFromOpenedUrl();
    await httpGet(
      `http://127.0.0.1:${port}/callback?error=access_denied&error_description=User+cancelled`
    );

    const error = await resultPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Authorization failed");
  });
});
