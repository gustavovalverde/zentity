import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import {
  BUILT_IN_WALLET_CLIENT_ID,
  ensureWalletClientExists,
} from "@/lib/auth/oidc/wallet-dcr";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { oidc4vciIssuedCredentials } from "@/lib/db/schema/oidc-credentials";
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

describe("OIDC4VCI wallet subjects", () => {
  let userId: string;
  let sessionCookie: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    const { token } = await createTestSession(userId);
    const signature = await makeSignature(token, env.BETTER_AUTH_SECRET);
    sessionCookie = `better-auth.session_token=${token}.${signature}`;
  });

  function sessionRequest(path: string, body: Record<string, unknown>) {
    return auth.handler(
      new Request(`${AUTH_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
          Origin: APP_URL,
        },
        body: JSON.stringify(body),
      })
    );
  }

  /** A wallet registered through `/oauth2/create-client`, which is pairwise. */
  async function registerWallet(): Promise<string> {
    const response = await sessionRequest("/oauth2/create-client", {
      client_name: "Registered Wallet",
      redirect_uris: ["https://wallet.example/cb"],
      token_endpoint_auth_method: "none",
      grant_types: [PRE_AUTHORIZED_GRANT_TYPE],
      skip_consent: true,
    });
    const body = (await response.json()) as { client_id?: string };
    if (!body.client_id) {
      throw new Error(`client registration failed: ${JSON.stringify(body)}`);
    }
    return body.client_id;
  }

  async function preAuthorizedCode(clientId: string): Promise<string> {
    const response = await sessionRequest("/oidc4vci/credential-offer", {
      client_id: clientId,
      credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
    });
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
    keyPair: DpopKeyPair
  ): Promise<string> {
    const { status, json } = await postTokenWithDpop(
      {
        grant_type: PRE_AUTHORIZED_GRANT_TYPE,
        "pre-authorized_code": await preAuthorizedCode(clientId),
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

  /** Redeems an offer for the wallet and requests its credential. */
  async function issueToWallet(clientId: string) {
    const keyPair = await createTestDpopKeyPair();
    const accessToken = await walletToken(clientId, keyPair);
    const response = await requestCredential(accessToken, keyPair);
    const body = (await response.json()) as {
      credentials?: Array<{ credential: string }>;
    };
    const credential = body.credentials?.[0]?.credential ?? "";
    const [sdJwt] = credential.split("~");
    const records = await db
      .select({ userId: oidc4vciIssuedCredentials.userId })
      .from(oidc4vciIssuedCredentials)
      .all();
    return {
      status: response.status,
      tokenClaims: decodeJwt(accessToken),
      credential,
      credentialClaims: decodeJwt(sdJwt ?? ""),
      records,
    };
  }

  async function builtInWallet(): Promise<string> {
    return await ensureWalletClientExists();
  }

  it.each([
    ["a registered wallet", registerWallet],
    ["the built-in wallet", builtInWallet],
  ])("issues a credential without a subject to %s", async (_label, wallet) => {
    const clientId = await wallet();
    const client = await db
      .select({ subjectType: oauthClients.subjectType })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
      .get();
    expect(client?.subjectType).toBe("pairwise");

    const issued = await issueToWallet(clientId);

    expect(issued.tokenClaims.sub).toEqual(expect.any(String));
    expect(issued.tokenClaims.sub).not.toBe(userId);
    expect(issued.tokenClaims.ba_sub).toEqual(expect.any(String));
    expect(issued.status).toBe(200);
    expect(issued.credentialClaims).not.toHaveProperty("sub");
    expect(issued.credential).not.toContain(userId);
    expect(issued.credential).not.toContain(String(issued.tokenClaims.sub));
    // The plugin resolved the real user: the issued record is theirs.
    expect(issued.records).toEqual([{ userId }]);
  });
});

describe("built-in OIDC4VCI wallet client", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  function walletRows() {
    return db
      .select({
        subjectType: oauthClients.subjectType,
        sectorIdentifier: oauthClients.sectorIdentifier,
        redirectUris: oauthClients.redirectUris,
      })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, BUILT_IN_WALLET_CLIENT_ID))
      .all();
  }

  const PAIRWISE_WALLET = {
    subjectType: "pairwise",
    sectorIdentifier: "client/zentity-wallet",
    redirectUris: "[]",
  };

  it("creates a pairwise wallet client", async () => {
    await expect(ensureWalletClientExists()).resolves.toBe(
      BUILT_IN_WALLET_CLIENT_ID
    );

    expect(await walletRows()).toEqual([PAIRWISE_WALLET]);
  });

  it("makes a wallet client an earlier release created public pairwise, once", async () => {
    await db
      .insert(oauthClients)
      .values({
        clientId: BUILT_IN_WALLET_CLIENT_ID,
        name: "Zentity Wallet",
        tokenEndpointAuthMethod: "none",
        grantTypes: JSON.stringify([PRE_AUTHORIZED_GRANT_TYPE]),
        redirectUris: JSON.stringify([]),
      })
      .run();

    await ensureWalletClientExists();
    await ensureWalletClientExists();

    expect(await walletRows()).toEqual([PAIRWISE_WALLET]);
  });
});
