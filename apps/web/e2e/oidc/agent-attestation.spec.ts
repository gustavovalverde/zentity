import crypto from "node:crypto";

import { expect, test } from "@playwright/test";
import { decodeJwt } from "jose";

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

async function registerCibaClient(
  request: import("@playwright/test").APIRequestContext
) {
  const res = await request.post(`${AUTH_BASE_URL}/oauth2/register`, {
    data: {
      client_name: `attest-e2e-${crypto.randomUUID().slice(0, 8)}`,
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

test.describe("Registered agent assertion in CIBA flow", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("ignores self-declared agent_claims in CIBA requests", async ({
    request,
  }) => {
    const session = await createIssuerSession(request);
    const clientId = await registerCibaClient(request);

    const agentClaims = JSON.stringify({
      agent: {
        name: "E2E Test Agent",
        model: "test-model",
        runtime: "playwright",
        capabilities: ["read", "write"],
      },
      task: { description: "E2E attestation test" },
      oversight: { requires_human_approval_for: ["purchase"] },
    });

    // Self-declared agent_claims are no longer part of the trusted protocol flow.
    const bcRes = await request.post(`${AUTH_BASE_URL}/oauth2/bc-authorize`, {
      data: {
        client_id: clientId,
        login_hint: session.email,
        scope: "openid",
        binding_message: "Agent claims E2E test",
        agent_claims: agentClaims,
        resource: BASE_URL,
      },
      headers: ORIGIN_HEADERS,
    });
    expect(bcRes.ok()).toBeTruthy();
    const { auth_req_id } = (await bcRes.json()) as { auth_req_id: string };
    expect(auth_req_id).toBeTruthy();

    // Approve
    const approveRes = await request.post(`${AUTH_BASE_URL}/ciba/authorize`, {
      data: { auth_req_id },
      headers: { Cookie: session.cookieHeader, ...ORIGIN_HEADERS },
    });
    expect(approveRes.ok()).toBeTruthy();

    // Poll for tokens
    const dpop = await createDpopProof({ method: "POST", url: TOKEN_URL });
    const tokenRes = await request.post(TOKEN_URL, {
      form: {
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id,
        client_id: clientId,
        resource: BASE_URL,
      },
      headers: { Origin: BASE_URL, DPoP: dpop.proof },
    });
    expect(tokenRes.ok()).toBeTruthy();

    const tokenBody = (await tokenRes.json()) as { access_token: string };
    expect(tokenBody.access_token).toBeTruthy();

    // Self-declared claims are ignored unless a registered Agent-Assertion is verified.
    const payload = decodeJwt(tokenBody.access_token);
    expect(payload.agent).toBeUndefined();
    expect(payload.agent_attestation).toBeUndefined();
  });

  test("CIBA without Agent-Assertion keeps tokens free of agent metadata", async ({
    request,
  }) => {
    const session = await createIssuerSession(request);
    const clientId = await registerCibaClient(request);

    // CIBA without agent claims
    const bcRes = await request.post(`${AUTH_BASE_URL}/oauth2/bc-authorize`, {
      data: {
        client_id: clientId,
        login_hint: session.email,
        scope: "openid",
        binding_message: "No agent claims test",
        resource: BASE_URL,
      },
      headers: ORIGIN_HEADERS,
    });
    expect(bcRes.ok()).toBeTruthy();
    const { auth_req_id } = (await bcRes.json()) as { auth_req_id: string };

    await request.post(`${AUTH_BASE_URL}/ciba/authorize`, {
      data: { auth_req_id },
      headers: { Cookie: session.cookieHeader, ...ORIGIN_HEADERS },
    });

    const dpop = await createDpopProof({ method: "POST", url: TOKEN_URL });
    const tokenRes = await request.post(TOKEN_URL, {
      form: {
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id,
        client_id: clientId,
        resource: BASE_URL,
      },
      headers: { Origin: BASE_URL, DPoP: dpop.proof },
    });
    expect(tokenRes.ok()).toBeTruthy();

    const tokenBody = (await tokenRes.json()) as { access_token: string };
    const payload = decodeJwt(tokenBody.access_token);

    // Without a verified Agent-Assertion there is no agent metadata in the token.
    expect(payload.agent).toBeUndefined();
    expect(payload.agent_attestation).toBeUndefined();
  });
});
