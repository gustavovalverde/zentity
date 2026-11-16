import { makeSignature } from "better-auth/crypto";
import { describe, expect, it } from "vitest";

import {
  clientSector,
  computePairwiseSub,
  pairwiseValue,
  resolveSubForClient,
  scopeSubjectToAudience,
  tokenSector,
} from "@/lib/auth/oidc/pairwise";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";

const TEST_SECRET = "test-secret-at-least-32-characters-long";
const MCP_AUDIENCE = "https://mcp.example";

describe("clientSector", () => {
  it("uses the stored sector over the redirect hosts", () => {
    expect(
      clientSector({
        sectorIdentifier: "client/agent-1",
        redirectUris: ["http://127.0.0.1:8765/callback"],
      })
    ).toBe("client/agent-1");
  });

  it("falls back to the first redirect host for a row without a sector", () => {
    expect(
      clientSector({
        sectorIdentifier: null,
        redirectUris: ["https://rp.example.com/cb", "https://other.example/cb"],
      })
    ).toBe("rp.example.com");
  });

  it("refuses a row with neither a sector nor a redirect URI", () => {
    expect(() =>
      clientSector({ sectorIdentifier: null, redirectUris: [] })
    ).toThrow("Client has no redirect URIs for sector identifier");
  });
});

describe("computePairwiseSub", () => {
  it("is deterministic for the same subject and sector", async () => {
    const a = await computePairwiseSub("user-1", "example.com", TEST_SECRET);
    const b = await computePairwiseSub("user-1", "example.com", TEST_SECRET);
    expect(a).toBe(b);
  });

  it("produces different output for different users", async () => {
    const a = await computePairwiseSub("user-1", "example.com", TEST_SECRET);
    const b = await computePairwiseSub("user-2", "example.com", TEST_SECRET);
    expect(a).not.toBe(b);
  });

  it("produces different output for different sectors", async () => {
    const a = await computePairwiseSub("user-1", "alpha.com", TEST_SECRET);
    const b = await computePairwiseSub("user-1", "beta.com", TEST_SECRET);
    expect(a).not.toBe(b);
  });

  it("matches better-auth's derivation (golden test)", async () => {
    const ours = await computePairwiseSub(
      "user-golden",
      "rp.example.com",
      TEST_SECRET
    );
    const theirs = await makeSignature(
      "rp.example.com.user-golden",
      TEST_SECRET
    );
    expect(ours).toBe(theirs);
  });
});

describe("resolveSubForClient", () => {
  const redirectUris = ["https://example.com/cb"];

  it("returns raw userId for non-pairwise clients", async () => {
    const result = await resolveSubForClient("user-1", {
      subjectType: null,
      sectorIdentifier: null,
      redirectUris,
    });
    expect(result).toBe("user-1");
  });

  it("returns raw userId for public clients", async () => {
    const result = await resolveSubForClient("user-1", {
      subjectType: "public",
      sectorIdentifier: null,
      redirectUris,
    });
    expect(result).toBe("user-1");
  });

  it("returns the pairwise sub of the stored sector", async () => {
    const result = await resolveSubForClient("user-1", {
      subjectType: "pairwise",
      sectorIdentifier: "client/agent-1",
      redirectUris,
    });
    expect(result).toBe(
      await computePairwiseSub(
        "user-1",
        "client/agent-1",
        process.env.PAIRWISE_SECRET ?? ""
      )
    );
  });
});

describe("tokenSector", () => {
  const client = { sectorIdentifier: "rp.example", redirectUris: [] };

  it("joins the client sector and the normalized audience", () => {
    expect(tokenSector(client, `${MCP_AUDIENCE}/`)).toBe(
      `rp.example ${MCP_AUDIENCE}`
    );
  });

  // R5: a token sector cannot collide with a client sector, whose hosts and
  // `client/<client_id>` form never contain a space.
  it("never equals a client sector, so its subjects differ from ID-token subjects", async () => {
    const clients = [
      client,
      { sectorIdentifier: "client/agent-1", redirectUris: [] },
      { sectorIdentifier: null, redirectUris: ["https://rp.example/cb"] },
    ];
    const clientSubjects = await Promise.all(
      clients.map((c) => pairwiseValue(clientSector(c), "user-1"))
    );
    for (const c of clients) {
      const sector = tokenSector(c, MCP_AUDIENCE);
      expect(clients.map(clientSector)).not.toContain(sector);
      expect(clientSubjects).not.toContain(
        await pairwiseValue(sector, "user-1")
      );
    }
  });

  // R10: a merchant Proof-of-Human sector never equals the sector of a client
  // registered at the merchant's own host.
  it("keeps a merchant sector apart from the merchant host's client sector", async () => {
    const merchantClient = {
      sectorIdentifier: "merchant.example",
      redirectUris: ["https://merchant.example/cb"],
    };
    const merchantSector = tokenSector(
      { sectorIdentifier: "client/agent-1", redirectUris: [] },
      "https://merchant.example"
    );

    expect(merchantSector).toBe("client/agent-1 https://merchant.example");
    expect(merchantSector).not.toBe(clientSector(merchantClient));
    expect(await pairwiseValue(merchantSector, "user-1")).not.toBe(
      await pairwiseValue(clientSector(merchantClient), "user-1")
    );
  });
});

describe("scopeSubjectToAudience", () => {
  const issuance = {
    userId: "user-1",
    client: {
      clientId: "agent-1",
      sectorIdentifier: "client/agent-1",
      redirectUris: [],
    },
  };
  const userInfoAudience = `${getAuthIssuer()}/oauth2/userinfo`;

  async function providerPayload(aud: unknown) {
    return {
      sub: await pairwiseValue("client/agent-1", "user-1"),
      ba_sub: "ciphertext",
      aud,
      client_id: "agent-1",
      scope: "openid",
    };
  }

  it("gives one external audience its own subject", async () => {
    const payload = await providerPayload([MCP_AUDIENCE, userInfoAudience]);

    const scoped = await scopeSubjectToAudience(payload, issuance);

    expect(scoped).toEqual({
      ...payload,
      sub: await pairwiseValue(`client/agent-1 ${MCP_AUDIENCE}`, "user-1"),
    });
  });

  // R17: a token for Zentity's own endpoints keeps the client's subject.
  it("keeps the client subject when every audience is Zentity-hosted", async () => {
    const payload = await providerPayload([
      `${getAuthIssuer()}/oidc4vci/credential`,
      userInfoAudience,
    ]);

    expect(await scopeSubjectToAudience(payload, issuance)).toBe(payload);
  });

  it("refuses a payload with two external audiences", async () => {
    await expect(
      scopeSubjectToAudience(
        await providerPayload([MCP_AUDIENCE, "https://wallet.example"]),
        issuance
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      body: {
        error: "invalid_target",
        error_description: "request one resource outside Zentity per token",
      },
    });
  });

  it("refuses a payload issued to another user or client", async () => {
    const payload = await providerPayload(MCP_AUDIENCE);

    await expect(
      scopeSubjectToAudience(payload, { ...issuance, userId: "user-2" })
    ).rejects.toThrow("The access token is not the one this request issues");
    await expect(
      scopeSubjectToAudience(payload, {
        ...issuance,
        client: { ...issuance.client, clientId: "agent-2" },
      })
    ).rejects.toThrow("The access token is not the one this request issues");
  });
});
