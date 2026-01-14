import crypto from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { accounts, users } from "@/lib/db/schema/auth";

function nowIso() {
  return new Date().toISOString();
}

function nameFromEmail(email: string) {
  const [local] = email.split("@");
  return local?.trim() || "demo";
}

export async function ensureDemoUser(email: string, password: string) {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get();

  const now = nowIso();
  const userId = existing?.id ?? crypto.randomUUID();

  if (!existing) {
    await db
      .insert(users)
      .values({
        id: userId,
        email,
        name: nameFromEmail(email),
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const credentialAccount = await db
    .select({ id: accounts.id, password: accounts.password })
    .from(accounts)
    .where(
      and(eq(accounts.userId, userId), eq(accounts.providerId, "credential"))
    )
    .get();

  if (!credentialAccount) {
    const hash = await hashPassword(password);
    await db
      .insert(accounts)
      .values({
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: hash,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  } else if (!credentialAccount.password) {
    const hash = await hashPassword(password);
    await db
      .update(accounts)
      .set({ password: hash, updatedAt: now })
      .where(eq(accounts.id, credentialAccount.id))
      .run();
  }

  return { userId };
}
