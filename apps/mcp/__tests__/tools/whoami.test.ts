import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSummary = vi.fn();

vi.mock("../../src/services/account-summary.js", () => ({
  fetchAccountSummary: () => mockSummary(),
}));

import { connectClient } from "../helpers/mcp-client.js";

describe("whoami", () => {
  beforeEach(() => {
    mockSummary.mockReset();
  });

  it("returns a safe account summary without vault-gated fields", async () => {
    mockSummary.mockResolvedValue({
      email: "user@example.com",
      memberSince: "2026-01-01",
      tier: 2,
      tierName: "Verified",
      verificationStrength: "documentary_full",
      authStrength: "strong",
      loginMethod: "passkey",
      checks: { document: true },
      humanity: { proven: false, sources: [] },
      vaultFieldsAvailable: ["name", "address", "birthdate"],
      profileToolHint: "my_profile",
    });

    const client = await connectClient();
    const result = await client.callTool({ name: "whoami", arguments: {} });
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );

    expect(parsed.email).toBe("user@example.com");
    expect(parsed.tierName).toBe("Verified");
    expect(parsed.verificationStrength).toBe("documentary_full");
    expect(parsed.humanity).toEqual({ proven: false, sources: [] });
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
      verificationStrength: "documentary_full",
      authStrength: "strong",
      loginMethod: "passkey",
      checks: { document: true },
      humanity: { proven: false, sources: [] },
      vaultFieldsAvailable: ["name", "address", "birthdate"],
      profileToolHint: "my_profile",
    });

    const client = await connectClient();
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
