import crypto from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { db } from "@/lib/db/connection";
import {
  authenticationContexts,
  passkeys,
  sessions,
} from "@/lib/db/schema/auth";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import { TestAuthenticator } from "@/test-utils/webauthn-test-utils";

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

  it("reports a valid creation date for a newly registered passkey", async () => {
    await db
      .insert(passkeys)
      .values({
        id: crypto.randomUUID(),
        name: "Test passkey",
        publicKey: "test-public-key",
        userId,
        credentialID: crypto.randomUUID(),
        counter: 0,
        deviceType: "singleDevice",
        backedUp: true,
        transports: JSON.stringify(["internal"]),
      })
      .run();

    const [row] = await db
      .select({ createdAt: passkeys.createdAt })
      .from(passkeys)
      .where(eq(passkeys.userId, userId));

    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(Number.isNaN(row?.createdAt.getTime())).toBe(false);
    expect(row?.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

// R20: sign-in records what the passkey ceremony observed.
describe("passkey sign-in", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
  });

  async function signIn(
    authenticator: TestAuthenticator,
    userVerified: boolean
  ) {
    const options = await auth.handler(
      new Request(
        "http://localhost:3000/api/auth/passkey/generate-authenticate-options"
      )
    );
    if (options.status !== 200) {
      throw new Error(`Authentication options answered ${options.status}`);
    }
    const { challenge } = (await options.json()) as { challenge: string };
    const challengeCookie = (options.headers.getSetCookie?.() ?? [])
      .map((cookie) => cookie.split(";")[0])
      .join("; ");

    const verified = await auth.handler(
      new Request(
        "http://localhost:3000/api/auth/passkey/verify-authentication",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: challengeCookie,
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({
            response: authenticator.assert({ challenge, userVerified }),
          }),
        }
      )
    );
    if (verified.status !== 200) {
      throw new Error(`Passkey sign-in answered ${verified.status}`);
    }
    const { session } = (await verified.json()) as { session: { id: string } };
    const row = await db
      .select({ amr: authenticationContexts.amr })
      .from(sessions)
      .innerJoin(
        authenticationContexts,
        eq(sessions.authContextId, authenticationContexts.id)
      )
      .where(eq(sessions.id, session.id))
      .get();
    return row?.amr;
  }

  it("accepts an authenticator without user verification and claims presence only", async () => {
    const authenticator = await new TestAuthenticator().register(userId);

    expect(await signIn(authenticator, false)).toEqual(["pop", "user"]);
  });

  it("claims a second factor when the authenticator verified the user", async () => {
    const authenticator = await new TestAuthenticator().register(userId);

    expect(await signIn(authenticator, true)).toEqual(["pop", "user", "mfa"]);
  });
});
