import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import {
  deleteUserById,
  getUserCreatedAt,
  updateUserName,
} from "@/lib/db/queries/auth";
import { users } from "@/lib/db/schema/auth";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

describe("auth queries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns createdAt for an existing user", async () => {
    const createdAt = new Date("2025-01-01T00:00:00Z").toISOString();
    const userId = await createTestUser({ createdAt, updatedAt: createdAt });

    await expect(getUserCreatedAt(userId)).resolves.toBe(createdAt);
  });

  it("updates user display name", async () => {
    const userId = await createTestUser({ name: "Original" });

    await updateUserName(userId, "Updated");

    const row = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    expect(row?.name).toBe("Updated");
  });

  it("deletes user by id", async () => {
    const userId = await createTestUser();

    await deleteUserById(userId);

    const row = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    expect(row).toBeUndefined();
  });
});
