import crypto from "node:crypto";

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { makeSignature } from "better-auth/crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { createSessionAuthenticationContext } from "@/lib/auth/auth-context";
import { db } from "@/lib/db/connection";
import { sessions } from "@/lib/db/schema/auth";
import { secretsRouter } from "@/lib/trpc/routers/secrets";
import { createTrpcContext } from "@/lib/trpc/server";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import { TestAuthenticator } from "@/test-utils/webauthn-test-utils";

const APP = "http://localhost:3000";

/** A browser cookie for a session signed in with `loginMethod` just now. */
async function sessionCookie(
  userId: string,
  loginMethod: "opaque" | "passkey"
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const token = crypto.randomUUID();
  const now = new Date();
  await db
    .insert(sessions)
    .values({
      id: sessionId,
      token,
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  await createSessionAuthenticationContext({
    userId,
    loginMethod,
    sourceKind: "better_auth",
    sessionId,
    ...(loginMethod === "passkey" ? { amr: ["pop", "user", "mfa"] } : {}),
  });
  const signature = await makeSignature(token, env.BETTER_AUTH_SECRET);
  return `better-auth.session_token=${token}.${signature}`;
}

function resetVault(cookie: string) {
  const req = new Request(`${APP}/api/trpc/resetVault`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
  });
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: secretsRouter,
    createContext: () => createTrpcContext({ req }),
  });
}

describe("a refused recovery factor change over HTTP", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser({ emailVerified: true });
    await new TestAuthenticator().register(userId);
  });

  it("tells the page to ask for a passkey confirmation", async () => {
    const response = await resetVault(await sessionCookie(userId, "opaque"));

    expect(response.status).toBe(403);
    const body = (await response.json()) as {
      error: { data: { code: string; reason?: string } };
    };
    expect(body.error.data).toMatchObject({
      code: "FORBIDDEN",
      reason: "REVERIFICATION_REQUIRED",
    });
  });

  it("counts the browser session's passkey sign-in", async () => {
    const response = await resetVault(await sessionCookie(userId, "passkey"));

    expect(response.status).toBe(200);
  });
});
