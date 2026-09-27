import crypto from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { db } from "@/lib/db/connection";
import { sessions } from "@/lib/db/schema/auth";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { members, organizations } from "@/lib/db/schema/organization";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

const AUTH_BASE = "http://localhost:3000/api/auth";
const ORG_ID = "org-ownership-test";

async function signedSessionCookie(
  userId: string,
  activeOrganizationId: string | null
): Promise<string> {
  const token = crypto.randomUUID();
  const now = new Date();
  await db
    .insert(sessions)
    .values({
      id: crypto.randomUUID(),
      token,
      userId,
      activeOrganizationId,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const signature = await makeSignature(token, env.BETTER_AUTH_SECRET);
  return `better-auth.session_token=${token}.${signature}`;
}

async function insertClient(
  clientId: string,
  owner: { referenceId?: string; userId?: string }
) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      clientSecret: "secret",
      name: clientId,
      redirectUris: JSON.stringify(["https://rp.example.com/callback"]),
      grantTypes: JSON.stringify(["authorization_code"]),
      tokenEndpointAuthMethod: "client_secret_basic",
      ...owner,
    })
    .run();
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

async function readClient(clientId: string) {
  return await db
    .select({
      name: oauthClients.name,
      clientSecret: oauthClients.clientSecret,
      redirectUris: oauthClients.redirectUris,
      referenceId: oauthClients.referenceId,
      userId: oauthClients.userId,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .get();
}

describe("OAuth client ownership", () => {
  let ownerCookie: string;
  let memberCookie: string;

  beforeEach(async () => {
    await resetDatabase();
    await db.delete(members).run();
    await db.delete(organizations).run();

    const ownerId = await createTestUser();
    const memberId = await createTestUser();
    const otherUserId = await createTestUser();

    await db
      .insert(organizations)
      .values({ id: ORG_ID, name: "Acme", slug: "acme" })
      .run();
    await db
      .insert(members)
      .values([
        {
          id: crypto.randomUUID(),
          organizationId: ORG_ID,
          userId: ownerId,
          role: "owner",
        },
        {
          id: crypto.randomUUID(),
          organizationId: ORG_ID,
          userId: memberId,
          role: "member",
        },
      ])
      .run();

    await insertClient("org-client", { referenceId: ORG_ID });
    await insertClient("user-client", { userId: otherUserId });
    await insertClient("anonymous-client", {});

    ownerCookie = await signedSessionCookie(ownerId, ORG_ID);
    memberCookie = await signedSessionCookie(memberId, ORG_ID);
  });

  afterEach(async () => {
    await db.delete(members).run();
    await db.delete(organizations).run();
  });

  it("lets an organization owner update the organization's client", async () => {
    const response = await postAuth("/oauth2/update-client", ownerCookie, {
      client_id: "org-client",
      update: { client_name: "Renamed" },
    });

    expect(response.status).toBe(200);
    expect((await readClient("org-client"))?.name).toBe("Renamed");
  });

  it("does not let a plain organization member update or rotate the organization's client", async () => {
    const before = await readClient("org-client");

    const update = await postAuth("/oauth2/update-client", memberCookie, {
      client_id: "org-client",
      update: { redirect_uris: ["https://attacker.example.com/callback"] },
    });
    const rotate = await postAuth(
      "/oauth2/client/rotate-secret",
      memberCookie,
      { client_id: "org-client" }
    );

    expect(update.status).toBe(401);
    expect(rotate.status).toBe(401);
    expect(await readClient("org-client")).toEqual(before);
  });

  it.each([
    "user-client",
    "anonymous-client",
  ])("does not let an organization owner update or rotate %s", async (clientId) => {
    const before = await readClient(clientId);

    const update = await postAuth("/oauth2/update-client", ownerCookie, {
      client_id: clientId,
      update: { redirect_uris: ["https://attacker.example.com/callback"] },
    });
    const rotate = await postAuth("/oauth2/client/rotate-secret", ownerCookie, {
      client_id: clientId,
    });

    expect(update.status).toBe(401);
    expect(rotate.status).toBe(401);
    expect(await readClient(clientId)).toEqual(before);
  });
});
