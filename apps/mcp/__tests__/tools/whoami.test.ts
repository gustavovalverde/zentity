import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSummary = vi.fn();

vi.mock("../../src/runtime/auth-context.js", () => ({
  requireAuth: () => Promise.resolve({}),
}));

vi.mock("../../src/services/account-summary.js", () => ({
  fetchAccountSummary: () => mockSummary(),
}));

import { createServer } from "../../src/server/index.js";

describe("whoami", () => {
  beforeEach(() => {
    mockSummary.mockReset();
  });

  async function createConnectedClient() {
    const { server } = createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    return client;
  }

  it("returns a safe account summary without vault-gated fields", async () => {
    mockSummary.mockResolvedValue({
      email: "user@example.com",
      memberSince: "2026-01-01",
      tier: 2,
      tierName: "Verified",
      verificationLevel: "full",
      authStrength: "strong",
      loginMethod: "passkey",
      checks: { document: true },
      vaultFieldsAvailable: ["name", "address", "birthdate"],
      profileToolHint: "my_profile",
    });

    const client = await createConnectedClient();
    const result = await client.callTool({ name: "whoami", arguments: {} });
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );

    expect(parsed.email).toBe("user@example.com");
    expect(parsed.tierName).toBe("Verified");
    expect(parsed.profileToolHint).toBe("my_profile");
    expect(parsed.vaultFieldsAvailable).toEqual([
      "name",
      "address",
      "birthdate",
    ]);
    expect(parsed.name).toBeUndefined();
  });

  it("can omit email when the granted scopes do not include it", async () => {
    mockSummary.mockResolvedValue({
      email: null,
      memberSince: "2026-01-01",
      tier: 2,
      tierName: "Verified",
      verificationLevel: "full",
      authStrength: "strong",
      loginMethod: "passkey",
      checks: { document: true },
      vaultFieldsAvailable: ["name", "address", "birthdate"],
      profileToolHint: "my_profile",
    });

    const client = await createConnectedClient();
    const result = await client.callTool({ name: "whoami", arguments: {} });
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );

    expect(parsed.email).toBeNull();
    expect(parsed.vaultFieldsAvailable).toEqual([
      "name",
      "address",
      "birthdate",
    ]);
  });
});
