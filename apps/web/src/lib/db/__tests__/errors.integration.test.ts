import { DrizzleQueryError } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { isUniqueConstraintError } from "@/lib/db/errors";
import { identityValidityEvents } from "@/lib/db/schema/identity";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

function validityEvent(userId: string, id: string) {
  return {
    id,
    userId,
    eventKind: "verified" as const,
    validityStatus: "verified" as const,
    source: "chain" as const,
    sourceNetwork: "test-network",
    sourceEventId: "0xtx:0",
  };
}

async function captureFailure(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new Error("expected the statement to fail");
}

describe("isUniqueConstraintError", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("detects a unique violation that Drizzle wrapped in DrizzleQueryError", async () => {
    const userId = await createTestUser();
    await db
      .insert(identityValidityEvents)
      .values(validityEvent(userId, "event-1"))
      .run();

    const error = await captureFailure(() =>
      db
        .insert(identityValidityEvents)
        .values(validityEvent(userId, "event-2"))
        .run()
    );

    // The top level is Drizzle's wrapper: no `code`, and a message that holds
    // only the SQL text. A check on the top-level error alone never matches.
    expect(error).toBeInstanceOf(DrizzleQueryError);
    expect("code" in error).toBe(false);
    expect(error.message).not.toContain("UNIQUE constraint failed");
    expect(isUniqueConstraintError(error)).toBe(true);
  });

  it("does not treat other constraint failures as unique violations", async () => {
    const error = await captureFailure(() =>
      db
        .insert(identityValidityEvents)
        .values(validityEvent("missing-user", "event-3"))
        .run()
    );

    expect(isUniqueConstraintError(error)).toBe(false);
  });

  it("returns false for values that are not errors", () => {
    expect(isUniqueConstraintError(null)).toBe(false);
    expect(isUniqueConstraintError("UNIQUE constraint failed")).toBe(false);
  });
});
