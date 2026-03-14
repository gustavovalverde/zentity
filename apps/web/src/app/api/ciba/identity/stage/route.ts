import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { sealApprovalPii } from "@/lib/auth/oidc/approval-crypto";
import { stageReleaseHandle } from "@/lib/auth/oidc/ephemeral-release-handles";
import { IdentityFieldsSchema } from "@/lib/auth/oidc/identity-fields-schema";
import { handleIdentityStage } from "@/lib/auth/oidc/identity-handler";
import { db } from "@/lib/db/connection";
import { validatePendingCibaRequest } from "@/lib/db/queries/ciba";
import { approvals } from "@/lib/db/schema/approvals";

const StageSchema = z.object({
  auth_req_id: z.string().min(1),
  scopes: z.array(z.string()).min(1),
  identity: IdentityFieldsSchema.optional(),
  intent_token: z.string().min(1),
});

/**
 * POST /api/ciba/identity/stage — Seal and store PII for a CIBA request.
 *
 * Encrypts PII with a per-approval AES-GCM key, writes a durable record
 * to the `approvals` table, and stages the release handle for embedding
 * in the access token via customAccessTokenClaims. The RP redeems PII
 * by calling POST /api/oauth2/release with the access token.
 */
export function POST(request: Request): Promise<Response> {
  let cibaContext: {
    authReqId: string;
    authorizationDetails: string | null | undefined;
  };

  return handleIdentityStage(
    request,
    async (body, userId) => {
      const parsed = StageSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid request", details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const { auth_req_id, scopes, identity, intent_token } = parsed.data;

      const result = await validatePendingCibaRequest(auth_req_id, userId);
      if (result instanceof Response) {
        return result;
      }

      cibaContext = {
        authReqId: auth_req_id,
        authorizationDetails: result.authorizationDetails,
      };

      return {
        clientId: result.clientId,
        authorizedScopes: result.scope.split(" "),
        scopes,
        identity,
        intentToken: intent_token,
        authReqId: auth_req_id,
      };
    },
    async ({ userId, filteredIdentity, scopes, clientId }) => {
      const piiJson = JSON.stringify(filteredIdentity);
      const sealed = await sealApprovalPii(piiJson);

      // Replace any existing approval (idempotent re-staging)
      await db
        .delete(approvals)
        .where(eq(approvals.authReqId, cibaContext.authReqId))
        .run();

      await db
        .insert(approvals)
        .values({
          authReqId: cibaContext.authReqId,
          userId,
          clientId,
          approvedScopes: scopes.join(" "),
          authorizationDetails: cibaContext.authorizationDetails ?? undefined,
          encryptedPii: sealed.encryptedPii,
          encryptionIv: sealed.encryptionIv,
          releaseHandleHash: sealed.releaseHandleHash,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        })
        .run();

      stageReleaseHandle(cibaContext.authReqId, sealed.releaseHandle, userId);

      return NextResponse.json({ staged: true });
    }
  );
}
