import crypto from "node:crypto";

import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import {
  attachHumanSignal,
  detachHumanSignal,
} from "@/lib/db/queries/identity";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaRequest,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";

import { POST as proofOfHumanPost } from "../route";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const CLIENT_ID = "poh-test-client";
const VALID_RESOURCE = "http://localhost:3000";
const POH_URL = `${VALID_RESOURCE}/api/auth/oauth2/proof-of-human`;

async function createTestClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: CLIENT_ID,
      name: CLIENT_ID,
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify(["authorization_code", CIBA_GRANT_TYPE]),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function issuePohToken(userId: string) {
  const { authReqId } = await createTestCibaRequest({
    clientId: CLIENT_ID,
    userId,
    resource: VALID_RESOURCE,
    scope: "openid poh",
    status: "approved",
  });

  const response = await postTokenWithDpop({
    grant_type: CIBA_GRANT_TYPE,
    auth_req_id: authReqId,
    client_id: CLIENT_ID,
  });

  if (response.status !== 200) {
    throw new Error(
      `Expected token exchange to succeed, received ${response.status}`
    );
  }

  const accessToken = response.json.access_token;
  if (typeof accessToken !== "string") {
    throw new Error("Expected token response to include an access token");
  }

  return { accessToken, dpopKeyPair: response.dpopKeyPair };
}

async function callProofOfHuman(
  accessToken: string,
  dpopKeyPair: Awaited<ReturnType<typeof postTokenWithDpop>>["dpopKeyPair"]
): Promise<Response> {
  const dpopProof = await buildDpopProof(dpopKeyPair, "POST", POH_URL);
  return proofOfHumanPost(
    new Request(POH_URL, {
      method: "POST",
      headers: {
        authorization: `DPoP ${accessToken}`,
        DPoP: dpopProof,
      },
    })
  );
}

async function attachWorldIdSignal(userId: string) {
  await attachHumanSignal({
    userId,
    provider: "world_id",
    providerSubjectKind: "nullifier",
    providerSubjectHash: `world-subject-${crypto.randomUUID()}`,
  });
}

describe("Proof of Human endpoint", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    await createTestClient();
    userId = await createTestUser();
  });

  it("returns 403 not_verified when the user has no verification at all", async () => {
    const { accessToken, dpopKeyPair } = await issuePohToken(userId);

    const response = await callProofOfHuman(accessToken, dpopKeyPair);

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("not_verified");
  });

  it("issues a Tier 1.5 PoH JWT for a user whose only signal is a World ID human signal", async () => {
    await attachWorldIdSignal(userId);
    const { accessToken, dpopKeyPair } = await issuePohToken(userId);

    const response = await callProofOfHuman(accessToken, dpopKeyPair);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { token: string };
    expect(typeof body.token).toBe("string");

    const claims = decodeJwt(body.token);
    expect(claims.poh).toEqual({
      tier: 1.5,
      verified: false,
      sybil_resistant: true,
    });
    expect(claims.scope).toBe("poh");
    const accessTokenClaims = decodeJwt(accessToken);
    expect(claims.sub).toBe(accessTokenClaims.sub);

    const cnf = claims.cnf as { jkt?: string } | undefined;
    const accessTokenCnf = accessTokenClaims.cnf as
      | { jkt?: string }
      | undefined;
    expect(typeof cnf?.jkt).toBe("string");
    expect(cnf?.jkt).toBe(accessTokenCnf?.jkt);
  });

  it("downgrades to 403 not_verified after the human signal is detached", async () => {
    await attachWorldIdSignal(userId);
    const { accessToken: linkedToken, dpopKeyPair: linkedKeyPair } =
      await issuePohToken(userId);
    const linkedResponse = await callProofOfHuman(linkedToken, linkedKeyPair);
    expect(linkedResponse.status).toBe(200);

    await detachHumanSignal({ userId, provider: "world_id" });

    const { accessToken: detachedToken, dpopKeyPair: detachedKeyPair } =
      await issuePohToken(userId);
    const detachedResponse = await callProofOfHuman(
      detachedToken,
      detachedKeyPair
    );
    expect(detachedResponse.status).toBe(403);
  });

  it("rejects unauthenticated callers", async () => {
    const response = await proofOfHumanPost(
      new Request(POH_URL, { method: "POST" })
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("invalid_token");
  });

  it("rejects callers whose token lacks the poh scope", async () => {
    await attachWorldIdSignal(userId);
    const { authReqId } = await createTestCibaRequest({
      clientId: CLIENT_ID,
      userId,
      resource: VALID_RESOURCE,
      scope: "openid email",
      status: "approved",
    });
    const response = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: CLIENT_ID,
    });
    expect(response.status).toBe(200);
    const accessToken = response.json.access_token as string;

    const pohResponse = await callProofOfHuman(
      accessToken,
      response.dpopKeyPair
    );
    expect(pohResponse.status).toBe(403);
    const body = (await pohResponse.json()) as { error?: string };
    expect(body.error).toBe("insufficient_scope");
  });
});
