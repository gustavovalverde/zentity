import type { Session } from "@/lib/auth/auth-config";

import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/connection";
import { users, walletAddresses } from "@/lib/db/schema/auth";
import { signUpRouter } from "@/lib/trpc/routers/sign-up";
import {
  createTestSession,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import { TestAuthenticator } from "@/test-utils/webauthn-test-utils";

const mockSendEmail = vi.fn();

vi.mock("@/lib/email/transport", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";

async function caller(userId: string) {
  const { sessionId } = await createTestSession(userId);
  return signUpRouter.createCaller({
    authContext: null,
    flowId: null,
    flowIdSource: "none",
    req: new Request("http://localhost/api/trpc"),
    requestId: "test-request-id",
    session: {
      user: { id: userId, email: `user-${userId}@example.com` },
      session: { id: sessionId },
    } as unknown as Session,
  });
}

function readUser(userId: string) {
  return db
    .select({
      email: users.email,
      emailVerified: users.emailVerified,
      isAnonymous: users.isAnonymous,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

async function linkSignedWallet(userId: string) {
  await db
    .insert(walletAddresses)
    .values({
      userId,
      address: getAddress(WALLET),
      chainId: 1,
      isPrimary: true,
    })
    .run();
}

function walletRows(userId: string) {
  return db
    .select({ address: walletAddresses.address })
    .from(walletAddresses)
    .where(eq(walletAddresses.userId, userId))
    .all();
}

describe("signUp.completeAccountCreation", () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSendEmail.mockResolvedValue("sent");
  });

  describe("on an account that finished sign-up", () => {
    let userId: string;
    const originalEmail = "owner@example.com";

    beforeEach(async () => {
      userId = await createTestUser({
        email: originalEmail,
        emailVerified: true,
      });
      await new TestAuthenticator().register(userId);
    });

    it("refuses to set a new email", async () => {
      const signUp = await caller(userId);

      await expect(
        signUp.completeAccountCreation({ email: "attacker@example.com" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await readUser(userId)).toMatchObject({
        email: originalEmail,
        emailVerified: true,
      });
    });

    it("refuses to link a wallet", async () => {
      const signUp = await caller(userId);

      await expect(
        signUp.completeAccountCreation({ wallet: { address: WALLET } })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await walletRows(userId)).toEqual([]);
      expect(await readUser(userId)).toMatchObject({ email: originalEmail });
    });
  });

  describe("on an anonymous account", () => {
    let userId: string;

    beforeEach(async () => {
      userId = await createTestUser({
        email: `${crypto.randomUUID()}@anon.zentity.app`,
        emailVerified: true,
      });
      await db
        .update(users)
        .set({ isAnonymous: true })
        .where(eq(users.id, userId))
        .run();
    });

    it("sets the email as unverified and sends the verification link", async () => {
      const signUp = await caller(userId);

      await signUp.completeAccountCreation({ email: "new@example.com" });

      expect(await readUser(userId)).toEqual({
        email: "new@example.com",
        emailVerified: false,
        isAnonymous: false,
      });
      await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalledOnce());
      const [message] = mockSendEmail.mock.calls[0] ?? [];
      expect(message).toMatchObject({ to: ["new@example.com"] });
      expect(message.text).toContain("/api/auth/verify-email?token=");
    });

    it("refuses a wallet the account never signed in with", async () => {
      const signUp = await caller(userId);

      await expect(
        signUp.completeAccountCreation({ wallet: { address: WALLET } })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await walletRows(userId)).toEqual([]);
      expect(await readUser(userId)).toMatchObject({ isAnonymous: true });
    });

    it("completes with the wallet its Sign-In with Ethereum sign-up linked", async () => {
      await linkSignedWallet(userId);
      const signUp = await caller(userId);

      await signUp.completeAccountCreation({ wallet: { address: WALLET } });

      expect(await readUser(userId)).toMatchObject({
        email: "12345678@wallet.zentity.app",
        isAnonymous: false,
      });
      expect(await walletRows(userId)).toHaveLength(1);
    });
  });
});
