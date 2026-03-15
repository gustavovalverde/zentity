import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { zentityFetch } from "../auth/api-client.js";
import { requireAuth } from "../auth/context.js";
import { config } from "../config.js";

interface AttestationStatus {
  attested: boolean;
  lastAttestation?: string;
  networks: string[];
}

export function registerCheckComplianceTool(server: McpServer): void {
  server.tool(
    "check_compliance",
    "Check the user's on-chain attestation and blockchain compliance status. Use when the user asks about attestation, compliance, or which networks they are registered on.",
    {
      network: z
        .string()
        .optional()
        .describe("Filter by blockchain network (e.g. 'sepolia')"),
    },
    async ({ network }) => {
      try {
        await requireAuth();
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text:
                error instanceof Error ? error.message : "Not authenticated",
            },
          ],
        };
      }

      let url = `${config.zentityUrl}/api/trpc/attestation.networks`;
      if (network) {
        url = `${config.zentityUrl}/api/trpc/attestation.status?input=${encodeURIComponent(JSON.stringify({ networkId: network }))}`;
      }

      const response = await zentityFetch(url);

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
