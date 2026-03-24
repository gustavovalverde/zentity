import { NextResponse } from "next/server";
import { z } from "zod";

import { clearPendingOauthDisclosure } from "@/lib/auth/oidc/disclosure-context";
import { handleIdentityUnstage } from "@/lib/auth/oidc/identity-handler";
import {
  computeOAuthRequestKey,
  verifySignedOAuthQuery,
} from "@/lib/auth/oidc/oauth-query";

const UnstageSchema = z.object({
  oauth_query: z.string().min(1),
});

export function POST(request: Request): Promise<Response> {
  return handleIdentityUnstage(
    request,
    async (body) => {
      const parsed = UnstageSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      }

      let queryParams: URLSearchParams;
      try {
        queryParams = await verifySignedOAuthQuery(parsed.data.oauth_query);
      } catch {
        return NextResponse.json(
          { error: "Invalid OAuth query" },
          { status: 400 }
        );
      }

      const clientId = queryParams.get("client_id");
      if (!clientId) {
        return NextResponse.json(
          { error: "Missing client_id" },
          { status: 400 }
        );
      }

      return { oauthRequestKey: computeOAuthRequestKey(queryParams) };
    },
    async (result) => {
      await clearPendingOauthDisclosure(
        (result as { oauthRequestKey: string }).oauthRequestKey
      );
    }
  );
}
