import { expect, test } from "@playwright/test";

const TRAILING_SLASHES_REGEX = /\/+$/;

import {
  createCredentialOffer,
  createDpopBinding,
  createDpopProof,
  createIssuerSession,
  createProofJwt,
  createWalletClient,
  exchangePreAuthorizedCode,
  extractIssuedCredential,
  fetchIssuerJwks,
  findIssuedCredentialRecord,
  issueCredential,
  oidcConfig,
  originHeaders,
  verifyIssuedCredential,
} from "./oidc-helpers";

test.describe("OIDC4VCI issuer", () => {
  test("exposes issuer metadata", async ({ request }) => {
    const issuerUrl = new URL(oidcConfig.issuer);
    const issuerPath = issuerUrl.pathname.replace(TRAILING_SLASHES_REGEX, "");
    const issuerWellKnown = `${issuerUrl.origin}/.well-known/openid-credential-issuer${
      issuerPath && issuerPath !== "/" ? issuerPath : ""
    }`;
    const res = await request.get(issuerWellKnown);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.credential_issuer).toBe(oidcConfig.issuer);
    expect(body.credential_endpoint).toBe(
      `${oidcConfig.authBaseUrl}/oidc4vci/credential`
    );
    const authorizationServers = body.authorization_servers as
      | string[]
      | undefined;
    expect(authorizationServers?.[0]).toBe(oidcConfig.issuer);

    const oauthWellKnown = `${issuerUrl.origin}/.well-known/oauth-authorization-server${
      issuerPath && issuerPath !== "/" ? issuerPath : ""
    }`;
    const oauthMetadataRes = await request.get(oauthWellKnown);
    expect(oauthMetadataRes.ok()).toBeTruthy();
    const oauthMetadata = (await oauthMetadataRes.json()) as {
      token_endpoint?: string;
    };
    expect(oauthMetadata.token_endpoint).toBe(
      `${oidcConfig.authBaseUrl}/oauth2/token`
    );
  });

  test("issues a bound SD-JWT VC and verifies holder binding", async ({
    request,
  }) => {
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
      authorization_details?: Array<{
        credential_identifiers?: string[];
      }>;
    };

    const credentialIdentifier =
      tokens.authorization_details?.[0]?.credential_identifiers?.[0];
    const { proofJwt, holderJwk } = await createProofJwt(tokens.c_nonce);

    const credentialRes = await issueCredential(request, {
      accessToken: tokens.access_token,
      credentialConfigurationId: credentialIdentifier
        ? undefined
        : oidcConfig.identityCredentialConfigurationId,
      credentialIdentifier,
      proofJwt,
      dpopBinding,
    });
    expect(credentialRes.status()).toBe(200);
    const payload = (await credentialRes.json()) as Parameters<
      typeof extractIssuedCredential
    >[0];
    const credential = extractIssuedCredential(payload);
    expect(credential).toBeTruthy();

    const jwks = await fetchIssuerJwks(request);
    await verifyIssuedCredential({
      credential: credential ?? "",
      userId,
      holderJwk,
      jwks,
      expectedVct: oidcConfig.identityVct,
    });
  });

  test("issues credential with Draft 11 format-based request (walt.id compat)", async ({
    request,
  }) => {
    // This test verifies backwards compatibility with OIDC4VCI Draft 11 implementations
    // like walt.id that use format + vct instead of credential_configuration_id.
    // Draft 11 requires: format (REQUIRED) + format-specific params (vct for SD-JWT)
    // OIDC4VCI 1.0 requires: credential_identifier OR credential_configuration_id
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

    const { proofJwt, holderJwk } = await createProofJwt(tokens.c_nonce);

    // Issue credential using Draft 11 format-based request (how walt.id does it)
    // - format: "dc+sd-jwt" (the credential format)
    // - vct: the verifiable credential type identifier
    // - NO credential_configuration_id or credential_identifier
    const credentialRes = await issueCredential(request, {
      accessToken: tokens.access_token,
      format: "dc+sd-jwt",
      vct: oidcConfig.identityVct,
      proofJwt,
      dpopBinding,
    });
    expect(credentialRes.status()).toBe(200);

    const credentialBody = (await credentialRes.json()) as Parameters<
      typeof extractIssuedCredential
    >[0];
    const credential = extractIssuedCredential(credentialBody);
    expect(credential).toBeTruthy();

    // Verify the credential is valid and properly bound
    const jwks = await fetchIssuerJwks(request);
    await verifyIssuedCredential({
      credential: credential ?? "",
      userId,
      holderJwk,
      jwks,
      expectedVct: oidcConfig.identityVct,
    });
  });

  test("rejects reuse of a c_nonce", async ({ request }) => {
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

    const { proofJwt } = await createProofJwt(tokens.c_nonce);

    const first = await issueCredential(request, {
      accessToken: tokens.access_token,
      credentialConfigurationId: oidcConfig.identityCredentialConfigurationId,
      proofJwt,
      dpopBinding,
    });
    expect(first.status()).toBe(200);

    const second = await issueCredential(request, {
      accessToken: tokens.access_token,
      credentialConfigurationId: oidcConfig.identityCredentialConfigurationId,
      proofJwt,
      dpopBinding,
    });
    expect(second.status()).toBe(400);
    const errorBody = (await second.json()) as { error?: string };
    expect(errorBody.error).toBe("invalid_nonce");
  });

  test("rejects invalid pre-authorized codes", async ({ request }) => {
    const { cookieHeader } = await createIssuerSession(request);
    const clientId = await createWalletClient(request, cookieHeader);
    const dpopBinding = await createDpopBinding();
    const tokenRes = await exchangePreAuthorizedCode(request, {
      preAuthorizedCode: "not-a-real-code",
      clientId,
      dpopBinding,
    });
    expect(tokenRes.status()).toBe(401);
    const body = (await tokenRes.json()) as { error?: string };
    expect(body.error).toBe("invalid_grant");
  });

  test("updates credential status via issuer admin endpoint", async ({
    request,
  }) => {
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

    const { proofJwt } = await createProofJwt(tokens.c_nonce);
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

    const record = await findIssuedCredentialRecord(credential);
    expect(record.status).toBe(0);

    const updateRes = await request.post(
      `${oidcConfig.authBaseUrl}/oidc4vci/credential/status`,
      {
        data: {
          credential_id: record.id,
          status: 1,
        },
        headers: {
          Cookie: cookieHeader,
          ...originHeaders,
        },
      }
    );
    expect(updateRes.ok()).toBeTruthy();

    const updated = await findIssuedCredentialRecord(credential);
    expect(updated.status).toBe(1);
    expect(updated.revokedAt).toBeTruthy();
  });

  test("supports deferred issuance for the deferred configuration", async ({
    request,
  }) => {
    const { cookieHeader, userId } = await createIssuerSession(request);
    const clientId = await createWalletClient(request, cookieHeader);
    const dpopBinding = await createDpopBinding();
    const { preAuthorizedCode } = await createCredentialOffer(request, {
      cookieHeader,
      clientId,
      userId,
      credentialConfigurationId: oidcConfig.deferredCredentialConfigurationId,
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

    const { proofJwt } = await createProofJwt(tokens.c_nonce);
    const deferredRes = await issueCredential(request, {
      accessToken: tokens.access_token,
      credentialConfigurationId: oidcConfig.deferredCredentialConfigurationId,
      proofJwt,
      dpopBinding,
    });
    expect(deferredRes.status()).toBe(202);
    const deferredBody = (await deferredRes.json()) as {
      transaction_id?: string;
      interval?: number;
    };
    expect(deferredBody.transaction_id).toBeTruthy();

    const fulfillmentRes = await request.post(
      `${oidcConfig.authBaseUrl}/oidc4vci/credential/deferred`,
      {
        data: {
          transaction_id: deferredBody.transaction_id,
        },
        headers: {
          Authorization: `DPoP ${tokens.access_token}`,
          DPoP: (
            await createDpopProof({
              method: "POST",
              url: `${oidcConfig.authBaseUrl}/oidc4vci/credential/deferred`,
              accessToken: tokens.access_token,
              binding: dpopBinding,
            })
          ).proof,
          ...originHeaders,
        },
      }
    );
    expect(fulfillmentRes.status()).toBe(200);
    const fulfillmentBody = (await fulfillmentRes.json()) as Parameters<
      typeof extractIssuedCredential
    >[0];
    expect(extractIssuedCredential(fulfillmentBody)).toBeTruthy();

    const secondRes = await request.post(
      `${oidcConfig.authBaseUrl}/oidc4vci/credential/deferred`,
      {
        data: {
          transaction_id: deferredBody.transaction_id,
        },
        headers: {
          Authorization: `DPoP ${tokens.access_token}`,
          DPoP: (
            await createDpopProof({
              method: "POST",
              url: `${oidcConfig.authBaseUrl}/oidc4vci/credential/deferred`,
              accessToken: tokens.access_token,
              binding: dpopBinding,
            })
          ).proof,
          ...originHeaders,
        },
      }
    );
    expect(secondRes.status()).toBe(400);
    const secondBody = (await secondRes.json()) as { error?: string };
    expect(secondBody.error).toBe("invalid_transaction_id");
  });
});
