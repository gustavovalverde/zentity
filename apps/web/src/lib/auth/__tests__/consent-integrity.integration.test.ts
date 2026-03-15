import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { computeConsentHmac } from "@/lib/auth/oidc/consent-integrity";
import { db } from "@/lib/db/connection";
import { oauthClients, oauthConsents } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

async function createTestClient(clientId: string) {
  await db
    .insert(oauthClients)
    .values({
      id: crypto.randomUUID(),
      clientId,
      redirectUris: JSON.stringify(["http://localhost:3102/callback"]),
      name: `Test ${clientId}`,
    })
    .run();
}

async function insertConsent(
  userId: string,
  clientId: string,
  scopes: string[],
  scopeHmac: string | null = null,
  referenceId: string | null = null
) {
  const id = crypto.randomUUID();
  await db
    .insert(oauthConsents)
    .values({
      id,
      clientId,
      userId,
      referenceId,
      scopes: JSON.stringify(scopes),
      scopeHmac,
    })
    .run();
  return id;
}

function getConsent(userId: string, clientId: string) {
  return db
    .select()
    .from(oauthConsents)
    .where(
      and(
        eq(oauthConsents.userId, userId),
        eq(oauthConsents.clientId, clientId)
      )
    )
    .get();
}

describe("consent scope HMAC integrity", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("valid HMAC passes verification", async () => {
    const userId = await createTestUser();
    const clientId = "test-client-valid";
    await createTestClient(clientId);

    const scopes = ["openid", "profile"];
    const hmac = computeConsentHmac(
      env.BETTER_AUTH_SECRET,
      userId,
      clientId,
      null,
      scopes
    );
    await insertConsent(userId, clientId, scopes, hmac);

    const consent = await getConsent(userId, clientId);
    if (!consent) {
      throw new Error("consent not found");
    }
    expect(consent.scopeHmac).toBe(hmac);

    // Recompute and verify
    const parsed = JSON.parse(consent.scopes) as string[];
    const recomputed = computeConsentHmac(
      env.BETTER_AUTH_SECRET,
      userId,
      clientId,
      consent.referenceId,
      parsed
    );
    expect(recomputed).toBe(consent.scopeHmac);
  });

  it("detects scope tampering", async () => {
    const userId = await createTestUser();
    const clientId = "test-client-tamper";
    await createTestClient(clientId);

    const originalScopes = ["openid"];
    const hmac = computeConsentHmac(
      env.BETTER_AUTH_SECRET,
      userId,
      clientId,
      null,
      originalScopes
    );
    const consentId = await insertConsent(
      userId,
      clientId,
      originalScopes,
      hmac
    );

    // Tamper: inflate scopes in the DB
    await db
      .update(oauthConsents)
      .set({ scopes: JSON.stringify(["openid", "profile", "email"]) })
      .where(eq(oauthConsents.id, consentId))
      .run();

    const consent = await getConsent(userId, clientId);
    if (!consent) {
      throw new Error("consent not found");
    }
    const tamperedScopes = JSON.parse(consent.scopes) as string[];
    const recomputed = computeConsentHmac(
      env.BETTER_AUTH_SECRET,
      userId,
      clientId,
      consent.referenceId,
      tamperedScopes
    );

    expect(recomputed).not.toBe(consent.scopeHmac);
  });

  it("detects missing HMAC as invalid", async () => {
    const userId = await createTestUser();
    const clientId = "test-client-no-hmac";
    await createTestClient(clientId);

    await insertConsent(userId, clientId, ["openid"], null);

    const consent = await getConsent(userId, clientId);
    expect(consent?.scopeHmac).toBeNull();

    const expected = computeConsentHmac(
      env.BETTER_AUTH_SECRET,
      userId,
      clientId,
      null,
      ["openid"]
    );
    expect(consent?.scopeHmac).not.toBe(expected);
  });

  it("HMAC differs across clients for same user and scopes", async () => {
    const userId = await createTestUser();
    await createTestClient("client-a");
    await createTestClient("client-b");

    const scopes = ["openid"];
    const hmacA = computeConsentHmac(
      env.BETTER_AUTH_SECRET,
      userId,
      "client-a",
      null,
      scopes
    );
    const hmacB = computeConsentHmac(
      env.BETTER_AUTH_SECRET,
      userId,
      "client-b",
      null,
      scopes
    );

    expect(hmacA).not.toBe(hmacB);
  });

  it("HMAC differs across users for same client and scopes", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    await createTestClient("client-cross-user");

    const scopes = ["openid"];
    const hmacA = computeConsentHmac(
      env.BETTER_AUTH_SECRET,
      userA,
      "client-cross-user",
      null,
      scopes
    );
    const hmacB = computeConsentHmac(
      env.BETTER_AUTH_SECRET,
      userB,
      "client-cross-user",
      null,
      scopes
    );

    expect(hmacA).not.toBe(hmacB);
  });

  it("referenceId binding prevents cross-org scope transplant", async () => {
    const userId = await createTestUser();
    await createTestClient("client-org");

    const scopes = ["openid"];
    const hmacOrg1 = computeConsentHmac(
      env.BETTER_AUTH_SECRET,
      userId,
      "client-org",
      "org-1",
      scopes
    );
    const hmacOrg2 = computeConsentHmac(
      env.BETTER_AUTH_SECRET,
      userId,
      "client-org",
      "org-2",
      scopes
    );

    expect(hmacOrg1).not.toBe(hmacOrg2);
  });
});
