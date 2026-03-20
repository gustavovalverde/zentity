import type { Server } from "node:http";
import type { APIRequestContext } from "@playwright/test";

import crypto from "node:crypto";
import { createServer } from "node:http";

import { expect, test } from "@playwright/test";
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";

import { createDpopProof, createIssuerSession } from "./oidc-helpers";

const RAW_BASE_URL =
  process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:3000";
const BASE_URL = RAW_BASE_URL.replace(/\/+$/, "");
const AUTH_BASE_URL = `${BASE_URL}/api/auth`;
const ORIGIN_HEADERS = {
  Origin: BASE_URL,
  "Content-Type": "application/json",
};

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const TOKEN_URL = `${AUTH_BASE_URL}/oauth2/token`;

// ── Test Attestation JWKS Server ────────────────────────────────────────

let jwksServer: Server;
let testKeyPair: CryptoKeyPair;
let testPublicJwk: Record<string, unknown>;

const BASE64_PLUS = /\+/g;
const BASE64_SLASH = /\//g;
const BASE64_PAD = /=+$/;

async function sha256base64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(BASE64_PLUS, "-")
    .replace(BASE64_SLASH, "_")
    .replace(BASE64_PAD, "");
}

test.beforeAll(async () => {
  testKeyPair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const jwk = await exportJWK(testKeyPair.publicKey);
  testPublicJwk = { ...jwk, kid: "e2e-agent-key", alg: "EdDSA", use: "sig" };

  jwksServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ keys: [testPublicJwk] }));
  });
  await new Promise<void>((resolve) => jwksServer.listen(4999, resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
});

// ── Helpers ─────────────────────────────────────────────────────────────

