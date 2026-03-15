import type { Session } from "@/lib/auth/auth";

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { agentBoundariesRouter } from "@/lib/trpc/routers/agent-boundaries";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

const TEST_CLIENT_ID = "boundary-router-test";

function mockSession(userId: string) {
  return {
    user: { id: userId },
    session: { id: "test-session", lastLoginMethod: "passkey" },
  } as unknown as Session;
}

function createCaller(userId: string) {
  return agentBoundariesRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    session: mockSession(userId),
    requestId: "test-request-id",
    flowId: null,
    flowIdSource: "none",
  });
}

async function createTestClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "Router Test Agent",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify(["urn:openid:params:grant-type:ciba"]),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

describe("agentBoundaries router", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
  });

  it("creates and lists a purchase boundary", async () => {
    const caller = createCaller(userId);

    await caller.create({
      clientId: TEST_CLIENT_ID,
      boundaryType: "purchase",
      config: {
        maxAmount: 50,
        currency: "USD",
        dailyCap: 200,
        cooldownMinutes: 5,
      },
    });

    const list = await caller.list();
    expect(list).toHaveLength(1);
    expect(list[0].boundaryType).toBe("purchase");
    expect(list[0].config.maxAmount).toBe(50);
    expect(list[0].clientName).toBe("Router Test Agent");
  });

  it("updates a boundary config", async () => {
    const caller = createCaller(userId);

    await caller.create({
      clientId: TEST_CLIENT_ID,
      boundaryType: "purchase",
      config: {
        maxAmount: 50,
        currency: "USD",
        dailyCap: 200,
        cooldownMinutes: 0,
      },
    });

    const [boundary] = await caller.list();

    await caller.update({
      id: boundary.id,
      config: {
        maxAmount: 100,
        currency: "USD",
        dailyCap: 500,
        cooldownMinutes: 10,
      },
    });

    const list = await caller.list();
    expect(list[0].config.maxAmount).toBe(100);
  });

  it("deletes a boundary", async () => {
    const caller = createCaller(userId);

    await caller.create({
      clientId: TEST_CLIENT_ID,
      boundaryType: "scope",
      config: { allowedScopes: ["proof:age"] },
    });

    const [boundary] = await caller.list();
    await caller.delete({ id: boundary.id });

    const list = await caller.list();
    expect(list).toHaveLength(0);
  });

  it("rejects scope boundary containing identity scopes", async () => {
    const caller = createCaller(userId);

    await expect(
      caller.create({
        clientId: TEST_CLIENT_ID,
        boundaryType: "scope",
        config: { allowedScopes: ["identity.name", "proof:age"] },
      })
    ).rejects.toThrow();
  });

  it("scopes boundaries to the authenticated user", async () => {
    const caller = createCaller(userId);
    const otherUserId = await createTestUser({ email: "other@test.com" });
    const otherCaller = createCaller(otherUserId);

    await caller.create({
      clientId: TEST_CLIENT_ID,
      boundaryType: "purchase",
      config: {
        maxAmount: 50,
        currency: "USD",
        dailyCap: 200,
        cooldownMinutes: 0,
      },
    });

    const otherList = await otherCaller.list();
    expect(otherList).toHaveLength(0);
  });
});
