import type { Session } from "@/lib/auth/auth-config";

import crypto from "node:crypto";

import {
  client as opaqueClient,
  ready as opaqueReady,
} from "@serenity-kit/opaque";
import { createEmailVerificationToken } from "better-auth/api";
import { makeSignature } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import {
  createSessionAuthenticationContext,
  replaceSessionAuthenticationContext,
} from "@/lib/auth/auth-context";
import { REVERIFICATION_REQUIRED } from "@/lib/auth/recovery-factors";
import { db } from "@/lib/db/connection";
import {
  accounts,
  authenticationContexts,
  passkeys,
  sessions,
  users,
  verifications,
  walletAddresses,
} from "@/lib/db/schema/auth";
import { encryptedSecrets, secretWrappers } from "@/lib/db/schema/privacy";
import { computeSecretBlobRef } from "@/lib/privacy/secrets/storage.server";
import { accountRouter } from "@/lib/trpc/routers/account";
import { secretsRouter } from "@/lib/trpc/routers/secrets";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import { TestAuthenticator } from "@/test-utils/webauthn-test-utils";

// A configured social provider, so `/link-social` reaches the provider.
vi.hoisted(() => {
  process.env.GITHUB_CLIENT_ID = "test-github-client";
  process.env.GITHUB_CLIENT_SECRET = "test-github-secret";
});

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

function account(userId: string, session: TestSession) {
  return accountRouter.createCaller({
    authContext: null,
    authenticatedWith: "session_cookie",
    flowId: null,
    flowIdSource: "none",
    req: new Request(`${APP}/api/trpc`, {
      headers: { cookie: session.cookie, origin: APP },
    }),
    requestId: "test-request-id",
    session: {
      user: { id: userId, email: "owner@example.com" },
      session: { id: session.sessionId },
    } as unknown as Session,
  });
}

async function userExists(userId: string): Promise<boolean> {
  const row = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return Boolean(row);
}

async function wrapperIds(rootId: string): Promise<string[]> {
  const rows = await db
    .select({ credentialId: secretWrappers.credentialId })
    .from(secretWrappers)
    .where(eq(secretWrappers.secretId, rootId))
    .all();
  return rows.map((row) => row.credentialId).sort();
}

/** Lets the password and a wallet open the vault too. */
async function addPasswordAndWalletWrappers(
  userId: string,
  rootId: string
): Promise<void> {
  await db
    .insert(secretWrappers)
    .values([
      {
        secretId: rootId,
        userId,
        credentialId: "opaque",
        wrappedDek: WRAPPED_DEK,
        kekSource: "opaque",
      },
      {
        secretId: rootId,
        userId,
        credentialId: "wallet:1:0xabc",
        wrappedDek: WRAPPED_DEK,
        kekSource: "wallet",
      },
    ])
    .run();
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
  verifierHash: "d".repeat(64),
};

async function refusal(response: Response) {
  return {
    status: response.status,
    code: ((await response.json()) as { code?: string }).code,
  };
}

const REFUSED = { status: 403, code: REVERIFICATION_REQUIRED };
const LAST_PASSKEY_REFUSED = { status: 400, code: "LAST_PASSKEY" };
const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";

