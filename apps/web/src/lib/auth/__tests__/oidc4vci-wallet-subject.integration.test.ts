import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  createTestSession,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  createTestDpopKeyPair,
  type DpopKeyPair,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";

const APP_URL = "http://localhost:3000";
const AUTH_URL = `${APP_URL}/api/auth`;
const CREDENTIAL_URL = `${AUTH_URL}/oidc4vci/credential`;
const PRE_AUTHORIZED_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:pre-authorized_code";
const CREDENTIAL_CONFIGURATION_ID = "identity_verification";
const PUBLIC_WALLET_ID = "public-wallet";
const PAIRWISE_WALLET_ID = "pairwise-wallet";
const PAIRWISE_WALLET_REFUSAL =
  "credentials are issued only to wallet clients with public subjects, and this client is pairwise";

async function insertWallet(
  clientId: string,
  subjectType: "pairwise" | null
): Promise<void> {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: clientId,
      grantTypes: JSON.stringify([PRE_AUTHORIZED_GRANT_TYPE]),
      redirectUris: JSON.stringify(["https://wallet.example/cb"]),
      scopes: JSON.stringify(["openid", "proof:identity"]),
      tokenEndpointAuthMethod: "none",
      skipConsent: true,
      subjectType,
    })
    .run();
}

// The OIDC4VCI plugin looks the user up by the access token's `sub`, which is
// pairwise for a pairwise wallet (upstream ask U25).
describe("OIDC4VCI wallet subjects", () => {
  let userId: string;
  let sessionCookie: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    const { token } = await createTestSession(userId);
    const signature = await makeSignature(token, env.BETTER_AUTH_SECRET);
    sessionCookie = `better-auth.session_token=${token}.${signature}`;
    await insertWallet(PUBLIC_WALLET_ID, null);
    await insertWallet(PAIRWISE_WALLET_ID, "pairwise");
  });

  function postOffer(clientId: string): Promise<Response> {
    return auth.handler(
      new Request(`${AUTH_URL}/oidc4vci/credential-offer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
          Origin: APP_URL,
        },
        body: JSON.stringify({
          client_id: clientId,
          credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
        }),
      })
    );
  }

  async function preAuthorizedCode(clientId: string): Promise<string> {
    const response = await postOffer(clientId);
    const body = (await response.json()) as {
      credential_offer?: {
        grants?: Record<string, { "pre-authorized_code"?: string }>;
      };
    };
    const code =
      body.credential_offer?.grants?.[PRE_AUTHORIZED_GRANT_TYPE]?.[
        "pre-authorized_code"
      ];
    if (!code) {
      throw new Error(`credential offer failed: ${JSON.stringify(body)}`);
    }
    return code;
  }

  async function walletToken(
    clientId: string,
    code: string,
    keyPair: DpopKeyPair
  ): Promise<string> {
    const { status, json } = await postTokenWithDpop(
      {
        grant_type: PRE_AUTHORIZED_GRANT_TYPE,
        "pre-authorized_code": code,
        client_id: clientId,
      },
      keyPair
    );
    if (status !== 200) {
      throw new Error(`token request failed: ${JSON.stringify(json)}`);
    }
    return json.access_token as string;
  }

  async function requestCredential(
    accessToken: string,
    keyPair: DpopKeyPair
  ): Promise<Response> {
    const nonceResponse = await auth.handler(
      new Request(`${AUTH_URL}/oidc4vci/nonce`, { method: "POST" })
    );
    const { c_nonce } = (await nonceResponse.json()) as { c_nonce: string };
    const holder = await generateKeyPair("EdDSA");
    const proofJwt = await new SignJWT({ nonce: c_nonce })
      .setProtectedHeader({
        alg: "EdDSA",
        jwk: await exportJWK(holder.publicKey),
        typ: "openid4vci-proof+jwt",
      })
      .setIssuedAt()
      .setAudience(AUTH_URL)
      .sign(holder.privateKey);
    return auth.handler(
      new Request(CREDENTIAL_URL, {
        method: "POST",
        headers: {
          Authorization: `DPoP ${accessToken}`,
          DPoP: await buildDpopProof(
            keyPair,
            "POST",
            CREDENTIAL_URL,
            accessToken
          ),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
          proofs: { jwt: [proofJwt] },
        }),
      })
    );
  }

  it("issues a credential to a public-subject wallet", async () => {
    const keyPair = await createTestDpopKeyPair();
    const accessToken = await walletToken(
      PUBLIC_WALLET_ID,
      await preAuthorizedCode(PUBLIC_WALLET_ID),
      keyPair
    );

    const response = await requestCredential(accessToken, keyPair);

    expect(response.status).toBe(200);
  });

  it("refuses a credential offer for a pairwise wallet", async () => {
    const response = await postOffer(PAIRWISE_WALLET_ID);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_client",
      error_description: PAIRWISE_WALLET_REFUSAL,
    });
  });

  it("refuses a pairwise wallet's token at the credential endpoint", async () => {
    // A wallet made pairwise after its offer redeems the code for a token
    // whose `sub` names no user.
    const code = await preAuthorizedCode(PUBLIC_WALLET_ID);
    await db
      .update(oauthClients)
      .set({ subjectType: "pairwise" })
      .where(eq(oauthClients.clientId, PUBLIC_WALLET_ID))
      .run();
    const keyPair = await createTestDpopKeyPair();
    const accessToken = await walletToken(PUBLIC_WALLET_ID, code, keyPair);
    expect(decodeJwt(accessToken).sub).not.toBe(userId);

    const response = await requestCredential(accessToken, keyPair);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "credential_request_denied",
      error_description: PAIRWISE_WALLET_REFUSAL,
    });
  });
});
