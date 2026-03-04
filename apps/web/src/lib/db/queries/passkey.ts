import { eq, sql } from "drizzle-orm";

import { db } from "../connection";
import { passkeys } from "../schema/auth";

export async function hasPasskeyCredentials(userId: string): Promise<boolean> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .get();
  return (result?.count ?? 0) > 0;
}
