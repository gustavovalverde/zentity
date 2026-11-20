import crypto from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import {
  createSessionAuthenticationContext,
  deleteUnreferencedAuthenticationContext,
  getAuthenticationStateBySessionId,
} from "@/lib/auth/auth-context";
import { db } from "@/lib/db/connection";
import { authenticationContexts, sessions } from "@/lib/db/schema/auth";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  createTestAuthContext,
  createTestCibaRequest,
  createTestUser,
  findStoredOpaqueAccessToken,
  resetDatabase,
  TEST_CIBA_CLIENT_SECRET,
  testCibaClientCredentials,
} from "@/test-utils/db-test-utils";
import { postTokenWithDpop } from "@/test-utils/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";

async function insertSession(userId: string, createdAt: string) {
  const sessionId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 86_400_000;
  // Bind createdAt/updatedAt raw: a finite numeric string lands as an integer,
  // anything else (e.g. "not-a-timestamp") lands as text in the integer column,
  // reproducing a corrupt row so the finite-timestamp guard can be exercised.
  const numeric = Number(createdAt);
  const rawCreatedAt = Number.isFinite(numeric) ? numeric : createdAt;

  await db.run(
    sql`INSERT INTO session (id, "userId", token, "createdAt", "updatedAt", "expiresAt")
        VALUES (${sessionId}, ${userId}, ${token}, ${rawCreatedAt}, ${rawCreatedAt}, ${expiresAt})`
  );

  return sessionId;
}

describe("session-backed authentication contexts", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("uses the persisted session createdAt as auth_time", async () => {
    const userId = await createTestUser();
    const createdAt = "1774389934087.0";
    const sessionId = await insertSession(userId, createdAt);

    const auth = await createSessionAuthenticationContext({
      userId,
      sessionId,
      loginMethod: "passkey",
      sourceKind: "better_auth",
    });

    expect(auth.authenticatedAt).toBe(Math.floor(Number(createdAt) / 1000));

    const persistedSession = await db
      .select({ authContextId: sessions.authContextId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1)
      .get();

    expect(persistedSession?.authContextId).toBe(auth.id);
  });

  it("is idempotent when the session is already bound", async () => {
    const userId = await createTestUser();
    const sessionId = await insertSession(userId, "1774389934087.0");

    const first = await createSessionAuthenticationContext({
      userId,
      sessionId,
      loginMethod: "opaque",
      sourceKind: "better_auth",
    });

    const second = await createSessionAuthenticationContext({
      userId,
      sessionId,
      loginMethod: "opaque",
      sourceKind: "better_auth",
    });

    expect(second).toEqual(first);
    expect(await getAuthenticationStateBySessionId(sessionId)).toEqual(first);

    const rows = await db
      .select({ id: authenticationContexts.id })
      .from(authenticationContexts);
    expect(rows).toHaveLength(1);
  });

  it("rejects anonymous provenance for bootstrap sessions", async () => {
    const userId = await createTestUser();
    const sessionId = await insertSession(userId, "1774389934087.0");

    expect(() =>
      createSessionAuthenticationContext({
        userId,
        sessionId,
        loginMethod: "anonymous" as unknown,
        sourceKind: "better_auth",
      })
    ).toThrow("Anonymous sessions cannot create authentication contexts");

    const rows = await db
      .select({ id: authenticationContexts.id })
      .from(authenticationContexts);
    expect(rows).toHaveLength(0);
  });

  it("fails before insert when the persisted session timestamp is invalid", async () => {
    const userId = await createTestUser();
    const sessionId = await insertSession(userId, "not-a-timestamp");

    await expect(
      createSessionAuthenticationContext({
        userId,
        sessionId,
        loginMethod: "passkey",
        sourceKind: "better_auth",
      })
    ).rejects.toThrow(
      `Invalid session ${sessionId} createdAt: expected a finite timestamp`
    );

    const rows = await db
      .select({ id: authenticationContexts.id })
      .from(authenticationContexts);
    expect(rows).toHaveLength(0);
  });
});

describe("deleteUnreferencedAuthenticationContext", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function contextExists(id: string): Promise<boolean> {
    const row = await db
      .select({ id: authenticationContexts.id })
      .from(authenticationContexts)
      .where(eq(authenticationContexts.id, id))
      .get();
    return row !== undefined;
  }

  it("deletes a context nothing refers to", async () => {
    const userId = await createTestUser();
    const authContextId = await createTestAuthContext(userId);

    await deleteUnreferencedAuthenticationContext(authContextId);

    expect(await contextExists(authContextId)).toBe(false);
  });

  it("keeps a context that a CIBA request still refers to", async () => {
    const userId = await createTestUser();
    await db
      .insert(oauthClients)
      .values({
        clientId: "test-client",
        redirectUris: JSON.stringify(["http://localhost/callback"]),
      })
      .run();
    const { authContextId } = await createTestCibaRequest({
      clientId: "test-client",
      userId,
      status: "approved",
    });
    if (!authContextId) {
      throw new Error("expected an approval context");
    }

    await deleteUnreferencedAuthenticationContext(authContextId);

    expect(await contextExists(authContextId)).toBe(true);
  });
});

// R10: an authentication context id is a browser-session correlator, so no
// token carries it; the server finds a token's context on its own records.
describe("authentication context ids in tokens", () => {
  const clientId = "auth-context-token-client";

  beforeEach(async () => {
    await resetDatabase();
    await db
      .insert(oauthClients)
      .values({
        clientId,
        name: "Auth Context Client",
        redirectUris: JSON.stringify(["http://localhost/callback"]),
        grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
        ...testCibaClientCredentials,
        subjectType: "pairwise",
        sectorIdentifier: `client/${clientId}`,
        metadata: JSON.stringify({ backchannel_token_delivery_mode: "poll" }),
      })
      .run();
  });

  it.each([
    ["a JWT access token", [env.MCP_PUBLIC_URL]],
    ["an opaque access token", undefined],
  ])("are not in the ID token or %s", async (_case, resources) => {
    const userId = await createTestUser();
    const { authReqId, authContextId } = await createTestCibaRequest({
      clientId,
      userId,
      status: "approved",
      ...(resources ? { resources: JSON.stringify(resources) } : {}),
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      client_secret: TEST_CIBA_CLIENT_SECRET,
      auth_req_id: authReqId,
      client_id: clientId,
    });

    expect(status).toBe(200);
    const accessToken = json.access_token as string;
    const accessClaims =
      accessToken.split(".").length === 3
        ? decodeJwt(accessToken)
        : (await findStoredOpaqueAccessToken(accessToken))?.accessTokenClaims;
    const idToken = decodeJwt(json.id_token as string);
    for (const artifact of [accessClaims, idToken, json]) {
      expect(artifact).not.toHaveProperty("zentity_auth_context_id");
      expect(JSON.stringify(artifact)).not.toContain(authContextId);
    }
    // The ID token still states the approval's assurance.
    expect(idToken.zentity_assurance).toEqual(expect.any(Object));
  });
});
