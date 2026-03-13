import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { zentityFetch } from "../auth/api-client.js";
import { requireAuth } from "../auth/context.js";
import { config } from "../config.js";

interface AgeProof {
  proofId: string;
  isOver18: boolean;
  createdAt: string;
}

interface ZkProof {
  proofId: string;
  proofType: string;
  createdAt: string;
}

export function registerMyProofsTool(server: McpServer): void {
  server.tool(
    "my_proofs",
    "Check the user's verified proofs: age verification (over 18 or minor), document validity, nationality group, face match, and identity binding. Use when the user asks if they are a minor, over 18, what proofs they have, whether their document is valid, or about their nationality group.",
    {},
    async () => {
      try {
        await requireAuth();
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Not authenticated",
            },
          ],
        };
      }

      const [ageRes, allRes] = await Promise.all([
        zentityFetch(
          `${config.zentityUrl}/api/trpc/crypto.getUserProof?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`
        ),
        zentityFetch(`${config.zentityUrl}/api/trpc/crypto.getAllProofs`),
      ]);

      const ageProof = ageRes.ok
        ? ((await ageRes.json()) as { result: { data: AgeProof | null } })
            .result.data
        : null;

      const allProofs = allRes.ok
        ? ((await allRes.json()) as { result: { data: ZkProof[] } }).result.data
        : [];

      const proofSummary = allProofs.map((p) => ({
        type: p.proofType,
        verified: true,
        verifiedAt: p.createdAt,
      }));

      const proofTypes = new Set(allProofs.map((p) => p.proofType));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              isOver18: ageProof?.isOver18 ?? null,
              hasAgeProof: proofTypes.has("age_verification"),
              hasDocValidityProof: proofTypes.has("doc_validity"),
              hasNationalityProof: proofTypes.has("nationality_membership"),
              hasFaceMatchProof: proofTypes.has("face_match"),
              hasIdentityBindingProof: proofTypes.has("identity_binding"),
              totalProofs: allProofs.length,
              proofs: proofSummary,
            }),
          },
        ],
      };
    }
  );
}
