import type { Session } from "@/lib/auth/auth-config";

import crypto from "node:crypto";

import { beginCibaApproval, pollCibaTokenOnce } from "@zentity/sdk";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "@/env";
import { createAuthenticationContext } from "@/lib/auth/auth-context";
import { stageFinalCibaDisclosure } from "@/lib/auth/oidc/disclosure/context";
import { createScopeHash } from "@/lib/auth/oidc/disclosure/delivery";
import {
  MCP_CLIENT_SCOPES,
  mcpProvisioningTarget,
  provisionMcpClient,
} from "@/lib/auth/oidc/mcp-client";
import { resolveSubForClientId } from "@/lib/auth/oidc/pairwise";
import { db } from "@/lib/db/connection";
import { sessions, users } from "@/lib/db/schema/auth";
import { cibaRequests } from "@/lib/db/schema/ciba";
import {
  oauthClientResources,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import { signUpRouter } from "@/lib/trpc/routers/sign-up";
import {
  createTestCibaApproval,
  createTestUser,
  hashCibaAuthReqId,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import {
  authHandlerFetch,
  buildDpopProof,
  createAuthHandlerDpopClient,
  createTestDpopKeyPair,
} from "@/test-utils/dpop-test-utils";

const AUTH_URL = "http://localhost:3000/api/auth";

function storedClients() {
  return db
    .select({
      clientId: oauthClients.clientId,
      grantTypes: oauthClients.grantTypes,
      metadata: oauthClients.metadata,
      scopes: oauthClients.scopes,
      sectorIdentifier: oauthClients.sectorIdentifier,
      skipConsent: oauthClients.skipConsent,
      subjectType: oauthClients.subjectType,
      tokenEndpointAuthMethod: oauthClients.tokenEndpointAuthMethod,
    })
    .from(oauthClients)
    .all();
}

const SERVICE_ACCOUNT_EMAIL = /^mcp-[0-9a-f-]{36}@zentity\.invalid$/;

async function clientOwner(clientId: string) {
  return await db
    .select({ id: users.id, email: users.email })
    .from(oauthClients)
    .innerJoin(users, eq(users.id, oauthClients.userId))
    .where(eq(oauthClients.clientId, clientId))
    .get();
}

describe("MCP HTTP client provisioning", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // R27: provisioning is idempotent and stores what CIBA and exchange read.
  it("creates the client once and updates it on later runs", async () => {
    const first = await provisionMcpClient({});
    const second = await provisionMcpClient({ clientId: first.clientId });

    expect(first).toEqual({
      clientId: expect.any(String),
      clientSecret: expect.any(String),
      created: true,
    });
    expect(second).toEqual({ clientId: first.clientId, created: false });
    expect(await storedClients()).toEqual([
      {
        clientId: first.clientId,
        grantTypes: JSON.stringify([
          "urn:ietf:params:oauth:grant-type:token-exchange",
          "urn:openid:params:grant-type:ciba",
        ]),
        metadata: JSON.stringify({ backchannel_token_delivery_mode: "poll" }),
        scopes: JSON.stringify(MCP_CLIENT_SCOPES),
        sectorIdentifier: `client/${first.clientId}`,
        skipConsent: true,
        subjectType: "pairwise",
        tokenEndpointAuthMethod: "client_secret_basic",
      },
    ]);
    expect(
      await db
        .select({ resourceId: oauthClientResources.resourceId })
        .from(oauthClientResources)
        .where(eq(oauthClientResources.clientId, first.clientId))
        .all()
    ).toEqual([{ resourceId: env.MCP_PUBLIC_URL }]);
    // The owner's provisioning sessions do not outlive a run.
    expect(await db.select().from(sessions).all()).toEqual([]);
  });

  // T3 leftover: an unset MCP_PUBLIC_URL defaults to a loopback URL, and a
  // production client linked to it serves no remote host.
  it("refuses a loopback MCP resource in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => mcpProvisioningTarget()).toThrow(
        `MCP_PUBLIC_URL is ${env.MCP_PUBLIC_URL} and must use HTTPS; set it to the MCP server's public URL before provisioning in production`
      );
      await expect(provisionMcpClient({})).rejects.toThrow("MCP_PUBLIC_URL");
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await storedClients()).toEqual([]);
  });

  it.each([
    "https://127.0.0.2:3300",
    "https://0.0.0.0:3300",
    "https://[::ffff:127.0.0.1]:3300",
    "https://[::1]:3300",
    "https://mcp.localhost",
    "https://10.0.0.5",
    "https://mcp.railway.internal",
    "http://mcp.example.com",
  ])("refuses %s as the production MCP resource", (resource) => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => mcpProvisioningTarget(resource)).toThrow(
        `MCP_PUBLIC_URL is ${resource} and`
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("accepts a public HTTPS MCP resource in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(mcpProvisioningTarget("https://mcp.example.com").resource).toBe(
        "https://mcp.example.com"
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("names the resource and database it writes to", () => {
    expect(mcpProvisioningTarget()).toEqual({
      resource: env.MCP_PUBLIC_URL,
      database: expect.stringContaining("test.db"),
    });
  });

  it("creates a new client when the given one does not exist", async () => {
    const first = await provisionMcpClient({});
    const other = await provisionMcpClient({ clientId: "unknown-client" });

    expect(other.created).toBe(true);
    expect(other.clientId).not.toBe(first.clientId);
  });

  it("never makes an existing account the client's owner", async () => {
    // Sign-up stores an address without proving it, so a user may hold any
    // address a fixed owner lookup would name.
    const claimantId = await createTestUser({
      email: "mcp-provisioning@zentity.invalid",
    });

    const { clientId } = await provisionMcpClient({});
    const owner = await clientOwner(clientId);

    expect(owner?.id).not.toBe(claimantId);
    expect(owner?.email).toMatch(SERVICE_ACCOUNT_EMAIL);
    expect(await provisionMcpClient({ clientId })).toEqual({
      clientId,
      created: false,
    });
  });

  it("keeps sign-up from storing an owner's address", async () => {
    const userId = await createTestUser();
    const signUp = signUpRouter.createCaller({
      authContext: null,
      flowId: null,
      flowIdSource: "none",
      req: new Request("http://localhost/api/trpc"),
      requestId: "test-request-id",
      session: {
        user: { id: userId, email: `user-${userId}@example.com` },
        session: { id: "session" },
      } as unknown as Session,
    });

    await expect(
      signUp.completeAccountCreation({ email: "mcp-owner@zentity.invalid" })
    ).rejects.toThrow("This email address can't be used");
    const opaqueSignUp = await authHandlerFetch(
      `${AUTH_URL}/sign-up/opaque/challenge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "MCP-Owner@Zentity.Invalid",
          registrationRequest: "AAAA",
        }),
      }
    );
    expect(opaqueSignUp.status).toBe(400);
    expect(await opaqueSignUp.json()).toMatchObject({
      message: "This email address can't be used",
    });
    expect(
      await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .get()
    ).toEqual({ email: `user-${userId}@example.com` });
    expect(await db.select({ id: users.id }).from(users).all()).toHaveLength(1);
  });

  it("refuses to update a client it did not create", async () => {
    const userId = await createTestUser({ email: "rp@example.com" });
    await db.insert(oauthClients).values({
      clientId: "users-client",
      name: "A user's client",
      redirectUris: JSON.stringify(["https://rp.example/callback"]),
      grantTypes: JSON.stringify(["authorization_code"]),
      tokenEndpointAuthMethod: "client_secret_basic",
      clientSecret: "secret",
      userId,
    });

    await expect(
      provisionMcpClient({ clientId: "users-client" })
    ).rejects.toThrow("was not created by MCP provisioning");
    expect(
      await db
        .select({
          grantTypes: oauthClients.grantTypes,
          skipConsent: oauthClients.skipConsent,
        })
        .from(oauthClients)
        .where(eq(oauthClients.clientId, "users-client"))
        .get()
    ).toEqual({
      grantTypes: JSON.stringify(["authorization_code"]),
      skipConsent: null,
    });
    expect(await db.select().from(oauthClientResources).all()).toEqual([]);
  });

  it("rotates the secret only when asked", async () => {
    const created = await provisionMcpClient({});
    const rotated = await provisionMcpClient({
      clientId: created.clientId,
      rotateSecret: true,
    });

    expect(rotated.clientId).toBe(created.clientId);
    expect(rotated.clientSecret).toEqual(expect.any(String));
    expect(rotated.clientSecret).not.toBe(created.clientSecret);
  });

  // R27: MCP HTTP's my_profile runs CIBA as the confidential client.
  it("runs a CIBA approval with client_secret_basic and reads the released profile", async () => {
    const userId = await createTestUser();
    const { clientId, clientSecret } = await provisionMcpClient({});
    const keyPair = await createTestDpopKeyPair();
    const dpopClient = await createAuthHandlerDpopClient(keyPair);
    const client = {
      clientId,
      clientSecret: clientSecret as string,
      dpopClient,
      fetch: authHandlerFetch,
      tokenEndpoint: `${AUTH_URL}/oauth2/token`,
    };

    const pending = await beginCibaApproval({
      ...client,
      bindingMessage: "Read your name",
      cibaEndpoint: `${AUTH_URL}/oauth2/bc-authorize`,
      loginHint: (await resolveSubForClientId(userId, clientId)) as string,
      scope: "openid identity.name",
    });
    expect(await pollCibaTokenOnce(client, pending)).toMatchObject({
      status: "pending",
    });

    // The user approves on the page and stages the name.
    const authReqIdHash = hashCibaAuthReqId(pending.authReqId);
    const approval = await createAuthenticationContext({
      userId,
      loginMethod: "passkey",
      authenticatedAt: new Date(),
      sourceKind: "ciba_approval",
      referenceType: "ciba_request",
    });
    const [request] = await db
      .update(cibaRequests)
      .set({
        status: "approved",
        authContextId: approval.id,
        referenceId: authReqIdHash,
      })
      .where(
        and(
          eq(cibaRequests.authReqId, authReqIdHash),
          eq(cibaRequests.clientId, clientId)
        )
      )
      .returning({ id: cibaRequests.id });
    await createTestCibaApproval({
      authReqIdHash,
      clientId,
      requestId: request?.id as string,
      scope: "openid identity.name",
      userId,
      overrides: { authContextId: approval.id },
    });
    expect(
      await stageFinalCibaDisclosure({
        userId,
        clientId,
        claims: { given_name: "Ada", family_name: "Lovelace" },
        authReqId: authReqIdHash,
        scopes: ["identity.name"],
        scopeHash: createScopeHash(["identity.name"]),
        intentJti: crypto.randomUUID(),
      })
    ).toEqual({ ok: true });

    const poll = await pollCibaTokenOnce(client, pending);
    if (poll.status !== "approved") {
      throw new Error(`poll answered ${poll.status}`);
    }
    const userInfoUrl = `${AUTH_URL}/oauth2/userinfo`;
    const { accessToken } = poll.tokenSet;
    const userInfo = await authHandlerFetch(userInfoUrl, {
      headers: {
        authorization: `DPoP ${accessToken}`,
        DPoP: await buildDpopProof(keyPair, "GET", userInfoUrl, accessToken),
      },
    });
    expect(await userInfo.json()).toMatchObject({
      given_name: "Ada",
      family_name: "Lovelace",
    });
    // The provisioning owner is an account of its own, never the user.
    const owner = await clientOwner(clientId);
    expect(owner?.id).not.toBe(userId);
    expect(owner?.email).toMatch(SERVICE_ACCOUNT_EMAIL);
  });
});