async function registerCibaClient(request: APIRequestContext) {
  const res = await request.post(`${AUTH_BASE_URL}/oauth2/register`, {
    data: {
      client_name: `agent-e2e-${crypto.randomUUID().slice(0, 8)}`,
      redirect_uris: ["http://localhost/cb"],
      grant_types: [CIBA_GRANT_TYPE],
      token_endpoint_auth_method: "none",
    },
    headers: ORIGIN_HEADERS,
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

async function signAttestationHeaders(clientId: string) {
  const now = Math.floor(Date.now() / 1000);

  const attestation = await new SignJWT({
    sub: clientId,
    agent: {
      name: "E2E Test Agent",
      model: "gpt-4",
      runtime: "e2e-test",
      version: "1.0",
    },
  })
    .setProtectedHeader({
      alg: "EdDSA",
      kid: "e2e-agent-key",
      typ: "oauth-client-attestation+jwt",
    })
    .setIssuer("http://localhost:4999")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(testKeyPair.privateKey);

  const pop = await new SignJWT({
    jti: crypto.randomUUID(),
    ath: await sha256base64url(attestation),
  })
    .setProtectedHeader({
      alg: "EdDSA",
      kid: "e2e-agent-key",
      typ: "oauth-client-attestation-pop+jwt",
    })
    .setIssuer(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(testKeyPair.privateKey);

  return { attestation, pop };
}

async function initiateCiba(
  request: APIRequestContext,
  params: {
    clientId: string;
    email: string;
    agentClaims?: string;
    attestationHeaders?: { attestation: string; pop: string };
    bindingMessage?: string;
  }
) {
  const headers: Record<string, string> = { ...ORIGIN_HEADERS };
  if (params.attestationHeaders) {
    headers["OAuth-Client-Attestation"] = params.attestationHeaders.attestation;
    headers["OAuth-Client-Attestation-PoP"] = params.attestationHeaders.pop;
  }

  const res = await request.post(`${AUTH_BASE_URL}/oauth2/bc-authorize`, {
    data: {
      client_id: params.clientId,
      login_hint: params.email,
      scope: "openid",
      binding_message: params.bindingMessage ?? "E2E test",
      resource: BASE_URL,
      ...(params.agentClaims ? { agent_claims: params.agentClaims } : {}),
    },
    headers,
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { auth_req_id: string };
  expect(body.auth_req_id).toBeTruthy();
  return body.auth_req_id;
}

async function approveAndGetToken(
  request: APIRequestContext,
  params: {
    authReqId: string;
    clientId: string;
    cookieHeader: string;
  }
) {
  const approveRes = await request.post(`${AUTH_BASE_URL}/ciba/authorize`, {
    data: { auth_req_id: params.authReqId },
    headers: { Cookie: params.cookieHeader, ...ORIGIN_HEADERS },
  });
  expect(approveRes.ok()).toBeTruthy();

  const dpop = await createDpopProof({ method: "POST", url: TOKEN_URL });
  const tokenRes = await request.post(TOKEN_URL, {
    form: {
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: params.authReqId,
      client_id: params.clientId,
      resource: BASE_URL,
    },
    headers: { DPoP: dpop.proof },
  });
  expect(tokenRes.ok()).toBeTruthy();
  return (await tokenRes.json()) as {
    access_token: string;
    id_token?: string;
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

test.describe("Three-tier agent attestation (CIBA)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("anonymous tier: token has no agent/agent_attestation claims", async ({
    request,
  }) => {
    const session = await createIssuerSession(request);
    const clientId = await registerCibaClient(request);

    // No agent_claims → anonymous
    const authReqId = await initiateCiba(request, {
      clientId,
      email: session.email,
      bindingMessage: "Purchase: Nike Pegasus 41",
    });

    const tokens = await approveAndGetToken(request, {
      authReqId,
      clientId,
      cookieHeader: session.cookieHeader,
    });

    const payload = decodeJwt(tokens.access_token);
    expect(payload.agent).toBeUndefined();
    expect(payload.agent_attestation).toBeUndefined();
    expect(payload.act).toBeDefined();
  });

  test("self-declared tier: token has agent but no agent_attestation", async ({
    request,
  }) => {
    const session = await createIssuerSession(request);
    const clientId = await registerCibaClient(request);

    const agentClaims = JSON.stringify({
      agent: {
        name: "Aether AI",
        model: "gpt-4",
        runtime: "demo-rp",
        version: "1.0",
      },
      task: { id: "headphones", description: "Find headphones" },
    });

    // agent_claims but no attestation headers → self-declared
    const authReqId = await initiateCiba(request, {
      clientId,
      email: session.email,
      agentClaims,
      bindingMessage: "Aether AI wants to purchase Sony WH-1000XM5",
    });

    const tokens = await approveAndGetToken(request, {
      authReqId,
      clientId,
      cookieHeader: session.cookieHeader,
    });

    const payload = decodeJwt(tokens.access_token);
    expect(payload.agent).toBeDefined();
    const agent = payload.agent as Record<string, unknown>;
    expect(agent.name).toBe("Aether AI");
    expect(agent.model).toBe("gpt-4");
    expect(payload.agent_attestation).toBeUndefined();
  });

  test("attested tier: token has agent + agent_attestation claims", async ({
    request,
  }) => {
    const session = await createIssuerSession(request);
    const clientId = await registerCibaClient(request);

    const agentClaims = JSON.stringify({
      agent: {
        name: "E2E Test Agent",
        model: "gpt-4",
        runtime: "e2e-test",
        version: "1.0",
      },
      task: {
        id: "espresso",
        description: "Find an espresso machine",
      },
    });

    const attestation = await signAttestationHeaders(clientId);

    // agent_claims + attestation headers → attested
    const authReqId = await initiateCiba(request, {
      clientId,
      email: session.email,
      agentClaims,
      attestationHeaders: attestation,
      bindingMessage:
        "Verified E2E Test Agent requests purchase: Breville Bambino Plus",
    });

    const tokens = await approveAndGetToken(request, {
      authReqId,
      clientId,
      cookieHeader: session.cookieHeader,
    });

    const payload = decodeJwt(tokens.access_token);
    expect(payload.agent).toBeDefined();
    const agent = payload.agent as Record<string, unknown>;
    expect(agent.name).toBe("E2E Test Agent");

    expect(payload.agent_attestation).toBeDefined();
    const attestationClaim = payload.agent_attestation as Record<
      string,
      unknown
    >;
    expect(attestationClaim.verified).toBe(true);
    expect(attestationClaim.issuer).toBe("http://localhost:4999");
    expect(attestationClaim.verifiedAt).toBeTruthy();
  });

  test("spoofed attestation in agent_claims is stripped", async ({
    request,
  }) => {
    const session = await createIssuerSession(request);
    const clientId = await registerCibaClient(request);

    // Self-injected attestation — should be stripped
    const agentClaims = JSON.stringify({
      agent: { name: "Malicious Agent" },
      attestation: { verified: true, issuer: "spoofed" },
    });

    const authReqId = await initiateCiba(request, {
      clientId,
      email: session.email,
      agentClaims,
    });

    const tokens = await approveAndGetToken(request, {
      authReqId,
      clientId,
      cookieHeader: session.cookieHeader,
    });

    const payload = decodeJwt(tokens.access_token);
    expect(payload.agent).toBeDefined();
    const agent = payload.agent as Record<string, unknown>;
    expect(agent.name).toBe("Malicious Agent");

    // Spoofed attestation MUST be stripped
    expect(payload.agent_attestation).toBeUndefined();
  });

  test("approval page: shows verified badge for attested agent", async ({
    request,
    page,
  }) => {
    const session = await createIssuerSession(request);
    const clientId = await registerCibaClient(request);

    const agentClaims = JSON.stringify({
      agent: {
        name: "Verified Test Agent",
        model: "gpt-4",
        runtime: "e2e",
        version: "1.0",
      },
    });

    const attestation = await signAttestationHeaders(clientId);

    const authReqId = await initiateCiba(request, {
      clientId,
      email: session.email,
      agentClaims,
      attestationHeaders: attestation,
    });

    // Navigate to approval page as the authenticated user
    await page.context().addCookies(
      session.cookieHeader.split("; ").map((cookie) => {
        const [name, ...rest] = cookie.split("=");
        return {
          name: name ?? "",
          value: rest.join("="),
          domain: "localhost",
          path: "/",
        };
      })
    );

    await page.goto(`/approve/${authReqId}`);
    await page.waitForSelector("text=Verified Test Agent");

    // Verified badge should be visible
    const verifiedBadge = page.locator("text=Verified");
    await expect(verifiedBadge).toBeVisible();
  });

  test("approval page: shows unverified badge for self-declared agent", async ({
    request,
    page,
  }) => {
    const session = await createIssuerSession(request);
    const clientId = await registerCibaClient(request);

    const agentClaims = JSON.stringify({
      agent: {
        name: "Unverified Test Agent",
        model: "gpt-4",
        runtime: "e2e",
        version: "1.0",
      },
    });

    const authReqId = await initiateCiba(request, {
      clientId,
      email: session.email,
      agentClaims,
    });

    await page.context().addCookies(
      session.cookieHeader.split("; ").map((cookie) => {
        const [name, ...rest] = cookie.split("=");
        return {
          name: name ?? "",
          value: rest.join("="),
          domain: "localhost",
          path: "/",
        };
      })
    );

    await page.goto(`/approve/${authReqId}`);
    await page.waitForSelector("text=Unverified Test Agent");

    const unverifiedBadge = page.locator("text=Unverified");
    await expect(unverifiedBadge).toBeVisible();
  });

  test("approval page: shows warning for anonymous agent", async ({
    request,
    page,
  }) => {
    const session = await createIssuerSession(request);
    const clientId = await registerCibaClient(request);

    // No agent_claims → anonymous
    const authReqId = await initiateCiba(request, {
      clientId,
      email: session.email,
    });

    await page.context().addCookies(
      session.cookieHeader.split("; ").map((cookie) => {
        const [name, ...rest] = cookie.split("=");
        return {
          name: name ?? "",
          value: rest.join("="),
          domain: "localhost",
          path: "/",
        };
      })
    );

    await page.goto(`/approve/${authReqId}`);
    await page.waitForSelector("text=Authorization Request");

    const warning = page.locator("text=No agent identity provided");
    await expect(warning).toBeVisible();
  });
});
