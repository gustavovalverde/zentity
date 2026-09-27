import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withToolAuth } from "../runtime/auth-context.js";
import { fetchAccountSummary } from "../services/account-summary.js";
import { PROFILE_FIELDS } from "../services/profile-fields.js";

const humanityCredentialSchema = z.object({
  attachedAt: z.string(),
  expiresAt: z.string().nullable(),
  provider: z.string(),
  providerSubjectKind: z.string(),
});

const whoamiOutputSchema = z.object({
  email: z.string().nullable(),
  memberSince: z.string().nullable(),
  tier: z.number().nullable(),
  tierName: z.string().nullable(),
  verificationStrength: z.string().nullable(),
  authStrength: z.string().nullable(),
  loginMethod: z.string().nullable(),
  checks: z.record(z.string(), z.boolean()).nullable(),
  humanity: z.object({
    proven: z.boolean(),
    sources: z.array(humanityCredentialSchema),
  }),
  vaultFieldsAvailable: z.array(z.enum(PROFILE_FIELDS)),
  profileToolHint: z.literal("my_profile"),
});

export function registerWhoamiTool(server: McpServer): void {
  server.registerTool(
    "whoami",
    {
      title: "Who Am I",
      description:
        "Get a safe account summary: verification tier, login method, completed checks, and standard account email when the granted scopes include `email`. Summary only; this tool does not unlock vault data such as full name or address. Use `my_profile` for vault-gated profile fields.",
      inputSchema: z.object({}),
      outputSchema: whoamiOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    withToolAuth(server, async () => {
      const summary = await fetchAccountSummary();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
        structuredContent: { ...summary },
      };
    })
  );
}
