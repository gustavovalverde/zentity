import { type APIRequestContext, expect, test } from "@playwright/test";

import {
  createCredentialOffer,
  createIssuerSession,
  createProofJwt,
  createWalletClient,
  exchangePreAuthorizedCode,
  issueCredential,
  oidcConfig,
  originHeaders,
} from "./oidc-helpers";

async function issueCredentialForPresentation(request: APIRequestContext) {
  const { cookieHeader, userId } = await createIssuerSession(request);
  const clientId = await createWalletClient(request, cookieHeader);
  const { preAuthorizedCode } = await createCredentialOffer(request, {
    cookieHeader,
    clientId,
    userId,
    credentialConfigurationId: "zentity_identity",
  });

  const tokenRes = await exchangePreAuthorizedCode(request, {
    preAuthorizedCode,
    clientId,
  });
  expect(tokenRes.status()).toBe(200);
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    c_nonce: string;
  };

  const { proofJwt } = await createProofJwt(tokens.c_nonce);
  const credentialRes = await issueCredential(request, {
    accessToken: tokens.access_token,
    credentialConfigurationId: "zentity_identity",
    proofJwt,
  });
  expect(credentialRes.status()).toBe(200);
  const issued = (await credentialRes.json()) as {
    credentials?: Array<{ credential?: string }>;
  };
  const credential = issued.credentials?.[0]?.credential;
  if (!credential) {
    throw new Error("missing credential in issuance response");
  }
  return credential;
}

test.describe("OIDC4VP verifier", () => {
  test("verifies an SD-JWT presentation", async ({ request }) => {
    const credential = await issueCredentialForPresentation(request);

    const verifyRes = await request.post(
      `${oidcConfig.authBaseUrl}/oidc4vp/verify`,
      {
        data: {
          vp_token: credential,
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
    const credential = await issueCredentialForPresentation(request);

    const form = new URLSearchParams();
    form.set("vp_token", credential);
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
    const credential = await issueCredentialForPresentation(request);
    const [jwt, ...rest] = credential.split("~");
    if (!jwt) {
      throw new Error("credential missing jwt");
    }
    const suffix = jwt.at(-1) === "a" ? "b" : "a";
    const tamperedJwt = `${jwt.slice(0, -1)}${suffix}`;
    const tamperedCredential = [tamperedJwt, ...rest].join("~");

    const verifyRes = await request.post(
      `${oidcConfig.authBaseUrl}/oidc4vp/verify`,
      {
        data: { vp_token: tamperedCredential },
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
