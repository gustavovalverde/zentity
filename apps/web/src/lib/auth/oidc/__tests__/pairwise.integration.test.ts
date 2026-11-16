import type { Client } from "@libsql/client";

import crypto from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as registerClient } from "@/app/api/auth/oauth2/register/route";
import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { db } from "@/lib/db/connection";
import { deleteIncompleteSignup } from "@/lib/db/queries/auth";
import { sessions } from "@/lib/db/schema/auth";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients, pairwiseSubjects } from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaRequest,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import { postTokenWithDpop } from "@/test-utils/dpop-test-utils";

import {
  resolveSubForClient,
  resolveSubForClientId,
  resolveUserIdFromSub,
} from "../pairwise";

async function issueSubForUser(userId: string): Promise<string> {
  return await resolveSubForClient(userId, TEST_PAIRWISE_CLIENT);
}

const TEST_CLIENT_ID = "pairwise-test-client";
const TEST_REDIRECT_URI = "https://pairwise-rp.example.com/callback";
const TEST_PAIRWISE_CLIENT = {
  subjectType: "pairwise",
  sectorIdentifier: null,
  redirectUris: [TEST_REDIRECT_URI],
};
const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";

function getDbClient() {
  return db as typeof db & { $client: Pick<Client, "execute"> };
}

async function countDatabaseQueries(run: () => Promise<void>): Promise<number> {
  const client = getDbClient();
  const executeSpy = vi.spyOn(client.$client, "execute");

  try {
    await run();
    return executeSpy.mock.calls.length;
  } finally {
    executeSpy.mockRestore();
  }
}

async function createTestClient(
  overrides: Partial<typeof oauthClients.$inferInsert> = {}
) {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "Pairwise Test Client",
      redirectUris: JSON.stringify([TEST_REDIRECT_URI]),
      grantTypes: JSON.stringify(["authorization_code"]),
      tokenEndpointAuthMethod: "none",
      subjectType: "pairwise",
      ...overrides,
    })
    .run();
}

function createTestSession(userId: string) {
  const token = crypto.randomUUID();
  return db
    .insert(sessions)
    .values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "127.0.0.1",
      userAgent: "test",
    })
    .run()
    .then(() => token);
}

