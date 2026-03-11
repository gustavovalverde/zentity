import crypto from "node:crypto";

import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { identityBundles } from "@/lib/db/schema/identity";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";
import { postTokenWithDpop } from "@/test/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const TEST_CLIENT_ID = "assurance-test-agent";
const TEST_RESOURCE = "http://localhost:3000/api/auth";

async function createTestClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "Assurance Test Agent",
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
      status: "approved",
      expiresAt: new Date(Date.now() + 300_000),
      resource: TEST_RESOURCE,
      ...overrides,
    })
    .run();
  return authReqId;
}

async function seedTier1User(userId: string) {
  await db
    .insert(identityBundles)
    .values({
      userId,
      fheKeyId: "test-fhe-key-id",
      fheStatus: "complete",
      status: "verified",
    })
    .run();
}

describe("assurance claims in ID tokens", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
  });

  it("tier-1 passkey user gets correct acr, acr_eidas, and amr", async () => {
    await seedTier1User(userId);

    // Insert session with lastLoginMethod=passkey so amr resolves correctly
    await db
      .insert((await import("@/lib/db/schema/auth")).sessions)
      .values({
        id: crypto.randomUUID(),
        userId,
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLoginMethod: "passkey",
      })
      .run();

    const authReqId = await insertCibaRequest({ userId });
    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(status).toBe(200);

    const idToken = json.id_token as string;
    expect(idToken).toBeDefined();

    const claims = decodeJwt(idToken);
    expect(claims.acr).toBe("urn:zentity:assurance:tier-1");
    expect(claims.acr_eidas).toBe("http://eidas.europa.eu/LoA/low");
    expect(claims.amr).toEqual(["pop", "hwk", "user"]);
  });

  it("tier-1 opaque user gets amr=pwd", async () => {
    await seedTier1User(userId);

    await db
      .insert((await import("@/lib/db/schema/auth")).sessions)
      .values({
        id: crypto.randomUUID(),
        userId,
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLoginMethod: "opaque",
      })
      .run();

    const authReqId = await insertCibaRequest({ userId });
    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const claims = decodeJwt(json.id_token as string);
    expect(claims.acr).toBe("urn:zentity:assurance:tier-1");
    expect(claims.amr).toEqual(["pwd"]);
  });

  it("tier-0 user (no FHE keys) gets acr tier-0", async () => {
    // No identity bundle → no secured keys → tier 0
    // But getAssuranceForOAuth sets hasSession=true, so if no keys,
    // tier stays at 0 since tier 1 requires hasSecuredKeys
    const authReqId = await insertCibaRequest({ userId });
    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const claims = decodeJwt(json.id_token as string);
    // hasSession=true but hasSecuredKeys=false → stays at tier 0
    // Actually tier computation: hasSession && hasSecuredKeys → tier 1
    // Without secured keys, tier remains 0
    expect(claims.acr).toBe("urn:zentity:assurance:tier-0");
    expect(claims.acr_eidas).toBe("http://eidas.europa.eu/LoA/low");
  });

  it("at_hash binds ID token to companion access token", async () => {
    await seedTier1User(userId);

    await db
      .insert((await import("@/lib/db/schema/auth")).sessions)
      .values({
        id: crypto.randomUUID(),
        userId,
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLoginMethod: "passkey",
      })
      .run();

    const authReqId = await insertCibaRequest({ userId });
    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(status).toBe(200);

    const idToken = json.id_token as string;
    const accessToken = json.access_token as string;
    expect(idToken).toBeDefined();
    expect(accessToken).toBeDefined();

    const claims = decodeJwt(idToken);
    expect(claims.at_hash).toBeDefined();

    // Verify: recompute at_hash from access token (default RS256 → SHA-256)
    const hash = crypto
      .createHash("sha256")
      .update(accessToken, "ascii")
      .digest();
    const expectedAtHash = hash.subarray(0, 16).toString("base64url");
    expect(claims.at_hash).toBe(expectedAtHash);
  });

  it("omits assurance claims when openid scope is absent", async () => {
    await seedTier1User(userId);

    // Request without openid scope
    const authReqId = await insertCibaRequest({
      userId,
      scope: "email",
    });
    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    // Without openid scope, no id_token is produced by the framework
    // (OIDC Core requires openid scope for id_token)
    // The token response may or may not include id_token depending on
    // the oauth-provider behavior. If it does, assurance claims should be absent.
    if (json.id_token) {
      const claims = decodeJwt(json.id_token as string);
      expect(claims.acr).toBeUndefined();
      expect(claims.amr).toBeUndefined();
    }
  });
});
