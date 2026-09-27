import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTrpcContext } from "@/lib/trpc/server";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

const INTERNAL_TOKEN = vi.hoisted(() => {
  const token = "internal-service-token-with-32-characters!";
  process.env.INTERNAL_SERVICE_TOKEN = token;
  return token;
});

describe("tRPC context", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("never builds a user session from the internal service token", async () => {
    const userId = await createTestUser();

    const context = await createTrpcContext({
      req: new Request("http://localhost:3000/api/trpc/account.get", {
        headers: {
          "x-zentity-internal-token": INTERNAL_TOKEN,
          "x-zentity-user-id": userId,
        },
      }),
    });

    expect(context.session).toBeNull();
  });
});
