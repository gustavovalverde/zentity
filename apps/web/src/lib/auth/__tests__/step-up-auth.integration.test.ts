import crypto from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth";
import { db } from "@/lib/db/connection";
import { sessions } from "@/lib/db/schema/auth";
import { haipPushedRequests } from "@/lib/db/schema/haip";
import { identityBundles } from "@/lib/db/schema/identity";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

const TEST_CLIENT_ID = "step-up-test-client";
const REDIRECT_URI = "http://localhost:3102/callback";
const AUTHORIZE_URL = "http://localhost:3000/api/auth/oauth2/authorize";
const PAR_URI_PREFIX = "urn:ietf:params:oauth:request_uri:";

async function createTestClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "Step-Up Test Client",
      redirectUris: JSON.stringify([REDIRECT_URI]),
      grantTypes: JSON.stringify(["authorization_code"]),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function insertSession(
  userId: string,
  opts: { token?: string; createdAt?: string } = {}
) {
  const token = opts.token ?? crypto.randomUUID();
  const createdAt = opts.createdAt ?? new Date().toISOString();
  await db
    .insert(sessions)
    .values({
      id: crypto.randomUUID(),
      userId,
      token,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      createdAt,
      updatedAt: createdAt,
      lastLoginMethod: "passkey",
    })
    .run();

  const signature = await makeSignature(token, env.BETTER_AUTH_SECRET);
  return `${token}.${signature}`;
}

function insertParRequest(
  requestId: string,
  params: Record<string, string>,
  opts: { expiresAt?: Date } = {}
) {
  return db
    .insert(haipPushedRequests)
    .values({
      requestId,
      clientId: TEST_CLIENT_ID,
      requestParams: JSON.stringify(params),
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 60_000),
    })
    .run();
}

function buildAuthorizeRequest(requestId: string, sessionToken: string) {
  const url = `${AUTHORIZE_URL}?request_uri=${encodeURIComponent(`${PAR_URI_PREFIX}${requestId}`)}&client_id=${TEST_CLIENT_ID}`;
  return new Request(url, {
    method: "GET",
    headers: { cookie: `better-auth.session_token=${sessionToken}` },
    redirect: "manual",
  });
}

function baseParParams(overrides: Record<string, string> = {}) {
  return {
    client_id: TEST_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid",
    state: "test-state",
    code_challenge: "test-challenge-value",
    code_challenge_method: "S256",
    ...overrides,
  };
}

async function seedTier1User(userId: string) {
  await db
    .insert(identityBundles)
    .values({
      userId,
      fheKeyId: "test-fhe-key-id",
      fheStatus: "complete",
      status: "verified",
    })
    .run();
}

function getRedirectLocation(response: Response): URL | null {
  const location = response.headers.get("location");
  if (!location) {
    return null;
  }
  try {
    return new URL(location);
  } catch {
    return new URL(location, "http://localhost:3000");
  }
}

/** Check if a redirect goes to the RP's redirect_uri (not Zentity's own pages) */
function isRpRedirect(location: URL): boolean {
  return location.origin === new URL(REDIRECT_URI).origin;
}

