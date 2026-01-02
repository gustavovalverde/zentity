import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "../connection";
import { accounts, users } from "../schema/auth";

export function updateUserName(userId: string, displayName: string): void {
  db.update(users)
    .set({
      name: displayName,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(users.id, userId))
    .run();
}

export function getUserCreatedAt(userId: string): string | null {
  const row = db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  return row?.createdAt ?? null;
}

export function deleteUserById(userId: string): void {
  db.delete(users).where(eq(users.id, userId)).run();
}

/**
 * Check if a user has a credential account with a password set.
 * Users who signed up with passkey-only or OAuth won't have a password.
 */
export function userHasPassword(userId: string): boolean {
  const row = db
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
