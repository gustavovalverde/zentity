import crypto from "node:crypto";

import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { getAuthIssuer } from "@/lib/auth/issuer";
import { sealApprovalPii } from "@/lib/auth/oidc/approval-crypto";
import { db } from "@/lib/db/connection";
import { approvals } from "@/lib/db/schema/approvals";
import { jwks as jwksTable } from "@/lib/db/schema/jwks";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

const RELEASE_URL = "http://localhost:3000/api/oauth2/release";
const TEST_CLIENT_ID = "release-test-agent";
const authIssuer = getAuthIssuer();

let testKeyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let testKid: string;

async function ensureSigningKey() {
  testKeyPair = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  testKid = crypto.randomUUID();
  const publicJwk = await exportJWK(testKeyPair.publicKey);
  const privateJwk = await exportJWK(testKeyPair.privateKey);
  await db
    .insert(jwksTable)
    .values({
      id: testKid,
      publicKey: JSON.stringify(publicJwk),
      privateKey: JSON.stringify(privateJwk),
      alg: "EdDSA",
      crv: "Ed25519",
    })
    .run();
}

async function createTestClient(clientId = TEST_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "Release Test Agent",
      redirectUris: ["http://localhost/callback"],
      grantTypes: ["urn:openid:params:grant-type:ciba"],
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

function mintTestAccessToken(claims: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    scope: "openid",
    ...claims,
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: testKid })
    .setIssuer(authIssuer)
    .setSubject(claims.sub as string)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(testKeyPair.privateKey);
}

async function createApprovalRecord(opts: {
  userId: string;
  clientId: string;
  pii: Record<string, unknown>;
  scopes: string;
  authorizationDetails?: string;
  expiresAt?: Date;
  status?: string;
}) {
  const sealed = await sealApprovalPii(JSON.stringify(opts.pii));
  await db
    .insert(approvals)
    .values({
      id: crypto.randomUUID(),
      authReqId: crypto.randomUUID(),
      userId: opts.userId,
      clientId: opts.clientId,
      approvedScopes: opts.scopes,
      authorizationDetails: opts.authorizationDetails,
      encryptedPii: sealed.encryptedPii,
      encryptionIv: sealed.encryptionIv,
      releaseHandleHash: sealed.releaseHandleHash,
      status: opts.status ?? "approved",
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 300_000),
    })
    .run();
  return sealed;
}

async function postRelease(
  accessToken: string
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/oauth2/release/route");
  const response = await POST(
    new Request(RELEASE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  );
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json };
}

describe("POST /api/oauth2/release", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    await ensureSigningKey();
    userId = await createTestUser();
    await createTestClient();
  });

  it("redeems a release handle and returns an id_token with PII", async () => {
    const pii = {
      given_name: "Alice",
      family_name: "Smith",
      birthdate: "1990-01-15",
    };
    const sealed = await createApprovalRecord({
      userId,
      clientId: TEST_CLIENT_ID,
      pii,
      scopes: "openid identity.name identity.dob",
    });

    const token = await mintTestAccessToken({
      sub: userId,
      azp: TEST_CLIENT_ID,
      release_handle: sealed.releaseHandle,
    });

    const { status, json } = await postRelease(token);

    expect(status).toBe(200);
    expect(json.id_token).toBeDefined();

    const idToken = decodeJwt(json.id_token as string);
    expect(idToken.given_name).toBe("Alice");
    expect(idToken.family_name).toBe("Smith");
    expect(idToken.birthdate).toBe("1990-01-15");
    expect(idToken.sub).toBe(userId);
    expect(idToken.aud).toBe(TEST_CLIENT_ID);
  });

  it("returns 410 on second redemption (one-time use)", async () => {
    const sealed = await createApprovalRecord({
      userId,
      clientId: TEST_CLIENT_ID,
      pii: { given_name: "Alice" },
      scopes: "openid identity.name",
    });

    const token = await mintTestAccessToken({
      sub: userId,
      azp: TEST_CLIENT_ID,
      release_handle: sealed.releaseHandle,
    });

    const { status: firstStatus } = await postRelease(token);
    expect(firstStatus).toBe(200);

    const { status: secondStatus, json: secondJson } = await postRelease(token);
    expect(secondStatus).toBe(410);
    expect(secondJson.error).toBe("invalid_grant");
    expect(secondJson.error_description).toContain("already redeemed");
  });

  it("returns 410 for an expired approval", async () => {
    const sealed = await createApprovalRecord({
      userId,
      clientId: TEST_CLIENT_ID,
      pii: { given_name: "Alice" },
      scopes: "openid identity.name",
      expiresAt: new Date(Date.now() - 1000),
    });

    const token = await mintTestAccessToken({
      sub: userId,
      azp: TEST_CLIENT_ID,
      release_handle: sealed.releaseHandle,
    });

    const { status, json } = await postRelease(token);
    expect(status).toBe(410);
    expect(json.error).toBe("invalid_grant");
    expect(json.error_description).toContain("expired");
  });

  it("returns 400 when token has no release_handle", async () => {
    const token = await mintTestAccessToken({
      sub: userId,
      azp: TEST_CLIENT_ID,
    });

    const { status, json } = await postRelease(token);
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_request");
  });

  it("returns 404 for an unknown release handle", async () => {
    const fakeHandle = crypto.randomBytes(32).toString("base64url");
    const token = await mintTestAccessToken({
      sub: userId,
      azp: TEST_CLIENT_ID,
      release_handle: fakeHandle,
    });

    const { status, json } = await postRelease(token);
    expect(status).toBe(404);
    expect(json.error).toBe("invalid_grant");
  });

  it("returns 401 when no bearer token is provided", async () => {
    const { POST } = await import("@/app/api/oauth2/release/route");
    const response = await POST(new Request(RELEASE_URL, { method: "POST" }));
    const json = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(401);
    expect(json.error).toBe("missing_token");
  });

  it("includes authorization_details in the id_token when present", async () => {
    const authorizationDetails = JSON.stringify([
      { type: "purchase", amount: { currency: "USD", value: "42.00" } },
    ]);
    const sealed = await createApprovalRecord({
      userId,
      clientId: TEST_CLIENT_ID,
      pii: { given_name: "Alice" },
      scopes: "openid identity.name",
      authorizationDetails,
    });

    const token = await mintTestAccessToken({
      sub: userId,
      azp: TEST_CLIENT_ID,
      release_handle: sealed.releaseHandle,
    });

    const { status, json } = await postRelease(token);
    expect(status).toBe(200);

    const idToken = decodeJwt(json.id_token as string);
    expect(idToken.authorization_details).toEqual([
      { type: "purchase", amount: { currency: "USD", value: "42.00" } },
    ]);
  });

  it("filters PII by approved scopes", async () => {
    const pii = {
      given_name: "Alice",
      family_name: "Smith",
      birthdate: "1990-01-15",
    };
    const sealed = await createApprovalRecord({
      userId,
      clientId: TEST_CLIENT_ID,
      pii,
      scopes: "openid identity.name",
    });

    const token = await mintTestAccessToken({
      sub: userId,
      azp: TEST_CLIENT_ID,
      release_handle: sealed.releaseHandle,
    });

    const { status, json } = await postRelease(token);
    expect(status).toBe(200);

    const idToken = decodeJwt(json.id_token as string);
    expect(idToken.given_name).toBe("Alice");
    expect(idToken.family_name).toBe("Smith");
    // birthdate NOT included because identity.dob not in approved scopes
    expect(idToken.birthdate).toBeUndefined();
  });
});
