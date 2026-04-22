import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/connection";
import {
  agentCapabilities,
  agentHosts,
  agentSessionGrants,
  agentSessions,
} from "@/lib/db/schema/agent";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

const { mockRequireBootstrapAccessToken } = vi.hoisted(() => ({
  mockRequireBootstrapAccessToken: vi.fn(),
}));

vi.mock("@/lib/auth/resource-auth", () => ({
  requireBootstrapAccessToken: mockRequireBootstrapAccessToken,
}));

async function createOAuthClient(clientId: string) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      grantTypes: JSON.stringify(["authorization_code"]),
      name: clientId,
      public: true,
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      tokenEndpointAuthMethod: "none",
    })
    .run();
}

describe("POST /api/auth/agent/revoke", () => {
  beforeEach(async () => {
    await resetDatabase();
    mockRequireBootstrapAccessToken.mockReset();
  });

  it("rejects delegated callers from a different OAuth client", async () => {
    const userId = await createTestUser();
    await createOAuthClient("agent-owner");
    await createOAuthClient("other-client");
    await db
      .insert(agentCapabilities)
      .values({
        approvalStrength: "none",
        description: "Compliance checks",
        name: "check_compliance",
      })
      .onConflictDoNothing()
      .run();

    const [host] = await db
      .insert(agentHosts)
      .values({
        clientId: "agent-owner",
        name: "Laptop",
        publicKey: JSON.stringify({
          kty: "OKP",
          crv: "Ed25519",
          x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        }),
        publicKeyThumbprint: "host-thumbprint",
        userId,
      })
      .returning({ id: agentHosts.id });
    if (!host) {
      throw new Error("Expected host fixture");
    }

    const [session] = await db
      .insert(agentSessions)
      .values({
        displayName: "Claude Code",
        hostId: host.id,
        publicKey: JSON.stringify({
          kty: "OKP",
          crv: "Ed25519",
          x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
        }),
        publicKeyThumbprint: "session-thumbprint",
      })
      .returning({ id: agentSessions.id });
    if (!session) {
      throw new Error("Expected session fixture");
    }

    await db
      .insert(agentSessionGrants)
      .values({
        capabilityName: "check_compliance",
        sessionId: session.id,
        source: "host_policy",
        status: "active",
      })
      .run();

    mockRequireBootstrapAccessToken.mockResolvedValue({
      ok: true,
      principal: {
        clientId: "other-client",
        kind: "user_access_token",
        scopes: ["agent:session.revoke"],
        token: "test-token",
        userId,
      },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/agent/revoke", {
        body: JSON.stringify({ sessionId: session.id }),
        method: "POST",
      })
    );

    expect(response.status).toBe(403);

    const persistedSession = await db
      .select({ status: agentSessions.status })
      .from(agentSessions)
      .where(eq(agentSessions.id, session.id))
      .limit(1)
      .get();
    expect(persistedSession?.status).toBe("active");
  });
});
