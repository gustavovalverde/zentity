import crypto from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { db } from "@/lib/db/connection";
import { sessions } from "@/lib/db/schema/auth";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

const REGISTER_OPTIONS_URL =
  "http://localhost:3000/api/auth/passkey/generate-register-options";
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

async function sessionCookie(userId: string, createdAt: Date) {
  const token = crypto.randomUUID();
  await db
    .insert(sessions)
    .values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt,
      updatedAt: createdAt,
    })
    .run();
  const signature = await makeSignature(token, env.BETTER_AUTH_SECRET);
  return `better-auth.session_token=${token}.${signature}`;
}

function requestRegisterOptions(cookie?: string) {
  return auth.handler(
    new Request(REGISTER_OPTIONS_URL, {
      headers: cookie ? { cookie } : {},
    })
  );
}

describe("passkey registration", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
  });

  it("issues registration options to a freshly signed-in user", async () => {
    const response = await requestRegisterOptions(
      await sessionCookie(userId, new Date())
    );

    expect(response.status).toBe(200);
  });

  it("refuses a session that is no longer fresh", async () => {
    const response = await requestRegisterOptions(
      await sessionCookie(userId, new Date(Date.now() - TWO_DAYS_MS))
    );

    expect(response.status).toBe(403);
    expect(((await response.json()) as { code?: string }).code).toBe(
      "SESSION_NOT_FRESH"
    );
  });

  it("refuses a request without a session", async () => {
    const response = await requestRegisterOptions();

    expect(response.status).toBe(401);
  });
});
