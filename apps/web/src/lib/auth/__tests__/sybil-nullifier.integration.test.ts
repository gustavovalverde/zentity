import crypto from "node:crypto";

import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { GET as authRouteGet } from "@/app/api/auth/[...all]/route";
import { db } from "@/lib/db/connection";
import {
  createVerification,
  reconcileIdentityBundle,
  revokeIdentity,
} from "@/lib/db/queries/identity";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { assertNoInternalIdentifiersInClaims } from "@/test-utils/claims-test-utils";
import {
  createTestCibaRequest,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const PRIMARY_CLIENT_ID = "sybil-client-primary";
const SECONDARY_CLIENT_ID = "sybil-client-secondary";
const USERINFO_URL = "http://localhost:3000/api/auth/oauth2/userinfo";
const VALID_RESOURCE = "http://localhost:3000";

async function createTestClient(clientId: string) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: clientId,
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify(["authorization_code", CIBA_GRANT_TYPE]),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function createNfcVerification(
  userId: string,
  chipNullifier: string,
  nullifierSeed: string
): Promise<void> {
  const now = new Date().toISOString();

  await createVerification({
    id: crypto.randomUUID(),
    userId,
    method: "nfc_chip",
    status: "verified",
    chipNullifier,
    nullifierSeed,
    verifiedAt: now,
  });
  await reconcileIdentityBundle(userId);
}

async function issueSybilToken(clientId: string, userId: string) {
  const { authReqId } = await createTestCibaRequest({
    clientId,
    userId,
    resource: VALID_RESOURCE,
    scope: "openid proof:sybil",
    status: "approved",
  });

  const response = await postTokenWithDpop({
    grant_type: CIBA_GRANT_TYPE,
    auth_req_id: authReqId,
    client_id: clientId,
  });

  if (response.status !== 200) {
    throw new Error(
      `Expected token exchange to succeed, received ${response.status}`
    );
  }

  const accessToken = response.json.access_token;
  if (typeof accessToken !== "string") {
    throw new Error("Expected CIBA token response to include an access token");
  }

  return {
    accessToken,
    dpopKeyPair: response.dpopKeyPair,
  };
}

describe("sybil nullifier disclosure", () => {
  let chipNullifier: string;
  let nullifierSeed: string;
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    await createTestClient(PRIMARY_CLIENT_ID);
    await createTestClient(SECONDARY_CLIENT_ID);

    userId = await createTestUser();
    chipNullifier = `nfc-nullifier-${crypto.randomUUID()}`;
    nullifierSeed = `nfc-seed-${crypto.randomUUID()}`;

    await createNfcVerification(userId, chipNullifier, nullifierSeed);
  });

  it("derives a stable per-RP nullifier from NFC identifiers without leaking the raw value", async () => {
    const firstPrimaryToken = await issueSybilToken(PRIMARY_CLIENT_ID, userId);
    const secondPrimaryToken = await issueSybilToken(PRIMARY_CLIENT_ID, userId);
    const secondaryToken = await issueSybilToken(SECONDARY_CLIENT_ID, userId);

    const firstPrimaryClaims = decodeJwt(firstPrimaryToken.accessToken);
    const secondPrimaryClaims = decodeJwt(secondPrimaryToken.accessToken);
    const secondaryClaims = decodeJwt(secondaryToken.accessToken);

    expect(typeof firstPrimaryClaims.sybil_nullifier).toBe("string");
    expect(firstPrimaryClaims.sybil_nullifier).toBe(
      secondPrimaryClaims.sybil_nullifier
    );
    expect(firstPrimaryClaims.sybil_nullifier).not.toBe(
      secondaryClaims.sybil_nullifier
    );

    await assertNoInternalIdentifiersInClaims(firstPrimaryClaims, userId);
    await assertNoInternalIdentifiersInClaims(secondPrimaryClaims, userId);
    await assertNoInternalIdentifiersInClaims(secondaryClaims, userId);

    const userinfoProof = await buildDpopProof(
      firstPrimaryToken.dpopKeyPair,
      "GET",
      USERINFO_URL
    );
    const userinfoResponse = await authRouteGet(
      new Request(USERINFO_URL, {
        method: "GET",
        headers: {
          authorization: `DPoP ${firstPrimaryToken.accessToken}`,
          DPoP: userinfoProof,
        },
      })
    );
    const userinfoBody = await userinfoResponse.text();

    expect(userinfoBody).not.toContain(chipNullifier);
    expect(userinfoBody).not.toContain(nullifierSeed);
    expect(userinfoBody).not.toContain("sybil_nullifier");
  });

  it("does not rotate the per-RP nullifier after a later credential is added", async () => {
    const firstPrimaryToken = await issueSybilToken(PRIMARY_CLIENT_ID, userId);
    const firstPrimaryClaims = decodeJwt(firstPrimaryToken.accessToken);

    await createVerification({
      id: crypto.randomUUID(),
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: `ocr-dedup-${crypto.randomUUID()}`,
      nullifierSeed: `ocr-seed-${crypto.randomUUID()}`,
      documentHash: `hash-${crypto.randomUUID()}`,
      verifiedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await reconcileIdentityBundle(userId);

    const secondPrimaryToken = await issueSybilToken(PRIMARY_CLIENT_ID, userId);
    const secondPrimaryClaims = decodeJwt(secondPrimaryToken.accessToken);

    expect(firstPrimaryClaims.sybil_nullifier).toBe(
      secondPrimaryClaims.sybil_nullifier
    );
  });

  it("issues a fresh per-RP nullifier after revocation and re-verification", async () => {
    const preRevocationToken = await issueSybilToken(PRIMARY_CLIENT_ID, userId);
    const preRevocationClaims = decodeJwt(preRevocationToken.accessToken);

    await revokeIdentity(
      userId,
      "admin@zentity.app",
      "identity reset",
      "admin"
    );

    const replacementChipNullifier = `nfc-nullifier-${crypto.randomUUID()}`;
    const replacementSeed = `nfc-seed-${crypto.randomUUID()}`;
    await createNfcVerification(
      userId,
      replacementChipNullifier,
      replacementSeed
    );

    const postRevocationToken = await issueSybilToken(
      PRIMARY_CLIENT_ID,
      userId
    );
    const postRevocationClaims = decodeJwt(postRevocationToken.accessToken);

    expect(typeof postRevocationClaims.sybil_nullifier).toBe("string");
    expect(postRevocationClaims.sybil_nullifier).not.toBe(
      preRevocationClaims.sybil_nullifier
    );
    await assertNoInternalIdentifiersInClaims(postRevocationClaims, userId);
  });
});
