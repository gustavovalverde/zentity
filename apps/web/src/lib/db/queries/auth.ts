import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "../connection";
import { accounts, users } from "../schema/auth";

export async function getUserCreatedAt(userId: string): Promise<string | null> {
  const row = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  return row?.createdAt ?? null;
}

export async function deleteUserById(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId)).run();
}

/**
 * Check if a user has a credential account with a password set.
 * Users who signed up with passkey-only or OAuth won't have a password.
 */
export async function userHasPassword(userId: string): Promise<boolean> {
  const row = await db
    .select({ password: accounts.password })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, "credential"),
        isNotNull(accounts.password)
      )
    )
    .get();

  return !!row?.password && row.password.length > 0;
}
