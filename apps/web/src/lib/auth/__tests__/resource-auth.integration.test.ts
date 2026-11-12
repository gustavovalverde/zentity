import crypto from "node:crypto";

import { calculateJwkThumbprint } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { createAuthenticationContext } from "@/lib/auth/auth-context";
import { mintOpaqueAccessToken } from "@/lib/auth/oidc/haip/opaque-access-token";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  createTestDpopKeyPair,
  type DpopKeyPair,
} from "@/test-utils/dpop-test-utils";

import { requireBootstrapAccessToken } from "../resource-auth";

const CLIENT_ID = "pairwise-client";
const REGISTER_URL = "http://localhost:3000/api/auth/agent/host/register";
const SCOPES = ["agent:host.register", "agent:session.register"];

async function bootstrapRequest(
  token: string,
  keyPair: DpopKeyPair,
  scheme = "DPoP"
) {
  return new Request(REGISTER_URL, {
    method: "POST",
    headers: {
      Authorization: `${scheme} ${token}`,
      DPoP: await buildDpopProof(keyPair, "POST", REGISTER_URL, token),
    },
  });
}

describe("requireBootstrapAccessToken", () => {
  let userId: string;
  let keyPair: DpopKeyPair;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    keyPair = await createTestDpopKeyPair();
    await db
      .insert(oauthClients)
      .values({
        clientId: CLIENT_ID,
        redirectUris: JSON.stringify(["http://127.0.0.1/callback"]),
        tokenEndpointAuthMethod: "none",
      })
      .run();
  });

  async function mintBootstrapToken(
    overrides: Partial<Parameters<typeof mintOpaqueAccessToken>[0]> = {}
  ) {
    return mintOpaqueAccessToken({
      act: { sub: CLIENT_ID },
      clientId: CLIENT_ID,
      dpopJkt: await calculateJwkThumbprint(keyPair.jwk),
      exchangeClaims: { zentity_token_use: "agent_bootstrap" },
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: crypto.randomUUID(),
      scopes: SCOPES,
      userId,
      ...overrides,
    });
  }

  it("resolves a DPoP-bound opaque bootstrap token to its user", async () => {
    const { id: authContextId } = await createAuthenticationContext({
      authenticatedAt: new Date(),
      loginMethod: "passkey",
      sourceKind: "token_exchange",
      userId,
    });
    const token = await mintBootstrapToken({ authContextId });

    const result = await requireBootstrapAccessToken(
      await bootstrapRequest(token, keyPair),
      ["agent:host.register"]
    );

    expect(result).toEqual({
      ok: true,
      dpopNonce: expect.any(String),
      principal: {
        kind: "user_access_token",
        authContextId,
        userId,
        clientId: CLIENT_ID,
        scopes: SCOPES,
        token,
      },
    });
  });

  it.each([
    ["without the bootstrap token use claim", { exchangeClaims: {} }],
    ["without a DPoP binding", { dpopJkt: undefined }],
    ["after expiry", { expiresAt: new Date(Date.now() - 1000) }],
  ])("rejects tokens %s", async (_label, overrides) => {
    const token = await mintBootstrapToken(overrides);

    const result = await requireBootstrapAccessToken(
      await bootstrapRequest(token, keyPair),
      ["agent:host.register"]
    );

    expect(result.ok).toBe(false);
  });

  it("rejects bootstrap tokens presented as Bearer", async () => {
    const token = await mintBootstrapToken();

    const result = await requireBootstrapAccessToken(
      await bootstrapRequest(token, keyPair, "Bearer"),
      ["agent:host.register"]
    );

    expect(result.ok).toBe(false);
  });

  it("rejects a proof from a key the token is not bound to", async () => {
    const token = await mintBootstrapToken();

    const result = await requireBootstrapAccessToken(
      await bootstrapRequest(token, await createTestDpopKeyPair()),
      ["agent:host.register"]
    );

    expect(result.ok).toBe(false);
  });
});
