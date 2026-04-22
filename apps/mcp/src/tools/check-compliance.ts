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
  server.registerTool(
    "check_compliance",
    {
      title: "Check Compliance",
      description:
        "Check the user's on-chain attestation and blockchain compliance status. Use this for attestation or network compliance questions. This tool does not unlock vault data.",
      inputSchema: {
        network: z
          .string()
          .optional()
          .describe("Filter by blockchain network (e.g. 'sepolia')"),
      },
      outputSchema: {
        attested: z.boolean(),
        lastAttestation: z.string().optional(),
        networks: z.array(z.string()),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
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
      const structuredContent = data.result.data as unknown as Record<
        string,
        unknown
      >;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(data.result.data, null, 2),
          },
        ],
        structuredContent,
      };
    }
  );
}
