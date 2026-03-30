import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createSessionAuthenticationContext,
  getAuthenticationStateBySessionId,
} from "@/lib/auth/authentication-context";
import { db } from "@/lib/db/connection";
import { sessions } from "@/lib/db/schema/auth";
import { authenticationContexts } from "@/lib/db/schema/authentication-context";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

async function insertSession(userId: string, createdAt: string) {
  const sessionId = crypto.randomUUID();

  await db
    .insert(sessions)
    .values({
      id: sessionId,
      userId,
      token: crypto.randomBytes(32).toString("hex"),
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .run();

  return sessionId;
}

describe("session-backed authentication contexts", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("uses the persisted session createdAt as auth_time", async () => {
    const userId = await createTestUser();
    const createdAt = "1774389934087.0";
    const sessionId = await insertSession(userId, createdAt);

    const auth = await createSessionAuthenticationContext({
      userId,
      sessionId,
      loginMethod: "passkey",
      sourceKind: "better_auth",
    });

    expect(auth.authenticatedAt).toBe(Math.floor(Number(createdAt) / 1000));

    const persistedSession = await db
      .select({ authContextId: sessions.authContextId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1)
      .get();

    expect(persistedSession?.authContextId).toBe(auth.id);
  });

  it("is idempotent when the session is already bound", async () => {
    const userId = await createTestUser();
    const sessionId = await insertSession(userId, "1774389934087.0");

    const first = await createSessionAuthenticationContext({
      userId,
      sessionId,
      loginMethod: "opaque",
      sourceKind: "better_auth",
    });

    const second = await createSessionAuthenticationContext({
      userId,
      sessionId,
      loginMethod: "opaque",
      sourceKind: "better_auth",
    });

    expect(second).toEqual(first);
    expect(await getAuthenticationStateBySessionId(sessionId)).toEqual(first);

    const rows = await db
      .select({ id: authenticationContexts.id })
      .from(authenticationContexts);
    expect(rows).toHaveLength(1);
  });

  it("rejects anonymous provenance for bootstrap sessions", async () => {
    const userId = await createTestUser();
    const sessionId = await insertSession(userId, "1774389934087.0");

    expect(() =>
      createSessionAuthenticationContext({
        userId,
        sessionId,
        loginMethod: "anonymous" as unknown,
        sourceKind: "better_auth",
      })
    ).toThrow("Anonymous sessions cannot create authentication contexts");

    const rows = await db
      .select({ id: authenticationContexts.id })
      .from(authenticationContexts);
    expect(rows).toHaveLength(0);
  });

  it("fails before insert when the persisted session timestamp is invalid", async () => {
    const userId = await createTestUser();
    const sessionId = await insertSession(userId, "not-a-timestamp");

    await expect(
      createSessionAuthenticationContext({
        userId,
        sessionId,
        loginMethod: "passkey",
        sourceKind: "better_auth",
      })
    ).rejects.toThrow(
      `Invalid session ${sessionId} createdAt: expected a finite timestamp`
    );

    const rows = await db
      .select({ id: authenticationContexts.id })
      .from(authenticationContexts);
    expect(rows).toHaveLength(0);
  });
});
