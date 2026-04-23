import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireAuth } from "../runtime/auth-context.js";
import { fetchAccountSummary } from "../services/account-summary.js";
import { PROFILE_FIELDS } from "../services/profile-fields.js";

const whoamiOutputSchema = {
  email: z.string().nullable(),
  memberSince: z.string().nullable(),
  tier: z.number().nullable(),
  tierName: z.string().nullable(),
  verificationLevel: z.string().nullable(),
  authStrength: z.string().nullable(),
  loginMethod: z.string().nullable(),
  checks: z.record(z.string(), z.boolean()).nullable(),
  vaultFieldsAvailable: z.array(z.enum(PROFILE_FIELDS)),
  profileToolHint: z.literal("my_profile"),
};

export function registerWhoamiTool(server: McpServer): void {
  server.registerTool(
    "whoami",
    {
      title: "Who Am I",
      description:
        "Get a safe account summary: verification tier, login method, completed checks, and standard account email when the granted scopes include `email`. Summary only; this tool does not unlock vault data such as full name or address. Use `my_profile` for vault-gated profile fields.",
      outputSchema: whoamiOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () => {
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

      const summary = await fetchAccountSummary();
      const structuredContent = summary as unknown as Record<string, unknown>;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
        structuredContent,
      };
    }
  );
}
