import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  collectCanonicalMcpTools,
  extractImportPathByRegisterFunction,
  extractRegisterFunctionOrder,
  extractToolMetadata,
  generatedMcpToolManifestPath,
  renderGeneratedMcpToolManifest,
} from "./mcp-tool-manifest.js";

function normalizeGeneratedModuleWhitespace(source: string) {
  return source.replace(/\s+/g, " ").trim();
}

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
        description: "Buy something on behalf of the user, who approves in the browser with a passkey. Without url: a purchase from a named merchant; pass merchant, item, amount, and currency, and the tool returns the user's shipping details once after approval. With url: an x402 resource that needs a Zentity Proof-of-Human. The user approves proving their identity to that merchant; the agent's own wallet pays the merchant's price, up to maxAmount. This needs a payment scheme client, so it answers payment_not_configured until one is configured. Statuses: approved, needs_user_action, denied, expired, payment_not_configured, merchant_mismatch, untrusted_issuer, unsupported_resource, payment_bounds_exceeded, identity_strength_bound_exceeded, approval_mismatch, payment_failed. An x402 purchase is approved only when the merchant accepts the payment after the user's approval; payment_failed means the user approved but the merchant refused the payment (see x402.status and x402.response), and unsupported_resource with an x402 field means the merchant answered without asking for a Proof-of-Human.",
        name: "purchase",
      },
      {
        description: "Get a safe account summary: verification tier, login method, completed checks, and standard account email when the granted scopes include `email`. Summary only; this tool does not unlock vault data such as full name or address. Use `my_profile` for vault-gated profile fields.",
        name: "whoami",
      },
    ]);
    expect(tools.some((tool) => tool.name === "request_approval")).toBe(false);
  });

  it("finds registration calls that pass extra arguments and imports that bring in types", () => {
    const source = `
import { registerAlphaTool } from "./tools/alpha.js";
import {
  type BetaToolOptions,
  registerBetaTool,
} from "./tools/beta.js";

export function createServer(options = {}) {
  registerAlphaTool(server);
  registerBetaTool(server, options.beta);
  registerGammaTool(
    server,
    options.gamma,
  );
}
`;

    expect(extractRegisterFunctionOrder(source)).toEqual([
      "registerAlphaTool",
      "registerBetaTool",
      "registerGammaTool",
    ]);
    expect([...extractImportPathByRegisterFunction(source).keys()]).toEqual([
      "registerAlphaTool",
      "registerBetaTool",
    ]);
  });

  it("reads a description written as a joined array of strings", () => {
    const toolSource = `
      server.registerTool(
        "joined",
        {
          title: "Joined",
          description: [
            "First sentence.",
            "Second sentence.",
          ].join(" "),
        },
      );
    `;

    expect(extractToolMetadata(toolSource, "joined.ts")).toEqual({
      description: "First sentence. Second sentence.",
      name: "joined",
    });
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
    expect(output).toContain('description:\n      "Example description"');
  });

  it("keeps the generated landing manifest in sync with the canonical MCP tool registrations", () => {
    const expectedOutput = renderGeneratedMcpToolManifest(
      collectCanonicalMcpTools(),
    );
    const currentOutput = readFileSync(generatedMcpToolManifestPath, "utf8");

    expect(normalizeGeneratedModuleWhitespace(currentOutput)).toBe(
      normalizeGeneratedModuleWhitespace(expectedOutput),
    );
  });
});
