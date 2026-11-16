import type { Session } from "@/lib/auth/auth-config";

import crypto from "node:crypto";

import {
  client as opaqueClient,
  ready as opaqueReady,
} from "@serenity-kit/opaque";
import { createEmailVerificationToken } from "better-auth/api";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { createSessionAuthenticationContext } from "@/lib/auth/auth-context";
import { REVERIFICATION_REQUIRED } from "@/lib/auth/recovery-factors";
import { db } from "@/lib/db/connection";
import {
  accounts,
  passkeys,
  sessions,
  users,
  verifications,
} from "@/lib/db/schema/auth";
import { encryptedSecrets, secretWrappers } from "@/lib/db/schema/privacy";
import { computeSecretBlobRef } from "@/lib/privacy/secrets/storage.server";
import { secretsRouter } from "@/lib/trpc/routers/secrets";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import { TestAuthenticator } from "@/test-utils/webauthn-test-utils";

const mockSendEmail = vi.fn();
const mockSendWebPush = vi.fn();

vi.mock("@/lib/email/transport", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock("@/lib/agents/push-sender", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents/push-sender")>()),
  sendWebPush: (...args: unknown[]) => mockSendWebPush(...args),
}));

const APP = "http://localhost:3000";
const AUTH = `${APP}/api/auth`;
const SESSION_COOKIE = "better-auth.session_token";
const WRAPPED_DEK = JSON.stringify({
  alg: "A256GCM",
  iv: "aa",
  ciphertext: "bb",
});
const PRF_SALT = Buffer.alloc(32, 7).toString("base64");
const BLOB_HASH = "a".repeat(64);
const SIX_MINUTES_MS = 6 * 60 * 1000;

interface TestSession {
  cookie: string;
  sessionId: string;
}

async function signedCookie(token: string): Promise<string> {
  return `${SESSION_COOKIE}=${token}.${await makeSignature(token, env.BETTER_AUTH_SECRET)}`;
}

/** A session whose sign-in was the given method, at `createdAt`. */
async function sessionSignedInWith(
  userId: string,
  loginMethod: "opaque" | "passkey",
  options: { amr?: string[]; createdAt?: Date } = {}
): Promise<TestSession> {
  const sessionId = crypto.randomUUID();
  const token = crypto.randomUUID();
  const createdAt = options.createdAt ?? new Date();
  await db
    .insert(sessions)
    .values({
      id: sessionId,
      token,
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt,
      updatedAt: createdAt,
    })
    .run();
  await createSessionAuthenticationContext({
    userId,
    loginMethod,
    sourceKind: "better_auth",
    sessionId,
    ...(options.amr ? { amr: options.amr } : {}),
  });
  return { cookie: await signedCookie(token), sessionId };
}

function sessionFrom(response: Response, sessionId: string): TestSession {
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";")[0] ?? "")
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) {
    throw new Error(`No session cookie (status ${response.status})`);
  }
  return { cookie, sessionId };
}

async function passkeySignIn(
  authenticator: TestAuthenticator,
  userVerified: boolean
): Promise<TestSession> {
  const options = await auth.handler(
    new Request(`${AUTH}/passkey/generate-authenticate-options`)
  );
  const { challenge } = (await options.json()) as { challenge: string };
  const challengeCookie = (options.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";")[0])
    .join("; ");
  const verified = await auth.handler(
    new Request(`${AUTH}/passkey/verify-authentication`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: challengeCookie,
        origin: APP,
      },
      body: JSON.stringify({
        response: authenticator.assert({ challenge, userVerified }),
      }),
    })
  );
  const { session } = (await verified.json()) as { session: { id: string } };
  return sessionFrom(verified, session.id);
}

