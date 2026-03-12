import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { zentityFetch } from "../auth/api-client.js";
import { loadCredentials } from "../auth/credentials.js";
import { loadDpopKey } from "../auth/dpop.js";
import { config } from "../config.js";

interface TierProfile {
  aal: string;
  proofs: string[];
  tier: number;
}

export function registerVerifyIdentityTool(server: McpServer): void {
  server.tool(
    "zentity_verify_identity",
    "Query the authenticated user's identity assurance tier and proofs",
    {},
    async () => {
      const creds = loadCredentials(config.zentityUrl);
      const dpopKey = creds ? loadDpopKey(creds) : undefined;
      if (!dpopKey) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Not authenticated" }],
        };
      }

      const url = `${config.zentityUrl}/api/trpc/assurance.getTierProfile`;
      const response = await zentityFetch(url, dpopKey);

      if (!response.ok) {
        const text = await response.text();
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch tier profile: ${response.status} ${text}`,
            },
          ],
        };
      }

      const data = (await response.json()) as { result: { data: TierProfile } };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data.result.data) },
        ],
      };
    }
  );
}
