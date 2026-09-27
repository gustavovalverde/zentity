import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { requireAuth } from "../runtime/auth-context.js";
import { zentityFetch } from "../services/zentity-api.js";

interface AttestationNetwork {
  attestation: {
    confirmedAt: string | null;
    explorerUrl?: string;
    status: string;
  } | null;
  id: string;
  name: string;
}

const networkSchema = z.object({
  id: z.string(),
  name: z.string(),
  attested: z.boolean(),
  status: z.string().nullable(),
  explorerUrl: z.string().nullable(),
});

const complianceOutputSchema = z.object({
  attested: z.boolean(),
  lastAttestation: z.string().nullable(),
  networks: z.array(networkSchema),
});

type ComplianceOutput = z.infer<typeof complianceOutputSchema>;

function toComplianceOutput(networks: AttestationNetwork[]): ComplianceOutput {
  const mapped = networks.map((network) => ({
    id: network.id,
    name: network.name,
    attested: network.attestation?.status === "confirmed",
    status: network.attestation?.status ?? null,
    explorerUrl: network.attestation?.explorerUrl ?? null,
  }));
  const confirmedAt = networks
    .map((network) =>
      network.attestation?.status === "confirmed"
        ? network.attestation.confirmedAt
        : null
    )
    .filter((value): value is string => value !== null)
    .sort();

  return {
    attested: mapped.some((network) => network.attested),
    lastAttestation: confirmedAt.at(-1) ?? null,
    networks: mapped,
  };
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
      outputSchema: complianceOutputSchema,
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

      const response = await zentityFetch(
        `${config.zentityUrl}/api/trpc/attestation.networks`
      );

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

      const { networks } = (
        (await response.json()) as {
          result: { data: { networks: AttestationNetwork[] } };
        }
      ).result.data;
      const selected = network
        ? networks.filter((candidate) => candidate.id === network)
        : networks;
      if (network && selected.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Unknown network "${network}". Available networks: ${networks.map((candidate) => candidate.id).join(", ")}`,
            },
          ],
        };
      }

      const structuredContent = toComplianceOutput(selected);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      };
    }
  );
}
