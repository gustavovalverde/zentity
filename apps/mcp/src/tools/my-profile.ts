import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { throwUrlElicitationIfSupported } from "../auth/interactive-tool-flow.js";
import {
  normalizeProfileFields,
  PROFILE_FIELDS,
  type PublicProfileField,
} from "../auth/profile-fields.js";
import { readProfile } from "../services/profile-read.js";

const profileFieldSchema = z.enum(PROFILE_FIELDS);

function coerceProfileFieldsInput(value: unknown): unknown {
  if (value == null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to the looser string parsing below.
    }
  }

  return trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

const profileFieldsInputSchema = z.preprocess(
  coerceProfileFieldsInput,
  z.array(profileFieldSchema).min(1)
);

const myProfileInputSchema = z.object({
  fields: profileFieldsInputSchema.describe(
    'Required vault-gated profile fields to retrieve. Allowed values: name, address, birthdate. Always request the minimum needed fields, for example `["birthdate"]` when the user asks only for their birthdate. Do not use this tool for standard account email.'
  ),
});

const profileNameSchema = z.object({
  full: z.string().nullable(),
  given: z.string().nullable(),
  family: z.string().nullable(),
});

const profileOutputSchema = {
  status: z.enum([
    "complete",
    "needs_user_action",
    "denied",
    "expired",
    "unavailable",
  ]),
  requestedFields: z.array(profileFieldSchema),
  returnedFields: z.array(profileFieldSchema),
  profile: z.object({
    name: profileNameSchema.optional(),
    address: z.record(z.string(), z.unknown()).nullable().optional(),
    birthdate: z.string().nullable().optional(),
  }),
  interaction: z
    .object({
      mode: z.literal("url"),
      url: z.string().url(),
      message: z.string(),
      expiresAt: z.string(),
    })
    .optional(),
};

type MyProfileStructuredContent = z.infer<
  z.ZodObject<typeof profileOutputSchema>
>;

function toolResult(structuredContent: MyProfileStructuredContent) {
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

export function registerMyProfileTool(server: McpServer): void {
  server.registerTool(
    "my_profile",
    {
      title: "My Profile",
      description:
        "Retrieve vault-gated profile data such as full name, address, or birthdate. Always pass only the specific fields needed for the user's request. Use this for 'what is my full name?' or 'what is my address?'. Do not use this tool for standard account email. This tool owns the browser approval flow; do not use a generic approval tool for profile reads.",
      inputSchema: myProfileInputSchema,
      outputSchema: profileOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ fields }) => {
      const normalizedFields = normalizeProfileFields(
        fields as PublicProfileField[]
      );
      const result = await readProfile({
        server,
        fields: normalizedFields,
      });

      if (result.status === "needs_user_action" && result.interaction) {
        throwUrlElicitationIfSupported(server, {
          status: "needs_user_action",
          interaction: result.interaction,
        });
      }

      return toolResult(result);
    }
  );
}
