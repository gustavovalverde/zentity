import crypto from "node:crypto";

import { client, ready, server } from "@serenity-kit/opaque";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { db } from "@/lib/db/connection";
import { accounts, sessions, users, verifications } from "@/lib/db/schema/auth";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

const AUTH_BASE = "http://localhost:3000/api/auth";
const PASSWORD = "correct horse battery staple";
const CONCURRENCY = 4;

async function post(
  path: string,
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await auth.handler(
    new Request(`${AUTH_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const text = await response.text();
  return {
    status: response.status,
    json: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
  };
}

function registrationRecordFor(userId: string): string {
  const { clientRegistrationState, registrationRequest } =
    client.startRegistration({ password: PASSWORD });
  const { registrationResponse } = server.createRegistrationResponse({
    serverSetup: env.OPAQUE_SERVER_SETUP,
    userIdentifier: userId,
    registrationRequest,
  });
  return client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password: PASSWORD,
  }).registrationRecord;
}

async function createOpaqueUser(): Promise<string> {
  const userId = await createTestUser();
  const now = new Date();
  await db
    .insert(accounts)
    .values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "opaque",
      userId,
      registrationRecord: registrationRecordFor(userId),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return userId;
}

async function issueResetToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(24).toString("base64url");
  const { internalAdapter } = await auth.$context;
  await internalAdapter.createVerificationValue({
    identifier: `opaque-reset:${token}`,
    value: userId,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return token;
}

function statuses(results: { status: number }[]): number[] {
  return results.map((r) => r.status).sort();
}

describe("OPAQUE single-use tokens", () => {
  beforeAll(async () => {
    await ready;
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe("password reset", () => {
    it("reads the token at the challenge step without consuming it", async () => {
      const userId = await createOpaqueUser();
      const token = await issueResetToken(userId);
      const { registrationRequest } = client.startRegistration({
        password: PASSWORD,
      });

      for (let i = 0; i < 2; i++) {
        const { status } = await post("/password-reset/opaque/challenge", {
          token,
          registrationRequest,
        });
        expect(status).toBe(200);
      }

      const complete = await post("/password-reset/opaque/complete", {
        token,
        registrationRecord: registrationRecordFor(userId),
      });
      expect(complete.status).toBe(200);
    });

    it("completes once when the same token is redeemed concurrently", async () => {
      const userId = await createOpaqueUser();
      const token = await issueResetToken(userId);

      const records = Array.from({ length: CONCURRENCY }, () =>
        registrationRecordFor(userId)
      );

      const results = await Promise.all(
        records.map((registrationRecord) =>
          post("/password-reset/opaque/complete", { token, registrationRecord })
        )
      );

      expect(statuses(results)).toEqual([200, 400, 400, 400]);
      const opaqueAccounts = await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, userId))
        .all();
      expect(opaqueAccounts).toHaveLength(1);
      const winner = results.findIndex((r) => r.status === 200);
      expect(opaqueAccounts[0]?.registrationRecord).toBe(records[winner]);
    });

    it("rejects a token that was already redeemed", async () => {
      const userId = await createOpaqueUser();
      const token = await issueResetToken(userId);
      const registrationRecord = registrationRecordFor(userId);

      const first = await post("/password-reset/opaque/complete", {
        token,
        registrationRecord,
      });
      expect(first.status).toBe(200);

      const replay = await post("/password-reset/opaque/complete", {
        token,
        registrationRecord,
      });
      expect(replay.status).toBe(400);
    });

    it("rejects an expired token", async () => {
      const userId = await createOpaqueUser();
      const token = await issueResetToken(userId);
      await db
        .update(verifications)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(verifications.identifier, `opaque-reset:${token}`))
        .run();

      const { status } = await post("/password-reset/opaque/complete", {
        token,
        registrationRecord: registrationRecordFor(userId),
      });
      expect(status).toBe(400);
    });
  });

  describe("sign-up", () => {
    async function startSignUp() {
      const email = `signup-${crypto.randomUUID()}@example.com`;
      const { registrationRequest } = client.startRegistration({
        password: PASSWORD,
      });
      const { status, json } = await post("/sign-up/opaque/challenge", {
        email,
        registrationRequest,
      });
      if (status !== 200) {
        throw new Error(`sign-up challenge failed with ${status}`);
      }
      const user = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .get();
      if (!user) {
        throw new Error("sign-up challenge did not create a user");
      }
      return { signupToken: json.signupToken as string, userId: user.id };
    }

    it("creates one session when the same token is redeemed concurrently", async () => {
      const { signupToken, userId } = await startSignUp();

      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          post("/sign-up/opaque/complete", {
            signupToken,
            registrationRecord: registrationRecordFor(userId),
          })
        )
      );

      expect(statuses(results)).toEqual([200, 400, 400, 400]);
      const userSessions = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .all();
      expect(userSessions).toHaveLength(1);
    });

    it("rejects a token that was already redeemed", async () => {
      const { signupToken, userId } = await startSignUp();
      const registrationRecord = registrationRecordFor(userId);

      const first = await post("/sign-up/opaque/complete", {
        signupToken,
        registrationRecord,
      });
      expect(first.status).toBe(200);

      const replay = await post("/sign-up/opaque/complete", {
        signupToken,
        registrationRecord,
      });
      expect(replay.status).toBe(400);
    });
  });
});