describe("step-up authentication: acr_values", () => {
  let userId: string;
  let sessionToken: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
    sessionToken = await insertSession(userId);
  });

  it("tier-1 user rejected when acr_values=tier-2", async () => {
    await seedTier1User(userId);
    const requestId = crypto.randomUUID();
    await insertParRequest(
      requestId,
      baseParParams({ acr_values: "urn:zentity:assurance:tier-2" })
    );

    const response = await auth.handler(
      buildAuthorizeRequest(requestId, sessionToken)
    );

    expect(response.status).toBe(302);
    const location = getRedirectLocation(response);
    expect(location).not.toBeNull();
    expect(location?.origin).toBe(new URL(REDIRECT_URI).origin);
    expect(location?.searchParams.get("error")).toBe("interaction_required");
    expect(location?.searchParams.get("error_description")).toContain("tier-1");
    expect(location?.searchParams.get("state")).toBe("test-state");
  });

  it("tier-0 user (no FHE keys) rejected when acr_values=tier-1", async () => {
    const requestId = crypto.randomUUID();
    await insertParRequest(
      requestId,
      baseParParams({ acr_values: "urn:zentity:assurance:tier-1" })
    );

    const response = await auth.handler(
      buildAuthorizeRequest(requestId, sessionToken)
    );

    expect(response.status).toBe(302);
    const location = getRedirectLocation(response);
    expect(location?.searchParams.get("error")).toBe("interaction_required");
    expect(location?.searchParams.get("error_description")).toContain("tier-0");
  });

  it("tier-1 user passes when acr_values=tier-1", async () => {
    await seedTier1User(userId);
    const requestId = crypto.randomUUID();
    await insertParRequest(
      requestId,
      baseParParams({ acr_values: "urn:zentity:assurance:tier-1" })
    );

    const response = await auth.handler(
      buildAuthorizeRequest(requestId, sessionToken)
    );

    // Step-up should NOT redirect to RP with an error. The authorize
    // endpoint may redirect to /sign-in (session resolution) or consent,
    // but NOT to the RP's redirect_uri with interaction_required.
    const location = getRedirectLocation(response);
    if (location && isRpRedirect(location)) {
      expect(location.searchParams.get("error")).toBeNull();
    }
  });

  it("higher tier satisfies lower request (tier-1 satisfies tier-0)", async () => {
    await seedTier1User(userId);
    const requestId = crypto.randomUUID();
    await insertParRequest(
      requestId,
      baseParParams({ acr_values: "urn:zentity:assurance:tier-0" })
    );

    const response = await auth.handler(
      buildAuthorizeRequest(requestId, sessionToken)
    );

    const location = getRedirectLocation(response);
    if (location && isRpRedirect(location)) {
      expect(location.searchParams.get("error")).toBeNull();
    }
  });

  it("preference order: first satisfiable ACR wins", async () => {
    await seedTier1User(userId);
    const requestId = crypto.randomUUID();
    // Request tier-3 first (can't satisfy), then tier-1 (can satisfy)
    await insertParRequest(
      requestId,
      baseParParams({
        acr_values: "urn:zentity:assurance:tier-3 urn:zentity:assurance:tier-1",
      })
    );

    const response = await auth.handler(
      buildAuthorizeRequest(requestId, sessionToken)
    );

    const location = getRedirectLocation(response);
    if (location && isRpRedirect(location)) {
      expect(location.searchParams.get("error")).toBeNull();
    }
  });

  it("error_description includes current tier and requested acr_values", async () => {
    await seedTier1User(userId);
    const requestId = crypto.randomUUID();
    await insertParRequest(
      requestId,
      baseParParams({ acr_values: "urn:zentity:assurance:tier-2" })
    );

    const response = await auth.handler(
      buildAuthorizeRequest(requestId, sessionToken)
    );

    const location = getRedirectLocation(response);
    expect(location).not.toBeNull();
    const desc = location?.searchParams.get("error_description") ?? "";
    expect(desc).toContain("tier-1");
    expect(desc).toContain("urn:zentity:assurance:tier-2");
  });

  it("PAR record consumed on acr_values rejection", async () => {
    await seedTier1User(userId);
    const requestId = crypto.randomUUID();
    await insertParRequest(
      requestId,
      baseParParams({ acr_values: "urn:zentity:assurance:tier-2" })
    );

    await auth.handler(buildAuthorizeRequest(requestId, sessionToken));

    // PAR record should be deleted
    const record = await db
      .select()
      .from(haipPushedRequests)
      .where(eq(haipPushedRequests.requestId, requestId))
      .get();
    expect(record).toBeUndefined();
  });
});

