import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { zentityFetch } from "../auth/api-client.js";
import { loadCredentials } from "../auth/credentials.js";
import { loadDpopKey } from "../auth/dpop.js";
import { config } from "../config.js";

interface AttestationStatus {
  attested: boolean;
  lastAttestation?: string;
  networks: string[];
}

export function registerCheckComplianceTool(server: McpServer): void {
  server.tool(
    "zentity_check_compliance",
    "Query the authenticated user's on-chain attestation status",
    {
      network: z
        .string()
        .optional()
        .describe("Filter by blockchain network (e.g. 'sepolia')"),
    },
    async ({ network }) => {
      const creds = loadCredentials(config.zentityUrl);
      const dpopKey = creds ? loadDpopKey(creds) : undefined;
      if (!dpopKey) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Not authenticated" }],
        };
      }

      let url = `${config.zentityUrl}/api/trpc/attestation.getStatus`;
      if (network) {
        url += `?input=${encodeURIComponent(JSON.stringify({ network }))}`;
      }

      const response = await zentityFetch(url, dpopKey);

      if (!response.ok) {
        const text = await response.text();
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch attestation status: ${response.status} ${text}`,
            },
          ],
        };
      }

      const data = (await response.json()) as {
        result: { data: AttestationStatus };
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data.result.data) },
        ],
      };
    }
  );
}