function linkGithub(cookie: string) {
  return post(
    "/link-social",
    {
      provider: "github",
      callbackURL: "/dashboard/settings?tab=account",
      disableRedirect: true,
    },
    cookie
  );
}

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

    it("refuses to detach a passkey, the password, or a wallet from the vault", async () => {
      const rootId = await createVault(userId);
      await addPasswordAndWalletWrappers(userId, rootId);
      const before = await wrapperIds(rootId);
      const caller = secrets(userId, session);

      for (const credentialId of [
        "passkey-credential",
        "opaque",
        "wallet:1:0xabc",
      ]) {
        await expect(
          caller.removeCredential({ credentialId })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      expect(await wrapperIds(rootId)).toEqual(before);
    });

    it("refuses to delete the account before erasing anything", async () => {
      const rootId = await createVault(userId);

      await expect(
        account(userId, session).deleteAccount({ confirmEmail: email })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        await refusal(await post("/delete-user", {}, session.cookie))
      ).toEqual(REFUSED);
      expect(await userExists(userId)).toBe(true);
      expect(await vaultRootId(userId)).toBe(rootId);
      expect(await wrapperIds(rootId)).toHaveLength(2);
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
      ).toEqual(LAST_PASSKEY_REFUSED);
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

    it("refuses to unlink the password, a wallet, or a social sign-in account", async () => {
      const ids = await addAccounts(userId, ["eip712", "github", "opaque"]);

      for (const accountId of Object.values(ids)) {
        expect(
          await refusal(
            await post("/unlink-account", { accountId }, session.cookie)
          )
        ).toEqual(REFUSED);
      }
      expect(await providerIds(userId)).toEqual(["eip712", "github", "opaque"]);
    });

    it("refuses to link a social sign-in account", async () => {
      expect(await refusal(await linkGithub(session.cookie))).toEqual(REFUSED);
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
      const other = await new TestAuthenticator().register(userId);

      const unlinked = await post(
        "/unlink-account",
        { accountId: ids.opaque },
        session.cookie
      );
      expect(unlinked.status).toBe(200);
      const removed = await post(
        "/passkey/delete-passkey",
        { id: other.passkeyId },
        session.cookie
      );
      expect(removed.status).toBe(200);

      expect(await providerIds(userId)).toEqual(["eip712"]);
      expect(await passkeyCount(userId)).toBe(1);
    });

    it("keeps the last passkey, which only an account recovery removes", async () => {
      expect(
        await refusal(
          await post(
            "/passkey/delete-passkey",
            { id: authenticator.passkeyId },
            session.cookie
          )
        )
      ).toEqual(LAST_PASSKEY_REFUSED);
      expect(await passkeyCount(userId)).toBe(1);
    });

    it("allows a social sign-in account to be linked and unlinked", async () => {
      const linked = await linkGithub(session.cookie);
      expect(linked.status).toBe(200);
      expect(((await linked.json()) as { url: string }).url).toMatch(
        GITHUB_AUTHORIZE
      );

      const ids = await addAccounts(userId, ["github", "opaque"]);
      const unlinked = await post(
        "/unlink-account",
        { accountId: ids.github },
        session.cookie
      );
      expect(unlinked.status).toBe(200);
      expect(await providerIds(userId)).toEqual(["opaque"]);
    });

    it("keeps the only passkey opening the vault when it refuses to remove it", async () => {
      const rootId = await createVault(userId);
      await db
        .update(secretWrappers)
        .set({ credentialId: authenticator.credentialId })
        .where(eq(secretWrappers.credentialId, "passkey-credential"))
        .run();

      await expect(
        secrets(userId, session).removeCredential({
          credentialId: authenticator.credentialId,
        })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Add another passkey before you remove this one.",
      });
      expect(
        await refusal(
          await post(
            "/passkey/delete-passkey",
            { id: authenticator.passkeyId },
            session.cookie
          )
        )
      ).toEqual(LAST_PASSKEY_REFUSED);
      expect(await wrapperIds(rootId)).toEqual(
        [authenticator.credentialId, "recovery_key"].sort()
      );

      await new TestAuthenticator().register(userId);
      await secrets(userId, session).removeCredential({
        credentialId: authenticator.credentialId,
      });
      expect(await wrapperIds(rootId)).toEqual(["recovery_key"]);
    });

    it("allows a passkey to be detached from the vault", async () => {
      const rootId = await createVault(userId);

      await secrets(userId, session).removeCredential({
        credentialId: "passkey-credential",
      });

      expect(await wrapperIds(rootId)).toEqual(["recovery_key"]);
    });

    it("allows the account to be deleted", async () => {
      await createVault(userId);

      await expect(
        account(userId, session).deleteAccount({ confirmEmail: email })
      ).resolves.toEqual({ success: true });
      expect(await userExists(userId)).toBe(false);
      expect(await vaultRootId(userId)).toBeUndefined();
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

  it("allows a magic-link sign-in to an account with nothing else", async () => {
    const session = await magicLinkSignIn(email);

    const response = await post(
      "/change-email",
      { newEmail: "new@example.com" },
      session.cookie
    );

    expect(response.status).toBe(200);
  });

  it("lets a magic-link sign-in remove a lost passkey, but not the last one", async () => {
    const replacement = await new TestAuthenticator().register(userId);
    const session = await magicLinkSignIn(email);

    const response = await post(
      "/passkey/delete-passkey",
      { id: authenticator.passkeyId },
      session.cookie
    );
    expect(response.status).toBe(200);
    expect(
      await refusal(
        await post(
          "/passkey/delete-passkey",
          { id: replacement.passkeyId },
          session.cookie
        )
      )
    ).toEqual(LAST_PASSKEY_REFUSED);
    expect(await passkeyCount(userId)).toBe(1);
  });

  it("refuses a magic-link sign-in alone once the account has a password", async () => {
    await addAccounts(userId, ["opaque"]);
    const session = await magicLinkSignIn(email);

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
    await secrets(userId, session).removeCredential({
      credentialId: "passkey-credential",
    });
    expect((await linkGithub(session.cookie)).status).toBe(200);
  });

  it("keeps the vault when Better Auth refuses a stale session's deletion", async () => {
    const userId = await createTestUser({
      email: "owner@example.com",
      emailVerified: true,
    });
    const session = await sessionSignedInWith(userId, "opaque", {
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
    const rootId = await createVault(userId);

    await expect(
      account(userId, session).deleteAccount({
        confirmEmail: "owner@example.com",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await userExists(userId)).toBe(true);
    expect(await vaultRootId(userId)).toBe(rootId);
    expect(await wrapperIds(rootId)).toHaveLength(2);
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

const PASSWORD = "correct horse battery";

/** Sets the password from a session, or by email reset with `token`. */
async function setPassword(cookie: string | undefined, token?: string) {
  await opaqueReady;
  const { clientRegistrationState, registrationRequest } =
    opaqueClient.startRegistration({ password: PASSWORD });
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
    password: PASSWORD,
  });
  return post(completePath, { token, registrationRecord }, cookie);
}

/** A password reset link for the user, as `/password-reset/opaque/request` stores it. */
async function passwordResetToken(userId: string): Promise<string> {
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
  return token;
}

describe("recovery factor notices", () => {
  const email = "owner@example.com";
  let userId: string;
  let session: TestSession;

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

  it("tells the user a passkey, the password, a wallet, and a social sign-in account were removed", async () => {
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
      {
        to: [email],
        text: "A Google account was unlinked from your Zentity account.",
      },
      { to: [email], text: "A passkey was removed from your Zentity account." },
      {
        to: [email],
        text: "The password was removed from your Zentity account.",
      },
      { to: [email], text: "A wallet was removed from your Zentity account." },
    ]);
    expect(mockSendWebPush).toHaveBeenCalledTimes(4);
  });

  it("tells the user a social sign-in account was linked", async () => {
    // The OAuth callback and `/link-social` link through the adapter.
    const { internalAdapter } = await auth.$context;
    await internalAdapter.linkAccount({
      providerId: "github",
      accountId: "github-user",
      userId,
    });
    await internalAdapter.createAccount({
      providerId: "opaque",
      accountId: userId,
      userId,
    });

    expect(notices()).toEqual([
      {
        to: [email],
        text: "A GitHub account was linked to your Zentity account and can now sign in to it.",
      },
    ]);
    expect(mockSendWebPush).toHaveBeenCalledOnce();
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
    await addAccounts(userId, ["opaque"]);
    const token = await passwordResetToken(userId);

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

const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

/** Registers a new passkey through the plugin's two registration requests. */
async function registerPasskey(
  session: TestSession,
  options: { beforeVerify?: () => Promise<void> } = {}
): Promise<{ authenticator: TestAuthenticator; response: Response }> {
  const authenticator = new TestAuthenticator();
  const registerOptions = await auth.handler(
    new Request(`${AUTH}/passkey/generate-register-options`, {
      headers: { cookie: session.cookie },
    })
  );
  if (registerOptions.status !== 200) {
    return { authenticator, response: registerOptions };
  }
  const { challenge } = (await registerOptions.json()) as {
    challenge: string;
  };
  const challengeCookie = (registerOptions.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";")[0])
    .join("; ");
  await options.beforeVerify?.();
  const response = await auth.handler(
    new Request(`${AUTH}/passkey/verify-registration`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `${session.cookie}; ${challengeCookie}`,
        origin: APP,
      },
      body: JSON.stringify({
        response: authenticator.attest({ challenge }),
        name: "New passkey",
      }),
    })
  );
  return { authenticator, response };
}

async function passwordSetMethod(userId: string) {
  const row = await db
    .select({ method: accounts.passwordSetMethod })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "opaque")))
    .get();
  return row?.method;
}

async function enrollmentMethods(userId: string) {
  const rows = await db
    .select({ method: passkeys.enrollmentMethod })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .all();
  return rows.map((row) => row.method);
}

/** A password set long enough ago to count toward account recovery. */
async function addSettledPassword(userId: string): Promise<void> {
  const setAt = new Date(Date.now() - EIGHT_DAYS_MS);
  await db
    .insert(accounts)
    .values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "opaque",
      userId,
      createdAt: setAt,
      updatedAt: setAt,
    })
    .run();
}

type Wallet = ReturnType<typeof privateKeyToAccount>;

/** A wallet the user signed up with `linkedAt`, 8 days ago by default. */
async function linkWallet(
  userId: string,
  linkedAt = new Date(Date.now() - EIGHT_DAYS_MS)
): Promise<Wallet> {
  const wallet = privateKeyToAccount(generatePrivateKey());
  await db
    .insert(accounts)
    .values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "eip712",
      userId,
      createdAt: linkedAt,
      updatedAt: linkedAt,
    })
    .run();
  await db
    .insert(walletAddresses)
    .values({
      userId,
      address: wallet.address,
      chainId: 1,
      isPrimary: true,
      createdAt: linkedAt.toISOString(),
    })
    .run();
  return wallet;
}

