import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  claimsRequestForEndpoint,
  finalizeOauthDisclosureFromVerification,
  loadReleaseContext,
  stagePendingOauthDisclosure,
} from "@/lib/auth/oidc/disclosure-context";
import {
  consumeIdentityPayload,
  createScopeHash,
  hasIdentityPayload,
  pendingOAuthIdentityKey,
} from "@/lib/auth/oidc/identity-delivery";
import { computeOAuthRequestKey } from "@/lib/auth/oidc/oauth-query";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

const TEST_CLIENT_ID = "oauth-disclosure-test-client";

function clearIdentityPayloadStore(): void {
  const store = (
    globalThis as Record<symbol, Map<string, unknown> | undefined>
  )[Symbol.for("zentity.ephemeral-identity-claims")];
  store?.clear();
}

async function createTestClient(clientId = TEST_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "OAuth Disclosure Test Client",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify(["authorization_code"]),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

describe("OAuth disclosure finalization", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    clearIdentityPayloadStore();
    userId = await createTestUser();
    await createTestClient();
  });

  it("promotes a pending OAuth disclosure into an exact release context", async () => {
    const identityScopes = ["identity.name"];
    const claims = JSON.stringify({
      id_token: { acr: null },
      userinfo: { given_name: null },
    });
    const query = {
      client_id: TEST_CLIENT_ID,
      response_type: "code",
      scope: `openid ${identityScopes.join(" ")}`,
      claims,
    };
    const oauthRequestKey = computeOAuthRequestKey(query);

    expect(
      await stagePendingOauthDisclosure({
        userId,
        clientId: TEST_CLIENT_ID,
        claims: { given_name: "Ada", family_name: "Lovelace" },
        scopes: identityScopes,
        scopeHash: createScopeHash(identityScopes),
        intentJti: crypto.randomUUID(),
        oauthRequestKey,
      })
    ).toEqual({ ok: true });

    expect(hasIdentityPayload(pendingOAuthIdentityKey(oauthRequestKey))).toBe(
      true
    );

    const releaseContext = await finalizeOauthDisclosureFromVerification({
      query,
      userId,
      referenceId: "oauth-reference-1",
    });

    expect(releaseContext).not.toBeNull();
    expect(releaseContext?.releaseId).toBe("oauth-reference-1");
    expect(releaseContext?.clientId).toBe(TEST_CLIENT_ID);
    expect(releaseContext?.userId).toBe(userId);
    expect(releaseContext?.flowType).toBe("oauth");
    expect(releaseContext?.expectsIdentityPayload).toBe(true);
    expect(releaseContext?.approvedIdentityScopes).toEqual(identityScopes);
    expect(
      claimsRequestForEndpoint(
        releaseContext?.claimsRequest ?? null,
        "id_token"
      )
    ).toEqual({ acr: null });
    expect(
      claimsRequestForEndpoint(
        releaseContext?.claimsRequest ?? null,
        "userinfo"
      )
    ).toEqual({ given_name: null });

    expect(hasIdentityPayload(pendingOAuthIdentityKey(oauthRequestKey))).toBe(
      false
    );
    const payload = consumeIdentityPayload("release:oauth-reference-1");
    expect(payload?.claims).toEqual({
      given_name: "Ada",
      family_name: "Lovelace",
    });
    expect(payload?.meta.clientId).toBe(TEST_CLIENT_ID);
  });

  it("creates a durable exact release context for claims-only OAuth requests", async () => {
    const query = {
      client_id: TEST_CLIENT_ID,
      response_type: "code",
      scope: "openid",
      claims: JSON.stringify({
        id_token: { acr: null, auth_time: null },
      }),
    };

    const releaseContext = await finalizeOauthDisclosureFromVerification({
      query,
      userId,
      referenceId: "oauth-reference-claims-only",
    });

    expect(releaseContext).not.toBeNull();
    expect(releaseContext?.expectsIdentityPayload).toBe(false);
    expect(releaseContext?.approvedIdentityScopes).toEqual([]);
    expect(
      claimsRequestForEndpoint(
        releaseContext?.claimsRequest ?? null,
        "id_token"
      )
    ).toEqual({ acr: null, auth_time: null });

    const loaded = await loadReleaseContext("oauth-reference-claims-only");
    expect(loaded?.releaseId).toBe("oauth-reference-claims-only");
    expect(loaded?.flowType).toBe("oauth");
  });

  it("fails closed when exact OAuth binding metadata is incomplete", async () => {
    await expect(
      finalizeOauthDisclosureFromVerification({
        query: {
          client_id: TEST_CLIENT_ID,
          response_type: "code",
          scope: "openid",
          claims: JSON.stringify({ userinfo: { given_name: null } }),
        },
        userId,
      })
    ).rejects.toMatchObject({
      oauthError: "invalid_grant",
      reason: "oauth_binding_metadata_missing",
    });
  });
});
