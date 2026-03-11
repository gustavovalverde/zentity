import crypto from "node:crypto";

import { decodeJwt, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { sealApprovalPii } from "@/lib/auth/oidc/approval-crypto";
import {
  consumeReleaseHandle,
  resetReleaseHandleStore,
  stageReleaseHandle,
} from "@/lib/auth/oidc/ephemeral-release-handles";
import { resetSigningKeyCache } from "@/lib/auth/oidc/jwt-signer";
import { db } from "@/lib/db/connection";
import { approvals } from "@/lib/db/schema/approvals";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";
import { type DpopKeyPair, postTokenWithDpop } from "@/test/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const RELEASE_URL = "http://localhost:3000/api/oauth2/release";
const TEST_CLIENT_ID = "lifecycle-test-agent";
// Resource must be a validAudiences entry so access tokens are JWT (not opaque)
const TEST_RESOURCE = "http://localhost:3000/api/auth";

async function createTestClient(clientId = TEST_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "Lifecycle Test Agent",
      redirectUris: ["http://localhost/callback"],
      grantTypes: [CIBA_GRANT_TYPE],
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function insertCibaRequest(
  overrides: Partial<typeof cibaRequests.$inferInsert> = {}
) {
  const authReqId = overrides.authReqId ?? crypto.randomUUID();
  await db
    .insert(cibaRequests)
    .values({
      authReqId,
      clientId: TEST_CLIENT_ID,
      userId: overrides.userId ?? "test-user",
      scope: "openid",
      status: "pending",
      expiresAt: new Date(Date.now() + 300_000),
      ...overrides,
    })
    .run();
  return authReqId;
}

async function postRelease(
  accessToken: string,
  dpopKeyPair: DpopKeyPair
): Promise<{ status: number; json: Record<string, unknown> }> {
  const dpopProof = await new SignJWT({
    htm: "POST",
    htu: RELEASE_URL,
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  })
    .setProtectedHeader({
      alg: "ES256",
      typ: "dpop+jwt",
      jwk: dpopKeyPair.jwk,
    })
    .setIssuedAt()
    .sign(dpopKeyPair.privateKey);

  const { POST } = await import("@/app/api/oauth2/release/route");
  const response = await POST(
    new Request(RELEASE_URL, {
      method: "POST",
      headers: {
        Authorization: `DPoP ${accessToken}`,
        DPoP: dpopProof,
      },
    })
  );
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json };
}

/**
 * Simulate what the CIBA identity stage endpoint does:
 * seal PII, insert a durable approval, stage the release handle.
 */
async function stageApproval(opts: {
  authReqId: string;
  userId: string;
  clientId: string;
  pii: Record<string, unknown>;
  scopes: string;
}) {
  const sealed = await sealApprovalPii(JSON.stringify(opts.pii));

  await db
    .insert(approvals)
    .values({
      authReqId: opts.authReqId,
      userId: opts.userId,
      clientId: opts.clientId,
      approvedScopes: opts.scopes,
      encryptedPii: sealed.encryptedPii,
      encryptionIv: sealed.encryptionIv,
      releaseHandleHash: sealed.releaseHandleHash,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    .run();

  stageReleaseHandle(opts.authReqId, sealed.releaseHandle, opts.userId);

  return sealed;
}

describe("CIBA → durable approval → release lifecycle", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    resetReleaseHandleStore();
    resetSigningKeyCache();
    userId = await createTestUser();
    await createTestClient();
  });

  it("full lifecycle: approve → stage PII → mint token → redeem → one-time use", async () => {
    const pii = {
      given_name: "Alice",
      family_name: "Smith",
      birthdate: "1990-01-15",
    };
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      scope: "openid identity.name identity.dob",
      resource: TEST_RESOURCE,
    });

    // Stage: seal PII + insert approval + stage release handle
    await stageApproval({
      authReqId,
      userId,
      clientId: TEST_CLIENT_ID,
      pii,
      scopes: "openid identity.name identity.dob",
    });

    // Mint: CIBA token endpoint produces access_token with release_handle
    const {
      status: tokenStatus,
      json: tokenJson,
      dpopKeyPair,
    } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(tokenStatus).toBe(200);

    const accessToken = tokenJson.access_token as string;
    const atPayload = decodeJwt(accessToken);
    expect(atPayload.release_handle).toBeDefined();
    expect(typeof atPayload.release_handle).toBe("string");

    // Redeem: release endpoint decrypts PII and returns id_token
    const { status: releaseStatus, json: releaseJson } = await postRelease(
      accessToken,
      dpopKeyPair
    );
    expect(releaseStatus).toBe(200);
    expect(releaseJson.id_token).toBeDefined();

    const idToken = decodeJwt(releaseJson.id_token as string);
    expect(idToken.given_name).toBe("Alice");
    expect(idToken.family_name).toBe("Smith");
    expect(idToken.birthdate).toBe("1990-01-15");
    expect(idToken.sub).toBe(userId);
    expect(idToken.aud).toBe(TEST_CLIENT_ID);

    // One-time use: second redemption fails
    const { status: replayStatus, json: replayJson } = await postRelease(
      accessToken,
      dpopKeyPair
    );
    expect(replayStatus).toBe(410);
    expect(replayJson.error).toBe("invalid_grant");
    expect(replayJson.error_description).toContain("already redeemed");
  });

  it("scope filtering: only approved identity scopes appear in released PII", async () => {
    const pii = {
      given_name: "Bob",
      family_name: "Jones",
      birthdate: "1985-06-20",
    };
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      scope: "openid identity.name",
      resource: TEST_RESOURCE,
    });

    // Only identity.name approved, not identity.dob
    await stageApproval({
      authReqId,
      userId,
      clientId: TEST_CLIENT_ID,
      pii,
      scopes: "openid identity.name",
    });

    const { json: tokenJson, dpopKeyPair } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const { status, json } = await postRelease(
      tokenJson.access_token as string,
      dpopKeyPair
    );
    expect(status).toBe(200);

    const idToken = decodeJwt(json.id_token as string);
    expect(idToken.given_name).toBe("Bob");
    expect(idToken.family_name).toBe("Jones");
    // birthdate NOT released because identity.dob not in approved scopes
    expect(idToken.birthdate).toBeUndefined();
  });

  it("no identity scopes: access token has no release_handle", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      scope: "openid",
      resource: TEST_RESOURCE,
    });

    // No approval staged — openid-only request

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(status).toBe(200);

    const payload = decodeJwt(json.access_token as string);
    expect(payload.release_handle).toBeUndefined();
  });

  it("authorization_details round-trips through release into id_token", async () => {
    const pii = { given_name: "Carol" };
    const authorizationDetails = JSON.stringify([
      { type: "purchase", amount: { currency: "USD", value: "42.00" } },
    ]);
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      scope: "openid identity.name",
      resource: TEST_RESOURCE,
      authorizationDetails,
    });

    const sealed = await sealApprovalPii(JSON.stringify(pii));
    await db
      .insert(approvals)
      .values({
        authReqId,
        userId,
        clientId: TEST_CLIENT_ID,
        approvedScopes: "openid identity.name",
        encryptedPii: sealed.encryptedPii,
        encryptionIv: sealed.encryptionIv,
        releaseHandleHash: sealed.releaseHandleHash,
        authorizationDetails,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      })
      .run();

    stageReleaseHandle(authReqId, sealed.releaseHandle, userId);

    const { json: tokenJson, dpopKeyPair } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const { status, json } = await postRelease(
      tokenJson.access_token as string,
      dpopKeyPair
    );
    expect(status).toBe(200);

    const idToken = decodeJwt(json.id_token as string);
    expect(idToken.given_name).toBe("Carol");
    expect(idToken.authorization_details).toEqual([
      { type: "purchase", amount: { currency: "USD", value: "42.00" } },
    ]);
  });

  it("staged handle survives non-identity-scope grant (scope guard)", async () => {
    // Stage a handle as if a CIBA approval just happened
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      scope: "openid",
      resource: TEST_RESOURCE,
    });

    const pii = { given_name: "Protected" };
    await stageApproval({
      authReqId,
      userId,
      clientId: TEST_CLIENT_ID,
      pii,
      scopes: "openid identity.name",
    });

    // Issue a token with only openid scope (no identity scopes).
    // The scope guard in customAccessTokenClaims should skip
    // consumeReleaseHandle entirely — the handle stays staged.
    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(status).toBe(200);

    const payload = decodeJwt(json.access_token as string);
    expect(payload.release_handle).toBeUndefined();

    // The handle should still be consumable for a future identity-scope grant
    const handle = consumeReleaseHandle(userId);
    expect(handle).not.toBeNull();
  });

  it("expired approval: release returns 410", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      scope: "openid identity.name",
      resource: TEST_RESOURCE,
    });

    const sealed = await sealApprovalPii(
      JSON.stringify({ given_name: "Expired" })
    );
    await db
      .insert(approvals)
      .values({
        authReqId,
        userId,
        clientId: TEST_CLIENT_ID,
        approvedScopes: "openid identity.name",
        encryptedPii: sealed.encryptedPii,
        encryptionIv: sealed.encryptionIv,
        releaseHandleHash: sealed.releaseHandleHash,
        // Already expired
        expiresAt: new Date(Date.now() - 1000),
      })
      .run();

    stageReleaseHandle(authReqId, sealed.releaseHandle, userId);

    const { json: tokenJson, dpopKeyPair } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const { status, json } = await postRelease(
      tokenJson.access_token as string,
      dpopKeyPair
    );
    expect(status).toBe(410);
    expect(json.error).toBe("invalid_grant");
    expect(json.error_description).toContain("expired");
  });
});