/** Confirms the wallet inside the session through `/wallet/siwe/verify/*`. */
async function confirmWallet(session: TestSession, wallet: Wallet) {
  const challenge = await post(
    "/wallet/siwe/verify/challenge",
    { address: wallet.address, chainId: 1 },
    session.cookie
  );
  if (challenge.status !== 200) {
    return challenge;
  }
  const { message } = (await challenge.json()) as { message: string };
  return post(
    "/wallet/siwe/verify/complete",
    { message, signature: await wallet.signMessage({ message }) },
    session.cookie
  );
}

/** What `/password/opaque/verify/complete` records for this session. */
function verifyPasswordInSession(userId: string, session: TestSession) {
  return replaceSessionAuthenticationContext({
    userId,
    loginMethod: "opaque",
    sourceKind: "better_auth",
    sessionId: session.sessionId,
  });
}

/** A vault the passkey and a recovery key with a known verifier open. */
async function createVaultWithVerifier(
  userId: string
): Promise<{ rootId: string; verifier: string }> {
  const rootId = await createVault(userId);
  const verifier = crypto.randomBytes(32);
  await db
    .update(secretWrappers)
    .set({
      verifierHash: crypto.createHash("sha256").update(verifier).digest("hex"),
    })
    .where(eq(secretWrappers.credentialId, "recovery_key"))
    .run();
  return { rootId, verifier: verifier.toString("base64url") };
}

