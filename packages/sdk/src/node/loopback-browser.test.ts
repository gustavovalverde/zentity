import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateWithLoopbackBrowser } from "./loopback-browser.js";

const { mockExecFile, mockExchangeAuthorizationCode } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockExchangeAuthorizationCode: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

const CALLBACK_URL_RE = /^http:\/\/127\.0\.0\.1:\d+\/callback$/;

const mockDpopClient = {
  keyPair: {
    privateJwk: { crv: "P-256", kty: "EC" as const },
    publicJwk: { crv: "P-256", kty: "EC" as const },
  },
  proofFor: vi.fn().mockResolvedValue("mock-proof"),
  withNonceRetry: vi.fn(async (attempt) => attempt()),
};

function httpGet(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        response.resume();
        response.on("end", resolve);
      })
      .on("error", reject);
  });
}

function extractOpenedUrl(): URL {
  const call = mockExecFile.mock.calls[0];
  return new URL(call?.[1]?.at(-1) as string);
}

function extractCallbackPort(): number {
  const redirectUri = extractOpenedUrl().searchParams.get("redirect_uri");
  if (!redirectUri) {
    throw new Error("Opened URL missing redirect_uri");
  }

  return Number.parseInt(new URL(redirectUri).port, 10);
}

describe("authenticateWithLoopbackBrowser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockDpopClient.proofFor.mockClear();
    mockDpopClient.withNonceRetry.mockClear();
    mockExchangeAuthorizationCode.mockReset();
    mockExecFile.mockReset();
  });

  it("starts a callback server and exchanges the returned authorization code", async () => {
    mockExchangeAuthorizationCode.mockResolvedValue({
      accessToken: "browser-access-token",
      expiresAt: Date.now() + 3_600_000,
      refreshToken: "browser-refresh-token",
      scopes: ["openid"],
    });

    const resultPromise = authenticateWithLoopbackBrowser({
      authorizeEndpoint: "http://localhost:3000/api/auth/oauth2/authorize",
      clientId: "client-1",
      dpopClient: mockDpopClient,
      exchangeAuthorizationCode: mockExchangeAuthorizationCode,
      pkce: {
        codeVerifier: "verifier",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
      },
      scope: "openid offline_access",
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const port = extractCallbackPort();
    await httpGet(`http://127.0.0.1:${port}/callback?code=browser-code`);

    await expect(resultPromise).resolves.toMatchObject({
      accessToken: "browser-access-token",
      refreshToken: "browser-refresh-token",
    });
    expect(mockExchangeAuthorizationCode).toHaveBeenCalledWith({
      clientId: "client-1",
      code: "browser-code",
      codeVerifier: "verifier",
      redirectUri: expect.stringMatching(CALLBACK_URL_RE),
    });
  });

  it("includes the requested resource in the browser authorization URL", async () => {
    mockExchangeAuthorizationCode.mockResolvedValue({
      accessToken: "browser-access-token",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["openid"],
    });

    const resultPromise = authenticateWithLoopbackBrowser({
      authorizeEndpoint: "http://localhost:3000/api/auth/oauth2/authorize",
      clientId: "client-1",
      dpopClient: mockDpopClient,
      exchangeAuthorizationCode: mockExchangeAuthorizationCode,
      pkce: {
        codeVerifier: "verifier",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
      },
      resource: "http://localhost:3000",
      scope: "openid",
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(extractOpenedUrl().searchParams.get("resource")).toBe(
      "http://localhost:3000"
    );

    const port = extractCallbackPort();
    await httpGet(`http://127.0.0.1:${port}/callback?code=browser-code`);
    await resultPromise;
  });

  it("uses PAR when a pushed authorization endpoint is provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          request_uri: "urn:par:abc123",
        }),
        { status: 201 }
      )
    );
    mockExchangeAuthorizationCode.mockResolvedValue({
      accessToken: "browser-access-token",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["openid"],
    });

    const resultPromise = authenticateWithLoopbackBrowser({
      authorizeEndpoint: "http://localhost:3000/api/auth/oauth2/authorize",
      clientId: "client-1",
      dpopClient: mockDpopClient,
      exchangeAuthorizationCode: mockExchangeAuthorizationCode,
      parEndpoint: "http://localhost:3000/api/auth/oauth2/par",
      pkce: {
        codeVerifier: "verifier",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
      },
      resource: "http://localhost:3000",
      scope: "openid offline_access",
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const parCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes("/oauth2/par")
    );
    expect(parCall).toBeDefined();

    const body = new URLSearchParams(
      (parCall?.[1] as RequestInit).body as string
    );
    expect(body.get("resource")).toBe("http://localhost:3000");
    expect(extractOpenedUrl().searchParams.get("request_uri")).toBe(
      "urn:par:abc123"
    );

    const redirectUri = body.get("redirect_uri");
    expect(redirectUri).toBeTruthy();
    const port = Number.parseInt(new URL(redirectUri as string).port, 10);
    await httpGet(`http://127.0.0.1:${port}/callback?code=browser-code`);
    await resultPromise;
  });
});