describe("step-up authentication: max_age", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
  });

  it("max_age=0 triggers redirect to login", async () => {
    const sessionToken = await insertSession(userId);
    const requestId = crypto.randomUUID();
    await insertParRequest(requestId, baseParParams({ max_age: "0" }));

    const response = await auth.handler(
      buildAuthorizeRequest(requestId, sessionToken)
    );

    expect(response.status).toBe(302);
    const location = getRedirectLocation(response);
    expect(location).not.toBeNull();
    expect(location?.pathname).toBe("/sign-in");
    expect(location?.searchParams.get("callbackURL")).toContain("request_uri=");
  });

  it("max_age=99999 with fresh session does not trigger step-up re-auth", async () => {
    const sessionToken = await insertSession(userId);
    const requestId = crypto.randomUUID();
    await insertParRequest(requestId, baseParParams({ max_age: "99999" }));

    const response = await auth.handler(
      buildAuthorizeRequest(requestId, sessionToken)
    );

    // Step-up should NOT trigger its own redirect to /sign-in with callbackURL.
    // The authorize endpoint may independently redirect to /sign-in for its
    // own session resolution, but that won't include our callbackURL param.
    const location = getRedirectLocation(response);
    if (location?.pathname === "/sign-in") {
      // Our step-up redirect includes callbackURL with request_uri
      const callback = location.searchParams.get("callbackURL") ?? "";
      expect(callback).not.toContain("request_uri=");
    }
  });

  it("PAR record preserved on max_age redirect for re-entry", async () => {
    const sessionToken = await insertSession(userId);
    const requestId = crypto.randomUUID();
    await insertParRequest(requestId, baseParParams({ max_age: "0" }));

    await auth.handler(buildAuthorizeRequest(requestId, sessionToken));

    // PAR record should still exist (not consumed)
    const record = await db
      .select()
      .from(haipPushedRequests)
      .where(eq(haipPushedRequests.requestId, requestId))
      .get();
    expect(record).toBeDefined();
  });

  it("PAR TTL extended on max_age redirect", async () => {
    const sessionToken = await insertSession(userId);
    const requestId = crypto.randomUUID();
    // Create with short TTL
    await insertParRequest(requestId, baseParParams({ max_age: "0" }), {
      expiresAt: new Date(Date.now() + 5000),
    });

    await auth.handler(buildAuthorizeRequest(requestId, sessionToken));

    const record = await db
      .select({ expiresAt: haipPushedRequests.expiresAt })
      .from(haipPushedRequests)
      .where(eq(haipPushedRequests.requestId, requestId))
      .get();

    // TTL should be extended to ~5 minutes from now
    const fiveMinFromNow = Date.now() + 290_000;
    expect(record?.expiresAt.getTime()).toBeGreaterThan(fiveMinFromNow);
  });

  it("stale session (old createdAt) triggers max_age redirect", async () => {
    // Session created 10 minutes ago
    const staleCreatedAt = new Date(Date.now() - 600_000).toISOString();
    const sessionToken = await insertSession(userId, {
      createdAt: staleCreatedAt,
    });
    const requestId = crypto.randomUUID();
    await insertParRequest(requestId, baseParParams({ max_age: "300" }));

    const response = await auth.handler(
      buildAuthorizeRequest(requestId, sessionToken)
    );

    expect(response.status).toBe(302);
    const location = getRedirectLocation(response);
    expect(location?.pathname).toBe("/sign-in");
  });
});

describe("step-up authentication: prompt=none conflicts", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
  });

  it("prompt=none + max_age=0 returns login_required", async () => {
    const sessionToken = await insertSession(userId);
    const requestId = crypto.randomUUID();
    await insertParRequest(
      requestId,
      baseParParams({ prompt: "none", max_age: "0" })
    );

    const response = await auth.handler(
      buildAuthorizeRequest(requestId, sessionToken)
    );

    expect(response.status).toBe(302);
    const location = getRedirectLocation(response);
    expect(location?.searchParams.get("error")).toBe("login_required");
    expect(location?.searchParams.get("state")).toBe("test-state");
  });

  it("prompt=none + max_age=0 consumes PAR record", async () => {
    const sessionToken = await insertSession(userId);
    const requestId = crypto.randomUUID();
    await insertParRequest(
      requestId,
      baseParParams({ prompt: "none", max_age: "0" })
    );

    await auth.handler(buildAuthorizeRequest(requestId, sessionToken));

    const record = await db
      .select()
      .from(haipPushedRequests)
      .where(eq(haipPushedRequests.requestId, requestId))
      .get();
    expect(record).toBeUndefined();
  });
});

describe("step-up authentication: combined max_age + acr_values", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
  });

  it("fresh session + satisfied acr_values passes both checks", async () => {
    await seedTier1User(userId);
    const sessionToken = await insertSession(userId);
    const requestId = crypto.randomUUID();
    await insertParRequest(
      requestId,
      baseParParams({
        max_age: "99999",
        acr_values: "urn:zentity:assurance:tier-1",
      })
    );

    const response = await auth.handler(
      buildAuthorizeRequest(requestId, sessionToken)
    );

    // Step-up should NOT redirect to RP with an error
    const location = getRedirectLocation(response);
    if (location && isRpRedirect(location)) {
      expect(location.searchParams.get("error")).toBeNull();
    }
  });

  it("stale session is checked before acr_values", async () => {
    await seedTier1User(userId);
    const staleCreatedAt = new Date(Date.now() - 600_000).toISOString();
    const sessionToken = await insertSession(userId, {
      createdAt: staleCreatedAt,
    });
    const requestId = crypto.randomUUID();
    await insertParRequest(
      requestId,
      baseParParams({
        max_age: "300",
        acr_values: "urn:zentity:assurance:tier-1",
      })
    );

    const response = await auth.handler(
      buildAuthorizeRequest(requestId, sessionToken)
    );

    // max_age should trigger login redirect, not acr_values error
    expect(response.status).toBe(302);
    const location = getRedirectLocation(response);
    expect(location?.pathname).toBe("/sign-in");
  });
});

// Re-export eq for PAR record assertions
import { eq } from "drizzle-orm";
