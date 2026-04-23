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

vi.mock("../../src/auth/dpop.js", () => ({
  createDpopProof: vi.fn().mockResolvedValue("mock-proof"),
  extractDpopNonce: vi.fn().mockReturnValue(undefined),
}));

const { mockExchangeAuthCode, mockExecFile } = vi.hoisted(() => ({
  mockExchangeAuthCode: vi.fn(),
  mockExecFile: vi.fn(),
}));

vi.mock("../../src/auth/token-exchange.js", () => ({
  exchangeAuthCode: mockExchangeAuthCode,
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

import { authenticateViaBrowser } from "../../src/auth/browser-redirect.js";

const CALLBACK_URL_RE = /^http:\/\/127\.0\.0\.1:\d+\/callback$/;

const mockDpopKey = {
  privateJwk: { kty: "EC" as const, crv: "P-256" },
  publicJwk: { kty: "EC" as const, crv: "P-256" },
};

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

function extractOpenedUrl(): URL {
  const call = mockExecFile.mock.calls[0];
  return new URL(call[1][0] as string);
}

function extractPortFromOpenedUrl(): number {
  const redirectUri = extractOpenedUrl().searchParams.get("redirect_uri");
  if (!redirectUri) {
    throw new Error("No redirect_uri in URL");
  }

  return Number.parseInt(new URL(redirectUri).port, 10);
}

describe("authenticateViaBrowser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockExchangeAuthCode.mockReset();
    mockExecFile.mockReset();
  });

  it("starts a callback server and exchanges the returned authorization code", async () => {
    mockExchangeAuthCode.mockResolvedValue({
      accessToken: "browser-at",
      expiresAt: Date.now() + 3_600_000,
      refreshToken: "browser-rt",
      scopes: ["openid"],
    });

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

    await new Promise((resolve) => setTimeout(resolve, 50));
    const port = extractPortFromOpenedUrl();
    await httpGet(`http://127.0.0.1:${port}/callback?code=browser-code`);

    const result = await resultPromise;
    expect(result.accessToken).toBe("browser-at");
    expect(result.refreshToken).toBe("browser-rt");
    expect(mockExchangeAuthCode).toHaveBeenCalledWith(
      "http://localhost:3000/api/auth/oauth2/token",
      "browser-code",
      "test-verifier",
      "client-1",
      expect.stringMatching(CALLBACK_URL_RE),
      mockDpopKey,
      undefined
    );
  });

  it("includes the requested resource in the browser authorization URL", async () => {
    mockExchangeAuthCode.mockResolvedValue({
      accessToken: "at",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["openid"],
    });

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

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(extractOpenedUrl().searchParams.get("resource")).toBe(
      "http://localhost:3000"
    );

    const port = extractPortFromOpenedUrl();
    await httpGet(`http://127.0.0.1:${port}/callback?code=c`);
    await resultPromise;
  });

  it("uses PAR when a pushed-authorization endpoint is provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          request_uri: "urn:par:abc123",
          expires_in: 60,
        }),
        { status: 201 }
      )
    );
    mockExchangeAuthCode.mockResolvedValue({
      accessToken: "par-at",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["openid"],
    });

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

    await new Promise((resolve) => setTimeout(resolve, 50));

    const parCall = fetchSpy.mock.calls.find(([url]) =>
      (url as string).includes("/par")
    );
    expect(parCall).toBeDefined();
    expect(extractOpenedUrl().searchParams.get("request_uri")).toBe(
      "urn:par:abc123"
    );

    const parBody = new URLSearchParams(
      (parCall?.[1] as RequestInit).body as string
    );
    const redirectUri = parBody.get("redirect_uri") ?? "";
    const port = new URL(redirectUri).port;
    await httpGet(`http://127.0.0.1:${port}/callback?code=par-code`);

    await expect(resultPromise).resolves.toMatchObject({
      accessToken: "par-at",
    });
  });

  it("includes the app resource in PAR requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          request_uri: "urn:par:resource-test",
          expires_in: 60,
        }),
        { status: 201 }
      )
    );
    mockExchangeAuthCode.mockResolvedValue({
      accessToken: "par-at",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["openid"],
    });

    const resultPromise = authenticateViaBrowser({
      authorizeEndpoint: "http://localhost:3000/api/auth/oauth2/authorize",
      tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
      parEndpoint: "http://localhost:3000/api/auth/oauth2/par",
      clientId: "client-1",
      dpopKey: mockDpopKey,
      resource: "http://localhost:3000",
      pkce: {
        codeVerifier: "v",
        codeChallenge: "c",
        codeChallengeMethod: "S256",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const parCall = fetchSpy.mock.calls.find(([url]) =>
      (url as string).includes("/par")
    );
    expect(parCall).toBeDefined();

    const parBody = new URLSearchParams(
      (parCall?.[1] as RequestInit).body as string
    );
    expect(parBody.get("resource")).toBe("http://localhost:3000");

    const redirectUri = parBody.get("redirect_uri") ?? "";
    const port = new URL(redirectUri).port;
    await httpGet(`http://127.0.0.1:${port}/callback?code=par-code`);

    await expect(resultPromise).resolves.toMatchObject({
      accessToken: "par-at",
    });
  });
});