async function magicLinkSignIn(email: string): Promise<TestSession> {
  const token = crypto.randomUUID();
  await db
    .insert(verifications)
    .values({
      id: crypto.randomUUID(),
      identifier: `magic-link:${token}`,
      value: JSON.stringify({ type: "magic-link", email }),
      expiresAt: new Date(Date.now() + 300_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  const response = await auth.handler(
    new Request(`${AUTH}/magic-link/verify?token=${token}`)
  );
  const { session } = (await response.json()) as { session: { id: string } };
  return sessionFrom(response, session.id);
}

function post(path: string, body: unknown, cookie?: string) {
  return auth.handler(
    new Request(`${AUTH}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: APP,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  );
}

async function registrationRequest(): Promise<string> {
  await opaqueReady;
  return opaqueClient.startRegistration({ password: "correct horse battery" })
    .registrationRequest;
}

function secrets(
  userId: string,
  session: TestSession,
  authenticatedWith: "session_cookie" | "access_token" = "session_cookie"
) {
  return secretsRouter.createCaller({
    authContext: null,
    authenticatedWith,
    flowId: null,
    flowIdSource: "none",
    req: new Request(`${APP}/api/trpc`),
    requestId: "test-request-id",
    session: {
      user: { id: userId, email: "owner@example.com" },
      session: { id: session.sessionId },
    } as unknown as Session,
  });
}

/** A vault root opened by a passkey and the recovery key. */
async function createVault(userId: string): Promise<string> {
  const rootId = crypto.randomUUID();
  await db
    .insert(encryptedSecrets)
    .values({
      id: rootId,
      userId,
      secretType: "fhe_keys",
      encryptedBlob: "",
      blobRef: computeSecretBlobRef(rootId),
      blobHash: BLOB_HASH,
      blobSize: 1,
    })
    .run();
  await db
    .insert(secretWrappers)
    .values([
      {
        secretId: rootId,
        userId,
        credentialId: "passkey-credential",
        wrappedDek: WRAPPED_DEK,
        prfSalt: PRF_SALT,
        kekSource: "prf",
      },
      {
        secretId: rootId,
        userId,
        credentialId: "recovery_key",
        wrappedDek: WRAPPED_DEK,
        kekSource: "recovery_key",
      },
    ])
    .run();
  return rootId;
}

/** Adds a sign-in account for each provider; returns their ids by provider. */
async function addAccounts(
  userId: string,
  providers: string[]
): Promise<Record<string, string>> {
  const now = new Date();
  const ids = Object.fromEntries(
    providers.map((providerId) => [providerId, crypto.randomUUID()])
  );
  await db
    .insert(accounts)
    .values(
      providers.map((providerId) => ({
        id: ids[providerId] ?? "",
        accountId: userId,
        providerId,
        userId,
        createdAt: now,
        updatedAt: now,
      }))
    )
    .run();
  return ids;
}

async function providerIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ providerId: accounts.providerId })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .all();
  return rows.map((row) => row.providerId).sort();
}

async function passkeyCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .all();
  return rows.length;
}

async function vaultRootId(userId: string): Promise<string | undefined> {
  const row = await db
    .select({ id: encryptedSecrets.id })
    .from(encryptedSecrets)
    .where(eq(encryptedSecrets.userId, userId))
    .get();
  return row?.id;
}

async function userEmail(userId: string): Promise<string | undefined> {
  const row = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row?.email;
}

function newRoot() {
  const secretId = crypto.randomUUID();
  return {
    secretId,
    secretType: "fhe_keys" as const,
    blobRef: computeSecretBlobRef(secretId),
    blobHash: BLOB_HASH,
    blobSize: 1,
    wrappedDek: WRAPPED_DEK,
    prfSalt: PRF_SALT,
    credentialId: "new-passkey-credential",
    kekSource: "prf" as const,
  };
}

const RECOVERY_KEY_WRAPPER = {
  credentialId: "recovery_key",
  wrappedDek: WRAPPED_DEK,
  kekSource: "recovery_key" as const,
};

async function refusal(response: Response) {
  return {
    status: response.status,
    code: ((await response.json()) as { code?: string }).code,
  };
}

const REFUSED = { status: 403, code: REVERIFICATION_REQUIRED };

describe("recovery factor changes on a passkey account", () => {
  const email = "owner@example.com";
  let userId: string;
  let authenticator: TestAuthenticator;

  beforeEach(async () => {
    await resetDatabase();
    mockSendEmail.mockResolvedValue("sent");
    userId = await createTestUser({ email, emailVerified: true });
    authenticator = await new TestAuthenticator().register(userId);
  });

  describe("from a password session", () => {
    let session: TestSession;

    beforeEach(async () => {
      session = await sessionSignedInWith(userId, "opaque");
    });

    it("refuses an email change", async () => {
      expect(
        await refusal(
          await post(
            "/change-email",
            { newEmail: "new@example.com" },
            session.cookie
          )
        )
      ).toEqual(REFUSED);
      expect(await userEmail(userId)).toBe(email);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("refuses to send a verification link", async () => {
      await db
        .update(users)
        .set({ emailVerified: false })
        .where(eq(users.id, userId))
        .run();

      expect(
        await refusal(
          await post("/send-verification-email", { email }, session.cookie)
        )
      ).toEqual(REFUSED);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("refuses to set or replace the password", async () => {
      expect(
        await refusal(
          await post(
            "/password/opaque/registration/challenge",
            { registrationRequest: await registrationRequest() },
            session.cookie
          )
        )
      ).toEqual(REFUSED);
      expect(
        await refusal(
          await post(
            "/password/opaque/registration/complete",
            { registrationRecord: "AAAA" },
            session.cookie
          )
        )
      ).toEqual(REFUSED);
    });

    it("refuses to create, replace, or remove the recovery key", async () => {
      const rootId = await createVault(userId);
      const caller = secrets(userId, session);

      await expect(
        caller.addWrapper({ secretId: rootId, ...RECOVERY_KEY_WRAPPER })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.removeCredential({ credentialId: "recovery_key" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const wrappers = await db
        .select({ credentialId: secretWrappers.credentialId })
        .from(secretWrappers)
        .where(eq(secretWrappers.secretId, rootId))
        .all();
      expect(wrappers).toHaveLength(2);
    });

    it("refuses a passkey wrapper under a reserved credential id", async () => {
      const rootId = await createVault(userId);
      const caller = secrets(userId, session);
      const before = await db
        .select()
        .from(secretWrappers)
        .where(eq(secretWrappers.secretId, rootId))
        .all();

      for (const credentialId of [
        "recovery_key",
        "opaque",
        "vault",
        "wallet:1:0x0000000000000000000000000000000000000001",
      ]) {
        await expect(
          caller.addWrapper({
            secretId: rootId,
            credentialId,
            wrappedDek: WRAPPED_DEK,
            prfSalt: PRF_SALT,
            kekSource: "prf",
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
      expect(
        await db
          .select()
          .from(secretWrappers)
          .where(eq(secretWrappers.secretId, rootId))
          .all()
      ).toEqual(before);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("refuses to remove the only passkey, so the rule still holds", async () => {
      expect(
        await refusal(
          await post(
            "/passkey/delete-passkey",
            { id: authenticator.passkeyId },
            session.cookie
          )
        )
      ).toEqual(REFUSED);
      expect(await passkeyCount(userId)).toBe(1);
      expect(
        await refusal(
          await post(
            "/change-email",
            { newEmail: "new@example.com" },
            session.cookie
          )
        )
      ).toEqual(REFUSED);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("refuses to unlink the password or a wallet", async () => {
      const ids = await addAccounts(userId, ["eip712", "opaque"]);

      for (const accountId of Object.values(ids)) {
        expect(
          await refusal(
            await post("/unlink-account", { accountId }, session.cookie)
          )
        ).toEqual(REFUSED);
      }
      expect(await providerIds(userId)).toEqual(["eip712", "opaque"]);
    });

    it("refuses to reset or replace the vault root", async () => {
      const rootId = await createVault(userId);
      const caller = secrets(userId, session);

      await expect(caller.resetVault()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(caller.storeSecret(newRoot())).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await vaultRootId(userId)).toBe(rootId);
    });
  });

  describe("from a session with a user-verified passkey sign-in", () => {
    let session: TestSession;

    beforeEach(async () => {
      session = await passkeySignIn(authenticator, true);
    });

    it("allows an email change", async () => {
      const response = await post(
        "/change-email",
        { newEmail: "new@example.com" },
        session.cookie
      );

      expect(response.status).toBe(200);
      await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalledOnce());
    });

    it("allows a verification link for an unverified address", async () => {
      await db
        .update(users)
        .set({ emailVerified: false })
        .where(eq(users.id, userId))
        .run();

      const response = await post(
        "/send-verification-email",
        { email },
        session.cookie
      );

      expect(response.status).toBe(200);
      await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalledOnce());
    });

    it("allows a password to be set", async () => {
      const response = await post(
        "/password/opaque/registration/challenge",
        { registrationRequest: await registrationRequest() },
        session.cookie
      );

      expect(response.status).toBe(200);
    });

    it("allows recovery key and vault changes", async () => {
      const rootId = await createVault(userId);
      const caller = secrets(userId, session);

      await caller.addWrapper({ secretId: rootId, ...RECOVERY_KEY_WRAPPER });
      await caller.removeCredential({ credentialId: "recovery_key" });
      await caller.storeSecret(newRoot());
      await caller.resetVault();

      expect(await vaultRootId(userId)).toBeUndefined();
    });

    it("allows a passkey to be removed and the password unlinked", async () => {
      const ids = await addAccounts(userId, ["eip712", "opaque"]);

      const unlinked = await post(
        "/unlink-account",
        { accountId: ids.opaque },
        session.cookie
      );
      expect(unlinked.status).toBe(200);
      const removed = await post(
        "/passkey/delete-passkey",
        { id: authenticator.passkeyId },
        session.cookie
      );
      expect(removed.status).toBe(200);

      expect(await providerIds(userId)).toEqual(["eip712"]);
      expect(await passkeyCount(userId)).toBe(0);
    });

    it("does not lend the sign-in to an OAuth access token", async () => {
      const rootId = await createVault(userId);

      await expect(
        secrets(userId, session, "access_token").addWrapper({
          secretId: rootId,
          ...RECOVERY_KEY_WRAPPER,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  it("never rewrites the vault root under its own id", async () => {
    const rootId = await createVault(userId);
    const rewrite = {
      ...newRoot(),
      secretId: rootId,
      blobRef: computeSecretBlobRef(rootId),
      blobHash: "c".repeat(64),
    };

    for (const session of [
      await sessionSignedInWith(userId, "opaque"),
      await passkeySignIn(authenticator, true),
    ]) {
      await expect(
        secrets(userId, session).storeSecret(rewrite)
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }

    const root = await db
      .select({ blobHash: encryptedSecrets.blobHash })
      .from(encryptedSecrets)
      .where(eq(encryptedSecrets.id, rootId))
      .get();
    expect(root?.blobHash).toBe(BLOB_HASH);
    const wrappers = await db
      .select({ credentialId: secretWrappers.credentialId })
      .from(secretWrappers)
      .where(eq(secretWrappers.secretId, rootId))
      .all();
    expect(wrappers.map((wrapper) => wrapper.credentialId).sort()).toEqual([
      "passkey-credential",
      "recovery_key",
    ]);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("refuses a passkey sign-in that did not verify the user", async () => {
    const session = await passkeySignIn(authenticator, false);

    expect(
      await refusal(
        await post(
          "/change-email",
          { newEmail: "new@example.com" },
          session.cookie
        )
      )
    ).toEqual(REFUSED);
  });

  it("refuses a user-verified passkey sign-in older than 5 minutes", async () => {
    const session = await sessionSignedInWith(userId, "passkey", {
      amr: ["pop", "user", "mfa"],
      createdAt: new Date(Date.now() - SIX_MINUTES_MS),
    });

    expect(
      await refusal(
        await post(
          "/change-email",
          { newEmail: "new@example.com" },
          session.cookie
        )
      )
    ).toEqual(REFUSED);
  });

  it("allows a magic-link sign-in to the verified address", async () => {
    const session = await magicLinkSignIn(email);

    const response = await post(
      "/change-email",
      { newEmail: "new@example.com" },
      session.cookie
    );

    expect(response.status).toBe(200);
  });

  it("lets a magic-link sign-in remove a lost passkey", async () => {
    const session = await magicLinkSignIn(email);

    const response = await post(
      "/passkey/delete-passkey",
      { id: authenticator.passkeyId },
      session.cookie
    );

    expect(response.status).toBe(200);
    expect(await passkeyCount(userId)).toBe(0);
  });

  it("refuses a magic-link sign-in that verified the address itself", async () => {
    await db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, userId))
      .run();
    const session = await magicLinkSignIn(email);
    const rootId = await createVault(userId);

    await expect(
      secrets(userId, session).addWrapper({
        secretId: rootId,
        ...RECOVERY_KEY_WRAPPER,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  describe("an email-change link", () => {
    async function changeLink() {
      const token = await createEmailVerificationToken(
        env.BETTER_AUTH_SECRET,
        email,
        "new@example.com",
        undefined,
        { requestType: "change-email-verification", userId }
      );
      return `${AUTH}/verify-email?token=${token}`;
    }

    it("no longer changes the address when it predates the passkey", async () => {
      const link = await changeLink();
      await db
        .update(passkeys)
        .set({ createdAt: new Date(Date.now() + 120_000) })
        .where(eq(passkeys.userId, userId))
        .run();

      const redirected = await auth.handler(
        new Request(`${link}&callbackURL=%2Fdashboard%2Fsettings`, {
          redirect: "manual",
        })
      );
      expect(redirected.status).toBe(302);
      const location = new URL(redirected.headers.get("location") ?? "");
      expect(location.pathname).toBe("/dashboard/settings");
      expect(location.searchParams.get("error")).toBe(REVERIFICATION_REQUIRED);

      expect(await refusal(await auth.handler(new Request(link)))).toEqual(
        REFUSED
      );
      expect(await userEmail(userId)).toBe(email);
    });

    it("changes the address when the passkey account asked for it", async () => {
      const response = await auth.handler(new Request(await changeLink()));

      expect(response.status).toBe(200);
      expect(await userEmail(userId)).toBe("new@example.com");
    });
  });

  it("sends no verification link to a session-less request", async () => {
    await db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, userId))
      .run();

    const response = await post("/send-verification-email", { email });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe("recovery factor changes on an account without a passkey", () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSendEmail.mockResolvedValue("sent");
  });

  it("keeps today's rules for a password session", async () => {
    const userId = await createTestUser({
      email: "owner@example.com",
      emailVerified: true,
    });
    const session = await sessionSignedInWith(userId, "opaque");
    const rootId = await createVault(userId);

    const response = await post(
      "/change-email",
      { newEmail: "new@example.com" },
      session.cookie
    );
    expect(response.status).toBe(200);
    await secrets(userId, session).addWrapper({
      secretId: rootId,
      ...RECOVERY_KEY_WRAPPER,
    });
  });

  it("still sends a verification link to a session-less request", async () => {
    await createTestUser({ email: "plain@example.com", emailVerified: false });

    const response = await post("/send-verification-email", {
      email: "plain@example.com",
    });

    expect(response.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it("lets sign-up set a password on an anonymous passkey account", async () => {
    const userId = await createTestUser();
    await db
      .update(users)
      .set({ isAnonymous: true })
      .where(eq(users.id, userId))
      .run();
    await new TestAuthenticator().register(userId);
    const session = await sessionSignedInWith(userId, "opaque");

    const response = await post(
      "/password/opaque/registration/challenge",
      { registrationRequest: await registrationRequest() },
      session.cookie
    );

    expect(response.status).toBe(200);
  });
});

describe("recovery factor notices", () => {
  const email = "owner@example.com";
  const password = "correct horse battery";
  let userId: string;
  let session: TestSession;

  async function setPassword(cookie: string | undefined, token?: string) {
    await opaqueReady;
    const { clientRegistrationState, registrationRequest } =
      opaqueClient.startRegistration({ password });
    const [challengePath, completePath] = token
      ? ["/password-reset/opaque/challenge", "/password-reset/opaque/complete"]
      : [
          "/password/opaque/registration/challenge",
          "/password/opaque/registration/complete",
        ];
    const challenge = (await (
      await post(challengePath, { token, registrationRequest }, cookie)
    ).json()) as { challenge: string };
    const { registrationRecord } = opaqueClient.finishRegistration({
      clientRegistrationState,
      registrationResponse: challenge.challenge,
      password,
    });
    return post(completePath, { token, registrationRecord }, cookie);
  }

  function notices() {
    return mockSendEmail.mock.calls.map(([message]) => ({
      to: (message as { to: string[] }).to,
      text: (message as { text: string }).text.split("\n")[0],
    }));
  }

  beforeEach(async () => {
    await resetDatabase();
    mockSendEmail.mockResolvedValue("sent");
    mockSendWebPush.mockResolvedValue(undefined);
    userId = await createTestUser({ email, emailVerified: true });
    session = await passkeySignIn(
      await new TestAuthenticator().register(userId),
      true
    );
  });

  it("sends one notice for each recovery key and vault change", async () => {
    const rootId = await createVault(userId);
    const caller = secrets(userId, session);

    await caller.removeCredential({ credentialId: "recovery_key" });
    await caller.addWrapper({ secretId: rootId, ...RECOVERY_KEY_WRAPPER });
    await caller.addWrapper({ secretId: rootId, ...RECOVERY_KEY_WRAPPER });
    await caller.storeSecret(newRoot());
    await caller.resetVault();

    expect(notices()).toEqual([
      {
        to: [email],
        text: "The recovery key was removed from your Zentity account.",
      },
      {
        to: [email],
        text: "A recovery key was added to your Zentity account.",
      },
      {
        to: [email],
        text: "The recovery key of your Zentity account was replaced. The old one no longer works.",
      },
      {
        to: [email],
        text: "New encryption keys were set up for your Zentity account.",
      },
      {
        to: [email],
        text: "The encryption keys of your Zentity account were reset.",
      },
    ]);
    expect(mockSendWebPush).toHaveBeenCalledTimes(5);
    expect(mockSendWebPush.mock.calls[0]?.[1]).toMatchObject({
      data: { kind: "account_notice", url: "/dashboard/settings" },
    });
  });

  it("sends nothing for a refused change", async () => {
    const rootId = await createVault(userId);
    const passwordSession = await sessionSignedInWith(userId, "opaque");

    await expect(
      secrets(userId, passwordSession).addWrapper({
        secretId: rootId,
        ...RECOVERY_KEY_WRAPPER,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendWebPush).not.toHaveBeenCalled();
  });

  it("emails an unverified address but never a wallet placeholder", async () => {
    const rootId = await createVault(userId);
    await db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, userId))
      .run();

    await secrets(userId, session).removeCredential({
      credentialId: "recovery_key",
    });
    expect(notices()).toHaveLength(1);

    await db
      .update(users)
      .set({ email: "1234abcd@wallet.zentity.app" })
      .where(eq(users.id, userId))
      .run();
    await secrets(userId, session).addWrapper({
      secretId: rootId,
      ...RECOVERY_KEY_WRAPPER,
    });

    expect(notices()).toHaveLength(1);
    expect(mockSendWebPush).toHaveBeenCalledTimes(2);
  });

  it("tells the user a passkey, the password, and a wallet were removed", async () => {
    const ids = await addAccounts(userId, [
      "eip712",
      "github",
      "google",
      "opaque",
    ]);
    const { passkeyId } = await new TestAuthenticator().register(userId);

    for (const [path, body] of [
      ["/unlink-account", { accountId: ids.google }],
      ["/passkey/delete-passkey", { id: passkeyId }],
      ["/unlink-account", { accountId: ids.opaque }],
      ["/unlink-account", { accountId: ids.eip712 }],
    ] as const) {
      expect((await post(path, body, session.cookie)).status).toBe(200);
    }

    expect(notices()).toEqual([
      { to: [email], text: "A passkey was removed from your Zentity account." },
      {
        to: [email],
        text: "The password was removed from your Zentity account.",
      },
      { to: [email], text: "A wallet was removed from your Zentity account." },
    ]);
    expect(mockSendWebPush).toHaveBeenCalledTimes(3);
  });

  it("sends nothing when the passkey to remove belongs to someone else", async () => {
    const otherUser = await createTestUser();
    const { passkeyId } = await new TestAuthenticator().register(otherUser);

    const response = await post(
      "/passkey/delete-passkey",
      { id: passkeyId },
      session.cookie
    );

    expect(response.status).toBe(401);
    expect(await passkeyCount(otherUser)).toBe(1);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("tells the user a password was added, then changed", async () => {
    expect((await setPassword(session.cookie)).status).toBe(200);
    expect((await setPassword(session.cookie)).status).toBe(200);

    expect(notices()).toEqual([
      { to: [email], text: "A password was added to your Zentity account." },
      {
        to: [email],
        text: "The password of your Zentity account was changed.",
      },
    ]);
  });

  it("tells the user their password was reset", async () => {
    const token = crypto.randomUUID();
    await db
      .insert(verifications)
      .values({
        id: crypto.randomUUID(),
        identifier: `opaque-reset:${token}`,
        value: userId,
        expiresAt: new Date(Date.now() + 300_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    expect((await setPassword(undefined, token)).status).toBe(200);

    expect(notices()).toEqual([
      { to: [email], text: "The password of your Zentity account was reset." },
    ]);
  });

  it("tells the previous address that the email changed", async () => {
    const token = await createEmailVerificationToken(
      env.BETTER_AUTH_SECRET,
      email,
      "new@example.com",
      undefined,
      { requestType: "change-email-verification", userId }
    );

    const response = await auth.handler(
      new Request(`${AUTH}/verify-email?token=${token}`)
    );

    expect(response.status).toBe(200);
    expect(notices()).toEqual([
      {
        to: [email],
        text: "The email of your Zentity account was changed to n•••@example.com.",
      },
    ]);
  });

  it("sends nothing while sign-up sets the first password", async () => {
    await db
      .update(users)
      .set({ isAnonymous: true })
      .where(eq(users.id, userId))
      .run();

    expect((await setPassword(session.cookie)).status).toBe(200);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
