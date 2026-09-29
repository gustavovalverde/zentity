import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/auth-config";
import { db } from "@/lib/db/connection";
import { accounts, verifications } from "@/lib/db/schema/auth";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

const VERIFY_URL = "http://localhost:3000/api/auth/magic-link/verify";

async function seedMagicLink(email: string): Promise<string> {
  const token = crypto.randomUUID();
  await db
    .insert(verifications)
    .values({
      id: crypto.randomUUID(),
      identifier: token,
      value: JSON.stringify({ email }),
      expiresAt: new Date(Date.now() + 300_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  return token;
}

async function seedAccount(userId: string, providerId: string) {
  await db
    .insert(accounts)
    .values({
      id: crypto.randomUUID(),
      accountId: crypto.randomUUID(),
      providerId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
}

function verifyMagicLink(token: string) {
  return auth.handler(
    new Request(`${VERIFY_URL}?token=${token}&callbackURL=%2Fdashboard`, {
      method: "GET",
      redirect: "manual",
    })
  );
}

describe("magic-link verification", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each([
    "opaque",
    "eip712",
  ])("keeps the %s credential of a user with an unverified email", async (providerId) => {
    const email = `${providerId}-${crypto.randomUUID()}@example.com`;
    const userId = await createTestUser({ email, emailVerified: false });
    await seedAccount(userId, providerId);
    const token = await seedMagicLink(email);

    const response = await verifyMagicLink(token);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("error")).toBe("email_unverified");
    const remaining = await db
      .select({ providerId: accounts.providerId })
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .all();
    expect(remaining).toEqual([{ providerId }]);
  });

  it("signs in a user whose email is verified", async () => {
    const email = `verified-${crypto.randomUUID()}@example.com`;
    const userId = await createTestUser({ email, emailVerified: true });
    await seedAccount(userId, "opaque");
    const token = await seedMagicLink(email);

    const response = await verifyMagicLink(token);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/dashboard");
    expect(response.headers.get("set-cookie")).toContain("session_token");
  });
});
