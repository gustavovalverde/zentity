import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as trpcGet } from "@/app/api/trpc/[trpc]/route";
import { mintOpaqueAccessToken } from "@/lib/auth/oidc/haip/opaque-access-token";
import { db } from "@/lib/db/connection";
import {
  oauthAccessTokens,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import { createTrpcContext } from "@/lib/trpc/server";
import {
  createTestSession,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";

const INTERNAL_TOKEN = vi.hoisted(() => {
  const token = "internal-service-token-with-32-characters!";
  process.env.INTERNAL_SERVICE_TOKEN = token;
  return token;
});

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
      exchangeClaims: {},
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
      'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"'
    );
  });
});
