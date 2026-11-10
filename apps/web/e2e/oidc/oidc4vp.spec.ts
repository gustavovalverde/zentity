import crypto from "node:crypto";

import { type APIRequestContext, expect, test } from "@playwright/test";

import {
  createCredentialOffer,
  createDpopBinding,
  createIssuerSession,
  createKbJwt,
  createProofJwt,
  createWalletClient,
  exchangePreAuthorizedCode,
  extractIssuedCredential,
  fetchCNonce,
  issueCredential,
  oidcConfig,
  originHeaders,
  seedVpSession,
} from "./oidc-helpers";

async function issueCredentialForPresentation(request: APIRequestContext) {
  const { cookieHeader, userId } = await createIssuerSession(request);
  const clientId = await createWalletClient(request, cookieHeader);
  const dpopBinding = await createDpopBinding();
  const { preAuthorizedCode } = await createCredentialOffer(request, {
    cookieHeader,
    clientId,
    userId,
    credentialConfigurationId: oidcConfig.identityCredentialConfigurationId,
  });

  const tokenRes = await exchangePreAuthorizedCode(request, {
    preAuthorizedCode,
    clientId,
    dpopBinding,
  });
  expect(tokenRes.status()).toBe(200);
  const tokens = (await tokenRes.json()) as { access_token: string };

  const { proofJwt, holderKeyPair } = await createProofJwt(
    await fetchCNonce(request)
  );
  const credentialRes = await issueCredential(request, {
    accessToken: tokens.access_token,
    credentialConfigurationId: oidcConfig.identityCredentialConfigurationId,
    proofJwt,
    dpopBinding,
  });
  expect(credentialRes.status()).toBe(200);
  const issued = (await credentialRes.json()) as Parameters<
    typeof extractIssuedCredential
  >[0];
  const credential = extractIssuedCredential(issued);
  if (!credential) {
    throw new Error("missing credential in issuance response");
  }
  return { credential, holderKeyPair };
}

test.describe("OIDC4VP verifier", () => {
  test("verifies an SD-JWT presentation", async ({ request }) => {
    const { credential, holderKeyPair } =
      await issueCredentialForPresentation(request);
    const nonce = "test-nonce-verify";
    const kbJwt = await createKbJwt({
      credential,
      nonce,
      aud: oidcConfig.issuer,
      holderKeyPair,
    });

    const verifyRes = await request.post(
      `${oidcConfig.authBaseUrl}/oidc4vp/verify`,
      {
        data: {
          vp_token: `${credential}${kbJwt}`,
          nonce,
        },
        headers: originHeaders,
      }
    );

    expect(verifyRes.status(), await verifyRes.text()).toBe(200);
    const body = (await verifyRes.json()) as {
      verified?: boolean;
      presentations?: Array<{
        issuer?: string;
        status?: number;
        claims?: Record<string, unknown>;
      }>;
    };
    expect(body.verified).toBe(true);
    expect(body.presentations?.length).toBe(1);
    expect(body.presentations?.[0]?.issuer).toBe(oidcConfig.issuer);
    expect(body.presentations?.[0]?.status).toBe(0);
    expect(body.presentations?.[0]?.claims).toBeTruthy();
  });

  test("verifies a direct_post presentation response", async ({ request }) => {
    const { credential, holderKeyPair } =
      await issueCredentialForPresentation(request);
    // The response is checked against the stored request its state names, so
    // the KB-JWT is bound to that request's nonce and verifier client_id.
    const clientId = "x509_hash:e2e-verifier";
    const nonce = `vp-nonce-${crypto.randomUUID()}`;
    const state = `vp-state-${crypto.randomUUID()}`;
    await seedVpSession({
      clientId,
      nonce,
      state,
      dcqlQuery: {
        credentials: [
          {
            id: "identity",
            format: "dc+sd-jwt",
            meta: { vct_values: [oidcConfig.identityVct] },
          },
        ],
      },
    });
    const kbJwt = await createKbJwt({
      credential,
      nonce,
      aud: clientId,
      holderKeyPair,
    });

    const form = new URLSearchParams();
    form.set(
      "vp_token",
      JSON.stringify({ identity: [`${credential}${kbJwt}`] })
    );
    form.set("state", state);

    const responseRes = await request.post(
      `${oidcConfig.authBaseUrl}/oidc4vp/response`,
      {
        data: form.toString(),
        headers: {
          Origin: oidcConfig.baseUrl,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    expect(responseRes.status(), await responseRes.text()).toBe(200);
    const body = (await responseRes.json()) as {
      verified?: boolean;
      state?: string;
      presentations?: Array<{ issuer?: string }>;
    };
    expect(body.verified).toBe(true);
    expect(body.state).toBe(state);
    expect(body.presentations?.[0]?.issuer).toBe(oidcConfig.issuer);
  });

  test("rejects a direct_post response for an unknown state", async ({
    request,
  }) => {
    const form = new URLSearchParams();
    form.set("vp_token", JSON.stringify({ identity: ["not-a-presentation"] }));
    form.set("state", `vp-state-${crypto.randomUUID()}`);

    const responseRes = await request.post(
      `${oidcConfig.authBaseUrl}/oidc4vp/response`,
      {
        data: form.toString(),
        headers: {
          Origin: oidcConfig.baseUrl,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    expect(responseRes.status()).toBe(400);
  });

  test("rejects a tampered presentation", async ({ request }) => {
    const { credential, holderKeyPair } =
      await issueCredentialForPresentation(request);
    const nonce = "test-nonce-tampered";
    const [jwt, ...rest] = credential.split("~");
    if (!jwt) {
      throw new Error("credential missing jwt");
    }
    const position = jwt.length - 10;
    const replacement = jwt[position] === "A" ? "B" : "A";
    const tamperedJwt = `${jwt.slice(0, position)}${replacement}${jwt.slice(
      position + 1
    )}`;
    const tamperedCredential = [tamperedJwt, ...rest].join("~");
    const kbJwt = await createKbJwt({
      credential: tamperedCredential,
      nonce,
      aud: oidcConfig.issuer,
      holderKeyPair,
    });

    const verifyRes = await request.post(
      `${oidcConfig.authBaseUrl}/oidc4vp/verify`,
      {
        data: {
          vp_token: `${tamperedCredential}${kbJwt}`,
          nonce,
        },
        headers: originHeaders,
      }
    );

    expect(verifyRes.status()).toBe(400);
    const body = (await verifyRes.json()) as {
      verified?: boolean;
      errors?: Array<{ index: number; message?: string }>;
    };
    expect(body.verified).toBe(false);
    expect(body.errors?.length).toBe(1);
  });
});
