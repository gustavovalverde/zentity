import { eq, sql } from "drizzle-orm";

import { db } from "../connection";
import { users } from "../schema";

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
