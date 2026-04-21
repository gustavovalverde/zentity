import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth-config";
import {
  addWwwAuthenticate,
  unwrapBetterAuthEnvelope,
} from "@/lib/auth/oidc/haip/oauth-response";
import { persistOpaqueAccessTokenDpopBinding } from "@/lib/auth/oidc/haip/opaque-access-token";
import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";

const { POST: authPOST } = toNextJsHandler(auth);

async function extractAccessToken(response: Response): Promise<string | null> {
  if (!response.ok) {
    return null;
  }
  const payload = (await response
    .clone()
    .json()
    .catch(() => null)) as { access_token?: unknown } | null;
  return typeof payload?.access_token === "string"
    ? payload.access_token
    : null;
}

export async function POST(request: Request) {
  const requestContext = resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);

  const response = await unwrapBetterAuthEnvelope(await authPOST(request));

  const accessToken = await extractAccessToken(response);
  if (accessToken) {
    await persistOpaqueAccessTokenDpopBinding(accessToken, request);
  }

  return addWwwAuthenticate(response);
}
