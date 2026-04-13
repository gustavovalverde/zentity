import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/auth/oauth2/end-session/route";
import { computePairwiseSub } from "@/lib/auth/oidc/pairwise";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { sessions } from "@/lib/db/schema/auth";
import {
  jwks as jwksTable,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

const authIssuer = getAuthIssuer();
const END_SESSION_URL = "http://localhost:3000/api/auth/oauth2/end-session";
const TEST_CLIENT_ID = "end-session-test-client";
const TEST_REDIRECT_URI = "https://rp.example.com/callback";
const TEST_LOGOUT_URI = "https://rp.example.com/logged-out";

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

function mintIdToken(
  sub: string,
  aud: string = TEST_CLIENT_ID
): Promise<string> {
  return new SignJWT({
    iss: authIssuer,
    sub,
    aud,
    azp: aud,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: testKid })
    .sign(testKeyPair.privateKey);
}

function createTestSession(userId: string) {
  const token = crypto.randomUUID();
  return db
    .insert(sessions)
    .values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run()
    .then(() => token);
}

async function createClient(
  overrides: Partial<typeof oauthClients.$inferInsert> = {}
) {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "End-Session Test Client",
      redirectUris: JSON.stringify([TEST_REDIRECT_URI]),
      grantTypes: JSON.stringify(["authorization_code"]),
      tokenEndpointAuthMethod: "none",
      public: true,
      ...overrides,
    })
    .run();
}

function endSessionRequest(params: Record<string, string>) {
  const url = new URL(END_SESSION_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString(), { method: "GET", redirect: "manual" });
}

describe("OIDC RP-Initiated Logout (end-session)", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await ensureSigningKey();
  });

  describe("redirect URI validation", () => {
    it("allows redirect when URI matches registered post_logout_redirect_uris", async () => {
      await createClient({
        postLogoutRedirectUris: JSON.stringify([TEST_LOGOUT_URI]),
      });
      await createTestSession(userId);
      const idToken = await mintIdToken(userId);

      const response = await GET(
        endSessionRequest({
          id_token_hint: idToken,
          post_logout_redirect_uri: TEST_LOGOUT_URI,
        })
      );

      expect(response.status).toBe(302);
      const location = response.headers.get("location");
      expect(location).toContain(TEST_LOGOUT_URI);
    });

    it("rejects redirect when URI does not match registered URIs", async () => {
      await createClient({
        postLogoutRedirectUris: JSON.stringify([TEST_LOGOUT_URI]),
      });
      const idToken = await mintIdToken(userId);

      const response = await GET(
        endSessionRequest({
          id_token_hint: idToken,
          post_logout_redirect_uri: "https://evil.example.com/phish",
        })
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("post_logout_redirect_uri not registered");
    });

    it("rejects redirect when client has no registered post_logout_redirect_uris", async () => {
      await createClient(); // No postLogoutRedirectUris
      const idToken = await mintIdToken(userId);

      const response = await GET(
        endSessionRequest({
          id_token_hint: idToken,
          post_logout_redirect_uri: "https://evil.example.com/phish",
        })
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("post_logout_redirect_uri not registered");
    });

    it("rejects redirect when client is not found in database", async () => {
      // Don't create a client — token references a nonexistent client
      const idToken = await mintIdToken(userId, "nonexistent-client");

      const response = await GET(
        endSessionRequest({
          id_token_hint: idToken,
          post_logout_redirect_uri: "https://evil.example.com/phish",
        })
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("post_logout_redirect_uri not registered");
    });

    it("appends state parameter to redirect URI", async () => {
      await createClient({
        postLogoutRedirectUris: JSON.stringify([TEST_LOGOUT_URI]),
      });
      await createTestSession(userId);
      const idToken = await mintIdToken(userId);

      const response = await GET(
        endSessionRequest({
          id_token_hint: idToken,
          post_logout_redirect_uri: TEST_LOGOUT_URI,
          state: "abc123",
        })
      );

      expect(response.status).toBe(302);
      const location = response.headers.get("location");
      expect(location).toContain("state=abc123");
    });
  });

  describe("session termination", () => {
    it("terminates all user sessions on valid logout", async () => {
      await createClient();
      await createTestSession(userId);
      await createTestSession(userId);
      const idToken = await mintIdToken(userId);

      // Verify sessions exist
      const before = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .all();
      expect(before).toHaveLength(2);

      const response = await GET(endSessionRequest({ id_token_hint: idToken }));

      expect(response.status).toBe(200);

      const after = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .all();
      expect(after).toHaveLength(0);
    });

    it("returns success JSON when no redirect URI provided", async () => {
      await createClient();
      await createTestSession(userId);
      const idToken = await mintIdToken(userId);

      const response = await GET(endSessionRequest({ id_token_hint: idToken }));

      expect(response.status).toBe(200);
      const body = (await response.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });
  });

  describe("pairwise subject resolution", () => {
    const PAIRWISE_CLIENT_ID = "pairwise-logout-client";
    const PAIRWISE_REDIRECT = "https://pairwise-rp.example.com/callback";
    const PAIRWISE_LOGOUT_URI = "https://pairwise-rp.example.com/logged-out";

    it("resolves pairwise sub and terminates sessions", async () => {
      await createClient({
        clientId: PAIRWISE_CLIENT_ID,
        redirectUris: JSON.stringify([PAIRWISE_REDIRECT]),
        subjectType: "pairwise",
        postLogoutRedirectUris: JSON.stringify([PAIRWISE_LOGOUT_URI]),
      });
      await createTestSession(userId);

      const pairwiseSub = await computePairwiseSub(
        userId,
        [PAIRWISE_REDIRECT],
        process.env.PAIRWISE_SECRET as string
      );
      const idToken = await mintIdToken(pairwiseSub, PAIRWISE_CLIENT_ID);

      const response = await GET(
        endSessionRequest({
          id_token_hint: idToken,
          post_logout_redirect_uri: PAIRWISE_LOGOUT_URI,
        })
      );

      expect(response.status).toBe(302);

      // Sessions should be terminated
      const remaining = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .all();
      expect(remaining).toHaveLength(0);
    });

    it("returns 400 when pairwise sub cannot be resolved", async () => {
      await createClient({
        clientId: PAIRWISE_CLIENT_ID,
        redirectUris: JSON.stringify([PAIRWISE_REDIRECT]),
        subjectType: "pairwise",
      });

      // Use a sub that doesn't match any user's pairwise value
      const idToken = await mintIdToken(
        "bogus-pairwise-sub",
        PAIRWISE_CLIENT_ID
      );

      const response = await GET(endSessionRequest({ id_token_hint: idToken }));

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("Unable to resolve user from id_token_hint");
    });
  });

  describe("input validation", () => {
    it("rejects request without id_token_hint", async () => {
      const response = await GET(endSessionRequest({}));

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("id_token_hint is required");
    });

    it("rejects invalid JWT in id_token_hint", async () => {
      const response = await GET(
        endSessionRequest({ id_token_hint: "not-a-valid-jwt" })
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("Invalid id_token_hint");
    });

    it("rejects when client_id does not match token azp", async () => {
      await createClient();
      const idToken = await mintIdToken(userId);

      const response = await GET(
        endSessionRequest({
          id_token_hint: idToken,
          client_id: "different-client",
        })
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("client_id does not match id_token_hint");
    });
  });
});
