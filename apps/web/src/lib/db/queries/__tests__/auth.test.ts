import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import {
  deleteUserById,
  getUserCreatedAt,
  updateUserName,
} from "@/lib/db/queries/auth";
import { users } from "@/lib/db/schema";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

describe("auth queries", () => {
  beforeEach(() => {
    resetDatabase();
  });

  it("returns createdAt for an existing user", () => {
    const createdAt = new Date("2025-01-01T00:00:00Z").toISOString();
    const userId = createTestUser({ createdAt, updatedAt: createdAt });

    expect(getUserCreatedAt(userId)).toBe(createdAt);
  });

  it("updates user display name", () => {
    const userId = createTestUser({ name: "Original" });

    updateUserName(userId, "Updated");

    const row = db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    expect(row?.name).toBe("Updated");
  });

  it("deletes user by id", () => {
    const userId = createTestUser();

    deleteUserById(userId);

    const row = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    expect(row).toBeUndefined();
  });
});
