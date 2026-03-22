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
  issueCredential,
  oidcConfig,
  originHeaders,
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
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    c_nonce: string;
  };

  const { proofJwt, holderKeyPair } = await createProofJwt(tokens.c_nonce);
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

    expect(verifyRes.status()).toBe(200);
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
    const nonce = "test-nonce-response";
    const kbJwt = await createKbJwt({
      credential,
      nonce,
      aud: oidcConfig.issuer,
      holderKeyPair,
    });

    const form = new URLSearchParams();
    form.set("vp_token", `${credential}${kbJwt}`);
    form.set("nonce", nonce);
    form.set("state", "state-123");

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

    expect(responseRes.status()).toBe(200);
    const body = (await responseRes.json()) as {
      verified?: boolean;
      state?: string;
      presentations?: Array<{ issuer?: string }>;
    };
    expect(body.verified).toBe(true);
    expect(body.state).toBe("state-123");
    expect(body.presentations?.[0]?.issuer).toBe(oidcConfig.issuer);
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
