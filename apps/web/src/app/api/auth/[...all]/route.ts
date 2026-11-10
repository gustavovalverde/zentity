import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth-config";
import { addWwwAuthenticate } from "@/lib/auth/oidc/haip/oauth-response";
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

  const response = await authGET(canonicalRequest);
  return addWwwAuthenticate(response);
}

export async function POST(request: Request) {
  const canonicalRequest = canonicalizeRequestOrigin(request);
  const requestContext = resolveRequestContext(canonicalRequest.headers);
  attachRequestContextToSpan(requestContext);
  await ensureOidc4vciWalletClientIfNeeded(canonicalRequest);
  const response = await authPOST(canonicalRequest);
  return addWwwAuthenticate(response);
}
