import { beforeEach, describe, expect, it } from "vitest";

import { getUserCreatedAt } from "@/lib/db/queries/auth";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

describe("auth queries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns createdAt for an existing user", async () => {
    const createdAt = new Date("2025-01-01T00:00:00Z").toISOString();
    const userId = await createTestUser({ createdAt, updatedAt: createdAt });

    await expect(getUserCreatedAt(userId)).resolves.toBe(createdAt);
  });
});
