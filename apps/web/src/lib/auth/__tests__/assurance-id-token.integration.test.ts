import crypto from "node:crypto";

import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { computeAtHash } from "@/lib/assurance/oidc-claims";
import { auth } from "@/lib/auth/auth-config";
import {
  AUTHENTICATION_CONTEXT_CLAIM,
  createAuthenticationContext,
  resolveAuthenticationContext,
} from "@/lib/auth/auth-context";
import { createCibaApproval } from "@/lib/auth/oidc/ciba";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { identityBundles } from "@/lib/db/schema/identity";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  createTestUser,
  hashCibaAuthReqId,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import { postTokenWithDpop } from "@/test-utils/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const TEST_CLIENT_ID = "assurance-test-agent";
const TEST_RESOURCE = "http://localhost:3000/api/auth";

const cibaApproval = createCibaApproval((body) =>
  auth.api.completeCibaRequest({ body })
);

async function createTestClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "Assurance Test Agent",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
      tokenEndpointAuthMethod: "none",
    })
    .run();
}

/** A request the user approved through Zentity's approval path. */
async function approvedCibaRequest(input: {
  authContextId: string;
  scope?: string;
  userId: string;
}) {
  const authReqId = crypto.randomUUID();
  const [row] = await db
    .insert(cibaRequests)
    .values({
      clientId: TEST_CLIENT_ID,
      userId: input.userId,
      scope: input.scope ?? "openid",
      status: "pending",
      expiresAt: new Date(Date.now() + 300_000),
      resources: JSON.stringify([TEST_RESOURCE]),
      // Plugin stores the hash at rest; callers send the raw value.
      authReqId: hashCibaAuthReqId(authReqId),
    })
    .returning({ id: cibaRequests.id });
  const authentication = await resolveAuthenticationContext({
    authContextId: input.authContextId,
  });
  if (!(row && authentication)) {
    throw new Error("Failed to create an approved CIBA request");
  }
  await cibaApproval.approve({
    requestId: row.id,
    userId: input.userId,
    authentication,
    grant: { method: "user" },
  });
  return authReqId;
}

async function seedTier1User(userId: string) {
  await db
    .insert(identityBundles)
    .values({
      userId,
      fheKeyId: "test-fhe-key-id",
      fheStatus: "complete",
      validityStatus: "verified",
    })
    .run();
}

function createAuthContext(
  userId: string,
  loginMethod: "opaque" | "passkey" = "passkey"
) {
  return createAuthenticationContext({
    userId,
    loginMethod,
    authenticatedAt: new Date(),
    sourceKind: "ciba_approval",
    referenceType: "ciba_request",
  });
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
    const authContext = await createAuthContext(userId, "passkey");
    const authReqId = await approvedCibaRequest({
      userId,
      authContextId: authContext.id,
    });
    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(status).toBe(200);

    const idToken = json.id_token as string;
    expect(idToken).toBeDefined();

    const claims = decodeJwt(idToken);
    // The approval states the tier as acr and the approving session's amr.
    expect(claims.acr).toBe("urn:zentity:assurance:tier-1");
    expect(claims.amr).toEqual(["pop", "hwk", "user"]);
    const assurance = claims.zentity_assurance as Record<string, unknown>;
    expect(assurance.acr).toBe("urn:zentity:assurance:tier-1");
    expect(assurance.acr_eidas).toBe("http://eidas.europa.eu/LoA/low");
    expect(assurance.amr).toEqual(["pop", "hwk", "user"]);
    expect(claims[AUTHENTICATION_CONTEXT_CLAIM]).toBe(authContext.id);
    expect(claims.auth_time).toBeDefined();
    expect(typeof claims.auth_time).toBe("number");
    const now = Math.floor(Date.now() / 1000);
    expect(claims.auth_time as number).toBeLessThanOrEqual(now);
    expect(claims.auth_time as number).toBeGreaterThan(now - 3600);
  });

  it("tier-1 opaque user gets amr=pwd", async () => {
    await seedTier1User(userId);
    const authContext = await createAuthContext(userId, "opaque");
    const authReqId = await approvedCibaRequest({
      userId,
      authContextId: authContext.id,
    });
    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const claims = decodeJwt(json.id_token as string);
    expect(claims.acr).toBe("urn:zentity:assurance:tier-1");
    expect(claims.amr).toEqual(["pwd"]);
    const assurance = claims.zentity_assurance as Record<string, unknown>;
    expect(assurance.acr).toBe("urn:zentity:assurance:tier-1");
    expect(assurance.amr).toEqual(["pwd"]);
  });

  it("tier-0 user (no FHE keys) gets acr tier-0", async () => {
    // No identity bundle → no secured keys → tier 0
    // Authentication provenance now comes from AuthenticationContext only,
    // but tier 1 still requires secured keys, so this remains tier 0.
    const authContext = await createAuthContext(userId, "passkey");
    const authReqId = await approvedCibaRequest({
      userId,
      authContextId: authContext.id,
    });
    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const claims = decodeJwt(json.id_token as string);
    // Without secured keys, tier remains 0.
    expect(claims.acr).toBe("urn:zentity:assurance:tier-0");
    const assurance = claims.zentity_assurance as Record<string, unknown>;
    expect(assurance.acr).toBe("urn:zentity:assurance:tier-0");
    expect(assurance.acr_eidas).toBe("http://eidas.europa.eu/LoA/low");
    expect(claims.auth_time).toBeDefined();
    expect(typeof claims.auth_time).toBe("number");
    const now = Math.floor(Date.now() / 1000);
    expect(claims.auth_time as number).toBeLessThanOrEqual(now);
    expect(claims.auth_time as number).toBeGreaterThan(now - 3600);
  });

  it("includes correct at_hash (OIDC Core §3.1.3.6)", async () => {
    await seedTier1User(userId);
    const authContext = await createAuthContext(userId, "passkey");
    const authReqId = await approvedCibaRequest({
      userId,
      authContextId: authContext.id,
    });
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
    // Default signing alg is RS256 (no client metadata override)
    const expected = computeAtHash(accessToken);
    expect(claims.at_hash).toBe(expected);
  });
});
