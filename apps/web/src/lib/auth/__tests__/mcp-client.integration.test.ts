import crypto from "node:crypto";

import { beginCibaApproval, pollCibaTokenOnce } from "@zentity/sdk";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { createAuthenticationContext } from "@/lib/auth/auth-context";
import { stageFinalCibaDisclosure } from "@/lib/auth/oidc/disclosure/context";
import { createScopeHash } from "@/lib/auth/oidc/disclosure/delivery";
import {
  MCP_CLIENT_SCOPES,
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

  it("creates a new client when the given one is not the provisioned one", async () => {
    const first = await provisionMcpClient({});
    const other = await provisionMcpClient({ clientId: "unknown-client" });

    expect(other.created).toBe(true);
    expect(other.clientId).not.toBe(first.clientId);
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
    expect(
      (await db.select({ email: users.email }).from(users).all()).map(
        (row) => row.email
      )
    ).toContain("mcp-provisioning@zentity.invalid");
  });
});
