import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { hashCibaAuthReqId } from "@/lib/auth/oidc/ciba-auth-req";
import { db } from "@/lib/db/connection";
import { rejectPendingCibaRequestsForUser } from "@/lib/db/queries/ciba";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaRequest,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";

const CLIENT_ID = "ciba-logout-client";

async function createClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: CLIENT_ID,
      name: "CIBA Logout Client",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
    })
    .run();
}

let userId: string;

describe("rejectPendingCibaRequestsForUser", () => {
  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
  });

  it("rejects the user's pending CIBA requests", async () => {
    const authReqId = crypto.randomUUID();
    await createClient();
    await db
      .insert(cibaRequests)
      .values({
        authReqId,
        clientId: CLIENT_ID,
        userId,
        scope: "openid",
        status: "pending",
        expiresAt: new Date(Date.now() + 300_000),
      })
      .run();

    await rejectPendingCibaRequestsForUser(userId);

    const row = await db
      .select({ status: cibaRequests.status })
      .from(cibaRequests)
      .where(eq(cibaRequests.authReqId, authReqId))
      .get();
    expect(row?.status).toBe("rejected");
  });

  it("leaves requests that are no longer pending alone", async () => {
    await createClient();
    const { authReqId: approvedId } = await createTestCibaRequest({
      clientId: CLIENT_ID,
      userId,
      status: "approved",
    });

    await rejectPendingCibaRequestsForUser(userId);

    const row = await db
      .select({ status: cibaRequests.status })
      .from(cibaRequests)
      .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(approvedId)))
      .get();
    expect(row?.status).toBe("approved");
  });
});
