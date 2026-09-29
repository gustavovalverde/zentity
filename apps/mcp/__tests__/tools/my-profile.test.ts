import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadProfile = vi.fn();

vi.mock("../../src/services/profile-read.js", () => ({
  readProfile: (...args: unknown[]) => mockReadProfile(...args),
}));

import { connectClient } from "../helpers/mcp-client.js";

describe("my_profile", () => {
  beforeEach(() => {
    mockReadProfile.mockReset();
  });

  it("returns typed profile data when disclosure is complete", async () => {
    mockReadProfile.mockResolvedValue({
      status: "complete",
      requestedFields: ["name"],
      returnedFields: ["name"],
      profile: {
        name: {
          full: "Ada Lovelace",
          given: "Ada",
          family: "Lovelace",
        },
      },
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "my_profile",
      arguments: { fields: ["name"] },
    });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );

    expect(parsed.status).toBe("complete");
    expect(parsed.requestedFields).toEqual(["name"]);
    expect(parsed.profile.name.full).toBe("Ada Lovelace");
  });

  it("requires an explicit field list", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "my_profile",
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "Invalid arguments for tool my_profile"
    );
  });

  it("accepts stringified arrays from less structured MCP callers", async () => {
    mockReadProfile.mockResolvedValue({
      status: "complete",
      requestedFields: ["name", "address"],
      returnedFields: ["name"],
      profile: {
        name: {
          full: "Ada Lovelace",
          given: "Ada",
          family: "Lovelace",
        },
        address: null,
      },
    });

    const client = await connectClient();
    await client.callTool({
      name: "my_profile",
      arguments: { fields: '["address", "name"]' },
    });

    expect(mockReadProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: ["name", "address"],
      })
    );
  });

  it("rejects standard account email as a profile field", async () => {
    const client = await connectClient();

    const result = await client.callTool({
      name: "my_profile",
      arguments: { fields: ["email"] },
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "Invalid arguments for tool my_profile"
    );
  });

  it("returns structured fallback interaction data when browser action is needed", async () => {
    mockReadProfile.mockResolvedValue({
      status: "needs_user_action",
      requestedFields: ["name"],
      returnedFields: [],
      profile: {},
      interaction: {
        mode: "url",
        url: "http://localhost:3000/mcp/interactive/interaction-1",
        message: "Open the link to continue.",
        expiresAt: "2026-03-24T10:00:00.000Z",
      },
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "my_profile",
      arguments: { fields: ["name"] },
    });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );

    expect(parsed.status).toBe("needs_user_action");
    expect(parsed.interaction.url).toContain("/mcp/interactive/");
  });
});
