import { CIBA_GRANT_TYPE } from "@better-auth/ciba";
import { eq } from "drizzle-orm";
import { calculateJwkThumbprint } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as trpcGet } from "@/app/api/trpc/[trpc]/route";
import { AUTHENTICATION_CONTEXT_CLAIM } from "@/lib/auth/auth-context";
import { mintOpaqueAccessToken } from "@/lib/auth/oidc/haip/opaque-access-token";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";
import { db } from "@/lib/db/connection";
import {
  oauthAccessTokens,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import { createTrpcContext } from "@/lib/trpc/server";
import {
  createTestCibaRequest,
  createTestSession,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  type DpopKeyPair,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";

const INTERNAL_TOKEN = vi.hoisted(() => {
  const token = "internal-service-token-with-32-characters!";
  process.env.INTERNAL_SERVICE_TOKEN = token;
  return token;
});

const APP_URL = "http://localhost:3000";
const TRPC_URL = `${APP_URL}/api/trpc/assurance.profile`;
const AGENT_CLIENT_ID = "context-agent";

async function dpopTrpcContext(token: string, keyPair: DpopKeyPair) {
  return createTrpcContext({
    req: new Request(TRPC_URL, {
      headers: {
        authorization: `DPoP ${token}`,
        DPoP: await buildDpopProof(keyPair, "GET", TRPC_URL, token),
      },
    }),
  });
}

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

  it("rejects an opaque access token once the provider marks it revoked", async () => {
    const userId = await createTestUser();
    const { sessionId } = await createTestSession(userId);
    await db
      .insert(oauthClients)
      .values({ clientId: "opaque-client", redirectUris: "[]" })
      .run();
    const token = await mintOpaqueAccessToken({
      act: { sub: "opaque-client" },
      clientId: "opaque-client",
      expiresAt: new Date(Date.now() + 3_600_000),
      referenceId: crypto.randomUUID(),
      scopes: ["openid"],
      sessionId,
      userId,
    });
    const contextFor = () =>
      createTrpcContext({
        req: new Request("http://localhost:3000/api/trpc/account.get", {
          headers: { authorization: `Bearer ${token}` },
        }),
      });
    expect((await contextFor()).session?.user.id).toBe(userId);

    await db
      .update(oauthAccessTokens)
      .set({ revoked: new Date() })
      .where(eq(oauthAccessTokens.clientId, "opaque-client"))
      .run();

    const revoked = await contextFor();
    expect(revoked.session).toBeNull();
    expect(revoked.tokenChallenge?.get("WWW-Authenticate")).toBe(
      'Bearer error="invalid_token", error_description="Invalid access token", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"'
    );
  });

  describe("an access token issued without a session", () => {
    let userId: string;
    let authContextId: string;
    let cibaToken: string;
    let keyPair: DpopKeyPair;

    beforeEach(async () => {
      userId = await createTestUser();
      await db
        .insert(oauthClients)
        .values({
          clientId: AGENT_CLIENT_ID,
          grantTypes: JSON.stringify([
            CIBA_GRANT_TYPE,
            TOKEN_EXCHANGE_GRANT_TYPE,
          ]),
          redirectUris: JSON.stringify(["http://localhost/callback"]),
          tokenEndpointAuthMethod: "none",
        })
        .run();
      const request = await createTestCibaRequest({
        clientId: AGENT_CLIENT_ID,
        userId,
        status: "approved",
      });
      if (!request.authContextId) {
        throw new Error("Expected the approved request to carry its context");
      }
      authContextId = request.authContextId;
      const issued = await postTokenWithDpop({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: request.authReqId,
        client_id: AGENT_CLIENT_ID,
      });
      if (issued.status !== 200) {
        throw new Error(
          `CIBA token poll failed: ${JSON.stringify(issued.json)}`
        );
      }
      cibaToken = issued.json.access_token as string;
      keyPair = issued.dpopKeyPair;
    });

    it("resolves to the authentication that approved its CIBA request", async () => {
      const context = await dpopTrpcContext(cibaToken, keyPair);

      expect(context.session?.user.id).toBe(userId);
      expect(context.authContext?.id).toBe(authContextId);
    });

    // Token exchange refuses a CIBA token as a delegated token, so the subject
    // is a login token stored with the same authentication and no session.
    it("keeps its subject token's authentication through token exchange", async () => {
      const subjectToken = await mintOpaqueAccessToken({
        accessTokenClaims: { [AUTHENTICATION_CONTEXT_CLAIM]: authContextId },
        clientId: AGENT_CLIENT_ID,
        dpopJkt: await calculateJwkThumbprint(keyPair.jwk),
        expiresAt: new Date(Date.now() + 3_600_000),
        referenceId: crypto.randomUUID(),
        scopes: ["openid"],
        userId,
      });
      const exchanged = await postTokenWithDpop(
        {
          grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
          client_id: AGENT_CLIENT_ID,
          subject_token: subjectToken,
          subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
          audience: APP_URL,
        },
        keyPair
      );
      expect(exchanged.status).toBe(200);
      const exchangedToken = exchanged.json.access_token as string;
      expect(exchangedToken.split(".")).toHaveLength(1);

      const context = await dpopTrpcContext(exchangedToken, keyPair);

      expect(context.session?.user.id).toBe(userId);
      expect(context.authContext?.id).toBe(authContextId);
    });
  });

  it("sends the token challenge with an unauthorized tRPC response", async () => {
    const response = await trpcGet(
      new Request("http://localhost:3000/api/trpc/assurance.profile", {
        headers: { authorization: "Bearer unknown-opaque-token" },
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer error="invalid_token", error_description="Invalid access token", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"'
    );
  });

  it("points a caller that presented no token at the resource metadata", async () => {
    const response = await trpcGet(
      new Request("http://localhost:3000/api/trpc/assurance.profile")
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource", DPoP resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource", algs="ES256"'
    );
  });
});
