import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth-config";
import { withUserInfoChallenge } from "@/lib/auth/oidc/resource-challenge";
import { ensureWalletClientExists } from "@/lib/auth/oidc/wallet-dcr";
import { canonicalizeRequestOrigin } from "@/lib/auth/origin";
import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";

const { GET: authGET, POST: authPOST } = toNextJsHandler(auth);

async function ensureOidc4vciWalletClientIfNeeded(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/oidc4vci/credential-offer")) {
    await ensureWalletClientExists();
  }
}

export async function GET(request: Request) {
  const canonicalRequest = canonicalizeRequestOrigin(request);
  const requestContext = resolveRequestContext(canonicalRequest.headers);
  attachRequestContextToSpan(requestContext);
  await ensureOidc4vciWalletClientIfNeeded(canonicalRequest);

  return withUserInfoChallenge(
    canonicalRequest,
    await authGET(canonicalRequest)
  );
}

export async function POST(request: Request) {
  const canonicalRequest = canonicalizeRequestOrigin(request);
  const requestContext = resolveRequestContext(canonicalRequest.headers);
  attachRequestContextToSpan(requestContext);
  await ensureOidc4vciWalletClientIfNeeded(canonicalRequest);
  return withUserInfoChallenge(
    canonicalRequest,
    await authPOST(canonicalRequest)
  );
}
