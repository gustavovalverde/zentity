import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  collectCanonicalMcpTools,
  generatedMcpToolManifestPath,
  renderGeneratedMcpToolManifest,
} from "./mcp-tool-manifest.js";

describe("collectCanonicalMcpTools", () => {
  it("returns the registered MCP tools and excludes stale landing-only entries", () => {
    const tools = collectCanonicalMcpTools();

    expect(tools).toEqual([
      {
        description: "Check the user's on-chain attestation and blockchain compliance status. Use this for attestation or network compliance questions. This tool does not unlock vault data.",
        name: "check_compliance",
      },
      {
        description: "Retrieve vault-gated profile data such as full name, address, or birthdate. Always pass only the specific fields needed for the user's request. Use this for 'what is my full name?' or 'what is my address?'. Do not use this tool for standard account email. This tool owns the browser approval flow; do not use a generic approval tool for profile reads.",
        name: "my_profile",
      },
      {
        description: "Check the user's proofs and verification-derived facts such as age status, proof inventory, and verification method. Use this for 'what proofs do I have?' or 'am I over 18?'.",
        name: "my_proofs",
      },
      {
        description: "Authorize and execute a purchase on behalf of the user. This tool owns the browser approval flow and returns fulfillment data after approval.",
        name: "purchase",
      },
      {
        description: "Get a safe account summary: verification tier, login method, completed checks, and standard account email when the granted scopes include `email`. Summary only; this tool does not unlock vault data such as full name or address. Use `my_profile` for vault-gated profile fields.",
        name: "whoami",
      },
    ]);
    expect(tools.some((tool) => tool.name === "request_approval")).toBe(false);
  });

  it("renders a generated module that exports the canonical manifest", () => {
    const output = renderGeneratedMcpToolManifest([
      {
        description: "Example description",
        name: "example_tool",
      },
    ]);

    expect(output).toContain('export const MCP_TOOL_MANIFEST = [');
    expect(output).toContain('name: "example_tool"');
    expect(output).toContain('description: "Example description"');
  });

  it("keeps the generated landing manifest in sync with the canonical MCP tool registrations", () => {
    const expectedOutput = renderGeneratedMcpToolManifest(
      collectCanonicalMcpTools(),
    );
    const currentOutput = readFileSync(generatedMcpToolManifestPath, "utf8");

    expect(currentOutput).toBe(expectedOutput);
  });
});
