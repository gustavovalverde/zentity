import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { zentityFetch } from "../auth/api-client.js";
import { requireAuth } from "../auth/context.js";
import { config } from "../config.js";

interface VerificationCheck {
  checkType: string;
  evidenceRef: string | null;
  passed: boolean;
  source: string;
}

interface ChecksResponse {
  checks: VerificationCheck[];
  level: string;
  method: "ocr" | "nfc_chip" | null;
  verified: boolean;
}

interface ProofSummary {
  createdAt: string;
  proofHash: string;
  proofSystem: string;
  proofType: string;
  verified: boolean;
}

interface ProofsResponse {
  method: "ocr" | "nfc_chip" | null;
  proofs: ProofSummary[];
}

const SOURCE_LABELS: Record<string, string> = {
  zk_proof: "ZK proof",
  signed_claim: "server attestation",
  chip_claim: "passport chip",
  commitment: "cryptographic commitment",
  nullifier: "passport nullifier",
  dedup_key: "deduplication key",
};

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
            source: z.string(),
          })
        ),
        totalProofs: z.number(),
        proofs: z.array(
          z.object({
            system: z.string(),
            type: z.string(),
            verified: z.boolean(),
            verifiedAt: z.string(),
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

      const [checksRes, proofsRes] = await Promise.all([
        zentityFetch(`${config.zentityUrl}/api/trpc/zk.getChecks`),
        zentityFetch(`${config.zentityUrl}/api/trpc/zk.getProofs`),
      ]);

      const checksData = checksRes.ok
        ? (
            (await checksRes.json()) as {
              result: { data: ChecksResponse };
            }
          ).result.data
        : null;

      const proofsData = proofsRes.ok
        ? (
            (await proofsRes.json()) as {
              result: { data: ProofsResponse };
            }
          ).result.data
        : null;

      const checks = checksData?.checks ?? [];
      const proofs = proofsData?.proofs ?? [];

      const checkMap = new Map(checks.map((c) => [c.checkType, c]));
      const ageCheck = checkMap.get("age");
      const structuredContent = {
        verificationMethod: checksData?.method ?? null,
        verificationLevel: checksData?.level ?? "none",
        verified: checksData?.verified ?? false,
        isOver18: ageCheck?.passed ?? null,
        checks: checks.map((c) => ({
          type: c.checkType,
          passed: c.passed,
          source: SOURCE_LABELS[c.source] ?? c.source,
        })),
        totalProofs: proofs.length,
        proofs: proofs.map((p) => ({
          system: p.proofSystem,
          type: p.proofType,
          verified: p.verified,
          verifiedAt: p.createdAt,
        })),
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
