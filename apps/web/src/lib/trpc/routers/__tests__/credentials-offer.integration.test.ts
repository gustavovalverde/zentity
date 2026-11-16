import type { Session } from "@/lib/auth/auth-config";

import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "@/env";
import { BUILT_IN_WALLET_CLIENT_ID } from "@/lib/auth/oidc/wallet-dcr";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { credentialsRouter } from "@/lib/trpc/routers/credentials";
import {
  createTestSession,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import {
  createTestDpopKeyPair,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";

vi.mock("@/lib/identity/verification/read-model", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/identity/verification/read-model")
  >()),
  getComplianceStatus: vi.fn(async () => ({ identity: { verified: true } })),
}));

const PRE_AUTHORIZED_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:pre-authorized_code";
const REGISTERED_WALLET_ID = "registered-wallet";
const OFFER_URI_PATTERN = /^openid-credential-offer:\/\/\?/;

async function insertWallet(
  clientId: string,
  values: {
    disabled?: boolean;
    grantTypes?: string[];
    tokenEndpointAuthMethod?: string;
  } = {}
) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: clientId,
      disabled: values.disabled ?? false,
      grantTypes: JSON.stringify(
        values.grantTypes ?? [PRE_AUTHORIZED_GRANT_TYPE]
      ),
      redirectUris: JSON.stringify(["https://wallet.example/cb"]),
      scopes: JSON.stringify(["openid"]),
      tokenEndpointAuthMethod: values.tokenEndpointAuthMethod ?? "none",
      skipConsent: true,
      subjectType: "pairwise",
      sectorIdentifier: "wallet.example",
    })
    .run();
}

function preAuthorizedCode(offer: Record<string, unknown>): string {
  const grants = offer.grants as Record<
    string,
    { "pre-authorized_code": string }
  >;
  return grants[PRE_AUTHORIZED_GRANT_TYPE]?.["pre-authorized_code"] ?? "";
}

async function redeem(code: string, clientId?: string) {
  return postTokenWithDpop(
    {
      grant_type: PRE_AUTHORIZED_GRANT_TYPE,
      "pre-authorized_code": code,
      ...(clientId ? { client_id: clientId } : {}),
    },
    await createTestDpopKeyPair()
  );
}

describe("credentials.createOffer", () => {
  let userId: string;
  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    const { token, sessionId } = await createTestSession(userId);
    const signature = await makeSignature(token, env.BETTER_AUTH_SECRET);
    const cookie = `better-auth.session_token=${token}.${signature}`;
    caller = credentialsRouter.createCaller({
      authContext: null,
      flowId: null,
      flowIdSource: "none",
      req: new Request("http://localhost:3000/api/trpc", {
        headers: { cookie, origin: "http://localhost:3000" },
      }),
      requestId: "test-request-id",
      session: {
        user: { id: userId, email: "user@example.com" },
        session: { id: sessionId },
      } as unknown as Session,
    });
  });

  let caller: ReturnType<typeof credentialsRouter.createCaller>;

  it("offers the credential to the built-in wallet by default", async () => {
    const { offer, offerUri } = await caller.createOffer({});

    expect(offerUri).toMatch(OFFER_URI_PATTERN);
    const code = preAuthorizedCode(offer);
    expect((await redeem(code, BUILT_IN_WALLET_CLIENT_ID)).status).toBe(200);
  });

  it("offers the credential to a registered wallet the user names", async () => {
    await insertWallet(REGISTERED_WALLET_ID);

    const { offer } = await caller.createOffer({
      walletClientId: ` ${REGISTERED_WALLET_ID} `,
    });

    const code = preAuthorizedCode(offer);
    const builtIn = await redeem(code, BUILT_IN_WALLET_CLIENT_ID);
    expect(builtIn.status).toBe(400);
    expect(builtIn.json.error).toBe("invalid_grant");
    expect((await redeem(code, REGISTERED_WALLET_ID)).status).toBe(200);
  });

  it("lets a confidential registered wallet redeem only after it authenticates", async () => {
    await insertWallet(REGISTERED_WALLET_ID, {
      tokenEndpointAuthMethod: "client_secret_basic",
    });

    const { offer } = await caller.createOffer({
      walletClientId: REGISTERED_WALLET_ID,
    });

    const code = preAuthorizedCode(offer);
    const anonymous = await redeem(code);
    expect(anonymous.status).toBe(400);
    expect(anonymous.json.error).toBe("invalid_client");
    const withoutSecret = await redeem(code, REGISTERED_WALLET_ID);
    expect(withoutSecret.json.error).toBe("invalid_client");
  });

  it.each([
    ["an unknown client", async () => undefined],
    ["a disabled client", () => insertWallet("wallet-x", { disabled: true })],
    [
      "a client without the pre-authorized code grant",
      () => insertWallet("wallet-x", { grantTypes: ["authorization_code"] }),
    ],
  ])("refuses %s", async (_label, setUp) => {
    await setUp();

    await expect(
      caller.createOffer({ walletClientId: "wallet-x" })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "No wallet with this client ID can receive credentials.",
    });
    expect(
      await db
        .select({ id: oauthClients.id })
        .from(oauthClients)
        .where(eq(oauthClients.clientId, BUILT_IN_WALLET_CLIENT_ID))
        .all()
    ).toEqual([]);
  });
});