function proveRecoveryKey(session: TestSession, verifier: string) {
  return post("/recovery-key/verify", { verifier }, session.cookie);
}

async function recoveryKeyVerifierHash(userId: string) {
  const row = await db
    .select({ verifierHash: secretWrappers.verifierHash })
    .from(secretWrappers)
    .where(
      and(
        eq(secretWrappers.userId, userId),
        eq(secretWrappers.credentialId, "recovery_key")
      )
    )
    .get();
  return row?.verifierHash ?? null;
}

function noticeLines() {
  return mockSendEmail.mock.calls.map(
    ([message]) => (message as { text: string }).text.split("\n")[0]
  );
}

describe("adding a passkey", () => {
  const email = "owner@example.com";
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    mockSendEmail.mockResolvedValue("sent");
    mockSendWebPush.mockResolvedValue(undefined);
    userId = await createTestUser({ email, emailVerified: true });
  });

  it("lets a fresh session add the first passkey, and tells the user", async () => {
    const session = await sessionSignedInWith(userId, "opaque");

    const { response } = await registerPasskey(session);

    expect(response.status).toBe(200);
    expect(await enrollmentMethods(userId)).toEqual(["first_passkey"]);
    expect(noticeLines()).toEqual([
      "A passkey was added to your Zentity account.",
    ]);
    expect(mockSendWebPush.mock.calls[0]?.[1]).toMatchObject({
      data: { url: "/recovery/passkey?intent=remove" },
    });
  });

  describe("to an account that holds a passkey", () => {
    let authenticator: TestAuthenticator;

    beforeEach(async () => {
      authenticator = await new TestAuthenticator().register(userId);
    });

    it("refuses a password session before the authenticator prompts", async () => {
      await addSettledPassword(userId);
      const session = await sessionSignedInWith(userId, "opaque");

      const { response } = await registerPasskey(session);

      expect(await refusal(response)).toEqual(REFUSED);
      expect(await passkeyCount(userId)).toBe(1);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("adds one after a user-verified passkey sign-in", async () => {
      const session = await passkeySignIn(authenticator, true);

      const { response } = await registerPasskey(session);

      expect(response.status).toBe(200);
      expect(await enrollmentMethods(userId)).toContain("passkey_reverified");
      expect(noticeLines()).toEqual([
        "A passkey was added to your Zentity account, confirmed with one of your passkeys.",
      ]);
    });

    it("refuses at verification once the sign-in is older than 5 minutes", async () => {
      const session = await passkeySignIn(authenticator, true);

      const { response } = await registerPasskey(session, {
        beforeVerify: async () => {
          await db
            .update(authenticationContexts)
            .set({ authenticatedAt: new Date(Date.now() - SIX_MINUTES_MS) })
            .where(
              eq(authenticationContexts.sourceSessionId, session.sessionId)
            )
            .run();
        },
      });

      expect(await refusal(response)).toEqual(REFUSED);
      expect(await passkeyCount(userId)).toBe(1);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("recovers with the password and the recovery key, once", async () => {
      await addSettledPassword(userId);
      const { verifier } = await createVaultWithVerifier(userId);
      const session = await sessionSignedInWith(userId, "opaque");

      const proved = await proveRecoveryKey(session, verifier);
      expect(proved.status).toBe(200);
      expect(await proved.json()).toMatchObject({ proof: "recovery_key" });
      const { response } = await registerPasskey(session);

      expect(response.status).toBe(200);
      expect(await enrollmentMethods(userId)).toContain("account_recovery");
      // The key confirmed one recovery, and opens the vault still.
      expect(await recoveryKeyVerifierHash(userId)).toBeNull();
      expect(await refusal((await registerPasskey(session)).response)).toEqual(
        REFUSED
      );
      expect(await refusal(await proveRecoveryKey(session, verifier))).toEqual({
        status: 400,
        code: "RECOVERY_KEY_NOT_SET",
      });
      expect(noticeLines()).toEqual([
        "Your recovery key was used to confirm a recovery of your Zentity account.",
        "A passkey was added to your Zentity account through account recovery.",
      ]);
    });

    it("spends the recovery key for every session that proved it", async () => {
      await addSettledPassword(userId);
      const { verifier } = await createVaultWithVerifier(userId);
      const first = await sessionSignedInWith(userId, "opaque");
      const second = await sessionSignedInWith(userId, "opaque");

      expect((await proveRecoveryKey(first, verifier)).status).toBe(200);
      expect((await proveRecoveryKey(second, verifier)).status).toBe(200);
      expect((await registerPasskey(first)).response.status).toBe(200);

      expect(await refusal((await registerPasskey(second)).response)).toEqual(
        REFUSED
      );
      expect(
        await refusal(
          await post(
            "/passkey/delete-passkey",
            { id: authenticator.passkeyId },
            second.cookie
          )
        )
      ).toEqual(REFUSED);
      expect(await passkeyCount(userId)).toBe(2);

      // The recovery that spent the key still retires the lost passkey.
      const retired = await post(
        "/passkey/delete-passkey",
        { id: authenticator.passkeyId },
        first.cookie
      );
      expect(retired.status).toBe(200);
      expect(await passkeyCount(userId)).toBe(1);
    });

    it("recovers with an email link and the password", async () => {
      await addSettledPassword(userId);
      const session = await magicLinkSignIn(email);

      expect(await refusal((await registerPasskey(session)).response)).toEqual(
        REFUSED
      );
      await verifyPasswordInSession(userId, session);
      const { response } = await registerPasskey(session);

      expect(response.status).toBe(200);
      expect(await enrollmentMethods(userId)).toContain("account_recovery");
    });

    it("does not count a password the same mailbox just reset", async () => {
      await addAccounts(userId, ["opaque"]);
      const session = await magicLinkSignIn(email);
      await verifyPasswordInSession(userId, session);

      const { response } = await registerPasskey(session);

      expect(await refusal(response)).toEqual(REFUSED);
      expect(await passkeyCount(userId)).toBe(1);
    });

    it("recovers with an email link and a wallet confirmed in the session", async () => {
      const wallet = await linkWallet(userId);
      const session = await magicLinkSignIn(email);

      expect(await refusal((await registerPasskey(session)).response)).toEqual(
        REFUSED
      );
      await expect(
        account(userId, session).recoveryOptions()
      ).resolves.toMatchObject({
        available: { wallet: true },
        proofs: ["magic_link"],
      });
      expect((await confirmWallet(session, wallet)).status).toBe(200);
      await expect(
        account(userId, session).recoveryOptions()
      ).resolves.toMatchObject({
        enrollment: "allowed",
        proofs: ["magic_link", "wallet"],
      });
      const { response } = await registerPasskey(session);

      expect(response.status).toBe(200);
      expect(await enrollmentMethods(userId)).toContain("account_recovery");
    });

    it("does not count a wallet linked in the last 7 days", async () => {
      const wallet = await linkWallet(userId, new Date());
      const session = await magicLinkSignIn(email);

      expect((await confirmWallet(session, wallet)).status).toBe(200);
      const { response } = await registerPasskey(session);

      expect(await refusal(response)).toEqual(REFUSED);
    });

    it("never lets an email reset add a password", async () => {
      const response = await setPassword(
        undefined,
        await passwordResetToken(userId)
      );

      expect(await refusal(response)).toEqual({
        status: 400,
        code: "PASSWORD_NOT_SET",
      });
      expect(await providerIds(userId)).toEqual([]);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("never counts a password an email reset set, however old", async () => {
      await addSettledPassword(userId);
      expect(
        (await setPassword(undefined, await passwordResetToken(userId))).status
      ).toBe(200);
      expect(await passwordSetMethod(userId)).toBe("password_reset");
      await db
        .update(accounts)
        .set({ updatedAt: new Date(Date.now() - EIGHT_DAYS_MS) })
        .where(eq(accounts.providerId, "opaque"))
        .run();
      const session = await magicLinkSignIn(email);
      await verifyPasswordInSession(userId, session);

      await expect(
        account(userId, session).recoveryOptions()
      ).resolves.toMatchObject({
        available: { password: false },
        hasPassword: true,
        proofs: ["magic_link"],
      });
      const { response } = await registerPasskey(session);

      expect(await refusal(response)).toEqual(REFUSED);
      expect(await passkeyCount(userId)).toBe(1);
    });

    it("counts a password set with a passkey confirmation at once", async () => {
      const passkeySession = await passkeySignIn(authenticator, true);
      expect((await setPassword(passkeySession.cookie)).status).toBe(200);
      expect(await passwordSetMethod(userId)).toBe("passkey_reverified");
      const session = await magicLinkSignIn(email);
      await verifyPasswordInSession(userId, session);

      const { response } = await registerPasskey(session);

      expect(response.status).toBe(200);
      expect(await enrollmentMethods(userId)).toContain("account_recovery");
    });

    it("recovers an account that has only its email with an email link", async () => {
      const session = await magicLinkSignIn(email);

      const { response } = await registerPasskey(session);

      expect(response.status).toBe(200);
      expect(await enrollmentMethods(userId)).toContain("email_only_recovery");
      expect(await refusal((await registerPasskey(session)).response)).toEqual(
        REFUSED
      );
    });

    it("refuses an address that a password session tried to swap in", async () => {
      await db
        .update(users)
        .set({ emailVerified: false })
        .where(eq(users.id, userId))
        .run();
      const passwordSession = await sessionSignedInWith(userId, "opaque");

      expect(
        await refusal(
          await post(
            "/change-email",
            { newEmail: "attacker@example.com" },
            passwordSession.cookie
          )
        )
      ).toEqual(REFUSED);
      // A link that verifies the address proves nothing for a recovery.
      const session = await magicLinkSignIn(email);
      const { response } = await registerPasskey(session);

      expect(await refusal(response)).toEqual(REFUSED);
      expect(await passkeyCount(userId)).toBe(1);
    });
  });

  it("lets a session take back the passkey it just added, and no other session", async () => {
    const session = await sessionSignedInWith(userId, "opaque");
    const { response } = await registerPasskey(session);
    const { id } = (await response.json()) as { id: string };
    const otherSession = await sessionSignedInWith(userId, "opaque");

    expect(
      await refusal(
        await post("/passkey/delete-passkey", { id }, otherSession.cookie)
      )
    ).toEqual(LAST_PASSKEY_REFUSED);
    const removed = await post(
      "/passkey/delete-passkey",
      { id },
      session.cookie
    );

    expect(removed.status).toBe(200);
    expect(await passkeyCount(userId)).toBe(0);
  });
});

describe("the recovery key", () => {
  const email = "owner@example.com";
  let userId: string;
  let authenticator: TestAuthenticator;

  beforeEach(async () => {
    await resetDatabase();
    mockSendEmail.mockResolvedValue("sent");
    mockSendWebPush.mockResolvedValue(undefined);
    userId = await createTestUser({ email, emailVerified: true });
    authenticator = await new TestAuthenticator().register(userId);
  });

  it("needs a verifier, which the server keeps to itself", async () => {
    const rootId = await createVault(userId);
    const caller = secrets(userId, await passkeySignIn(authenticator, true));
    const { verifierHash, ...withoutVerifier } = RECOVERY_KEY_WRAPPER;

    await expect(
      caller.addWrapper({ secretId: rootId, ...withoutVerifier })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.addWrapper({
        secretId: rootId,
        credentialId: "opaque",
        wrappedDek: WRAPPED_DEK,
        kekSource: "opaque",
        verifierHash,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const { wrapper } = await caller.addWrapper({
      secretId: rootId,
      ...RECOVERY_KEY_WRAPPER,
    });

    expect(wrapper).not.toHaveProperty("verifierHash");
    expect(await recoveryKeyVerifierHash(userId)).toBe(verifierHash);
    const bundle = await caller.getSecretBundle({ secretType: "fhe_keys" });
    for (const stored of bundle.wrappers) {
      expect(stored).not.toHaveProperty("verifierHash");
    }
  });

  it("checks the key without learning it", async () => {
    const session = await sessionSignedInWith(userId, "opaque");

    expect(
      await refusal(
        await proveRecoveryKey(
          session,
          crypto.randomBytes(32).toString("base64url")
        )
      )
    ).toEqual({ status: 400, code: "RECOVERY_KEY_NOT_SET" });
    const { verifier } = await createVaultWithVerifier(userId);
    for (const wrong of [
      crypto.randomBytes(32).toString("base64url"),
      crypto.randomBytes(16).toString("base64url"),
    ]) {
      expect(await refusal(await proveRecoveryKey(session, wrong))).toEqual({
        status: 401,
        code: "INVALID_RECOVERY_KEY",
      });
    }
    expect(mockSendEmail).not.toHaveBeenCalled();

    expect((await proveRecoveryKey(session, verifier)).status).toBe(200);
    const proof = await db
      .select({ value: verifications.value })
      .from(verifications)
      .where(
        eq(verifications.identifier, `account-recovery:${session.sessionId}`)
      )
      .get();
    expect(JSON.parse(proof?.value ?? "{}")).toEqual({
      proof: "recovery_key",
      userId,
      verifierHash: await recoveryKeyVerifierHash(userId),
    });
  });

  it("removes the last passkey only from an account recovery", async () => {
    await addSettledPassword(userId);
    const { verifier } = await createVaultWithVerifier(userId);
    const session = await sessionSignedInWith(userId, "opaque");

    expect(
      await refusal(
        await post(
          "/passkey/delete-passkey",
          { id: authenticator.passkeyId },
          session.cookie
        )
      )
    ).toEqual(LAST_PASSKEY_REFUSED);
    await proveRecoveryKey(session, verifier);
    const removed = await post(
      "/passkey/delete-passkey",
      { id: authenticator.passkeyId },
      session.cookie
    );

    expect(removed.status).toBe(200);
    expect(await passkeyCount(userId)).toBe(0);
  });

  it("tells the page what the session can still prove", async () => {
    await addSettledPassword(userId);
    await createVaultWithVerifier(userId);
    const session = await sessionSignedInWith(userId, "opaque");

    await expect(account(userId, session).recoveryOptions()).resolves.toEqual({
      available: {
        email: true,
        password: true,
        recoveryKey: true,
        wallet: false,
      },
      enrollment: "reverification_required",
      hasPasskey: true,
      hasPassword: true,
      passkeyReverified: false,
      proofs: ["password"],
      signedInWithPasskey: false,
    });
  });

  it("tells the page when a passkey, not a recovery, allows a new one", async () => {
    await addSettledPassword(userId);
    await createVaultWithVerifier(userId);

    await expect(
      account(
        userId,
        await passkeySignIn(authenticator, true)
      ).recoveryOptions()
    ).resolves.toMatchObject({
      enrollment: "allowed",
      passkeyReverified: true,
      proofs: [],
      signedInWithPasskey: true,
    });
    await expect(
      account(
        userId,
        await passkeySignIn(authenticator, false)
      ).recoveryOptions()
    ).resolves.toMatchObject({
      enrollment: "reverification_required",
      passkeyReverified: false,
      signedInWithPasskey: true,
    });
  });

  it("tells the page an account recovery allows a new passkey", async () => {
    await addSettledPassword(userId);
    const { verifier } = await createVaultWithVerifier(userId);
    const session = await sessionSignedInWith(userId, "opaque");
    await proveRecoveryKey(session, verifier);

    await expect(
      account(userId, session).recoveryOptions()
    ).resolves.toMatchObject({
      enrollment: "allowed",
      passkeyReverified: false,
      proofs: ["recovery_key", "password"],
      signedInWithPasskey: false,
    });
  });
});

describe("confirming a wallet in the session", () => {
  let userId: string;
  let wallet: Wallet;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser({ email: "owner@example.com" });
    wallet = await linkWallet(userId);
  });

  async function sessionContext(sessionId: string) {
    const row = await db
      .select({ loginMethod: authenticationContexts.loginMethod })
      .from(sessions)
      .innerJoin(
        authenticationContexts,
        eq(authenticationContexts.id, sessions.authContextId)
      )
      .where(eq(sessions.id, sessionId))
      .get();
    return row?.loginMethod;
  }

  async function sessionCount() {
    const rows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .all();
    return rows.length;
  }

  it("records a wallet sign-in on this session without starting another", async () => {
    const session = await sessionSignedInWith(userId, "opaque");

    const response = await confirmWallet(session, wallet);

    expect(response.status).toBe(200);
    expect(await sessionContext(session.sessionId)).toBe("eip712");
    expect(await sessionCount()).toBe(1);
  });

  it("refuses a wallet the account does not hold", async () => {
    const session = await sessionSignedInWith(userId, "opaque");
    const stranger = privateKeyToAccount(generatePrivateKey());

    expect(await refusal(await confirmWallet(session, stranger))).toEqual({
      status: 400,
      code: "WALLET_NOT_LINKED",
    });
    expect(await sessionContext(session.sessionId)).toBe("opaque");
  });

  it("refuses a request without a session", async () => {
    const response = await post("/wallet/siwe/verify/challenge", {
      address: wallet.address,
      chainId: 1,
    });

    expect(response.status).toBe(401);
  });

  it("does not take a signature made to sign in", async () => {
    const session = await sessionSignedInWith(userId, "opaque");
    const challenge = await post("/sign-in/siwe/challenge", {
      address: wallet.address,
      chainId: 1,
    });
    const { message } = (await challenge.json()) as { message: string };

    const response = await post(
      "/wallet/siwe/verify/complete",
      { message, signature: await wallet.signMessage({ message }) },
      session.cookie
    );

    expect(response.status).toBe(401);
    expect(await sessionContext(session.sessionId)).toBe("opaque");
  });
});
