import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { requireAuth } from "../runtime/auth-context.js";
import { zentityFetch } from "../services/zentity-api.js";

/**
 * Proof claims delivered by the userinfo endpoint when the token carries
 * proof:* scopes. These are the OIDC claim keys from the disclosure registry.
 */
interface ProofClaims {
  age_verification?: boolean;
  attestation_expires_at?: string;
  chip_verification_method?: string;
  chip_verified?: boolean;
  document_verified?: boolean;
  face_match_verified?: boolean;
  identity_bound?: boolean;
  liveness_verified?: boolean;
  nationality_group?: string;
  nationality_verified?: boolean;
  policy_version?: string;
  sybil_resistant?: boolean;
  verification_level?: string;
  verification_time?: string;
  verified?: boolean;
}

interface CheckOutput {
  passed: boolean;
  type: string;
}

const PROOF_CLAIM_TO_CHECK: [keyof ProofClaims, string][] = [
  ["age_verification", "age"],
  ["document_verified", "document"],
  ["liveness_verified", "liveness"],
  ["face_match_verified", "face_match"],
  ["nationality_verified", "nationality"],
  ["identity_bound", "identity_binding"],
  ["sybil_resistant", "sybil_resistant"],
  ["chip_verified", "chip"],
];

function mapProofClaimsToChecks(claims: ProofClaims): CheckOutput[] {
  const checks: CheckOutput[] = [];
  for (const [claimKey, checkType] of PROOF_CLAIM_TO_CHECK) {
    const value = claims[claimKey];
    if (typeof value === "boolean") {
      checks.push({ type: checkType, passed: value });
    }
  }
  return checks;
}

export function registerMyProofsTool(server: McpServer): void {
  server.registerTool(
    "my_proofs",
    {
      title: "My Proofs",
      description:
        "Check the user's proofs and verification-derived facts such as age status, proof inventory, and verification method. Use this for 'what proofs do I have?' or 'am I over 18?'.",
      outputSchema: {
        verificationMethod: z.string().nullable(),
        verificationLevel: z.string(),
        verified: z.boolean(),
        isOver18: z.boolean().nullable(),
        checks: z.array(
          z.object({
            type: z.string(),
            passed: z.boolean(),
          })
        ),
      },
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

      const userinfoUrl = `${config.zentityUrl}/api/auth/oauth2/userinfo`;
      const response = await zentityFetch(userinfoUrl);

      if (!response.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch proof claims (${response.status})`,
            },
          ],
        };
      }

      const claims = (await response.json()) as ProofClaims;
      const checks = mapProofClaimsToChecks(claims);
      const ageCheck = checks.find((c) => c.type === "age");

      let verificationMethod: string | null = null;
      if (claims.chip_verified) {
        verificationMethod = claims.chip_verification_method ?? "nfc";
      } else if (claims.verified) {
        verificationMethod = "ocr";
      }

      const structuredContent = {
        verificationMethod,
        verificationLevel: claims.verification_level ?? "none",
        verified: claims.verified ?? false,
        isOver18: ageCheck?.passed ?? null,
        checks,
      };

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
