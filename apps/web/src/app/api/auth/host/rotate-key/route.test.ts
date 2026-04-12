import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeJwkThumbprint } from "@/lib/auth/oidc/oauth-token-validation";
import { db } from "@/lib/db/connection";
import { agentHosts } from "@/lib/db/schema/agent";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

const { mockRequireBrowserSession } = vi.hoisted(() => ({
  mockRequireBrowserSession: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({
  requireBrowserSession: mockRequireBrowserSession,
}));

const TEST_CLIENT_ID = "rotate-key-client";

async function createOAuthClient(clientId: string) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: clientId,
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify(["authorization_code"]),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function createPublicKeyJwk() {
  const { publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  return JSON.stringify(await exportJWK(publicKey));
}

describe("POST /api/auth/host/rotate-key", () => {
  beforeEach(async () => {
    await resetDatabase();
    mockRequireBrowserSession.mockReset();
  });

  it("updates the host thumbprint while preserving the host identity", async () => {
    const userId = await createTestUser();
    await createOAuthClient(TEST_CLIENT_ID);
    const originalKey = await createPublicKeyJwk();
    const newKey = await createPublicKeyJwk();

    const [host] = await db
      .insert(agentHosts)
      .values({
        userId,
        clientId: TEST_CLIENT_ID,
        publicKey: originalKey,
        publicKeyThumbprint: await computeJwkThumbprint(originalKey),
        name: "Laptop",
      })
      .returning({ id: agentHosts.id });
    if (!host) {
      throw new Error("Expected host fixture to be created");
    }

    mockRequireBrowserSession.mockResolvedValue({
      ok: true,
      session: { user: { id: userId } },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/host/rotate-key", {
        method: "POST",
        body: JSON.stringify({ hostId: host.id, publicKey: newKey }),
      })
    );

    expect(response.status).toBe(200);

    const updated = await db
      .select({
        id: agentHosts.id,
        publicKeyThumbprint: agentHosts.publicKeyThumbprint,
      })
      .from(agentHosts)
      .where(eq(agentHosts.id, host.id))
      .limit(1)
      .get();

    expect(updated).toEqual({
      id: host.id,
      publicKeyThumbprint: await computeJwkThumbprint(newKey),
    });
  });

  it("rejects rotations that would collide with another host thumbprint", async () => {
    const userId = await createTestUser();
    await createOAuthClient(TEST_CLIENT_ID);
    const firstKey = await createPublicKeyJwk();
    const secondKey = await createPublicKeyJwk();

    const [firstHost] = await db
      .insert(agentHosts)
      .values({
        userId,
        clientId: TEST_CLIENT_ID,
        publicKey: firstKey,
        publicKeyThumbprint: await computeJwkThumbprint(firstKey),
        name: "Laptop",
      })
      .returning({ id: agentHosts.id });
    if (!firstHost) {
      throw new Error("Expected host fixture to be created");
    }

    await db
      .insert(agentHosts)
      .values({
        userId,
        clientId: TEST_CLIENT_ID,
        publicKey: secondKey,
        publicKeyThumbprint: await computeJwkThumbprint(secondKey),
        name: "Desktop",
      })
      .run();

    mockRequireBrowserSession.mockResolvedValue({
      ok: true,
      session: { user: { id: userId } },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/host/rotate-key", {
        method: "POST",
        body: JSON.stringify({ hostId: firstHost.id, publicKey: secondKey }),
      })
    );

    expect(response.status).toBe(409);
  });
});