describe("pairwise subject resolution (integration)", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
  });

  describe("resolveUserIdFromSub", () => {
    it("resolves pairwise sub back to raw userId", async () => {
      await createTestClient();

      const pairwiseSub = await issueSubForUser(userId);

      const resolved = await resolveUserIdFromSub(pairwiseSub, TEST_CLIENT_ID);
      expect(resolved).toBe(userId);
    });

    it("returns sub directly for public clients", async () => {
      await createTestClient({ subjectType: "public" });

      const resolved = await resolveUserIdFromSub(userId, TEST_CLIENT_ID);
      expect(resolved).toBe(userId);
    });

    it("returns null for unknown client", async () => {
      const resolved = await resolveUserIdFromSub(userId, "nonexistent-client");
      expect(resolved).toBeNull();
    });

    it("returns null when no user matches the pairwise sub", async () => {
      await createTestClient();

      const resolved = await resolveUserIdFromSub(
        "definitely-not-a-valid-pairwise-sub",
        TEST_CLIENT_ID
      );
      expect(resolved).toBeNull();
    });

    it("finds the correct user among multiple users", async () => {
      await createTestClient();

      const user2 = await createTestUser({ email: "user2@example.com" });
      const user3 = await createTestUser({ email: "user3@example.com" });

      await issueSubForUser(userId);
      const pairwiseSubUser2 = await issueSubForUser(user2);
      await issueSubForUser(user3);

      const resolved = await resolveUserIdFromSub(
        pairwiseSubUser2,
        TEST_CLIENT_ID
      );
      expect(resolved).toBe(user2);
      expect(resolved).not.toBe(userId);
      expect(resolved).not.toBe(user3);
    });

    it("indexes the pairwise row atomically during issuance", async () => {
      await createTestClient();

      const pairwiseSub = await issueSubForUser(userId);

      const indexed = await db
        .select({
          subjectId: pairwiseSubjects.subjectId,
          subjectType: pairwiseSubjects.subjectType,
        })
        .from(pairwiseSubjects)
        .where(
          and(
            eq(pairwiseSubjects.sector, new URL(TEST_REDIRECT_URI).host),
            eq(pairwiseSubjects.sub, pairwiseSub)
          )
        )
        .limit(1)
        .get();

      expect(indexed).toEqual({
        subjectId: userId,
        subjectType: "user",
      });
    });

    it("uses a constant query count once the user pairwise row is indexed", async () => {
      await createTestClient();

      const pairwiseSub = await resolveSubForClient(
        userId,
        TEST_PAIRWISE_CLIENT
      );

      const queryCountWithOneUser = await countDatabaseQueries(async () => {
        await expect(
          resolveUserIdFromSub(pairwiseSub, TEST_CLIENT_ID)
        ).resolves.toBe(userId);
      });

      for (let index = 0; index < 20; index += 1) {
        await createTestUser({ email: `extra-user-${index}@example.com` });
      }

      const queryCountWithManyUsers = await countDatabaseQueries(async () => {
        await expect(
          resolveUserIdFromSub(pairwiseSub, TEST_CLIENT_ID)
        ).resolves.toBe(userId);
      });

      expect(queryCountWithManyUsers).toBe(queryCountWithOneUser);
    });

    it("removes pairwise rows when an incomplete signup is deleted", async () => {
      await createTestClient();

      const pairwiseSub = await resolveSubForClient(
        userId,
        TEST_PAIRWISE_CLIENT
      );

      const indexedBefore = await db
        .select({ sub: pairwiseSubjects.sub })
        .from(pairwiseSubjects)
        .where(eq(pairwiseSubjects.sub, pairwiseSub))
        .all();
      expect(indexedBefore).toHaveLength(1);

      await deleteIncompleteSignup(userId);

      const indexedAfter = await db
        .select({ sub: pairwiseSubjects.sub })
        .from(pairwiseSubjects)
        .where(eq(pairwiseSubjects.sub, pairwiseSub))
        .all();
      expect(indexedAfter).toHaveLength(0);
    });
  });

  describe("resolveSubForClient", () => {
    it("computes same pairwise sub as better-auth's derivation", async () => {
      await createTestClient();

      const sector = new URL(TEST_REDIRECT_URI).host;
      const betterAuthSub = await makeSignature(
        `${sector}.${userId}`,
        env.PAIRWISE_SECRET
      );

      const ourSub = await resolveSubForClient(userId, TEST_PAIRWISE_CLIENT);

      expect(ourSub).toBe(betterAuthSub);
    });
  });

  describe("pairwise sector of registered clients", () => {
    async function register(
      redirectUris: string[],
      extra: Record<string, unknown> = {}
    ) {
      const response = await registerClient(
        new Request("http://localhost:3000/api/auth/oauth2/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_name: "Sector Agent",
            redirect_uris: redirectUris,
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", CIBA_GRANT_TYPE],
            response_types: ["code"],
            backchannel_token_delivery_mode: "poll",
            ...extra,
          }),
        })
      );
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      };
    }

    async function storedSector(clientId: string) {
      const row = await db
        .select({ sectorIdentifier: oauthClients.sectorIdentifier })
        .from(oauthClients)
        .where(eq(oauthClients.clientId, clientId))
        .get();
      return row?.sectorIdentifier;
    }

    async function idTokenSub(clientId: string): Promise<string> {
      const { authReqId } = await createTestCibaRequest({
        clientId,
        userId,
        status: "approved",
      });
      const { status, json } = await postTokenWithDpop({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: clientId,
      });
      if (status !== 200) {
        throw new Error(`token request failed: ${JSON.stringify(json)}`);
      }
      return decodeJwt(json.id_token as string).sub as string;
    }

    it("gives loopback clients sharing a redirect URI different subjects", async () => {
      const redirectUri = "http://127.0.0.1/callback";
      const first = await register([redirectUri]);
      const second = await register([redirectUri]);
      const firstId = first.body.client_id as string;
      const secondId = second.body.client_id as string;

      expect(await storedSector(firstId)).toBe(`client/${firstId}`);
      expect(await storedSector(secondId)).toBe(`client/${secondId}`);

      const firstSub = await idTokenSub(firstId);
      const secondSub = await idTokenSub(secondId);
      expect(firstSub).not.toBe(secondSub);
      expect(firstSub).not.toBe(userId);
      // The provider's resolveSubjectIdentifier minted these ID tokens, so
      // Zentity's own derivation must land on the same values.
      expect(await resolveSubForClientId(userId, firstId)).toBe(firstSub);
      expect(await resolveSubForClientId(userId, secondId)).toBe(secondSub);
    });

    it("derives the provider's subject for an https client", async () => {
      const { body } = await register(["https://sector-rp.example/callback"]);
      const clientId = body.client_id as string;

      expect(await storedSector(clientId)).toBe("sector-rp.example");
      const sub = await idTokenSub(clientId);
      expect(sub).toBe(
        await makeSignature(`sector-rp.example.${userId}`, env.PAIRWISE_SECRET)
      );
      expect(await resolveSubForClientId(userId, clientId)).toBe(sub);
    });

    // Upstream ask U16 would accept this set, since its sector is the client's
    // own; flip the assertion when the provider stops refusing it.
    it("refuses a pairwise registration mixing loopback and https hosts", async () => {
      const { status, body } = await register(
        ["http://127.0.0.1:1234/cb", "https://example.com/cb"],
        { application_type: "native" }
      );

      expect({ status, body }).toEqual({
        status: 400,
        body: {
          error: "invalid_client_metadata",
          error_description:
            "pairwise clients with redirect_uris on different hosts require a sector_identifier_uri, which is not yet supported. All redirect_uris must share the same host.",
        },
      });
    });
  });

  describe("pairwise sector on client update", () => {
    const AUTH_BASE = "http://localhost:3000/api/auth";

    async function ownerCookie(ownerId: string): Promise<string> {
      const token = await createTestSession(ownerId);
      const signature = await makeSignature(token, env.BETTER_AUTH_SECRET);
      return `better-auth.session_token=${token}.${signature}`;
    }

    function postAuth(path: string, cookie: string, body: unknown) {
      return auth.handler(
        new Request(`${AUTH_BASE}${path}`, {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify(body),
        })
      );
    }

    async function registerOwned(cookie: string, redirectUri: string) {
      const response = await postAuth("/oauth2/register", cookie, {
        client_name: "Owned Client",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`registration failed: ${JSON.stringify(body)}`);
      }
      return body.client_id as string;
    }

    async function storedSector(clientId: string) {
      const row = await db
        .select({ sectorIdentifier: oauthClients.sectorIdentifier })
        .from(oauthClients)
        .where(eq(oauthClients.clientId, clientId))
        .get();
      return row?.sectorIdentifier;
    }

    const SECTOR_REFUSAL = {
      error: "invalid_client_metadata",
      error_description:
        "redirect_uris must keep the client's pairwise sector; register a new client for another host",
    };

    let attackerCookie: string;
    let rpClientId: string;
    let evilClientId: string;

    beforeEach(async () => {
      rpClientId = await registerOwned(
        await ownerCookie(await createTestUser()),
        "https://rp.example/cb"
      );
      attackerCookie = await ownerCookie(await createTestUser());
      evilClientId = await registerOwned(
        attackerCookie,
        "https://evil.example/cb"
      );
    });

    it("refuses an owner's redirect update into another relying party's sector", async () => {
      const response = await postAuth("/oauth2/update-client", attackerCookie, {
        client_id: evilClientId,
        update: { redirect_uris: ["https://rp.example/cb"] },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(SECTOR_REFUSAL);
      expect(await storedSector(evilClientId)).toBe("evil.example");
      expect(await resolveSubForClientId(userId, evilClientId)).not.toBe(
        await resolveSubForClientId(userId, rpClientId)
      );
    });

    it("refuses the admin update path the same way", async () => {
      await expect(
        auth.api.adminUpdateOAuthClient({
          body: {
            client_id: evilClientId,
            update: { redirect_uris: ["https://rp.example/cb"] },
          },
          headers: new Headers({ cookie: attackerCookie }),
        })
      ).rejects.toMatchObject({ body: SECTOR_REFUSAL });
      expect(await storedSector(evilClientId)).toBe("evil.example");
    });

    it("accepts a redirect update that keeps the sector", async () => {
      const response = await postAuth("/oauth2/update-client", attackerCookie, {
        client_id: evilClientId,
        update: {
          redirect_uris: [
            "https://evil.example/callback",
            "https://evil.example/cb",
          ],
        },
      });

      expect(response.status).toBe(200);
      expect(await storedSector(evilClientId)).toBe("evil.example");
    });
  });

  describe("end-session pairwise resolution", () => {
    it("session lookup uses raw userId after pairwise resolution", async () => {
      await createTestClient();
      const _sessionToken = await createTestSession(userId);

      const sessionsBefore = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .all();
      expect(sessionsBefore).toHaveLength(1);

      const pairwiseSub = await issueSubForUser(userId);
      expect(pairwiseSub).not.toBe(userId);

      const resolved = await resolveUserIdFromSub(pairwiseSub, TEST_CLIENT_ID);
      expect(resolved).toBe(userId);
    });
  });

  describe("CIBA revocation uses raw userId", () => {
    it("pending CIBA requests found by raw userId after pairwise resolution", async () => {
      await createTestClient();

      const authReqId = crypto.randomUUID();
      await db
        .insert(cibaRequests)
        .values({
          authReqId,
          clientId: TEST_CLIENT_ID,
          userId,
          scope: "openid",
          status: "pending",
          expiresAt: new Date(Date.now() + 300_000),
        })
        .run();

      const pairwiseSub = await issueSubForUser(userId);
      const rawUserId = await resolveUserIdFromSub(pairwiseSub, TEST_CLIENT_ID);
      expect(rawUserId).not.toBeNull();

      // CIBA request should be found by raw userId
      const pending = await db
        .select()
        .from(cibaRequests)
        .where(
          and(
            eq(cibaRequests.userId, rawUserId as string),
            eq(cibaRequests.status, "pending")
          )
        )
        .all();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.authReqId).toBe(authReqId);
    });
  });
});
