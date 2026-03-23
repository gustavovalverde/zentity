import crypto from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { db } from "@/lib/db/connection";
import { sessions } from "@/lib/db/schema/auth";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

import {
  computePairwiseSub,
  resolveSubForClient,
  resolveUserIdFromSub,
} from "../pairwise";

const TEST_CLIENT_ID = "pairwise-test-client";
const TEST_REDIRECT_URI = "https://pairwise-rp.example.com/callback";

async function createTestClient(
  overrides: Partial<typeof oauthClients.$inferInsert> = {}
) {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "Pairwise Test Client",
      redirectUris: JSON.stringify([TEST_REDIRECT_URI]),
      grantTypes: JSON.stringify(["authorization_code"]),
      tokenEndpointAuthMethod: "none",
      public: true,
      subjectType: "pairwise",
      ...overrides,
    })
    .run();
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
      ipAddress: "127.0.0.1",
      userAgent: "test",
    })
    .run()
    .then(() => token);
}

describe("pairwise subject resolution (integration)", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
  });

  describe("resolveUserIdFromSub", () => {
    it("resolves pairwise sub back to raw userId", async () => {
      await createTestClient();

      const pairwiseSub = await computePairwiseSub(
        userId,
        [TEST_REDIRECT_URI],
        env.PAIRWISE_SECRET
      );

      const resolved = await resolveUserIdFromSub(pairwiseSub, TEST_CLIENT_ID);
      expect(resolved).toBe(userId);
    });

    it("returns sub directly for public clients", async () => {
      await createTestClient({ subjectType: "public" });

      const resolved = await resolveUserIdFromSub(userId, TEST_CLIENT_ID);
      expect(resolved).toBe(userId);
    });

    it("returns null for unknown client", async () => {
      const resolved = await resolveUserIdFromSub(userId, "nonexistent-client");
      expect(resolved).toBeNull();
    });

    it("returns null when no user matches the pairwise sub", async () => {
      await createTestClient();

      const resolved = await resolveUserIdFromSub(
        "definitely-not-a-valid-pairwise-sub",
        TEST_CLIENT_ID
      );
      expect(resolved).toBeNull();
    });

    it("finds the correct user among multiple users", async () => {
      await createTestClient();

      const user2 = await createTestUser({ email: "user2@example.com" });
      const user3 = await createTestUser({ email: "user3@example.com" });

      // Compute pairwise for user2
      const pairwiseSub = await computePairwiseSub(
        user2,
        [TEST_REDIRECT_URI],
        env.PAIRWISE_SECRET
      );

      const resolved = await resolveUserIdFromSub(pairwiseSub, TEST_CLIENT_ID);
      expect(resolved).toBe(user2);
      expect(resolved).not.toBe(userId);
      expect(resolved).not.toBe(user3);
    });
  });

  describe("resolveSubForClient", () => {
    it("computes same pairwise sub as better-auth's derivation", async () => {
      await createTestClient();

      const sector = new URL(TEST_REDIRECT_URI).host;
      const betterAuthSub = await makeSignature(
        `${sector}.${userId}`,
        env.PAIRWISE_SECRET
      );

      const ourSub = await resolveSubForClient(userId, {
        subjectType: "pairwise",
        redirectUris: [TEST_REDIRECT_URI],
      });

      expect(ourSub).toBe(betterAuthSub);
    });
  });

  describe("end-session pairwise resolution", () => {
    it("session lookup uses raw userId after pairwise resolution", async () => {
      await createTestClient();
      const _sessionToken = await createTestSession(userId);

      // Verify session exists under raw userId
      const sessionsBefore = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .all();
      expect(sessionsBefore).toHaveLength(1);

      // Compute pairwise sub (what would be in id_token_hint)
      const pairwiseSub = await computePairwiseSub(
        userId,
        [TEST_REDIRECT_URI],
        env.PAIRWISE_SECRET
      );

      // Verify pairwise sub does NOT match raw userId
      expect(pairwiseSub).not.toBe(userId);

      // Verify resolveUserIdFromSub correctly resolves
      const resolved = await resolveUserIdFromSub(pairwiseSub, TEST_CLIENT_ID);
      expect(resolved).toBe(userId);
    });
  });

  describe("CIBA revocation uses raw userId", () => {
    it("pending CIBA requests found by raw userId after pairwise resolution", async () => {
      await createTestClient();

      const authReqId = crypto.randomUUID();
      await db
        .insert(cibaRequests)
        .values({
          authReqId,
          clientId: TEST_CLIENT_ID,
          userId,
          scope: "openid",
          status: "pending",
          deliveryMode: "poll",
          expiresAt: new Date(Date.now() + 300_000),
        })
        .run();

      // Resolve pairwise sub → raw userId
      const pairwiseSub = await computePairwiseSub(
        userId,
        [TEST_REDIRECT_URI],
        env.PAIRWISE_SECRET
      );
      const rawUserId = await resolveUserIdFromSub(pairwiseSub, TEST_CLIENT_ID);
      expect(rawUserId).not.toBeNull();

      // CIBA request should be found by raw userId
      const pending = await db
        .select()
        .from(cibaRequests)
        .where(
          and(
            eq(cibaRequests.userId, rawUserId as string),
            eq(cibaRequests.status, "pending")
          )
        )
        .all();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.authReqId).toBe(authReqId);
    });
  });
});
