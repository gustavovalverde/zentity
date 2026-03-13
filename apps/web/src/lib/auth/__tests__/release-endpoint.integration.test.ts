import type { JWK } from "jose";

import crypto from "node:crypto";

import {
  calculateJwkThumbprint,
  decodeJwt,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
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
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify(["urn:openid:params:grant-type:ciba"]),
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

  it("concurrent redemption: exactly one succeeds, the other is rejected", async () => {
    const sealed = await createApprovalRecord({
      userId,
      clientId: TEST_CLIENT_ID,
      pii: { given_name: "ConcurrentAlice" },
      scopes: "openid identity.name",
    });

    const token = await mintTestAccessToken({
      sub: userId,
      azp: TEST_CLIENT_ID,
      release_handle: sealed.releaseHandle,
    });

    const [r1, r2] = await Promise.all([
      postRelease(token),
      postRelease(token),
    ]);

    const winner = r1.status === 200 ? r1 : r2;
    const loser = r1.status === 200 ? r2 : r1;

    expect(winner.status).toBe(200);
    expect(winner.json.id_token).toBeDefined();
    // The loser may get 410 (atomic claim race) or 400 (status already
    // transitioned to "claiming" before it re-reads). Both prevent double PII.
    expect(loser.status).toBeGreaterThanOrEqual(400);
    expect(loser.json.id_token).toBeUndefined();
  });

  it("rolls back to approved when decryption fails, preserving redeemability", async () => {
    const sealed = await createApprovalRecord({
      userId,
      clientId: TEST_CLIENT_ID,
      pii: { given_name: "RollbackAlice" },
      scopes: "openid identity.name",
    });

    // Corrupt the encrypted PII in the DB so unsealApprovalPii throws
    const { eq } = await import("drizzle-orm");
    await db
      .update(approvals)
      .set({ encryptedPii: "corrupted-ciphertext" })
      .where(eq(approvals.releaseHandleHash, sealed.releaseHandleHash))
      .run();

    const token = await mintTestAccessToken({
      sub: userId,
      azp: TEST_CLIENT_ID,
      release_handle: sealed.releaseHandle,
    });

    // First call should fail with server_error due to corrupt ciphertext
    const { status, json } = await postRelease(token);
    expect(status).toBe(500);
    expect(json.error).toBe("server_error");

    // Verify status was rolled back to "approved"
    const row = await db
      .select({ status: approvals.status })
      .from(approvals)
      .where(eq(approvals.releaseHandleHash, sealed.releaseHandleHash))
      .get();
    expect(row?.status).toBe("approved");

    // Fix the PII and verify the approval is still redeemable
    await db
      .update(approvals)
      .set({ encryptedPii: sealed.encryptedPii })
      .where(eq(approvals.releaseHandleHash, sealed.releaseHandleHash))
      .run();

    const { status: retryStatus, json: retryJson } = await postRelease(token);
    expect(retryStatus).toBe(200);
    expect(retryJson.id_token).toBeDefined();
  });

  describe("DPoP sender-constraining", () => {
    let dpopKeyPair: Awaited<ReturnType<typeof generateKeyPair>>;
    let dpopJwk: JWK;
    let dpopJkt: string;

    beforeEach(async () => {
      dpopKeyPair = await generateKeyPair("ES256");
      dpopJwk = await exportJWK(dpopKeyPair.publicKey);
      dpopJkt = await calculateJwkThumbprint(dpopJwk);
    });

    function buildDpopProof(opts: { method: string; url: string }) {
      return new SignJWT({
        htm: opts.method,
        htu: opts.url,
        jti: crypto.randomUUID(),
      })
        .setProtectedHeader({
          alg: "ES256",
          typ: "dpop+jwt",
          jwk: dpopJwk,
        })
        .setIssuedAt()
        .sign(dpopKeyPair.privateKey);
    }

    async function postReleaseWithDpop(
      accessToken: string,
      dpopProof: string
    ): Promise<{ status: number; json: Record<string, unknown> }> {
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

    it("accepts a DPoP-bound token with a valid proof", async () => {
      const sealed = await createApprovalRecord({
        userId,
        clientId: TEST_CLIENT_ID,
        pii: { given_name: "DPoP-Alice" },
        scopes: "openid identity.name",
      });

      const token = await mintTestAccessToken({
        sub: userId,
        azp: TEST_CLIENT_ID,
        release_handle: sealed.releaseHandle,
        cnf: { jkt: dpopJkt },
      });

      const dpopProof = await buildDpopProof({
        method: "POST",
        url: RELEASE_URL,
      });

      const { status, json } = await postReleaseWithDpop(token, dpopProof);
      expect(status).toBe(200);

      const idToken = decodeJwt(json.id_token as string);
      expect(idToken.given_name).toBe("DPoP-Alice");
    });

    it("rejects a DPoP-bound token without a DPoP proof header", async () => {
      const sealed = await createApprovalRecord({
        userId,
        clientId: TEST_CLIENT_ID,
        pii: { given_name: "NoDPoP" },
        scopes: "openid identity.name",
      });

      const token = await mintTestAccessToken({
        sub: userId,
        azp: TEST_CLIENT_ID,
        release_handle: sealed.releaseHandle,
        cnf: { jkt: dpopJkt },
      });

      // Use Bearer scheme, no DPoP header
      const { status, json } = await postRelease(token);
      expect(status).toBe(401);
      expect(json.error).toBe("invalid_dpop_proof");
    });

    it("rejects a DPoP-bound token with a wrong key proof", async () => {
      const sealed = await createApprovalRecord({
        userId,
        clientId: TEST_CLIENT_ID,
        pii: { given_name: "WrongKey" },
        scopes: "openid identity.name",
      });

      // Bind token to the test DPoP key
      const token = await mintTestAccessToken({
        sub: userId,
        azp: TEST_CLIENT_ID,
        release_handle: sealed.releaseHandle,
        cnf: { jkt: dpopJkt },
      });

      // Build proof with a DIFFERENT key
      const otherKeyPair = await generateKeyPair("ES256");
      const otherJwk = await exportJWK(otherKeyPair.publicKey);
      const wrongProof = await new SignJWT({
        htm: "POST",
        htu: RELEASE_URL,
        jti: crypto.randomUUID(),
      })
        .setProtectedHeader({
          alg: "ES256",
          typ: "dpop+jwt",
          jwk: otherJwk,
        })
        .setIssuedAt()
        .sign(otherKeyPair.privateKey);

      const { status, json } = await postReleaseWithDpop(token, wrongProof);
      expect(status).toBe(401);
      expect(json.error).toBe("invalid_dpop_proof");
    });

    it("skips DPoP validation when token has no cnf claim (non-bound)", async () => {
      const sealed = await createApprovalRecord({
        userId,
        clientId: TEST_CLIENT_ID,
        pii: { given_name: "NoCnf" },
        scopes: "openid identity.name",
      });

      // No cnf claim — plain Bearer token
      const token = await mintTestAccessToken({
        sub: userId,
        azp: TEST_CLIENT_ID,
        release_handle: sealed.releaseHandle,
      });

      const { status, json } = await postRelease(token);
      expect(status).toBe(200);

      const idToken = decodeJwt(json.id_token as string);
      expect(idToken.given_name).toBe("NoCnf");
    });

    it("returns DPoP-Nonce header in successful response", async () => {
      const sealed = await createApprovalRecord({
        userId,
        clientId: TEST_CLIENT_ID,
        pii: { given_name: "Nonce" },
        scopes: "openid identity.name",
      });

      const token = await mintTestAccessToken({
        sub: userId,
        azp: TEST_CLIENT_ID,
        release_handle: sealed.releaseHandle,
        cnf: { jkt: dpopJkt },
      });

      const dpopProof = await buildDpopProof({
        method: "POST",
        url: RELEASE_URL,
      });

      const { POST } = await import("@/app/api/oauth2/release/route");
      const response = await POST(
        new Request(RELEASE_URL, {
          method: "POST",
          headers: {
            Authorization: `DPoP ${token}`,
            DPoP: dpopProof,
          },
        })
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("DPoP-Nonce")).toBeTruthy();
    });
  });
});
