import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth-config";
import { addWwwAuthenticate } from "@/lib/auth/oidc/haip/oauth-response";
import { canonicalizeRequestOrigin } from "@/lib/auth/origin";
import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";

const { POST: authPOST } = toNextJsHandler(auth);

export async function POST(request: Request) {
  const canonicalRequest = canonicalizeRequestOrigin(request);
  const requestContext = resolveRequestContext(canonicalRequest.headers);
  attachRequestContextToSpan(requestContext);

  return addWwwAuthenticate(await authPOST(canonicalRequest));
}
