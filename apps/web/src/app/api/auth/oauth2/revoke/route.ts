/**
 * RFC 7009 OAuth 2.0 Token Revocation endpoint.
 *
 * `POST /api/auth/oauth2/revoke` with an `application/x-www-form-urlencoded`
 * body carrying `token` (required) and `token_type_hint` (optional). On a
 * recognized token the issuer records the `jti` in the `revoked_token`
 * table; the wallet runtime's revocation poller (Proposal-0003 D-6) picks
 * the entry up through `/api/auth/oauth2/revoked?since=` and fails closed
 * once its cache outruns the issuer's hard-capped poll interval.
 *
 * Per RFC 7009 §2.2 the endpoint returns 200 OK whether the token was
 * known or not; existence is intentionally hidden from the caller.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { revokeToken } from "@/lib/auth/oidc/token-revocation";

const RevokeBodySchema = z.object({
  token: z.string().min(1),
  token_type_hint: z.enum(["access_token", "refresh_token"]).optional(),
});

export async function POST(request: Request) {
  const formText = await request.text();
  const params = new URLSearchParams(formText);
  const parsed = RevokeBodySchema.safeParse({
    token: params.get("token") ?? "",
    token_type_hint: params.get("token_type_hint") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: "token form parameter is required",
      },
      { status: 400 }
    );
  }

  await revokeToken({
    token: parsed.data.token,
    tokenTypeHint: parsed.data.token_type_hint,
  });

  // RFC 7009 §2.2: respond with 200 whether the token was known or not.
  return new NextResponse(null, { status: 200 });
}
